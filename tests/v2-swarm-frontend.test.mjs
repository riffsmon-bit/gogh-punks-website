import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Small DOM fixture: wallet/API behavior is mocked; no browser or network starts.
class Node {
  constructor(tag = '#text', text = '') { this.tagName = tag; this.childNodes = []; this.attributes = {}; this.listeners = {};
    this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.classList = { add() {} }; this._text = text; }
  set textContent(value) { this.childNodes = []; this._text = String(value); if (this.tagName !== '#text' && value !== '') { this._text = ''; this.append(new Node('#text', String(value))); } }
  get textContent() { return this._text + this.childNodes.map(node => node.textContent).join(''); }
  get firstChild() { return this.childNodes[0]; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.childNodes.push(node); if (this.tagName === 'select' && !this.value) this.value = node.value; } }
  replaceChildren(...nodes) { this.childNodes = []; this._text = ''; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
  dispatch(name) { if (name === 'click' && (this.disabled || this.hidden)) return; for (const callback of this.listeners[name] ?? []) callback({ target: this, currentTarget: this }); }
  focus() { document.activeElement = this; }
  scrollIntoView() {}
}
const walk = root => [root, ...root.childNodes.flatMap(walk)];
const by = (root, attribute, value) => walk(root).find(node => node.attributes[attribute] === value);
const button = (root, label) => walk(root).find(node => node.tagName === 'button' && node.textContent === label);
const inputs = root => walk(root).filter(node => node.tagName === 'input');
const type = (node, value) => { node.value = value; node.dispatch('input'); };
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const click = async node => { assert.ok(node, 'button exists'); node.dispatch('click'); await flush(); };
const OWNER = '0x' + '1'.repeat(40), ACCOUNT = '0x' + '2'.repeat(40), HASH = '0x' + 'a'.repeat(64);
function dom() {
  const saved = new Map();
  globalThis.document = { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), activeElement: null };
  globalThis.window = { setInterval: () => 1, clearInterval() {} };
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  return new Node('section');
}
async function moduleWithMocks(name, prefix) {
  const source = await readFile(new URL(`../site/${name}`, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(prefix + '\n' + source.replace(/^import .*;\n/gm, '')).toString('base64')}`);
}
const recoveryModule = await moduleWithMocks('punk-agent-recovery-panel.js', 'const createAgentRecoveryController = () => { throw Error("A controller fixture is required"); };');
function recoveryFixture(initial = { status: 'EMPTY', review: null, transactionHash: null }) {
  const root = dom(), calls = [], drafts = new Map(); let journal = structuredClone(initial), time = 1_000_000, tick;
  let selection = { owner: OWNER, tokenId: '93', chainId: 4663, preview: false }, failure = null;
  const provider = { request: async () => { throw Error('No real wallet request is allowed'); } };
  const panel = recoveryModule.createAgentRecoveryPanel({ root, getSelection: () => selection, getProvider: () => provider,
    ensureSession: async () => { calls.push('session'); }, now: () => time, schedule: callback => { tick = callback; return 1; }, unschedule() {},
    createController: options => {
      const key = options.tokenId;
      if (!drafts.has(key)) drafts.set(key, structuredClone(journal));
      const get = () => drafts.get(key);
      const save = value => { drafts.set(key, value); journal = value; options.onChange(structuredClone(value)); return value; };
      return { getState: () => structuredClone(get()),
        prepare: async intent => { calls.push('prepare'); if (failure) throw failure;
          return save({ status: 'PREPARED', review: { intent, owner: OWNER, account: ACCOUNT, maximumNetworkFeeWei: '21000', expiresAt: time + 90_000 }, transactionHash: null }); },
        submit: async ({ expectedReview } = {}) => { calls.push('submit'); assert.equal(options.isCurrent(), true);
          assert.ok(Object.isFrozen(expectedReview)); assert.ok(Object.isFrozen(expectedReview.intent));
          if (JSON.stringify(expectedReview) !== JSON.stringify(get().review)) throw Object.assign(Error('Review changed'), { code: 'AGENT_RECOVERY_REVIEW_CHANGED' });
          calls.push('send'); save({ ...get(), status: 'WALLET_REQUESTED' }); if (failure) throw failure;
          return save({ ...get(), status: 'SUBMITTED', transactionHash: HASH }); },
        refresh: async () => { calls.push('refresh'); if (failure) throw failure; return get(); },
        recover: async hash => { calls.push(['recover', hash]); if (failure) throw failure; return save({ ...get(), status: 'SUBMITTED', transactionHash: hash }); },
        cancelReview: async () => { calls.push('cancel'); return save({ ...get(), status: 'CANCELLED' }); },
      };
    } });
  return { root, panel, calls, state: () => journal, tick: () => tick(), advance: n => { time += n; },
    drift: mutate => { const next = structuredClone(drafts.get(selection.tokenId)); mutate(next); drafts.set(selection.tokenId, next); journal = next; },
    select: patch => { selection = { ...selection, ...patch }; panel.selectionChanged(); }, fail: error => { failure = error; } };
}
const recoveryAction = (f, name) => by(f.root, 'data-agent-recovery-action', name);
const recoveryField = (f, name) => by(f.root, 'data-agent-recovery-field', name);

test('recovery mount, selection and expiry timer cannot sign in, prepare or send', () => {
  const f = recoveryFixture(); f.tick(); f.select({ tokenId: '94' }); f.tick();
  assert.deepEqual(f.calls, []); assert.match(f.root.textContent, /fixed owner destination|fixed current-owner/i);
  f.select({ preview: true }); assert.equal(recoveryAction(f, 'prepare').disabled, true);
  f.select({ preview: false, chainId: 1 }); assert.equal(recoveryAction(f, 'prepare').disabled, true);
});
test('review renders exact source, fixed destination, amount, fee and expiry before separate confirmation', async () => {
  const f = recoveryFixture(); type(recoveryField(f, 'amount'), '0.000000000000000001');
  await click(recoveryAction(f, 'prepare'));
  assert.deepEqual(f.calls, ['session', 'prepare']); assert.equal(f.state().review.intent.amountWei, '1');
  assert.match(f.root.textContent, new RegExp(ACCOUNT)); assert.match(f.root.textContent, new RegExp(OWNER));
  assert.match(f.root.textContent, /0.000000000000021 ETH/); assert.match(f.root.textContent, /REVIEW EXPIRES/);
  assert.equal(recoveryAction(f, 'submit').disabled, true);
  const confirmation = inputs(f.root).find(node => node.type === 'checkbox'); confirmation.checked = true; confirmation.dispatch('change');
  await click(recoveryAction(f, 'submit')); assert.equal(f.calls.filter(call => call === 'submit').length, 1);
  await click(recoveryAction(f, 'refresh')); f.tick();
  assert.equal(f.calls.filter(call => call === 'submit').length, 1); assert.equal(f.state().status, 'SUBMITTED');
});
test('expired recovery keeps draft and requires explicit cancellation and fresh review', async () => {
  const f = recoveryFixture(); type(recoveryField(f, 'amount'), '0.00123'); await click(recoveryAction(f, 'prepare'));
  f.advance(90_000); f.tick(); assert.equal(recoveryAction(f, 'submit').disabled, true);
  assert.match(f.root.textContent, /Review expired/); assert.equal(recoveryField(f, 'amount').value, '0.00123');
  assert.equal(recoveryAction(f, 'prepare').disabled, true);
  await click(recoveryAction(f, 'cancel')); assert.equal(recoveryField(f, 'amount').value, '0.00123');
  await click(recoveryAction(f, 'prepare')); assert.equal(f.calls.filter(call => call === 'prepare').length, 2);
  assert.equal(f.calls.includes('submit'), false);
});
test('stale recovery confirmation passes the displayed immutable review and cannot adopt another tab’s review', async () => {
  const f = recoveryFixture(); type(recoveryField(f, 'amount'), '0.0001'); await click(recoveryAction(f, 'prepare'));
  const checkbox = inputs(f.root).find(node => node.type === 'checkbox'); checkbox.checked = true; checkbox.dispatch('change');
  f.drift(state => { state.review.intent.amountWei = '900000000000000'; });
  await click(recoveryAction(f, 'submit'));
  assert.equal(f.calls.includes('send'), false); assert.match(f.root.textContent, /recovery review changed/);
  assert.equal(checkbox.checked, false); assert.equal(recoveryAction(f, 'submit').disabled, true);
});
test('ambiguous wallet result and recovery errors retain hash draft and pending lock without a resend', async () => {
  const f = recoveryFixture(); type(recoveryField(f, 'amount'), '0.01'); await click(recoveryAction(f, 'prepare'));
  const confirmation = inputs(f.root).find(node => node.type === 'checkbox'); confirmation.checked = true; confirmation.dispatch('change');
  f.fail(Object.assign(Error('unknown'), { code: 'AGENT_RECOVERY_WALLET_RESULT_UNKNOWN' }));
  await click(recoveryAction(f, 'submit')); type(recoveryField(f, 'hash'), HASH);
  f.fail(Object.assign(Error('mismatch'), { code: 'AGENT_RECOVERY_RECEIPT_MISMATCH' }));
  await click(recoveryAction(f, 'recover'));
  assert.equal(recoveryField(f, 'hash').value, HASH); assert.equal(f.state().status, 'WALLET_REQUESTED');
  assert.equal(recoveryAction(f, 'prepare').disabled, true); assert.equal(recoveryAction(f, 'submit').hidden, true);
  assert.match(f.root.textContent, /does not match/); assert.equal(f.calls.filter(call => call === 'submit').length, 1);
  await click(recoveryAction(f, 'refresh')); assert.equal(recoveryField(f, 'hash').value, HASH);
});
test('gallery NFT prefills remain drafts; typed asset quantities are exact and exclude authority fields', () => {
  const f = recoveryFixture(); f.panel.openAsset({ standard: 'ERC1155', collection: ACCOUNT, tokenId: '0' });
  assert.deepEqual(f.calls, []); assert.equal(recoveryField(f, 'action').value, 'ERC1155');
  assert.equal(recoveryField(f, 'assetTokenId').value, '0');
  const intent = recoveryModule.agentRecoveryIntent('93', { action: 'ERC1155', amount: '3', contract: ACCOUNT, assetTokenId: '0' });
  assert.equal(intent.amountWei, '3'); assert.deepEqual(Object.keys(intent), ['schema', 'tokenId', 'action', 'amountWei', 'assetContract', 'assetTokenId']);
  for (const amount of ['0', '-1', '1.5', '1e2']) assert.throws(() => recoveryModule.agentRecoveryIntent('93', { action: 'ERC1155', amount, contract: ACCOUNT, assetTokenId: '0' }));
});

const paidModule = await moduleWithMocks('directed-paid-panel.js', `const PAID_RELEASE={status:'OWNER_CANARY',productionPaidMintAuthorized:true,owner:'${OWNER}',targetCollection:'${ACCOUNT}'};
const validatePaidEnvelope=value=>value, submitDirectedPaid=()=>{throw Error('UI tests cannot send');}, paidReviewStatus=()=> 'Saved review';`);
const burnModule = await moduleWithMocks('forge-selected-burn-panel.js', `const TRAINING_RELEASE={status:'OWNER_CANARY',trainingSource:'${ACCOUNT}'},SELECTED_BURN_OWNER='${OWNER}';
const validateSelectedBurnEnvelope=value=>value,submitSelectedBurn=()=>{throw Error('UI tests cannot burn');};`);
function ownerFixture(module, kind, initial, {autoLoad=false,initialFailure=null}={}) {
  const root = dom(); let envelope = initial, failure = initialFailure, selected = { owner: OWNER, tokenId: '93', chainId: 4663, preview: false },signIns=0;
  const requests = [];
  const panel = module[kind]({ root, autoLoad, getSelection: () => selected, ensureSession: async () => {signIns++;}, request: async (path, options) => {
    requests.push(options?.body ? JSON.parse(options.body) : 'get'); if (failure) throw failure; return structuredClone(envelope);
  } });
  return { root, panel, requests, signIns:()=>signIns, fail: error => { failure = error; }, response: value => { envelope = value; }, select: patch => { selected = { ...selected, ...patch }; panel.selectionChanged(); } };
}
const ownerEnvelope = (status, action = 'BURN', expiresAt = Date.now() + 90_000) => ({ record: { status, revision: 1, reviewHash: 'old', review: {
  intentId: 'original', action, expiresAt, maximumNetworkFeeWei: '21000', deadline: String(Math.floor(Date.now() / 1000) + 300),
  priceWei: '1', executionFeeWei: '1', targetCollection: ACCOUNT, recipient: ACCOUNT,
} }, state: {} });

test('returning holder automatically sees completed paid delivery without a sign-in or another budget',async()=>{
 const envelope={...ownerEnvelope('CONFIRMED','AUTHORIZE'),state:{missionStatus:2,refundWei:'0'},
  execution:{intent_id:'original',status:'COMPLETED',receipt:{tokenId:'1599'},transaction_hash:HASH}};
 const f=ownerFixture(paidModule,'createDirectedPaidPanel',envelope,{autoLoad:true});await flush();
 assert.match(f.root.textContent,/PAID MINT COMPLETE/);assert.match(f.root.textContent,/Delivered Peppies World #1599/);
 assert.ok(walk(f.root).find(n=>n.tagName==='a'&&n.textContent==='VIEW IN COLLECTION'&&n.href.includes('tokenId=93')));
 assert.ok(button(f.root,'REVIEW ANOTHER MINT'));assert.equal(button(f.root,'REVIEW ONE PEPPIES WORLD MINT'),undefined);
 assert.deepEqual(f.requests,['get']);assert.equal(f.signIns(),0);
 f.panel.selectionChanged();await flush();assert.deepEqual(f.requests,['get'],'same selection does not refetch');
 f.select({tokenId:'94'});assert.equal(f.root.hidden,true);assert.doesNotMatch(f.root.textContent,/1599/);f.panel.destroy();
});
test('automatic paid status read cannot sign in, recover or offer a new mint when the session is missing',async()=>{
 const f=ownerFixture(paidModule,'createDirectedPaidPanel',null,{autoLoad:true,
  initialFailure:Object.assign(Error('Session expired'),{code:'V2_SESSION_EXPIRED'})});await flush();
 assert.equal(f.signIns(),0);assert.deepEqual(f.requests,['get']);
 assert.match(f.root.textContent,/Sign in to check your saved mint result/);
 assert.equal(button(f.root,'REVIEW ONE PEPPIES WORLD MINT'),undefined);f.panel.destroy();
});
test('completed paid mint remains clear when a separate unsigned review expired',async()=>{
 const envelope={...ownerEnvelope('PREPARED','AUTHORIZE',Date.now()-1),state:{missionStatus:2,refundWei:'0'},
  execution:{intent_id:'earlier-mint',status:'COMPLETED',receipt:{tokenId:'1599'},transaction_hash:HASH}};
 const f=ownerFixture(paidModule,'createDirectedPaidPanel',envelope,{autoLoad:true});await flush();
 assert.match(f.root.textContent,/PAID MINT COMPLETE/);assert.match(f.root.textContent,/separate review for another mint expired/);
 assert.ok(button(f.root,'DISMISS EXPIRED REVIEW'));assert.equal(button(f.root,'CONFIRM MINT BUDGET IN WALLET'),undefined);
 assert.equal(button(f.root,'REVIEW ANOTHER MINT'),undefined);assert.deepEqual(f.requests,['get']);assert.equal(f.signIns(),0);
 f.panel.destroy();
});
test('automatic paid status read does not recover a saved wallet request until explicit recheck',async()=>{
 const envelope=ownerEnvelope('WALLET_REQUESTED','AUTHORIZE');envelope.record.reportedHash=HASH;
 const f=ownerFixture(paidModule,'createDirectedPaidPanel',envelope,{autoLoad:true});await flush();
 assert.equal(f.signIns(),0);assert.deepEqual(f.requests,['get']);
 assert.ok(button(f.root,'RECOVER ORIGINAL TRANSACTION'));f.panel.destroy();
});

for (const [module, kind, check] of [[paidModule, 'createDirectedPaidPanel', 'RECHECK PAID MINT'], [burnModule, 'createSelectedBurnPanel', 'RECHECK SELECTED TEST']]) {
  test(`${kind}: typed recovery hash survives validation and failed rechecks`, async () => {
    const f = ownerFixture(module, kind, ownerEnvelope('WALLET_REQUESTED'));
    await click(button(f.root, check)); type(inputs(f.root)[0], '0xabc');
    await click(button(f.root, 'RECOVER ORIGINAL TRANSACTION')); assert.equal(inputs(f.root)[0].value, '0xabc');
    type(inputs(f.root)[0], HASH); f.fail(Error('Receipt service unavailable')); await click(button(f.root, check));
    assert.equal(inputs(f.root)[0].value, HASH); assert.match(f.root.textContent, /Receipt service unavailable/);
    assert.equal(f.requests.some(request => request.operation === 'prepare' || request.operation === 'claim'), false);
    f.panel.destroy();
  });
  test(`${kind}: expired review cannot confirm and requires explicit cancellation`, async () => {
    const f = ownerFixture(module, kind, ownerEnvelope('PREPARED', kind === 'createDirectedPaidPanel' ? 'AUTHORIZE' : 'BURN', Date.now() - 1));
    await click(button(f.root, check));
    const confirm = walk(f.root).find(node => node.tagName === 'button' && /CONFIRM.*WALLET/.test(node.textContent));
    assert.equal(confirm.disabled, true); assert.ok(button(f.root, 'CANCEL UNSENT REVIEW'));
    assert.equal(f.requests.some(request => request.operation === 'prepare' || request.operation === 'claim'), false);
    f.panel.destroy();
  });
}
test('Forge burn confirmation survives same-review recheck errors, resets on changed review and selection', async () => {
  const envelope = ownerEnvelope('PREPARED');
  const f = ownerFixture(burnModule, 'createSelectedBurnPanel', envelope);
  await click(button(f.root, 'RECHECK SELECTED TEST'));
  let [checkbox, phrase] = inputs(f.root); checkbox.checked = true; checkbox.dispatch('change'); type(phrase, 'BURN 1753');
  f.fail(Error('Recheck unavailable')); await click(button(f.root, 'RECHECK SELECTED TEST'));
  [checkbox, phrase] = inputs(f.root); assert.equal(checkbox.checked, true); assert.equal(phrase.value, 'BURN 1753');
  f.fail(null); f.response({ ...envelope, record: { ...envelope.record, reviewHash: 'changed' } });
  await click(button(f.root, 'RECHECK SELECTED TEST')); [checkbox, phrase] = inputs(f.root);
  assert.equal(checkbox.checked, false); assert.equal(phrase.value, '');
  type(phrase, 'BURN 1753'); f.select({ tokenId: '94' }); f.select({ tokenId: '93' });
  await click(button(f.root, 'RECHECK SELECTED TEST')); assert.equal(inputs(f.root)[1].value, ''); f.panel.destroy();
});
test('paid archive error explains funding gate and retains saved price limit', async () => {
  const f = ownerFixture(paidModule, 'createDirectedPaidPanel', ownerEnvelope('WALLET_REQUESTED'));
  f.fail(Object.assign(Error('PAID_HISTORY_UNAVAILABLE'), { code: 'PAID_HISTORY_UNAVAILABLE' }));
  await f.panel.openDraft({ collection: ACCOUNT, quantity: 1, maximumPriceWei: '100000000000000' });
  assert.match(f.root.textContent, /New paid budgets are blocked/); assert.match(f.root.textContent, /Saved mint-price limit: 0.0001 ETH/);
  assert.deepEqual(f.requests, ['get'], 'a failed status read must not trigger new budget preparation');
  f.panel.destroy();
});
test('broker wiring preserves historical count semantics, Agent custody and selected-Punk deep links', async () => {
  const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
  assert.match(source, /punk\.acquisitionCount = profilePayload\.profile\.collectionCount/);
  assert.doesNotMatch(source, /punk\.nfts = profilePayload\.profile\.collectionCount/);
  assert.match(source, /ACQUISITION HISTORY/); assert.match(source, /V3 WALLET ETH/);
  assert.match(source, /state\.selected\?\.tokenId \?\? REQUESTED_PUNK/);
  assert.match(source, /itemData\.custodyType === 'PUNK_AGENT_ACCOUNT'/);
  assert.match(source, /itemData\.ownershipStatus === 'LIVE_VERIFIED'/);
});
