import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, glob, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem';

// Optional checkout override is for independent review before cherry-picking.
// Production code never consumes this environment variable.
const ROOT = process.env.GOGH_PLANNED_REVIEW_ROOT
  ? resolve(process.env.GOGH_PLANNED_REVIEW_ROOT) : fileURLToPath(new URL('../', import.meta.url));
const moduleAt = path => import(pathToFileURL(join(ROOT, path)).href);
const { loadResearchSkillCatalog, PLANNED_RESEARCH_SELECTION } = await moduleAt('broker/src/v4/skill-forge/research-runtime.mjs');
const { forgeSkillKey, forgeResearchAction, forgeResearchNeedsSample } = await moduleAt('site/forge-research-actions.js');
const { createDurableTrainingPanel } = await moduleAt('site/forge-durable-training-panel.js');
const identities = [
  [3, 1, 'inspect_contract'], [4, 1, 'rank_trait_sample'], [8, 1, 'get_market_listings'],
  [8, 2, 'get_market_listings'], [9, 1, 'rank_observed_listings'],
  [11, 1, 'research_collection'], [6, 1, 'classify_collection'],
];
const canonicalKey = (id, version) => keccak256(encodeAbiParameters(
  parseAbiParameters('string,uint32,uint16'), ['GOGH_SKILL', id, version]));

test('independent: actual browser research keys match Solidity ABI for every offered version', () => {
  for (const [id, version, action] of identities) {
    const actual = forgeSkillKey(id, version);
    assert.equal(actual, canonicalKey(id, version));
    assert.equal(forgeResearchAction(actual), action);
    const legacyWrongKey = keccak256(encodeAbiParameters(parseAbiParameters('uint32,uint16'), [id, version]));
    assert.notEqual(actual, legacyWrongKey, 'omitting GOGH_SKILL was the actual hidden-button defect');
    assert.equal(forgeResearchAction(legacyWrongKey), null);
  }
  assert.equal(forgeResearchAction(canonicalKey(9, 2)), null, 'unknown version does not silently become v1');
  for (const [id, version] of [[0, 1], [1, 0], [-1, 1], [2 ** 32, 1], [1, 2 ** 16], [1.5, 1], ['4', 1]]) {
    assert.throws(() => forgeSkillKey(id, version));
  }
});

test('independent: samples are required only for the three sample tools', () => {
  for (const [, , action] of identities) {
    assert.equal(forgeResearchNeedsSample(action),
      ['rank_trait_sample', 'research_collection', 'classify_collection'].includes(action));
  }
  assert.equal(forgeResearchNeedsSample('arbitrary_sign'), false);
});

for (const functionName of ['broker-v2-forge', 'broker-v2-forge-skill', 'broker-v2-mcp']) {
  test(`independent: actual ${functionName} package includes every raw planned-adapter pin dependency`, async () => {
    const config = await readFile(join(ROOT, 'netlify.toml'), 'utf8');
    const stanza = config.split(`[functions."${functionName}"]`)[1]?.split('\n[')[0];
    assert.ok(stanza, 'a source bundle alone does not preserve raw files read for package verification');
    const included = JSON.parse(stanza.match(/included_files\s*=\s*(\[[^\n]+\])/)[1]);
    const packaged = await mkdtemp(join(tmpdir(), 'gogh-planned-independent-package-'));
    try {
      for (const pattern of included) {
        for await (const relative of glob(pattern, { cwd: ROOT })) {
          const source = join(ROOT, relative);
          if (!(await stat(source)).isFile()) continue;
          const target = join(packaged, relative);
          await mkdir(dirname(target), { recursive: true });
          await copyFile(source, target);
        }
      }
      const catalog = await loadResearchSkillCatalog({ root: pathToFileURL(`${packaged}/`), selection: PLANNED_RESEARCH_SELECTION });
      assert.deepEqual(catalog.map(pack => pack.manifest.skillId), [9, 11, 6]);
      assert.ok(catalog.every(pack => !pack.approved && pack.status === 'TESTING'));
      assert.ok((await readFile(join(packaged, 'broker/src/v4/collecting-intent.mjs'))).length > 0,
        'Art Curator hashes the original raw collecting-intent source');
    } finally { await rm(packaged, { force: true, recursive: true }); }
  });
}

function browserFixture(id, version, action, { delayResearch = false } = {}) {
  class Node {
    constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.childNodes = []; this.listeners = {}; this.value = ''; }
    set textContent(value) { this.text = String(value); this.childNodes = []; }
    get textContent() { return (this.text ?? '') + this.childNodes.map(child => child.textContent).join(' '); }
    append(...nodes) { this.childNodes.push(...nodes); }
    replaceChildren(...nodes) { this.text = ''; this.childNodes = nodes; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    closest() { return null; }
    click() { if (!this.disabled) this.listeners.click?.(); }
  }
  const owner = `0x${'1'.repeat(40)}`, hash = `0x${'a'.repeat(64)}`, key = canonicalKey(id, version);
  const document = { hidden: false, createElement(tag) { return new Node(tag, this); },
    querySelector(selector) { return { value: selector.includes('two') ? '94' : '95' }; } };
  const root = new Node('section', document), calls = [];
  const release = { status: 'OWNER_CANARY', allowedOwners: [owner], registry: `0x${'2'.repeat(40)}`,
    progressionCodeHash: hash, snapshotHash: hash, skills: [{ key, name: 'Reviewed skill', manifestHash: hash, instructionHash: hash }] };
  const binding = { chainId: 4663, deploymentHash: hash };
  let selection = { owner, tokenId: '93', chainId: 4663, preview: false }, finishResearch;
  const output = { ok: true, mode: 'EQUIPPED_RESEARCH', owner, tokenId: '93', skillKey: key, action,
    chainId: 4663, walletAuthority: 'NONE', canBurn: false, observedAt: new Date().toISOString(),
    result: { marker: 'CURRENT_RESEARCH_RESULT', chainId: 4663, walletAuthority: 'NONE', executable: false,
      ...(action === 'rank_observed_listings' ? { schema: 'GOGH_OBSERVED_LISTING_RANKS_V1', rankedGroups: [], collectionFloor: null, collectionFloorVerified: false } : {}),
      ...(action === 'research_collection' ? { schema: 'GOGH_COLLECTION_RESEARCH_V1', coverage: { requestedCount: 3, observedCount: 0 }, traitCoverage: [] } : {}),
      ...(action === 'classify_collection' ? { schema: 'GOGH_DECLARED_ART_STYLE_MATCHES_V1', visualClassification: 'UNAVAILABLE', recognizedTokenCount: 0, unknownTokenCount: 3, declaredStyleCounts: [] } : {}) } };
  const savedGlobals = Object.fromEntries(['window', 'document', 'localStorage'].map(name => [name, globalThis[name]]));
  globalThis.document = document;
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} };
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw Error('NO_STORAGE_WRITE_FOR_RESEARCH'); }, removeItem: () => {} };
  const panel = createDurableTrainingPanel({ root, release, binding, getSelection: () => selection, ensureSession: async () => {},
    getProvider: () => { throw Error('NO_WALLET_REQUEST_ALLOWED'); },
    request: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith('/forge/skill')) {
        if (delayResearch) return new Promise(resolve => { finishResearch = () => resolve(output); });
        return output;
      }
      assert.deepEqual(options ?? {}, {}, 'opening research never prepares a training transaction');
      return { ok: true, mode: 'OWNER_CANARY', canBurn: false, ...selection, held: false, record: null,
        release: { ...binding, registry: release.registry, progressionCodeHash: hash, snapshotHash: hash },
        state: { owner, tokenId: selection.tokenId, credits: '0', nonce: '0', stateHash: hash, slots: 1, claimed: 1,
          anchor: { number: '100', hash, timestamp: String(Math.floor(Date.now() / 1000)) },
          equipped: [key], skills: release.skills.map(skill => ({ ...skill, level: 1, available: true })) } };
    } });
  const descendants = node => [node, ...node.childNodes.flatMap(descendants)];
  const button = label => descendants(root).find(node => node.tagName === 'button' && node.textContent === label);
  const ready = async () => { for (let i = 0; i < 30; i++) { await new Promise(setImmediate); if (button('RUN EQUIPPED RESEARCH')?.disabled === false) return; } throw Error(`RESEARCH_BUTTON_MISSING: ${root.textContent}`); };
  return { root, panel, calls, output, button, ready, finish: () => finishResearch(),
    changeSelection: () => { selection = { ...selection, tokenId: '94' }; panel.selectionChanged(); },
    cleanup: () => { panel.destroy(); for (const [name, value] of Object.entries(savedGlobals)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    } } };
}

test('independent: actual durable panel exposes and invokes research for real on-chain keys, including Rarity Eye', async () => {
  for (const [id, version, action] of identities) {
    const f = browserFixture(id, version, action);
    try {
      assert.equal(f.calls.length, 0, 'mounting the panel performs no request');
      f.button('RECHECK TRAINING').click(); await f.ready();
      f.button('RUN EQUIPPED RESEARCH').click(); await f.ready();
      const sent = f.calls.find(call => call.path.endsWith('/forge/skill'));
      assert.ok(sent, `canonical ${id}/${version} key must not hide the button`);
      assert.equal(sent.path, '/api/v2/punks/93/forge/skill');
      assert.deepEqual(JSON.parse(sent.options.body), { action, skillKey: canonicalKey(id, version),
        ...(forgeResearchNeedsSample(action) ? { sampleTokenIds: ['93', '94', '95'] } : {}) });
      assert.match(f.root.textContent, /CURRENT_RESEARCH_RESULT/);
      assert.equal(f.calls.length, 2, 'only one state GET and one read-only research POST');
    } finally { f.cleanup(); }
  }
});

test('independent: a pending equipped result cannot cross a selected-Punk change', async () => {
  const f = browserFixture(11, 1, 'research_collection', { delayResearch: true });
  try {
    f.button('RECHECK TRAINING').click(); await f.ready();
    f.button('RUN EQUIPPED RESEARCH').click();
    await new Promise(setImmediate);
    f.changeSelection();
    f.finish();
    await new Promise(setImmediate);
    assert.doesNotMatch(f.root.textContent, /CURRENT_RESEARCH_RESULT|Equipped research completed/);
    assert.equal(f.button('RUN EQUIPPED RESEARCH'), undefined);
    assert.equal(f.calls.length, 2);
  } finally { f.cleanup(); }
});
