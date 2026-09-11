import { validateTrainingRelease, trainingDeploymentBinding } from './training-release.mjs';
import { readReviewedTrainingState, assertTrainingOwnerContinuity } from './training-state.mjs';
import { allocationLeaf, verifyAllocationProof } from './rarity-allocation.mjs';
import { TRAINING_REVIEW_SCHEMA, durableTrainingTransaction, serializeDurableTrainingReview } from './durable-training-review.mjs';
import { readDurableTrainingReceipt } from './training-receipt-verifier.mjs';

const ZERO = `0x${'0'.repeat(64)}`;
const fail = code => { throw Error(code); };
function actionInput(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).some(key => !['operation','skillKey','slot'].includes(key))
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(item => !Object.hasOwn(item,'value'))
    || !['learn','unlock','equip','unequip','claim_rarity'].includes(input.operation)) fail('FORGE_TRAINING_ACTION_INVALID');
  const action = { operation: input.operation, skillKey: input.skillKey ?? ZERO, slot: input.slot ?? 0, startingSlots: 0, rarityProof: [] };
  if (!/^0x[0-9a-f]{64}$/.test(action.skillKey) || !Number.isInteger(action.slot) || action.slot < 0 || action.slot >= 7
    || (['learn','equip'].includes(action.operation) ? action.skillKey === ZERO : action.skillKey !== ZERO)
    || (!['equip','unequip'].includes(action.operation) && action.slot !== 0)) fail('FORGE_TRAINING_ACTION_INVALID');
  return action;
}

// Server-only. The wallet is deliberately absent. prepare produces an expiring
// review; claim commits the one-shot reservation before returning exact calldata.
export function createTrainingCoordinator({ pool, storeFactory, client, release: input, allocationReader,
  now = Date.now, localFixture = false }) {
  const release = validateTrainingRelease(input, { localFixture });
  if (release.status !== 'OWNER_CANARY') fail('FORGE_TRAINING_NOT_RELEASED');
  const binding = trainingDeploymentBinding(release);
  const store = storeFactory({ pool, deployment: binding });
  const state = (owner, tokenId) => readReviewedTrainingState({ client, release, owner, tokenId, now });
  const continuity = (review, anchor = review.anchor) => assertTrainingOwnerContinuity({ client, release,
    owner: review.owner, tokenId: review.tokenId, anchor, now });
  const scope = ({ intentId, owner, tokenId }) => ({ intentId, owner, tokenId });
  const authorize = async identity => {
    const current = await state(identity.owner,identity.tokenId);
    return current;
  };
  async function verifyAction(action, current) {
    const skill = current.skills.find(item => item.key === action.skillKey);
    if (['learn','equip'].includes(action.operation) && (!skill?.available || (action.operation === 'learn' ? skill.level !== 0 : skill.level !== 1))) fail('FORGE_TRAINING_SKILL_UNAVAILABLE');
    if (['learn','unlock'].includes(action.operation) && BigInt(current.credits) < 1n) fail('FORGE_TRAINING_NO_CREDIT');
    if (action.operation === 'unlock' && (current.claimed === 0 || current.slots >= 7)) fail('FORGE_TRAINING_SLOT_UNAVAILABLE');
    if (['equip','unequip'].includes(action.operation) && action.slot >= current.slots) fail('FORGE_TRAINING_SLOT_UNAVAILABLE');
    if (action.operation === 'equip' && current.equipped.includes(action.skillKey)) fail('FORGE_TRAINING_ALREADY_EQUIPPED');
    if (action.operation === 'unequip' && current.equipped[action.slot] === ZERO) fail('FORGE_TRAINING_SLOT_EMPTY');
    if (action.operation === 'claim_rarity') {
      if (current.claimed !== 0 || typeof allocationReader !== 'function') fail('FORGE_TRAINING_RARITY_UNAVAILABLE');
      const allocation = await allocationReader(current.tokenId);
      const leaf = allocationLeaf({ ...binding, snapshotHash: release.snapshotHash, tokenId: current.tokenId, startingSlots: allocation.startingSlots });
      if (!verifyAllocationProof(leaf, allocation.proof, release.allocationRoot)) fail('FORGE_TRAINING_RARITY_UNVERIFIED');
      action.startingSlots = allocation.startingSlots; action.rarityProof = [...allocation.proof];
    }
    return action;
  }
  async function nonce(owner) {
    const values = await Promise.all(['latest','pending'].map(blockTag => client.getTransactionCount({ address: owner, blockTag })));
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0) || values[0] !== values[1]) fail('FORGE_TRAINING_WALLET_PENDING');
    return String(values[0]);
  }
  const callOf = review => {
    const tx = durableTrainingTransaction(review);
    return { account: tx.from, to: tx.to, data: tx.data, value: 0n,
      gas: BigInt(tx.gas), maxFeePerGas: BigInt(tx.maxFeePerGas), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas) };
  };
  async function preflight(review) {
    if (Math.floor(now()/1000) + 5 >= Number(review.guard.deadline)) fail('FORGE_TRAINING_REVIEW_EXPIRED');
    if (await nonce(review.owner) !== review.transaction.nonce) fail('FORGE_TRAINING_NONCE_CHANGED');
    const call = callOf(review);
    const [gas, balance, block] = await Promise.all([
      client.estimateGas(call), client.getBalance({ address: review.owner, blockTag: 'pending' }), client.getBlock({ blockTag: 'latest' }),
    ]);
    if (typeof gas !== 'bigint' || gas <= 0n || gas > call.gas || typeof balance !== 'bigint'
      || balance < call.gas * call.maxFeePerGas || typeof block.baseFeePerGas !== 'bigint'
      || block.baseFeePerGas + call.maxPriorityFeePerGas > call.maxFeePerGas
      || call.gas * call.maxFeePerGas > BigInt(release.feeCeilingWei)) fail('FORGE_TRAINING_FEE_CHANGED');
    await client.call(call);
    await continuity(review);
  }
  async function prepare({ owner, tokenId, action: userAction, requestKey }) {
    const action = actionInput(userAction);
    const current = await state(owner,tokenId);
    let replay = await store.getByRequestKey({ owner,tokenId,requestKey });
    if (replay) {
      if (['operation','skillKey','slot'].some(key => action[key] !== replay.review.action[key])) fail('TRAINING_IDEMPOTENCY_CONFLICT');
      if(replay.status==='PREPARED' && replay.expired)replay=await store.cancelPrepared({intentId:replay.intentId,owner,tokenId},replay.revision);
      await continuity({ owner,tokenId,anchor: current.anchor });
      return { record: replay, transaction: durableTrainingTransaction(replay.review),
        feeCeilingWei: String(BigInt(replay.review.transaction.gas)*BigInt(replay.review.transaction.maxFeePerGas)) };
    }
    await verifyAction(action,current);
    const [ownerNonce, fees] = await Promise.all([nonce(owner),client.estimateFeesPerGas({ type: 'eip1559' })]);
    if (typeof fees.maxFeePerGas !== 'bigint' || fees.maxFeePerGas <= 0n || typeof fees.maxPriorityFeePerGas !== 'bigint'
      || fees.maxPriorityFeePerGas < 0n || fees.maxPriorityFeePerGas > fees.maxFeePerGas) fail('FORGE_TRAINING_FEE_UNAVAILABLE');
    const review = { schema: TRAINING_REVIEW_SCHEMA, ...binding, owner, tokenId, action,
      guard: { nonce: current.nonce, stateHash: current.stateHash, deadline: String(BigInt(current.anchor.timestamp)+45n) },
      anchor: current.anchor, transaction: { nonce: ownerNonce, gas: '2000000',
        maxFeePerGas: String(fees.maxFeePerGas), maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas) } };
    const estimate = await client.estimateGas(callOf(review));
    if (typeof estimate !== 'bigint' || estimate <= 0n) fail('FORGE_TRAINING_GAS_UNAVAILABLE');
    review.transaction.gas = String((estimate*120n+99n)/100n);
    serializeDurableTrainingReview(review);
    await preflight(review);
    const record = await store.prepare({ requestKey,review });
    await continuity(review);
    return { record, transaction: durableTrainingTransaction(record.review), feeCeilingWei: String(BigInt(review.transaction.gas)*fees.maxFeePerGas) };
  }
  async function claim(identity, revision, reviewHash) {
    const current = await authorize(identity);
    const record = await store.get(scope(identity));
    if (!record) fail('TRAINING_INTENT_NOT_FOUND');
    // A replay returns storage state but can never reopen an earlier wallet prompt.
    if (record.status !== 'PREPARED') return { claimed: false, record };
    if (current.nonce !== record.review.guard.nonce || current.stateHash !== record.review.guard.stateHash) fail('FORGE_TRAINING_STATE_CHANGED');
    const checkedAction = await verifyAction({ ...record.review.action },current);
    if (JSON.stringify(checkedAction) !== JSON.stringify(record.review.action)) fail('FORGE_TRAINING_ACTION_CHANGED');
    await preflight(record.review);
    const result = await store.claim(scope(identity),revision,reviewHash);
    if (result.claimed) await continuity(record.review);
    return { ...result, ...(result.claimed ? { transaction: durableTrainingTransaction(record.review) } : {}) };
  }
  async function get(identity) {
    const current = await authorize(identity);
    let record = identity.intentId ? await store.get(scope(identity)) : null;
    if(record?.status==='PREPARED' && record.expired)record=await store.cancelPrepared(scope(identity),record.revision);
    const held = await store.hasUnresolvedTraining(identity.tokenId);
    await continuity({ ...identity, anchor: current.anchor });
    return { record, held, state: current, release: { ...binding, registry: release.registry,
      progressionCodeHash: release.progressionCodeHash, snapshotHash: release.snapshotHash } };
  }
  async function mutate(identity, operation, revision, transactionHash) {
    const current = await authorize(identity);
    const record = await store.get(scope(identity));
    if (!record) fail('TRAINING_INTENT_NOT_FOUND');
    await continuity({ ...identity, anchor: current.anchor });
    let result;
    if (operation === 'cancel') result = await store.cancelPrepared(scope(identity),revision);
    else if (operation === 'unknown') result = await store.markUnknown(scope(identity),revision);
    else if (operation === 'recover') {
      const evidence = await readDurableTrainingReceipt({ client, review: record.review, transactionHash,
        expectedRuntimeHash: release.progressionCodeHash, expectedSnapshotHash: release.snapshotHash,
        previousObservation: ['INCLUDED_SUCCESS','INCLUDED_REVERT'].includes(record.status) ? record.observation : null });
      result = await store.bindVerifiedTransaction(scope(identity),revision,evidence.transaction);
      // The request role only binds the RPC-verified transaction. Receipt/reorg
      // observations and terminal settlement belong to the restricted worker.
    } else fail('FORGE_TRAINING_ACTION_INVALID');
    await continuity({ ...identity, anchor: current.anchor });
    return result;
  }
  return Object.freeze({ prepare,claim,get,mutate });
}
