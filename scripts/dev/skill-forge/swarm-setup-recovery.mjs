import { DatabaseSync } from 'node:sqlite';
import { getContractAddress } from 'viem';
import { openSetupReviewJournal, setupDigest } from './setup-review-journal.mjs';

const valid = (condition, code = 'SETUP_RECOVERY_MISMATCH') => { if (!condition) throw Error(code); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hashPattern = /^0x[0-9a-f]{64}$/i;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const positive = value => typeof value === 'bigint' && value > 0n;
const nonnegative = value => typeof value === 'bigint' && value >= 0n;

// Swarm-only additions use the same transactional database/history as the shared
// journal. Existing reviews and their exact hashes remain unchanged. Other setup
// flows continue using the unmodified shared journal and recovery rules.
export function openSwarmSetupReviewJournal(options) {
  const base = openSetupReviewJournal(options);
  let db;
  try {
    db = new DatabaseSync(options.path);
    db.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
  } catch (error) { base.close(); throw error; }
  function save(revision, update) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT revision,data FROM setup_reviews WHERE id=1').get();
      const state = { revision: row.revision, ...JSON.parse(row.data) };
      valid(state.revision === revision && state.binding === options.binding, 'SETUP_REVIEW_STATE_CHANGED');
      valid(state.records.every(record => record.reviewHash === setupDigest(record.review)), 'SETUP_REVIEW_STATE_CHANGED');
      update(state);
      const { revision: oldRevision, ...data } = state;
      const json = JSON.stringify(data);
      valid(db.prepare('UPDATE setup_reviews SET revision=revision+1,data=? WHERE id=1 AND revision=?')
        .run(json, oldRevision).changes === 1, 'SETUP_REVIEW_STATE_CHANGED');
      db.prepare('INSERT INTO setup_review_history VALUES (?,?)').run(oldRevision + 1, json);
      db.exec('COMMIT');
      return base.snapshot();
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    snapshot: base.snapshot,
    claim: base.claim,
    decline: base.decline,
    prepare(revision, review) {
      return save(revision, state => {
        const last = state.records.at(-1);
        valid(!last || ['PREPARED', 'DECLINED', 'INCLUDED', 'REVERTED', 'CANCELLED'].includes(last.status), 'SETUP_REVIEW_STATE_CHANGED');
        if (last?.status === 'PREPARED') last.status = 'CANCELLED_BEFORE_WALLET';
        state.records.push({ review, reviewHash: setupDigest(review), status: 'PREPARED', transactionHash: null, inclusion: null });
      });
    },
    reportCandidate(revision, transactionHash) {
      const state = base.snapshot(), last = state.records.at(-1);
      valid(state.revision === revision && last && ['WALLET_REQUESTED', 'SUBMITTED'].includes(last.status)
        && hashPattern.test(transactionHash ?? ''), 'SETUP_REVIEW_STATE_CHANGED');
      const hash = transactionHash.toLowerCase();
      if (last.recoveryTransactionHash === hash) return state;
      return save(revision, current => {
        const record = current.records.at(-1);
        // Candidate hashes never replace a previously verified/submitted hash.
        record.reportedTransactionHash ??= hash;
        record.recoveryTransactionHash = hash;
      });
    },
    resolve(revision, inclusion) {
      return save(revision, state => {
        const record = state.records.at(-1);
        valid(record && ['WALLET_REQUESTED', 'SUBMITTED'].includes(record.status)
          && inclusion.transactionHash === record.recoveryTransactionHash
          && ['DEPLOYMENT', 'CANCELLATION'].includes(inclusion.kind)
          && ['success', 'reverted'].includes(inclusion.status)
          && (inclusion.kind !== 'CANCELLATION' || inclusion.status === 'success'), 'SETUP_REVIEW_STATE_CHANGED');
        record.originalTransactionHash ??= record.transactionHash ?? record.reportedTransactionHash;
        record.transactionHash = inclusion.transactionHash;
        record.inclusion = inclusion;
        record.status = inclusion.kind === 'CANCELLATION' ? 'CANCELLED'
          : inclusion.status === 'success' ? 'INCLUDED' : 'REVERTED';
      });
    },
    close() { db.close(); base.close(); },
  };
}

function transactionKind(tx, review, hash) {
  const expected = review.transaction;
  valid(addressPattern.test(expected.from ?? '') && !expected.to && BigInt(expected.value) === 0n
    && BigInt(expected.chainId) === 4663n && hashPattern.test(hash)
    && same(tx.hash, hash) && same(tx.from, expected.from) && tx.chainId === 4663
    && Number.isSafeInteger(tx.nonce) && tx.nonce >= 0 && BigInt(tx.nonce) === BigInt(expected.nonce)
    && tx.value === 0n && positive(tx.gas)
    && ['legacy', 'eip2930', 'eip1559'].includes(tx.type)
    && (tx.authorizationList == null || Array.isArray(tx.authorizationList) && tx.authorizationList.length === 0));
  valid(same(review.predictedAddress, getContractAddress({ from: expected.from, nonce: BigInt(expected.nonce) })));
  if (tx.type === 'eip1559') {
    valid(nonnegative(tx.maxFeePerGas) && nonnegative(tx.maxPriorityFeePerGas)
      && tx.maxFeePerGas >= tx.maxPriorityFeePerGas);
  } else valid(nonnegative(tx.gasPrice));
  if (tx.to === null && same(tx.input, expected.data)) return 'DEPLOYMENT';
  valid(same(tx.to, expected.from) && tx.input === '0x');
  return 'CANCELLATION';
}

// Recovery is read-only reconciliation, not a second authorization. Gas limit
// and fee edits may be recognized only on the owner's same-nonce exact deployment
// or a proven zero-value EOA self-cancellation. The original send ceiling stays
// in review.transaction and is never expanded by this function.
export async function inspectSwarmSetupTransaction({ transactionHash, review, clients, verifyDeployment }) {
  valid(Array.isArray(clients) && clients.length === 2 && typeof verifyDeployment === 'function');
  valid(hashPattern.test(transactionHash ?? ''), 'INVALID_TRANSACTION_HASH');
  valid(/^(0|[1-9]\d*)$/.test(review.anchor?.number ?? '') && hashPattern.test(review.anchor?.hash ?? ''));
  const anchorNumber = BigInt(review.anchor.number);
  const hash = transactionHash.toLowerCase(), observed = [];
  for (const client of clients) {
    valid(await client.getChainId() === 4663);
    valid(same((await client.getBlock({ blockNumber: anchorNumber })).hash, review.anchor.hash), 'SETUP_ANCHOR_REORG');
    const tx = await client.getTransaction({ hash });
    const kind = transactionKind(tx, review, hash);
    const receipt = await client.getTransactionReceipt({ hash });
    valid(positive(receipt.blockNumber) && receipt.blockNumber >= anchorNumber && hashPattern.test(receipt.blockHash ?? '')
      && same(receipt.transactionHash, hash) && same(receipt.from, review.transaction.from)
      && ['success', 'reverted'].includes(receipt.status)
      && positive(receipt.gasUsed) && receipt.gasUsed <= tx.gas && nonnegative(receipt.effectiveGasPrice)
      && (tx.type === 'eip1559' ? receipt.effectiveGasPrice <= tx.maxFeePerGas : receipt.effectiveGasPrice === tx.gasPrice)
      && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0
      && tx.transactionIndex === receipt.transactionIndex && tx.blockNumber === receipt.blockNumber
      && same(tx.blockHash, receipt.blockHash));
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const included = block.transactions?.[receipt.transactionIndex];
    valid(block.number === receipt.blockNumber && same(block.hash, receipt.blockHash)
      && same(typeof included === 'string' ? included : included?.hash, hash));
    valid(await client.getBlockNumber() >= receipt.blockNumber + 12n, 'SETUP_CONFIRMATIONS_PENDING');
    if (kind === 'CANCELLATION') {
      valid(receipt.status === 'success' && same(receipt.to, review.transaction.from)
        && receipt.contractAddress === null && Array.isArray(receipt.logs) && receipt.logs.length === 0);
      for (const blockNumber of [receipt.blockNumber - 1n, receipt.blockNumber]) {
        const code = await client.getCode({ address: review.transaction.from, blockNumber });
        valid(code === undefined || code === '0x');
      }
    } else {
      valid(receipt.to === null && (receipt.status === 'reverted' ? receipt.contractAddress === null
        : same(receipt.contractAddress, review.predictedAddress)));
      if (receipt.status === 'success') await verifyDeployment({ client, address: review.predictedAddress, blockNumber: receipt.blockNumber });
    }
    valid(same((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, block.hash), 'SETUP_ANCHOR_REORG');
    const actualNetworkFeeWei = receipt.gasUsed * receipt.effectiveGasPrice;
    observed.push({ transactionHash: hash, kind, status: receipt.status, blockNumber: String(block.number),
      blockHash: block.hash.toLowerCase(), contractAddress: receipt.contractAddress?.toLowerCase() ?? null,
      transactionIndex: receipt.transactionIndex, gasUsed: String(receipt.gasUsed),
      effectiveGasPrice: String(receipt.effectiveGasPrice), actualNetworkFeeWei: String(actualNetworkFeeWei),
      maximumNetworkFeeWei: review.maximumNetworkFeeWei,
      feeExceeded: actualNetworkFeeWei > BigInt(review.maximumNetworkFeeWei),
      recoveredTransaction: { type: tx.type, gas: String(tx.gas),
        maxFeePerGas: tx.type === 'eip1559' ? String(tx.maxFeePerGas) : null,
        maxPriorityFeePerGas: tx.type === 'eip1559' ? String(tx.maxPriorityFeePerGas) : null,
        gasPrice: tx.type === 'eip1559' ? null : String(tx.gasPrice) } });
  }
  valid(JSON.stringify(observed[0]) === JSON.stringify(observed[1]), 'SETUP_PROVIDERS_DISAGREE');
  return observed[0];
}

export async function recoverSwarmSetupTransaction({ journal, revision, transactionHash, clients, verifyDeployment }) {
  const state = journal.reportCandidate(revision, transactionHash);
  const record = state.records.at(-1);
  try {
    const inclusion = await inspectSwarmSetupTransaction({ transactionHash, review: record.review, clients, verifyDeployment });
    return { state: journal.resolve(state.revision, inclusion), pending: false };
  } catch (error) {
    if (['TransactionNotFoundError', 'TransactionReceiptNotFoundError', 'BlockNotFoundError'].includes(error.name)
      || error.message === 'SETUP_CONFIRMATIONS_PENDING') return { state: journal.snapshot(), pending: true };
    throw error;
  }
}
