import { decodeEventLog, keccak256, parseAbi } from 'viem';
import { assertDurableTrainingTransaction, serializeDurableTrainingReview, trainingDigest } from './durable-training-review.mjs';

const ABI = parseAbi([
  'event TrainingReviewApplied(uint256 indexed tokenId,uint256 indexed nonce,uint8 operation)',
  'event SkillLearned(uint256 indexed tokenId,bytes32 indexed key,uint8 level)',
  'event SlotUnlocked(uint256 indexed tokenId,uint8 totalSlots)',
  'event SkillEquipped(uint256 indexed tokenId,uint8 indexed slot,bytes32 indexed key)',
  'event SkillUnequipped(uint256 indexed tokenId,uint8 indexed slot,bytes32 indexed key)',
  'event RaritySlotsClaimed(uint256 indexed tokenId,uint8 startingSlots,bytes32 snapshotHash)',
]);
const OPERATIONS = ['learn', 'unlock', 'equip', 'unequip', 'claim_rarity'];
const ZERO = `0x${'0'.repeat(64)}`;
const isHash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) && value.toLowerCase() !== ZERO;
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const requireFact = condition => { if (!condition) throw Error('UNVERIFIED_TRAINING_RECEIPT'); };
const serialize = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const missing = error => error?.name === 'TransactionReceiptNotFoundError';

export function normalizeObservedTrainingTransaction(transaction) {
  requireFact(transaction && transaction.type === 'eip1559' && transaction.authorizationList == null
    && (transaction.accessList == null || Array.isArray(transaction.accessList) && transaction.accessList.length === 0)
    && Number.isSafeInteger(transaction.nonce) && transaction.nonce >= 0
    && ['value', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'].every(key => typeof transaction[key] === 'bigint')
    && typeof transaction.from === 'string' && typeof transaction.to === 'string' && isHash(transaction.hash));
  return { chainId: transaction.chainId, type: transaction.type,
    from: transaction.from.toLowerCase(), to: transaction.to.toLowerCase(),
    value: transaction.value.toString(), nonce: String(transaction.nonce), gas: transaction.gas.toString(),
    maxFeePerGas: transaction.maxFeePerGas.toString(), maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString(),
    data: transaction.input, hash: transaction.hash.toLowerCase() };
}

function checkedBlock(block) {
  requireFact(block && typeof block.number === 'bigint' && block.number >= 0n && isHash(block.hash)
    && typeof block.timestamp === 'bigint' && block.timestamp >= 0n);
  return block;
}
function verifyEvents(receipt, review, expectedSnapshotHash) {
  requireFact(Array.isArray(receipt.logs) && receipt.logs.length <= 64);
  const events = [];
  let lastIndex = -1;
  for (const log of receipt.logs) {
    requireFact(log && log.removed === false && equal(log.transactionHash, receipt.transactionHash)
      && equal(log.blockHash, receipt.blockHash) && log.blockNumber === receipt.blockNumber
      && Number.isSafeInteger(log.logIndex) && log.logIndex > lastIndex);
    lastIndex = log.logIndex;
    if (!equal(log.address, review.progression)) continue;
    requireFact(typeof log.data === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(log.data) && log.data.length <= 4098
      && Array.isArray(log.topics) && log.topics.length <= 4);
    const event = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics, strict: true });
    requireFact(event.args.tokenId === BigInt(review.tokenId));
    events.push(event);
  }
  const applied = events.at(-1);
  requireFact(applied?.eventName === 'TrainingReviewApplied' && applied.args.nonce === BigInt(review.guard.nonce)
    && applied.args.operation === OPERATIONS.indexOf(review.action.operation));
  const effects = events.slice(0, -1), { operation, skillKey, slot, startingSlots } = review.action;
  const last = effects.at(-1);
  if (operation === 'learn') requireFact(effects.length === 1 && last.eventName === 'SkillLearned'
    && equal(last.args.key, skillKey) && last.args.level === 1);
  if (operation === 'unlock') requireFact(effects.length === 1 && last.eventName === 'SlotUnlocked'
    && last.args.totalSlots >= 2 && last.args.totalSlots <= 7);
  if (operation === 'equip') {
    requireFact(effects.length >= 1 && effects.length <= 2 && last.eventName === 'SkillEquipped'
      && last.args.slot === slot && equal(last.args.key, skillKey));
    if (effects.length === 2) requireFact(effects[0].eventName === 'SkillUnequipped'
      && effects[0].args.slot === slot && isHash(effects[0].args.key));
  }
  if (operation === 'unequip') requireFact(effects.length === 1 && last.eventName === 'SkillUnequipped'
    && last.args.slot === slot && isHash(last.args.key));
  if (operation === 'claim_rarity') requireFact(effects.length === 1 && last.eventName === 'RaritySlotsClaimed'
    && last.args.startingSlots === startingSlots && equal(last.args.snapshotHash, expectedSnapshotHash));
  return events;
}

// Read-only attestation helper. Trusted runtime/snapshot pins MUST come from an
// independently reviewed deployment, not a browser. No signing or DB mutation.
// L2 inclusion is explicitly NOT a finalized receipt or a grant of tool authority.
export async function readDurableTrainingReceipt({ client, review, transactionHash,
  expectedRuntimeHash, expectedSnapshotHash, previousObservation = null }) {
  const serializedReview = serializeDurableTrainingReview(review);
  review = JSON.parse(serializedReview);
  requireFact(isHash(transactionHash) && isHash(expectedRuntimeHash) && isHash(expectedSnapshotHash));
  const head = checkedBlock(await client.getBlock({ blockTag: 'latest' }));
  requireFact(await client.getChainId() === review.chainId);
  const rawTransaction = await client.getTransaction({ hash: transactionHash });
  const transaction = normalizeObservedTrainingTransaction(rawTransaction);
  requireFact(equal(transaction.hash, transactionHash));
  assertDurableTrainingTransaction(review, transaction);
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: transactionHash }); }
  catch (error) { if (!missing(error)) throw error; }
  async function recheckHead() {
    const current = checkedBlock(await client.getBlock({ blockNumber: head.number }));
    requireFact(current.number === head.number && equal(current.hash, head.hash) && await client.getChainId() === review.chainId);
  }
  async function checkPriorReorg() {
    if (!previousObservation) return null;
    requireFact(['INCLUDED_SUCCESS', 'INCLUDED_REVERT'].includes(previousObservation.status)
      && equal(previousObservation.transactionHash, transactionHash)
      && typeof previousObservation.blockNumber === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(previousObservation.blockNumber)
      && isHash(previousObservation.blockHash) && BigInt(previousObservation.blockNumber) <= head.number);
    const canonical = checkedBlock(await client.getBlock({ blockNumber: BigInt(previousObservation.blockNumber) }));
    requireFact(canonical.number === BigInt(previousObservation.blockNumber));
    if (equal(canonical.hash, previousObservation.blockHash)) return null;
    await recheckHead();
    return { status: 'REORGED', transactionHash: transaction.hash, blockNumber: null, blockHash: null,
      checkedHeadNumber: head.number.toString(), checkedHeadHash: head.hash.toLowerCase(),
      evidenceHash: `0x${trainingDigest(serialize({ reviewHash: trainingDigest(serializedReview),
        previousObservation, canonicalBlockHash: canonical.hash, headHash: head.hash }))}` };
  }
  const priorReorg = await checkPriorReorg();
  if (priorReorg || !receipt) {
    await recheckHead();
    return { transaction, observation: priorReorg, status: priorReorg ? 'REORGED' : 'SUBMITTED',
      finalized: false, walletAuthority: 'NONE' };
  }
  requireFact(equal(receipt.transactionHash, transactionHash) && typeof receipt.blockNumber === 'bigint'
    && receipt.blockNumber <= head.number && isHash(receipt.blockHash)
    && equal(receipt.from, transaction.from) && equal(receipt.to, transaction.to)
    && rawTransaction.blockNumber === receipt.blockNumber && equal(rawTransaction.blockHash, receipt.blockHash)
    && ['success', 'reverted'].includes(receipt.status)
    && typeof receipt.gasUsed === 'bigint' && receipt.gasUsed > 0n && receipt.gasUsed <= BigInt(transaction.gas)
    && typeof receipt.effectiveGasPrice === 'bigint' && receipt.effectiveGasPrice >= 0n
    && receipt.effectiveGasPrice <= BigInt(transaction.maxFeePerGas));
  const block = checkedBlock(await client.getBlock({ blockNumber: receipt.blockNumber }));
  requireFact(block.number === receipt.blockNumber && equal(block.hash, receipt.blockHash)
    && BigInt(review.anchor.number) <= block.number);
  const anchor = checkedBlock(await client.getBlock({ blockNumber: BigInt(review.anchor.number) }));
  requireFact(anchor.number === BigInt(review.anchor.number) && equal(anchor.hash, review.anchor.hash)
    && anchor.timestamp === BigInt(review.anchor.timestamp));
  const code = await client.getCode({ address: review.progression, blockNumber: receipt.blockNumber });
  requireFact(typeof code === 'string' && code !== '0x' && equal(keccak256(code), expectedRuntimeHash));
  let events = [];
  if (receipt.status === 'success') {
    requireFact(block.timestamp >= BigInt(review.anchor.timestamp) && block.timestamp <= BigInt(review.guard.deadline));
    events = verifyEvents(receipt, review, expectedSnapshotHash);
  } else requireFact(Array.isArray(receipt.logs) && receipt.logs.length === 0);
  await recheckHead();
  const finalBlock = checkedBlock(await client.getBlock({ blockNumber: block.number }));
  requireFact(finalBlock.number === block.number && equal(finalBlock.hash, block.hash));
  const status = receipt.status === 'success' ? 'INCLUDED_SUCCESS' : 'INCLUDED_REVERT';
  const observation = { status, transactionHash: transaction.hash, blockNumber: block.number.toString(),
    blockHash: block.hash.toLowerCase(), checkedHeadNumber: head.number.toString(), checkedHeadHash: head.hash.toLowerCase(),
    evidenceHash: `0x${trainingDigest(serialize({ reviewHash: trainingDigest(serializedReview),
      transactionHash: transaction.hash, blockHash: block.hash, headHash: head.hash, runtimeHash: expectedRuntimeHash,
      status, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, events }))}` };
  return { transaction, observation, status, finalized: false, walletAuthority: 'NONE' };
}
