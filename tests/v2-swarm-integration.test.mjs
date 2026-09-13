import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { keccak256 } from 'viem';
import deployment from '../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import { handleAgentRecovery } from '../netlify/functions/broker-v2-agent-account-recovery.mjs';
import { createAgentRecoveryController, agentRecoveryProxyRuntime, AGENT_RECOVERY_PINS as P } from '../site/punk-agent-recovery.js';
import { createAgentRecoveryPanel } from '../site/punk-agent-recovery-panel.js';
import { verifyCollectionHoldings } from '../netlify/functions/_shared/v2-collection-holdings.mjs';
import { createProgressionReader, createSkillToolGate, skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { loadResearchSkillCatalog } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { providerResult } from '../broker/src/v4/ai/provider.mjs';
import { draftPunkSkillFromConversation, activatePunkSkill } from '../broker/src/v4/punk-skill.mjs';
import { punkIdentityKey } from '../broker/src/v4/domain/index.mjs';
import { PostgresV2ExecutionStore } from '../broker/src/v4/postgres-execution-store.mjs';
import { CODE as code } from './fixtures/punk-agent-runtime.mjs';

const OWNER = `0x${'1'.repeat(40)}`, NEXT_OWNER = `0x${'2'.repeat(40)}`;
const ACCOUNT = `0x${'3'.repeat(40)}`, NFT = `0x${'4'.repeat(40)}`, V3 = `0x${'5'.repeat(40)}`;
const ZERO = `0x${'0'.repeat(40)}`, HASH = `0x${'a'.repeat(64)}`, TX = `0x${'b'.repeat(64)}`, SALT = `0x${'0'.repeat(64)}`;
const TIME = 1_789_308_000_000;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const addressWord = value => `0x${value.slice(2).padStart(64, '0')}`;
const quantity = value => `0x${BigInt(value).toString(16)}`;
const EMPTY = `0x${word(32)}${word(0)}`;

// The same pinned public runtime bytes drive core and cross-subsystem tests.
assert.equal(keccak256(code.implementation), P.implementationHash);
assert.equal(keccak256(code.registry), P.registryHash);
// Fixed nonsecret app configuration in this isolated Node test process.
process.env.SITE_URL = 'https://goghpunks.xyz';

// Minimal DOM, with actual panel and controller imports. Only platform I/O is mocked.
class Element {
  constructor(tag = '#text', text = '') {
    Object.assign(this, { tagName: tag, childNodes: [], attributes: {}, listeners: {}, value: '',
      checked: false, hidden: false, disabled: false, _text: text, classList: { add() {} } });
  }
  set textContent(value) { this.childNodes = []; this._text = String(value);
    if (this.tagName !== '#text' && value !== '') { this._text = ''; this.append(new Element('#text', String(value))); } }
  get textContent() { return this._text + this.childNodes.map(node => node.textContent).join(''); }
  get firstChild() { return this.childNodes[0]; }
  append(...nodes) { this.childNodes.push(...nodes); if (this.tagName === 'select' && !this.value) this.value = nodes[0]?.value ?? ''; }
  replaceChildren(...nodes) { this.childNodes = []; this._text = ''; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
  dispatch(name) { if (name === 'click' && (this.disabled || this.hidden)) return;
    for (const listener of this.listeners[name] ?? []) listener({ target: this }); }
  focus() {}
}
const walk = root => [root, ...root.childNodes.flatMap(walk)];
const action = (root, name) => walk(root).find(node => node.attributes['data-agent-recovery-action'] === name);
async function click(root, name) {
  const button = action(root, name); assert.ok(button); assert.equal(button.disabled, false, name); button.dispatch('click');
  for (let count = 0; count < 100 && root.attributes['aria-busy'] === 'true'; count++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(root.attributes['aria-busy'], 'false', `${name} settled`);
}

function recoveryFixture(t) {
  globalThis.document = { createElement: tag => new Element(tag) };
  const f = { owner: OWNER, assetOwner: ACCOUNT, sends: [], apiStatuses: [], head: 1000n, receipt: null,
    transaction: null, active: false, reserve: 50n, balancesUnavailable: false, loseWalletResponse: false };
  const stored = new Map();
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const journalKey = `gogh:agent-recovery:4663:${OWNER}:93`;
  f.state = () => JSON.parse(storage.getItem(journalKey) ?? 'null');
  const getCode = address => address.toLowerCase() === P.registry ? code.registry
    : address.toLowerCase() === P.implementation ? code.implementation
      : address.toLowerCase() === ACCOUNT ? agentRecoveryProxyRuntime('93', SALT) : '0x60006000';
  const session = () => ({ sessionKey: ZERO, authorizingOwner: OWNER, adapter: ZERO, venue: ZERO,
    adapterCodeHash: SALT, targetCollection: ZERO, validAfter: 0n, validUntil: 0n, maxMintsPerDay: 0n,
    remainingMints: 0n, mintsToday: 0n, day: 0n, generation: 1n, maxGasCostWei: 0n, minimumNativeReserveWei: f.reserve });
  const client = { getChainId: async () => 4663,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber ?? 1000n, hash: HASH, timestamp: BigInt(TIME / 1000) }),
    getCode: async ({ address }) => getCode(address), getBalance: async () => 10n ** 18n,
    getTransactionCount: async () => 7, getGasPrice: async () => 1000n,
    call: async ({ data }) => ({ data: data.startsWith('0xb94668c0') ? undefined : EMPTY }), estimateGas: async () => 50_000n,
    readContract: async ({ address, functionName }) => {
      const values = { account: ACCOUNT, accountSalt: SALT, owner: f.owner,
        ownerOf: address.toLowerCase() === NFT ? f.assetOwner : f.owner,
        entryPoint: deployment.entryPoint, adapterRegistry: deployment.reusedContracts.ArtAdapterRegistry,
        acquisitionNonce: 0n, sessionGeneration: 1n, entryPointDeposit: 1000n,
        autonomousSession: session(), isAutonomousSessionActive: f.active, supportsInterface: true, balanceOf: 1n };
      assert.ok(Object.hasOwn(values, functionName), functionName); return values[functionName];
    } };
  const provider = { request: async ({ method, params = [] }) => {
    if (method === 'eth_sendTransaction') {
      assert.equal(f.state().status, 'WALLET_REQUESTED', 'journal is durable before wallet I/O');
      f.sends.push(params[0]); f.transaction = { ...params[0], input: params[0].data, hash: TX };
      if (f.loseWalletResponse) throw Error('offline wallet response');
      return TX;
    }
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_accounts') return [OWNER];
    if (method === 'eth_getCode') return getCode(params[0]);
    if (method === 'eth_getBalance') return quantity(10n ** 18n);
    if (method === 'eth_getTransactionCount') return '0x7';
    if (method === 'eth_gasPrice') return '0x3e8';
    if (method === 'eth_estimateGas') return quantity(50_000);
    if (method === 'eth_getTransactionByHash') return f.transaction;
    if (method === 'eth_getTransactionReceipt') return f.receipt;
    if (method === 'eth_blockNumber') return quantity(f.head);
    if (method === 'eth_getBlockByNumber') return { number: '0x3e8', hash: HASH };
    if (method === 'eth_call') {
      const { to, data } = params[0];
      if (data === '0x8da5cb5b' || to === P.collection) return addressWord(f.owner);
      if (to === P.registry) return data === '0x6c74921e' ? SALT : addressWord(ACCOUNT);
      if (data === '0xfd5e81c7') return `0x${word(1000)}`;
      if (data === '0xb89d7299') return `0x${word(f.active ? 1 : 0)}`;
      if (data === '0x6753ffde') return `0x${'0'.repeat(64 * 14)}${word(f.reserve)}`;
      if (to === NFT) return data.startsWith('0x6352211e') ? addressWord(f.assetOwner) : `0x${word(1)}`;
      return data.startsWith('0xb94668c0') ? '0x' : EMPTY;
    }
    assert.fail(`Unexpected mock wallet method: ${method}`);
  } };
  let tail = Promise.resolve();
  const locks = { request: (_key, _options, callback) => { const pending = tail.then(callback); tail = pending.catch(() => {}); return pending; } };
  const fetchFunction = async (path, options) => {
    const request = new Request(`https://goghpunks.xyz${path}`, { ...options,
      headers: { ...options.headers, origin: 'https://goghpunks.xyz' } });
    const response = await handleAgentRecovery(request, { pool: {}, client, now: () => TIME,
      requireSession: async () => ({ walletAddress: OWNER }) });
    f.apiStatuses.push(response.status); return response;
  };
  f.createController = options => {
    const controller = createAgentRecoveryController({ ...options, storage, locks, fetchFunction, now: () => TIME });
    return { ...controller, submit: options => {
      assert.ok(Object.isFrozen(options.expectedReview), 'the panel submits the displayed immutable review');
      assert.ok(Object.isFrozen(options.expectedReview.intent));
      assert.ok(Object.isFrozen(options.expectedReview.transaction));
      return controller.submit(options);
    } };
  };
  f.otherTab = () => createAgentRecoveryController({ provider, owner: OWNER, tokenId: '93', isCurrent: () => true,
    storage, locks, fetchFunction, now: () => TIME });
  f.mount = () => {
    f.root = new Element('section');
    f.panel = createAgentRecoveryPanel({ root: f.root, getSelection: () => ({ owner: OWNER, tokenId: '93', chainId: 4663 }),
      getProvider: () => provider, ensureSession: async () => {}, now: () => TIME, schedule: () => 1, unschedule() {},
      createController: f.createController });
  };
  f.holdings = () => verifyCollectionHoldings({ candidates: [{ collection: NFT, tokenId: '7', custodyAccount: ACCOUNT, standard: 'ERC721' }],
    accounts: [V3, ACCOUNT], readOwner: async () => { if (f.balancesUnavailable) throw Error('offline'); return f.assetOwner; }, readDisplay: async () => null });
  f.confirmReceipt = () => {
    f.assetOwner = OWNER;
    f.receipt = { transactionHash: TX, blockNumber: '0x3e8', blockHash: HASH, status: '0x1', logs: [{ address: NFT,
      topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', addressWord(ACCOUNT), addressWord(OWNER), `0x${word(7)}`], data: '0x' }] };
  };
  f.mount(); t.after(() => f.panel.destroy()); return f;
}

async function prepareNft(f) {
  const holdings = await f.holdings(); assert.equal(holdings.holdings.length, 1);
  f.panel.openAsset(holdings.holdings[0]); await click(f.root, 'prepare');
  assert.equal(f.state().status, 'PREPARED');
  const checkbox = walk(f.root).find(node => node.type === 'checkbox'); checkbox.checked = true; checkbox.dispatch('change');
}

test('Agent NFT recovery integrates verified inventory, API review, immutable UI approval, 12 confirmations and refreshed custody', async t => {
  const f = recoveryFixture(t); await prepareNft(f);
  assert.match(f.root.textContent, new RegExp(ACCOUNT)); assert.match(f.root.textContent, new RegExp(OWNER));
  assert.equal(f.sends.length, 0); await click(f.root, 'submit');
  assert.equal(f.state().status, 'SUBMITTED'); assert.deepEqual(f.apiStatuses, [200, 200]);
  assert.equal(f.sends[0].from, OWNER); assert.equal(f.sends[0].to, ACCOUNT);
  f.confirmReceipt(); f.head = 1010n; await click(f.root, 'refresh');
  assert.equal(f.state().status, 'SUBMITTED', '11 confirmations do not complete recovery');
  f.head = 1011n; await click(f.root, 'refresh');
  assert.equal(f.state().status, 'CONFIRMED'); assert.match(f.root.textContent, /12 confirmations/);
  assert.deepEqual((await f.holdings()).holdings, [], 'delivered NFT no longer belongs to either Punk account');
  f.balancesUnavailable = true;
  assert.equal((await f.holdings()).ownershipChecksUnavailable, 1, 'receipt success never substitutes a current custody read');
  assert.equal(f.sends.length, 1);
});

test('ownership transfer between displayed recovery and confirmation is rejected by the real API without wallet I/O', async t => {
  const f = recoveryFixture(t); await prepareNft(f); f.owner = NEXT_OWNER;
  await click(f.root, 'submit');
  assert.deepEqual(f.apiStatuses, [200, 409]); assert.equal(f.sends.length, 0);
  assert.equal(f.state().status, 'PREPARED'); assert.equal(action(f.root, 'submit').disabled, true);
});

test('lost wallet response survives UI reload and only the original matching hash can settle recovery', async t => {
  const f = recoveryFixture(t); await prepareNft(f); f.loseWalletResponse = true; await click(f.root, 'submit');
  assert.equal(f.state().status, 'WALLET_REQUESTED'); f.panel.destroy(); f.mount();
  assert.equal(action(f.root, 'prepare').disabled, true); assert.equal(f.sends.length, 1);
  f.confirmReceipt(); f.head = 1011n;
  const hashInput = walk(f.root).find(node => node.attributes['data-agent-recovery-field'] === 'hash'); hashInput.value = TX;
  await click(f.root, 'recover'); assert.equal(f.state().status, 'CONFIRMED');
  assert.equal(f.sends.length, 1); assert.deepEqual((await f.holdings()).holdings, []);
});

test('another tab cannot substitute a new API recovery review underneath an already checked UI confirmation', async t => {
  const f = recoveryFixture(t); await prepareNft(f);
  const otherTab = f.otherTab(); await otherTab.cancelReview();
  await otherTab.prepare({ schema: 'GOGH_AGENT_RECOVERY_INTENT_V1', tokenId: '93', action: 'NATIVE',
    amountWei: '100', assetContract: null, assetTokenId: null });
  assert.match(f.root.textContent, /ERC-721 NFT/, 'the visible owner approval still describes the NFT');
  await click(f.root, 'submit');
  assert.match(f.root.textContent, /review changed/); assert.equal(f.sends.length, 0);
  assert.equal(f.state().review.intent.action, 'NATIVE');
  assert.equal(action(f.root, 'submit').disabled, true, 'the changed review requires a fresh owner confirmation');
});

test('pinned progression survives an owner transfer while tool and conversational authority require the new owner', async () => {
  const pack = { ...(await loadResearchSkillCatalog()).find(item => item.slug === 'rarity-eye'), approved: true, status: 'READY' };
  const registry = NFT, progression = ACCOUNT, key = skillKey(pack.manifest.skillId, pack.manifest.version);
  let owner = OWNER, toolCalls = 0;
  const definition = { manifestHash: pack.manifestHash, instructionHash: pack.instructionHash,
    capabilities: 8n, status: 4, disabled: false, deprecated: false };
  const client = { getChainId: async () => 4663, getCode: async () => '0x6000',
    getBlock: async () => ({ number: 1000n, hash: HASH, timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
    readContract: async ({ functionName }) => {
      const values = { collection: P.collection, registry, ownerOf: owner, unlockedSlots: 1,
        effectiveCapabilities: 8n, equipped: key, learnedLevel: 2, definition, available: true };
      assert.ok(Object.hasOwn(values, functionName)); return values[functionName];
    } };
  const readState = createProgressionReader({ client, chainId: 4663, collection: P.collection, registry, progression,
    registryCodeHash: keccak256('0x6000'), progressionCodeHash: keccak256('0x6000') });
  const gate = createSkillToolGate({ readState, packages: [pack], implementations: {
    rank_trait_sample: async args => { toolCalls++; return { owner: args.owner, sampleSize: 3 }; },
    sign_transaction: async () => assert.fail('AI must never reach a wallet implementation'),
  } });
  const before = await readState('93'), context = await gate.resolve({ tokenId: '93', owner });
  assert.equal(context.walletAuthority, 'NONE'); assert.equal(context.requiresSeparateEconomicAuthorization, true);
  assert.deepEqual(await gate.call({ tokenId: '93', owner, name: 'rank_trait_sample' }), { owner, sampleSize: 3 });
  const draft = draftPunkSkillFromConversation({ message: 'Teach my punk to compare collection traits', punkTokenId: '93',
    expectedOwner: OWNER, punkWallet: V3, now: new Date(TIME) });
  owner = NEXT_OWNER;
  const after = await readState('93'); assert.deepEqual(after.equipped, before.equipped); assert.equal(after.mask, before.mask);
  const identity = state => ({ chainId: state.chainId, collection: state.collection, tokenId: state.tokenId });
  assert.equal(punkIdentityKey(identity(before)), punkIdentityKey(identity(after)));
  await assert.rejects(gate.call({ tokenId: '93', owner: OWNER, name: 'rank_trait_sample' }), /OWNER_CHANGED/);
  assert.throws(() => activatePunkSkill(draft, { owner, punkWallet: V3, punkTokenId: '93' }), /current owner/);
  assert.deepEqual(await gate.call({ tokenId: '93', owner, name: 'rank_trait_sample' }), { owner, sampleSize: 3 });
  const model = providerResult({ provider: 'OFFLINE', modelId: 'fixture', task: 'CHAT', structured: true,
    text: JSON.stringify({ name: 'sign_transaction', arguments: { to: OWNER, value: '1' } }), latencyMs: 1 });
  await assert.rejects(gate.call({ tokenId: '93', owner, ...model.value }), /SKILL_TOOL_DENIED/);
  assert.equal(toolCalls, 2);
});

test('PGlite: migrated execution store binds one 90-second approval expiry and never renews replayed approval', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const database = new PGlite();
  try {
    const migration = await readFile(new URL('../netlify/database/migrations/20260906010000_create_art_broker_v2.sql', import.meta.url), 'utf8');
    const table = name => {
      const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`), end = migration.indexOf('\n);', start);
      assert.ok(start >= 0 && end > start, name); return migration.slice(start, end + 4);
    };
    await database.exec(['broker_v2_opportunities', 'broker_v2_execution_attempts', 'broker_v2_activity'].map(table).join('\n'));
    await database.exec(await readFile(new URL('../netlify/database/migrations/20260906083000_harden_v2_owner_assisted_receipts.sql', import.meta.url), 'utf8'));
    await database.query(`INSERT INTO broker_v2_opportunities
      (opportunity_id,dedupe_key,chain_id,collection_contract,mint_contract,adapter_address,mint_stage,normalized,screening_status,simulation_status,risk_score,first_seen_at)
      VALUES ('integration:mint', $1, 4663, $2, $2, $3, 'PUBLIC', '{}', 'PASSED', 'PASSED', 0, clock_timestamp())`, ['c'.repeat(64), NFT, ACCOUNT]);
    const store = new PostgresV2ExecutionStore(database);
    const input = { idempotencyKey: 'd'.repeat(64), intent: { punkTokenId: '93', punkWallet: V3, operatingMode: 'ASSIST' },
      strategyVersion: 1, opportunity: { opportunityId: 'integration:mint' }, strategyHash: HASH, accountNonce: '7', owner: OWNER };
    const first = await store.reserve(input); assert.equal(first.replayed, false);
    await assert.rejects(store.transition(input.idempotencyKey, 'OWNER_APPROVAL_PENDING'), /transition was rejected/);
    await store.transition(input.idempotencyKey, 'SIMULATED');
    // Prove that the deployed additive constraint is live, not just read as text.
    await assert.rejects(database.query("UPDATE broker_v2_execution_attempts SET state='OWNER_APPROVAL_PENDING' WHERE idempotency_key=$1", [input.idempotencyKey]),
      error => error.code === '23514' && error.constraint === 'broker_v2_execution_attempts_approval_expiry');
    const before = (await database.query('SELECT clock_timestamp() AS now')).rows[0].now;
    await store.transition(input.idempotencyKey, 'OWNER_APPROVAL_PENDING');
    const row = (await database.query('SELECT *, clock_timestamp() AS now FROM broker_v2_execution_attempts')).rows[0];
    assert.equal(row.state, 'OWNER_APPROVAL_PENDING');
    assert.ok(+new Date(row.approval_expires_at) >= +new Date(before) + 90_000);
    assert.ok(+new Date(row.approval_expires_at) <= +new Date(row.now) + 90_000);
    await assert.rejects(store.transition(input.idempotencyKey, 'OWNER_APPROVAL_PENDING'), /transition was rejected/);
    const replay = await store.reserve(input); assert.equal(replay.replayed, true);
    assert.equal(replay.result.attemptId, first.attemptId); assert.equal(replay.result.submitted, false);
    const final = (await database.query('SELECT state, approval_expires_at, transaction_hash FROM broker_v2_execution_attempts')).rows;
    assert.equal(final.length, 1); assert.equal(final[0].transaction_hash, null);
    assert.equal(+new Date(final[0].approval_expires_at), +new Date(row.approval_expires_at));
  } finally { await database.close(); }
});
