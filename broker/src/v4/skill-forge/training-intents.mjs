import { randomBytes, createHash } from 'node:crypto';
import { parseAbi, encodeFunctionData, decodeEventLog } from 'viem';

const ABI = parseAbi([
  'function applyTrainingReview((uint256 tokenId,uint8 operation,bytes32 skillKey,uint8 slot,uint8 startingSlots,bytes32[] rarityProof,uint256 nonce,bytes32 stateHash,uint64 deadline) review)',
  'event TrainingReviewApplied(uint256 indexed tokenId,uint256 indexed nonce,uint8 operation)',
  'function learnSkill(uint256 tokenId,bytes32 key)', 'function unlockSlot(uint256 tokenId)',
  'function equipSkill(uint256 tokenId,uint8 slot,bytes32 key)', 'function unequipSkill(uint256 tokenId,uint8 slot)',
  'event SkillLearned(uint256 indexed tokenId,bytes32 indexed key,uint8 level)',
  'event SlotUnlocked(uint256 indexed tokenId,uint8 totalSlots)',
  'event SkillEquipped(uint256 indexed tokenId,uint8 indexed slot,bytes32 indexed key)',
  'event SkillUnequipped(uint256 indexed tokenId,uint8 indexed slot,bytes32 indexed key)',
]);
const ZERO = `0x${'0'.repeat(64)}`;
const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const serialize = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const fingerprint = state => createHash('sha256').update(serialize([
  state.chainId, state.collection, state.registry, state.progression, state.tokenId, state.owner,
  state.credits, state.slots, state.cap, state.learned, state.equipped, state.ownershipEpoch ?? null,
  ...(state.trainingGuard ? [state.trainingGuard.protocol, state.trainingGuard.nonce, state.trainingGuard.stateHash] : []),
])).digest('hex');
const REVIEW_PROTOCOL = 'GOGH_ORIGINAL_PUNK_TRAINING_REVIEW_V1';
const OPERATIONS = ['learn', 'unlock', 'equip', 'unequip'];

// Only disposable deployments may instantiate this coordinator. No production sender exists.
// Deployment addresses, owner, approved keys, reader and signer are trusted harness inputs.
export function createLocalTrainingIntents({ client, owner, progression, approvedKeys, readSnapshot,
  sendTransaction, now = Date.now, lifetimeMs = 60_000, journal = null, reviewed = false }) {
  if (typeof reviewed !== 'boolean' || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > 60_000) throw Error('INVALID_REVIEW_CONFIGURATION');
  const intents = new Map();
  let journalFault = false;
  let journalFailure = null;
  const persist = entry => {
    if (!journal) return;
    try { journal.save(entry); } catch (error) { journalFault = true; journalFailure = error; throw error; }
  };
  const refreshJournal = () => {
    if (journalFault) throw new Error('TRAINING_JOURNAL_UNAVAILABLE', { cause: journalFailure });
    if (!journal) return;
    try {
      for (const saved of journal.loadAll()) {
        if (intents.get(saved.review.intentId)?.busy) continue;
        if (!eq(saved.review.owner, owner) || !eq(saved.review.progression, progression)
          || saved.review.chainId !== 31337 || saved.review.localOnly !== true || saved.review.productionAuthority !== false) throw Error('INVALID_RECOVERED_REVIEW');
        const spec = reviewedAction(saved.input, saved.state, saved.review.trainingGuard, saved.review.expiresAt);
        if (saved.expiresAt !== saved.review.expiresAt) throw Error('INVALID_RECOVERED_REVIEW');
        if (encodeFunctionData({ abi: ABI, functionName: spec.functionName, args: spec.args }) !== saved.review.transaction.data
          || !eq(saved.review.transaction.to, progression) || saved.review.transaction.value !== '0x0'
          || !/^0x(0|[1-9a-f][0-9a-f]{0,13})$/i.test(saved.review.transaction.nonce)
          || BigInt(saved.review.transaction.nonce) > BigInt(Number.MAX_SAFE_INTEGER)
          || saved.digest !== fingerprint(saved.state)) throw Error('INVALID_RECOVERED_REVIEW');
        intents.set(saved.review.intentId, { ...saved, spec });
      }
    } catch (error) { journalFault = true; journalFailure = error; throw error; }
  };
  const unresolved = entry => ['CHECKING', 'AWAITING_WALLET', 'SUBMITTED', 'SUBMISSION_UNKNOWN'].includes(entry.status);
  const guard = async () => { if (await client.getChainId() !== 31337) throw Error('LOCAL_CHAIN_REQUIRED'); };
  async function stateFor(tokenId) {
    await guard(); const state = await readSnapshot(tokenId);
    if (state.localOnly !== true || state.chainId !== 31337 || state.canBurn !== false
      || String(state.tokenId) !== String(tokenId) || !eq(state.owner, owner) || !eq(state.progression, progression)) throw Error('OWNER_OR_DEPLOYMENT_CHANGED');
    if (reviewed !== Boolean(state.trainingGuard)) throw Error('TRAINING_PROTOCOL_CHANGED');
    return state;
  }
  function action(input, state) {
    if (!input || Array.isArray(input) || Object.keys(input).some(k => !['tokenId', 'operation', 'key', 'slot', 'expectedBlock'].includes(k))
      || ![1, 44, 7].includes(input.tokenId) || !['learn', 'unlock', 'equip', 'unequip'].includes(input.operation)
      || !/^\d+$/.test(input.expectedBlock)) throw Error('INVALID_TRAINING_ACTION');
    const { operation, key, slot, tokenId } = input;
    if (['learn', 'equip'].includes(operation) && !approvedKeys.includes(key)) throw Error('SKILL_NOT_APPROVED');
    if (['equip', 'unequip'].includes(operation) && (!Number.isInteger(slot) || slot < 0 || slot >= state.slots)) throw Error('SLOT_LOCKED');
    if (operation === 'learn' && (slot !== undefined || state.learned.some(x => x.key === key))) throw Error('ALREADY_LEARNED_OR_INVALID_SLOT');
    if (operation === 'unlock' && (key !== undefined || slot !== undefined || state.slots >= state.cap)) throw Error('INVALID_SLOT_UNLOCK');
    if (operation === 'unequip' && (key !== undefined || state.equipped[slot] === ZERO)) throw Error('EMPTY_SLOT');
    if (['learn', 'unlock'].includes(operation) && BigInt(state.credits) < 1n) throw Error('NO_CREDIT');
    const spec = operation === 'learn' ? ['learnSkill', [BigInt(tokenId), key], 'SkillLearned']
      : operation === 'unlock' ? ['unlockSlot', [BigInt(tokenId)], 'SlotUnlocked']
        : operation === 'equip' ? ['equipSkill', [BigInt(tokenId), slot, key], 'SkillEquipped']
          : ['unequipSkill', [BigInt(tokenId), slot], 'SkillUnequipped'];
    return { functionName: spec[0], args: spec[1], eventName: spec[2] };
  }
  function reviewedAction(input, state, guard, expiresAt) {
    const spec = action(input, state);
    if (!reviewed) {
      if (guard !== undefined || state.trainingGuard !== undefined) throw Error('TRAINING_PROTOCOL_CHANGED');
      return spec;
    }
    const chainGuard = state.trainingGuard;
    if (!guard || Object.keys(guard).sort().join(',') !== 'deadline,nonce,protocol,stateHash'
      || guard.protocol !== REVIEW_PROTOCOL || chainGuard?.protocol !== REVIEW_PROTOCOL
      || !/^(0|[1-9]\d{0,77})$/.test(guard.nonce) || guard.nonce !== String(chainGuard.nonce)
      || BigInt(guard.nonce) >= 2n ** 256n || !/^0x[0-9a-f]{64}$/i.test(guard.stateHash)
      || !eq(guard.stateHash, chainGuard.stateHash) || eq(guard.stateHash, ZERO)
      || !/^\d{1,12}$/.test(guard.deadline) || !Number.isSafeInteger(expiresAt)
      || BigInt(guard.deadline) * 1000n !== BigInt(expiresAt)
      || !/^\d{1,12}$/.test(String(chainGuard.blockTimestamp))
      || BigInt(guard.deadline) < BigInt(chainGuard.blockTimestamp)
      || BigInt(guard.deadline) > BigInt(chainGuard.blockTimestamp) + 60n) throw Error('INVALID_TRAINING_GUARD');
    return { ...spec, functionName: 'applyTrainingReview', args: [{ tokenId: BigInt(input.tokenId),
      operation: OPERATIONS.indexOf(input.operation), skillKey: input.key ?? ZERO, slot: input.slot ?? 0,
      startingSlots: 0, rarityProof: [], nonce: BigInt(guard.nonce), stateHash: guard.stateHash, deadline: BigInt(guard.deadline) }] };
  }
  async function prepare(input) {
    refreshJournal();
    if (!input || ![1, 44, 7].includes(input.tokenId)) throw Error('INVALID_TEST_PUNK');
    await auditRecordedReceipts(input.tokenId);
    if ([...intents.values()].some(entry => entry.input.tokenId === input.tokenId && unresolved(entry))) throw Error('TRAINING_TRANSACTION_UNRESOLVED');
    // Expired reviews can be discarded, but submitted hashes are retained for this process.
    if (!journal) for (const [id, entry] of intents) if (entry.status === 'PREPARED' && entry.expiresAt < now()) intents.delete(id);
    if (intents.size >= (journal ? 4096 : 128)) throw Error('LOCAL_REVIEW_LIMIT');
    const state = await stateFor(input.tokenId);
    const createdAt = now();
    let expiresAt = createdAt + lifetimeMs, trainingGuard;
    if (reviewed) {
      const timestamp = state.trainingGuard?.blockTimestamp;
      if (!/^\d{1,12}$/.test(String(timestamp))) throw Error('INVALID_TRAINING_GUARD');
      expiresAt = Math.min(Math.floor(expiresAt / 1000), Number(timestamp) + 60) * 1000;
      if (expiresAt <= createdAt) throw Error('TRAINING_REVIEW_EXPIRED');
      trainingGuard = { protocol: REVIEW_PROTOCOL, nonce: String(state.trainingGuard.nonce),
        stateHash: state.trainingGuard.stateHash, deadline: String(expiresAt / 1000) };
    }
    const spec = reviewedAction(input, state, trainingGuard, expiresAt);
    if (String(state.blockNumber) !== input.expectedBlock) throw Error('STALE_REVIEW_STATE');
    const call = { address: progression, abi: ABI, functionName: spec.functionName, args: spec.args, account: owner };
    await client.simulateContract(call);
    const data = encodeFunctionData(call);
    const [estimate, gasPrice, nonce] = await Promise.all([client.estimateGas({ account: owner, to: progression, data, value: 0n }), client.getGasPrice(),
      client.getTransactionCount({ address: owner, blockTag: 'pending' })]);
    const gas = (estimate * 120n + 99n) / 100n;
    if (gas > 500_000n || gasPrice <= 0n || !Number.isSafeInteger(nonce) || nonce < 0) throw Error('LOCAL_GAS_OR_NONCE_BOUND_EXCEEDED');
    const latest = await stateFor(input.tokenId);
    if (fingerprint(latest) !== fingerprint(state)) throw Error('STATE_CHANGED_DURING_PREPARATION');
    const intentId = randomBytes(32).toString('hex');
    const transaction = Object.freeze({ from: owner, to: progression, data, value: '0x0', chainId: '0x7a69',
      gas: `0x${gas.toString(16)}`, gasPrice: `0x${gasPrice.toString(16)}`, nonce: `0x${nonce.toString(16)}` });
    const review = Object.freeze({ intentId, localOnly: true, chainId: 31337, tokenId: input.tokenId,
      owner, progression, operation: input.operation, skillKey: input.key ?? null, slot: input.slot ?? null,
      creditCost: ['learn', 'unlock'].includes(input.operation) ? 1 : 0,
      estimatedGas: estimate.toString(), maximumGas: gas.toString(), maximumNetworkFeeWei: (gas * gasPrice).toString(),
      createdAt, expiresAt, transaction, productionAuthority: false, ...(reviewed ? { trainingGuard } : {}) });
    const entry = { review, input: { ...input }, spec, state, digest: fingerprint(state), expiresAt, status: 'PREPARED', transactionHash: null };
    persist(entry); intents.set(intentId, entry);
    return review;
  }
  async function reconcile(entry) {
    await guard();
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: entry.transactionHash }); }
    catch { entry.status = 'SUBMITTED'; return outcome(entry); }
    const transaction = await client.getTransaction({ hash: entry.transactionHash });
    const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
    verifyTransaction(entry, transaction, entry.transactionHash);
    if (!['success', 'reverted'].includes(receipt.status) || !eq(receipt.transactionHash, entry.transactionHash)
      || !eq(canonical.hash, receipt.blockHash)
      || typeof receipt.gasUsed !== 'bigint' || typeof receipt.effectiveGasPrice !== 'bigint'
      || receipt.gasUsed <= 0n || receipt.effectiveGasPrice <= 0n
      || receipt.gasUsed * receipt.effectiveGasPrice > BigInt(entry.review.maximumNetworkFeeWei)) throw Error('UNVERIFIED_TRAINING_RECEIPT');
    if (receipt.status === 'reverted') { entry.status = 'REVERTED'; return outcome(entry); }
    if (reviewed) {
      const applied = receipt.logs.flatMap(log => {
        if (!eq(log.address, progression)) return [];
        try { const event = decodeEventLog({ abi: ABI, topics: log.topics, data: log.data });
          return event.eventName === 'TrainingReviewApplied' ? [event] : [];
        } catch { return []; }
      });
      if (applied.length !== 1 || applied[0].args.tokenId !== BigInt(entry.input.tokenId)
        || applied[0].args.nonce !== BigInt(entry.review.trainingGuard.nonce)
        || applied[0].args.operation !== OPERATIONS.indexOf(entry.input.operation)) throw Error('TRAINING_REVIEW_EVENT_MISMATCH');
    }
    const events = receipt.logs.flatMap(log => {
      if (!eq(log.address, progression)) return [];
      try { const event = decodeEventLog({ abi: ABI, topics: log.topics, data: log.data });
        return event.eventName === entry.spec.eventName && event.args.tokenId === BigInt(entry.input.tokenId) ? [event] : [];
      } catch { return []; }
    });
    const event = events[0], { operation, slot, key } = entry.input;
    if (events.length !== 1 || (operation === 'learn' && (event.args.key !== key || event.args.level !== 1))
      || (operation === 'unlock' && event.args.totalSlots !== entry.state.slots + 1)
      || (operation === 'equip' && (event.args.key !== key || event.args.slot !== slot))
      || (operation === 'unequip' && (event.args.slot !== slot || event.args.key !== entry.state.equipped[slot]))) throw Error('TRAINING_EVENT_MISMATCH');
    // Block/event verification is not finality; retain this evidence for rechecking on retry.
    entry.status = 'CONFIRMED'; entry.blockHash = receipt.blockHash;
    return outcome(entry);
  }
  function verifyTransaction(entry, transaction, hash) {
    if (!eq(transaction.hash, hash) || !eq(transaction.from, owner) || !eq(transaction.to, progression)
      || transaction.input !== entry.review.transaction.data || transaction.value !== 0n
      || !Number.isSafeInteger(transaction.nonce) || BigInt(transaction.nonce) !== BigInt(entry.review.transaction.nonce)
      || typeof transaction.gas !== 'bigint' || typeof transaction.gasPrice !== 'bigint'
      || transaction.gas <= 0n || transaction.gasPrice <= 0n
      || transaction.gas > BigInt(entry.review.transaction.gas) || transaction.gasPrice > BigInt(entry.review.transaction.gasPrice)) throw Error('UNVERIFIED_TRAINING_TRANSACTION');
  }
  async function outcome(entry, status = entry.status) {
    if (!entry.busy || status === entry.status) persist(entry);
    let snapshot = null;
    if (status === 'CONFIRMED') { try { snapshot = await stateFor(entry.input.tokenId); } catch { } }
    return { localOnly: true, chainId: 31337, productionAuthority: false, status, intentId: entry.review.intentId,
      transactionHash: entry.transactionHash, blockHash: entry.blockHash ?? null, snapshot };
  }
  async function confirm(intentId) {
    refreshJournal();
    let entry = intents.get(intentId); if (!entry) throw Error('UNKNOWN_TRAINING_REVIEW');
    if (entry.busy) return outcome(entry, entry.transactionHash ? 'SUBMITTED' : 'AWAITING_WALLET');
    // Preserve ambiguity/rejection on retries; never turn UNKNOWN into a fresh review.
    if (!entry.transactionHash && entry.status !== 'PREPARED') return outcome(entry);
    if (!entry.transactionHash) {
      await auditRecordedReceipts(entry.input.tokenId);
      entry = intents.get(intentId);
      if (entry.busy) return outcome(entry, entry.transactionHash ? 'SUBMITTED' : 'AWAITING_WALLET');
      if (!entry.transactionHash && entry.status !== 'PREPARED') return outcome(entry);
    }
    if ([...intents.values()].some(other => other !== entry && other.input.tokenId === entry.input.tokenId && unresolved(other))) throw Error('TRAINING_TRANSACTION_UNRESOLVED');
    entry.busy = true;
    try {
      if (entry.transactionHash) return await reconcile(entry); // Never broadcast again after a known hash.
      if (entry.status !== 'PREPARED') throw Error('TRAINING_REVIEW_CONSUMED');
      entry.status = 'CHECKING';
      persist(entry);
      if (now() > entry.expiresAt) throw Error('TRAINING_REVIEW_EXPIRED');
      const state = await stateFor(entry.input.tokenId);
      if (fingerprint(state) !== entry.digest) throw Error('TRAINING_STATE_CHANGED');
      await client.simulateContract({ address: progression, abi: ABI, functionName: entry.spec.functionName, args: entry.spec.args, account: owner });
      if (now() > entry.expiresAt) throw Error('TRAINING_REVIEW_EXPIRED');
      await guard();
      if (BigInt(await client.getTransactionCount({ address: owner, blockTag: 'pending' })) !== BigInt(entry.review.transaction.nonce)) throw Error('TRAINING_NONCE_CHANGED');
      entry.status = 'AWAITING_WALLET';
      persist(entry); // Must reach durable storage BEFORE any request that could broadcast.
      // Send exactly the reviewed zero-value transaction, not caller-supplied calldata.
      const hash = await sendTransaction(entry.review.transaction, { review: entry.review, snapshot: state, action: entry.input });
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('MISSING_TRANSACTION_HASH');
      entry.transactionHash = hash; entry.status = 'SUBMITTED';
      persist(entry);
      return await reconcile(entry);
    } catch (error) {
      if (journalFault) return { localOnly: true, chainId: 31337, productionAuthority: false, status: 'RECOVERY_REQUIRED',
        intentId, transactionHash: entry.transactionHash, snapshot: null };
      if (entry.transactionHash) { entry.status = 'SUBMITTED'; return outcome(entry); }
      // A signer/RPC failure without a hash can be ambiguous. Never retry this review.
      entry.status = entry.status === 'AWAITING_WALLET' && error.noTransactionRequested !== true
        ? (error.code === 4001 ? 'REJECTED' : 'SUBMISSION_UNKNOWN') : 'INVALIDATED';
      return outcome(entry);
    } finally { entry.busy = false; }
  }
  async function status(intentId) {
    refreshJournal();
    const entry = intents.get(intentId); if (!entry) throw Error('UNKNOWN_TRAINING_REVIEW');
    if (entry.busy) return outcome(entry, entry.transactionHash ? 'SUBMITTED' : 'AWAITING_WALLET');
    if (!entry.transactionHash) return outcome(entry, entry.status === 'PREPARED' ? 'NOT_SUBMITTED'
      : ['CHECKING', 'AWAITING_WALLET'].includes(entry.status) ? 'RECOVERY_REQUIRED' : entry.status);
    entry.busy = true;
    try { return await reconcile(entry); }
    catch { entry.status = 'SUBMITTED'; return outcome(entry); }
    finally { entry.busy = false; }
  }
  async function recover(tokenId) {
    refreshJournal(); await stateFor(tokenId);
    await auditRecordedReceipts(tokenId);
    return [...intents.values()].filter(entry => entry.input.tokenId === tokenId
      && (unresolved(entry) || entry.transactionHash)).map(entry => ({ intentId: entry.review.intentId,
      tokenId, owner, progression, chainId: 31337, status: entry.status, transactionHash: entry.transactionHash,
      recoveryOnly: true }));
  }
  async function recoverHash(intentId, transactionHash) {
    refreshJournal(); await guard();
    if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw Error('INVALID_RECOVERY_HASH');
    const entry = intents.get(intentId); if (!entry) throw Error('UNKNOWN_TRAINING_REVIEW');
    await stateFor(entry.input.tokenId);
    if (entry.busy) throw Error('TRAINING_REQUEST_IN_PROGRESS');
    if (entry.transactionHash) {
      if (!eq(entry.transactionHash, transactionHash)) throw Error('RECOVERY_HASH_ALREADY_BOUND');
      return status(intentId);
    }
    if (!['CHECKING', 'AWAITING_WALLET', 'SUBMISSION_UNKNOWN'].includes(entry.status)) throw Error('TRAINING_RECOVERY_NOT_REQUIRED');
    entry.busy = true;
    try {
      // Read only: a matching nonce binds this intent, not an older identical training
      // transaction. No signer, nonce lookup fallback, replacement or broadcast here.
      verifyTransaction(entry, await client.getTransaction({ hash: transactionHash }), transactionHash);
      entry.transactionHash = transactionHash; entry.status = 'SUBMITTED'; persist(entry);
      try { return await reconcile(entry); }
      catch { entry.status = 'SUBMITTED'; return outcome(entry); }
    } finally { entry.busy = false; }
  }
  async function auditRecordedReceipts(tokenId) {
    // Local-only reconciliation: confirmed is not finalized. A disappeared receipt
    // must relock training on reload or before a new send, not silently stay complete.
    for (const entry of [...intents.values()]) {
      if (entry.input.tokenId === tokenId && entry.transactionHash && !entry.busy) await status(entry.review.intentId);
    }
    refreshJournal();
  }
  return Object.freeze({ prepare, confirm, status, recover, recoverHash });
}
