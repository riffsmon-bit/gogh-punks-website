import test from 'node:test';
import assert from 'node:assert/strict';
import { missionStatus, START_FREE_MINT_COMMAND, NEW_FREE_MINT_SEARCH_COMMAND } from '../site/broker-mission-status.js';
import { draftStrategyFromConversation } from '../broker/src/v4/intent-draft.mjs';
import { defaultAskIntent } from '../broker/src/v4/collecting-intent.mjs';
const now = Date.parse('2026-09-23T13:30:00Z');
const current = () => ({ receivedAt: now, runtime: { sessionActive: true }, worker: { enabled: true },
  readiness: { automaticExecutionReady: true, blockers: [] }, mission: { status: 'ACTIVE', completedMints: 0,
    totalLimit: 5, dailyLimit: 5, validAfter: new Date(now - 60000).toISOString(),
    validUntil: new Date(now + 86400000).toISOString(), lastCheckedAt: new Date(now - 30000).toISOString() } });
test('five saved ASK rules are not confused with the last completed one-mint mission', () => {
  const account = current(); account.mission = { status: 'COMPLETED', completedMints: 1, totalLimit: 1 }; account.runtime.sessionActive = false;
  const view = missionStatus({ account, now, intent: { dailyMintLimit: 5, totalMintLimit: 5, operatingMode: 'ASK' } });
  assert.equal(view.label, 'NOT LOOKING FOR MINTS'); assert.equal(view.canStart, true);
  assert.match(view.detail, /5 per day, 5 total.*ASK.*Last mission completed 1\/1/);
});
test('looking requires fresh status, live authority, enabled ready worker and a recent successful check', () => {
  assert.equal(missionStatus({ account: current(), now }).label, 'LOOKING FOR MINTS');
  for (const mutate of [a => { a.runtime.sessionActive = false; }, a => { a.worker.enabled = false; },
    a => { a.readiness.automaticExecutionReady = false; }, a => { a.runtime = null; }, a => { a.receivedAt -= 91000; },
    a => { a.mission.lastCheckedAt = new Date(now - 181000).toISOString(); }, a => { a.error = 'Unavailable'; },
    a => { a.mission.lastFailedAt = new Date(now).toISOString(); }, a => { a.mission.validUntil = new Date(now - 1).toISOString(); }]) {
    const a = current(); mutate(a); assert.notEqual(missionStatus({ account: a, now }).label, 'LOOKING FOR MINTS');
  }
});
test('missing state, wrong-owner cache cleared, preview and unscheduled authority cannot appear live', () => {
  assert.equal(missionStatus({ now }).canStart, false);
  assert.equal(missionStatus({ account: current(), now, preview: true }).label, 'PREVIEW');
  const a = current(); a.mission = null;
  assert.equal(missionStatus({ account: a, now }).canStart, false);
});
test('start button drafts automation preserving all saved economic limits; it does not authorize', () => {
  const identity = { punkTokenId: '93', expectedOwner: `0x${'1'.repeat(40)}`, punkWallet: `0x${'2'.repeat(40)}` };
  const currentIntent = { ...defaultAskIntent(identity, new Date(now)), dailyMintLimit: 5, totalMintLimit: 5,
    minimumReserveWei: '10000000000000000', maxGasPerMintWei: '500000000000000' };
  const draft = draftStrategyFromConversation({ ...identity, currentIntent, message: START_FREE_MINT_COMMAND }, new Date(now));
  assert.equal(draft.intent.operatingMode, 'AUTONOMOUS');
  for (const key of ['dailyMintLimit', 'totalMintLimit', 'minimumReserveWei', 'maxGasPerMintWei', 'allowedContracts', 'blockedContracts', 'requireSimulation']) assert.deepEqual(draft.intent[key], currentIntent[key]);
  assert.equal(draft.intent.maxMintPriceWei, '0');
});
test('new search removes only the previous target and retains the five/five mission limits for owner review',()=>{
 const identity={punkTokenId:'93',expectedOwner:`0x${'1'.repeat(40)}`,punkWallet:`0x${'2'.repeat(40)}`};
 const currentIntent={...defaultAskIntent(identity,new Date(now)),dailyMintLimit:5,totalMintLimit:5,
   allowedContracts:[`0x${'3'.repeat(40)}`],blockedContracts:[`0x${'4'.repeat(40)}`],preferences:{prefer:['PIXEL_ART'],avoid:['ANIME']}};
 const draft=draftStrategyFromConversation({...identity,currentIntent,message:NEW_FREE_MINT_SEARCH_COMMAND},new Date(now));
 assert.deepEqual(draft.intent,{...currentIntent,operatingMode:'AUTONOMOUS',allowedContracts:[]});
 assert.deepEqual(currentIntent.allowedContracts,[`0x${'3'.repeat(40)}`]);
 assert.equal(draft.status,'PENDING_OWNER_CONFIRMATION');assert.equal(draft.economicPermissionsActivated,false);
});
