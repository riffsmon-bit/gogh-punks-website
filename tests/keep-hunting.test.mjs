import test from 'node:test';
import assert from 'node:assert/strict';
import { agentOptionsCommand } from '../site/broker-agent-options.js';
import { swarmCommand } from '../site/broker-swarm.js';
import { draftStrategyFromConversation } from '../broker/src/v4/intent-draft.mjs';
import { defaultAskIntent } from '../broker/src/v4/collecting-intent.mjs';
import { resolveV2PunkChat } from '../netlify/functions/broker-v2-chat.mjs';

const now = new Date('2026-09-23T15:00:00.000Z');
const identity = { punkTokenId: '93', expectedOwner: `0x${'1'.repeat(40)}`, punkWallet: `0x${'2'.repeat(40)}` };
const target = `0x${'3'.repeat(40)}`;
const currentIntent = { ...defaultAskIntent(identity, now), operatingMode: 'AUTONOMOUS',
  expiration: new Date(now.getTime() + 86_400_000).toISOString(), dailyMintLimit: 5, totalMintLimit: 5,
  minimumReserveWei: '10000000000000000',
  blockedContracts: [`0x${'4'.repeat(40)}`], allowedContracts: [target],
  preferences: { prefer: ['PIXEL_ART'], avoid: ['ANIME'] } };
const fields = { mode: 'AUTONOMOUS', taste: 'KEEP', collections: 'KEEP', daily: '5', total: '5', reserve: '0.01', gas: '0.0005' };

for (const kind of ['individual', 'swarm-search', 'swarm-directed']) test(`${kind} keep hunting produces a bounded owner review through the real deterministic route`, async () => {
  const message = kind === 'individual'
    ? agentOptionsCommand({ ...fields, duration: 'KEEP_HUNTING' })
    : swarmCommand({ mode: kind === 'swarm-search' ? 'SEARCH' : 'DIRECTED', target, daily: '5', total: '5', duration: 'KEEP_HUNTING' });
  const result = await resolveV2PunkChat({ ownerMessage: message, currentIntent, tokenId: '93', now,
    authority: { punkWallet: identity.punkWallet }, owner: identity.expectedOwner,
    router: { run() { throw Error('No AI authority or cost'); } } });
  assert.equal(result.responseKind, 'STRATEGY_DRAFT');
  assert.equal(result.draft.state, 'PENDING_OWNER_CONFIRMATION');
  const intent = result.draft.intent;
  assert.equal(intent.totalMintLimit, 100);
  assert.equal(intent.expiration, new Date(now.getTime() + 30 * 86_400_000).toISOString());
  assert.equal(result.draft.confirmation.totalLimit, 100);
  assert.equal(result.draft.confirmation.expiresAt, intent.expiration);
  assert.equal(result.draft.confirmation.activationRequired, true);
  for (const key of ['dailyMintLimit', 'maxGasPerMintWei', 'minimumReserveWei', 'blockedContracts', 'preferences', 'requireSimulation', 'allowedAdapters', 'riskThreshold']) assert.deepEqual(intent[key], currentIntent[key]);
  assert.equal(intent.mintMode, 'FREE_ONLY');
  assert.equal(intent.maxMintPriceWei, '0');
  assert.deepEqual(intent.allowedContracts, kind === 'swarm-search' ? [] : [target]);
  assert.equal(currentIntent.totalMintLimit, 5);
});

test('ordinary mission changes never renew the existing expiration or raise the total', () => {
  const draft = draftStrategyFromConversation({ ...identity, currentIntent, message: agentOptionsCommand(fields) }, now);
  assert.equal(draft.intent.expiration, currentIntent.expiration);
  assert.equal(draft.intent.totalMintLimit, 5);
  assert.equal(draft.economicPermissionsActivated, false);
});

test('vague or negated indefinite requests do not extend authority', () => {
  for (const message of ['Keep hunting until out of gas.', 'Hunt forever.', 'Do not Keep hunting for up to 100 mints over 30 days.']) {
    const draft = draftStrategyFromConversation({ ...identity, currentIntent, message }, now);
    assert.equal(draft.intent.expiration, currentIntent.expiration);
    assert.equal(draft.intent.totalMintLimit, 5);
    assert.equal(draft.economicPermissionsActivated, false);
  }
});

test('conflicting bounded total and keep-hunting mode demand clarification rather than extending permission', () => {
  for (const message of [
    'Autonomously find free mints. Max 5 mints total. Keep hunting for up to 100 mints over 30 days.',
    'Assist me. Find free mints. Keep hunting for up to 100 mints over 30 days.',
  ]) {
    const draft = draftStrategyFromConversation({ ...identity, currentIntent, message }, now);
    assert.equal(draft.status, 'NEEDS_CLARIFICATION');
    assert.ok(draft.ambiguous.includes('KEEP_HUNTING_LIMITS'));
    assert.equal(draft.intent.expiration, currentIntent.expiration);
    assert.equal(draft.economicPermissionsActivated, false);
  }
});
