import { isDeepStrictEqual } from 'node:util';
import { getAddress } from 'viem';
import { normalizePunkCollectingIntent, punkCollectingIntentHash } from '../collecting-intent.mjs';
import { normalizeV2Opportunity } from '../opportunity.mjs';
import { matchV2Opportunity } from '../policy-matcher.mjs';
import { simulateOwnerAssistedSeaDropMint } from '../owner-assisted-seadrop-mint.mjs';
import { ROBINHOOD } from '../../config.mjs';

const UINT = /^(0|[1-9][0-9]{0,77})$/;
const HASH = /^0x[0-9a-f]{64}$/i;
const fail = code => { throw Error(code); };
function plain(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some(key => typeof key !== 'string'
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail('MINT_CONTEXT_INVALID');
  return value;
}
function snapshot(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  plain(value);
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)])));
}
function context(value, identity, now) {
  plain(value); plain(value.authority); plain(value.usage);
  const intent = normalizePunkCollectingIntent(value.intent, now);
  const opportunity = normalizeV2Opportunity(value.opportunity, now);
  const authority = value.authority;
  if (intent.punkTokenId !== identity.tokenId || intent.expectedOwner !== identity.owner.toLowerCase()
    || authority.chainId !== 4663 || authority.collection?.toLowerCase() !== ROBINHOOD.canonicalCollection
    || String(authority.tokenId) !== identity.tokenId || getAddress(authority.owner) !== getAddress(identity.owner)
    || getAddress(authority.punkWallet) !== getAddress(intent.punkWallet)
    || authority.activated !== true || !UINT.test(authority.nativeBalanceWei)
    || !UINT.test(String(authority.blockNumber)) || !HASH.test(authority.blockHash)
    || !Number.isSafeInteger(authority.blockTime) || now.getTime() < authority.blockTime
    || now.getTime() - authority.blockTime > 30_000
    || opportunity.opportunityId !== identity.opportunityId
    || opportunity.priceWei !== '0' || opportunity.screeningStatus !== 'PASSED'
    || opportunity.expectedNftReceiver !== null && opportunity.expectedNftReceiver !== intent.punkWallet
    || intent.requireSimulation !== true || !Number.isSafeInteger(value.strategyVersion) || value.strategyVersion < 1
    || value.strategyHash !== punkCollectingIntentHash(intent, now)) fail('MINT_CONTEXT_MISMATCH');
  for (const name of ['dailyMints', 'totalMints', 'opportunityMints']) {
    if (!Number.isSafeInteger(value.usage[name]) || value.usage[name] < 0) fail('MINT_USAGE_UNAVAILABLE');
  }
  const state = { currentOwner: authority.owner, punkWallet: authority.punkWallet,
    punkWalletBalanceWei: authority.nativeBalanceWei, dailyMints: value.usage.dailyMints,
    totalMints: value.usage.totalMints, opportunityMints: value.usage.opportunityMints };
  return snapshot({ intent, opportunity, authority: { owner: authority.owner, punkWallet: authority.punkWallet,
    activated: true, blockNumber: String(authority.blockNumber), blockHash: authority.blockHash,
    blockTime: authority.blockTime }, state, strategyHash: value.strategyHash, strategyVersion: value.strategyVersion });
}
function samePlan(before, after) {
  if (!isDeepStrictEqual(before.intent, after.intent) || !isDeepStrictEqual(before.opportunity, after.opportunity)
    || before.strategyHash !== after.strategyHash || before.strategyVersion !== after.strategyVersion
    || BigInt(after.authority.blockNumber) < BigInt(before.authority.blockNumber)
    || after.authority.blockNumber === before.authority.blockNumber && after.authority.blockHash !== before.authority.blockHash) {
    fail('MINT_CONTEXT_CHANGED');
  }
}
function match(intent, opportunity, state, now) {
  const decision = matchV2Opportunity(intent, opportunity, state, now);
  return { matched: decision.matched, reasons: decision.reasons, matchScore: decision.matchScore,
    matchReasons: decision.matchReasons, requiredBalanceWei: decision.requiredBalanceWei };
}

// readContext is a server-owned DB/owner service. It resolves one shared
// opportunity and the current confirmed strategy; no per-Punk scan is started.
// All returned tools are read-only. prepare_mint creates a recommendation, not a
// wallet artifact or durable execution reservation. The existing owner-confirmed
// mint flow must perform those independent steps before any economic action.
export function createMintHunterV1({ client, readContext, now = () => new Date(), timeoutMs = 12_000 }) {
  if (typeof readContext !== 'function' || typeof now !== 'function' || !client
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12_000) fail('MINT_SERVICES_UNAVAILABLE');
  async function run(identity, action) {
    if (!identity || typeof identity.opportunityId !== 'string'
      || !/^[a-zA-Z0-9:_-]{8,256}$/.test(identity.opportunityId)) fail('MINT_OPPORTUNITY_INVALID');
    const read = async () => context(await readContext(identity), identity, new Date(now()));
    const before = await read();
    const initial = match(before.intent, { ...before.opportunity, simulationStatus: 'PENDING', expectedNftReceiver: before.intent.punkWallet }, before.state, new Date(now()));
    const blocking = initial.reasons.filter(reason => reason !== 'SIMULATION_NOT_PASSED');
    if (blocking.length) return report(before, action, { ...initial, matched: false }, null, 'POLICY_BLOCKED');
    if (action === 'inspect_mint') return report(before, action, initial, null, 'INSPECTED');
    if (action === 'prepare_mint' && before.intent.operatingMode !== 'ASSIST') fail('MINT_ASSIST_REQUIRED');
    if (await client.getChainId() !== 4663) fail('MINT_WRONG_CHAIN');
    const authorityBlock = await client.getBlock({ blockNumber: BigInt(before.authority.blockNumber) });
    if (authorityBlock.hash !== before.authority.blockHash) fail('MINT_ANCHOR_CHANGED');
    let simulatedBlock;
    const simulationClient = Object.assign(Object.create(client), { getBlock: async request => {
      const block = await client.getBlock(request); simulatedBlock = block; return block;
    } });
    const simulation = await simulateOwnerAssistedSeaDropMint({ client: simulationClient, authority: before.authority,
      opportunity: before.opportunity, now: new Date(now()) });
    const canonical = await client.getBlock({ blockNumber: BigInt(simulation.evidence.pinnedBlock) });
    if (!simulatedBlock || canonical.hash !== simulatedBlock.hash || !HASH.test(canonical.hash)
      || canonical.number !== simulatedBlock.number || canonical.timestamp !== simulatedBlock.timestamp
      || canonical.number < BigInt(before.authority.blockNumber)
      || BigInt(Math.floor(new Date(now()).getTime() / 1000)) - canonical.timestamp > 30n
      || canonical.timestamp > BigInt(Math.floor(new Date(now()).getTime() / 1000))
      || await client.getChainId() !== 4663) fail('MINT_ANCHOR_CHANGED');
    const after = await read(); samePlan(before, after);
    const simulated = { ...after.opportunity, expectedNftReceiver: after.intent.punkWallet,
      simulationStatus: 'PASSED', estimatedGasCostWei: simulation.evidence.estimatedGasWei };
    const decision = match(after.intent, simulated, after.state, new Date(now()));
    return report(after, action, decision, simulation.evidence,
      decision.matched ? action === 'prepare_mint' ? 'OWNER_REVIEW_REQUIRED' : 'SIMULATED' : 'POLICY_BLOCKED');
  }
  function report(value, action, policy, evidence, status) {
    return Object.freeze({ schema: 'GOGH_MINT_HUNTER_REVIEW_V1', action, status, chainId: 4663,
      opportunityId: value.opportunity.opportunityId, collection: value.opportunity.collectionContract,
      collectionName: value.opportunity.collectionName, punkWallet: value.intent.punkWallet,
      mintPriceWei: '0', quantity: '1', policy,
      simulation: evidence ? { status: evidence.status, callDidNotRevert: evidence.callDidNotRevert,
        estimatedGasWei: evidence.estimatedGasWei, pinnedBlock: evidence.pinnedBlock,
        simulatedAt: evidence.simulatedAt, effectTraceAvailable: false, postconditionPendingReceipt: true }
        : { status: 'NOT_RUN', effectTraceAvailable: false },
      budget: { maxGasPerMintWei: value.intent.maxGasPerMintWei, minimumReserveWei: value.intent.minimumReserveWei },
      sourceUrls: value.opportunity.sourceUrls, strategyHash: value.strategyHash,
      strategyVersion: value.strategyVersion, ownerConfirmationRequired: true,
      executionReservationRequired: true, freshOwnerReviewRequired: true,
      walletAuthority: 'NONE', executable: false, transaction: null, transactionSubmitted: false,
      limitations: ['Simulation is an exact call check, not a guarantee of final NFT delivery.',
        'A separate owner review must refresh policy, simulation and durable idempotency before signing.'] });
  }
  async function bounded(identity, action) {
    let timer;
    try {
      return await Promise.race([run(identity, action), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('MINT_RESEARCH_TIMEOUT')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ inspectMint: identity => bounded(identity, 'inspect_mint'),
    simulateMint: identity => bounded(identity, 'simulate_mint'), prepareMint: identity => bounded(identity, 'prepare_mint') });
}
