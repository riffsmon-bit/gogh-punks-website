import test from 'node:test';
import assert from 'node:assert/strict';
import { handleHolderBurn } from '../netlify/functions/broker-v2-forge-holder-burn.mjs';
import { encodePunkBurnApproval } from '../site/forge-burn-calldata.js';
import { validateHolderBurnEnvelope, submitHolderBurn } from '../site/forge-holder-wallet.js';

const owner = `0x${'1'.repeat(40)}`, collection = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6', trainingSource = `0x${'2'.repeat(40)}`;
function fixture() {
  const selected = { owner, tokenId: '119', sourceTokenId: '812', chainId: 4663, preview: false };
  const release = { status: 'LIVE', chainId: 4663, productionBurnAuthorized: true, collection, trainingSource, feeCeilingWei: '10000000' };
  const review = { intentId: 'a'.repeat(64), action: 'APPROVE', state: { owner, sourceTokenId: '812', targetTokenId: '119' },
    expiresAt: Date.now() + 60000, maximumNetworkFeeWei: '1000000', transaction: { from: owner, to: collection, chainId: '0x1237',
      value: '0x0', nonce: '0x0', gas: '0x186a0', gasPrice: '0xa', data: encodePunkBurnApproval(trainingSource, '812') } };
  const envelope = { ok: true, mode: 'HOLDER_BURN', chainId: 4663, collection, owner, sourceTokenId: '812', targetTokenId: '119',
    record: { review, reviewHash: 'b'.repeat(64), revision: 0, status: 'PREPARED', reportedHash: null } };
  return { selected, release, envelope };
}
const request = body => new Request('https://goghpunks.xyz/api/v2/punks/119/forge/holder-burn', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('holder API derives owner from session and supports arbitrary distinct pair', async () => {
  let selected;
  const response = await handleHolderBurn(request({ operation: 'check', sourceTokenId: '812' }), { sessionPool: () => ({}),
    sessionReader: async () => ({ walletAddress: owner }), originCheck: () => {}, runtimeFactory: async value => { selected = value; return { check: async () => ({ canBurn: false }) }; } });
  assert.equal(response.status, 200); assert.equal(selected.owner, owner); assert.equal(selected.sourceTokenId, '812'); assert.equal(selected.targetTokenId, '119');
});
test('holder inspection accepts production and exact trusted preview origins, rejecting cross-origin requests before reads', async t => {
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = 'https://goghpunks.xyz';
  t.after(() => { if (previous === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previous; });
  let reads = 0;
  const deps = { sessionPool: () => ({}), sessionReader: async () => { reads++; return { walletAddress: owner }; },
    runtimeFactory: async () => ({ check: async () => ({ canBurn: false }) }) };
  for (const [host, origin, accepted] of [
    ['https://goghpunks.xyz', 'https://goghpunks.xyz', true],
    ['https://deploy-preview-123--gogh-punks.netlify.app', 'https://deploy-preview-123--gogh-punks.netlify.app', true],
    ['https://deploy-preview-123.preview.goghpunks.xyz', 'https://deploy-preview-123.preview.goghpunks.xyz', true],
    ['https://goghpunks.xyz', 'https://attacker.example', false],
    ['https://deploy-preview-123--gogh-punks.netlify.app', 'https://deploy-preview-124--gogh-punks.netlify.app', false],
    ['https://deploy-preview-123--gogh-punks.netlify.app', 'https://goghpunks.xyz', false],
    ['https://goghpunks.xyz', '', false],
  ]) {
    const before = reads, response = await handleHolderBurn(new Request(`${host}/api/v2/punks/119/forge/holder-burn`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'check', sourceTokenId: '812' }),
    }), deps);
    assert.equal(response.ok, accepted, `${host} with ${origin}`);
    assert.equal(reads - before, accepted ? 1 : 0);
  }
});
test('holder API rejects injected owner, calldata, evidence, duplicate source query and same source/target', async () => {
  const deps = { sessionPool: () => ({}), sessionReader: async () => ({ walletAddress: owner }), originCheck: () => {}, runtimeFactory: async () => { throw Error('MUST_NOT_CALL'); } };
  for (const field of ['owner', 'transaction', 'inventory', 'canBurn']) {
    const r = await handleHolderBurn(request({ operation: 'check', sourceTokenId: '812', [field]: true }), deps); assert.equal(r.status, 409);
  }
  assert.equal((await handleHolderBurn(request({ operation: 'check', sourceTokenId: '119' }), deps)).status, 409);
  const duplicate = new Request('https://goghpunks.xyz/api/v2/punks/119/forge/holder-burn?sourceTokenId=812&sourceTokenId=813');
  assert.equal((await handleHolderBurn(duplicate, deps)).status, 409);
});
test('public holder endpoint exposes no approval, burn, cancellation or recovery mutation', async () => {
  let calls = 0;
  const deps = { sessionPool: () => ({}), sessionReader: async () => ({ walletAddress: owner }), originCheck: () => {},
    runtimeFactory: async () => { calls++; throw Error('MUST_NOT_CALL'); } };
  for (const operation of ['prepare', 'claim', 'cancel', 'recover', 'burn', 'approve']) {
    assert.equal((await handleHolderBurn(request({ operation, sourceTokenId: '812' }), deps)).status, 409);
  }
  assert.equal(calls, 0);
});
test('public handler forces read-only eligibility even if an injected reader returns canBurn true', async () => {
  const response = await handleHolderBurn(request({ operation: 'check', sourceTokenId: '812' }), {
    sessionPool: () => ({}), sessionReader: async () => ({ walletAddress: owner }), originCheck: () => {},
    runtimeFactory: async () => ({ check: async () => ({ canBurn: true }) }),
  });
  assert.equal((await response.json()).source.canBurn, false);
});
test('holder wallet validates exact pair, recipient, calldata, fees, chain and absence of delegated authority', () => {
  const f = fixture(); validateHolderBurnEnvelope(f.envelope, f.selected, f.release);
  for (const mutate of [e => e.sourceTokenId = '813', e => e.targetTokenId = '93', e => e.record.review.transaction.from = trainingSource,
    e => e.record.review.transaction.data = encodePunkBurnApproval(trainingSource, '813'), e => e.record.review.transaction.gas = '0x1',
    e => e.record.review.transaction.authorizationList = [], e => e.record.review.transaction.chainId = '0x1']) {
    const e = structuredClone(f.envelope); mutate(e); assert.throws(() => validateHolderBurnEnvelope(e, f.selected, f.release));
  }
  assert.throws(() => validateHolderBurnEnvelope(f.envelope, f.selected, { ...f.release, status: 'TESTING' }));
});
test('holder claim is durable before the single wallet request and hash is saved before recovery', async () => {
  const f = fixture(), events = [], hash = `0x${'c'.repeat(64)}`;
  const provider = { request: async ({ method }) => method === 'eth_chainId' ? '0x1237' : method === 'eth_accounts' ? [owner] : (events.push('wallet'), hash) };
  const result = await submitHolderBurn({ ...f, provider, isCurrent: () => true, persistAttempt: async () => events.push('save'),
    claim: async () => { events.push('claim'); return { ...f.envelope, record: { ...f.envelope.record, status: 'WALLET_REQUESTED' }, transaction: f.envelope.record.review.transaction }; },
    persistHash: async () => events.push('hash') });
  assert.equal(result, hash); assert.deepEqual(events, ['save', 'claim', 'wallet', 'hash']);
});
test('lost claim, storage failure, owner switch or stale selection cannot submit a burn wallet action', async () => {
  for (const failure of ['claim', 'storage', 'owner', 'selection']) {
    const f = fixture(); let sends = 0, reads = 0, claimed = false;
    await assert.rejects(submitHolderBurn({ ...f, provider: { request: async ({ method }) => method === 'eth_chainId' ? '0x1237'
      : method === 'eth_accounts' ? [failure === 'owner' && ++reads > 1 ? trainingSource : owner] : (sends++, `0x${'c'.repeat(64)}`) },
    isCurrent: () => failure !== 'selection' || !claimed, persistAttempt: async () => { if (failure === 'storage') throw Error('STORAGE'); },
    claim: async () => { claimed = true; if (failure === 'claim') throw Error('LOST_ACK'); return { ...f.envelope,
      record: { ...f.envelope.record, status: 'WALLET_REQUESTED' }, transaction: f.envelope.record.review.transaction }; }, persistHash: async () => {} }));
    assert.equal(sends, 0);
  }
});
