import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { punkActivationStatus } from '../site/broker-activation-status.js';
import { missionStatus } from '../site/broker-mission-status.js';

const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Missing integrated block ${start}`);
  return source.slice(first, last);
}
const modelFunctions = section('function activationForPunk(', '\nfunction currentSwarmFunding(');
const monitorFunction = section('function renderMissionMonitor(', '\nfunction renderReviewAgent(');
const currentStatusFunction = section('function renderCurrentMissionStatus(', '\nfunction missionClock(');
const clickRegistration = section("one('[data-activation-guide]').addEventListener('click'", '\n  one("[data-link-form]")');
const walletRegistration = section('window.addEventListener("gogh:wallet-state"', '\n  if (PREVIEW) { previewData()');
const owner = `0x${'a'.repeat(40)}`, other = `0x${'b'.repeat(40)}`, agent = `0x${'c'.repeat(40)}`;

class Node {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.textContent = ''; this.value = ''; this.checked = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  scrollIntoView() {}
}
function fixture() {
  const now = Date.now(), intent = { expectedOwner: owner, punkTokenId: '93', operatingMode: 'AUTONOMOUS', minimumReserveWei: '100000000000000' };
  const selected = { tokenId: '93', strategy: { intent } }, state = { selected, punks: [selected],
    wallet: { account: owner, chainId: 4663 }, ownershipAccount: owner, ownershipRequestId: 0,
    localStrategy: null, gasFundingBusy: false, agentAccountLoading: new Map(), balanceReads: new Map(),
    agentAccounts: new Map([['93', { ok: true, owner, tokenId: '93', receivedAt: now,
      runtime: { owner, account: agent, accountCreated: true, sessionActive: true,
        nativeBalance: '1000000000000000', entryPointDeposit: '0', session: { minimumNativeReserveWei: intent.minimumReserveWei } },
      readiness: { setupAvailable: true, automaticExecutionReady: true, databaseReady: true, blockers: [] }, worker: { enabled: true },
      mission: { account: agent, status: 'ACTIVE', intent, validAfter: new Date(now - 60000).toISOString(),
        validUntil: new Date(now + 3600000).toISOString(), lastCheckedAt: new Date(now - 1000).toISOString() } }]]) };
  const nodes = new Map(), roster = [], calls = [], windowEvents = {};
  const one = selector => {
    if (selector === '[data-mission-monitor]') return null;
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return nodes.get(selector);
  };
  const context = vm.createContext({ state, punkActivationStatus, CHAIN_ID: 4663, PREVIEW: false,
    punkRecall: { busy: false }, document: { createElement: tag => new Node(tag) }, one,
    all: selector => selector === '[data-roster-activation]' ? roster : [],
    set: (selector, text) => { one(selector).textContent = text; },
    loadAgentAccountStatus: async options => { calls.push(['status', options.authenticate]); },
    activateTab: tab => calls.push(['tab', tab]), renderAgentGasFunding() {},
    showConfirmation: draft => calls.push(['confirmation', draft]),
    runAgentAction: command => calls.push(['command', command]), START_FREE_MINT_COMMAND: 'REVIEW_AUTONOMOUS_MISSION',
    renderCurrentMissionStatus: () => ({}), renderMissionBadges() {},
    swarmReviewGate: { invalidate() { calls.push(['invalidate-swarm-review']); } },
    persistentWatchControl: null, forgeSkillAdminControl: null, brokerPreferences: null, gasFundingRecovery: null,
    ownerRefresh: { invalidate() {} }, clearTransferredPunkReview() {}, resetGallery() {},
    window: { addEventListener: (name, handler) => { windowEvents[name] = handler; } },
    fetch() { throw Error('Rendering must not fetch status for every Punk'); },
    jsonRequest() { throw Error('Rendering must not request an API'); },
  });
  vm.runInContext(modelFunctions + '\n' + monitorFunction + '\n' + clickRegistration + '\n' + walletRegistration, context);
  const click = action => one('[data-activation-guide]').listeners.click({ target: {
    closest: () => ({ dataset: { activationAction: action }, disabled: false }) } });
  return { state, nodes, roster, calls, one, context, click, windowEvents,
    render: () => vm.runInContext('renderActivationGuide()', context),
    monitor: () => vm.runInContext('renderMissionMonitor()', context),
    model: id => vm.runInContext(`activationForPunk('${id}')`, context) };
}

test('activation wiring uses saved reserve when no local draft exists, including another roster Punk', () => {
  const f = fixture(), account = f.state.agentAccounts.get('93');
  account.runtime.sessionActive = false; account.mission.status = 'COMPLETED'; account.runtime.nativeBalance = '10';
  assert.equal(f.model('93').status, 'RESERVE_REACHED');
  const second = { tokenId: '94', strategy: { intent: { ...f.state.selected.strategy.intent, punkTokenId: '94' } } };
  f.state.punks.push(second);
  f.state.agentAccounts.set('94', { ...account, tokenId: '94', mission: null });
  assert.equal(f.model('94').status, 'RESERVE_REACHED');
});

test('roster activation display consumes cached responses only and unknown Punks never appear inactive', () => {
  const f = fixture();
  for (const tokenId of ['93', '94', '95', '96']) { const node = new Node('small'); node.dataset.rosterActivation = tokenId; f.roster.push(node); }
  f.render();
  assert.equal(f.roster[0].textContent, 'HUNTING');
  assert.equal(f.roster.slice(1).every(node => node.textContent === 'CHECK SETUP'), true);
  assert.equal(f.calls.length, 0);
  const account = f.state.agentAccounts.get('93'); account.owner = other;
  f.render(); assert.equal(f.roster[0].textContent, 'CHECK SETUP');
});

test('hero and mission strip override recent hunting evidence when the reserve is reached or ownership is unverified', () => {
  for (const [mutate, expected] of [
    [value => { value.runtime.nativeBalance = value.mission.intent.minimumReserveWei; }, 'RESERVE REACHED'],
    [value => { delete value.owner; }, 'STATUS NOT VERIFIED'],
    [value => { value.runtime.owner = other; }, 'STATUS NOT VERIFIED'],
  ]) {
    const f = fixture(), account = f.state.agentAccounts.get('93'); mutate(account);
    // A recent worker timestamp alone used to label each of these states hunting.
    assert.equal(missionStatus({ account }).label, 'LOOKING FOR MINTS');
    Object.assign(f.context, { missionStatus, selectedAgentAccount: () => account, selectedReviewAgent: () => null });
    vm.runInContext(currentStatusFunction, f.context);
    const result = vm.runInContext('renderCurrentMissionStatus()', f.context);
    assert.equal(result.label, expected); assert.equal(result.canStart, false);
    assert.equal(f.one('[data-hero-status]').textContent, expected);
    assert.equal(f.one('[data-current-mission-status]').textContent, expected);
    assert.equal(f.one('[data-start-free-mission]').hidden, true);
    assert.equal(f.calls.length, 0);
  }
});

test('existing mission display tick ages activation labels out without additional network requests', () => {
  const f = fixture(); f.render();
  assert.equal(f.one('[data-activation-label]').textContent, 'LOOKING FOR MINTS');
  f.state.agentAccounts.get('93').receivedAt = Date.now() - 91000;
  f.monitor();
  assert.equal(f.one('[data-activation-label]').textContent, 'STATUS NOT VERIFIED');
  assert.equal(f.calls.length, 0);
});

test('unchanged display ticks preserve checklist controls for keyboard focus; unknown state offers only a status check', () => {
  const f = fixture(), account = f.state.agentAccounts.get('93'); account.runtime.nativeBalance = '0';
  f.render();
  const list = f.one('[data-activation-steps]'), original = list.children;
  const button = original.flatMap(item => item.children).find(item => item.dataset.activationAction === 'FUND');
  assert.ok(button);
  f.monitor(); assert.equal(list.children, original);
  assert.equal(list.children.flatMap(item => item.children).includes(button), true);
  f.state.agentAccounts.clear(); f.monitor();
  const actions = list.children.flatMap(item => item.children).filter(item => item.tag === 'button').map(item => item.dataset.activationAction);
  assert.deepEqual(actions, ['CHECK']);
});

test('wallet transition clears the previous owner’s activation display even during pending restore', async () => {
  const f = fixture(); f.render();
  await f.windowEvents['gogh:wallet-state']({ detail: { account: null, status: 'pending', restoring: true } });
  assert.equal(f.one('[data-activation-label]').textContent, 'STATUS NOT VERIFIED');
  assert.equal(f.state.agentAccounts.size, 0); assert.deepEqual(f.calls, [['invalidate-swarm-review']]);
});

test('setup action cannot reopen an ASK draft and pretend it will activate the Agent wallet', () => {
  const f = fixture(); f.state.localStrategy = { intent: { ...f.state.selected.strategy.intent, operatingMode: 'ASK' } };
  f.click('SETUP');
  assert.equal(f.calls.some(call => call[0] === 'confirmation'), false);
  assert.equal(f.calls.some(call => call[0] === 'command' && call[1] === 'REVIEW_AUTONOMOUS_MISSION'), true);
});

test('an existing autonomous review stays a review and never triggers a wallet send from the checklist', () => {
  const f = fixture(); f.state.localStrategy = { intent: { ...f.state.selected.strategy.intent } };
  f.click('MISSION');
  assert.equal(f.calls.find(call => call[0] === 'confirmation')?.[1], f.state.localStrategy);
  assert.equal(f.calls.filter(call => call[0] === 'command').length, 0);
});

test('Add Agent Gas resets a former Punk-wallet review before selecting the connected wallet source', () => {
  const f = fixture(); f.state.gasFundingPlan = { source: 'PUNK' };
  f.one('#agent-gas-source').value = 'PUNK'; f.one('[data-agent-gas-confirm]').checked = true;
  f.one('[data-agent-gas-form] button[type=submit]').textContent = 'SUBMIT IN METAMASK';
  f.click('FUND');
  assert.equal(f.one('#agent-gas-source').value, 'OWNER');
  assert.equal(f.state.gasFundingPlan, null); assert.equal(f.one('[data-agent-gas-confirm]').checked, false);
  assert.equal(f.one('[data-agent-gas-form] button[type=submit]').textContent, 'REVIEW & SIMULATE');
  assert.deepEqual(f.calls, [['tab', 'fund']]);
});

test('Check Status requests one authenticated selected-Punk read; a busy funding flow blocks new checklist actions', () => {
  const f = fixture(); f.click('CHECK');
  assert.deepEqual(f.calls, [['status', true]]);
  f.calls.length = 0; f.state.gasFundingBusy = true;
  for (const action of ['CHECK', 'SETUP', 'FUND', 'MISSION', 'STATUS']) f.click(action);
  assert.equal(f.calls.length, 0);
});
