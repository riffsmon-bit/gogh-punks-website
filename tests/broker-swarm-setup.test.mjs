import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSwarmSetup } from '../site/broker-swarm-setup.js';
import { keccak256Hex } from '../site/keccak256.js';
import { createSetupFixture } from '../scripts/test-swarm-setup-browser.mjs';

class Node {
  constructor(tag, ownerDocument) { this.tag = tag; this.ownerDocument = ownerDocument; this.children = []; this.attrs = {};
    this.listeners = {}; this.classList = { add() {}, toggle() {} }; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this._text = ''; }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { for (const child of children) { child.parentNode = this; child.parentElement = this; this.children.push(child);
    if (this.tag === 'select' && !this.value && child.tag === 'option') this.value = child.value; } }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  querySelectorAll(selector) { return walk(this).slice(1).filter(node => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  scrollIntoView() {}
  focus() {}
  click() { if (!this.disabled) { if (this.type === 'checkbox') { this.checked = !this.checked; this.listeners.change?.(); }
    this.listeners.click?.({ target: this }); } }
}
const walk = node => [node, ...node.children.flatMap(walk)];
function matches(node, selector) {
  const parsed = selector.match(/^([a-z]+)?(?:\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\])?$/);
  if (!parsed) throw Error('Unsupported fixture selector: ' + selector);
  return (!parsed[1] || node.tag === parsed[1]) && (!parsed[2] || parsed[3] === undefined
    ? !parsed[2] || Object.hasOwn(node.attrs, parsed[2]) : String(node.attrs[parsed[2]] ?? node[parsed[2]]) === parsed[3]);
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(done => setTimeout(done, 0)); };
function fixture() {
  const doc = { createElement: tag => new Node(tag, doc) }, root = new Node('main', doc);
  const f = createSetupFixture({ root, mountSwarmSetup, keccak256Hex });
  const node = name => root.querySelector('[data-' + name + ']');
  return { ...f, root, node, get controller() { return f.controller; },
    async click(name) { const value = node(name); assert.ok(value, name + ' exists'); assert.equal(value.disabled, false, name + ' enabled'); value.click(); await flush(); },
    async textClick(text) { const button = walk(root).find(n => n.tag === 'button' && n.textContent === text);
      assert.ok(button, text + ' exists'); assert.equal(button.disabled, false, text + ' enabled'); button.click(); await flush(); },
    async plan({ budget = '0.002' } = {}) { const form = node('swarm-setup-plan-form');
      form.querySelectorAll('input[type=checkbox]').forEach(input => { input.checked = true; });
      form.querySelector('[name=fundingBudgetEth]').value = budget;
      form.listeners.submit({ preventDefault() {} }); await flush(); },
    async approve(prefix) { node(prefix + '-consent').click(); await this.click(prefix + '-confirm');
      assert.equal(node(prefix + '-recovery').hidden, false); await this.click(prefix + '-recover'); },
    async wallets() { await this.click('swarm-setup-check-wallets'); },
    async existingGasMissions() { f.state.created = new Set(['93', '94']); await this.plan({ budget: '' }); await this.wallets();
      await this.click('swarm-setup-to-funding'); await this.click('swarm-setup-to-missions'); },
  };
}

test('planning is passive and preserves selected Punks, exact budget and one review before wallet operations', async () => {
  const f = fixture(); assert.deepEqual(f.state.calls, []); assert.deepEqual(f.state.sends, []);
  await f.plan(); assert.deepEqual(f.state.calls, []); assert.deepEqual(f.state.sends, []);
  assert.deepEqual(f.savedPlan().tokenIds, ['93', '94']); assert.equal(f.savedPlan().options.fundingBudgetEth, '0.002');
  assert.match(f.node('swarm-setup-summary').textContent, /0.002 ETH total/);
  assert.ok(f.node('swarm-setup-check-wallets')); assert.equal(f.node('swarm-setup-wallet').hidden, true);
});

test('a failed wallet check identifies the Punk and reason, preserves the plan and can be retried without transactions', async () => {
  const f = fixture(); await f.plan(); const saved = structuredClone(f.savedPlan());
  f.state.readErrors = new Map([['94', Object.assign(Error('The latest chain block is outside the freshness window.'), { code: 'AGENT_CREATION_STALE_CHAIN' })]]);
  await f.wallets();
  assert.match(f.node('swarm-setup-status').textContent, /Punk #94:.*freshness.*AGENT_CREATION_STALE_CHAIN/);
  assert.match(f.node('swarm-setup-content').textContent, /Punk #93: Agent wallet exists/);
  assert.match(f.node('swarm-setup-content').textContent, /Punk #94: Wallet not yet verified/);
  assert.deepEqual(f.savedPlan(), saved); assert.deepEqual(f.state.sends, []);
  assert.equal(f.node('swarm-setup-wallet').hidden, true);
  f.state.readErrors.clear(); await f.wallets();
  assert.match(f.node('agent-wallet-creation-title').textContent, /#94/);
  assert.deepEqual(f.savedPlan(), saved); assert.deepEqual(f.state.sends, []);
});

test('a roster refresh preserves the holder’s selected Punks and unfinished shared mission options', async () => {
  const f = fixture(), form = f.node('swarm-setup-plan-form');
  form.querySelectorAll('input[type=checkbox]')[0].checked = true;
  form.querySelector('[name=mode]').value = 'DIRECTED';
  form.querySelector('[name=target]').value = '0x' + '7'.repeat(40);
  form.querySelector('[name=fundingBudgetEth]').value = '0.003';
  form.querySelector('[name=daily]').value = '3';
  f.state.punks.push('95'); f.refresh(); await flush();
  const updated = f.node('swarm-setup-plan-form');
  assert.deepEqual(updated.querySelectorAll('input[type=checkbox]').filter(input => input.checked).map(input => input.value), ['93']);
  assert.equal(updated.querySelector('[name=mode]').value, 'DIRECTED');
  assert.equal(updated.querySelector('[name=target]').value, '0x' + '7'.repeat(40));
  assert.equal(updated.querySelector('[name=target]').parentElement.hidden, false);
  assert.equal(updated.querySelector('[name=fundingBudgetEth]').value, '0.003');
  assert.equal(updated.querySelector('[name=daily]').value, '3');
  assert.deepEqual(f.state.calls, []); assert.deepEqual(f.state.sends, []);
});

test('missing Agent wallet creation uses the queued Punk, skips created Punks and requires its own confirmation', async () => {
  const f = fixture(); assert.equal(f.state.selected, '349'); await f.plan(); await f.wallets();
  assert.match(f.node('agent-wallet-creation-title').textContent, /#94/);
  assert.equal(f.node('agent-wallet-creation-prepare').disabled, false);
  await f.click('agent-wallet-creation-prepare'); assert.deepEqual(f.state.sends, []);
  assert.equal(f.node('agent-wallet-creation-confirm').disabled, true);
  await f.approve('agent-wallet-creation'); assert.deepEqual(f.state.sends, [['CREATE_AGENT', '94']]);
  assert.equal(f.node('swarm-setup-to-funding').disabled, false);
  assert.equal(f.state.calls.some(call => call[0] === 'prepare-account' && call[1] !== '94'), false);
});

test('create vault, deposit and one exact two-Punk funding batch remain separate reviews without duplicate funding', async () => {
  const f = fixture(); f.state.created.add('94'); await f.plan(); await f.wallets(); await f.click('swarm-setup-to-funding');
  await f.click('swarm-wallet-create'); assert.deepEqual(f.state.sends, []); await f.approve('swarm-wallet');
  assert.equal(f.node('swarm-wallet-deposit-amount').value, '0.002');
  await f.click('swarm-wallet-deposit'); assert.equal(f.state.sends.length, 1); await f.approve('swarm-wallet');
  await f.click('swarm-wallet-batch'); assert.equal(f.state.sends.length, 2);
  assert.ok(f.savedPlan().funding.attempt); assert.equal(f.savedPlan().funding.status, 'REVIEW');
  await f.approve('swarm-wallet'); assert.equal(f.state.balance, 0n);
  assert.deepEqual(f.state.sends, [['CREATE', '0'], ['DEPOSIT', '2000000000000000'], ['BATCH', [
    { tokenId: '93', amountWei: '1000000000000000' }, { tokenId: '94', amountWei: '1000000000000000' },
  ]]]);
  assert.equal(f.node('swarm-setup-to-missions').disabled, false); assert.equal(f.node('swarm-setup-wallet').hidden, true);
  await f.click('swarm-setup-to-missions'); assert.equal(f.state.calls.some(call => call[0] === 'mission-review'), false);
  await f.click('swarm-setup-next-mission'); assert.deepEqual(f.state.calls.filter(call => call[0] === 'mission-review'), [['mission-review', '93']]);
  f.approveMission('93'); await flush(); assert.equal(f.state.calls.filter(call => call[0] === 'mission-review').length, 1);
  await f.click('swarm-setup-next-mission'); f.approveMission('94'); await flush();
  assert.match(f.root.textContent, /Swarm setup is finished/); assert.equal(f.state.sends.filter(call => call[0] === 'BATCH').length, 1);
});

test('existing gas skips all funding requests but mission reviews remain individual and explicit', async () => {
  const f = fixture(); await f.existingGasMissions(); assert.deepEqual(f.state.sends, []);
  assert.equal(f.state.calls.some(call => call[0] === 'read-vault'), false);
  assert.equal(f.state.calls.some(call => call[0] === 'mission-review'), false);
  assert.match(f.root.textContent, /Use existing Agent gas/);
  await f.click('swarm-setup-next-mission'); assert.equal(f.savedPlan().missions[0].status, 'REVIEW');
  assert.deepEqual(f.state.sends, []);
});

test('reload recovers the one submitted funding batch and never offers a second batch request', async () => {
  const f = fixture(); f.state.created.add('94'); f.state.vaultCreated = true; f.state.balance = 2000000000000000n;
  await f.plan(); await f.wallets(); await f.click('swarm-setup-to-funding'); await f.click('swarm-wallet-batch');
  f.node('swarm-wallet-consent').click(); await f.click('swarm-wallet-confirm');
  assert.equal(f.state.sends.length, 1); assert.equal(f.savedPlan().funding.status, 'SUBMITTED');
  const before = f.state.calls.length; f.remount(); await flush();
  assert.equal(f.state.calls.length, before); assert.equal(f.node('swarm-wallet-batch').disabled, true);
  assert.equal(f.node('swarm-wallet-recovery').hidden, false); assert.equal(f.node('swarm-wallet-review').hidden, true);
  await f.click('swarm-wallet-recover');
  assert.equal(f.state.sends.length, 1); assert.equal(f.state.balance, 0n);
  assert.equal(f.node('swarm-setup-to-missions').disabled, false);
});

test('wallet switch during account reads discards the previous plan without opening any wallet', async () => {
  const f = fixture(); await f.plan(); f.state.holdRead = '93';
  f.node('swarm-setup-check-wallets').click(); await flush(); assert.equal(typeof f.state.readRelease, 'function');
  f.state.owner = '0x' + '5'.repeat(40); f.refresh(); f.state.readRelease(); await flush();
  assert.ok(f.node('swarm-setup-plan-form')); assert.deepEqual(f.state.sends, []);
  assert.equal(f.node('swarm-setup-creation').hidden, true); assert.equal(f.savedPlan(), null);
});

test('full local storage blocks plan creation before account reads or wallet requests', async () => {
  const f = fixture(); f.state.storageFailure = true; await f.plan();
  assert.match(f.node('swarm-setup-status').textContent, /storage is full/);
  assert.deepEqual(f.state.calls, []); assert.deepEqual(f.state.sends, []); assert.equal(f.savedPlan(), null);
});

test('reload preserves a submitted mission for receipt recovery without reopening approval or reviewing the next Punk', async () => {
  const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
  const hash = '0x' + 'a'.repeat(64), sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const identity = { tokenId: '93', intentHash: hash };
  f.controller.missionPrepared(identity, { sessionId, setupArtifactHash: hash }); f.controller.missionSubmitted(identity, hash);
  f.remount(); await flush();
  assert.equal(f.node('swarm-setup-next-mission').disabled, true);
  assert.equal(f.node('swarm-setup-mission-hash').value, hash);
  await f.textClick('RECOVER MISSION CONFIRMATION');
  assert.equal(f.state.calls.filter(call => call[0] === 'mission-review').length, 1);
  assert.deepEqual(f.state.calls.find(call => call[0] === 'mission-recover')[1], {
    tokenId: '93', sessionId, setupArtifactHash: hash, transactionHash: hash, authorizationTransactionHash: hash });
  assert.equal(f.savedPlan().missions[0].status, 'AUTHORIZED'); assert.equal(f.node('swarm-setup-next-mission').disabled, false);
  assert.deepEqual(f.state.sends, []);
});

test('a submitted mission that ended while the page was closed is settled without reauthorizing it', async () => {
  for (const status of ['COMPLETED', 'CANCELLED', 'REVOKED', 'EXPIRED', 'INACTIVE', 'PAUSED']) {
    const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
    const hash = '0x' + 'a'.repeat(64), sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    f.controller.missionPrepared({ tokenId: '93', intentHash: hash }, { sessionId, setupArtifactHash: hash });
    f.controller.missionSubmitted({ tokenId: '93', intentHash: hash }, hash); f.remount(); await flush();
    f.state.missionStatuses.set('93', { runtime: { sessionActive: false }, mission: { status, sessionId, authorizationTransactionHash: hash } });
    await f.textClick('CHECK MISSION / SIGN IN');
    assert.equal(f.savedPlan().missions[0].status, 'SETTLED');
    assert.match(f.root.textContent, /Original mission ended/); assert.equal(f.node('swarm-setup-next-mission').disabled, false);
    assert.equal(f.state.calls.filter(call => call[0] === 'mission-review').length, 1); assert.deepEqual(f.state.sends, []);
  }
});

test('an unknown mission wallet result survives reload and prevents new mission requests', async () => {
  const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
  const hash = '0x' + 'a'.repeat(64), sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  f.controller.missionPrepared({ tokenId: '93', intentHash: hash }, { sessionId, setupArtifactHash: hash });
  f.remount(); await flush();
  assert.equal(f.node('swarm-setup-mission-hash').value, '');
  assert.equal(f.node('swarm-setup-next-mission').disabled, true);
  await f.textClick('CHECK MISSION / SIGN IN');
  assert.equal(f.savedPlan().missions[0].status, 'CHECK_STATUS');
  assert.equal(f.state.calls.filter(call => call[0] === 'mission-review').length, 1);
  assert.equal(f.node('swarm-setup-next-mission').disabled, true); assert.deepEqual(f.state.sends, []);
});

test('failure to save a mission attempt throws before its wallet request can be opened', async () => {
  const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
  f.state.storageFailure = true;
  assert.throws(() => f.controller.missionPrepared({ tokenId: '93', intentHash: '0x' + 'a'.repeat(64) },
    { sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', setupArtifactHash: '0x' + 'a'.repeat(64) }), /storage is full/);
  assert.equal(f.savedPlan().missions[0].status, 'REVIEW'); assert.deepEqual(f.state.sends, []);
});

test('an active existing mission is labelled separately and its rules are retained', async () => {
  const f = fixture(); await f.existingGasMissions();
  f.state.missionStatuses.set('93', { runtime: { sessionActive: true }, mission: { status: 'ACTIVE', sessionId: 'old' } });
  await f.textClick('CHECK MISSION / SIGN IN');
  assert.equal(f.savedPlan().missions[0].status, 'EXISTING'); assert.match(f.root.textContent, /Already active/);
  assert.equal(f.state.calls.some(call => call[0] === 'mission-review'), false); assert.deepEqual(f.state.sends, []);
});

test('mission recovery refuses stale status, wrong chain and mismatched current account or ownership', async () => {
  const hash = '0x' + 'a'.repeat(64), sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const wrongAddress = '0x' + '5'.repeat(40);
  const cases = [
    ['wrong chain', { chainId: 1 }],
    ['stale status', { receivedAt: Date.now() - 100_000 }],
    ['future status', { receivedAt: Date.now() + 600_000 }],
    ['wrong response owner', { owner: wrongAddress }],
    ['wrong response Punk', { tokenId: '94' }],
    ['wrong runtime owner', { runtime: { owner: wrongAddress } }],
    ['missing current account', { runtime: { account: null } }],
    ['wallet not created', { runtime: { accountCreated: false } }],
    ['wrong mission account', { mission: { account: wrongAddress } }],
    ['wrong mission owner', { mission: { intent: { expectedOwner: wrongAddress } } }],
    ['wrong mission Punk', { mission: { intent: { punkTokenId: '94' } } }],
    ['expired active mission', { mission: { validUntil: new Date(Date.now() - 1000).toISOString() } }],
    ['invalid mission start', { mission: { validAfter: 'invalid' } }],
    ['reversed mission window', { mission: { validAfter: new Date(Date.now() + 7_200_000).toISOString() } }],
    ['wrong authorization hash', { mission: { authorizationTransactionHash: '0x' + 'b'.repeat(64) } }],
    ['wrong session', { mission: { sessionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' } }],
    ['database not ready', { readiness: { databaseReady: false } }],
  ];
  for (const [label, overrides] of cases) {
    const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
    f.controller.missionPrepared({ tokenId: '93', intentHash: hash }, { sessionId, setupArtifactHash: hash });
    f.controller.missionSubmitted({ tokenId: '93', intentHash: hash }, hash); f.remount(); await flush();
    f.state.missionStatuses.set('93', { ...overrides,
      runtime: { sessionActive: true, ...overrides.runtime },
      mission: { status: 'ACTIVE', sessionId, ...overrides.mission },
    });
    await f.textClick('CHECK MISSION / SIGN IN');
    assert.match(f.root.textContent, /Check original approval/, label);
    assert.equal(['AUTHORIZED', 'EXISTING', 'SETTLED'].includes(f.savedPlan().missions[0].status), false, label);
    assert.equal(f.node('swarm-setup-next-mission').disabled, true, label);
    assert.equal(f.state.calls.filter(call => call[0] === 'mission-review').length, 1, label);
    assert.deepEqual(f.state.sends, [], label);
  }
});

test('terminal mission recovery requires the original session and transaction with current account bindings', async () => {
  const hash = '0x' + 'a'.repeat(64), sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  for (const overrides of [
    { authorizationTransactionHash: null },
    { authorizationTransactionHash: '0x' + 'b'.repeat(64) },
    { sessionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    { account: '0x' + '5'.repeat(40) },
    { intent: { expectedOwner: '0x' + '5'.repeat(40) } },
    { intent: { punkTokenId: '94' } },
  ]) {
    const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
    f.controller.missionPrepared({ tokenId: '93', intentHash: hash }, { sessionId, setupArtifactHash: hash });
    f.controller.missionSubmitted({ tokenId: '93', intentHash: hash }, hash); f.remount(); await flush();
    f.state.missionStatuses.set('93', { runtime: { sessionActive: false },
      mission: { status: 'COMPLETED', sessionId, ...overrides } });
    await f.textClick('CHECK MISSION / SIGN IN');
    assert.equal(f.savedPlan().missions[0].status, 'CHECK_STATUS');
    assert.equal(f.node('swarm-setup-next-mission').disabled, true); assert.deepEqual(f.state.sends, []);
  }
});

test('mismatched mission receipt responses preserve the original attempt and never unlock another approval', async () => {
  const hash = '0x' + 'a'.repeat(64), replacement = '0x' + 'b'.repeat(64);
  const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  for (const overrides of [
    { ok: false }, { tokenId: '94' }, { strategyActivated: false },
    { session: { sessionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' } },
    { session: { status: 'PENDING_RECEIPT' } }, { session: { transactionHash: hash } },
  ]) {
    const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
    f.controller.missionPrepared({ tokenId: '93', intentHash: hash }, { sessionId, setupArtifactHash: hash });
    f.controller.missionSubmitted({ tokenId: '93', intentHash: hash }, hash); f.remount(); await flush();
    f.state.missionRecoveryOverrides = overrides; f.node('swarm-setup-mission-hash').value = replacement;
    await f.textClick('RECOVER MISSION CONFIRMATION');
    assert.equal(f.savedPlan().missions[0].attempt.transactionHash, hash);
    assert.match(f.root.textContent, /Check original approval/);
    assert.match(f.node('swarm-setup-status').textContent, /receipt could not be verified/);
    assert.equal(f.node('swarm-setup-next-mission').disabled, true);
    assert.equal(f.state.calls.some(call => call[0] === 'mission-check'), false); assert.deepEqual(f.state.sends, []);
  }
});

test('a verified sped-up mission receipt persists its new hash and can be settled after another reload', async () => {
  const hash = '0x' + 'a'.repeat(64), replacement = '0x' + 'b'.repeat(64);
  const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
  f.controller.missionPrepared({ tokenId: '93', intentHash: hash }, { sessionId, setupArtifactHash: hash });
  f.controller.missionSubmitted({ tokenId: '93', intentHash: hash }, hash); f.remount(); await flush();
  f.node('swarm-setup-mission-hash').value = replacement; await f.textClick('RECOVER MISSION CONFIRMATION');
  assert.equal(f.savedPlan().missions[0].attempt.transactionHash, replacement);
  assert.equal(f.savedPlan().missions[0].status, 'AUTHORIZED');
  f.remount(); await flush(); assert.equal(f.node('swarm-setup-mission-hash').value, replacement);
  f.state.missionStatuses.set('93', { runtime: { sessionActive: false }, mission: {
    status: 'COMPLETED', sessionId, authorizationTransactionHash: replacement,
  } });
  await f.textClick('CHECK MISSION / SIGN IN');
  assert.equal(f.savedPlan().missions[0].status, 'SETTLED');
  assert.equal(f.savedPlan().missions[0].attempt.transactionHash, replacement);
  assert.equal(f.state.calls.filter(call => call[0] === 'mission-review').length, 1); assert.deepEqual(f.state.sends, []);
});

test('a transferred Punk plan can be archived with its original recovery history without sending anything', async () => {
  const hash = '0x' + 'a'.repeat(64), sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
  f.controller.missionPrepared({ tokenId: '93', intentHash: hash }, { sessionId, setupArtifactHash: hash });
  f.controller.missionSubmitted({ tokenId: '93', intentHash: hash }, hash);
  const original = f.savedPlan(); f.state.punks = ['94']; f.remount(); await flush();
  assert.equal(f.node('swarm-setup-next-mission').disabled, true);
  await f.click('swarm-setup-archive');
  const archived = JSON.parse(f.saved.get(`gogh-swarm-setup-archive-v1:4663:${f.state.owner}:${original.planId}`));
  assert.equal(archived.planId, original.planId); assert.deepEqual(archived.tokenIds, original.tokenIds);
  assert.deepEqual(archived.missions[0].attempt, original.missions[0].attempt);
  assert.equal(f.savedPlan(), null); assert.ok(f.node('swarm-setup-plan-form')); assert.deepEqual(f.state.sends, []);
  assert.equal(f.state.calls.filter(call => call[0] === 'mission-review').length, 1);
});

test('archiving an unavailable plan remains blocked while a still-owned Punk has an unresolved approval', async () => {
  const hash = '0x' + 'a'.repeat(64), sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const f = fixture(); await f.existingGasMissions(); await f.click('swarm-setup-next-mission');
  f.controller.missionPrepared({ tokenId: '93', intentHash: hash }, { sessionId, setupArtifactHash: hash });
  f.controller.missionSubmitted({ tokenId: '93', intentHash: hash }, hash);
  f.state.punks = ['93']; f.remount(); await flush(); await f.click('swarm-setup-archive');
  assert.ok(f.savedPlan()); assert.equal([...f.saved.keys()].some(key => key.startsWith('gogh-swarm-setup-archive')), false);
  assert.match(f.node('swarm-setup-status').textContent, /pending wallet requests/); assert.deepEqual(f.state.sends, []);
});
