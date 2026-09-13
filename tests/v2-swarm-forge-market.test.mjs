import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketReader } from '../broker/src/v4/skill-forge/market-reader.mjs';
import { createResearchSkillRuntime, loadResearchSkillCatalog } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';

const CONTRACT = `0x${'1'.repeat(40)}`, OWNER = `0x${'2'.repeat(40)}`, HASH = `0x${'3'.repeat(64)}`;
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function listingsReader(price) {
  return createMarketReader({ apiKey: 'OFFLINE_FIXTURE', fetchImpl: async url => response(
    url.includes('/collections/') ? { contracts: [{ chain: 'robinhood', address: CONTRACT }] }
      : { listings: [{ chain: 'robinhood', order_hash: HASH, price: { current: price } }] }),
  });
}
const get = reader => reader.getListings({ slug: 'offline-fixture', contract: CONTRACT });

test('market decimal-string amounts retain precision across supported currency decimals', async () => {
  const amount = '900719925474099312345678901234567890';
  for (const decimals of [0, 6, 18, 36]) {
    const result = await get(listingsReader({ value: amount, decimals, currency: 'FIXTURE' }));
    assert.equal(result.listings[0].price.value, amount);
    assert.equal(result.listings[0].price.decimals, decimals);
    assert.equal(result.walletAuthority, 'NONE');
    assert.equal(result.executable, false);
  }
});

test('market malformed amounts and decimals reject instead of becoming a usable quote', async () => {
  for (const price of [
    { value: '-1', decimals: 18 }, { value: '1.5', decimals: 18 },
    { value: '1e18', decimals: 18 }, { value: '01', decimals: 18 },
    { value: '9'.repeat(79), decimals: 18 }, { value: null, decimals: 18 },
    { value: '1', decimals: -1 }, { value: '1', decimals: 37 },
    { value: '1', decimals: 6.5 }, { value: '1', decimals: '18' },
  ]) {
    await assert.rejects(get(listingsReader({ ...price, currency: 'FIXTURE' })), /INVALID_LISTING_PRICE_OR_ID/);
  }
});

test('an approved equipped Market Scout still exposes no market tool without a credential', async () => {
  // Approval and learned/equipped state are offline fixtures, not a release change.
  const original = (await loadResearchSkillCatalog()).find(pack => pack.slug === 'market-scout');
  const pack = { ...original, approved: true, status: 'READY' };
  const state = { tokenId: '93', owner: OWNER, chainId: 4663, blockHash: HASH,
    blockTime: Date.now(), slots: 1, mask: '4', equipped: [{ key: skillKey(8, 1),
      slot: 0, level: 1, available: true, definition: { status: 4, disabled: false,
        deprecated: false, capabilities: 4n, manifestHash: pack.manifestHash,
        instructionHash: pack.instructionHash } }] };
  let providerCalls = 0;
  const runtime = createResearchSkillRuntime({ packages: [pack], readState: async () => state,
    client: {}, fetchImpl: async () => { providerCalls++; throw Error('PROVIDER_MUST_NOT_RUN'); } });
  const context = await runtime.resolve({ tokenId: '93', owner: OWNER });
  assert.deepEqual(context.effectiveProtocolCapabilities, ['MARKET_READ']);
  assert.deepEqual(context.effectiveMcpTools, []);
  assert.equal(context.walletAuthority, 'NONE');
  assert.equal(context.requiresSeparateEconomicAuthorization, true);
  await assert.rejects(runtime.call({ tokenId: '93', owner: OWNER, name: 'get_market_listings',
    arguments: { slug: 'offline-fixture', contract: CONTRACT } }), /SKILL_TOOL_DENIED/);
  assert.equal(providerCalls, 0);
  assert.equal(original.status, 'TESTING');
  assert.equal(original.approved, false);
});
