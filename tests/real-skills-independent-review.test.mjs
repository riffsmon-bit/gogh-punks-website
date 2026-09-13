import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, glob, mkdtemp, mkdir, copyFile, stat, rm } from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadResearchSkillCatalog, createResearchSkillRuntime } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { skillKey, SKILL_CAPABILITIES } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { buildResearchRegistrationProposal } from '../broker/src/v4/skill-forge/research-registration-proposal.mjs';

const OWNER = `0x${'1'.repeat(40)}`, CONTRACT = `0x${'2'.repeat(40)}`, HASH = `0x${'3'.repeat(64)}`;
const selection = [{ slug: 'market-scout', version: 2 }, { slug: 'link-sniper', version: 1 }, { slug: 'mint-hunter', version: 1 }];
const definition = (pack, slot = 0) => ({ slot, key: skillKey(pack.manifest.skillId, pack.manifest.version),
  level: 1, available: true, definition: { status: 4, disabled: false, deprecated: false,
    manifestHash: pack.manifestHash, instructionHash: pack.instructionHash,
    capabilities: pack.manifest.capabilities.reduce((mask, name) => mask | SKILL_CAPABILITIES[name], 0n).toString() } });
const stateFor = packs => ({ tokenId: '93', owner: OWNER, chainId: 4663, blockHash: HASH,
  blockTime: Date.now(), slots: 4, authorityEpoch: 'review-fixture:1',
  mask: packs.reduce((mask, pack) => mask | BigInt(definition(pack).definition.capabilities), 0n).toString(),
  equipped: packs.map((pack, index) => definition(pack, index)) });
const approveFixture = pack => ({ ...pack, status: 'READY', approved: true });
const call = runtime => runtime.call({ tokenId: '93', owner: OWNER, name: 'get_market_listings',
  arguments: { slug: 'review-fixture', contract: CONTRACT, limit: 1 } });

for (const change of ['exact-version-swap', 'same-owner-new-epoch', 'registry-mask-revoked']) {
  test(`independent real adapter review withholds market output after ${change}`, async () => {
    const packs = (await loadResearchSkillCatalog({ selection: [
      { slug: 'market-scout', version: 1 }, { slug: 'market-scout', version: 2 },
    ] })).map(approveFixture);
    const state = stateFor([packs[1]]); let reads = 0;
    const runtime = createResearchSkillRuntime({ packages: packs, apiKey: 'synthetic-market-key',
      readState: async () => ({ ...state, blockTime: Date.now() }),
      fetchImpl: async (url, options) => {
        reads++; assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
        if (reads === 1) {
          assert.equal(url, 'https://api.opensea.io/api/v2/collections/review-fixture');
          return Response.json({ contracts: [{ chain: 'robinhood', address: CONTRACT }] });
        }
        assert.equal(url, 'https://api.opensea.io/api/v2/listings/collection/review-fixture/all?limit=1');
        if (change === 'exact-version-swap') state.equipped = [definition(packs[0])];
        else if (change === 'same-owner-new-epoch') state.authorityEpoch = 'review-fixture:2';
        else state.mask = '0';
        return Response.json({ listings: [], next: null });
      },
    });
    await assert.rejects(call(runtime), /SKILL_CONTEXT_CHANGED/);
    assert.equal(reads, 2, 'The actual bounded reader ran, but its result was withheld');
  });
}

test('independent review: chain READY cannot approve a locally unapproved package', async () => {
  const packs = await loadResearchSkillCatalog({ selection }); const state = stateFor(packs);
  let externalReads = 0;
  const runtime = createResearchSkillRuntime({ packages: packs, client: {}, apiKey: 'synthetic-key', environment: {},
    readState: async () => state,
    mintContextReader: async () => { externalReads++; throw Error('UNEXPECTED_CONTEXT_READ'); },
    fetchImpl: async () => { externalReads++; throw Error('UNEXPECTED_NETWORK'); },
  });
  const context = await runtime.resolve({ tokenId: '93', owner: OWNER });
  assert.deepEqual(context.effectiveMcpTools, []); assert.equal(context.walletAuthority, 'NONE');
  for (const name of ['get_market_listings', 'inspect_mint_link', 'inspect_mint', 'simulate_mint', 'prepare_mint']) {
    await assert.rejects(runtime.call({ tokenId: '93', owner: OWNER, name, arguments: {} }), /SKILL_TOOL_DENIED/);
  }
  assert.equal(externalReads, 0);
});

test('independent review: version, credential and endpoint controls cannot enter a real market call', async () => {
  const packs = (await loadResearchSkillCatalog({ selection: [selection[0]] })).map(approveFixture);
  const state = stateFor(packs); let reads = 0;
  const runtime = createResearchSkillRuntime({ packages: packs, apiKey: 'synthetic-key', readState: async () => state,
    fetchImpl: async () => { reads++; throw Error('UNEXPECTED_NETWORK'); } });
  for (const extra of [{ version: 1 }, { apiKey: 'substitute-key' }, { endpoint: 'https://attacker.invalid/' },
    { transaction: { to: OWNER } }, { maxPages: 1000 }]) {
    await assert.rejects(runtime.call({ tokenId: '93', owner: OWNER, name: 'get_market_listings',
      arguments: { slug: 'review-fixture', contract: CONTRACT, ...extra } }), /INVALID_RESEARCH_ARGUMENTS/);
  }
  assert.equal(reads, 0);
});

test('independent review: provider failure remains unavailable and cannot leak the raw error', async () => {
  const packs = (await loadResearchSkillCatalog({ selection: [selection[0]] })).map(approveFixture);
  const state = stateFor(packs), sentinel = 'SYNTHETIC_PRIVATE_UPSTREAM_DETAIL';
  const runtime = createResearchSkillRuntime({ packages: packs, apiKey: 'synthetic-key', readState: async () => state,
    fetchImpl: async () => { throw Error(`https://private.invalid/${sentinel}`); } });
  const result = await call(runtime);
  assert.equal(result.coverage.status, 'UNAVAILABLE'); assert.equal(result.coverage.unavailable, 'MARKET_SOURCE_UNAVAILABLE');
  assert.equal(result.executable, false); assert.equal(result.walletAuthority, 'NONE');
  assert.equal(result.coverage.collectionFloorVerified, false); assert.equal(result.coverage.collectionFloor, null);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel));
});

test('independent review: stored registration proposal exactly reproduces current pinned packages', async () => {
  const stored = JSON.parse(await readFile(new URL('../docs/v2-hardening/real-skill-registration-proposal.json', import.meta.url), 'utf8'));
  assert.deepEqual(await buildResearchRegistrationProposal(), stored);
  assert.equal(stored.productionAuthorized, false); assert.equal(stored.transactionSubmitted, false);
  assert.ok(stored.definitions.every(item => item.readyTransitionIncluded === false && item.runtimeApproved === false));
});

test('independent review: composed proof binds the checked-in harness and discloses fixture limits', async () => {
  const proof = JSON.parse(await readFile(new URL('../docs/v2-hardening/real-skill-composed-evidence.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../scripts/test-real-skill-composed-journey.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), proof.harnessSha256);
  assert.equal(proof.publicTransactions, 0); assert.equal(proof.productionDatabaseAccessed, false);
  assert.equal(proof.productionManifestsChanged, false); assert.equal(proof.productionBurnAuthorized, false);
  assert.equal(proof.sourceInventoryFixtureOnly, true);
  assert.match(proof.limitations.join('\n'), /fixture records; production DB adapter must be reviewed separately/);
  assert.match(proof.limitations.join('\n'), /no mint transaction is submitted/);
  const packs = await loadResearchSkillCatalog({ selection });
  for (const pack of packs) {
    const key = skillKey(pack.manifest.skillId, pack.manifest.version);
    assert.equal(proof.results.filter(result => result.key === key && result.version === pack.manifest.version).length, 1);
  }
});

test('independent review: MCP deployment files support actual package pins and restricted database TLS', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  const stanza = config.split('[functions."broker-v2-mcp"]')[1]?.split('\n[')[0];
  assert.ok(stanza, 'The actual MCP deployment must declare its runtime files');
  const included = JSON.parse(stanza.match(/included_files\s*=\s*(\[[^\n]+\])/)[1]);
  const packaged = await mkdtemp(join(tmpdir(), 'gogh-independent-skill-package-'));
  try {
    for (const pattern of included) {
      for await (const relative of glob(pattern, { cwd: root })) {
        const source = join(root, relative);
        if (!(await stat(source)).isFile()) continue;
        const target = join(packaged, relative);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      }
    }
    // Actual source-byte verification must work with only the declared runtime
    // files. A successful JavaScript bundle alone cannot prove dynamic reads.
    const catalog = await loadResearchSkillCatalog({ root: pathToFileURL(`${packaged}/`), selection: [
      { slug: 'contract-detective', version: 1 }, { slug: 'rarity-eye', version: 1 },
      { slug: 'market-scout', version: 1 }, ...selection,
    ] });
    assert.equal(catalog.length, 6);
    assert.ok(catalog.every(pack => pack.approved === false && pack.status === 'TESTING'));
    const certificate = new X509Certificate(await readFile(join(packaged,
      'deployments/certificates/supabase-prod-ca-2021.crt')));
    assert.equal(certificate.fingerprint256,
      '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  } finally { await rm(packaged, { recursive: true, force: true }); }
});
