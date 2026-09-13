import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../broker/src/v4/domain/index.mjs';
import { ROBINHOOD, punkKey } from '../broker/src/config.mjs';
import { normalizePunkCollectingIntent } from '../broker/src/v4/collecting-intent.mjs';
import { normalizePunkSkill } from '../broker/src/v4/punk-skill.mjs';
import { normalizeV2Opportunity } from '../broker/src/v4/opportunity.mjs';
import { screenKnownSafeMint } from '../broker/src/v4/security-screen.mjs';
import { validateMintSimulation } from '../broker/src/v4/simulation.mjs';
import { resolvePunkCapabilities } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { ArtBrokerAIProvider } from '../broker/src/v4/ai/provider.mjs';

const OWNER = `0x${'1'.repeat(40)}`;
const NEXT_OWNER = `0x${'2'.repeat(40)}`;
const WALLET = `0x${'3'.repeat(40)}`;
const OTHER_WALLET = `0x${'4'.repeat(40)}`;
const BLOCK = `0x${'a'.repeat(64)}`;
const OTHER_BLOCK = `0x${'b'.repeat(64)}`;
const NOW = new Date('2026-09-13T14:00:00.000Z');
const identity = () => ({ chainId: ROBINHOOD.chainId,
  collection: ROBINHOOD.canonicalCollection, tokenId: '93' });
const authority = () => ({ ...identity(), owner: OWNER, punkWallet: WALLET,
  activated: true, blockNumber: '61960018', nativeBalanceWei: '0', blockHash: BLOCK });
const selection = () => ({ identity: identity(), owner: OWNER, punkWallet: WALLET });
const progression = () => ({ ...identity(), owner: OWNER, slots: 1, mask: '0',
  equipped: [], blockNumber: '61960018', blockHash: BLOCK, blockTime: NOW.getTime() });
const capabilities = (state = progression()) => domain.resolvePunkCapabilities(state,
  { packages: [], owner: state.owner, now: NOW.getTime(), availableTools: [] });

test('shared facade exports the authoritative validators and providers without wrappers', () => {
  for (const [name, implementation] of Object.entries({ normalizePunkCollectingIntent,
    normalizePunkSkill, normalizeV2Opportunity, screenKnownSafeMint,
    validateMintSimulation, resolvePunkCapabilities, ArtBrokerAIProvider })) {
    assert.equal(domain[name], implementation, name);
  }
});

test('original Punk identity preserves the existing storage key across owners', () => {
  const normalized = domain.normalizePunkIdentity({ ...identity(),
    collection: '0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6' });
  assert.deepEqual(normalized, identity());
  assert.ok(Object.isFrozen(normalized));
  assert.equal(domain.punkIdentityKey(normalized), punkKey('93'));
  assert.equal(domain.PUNK_IDENTITY_JSON_SCHEMA.properties.collection.const, normalized.collection);
  const transferred = { ...authority(), owner: NEXT_OWNER };
  assert.equal(domain.punkIdentityKey({ chainId: transferred.chainId,
    collection: transferred.collection, tokenId: transferred.tokenId }), punkKey('93'));
  assert.throws(() => domain.normalizePunkIdentity({ ...identity(), owner: OWNER }), /fields/);
});

test('identity rejects wrong chain, collection, ambiguous token IDs and implicit defaults', () => {
  for (const patch of [{ chainId: 1 }, { chainId: '4663' }, { collection: OWNER },
    { collection: undefined }, { tokenId: 93 }, { tokenId: 93n }, { tokenId: '093' },
    { tokenId: '-1' }, { tokenId: '10000' }, { tokenId: '' }, { tokenId: '93.0' }]) {
    assert.throws(() => domain.normalizePunkIdentity({ ...identity(), ...patch }));
  }
  assert.equal(domain.normalizePunkIdentity({ ...identity(), tokenId: '0' }).tokenId, '0');
  assert.equal(domain.normalizePunkIdentity({ ...identity(), tokenId: '9999' }).tokenId, '9999');
  assert.throws(() => domain.normalizePunkIdentity(null));
});

test('identity and binding guards reject accessors without evaluating them', () => {
  let reads = 0;
  const malicious = Object.defineProperty(identity(), 'tokenId', {
    enumerable: true, get() { reads++; return '93'; },
  });
  assert.throws(() => domain.normalizePunkIdentity(malicious), /data fields/);
  const maliciousAuthority = Object.defineProperty(authority(), 'owner', {
    enumerable: true, get() { reads++; return OWNER; },
  });
  assert.throws(() => domain.assertPunkAuthorityBinding(maliciousAuthority, selection()), /data fields/);
  assert.equal(reads, 0);
  assert.throws(() => domain.normalizePunkIdentity({ ...identity(), [Symbol('owner')]: OWNER }), /symbol/);
});

test('authority binding rejects stale selected owner and a different Punk or account', () => {
  assert.equal(domain.assertPunkAuthorityBinding(authority(), selection()), undefined);
  const cases = [
    [{ owner: NEXT_OWNER }, /PUNK_OWNER_MISMATCH/],
    [{ tokenId: '44' }, /PUNK_IDENTITY_MISMATCH/],
    [{ punkWallet: OTHER_WALLET }, /PUNK_WALLET_MISMATCH/],
    [{ collection: OWNER }, /PUNK_IDENTITY_INVALID/],
    [{ chainId: 1 }, /PUNK_IDENTITY_INVALID/],
  ];
  for (const [patch, expected] of cases) {
    assert.throws(() => domain.assertPunkAuthorityBinding({ ...authority(), ...patch }, selection()), expected);
  }
  assert.equal(domain.assertPunkAuthorityBinding({ ...authority(), owner: NEXT_OWNER },
    { ...selection(), owner: NEXT_OWNER }), undefined);
});

test('authority shape does not substitute missing or wrapped authority observations', () => {
  for (const patch of [{ owner: `0x${'0'.repeat(40)}` }, { activated: undefined },
    { blockNumber: 123 }, { blockNumber: '-1' }, { nativeBalanceWei: undefined },
    { blockHash: '0xabc' }, { authorityEpoch: 'wrapper:1:0' },
    { authorityModel: 'GOGH_WRAPPED_EPOCH_V1' }]) {
    assert.throws(() => domain.assertPunkAuthorityBinding({ ...authority(), ...patch }, selection()));
  }
  const original = authority();
  delete original.blockHash; // readV2PunkAuthority has blockNumber; chat adds hash.
  assert.equal(domain.assertPunkAuthorityBinding(original, selection()), undefined);
});

test('capability results stay bound to the resolver token, owner, block and optional epoch', () => {
  const state = progression();
  const context = capabilities(state);
  assert.equal(domain.assertPunkCapabilityBinding(context, state), undefined);
  for (const [patch, expected] of [
    [{ tokenId: '44' }, /PUNK_IDENTITY_MISMATCH/],
    [{ owner: NEXT_OWNER }, /PUNK_OWNER_MISMATCH/],
    [{ blockHash: OTHER_BLOCK }, /PUNK_BLOCK_MISMATCH/],
    [{ authorityEpoch: 'wrapper:1:0' }, /PUNK_EPOCH_MISMATCH/],
  ]) assert.throws(() => domain.assertPunkCapabilityBinding({ ...context, ...patch }, state), expected);
  const wrapped = { ...state, authorityEpoch: 'wrapper:1:0' };
  const wrappedContext = capabilities(wrapped);
  assert.equal(domain.assertPunkCapabilityBinding(wrappedContext, wrapped), undefined);
  assert.throws(() => domain.assertPunkCapabilityBinding(wrappedContext,
    { ...wrapped, authorityEpoch: 'wrapper:2:0' }), /PUNK_EPOCH_MISMATCH/);
  assert.throws(() => domain.assertPunkCapabilityBinding(context, wrapped), /PUNK_EPOCH_MISMATCH/);
  assert.throws(() => domain.assertPunkCapabilityBinding(context,
    { ...state, chainId: 1 }), /PUNK_IDENTITY_INVALID/);
});

test('capability context can never claim wallet authority or replace resolver freshness checks', () => {
  const state = progression();
  const context = capabilities(state);
  assert.equal(context.walletAuthority, 'NONE');
  assert.equal(context.requiresSeparateEconomicAuthorization, true);
  for (const patch of [{ walletAuthority: 'SIGN' }, { walletAuthority: undefined },
    { requiresSeparateEconomicAuthorization: false }]) {
    assert.throws(() => domain.assertPunkCapabilityBinding({ ...context, ...patch }, state),
      /CAPABILITIES_CANNOT_GRANT_WALLET_AUTHORITY/);
  }
  assert.throws(() => domain.resolvePunkCapabilities(state,
    { packages: [], owner: NEXT_OWNER, now: NOW.getTime(), availableTools: [] }), /OWNER_CHANGED/);
  assert.throws(() => domain.resolvePunkCapabilities(state,
    { packages: [], owner: OWNER, now: NOW.getTime() + 30_001, availableTools: [] }), /STALE_PROGRESSION/);
});

test('strategy and conversational skill contracts keep their original strict economic boundaries', () => {
  const intent = domain.defaultAskIntent({ punkTokenId: '93', expectedOwner: OWNER, punkWallet: WALLET }, NOW);
  assert.throws(() => domain.normalizePunkCollectingIntent({ ...intent, walletAuthority: 'SIGN' }, NOW), /unknown fields/);
  assert.throws(() => domain.normalizePunkCollectingIntent({ ...intent, maxMintPriceWei: '1' }, NOW), /free-only/);
  const draft = domain.draftPunkSkillFromConversation({ message: 'Teach my punk to compare collection traits',
    punkTokenId: '93', expectedOwner: OWNER, punkWallet: WALLET, now: NOW });
  assert.equal(draft.authority, 'READ_ONLY');
  assert.equal(draft.policyEffect, 'NONE');
  assert.throws(() => domain.normalizePunkSkill({ ...draft, authority: 'SIGN' }), /invalid/);
  assert.throws(() => domain.activatePunkSkill(draft,
    { owner: NEXT_OWNER, punkWallet: WALLET, punkTokenId: '93' }), /current owner/);
});

test('simulation results preserve receiver checks and never authorize execution', () => {
  const evidence = { success: true, reverted: false, valueWei: '0', nftReceiver: WALLET,
    estimatedGasWei: '100', approvals: [], unexpectedTransfers: [], postCallVerified: true };
  const result = domain.validateMintSimulation(evidence, { valueWei: '0', punkWallet: WALLET });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.executionAuthorized, false);
  const swapped = domain.validateMintSimulation({ ...evidence, nftReceiver: OTHER_WALLET },
    { valueWei: '0', punkWallet: WALLET });
  assert.equal(swapped.status, 'FAILED');
  assert.ok(swapped.reasons.includes('WRONG_NFT_RECEIVER'));
  assert.throws(() => domain.assertV2ExecutionCapability('AUTONOMOUS'),
    { code: 'SELF_FUNDED_AUTONOMOUS_GAS_UNSUPPORTED_BY_DEPLOYED_ACCOUNT' });
  assert.throws(() => domain.assertV2ExecutionCapability('ASSIST', { production: true }),
    { code: 'V2_PRODUCTION_AUTHORIZATION_REQUIRED' });
});
