import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Dedicated independent review fixtures. All provider, wallet and chain reads are
// in memory; candidate overrides let a reviewer inspect isolated worktrees.
const source = (name, relative) => process.env[name]
  ? pathToFileURL(path.join(process.env[name], relative)).href
  : new URL(`../${relative}`, import.meta.url).href;
const wallet = await import(source('GOGH_SECURITY_WALLET_ROOT', 'site/punk-agent-gas-funding-journal.js'));
const { OpenAIArtBrokerProvider } = await import(source('GOGH_SECURITY_AI_ROOT', 'broker/src/v4/ai/openai.mjs'));
const { createDatabaseBackedGoghIntelligence } = await import(source('GOGH_SECURITY_AI_ROOT', 'netlify/functions/_shared/v2-ai-runtime.mjs'));
const { assertTrainingOwnerContinuity } = await import(source('GOGH_SECURITY_FORGE_ROOT', 'broker/src/v4/skill-forge/training-state.mjs'));
const owner = `0x${'11'.repeat(20)}`, to = `0x${'22'.repeat(20)}`;
const hash = `0x${'aa'.repeat(32)}`, blockHash = `0x${'bb'.repeat(32)}`;
const shown = { owner, tokenId: '93', transaction: { chainId: '0x1237', nonce: '0x7', from: owner, to, value: '0x10', data: '0x' } };
function journalWorld() {
  const values = new Map(), calls = [];
  let selected = true;
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  let tail = Promise.resolve();
  const locks = { request: (_key, _mode, fn) => { const p = tail.then(fn); tail = p.catch(() => {}); return p; } };
  const tx = { ...shown.transaction, input: '0x', hash };
  const receipt = { transactionHash: hash, status: '0x1', blockNumber: '0x100', blockHash };
  const provider = { request: async ({ method }) => {
    calls.push(method);
    if (method === 'eth_sendTransaction') throw Error('Lost wallet result');
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_accounts') return [owner];
    if (method === 'eth_getTransactionByHash') return tx;
    if (method === 'eth_getTransactionReceipt') return receipt;
    if (method === 'eth_getBlockByNumber') return { number: '0x100', hash: blockHash };
    if (method === 'eth_blockNumber') return '0x10b';
    throw Error('Unexpected mock method');
  } };
  const options = { storage, locks, isCurrent: () => selected, freshReview: async p => p };
  return { provider, options, calls, tx, receipt, values, changeSelection: () => selected = false };
}
async function pending(w) {
  await assert.rejects(wallet.submitJournaledAgentGasFunding(w.provider, shown, w.options), { code: 'AGENT_GAS_WALLET_RESULT_UNKNOWN' });
  assert.equal(wallet.getAgentGasFundingState(owner, '93', w.options).status, 'WALLET_REQUESTED');
}

test('independent: corrupt durable journal blocks any fresh wallet request', async () => {
  const w = journalWorld(); await pending(w);
  const key = [...w.values.keys()][0]; w.values.set(key, '{broken json');
  await assert.rejects(wallet.submitJournaledAgentGasFunding(w.provider, shown, w.options), { code: 'AGENT_GAS_JOURNAL_INVALID' });
  assert.equal(w.calls.filter(x => x === 'eth_sendTransaction').length, 1);
});

test('independent: uncertain hash survives a receipt-read outage and cannot be replaced', async () => {
  const w = journalWorld(); await pending(w);
  const original = w.provider.request;
  w.provider.request = async q => q.method === 'eth_getTransactionReceipt' ? Promise.reject(Error('offline')) : original(q);
  await assert.rejects(wallet.recoverAgentGasFunding(w.provider, owner, '93', hash, w.options), { code: 'AGENT_GAS_READ_UNAVAILABLE' });
  assert.equal(wallet.getAgentGasFundingState(owner, '93', w.options).transactionHash, hash);
  await assert.rejects(wallet.recoverAgentGasFunding(w.provider, owner, '93', blockHash, w.options), { code: 'AGENT_GAS_HASH_MISMATCH' });
  assert.equal(w.calls.filter(x => x === 'eth_sendTransaction').length, 1);
});

for (const [name, mutate] of [
  ['wrong transaction chain', w => w.tx.chainId = '0x1'],
  ['noncanonical nonce', w => w.tx.nonce = '0x07'],
  ['different input', w => w.tx.input = '0x00'],
  ['wrong receipt hash', w => w.receipt.transactionHash = blockHash],
  ['unknown receipt status', w => w.receipt.status = '0x2'],
  ['receipt block ahead of head', w => w.receipt.blockNumber = '0x200'],
]) test(`independent: ${name} cannot release a saved funding attempt`, async () => {
  const w = journalWorld(); await pending(w); mutate(w);
  await assert.rejects(wallet.recoverAgentGasFunding(w.provider, owner, '93', hash, w.options));
  assert.ok(['WALLET_REQUESTED', 'SUBMITTED'].includes(wallet.getAgentGasFundingState(owner, '93', w.options).status));
  await assert.rejects(wallet.submitJournaledAgentGasFunding(w.provider, shown, w.options), { code: 'AGENT_GAS_FUNDING_PENDING' });
  assert.equal(w.calls.filter(x => x === 'eth_sendTransaction').length, 1);
});

test('independent: selection switch during confirmation cannot create a terminal funding record', async () => {
  const w = journalWorld(); await pending(w);
  const original = w.provider.request;
  w.provider.request = async q => { const result = await original(q); if (q.method === 'eth_blockNumber') w.changeSelection(); return result; };
  await assert.rejects(wallet.recoverAgentGasFunding(w.provider, owner, '93', hash, w.options), { code: 'AGENT_GAS_SELECTION_CHANGED' });
  assert.equal(wallet.getAgentGasFundingState(owner, '93', w.options).status, 'SUBMITTED');
  assert.equal(w.calls.filter(x => x === 'eth_sendTransaction').length, 1);
});

const gateway = 'https://gateway.example/.netlify/ai';
for (const bad of [
  'https://evil.example/.netlify/ai/v1',
  'https://gateway.example:444/.netlify/ai/v1',
  'https://gateway.example/.netlify/ai/v1?secret=x',
  'https://gateway.example/.netlify/ai/%2e%2e/ai/v1',
  'https://gateway.example/.netlify/ai/v1#part',
]) test(`independent: OpenAI refuses unbound base ${bad}`, () => {
  assert.throws(() => new OpenAIArtBrokerProvider({ modelId: 'fixed-model', environment: {
    OPENAI_API_KEY: 'fake-test-credential', NETLIFY_AI_GATEWAY_URL: gateway, OPENAI_BASE_URL: bad,
  }, fetchImpl: () => { throw Error('Must never reach network'); } }));
});

test('independent: provider endpoint option cannot redirect a managed credential', () => {
  assert.throws(() => new OpenAIArtBrokerProvider({ modelId: 'fixed-model', endpoint: 'https://evil.example/v1/responses', environment: {
    OPENAI_API_KEY: 'fake-test-credential', NETLIFY_AI_GATEWAY_URL: gateway, OPENAI_BASE_URL: `${gateway}/v1`,
  } }));
});

test('independent: failed reservation COMMIT cannot start any provider generation', async () => {
  let calls = 0, released = false;
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({ query: async text => {
      if (text === 'COMMIT') throw Error('Commit uncertain');
      if (text.includes('COUNT(*)')) return { rows: [{ owner_requests: 0, punk_requests: 0 }] };
      if (text.includes('RETURNING usage_id')) return { rows: [{ usage_id: '11111111-1111-4111-8111-111111111111' }] };
      return { rows: [] };
    }, release: () => released = true }),
  };
  const runtime = createDatabaseBackedGoghIntelligence(pool, { GOGH_OPENAI_MODEL: 'fixture', OPENAI_API_KEY: 'fake-test-credential' },
    async () => { calls++; throw Error('Provider must not start'); });
  await assert.rejects(runtime.router.run('CHAT', { prompt: 'fixture' }, { ownerFingerprint: owner, punkTokenId: '93', preference: 'OPENAI' }));
  assert.equal(calls, 0); assert.equal(released, true);
});

function continuityFixture() {
  const anchor = { number: '100', hash: blockHash, timestamp: '1700000000' };
  const delegate = `0x${'33'.repeat(20)}`, designation = `0xef0100${delegate.slice(2)}`;
  let latestHash = blockHash;
  const client = {
    getChainId: async () => 4663,
    getBlock: async ({ blockNumber } = {}) => ({ number: blockNumber ?? 101n, hash: blockNumber === 101n ? latestHash : blockHash, timestamp: 1700000000n }),
    getCode: async ({ address }) => address === owner ? designation : '0x60006000',
    readContract: async () => owner,
    getLogs: async () => [],
  };
  return { client, owner, tokenId: '93', release: { chainId: 4663, collection: to }, anchor, now: () => 1700000002000,
    replaceHead: () => latestHash = hash };
}

test('independent: delegated owner support does not bypass transfer-history rejection', async () => {
  const f = continuityFixture();
  f.client.getLogs = async () => [{ args: { from: owner, to: owner, tokenId: 93n } }];
  await assert.rejects(assertTrainingOwnerContinuity(f), /FORGE_TRAINING_STATE_UNVERIFIED/);
});

test('independent: delegated owner support rejects a reorganized current anchor after reads', async () => {
  const f = continuityFixture();
  f.client.getLogs = async () => { f.replaceHead(); return []; };
  await assert.rejects(assertTrainingOwnerContinuity(f), /FORGE_TRAINING_STATE_UNVERIFIED/);
});

// The inference preference must remain a real boundary all the way from the UI.
// A temporary availability read failure is not consent to a different provider.
test('independent: saved explicit provider remains pinned before, during and after unavailable configuration', async () => {
  const { mountBrokerPreferences } = await import(source('GOGH_SECURITY_UI_ROOT', 'site/broker-v2-preferences.js'));
  let settle;
  const response = new Promise((_, reject) => { settle = reject; });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({}) } });
  try {
    const select = { addEventListener() {}, replaceChildren(...options) { this.options = options; } };
    const controls = mountBrokerPreferences({
      select, status: {},
      welcome: { querySelector() { return null; }, querySelectorAll() { return []; } },
      getContext: () => ({ owner, chainId: 4663, tokenId: '93' }),
      storage: { getItem: () => JSON.stringify({ provider: 'ANTHROPIC', welcomed: false }) },
      fetchImpl: () => response, navigate() {},
    });
    assert.equal(controls.preference(), 'ANTHROPIC');
    controls.refresh();
    assert.equal(controls.preference(), 'ANTHROPIC');
    assert.equal(select.value, 'ANTHROPIC');
    settle(Error('Availability offline'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(controls.preference(), 'ANTHROPIC');
    assert.equal(select.value, 'ANTHROPIC');
    assert.match(select.options.find(option => option.value === 'ANTHROPIC').textContent, /unavailable/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  }
});
