import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { keccak256, TransactionReceiptNotFoundError } from 'viem';
import { prepareForgeDeployment } from '../../../broker/src/v4/skill-forge/forge-deployment-preparation.mjs';
import { assertForgeDeploymentTransaction, buildForgeAcceptanceReview, forgeDeploymentStep, forgeManifestCandidates,
  inspectForgeStack, validateForgeAcceptanceReview, validateForgeDeploymentPlan, verifyForgeDeployment } from '../../../broker/src/v4/skill-forge/forge-deployment.mjs';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const valid = (value, code) => { if (!value) throw Error(code); };
const hex = value => `0x${BigInt(value).toString(16)}`;
const emptyStep = () => ({ status: 'READY', transactionHash: null, reportedTransactionHash: null, review: null, inclusion: null });
const empty = () => ({ packet: null, steps: [emptyStep(), emptyStep()], evidence: null, candidates: null, verification: null });

function verificationFailure(error, stage) {
  const archive = /archive requests require|metadata is not found|missing trie node/i.test(`${error.message ?? ''} ${error.details ?? ''}`);
  const code = archive ? 'FORGE_ARCHIVE_STATE_UNAVAILABLE' : /^[A-Z_]+$/.test(error.message) ? error.message : 'FORGE_RPC_UNAVAILABLE';
  return { stage, code, status: code === 'FORGE_DEPLOYMENT_FINALITY_PENDING' ? 'PENDING'
    : ['FORGE_RPC_UNAVAILABLE', 'FORGE_ARCHIVE_STATE_UNAVAILABLE'].includes(code) ? 'UNAVAILABLE' : 'FAILED' };
}

export function openOwnerDeploymentSession({ path, clients, endpoints, build, administrator, localFixture = false, pins = null, now = Date.now }) {
  valid(clients.length === (localFixture ? 1 : 2), 'FORGE_DEPLOYMENT_RPC_PAIR_REQUIRED');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  valid(!existsSync(path) || lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'INVALID_OWNER_DEPLOYMENT_JOURNAL');
  const db = new DatabaseSync(path); chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS owner_deployment (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS owner_deployment_history (revision INTEGER PRIMARY KEY, data TEXT NOT NULL);
  `);
  db.prepare('INSERT OR IGNORE INTO owner_deployment VALUES (1,0,?)').run(JSON.stringify(empty()));
  let busy = false;
  function snapshot() {
    const row = db.prepare('SELECT revision,data FROM owner_deployment WHERE id=1').get(), data = JSON.parse(row.data);
    valid(Array.isArray(data.steps) && data.steps.length === 2, 'OWNER_DEPLOYMENT_JOURNAL_INVALID');
    if (data.packet) {
      validateForgeDeploymentPlan(data.packet.plan, build, { localFixture });
      valid(same(data.packet.plan.administrator, administrator), 'OWNER_DEPLOYMENT_JOURNAL_IDENTITY_CHANGED');
      if (data.steps[1].review) validateForgeAcceptanceReview(data.steps[1].review, data.packet.plan);
    }
    return { revision: row.revision, ...data };
  }
  function save(state) {
    const { revision, ...data } = state;
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare('UPDATE owner_deployment SET revision=revision+1,data=? WHERE id=1 AND revision=?').run(JSON.stringify(data), revision);
      valid(result.changes === 1, 'OWNER_DEPLOYMENT_REVISION_CHANGED');
      db.prepare('INSERT INTO owner_deployment_history VALUES (?,?)').run(revision + 1, JSON.stringify(data));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return snapshot();
  }
  const stepFor = (state, index) => forgeDeploymentStep(state.packet.plan, index, state.steps[1].review);
  function transactionFor(state, index) {
    const step = stepFor(state, index), tx = step.transaction;
    return { from: tx.from, ...(tx.to ? { to: tx.to } : {}), data: tx.data, value: '0x0', chainId: hex(tx.chainId),
      type: '0x2', nonce: hex(tx.nonce), gas: hex(step.gasLimit), maxFeePerGas: hex(step.maxFeePerGas), maxPriorityFeePerGas: '0x0' };
  }
  async function heads(tag = 'latest') {
    const values = await Promise.all(clients.map(client => client.getBlock({ blockTag: tag })));
    const head = values.reduce((a, b) => a.number < b.number ? a : b);
    for (const client of clients) {
      valid(await client.getChainId() === (localFixture ? 31337 : 4663), 'FORGE_DEPLOYMENT_WRONG_CHAIN');
      valid(same((await client.getBlock({ blockNumber: head.number })).hash, head.hash), 'FORGE_DEPLOYMENT_PROVIDERS_DISAGREE');
    }
    if (tag === 'latest') valid(Math.abs(now() / 1000 - Number(head.timestamp)) <= 60, 'STALE_FORGE_DEPLOYMENT_HEAD');
    return head;
  }
  async function inspectReceipt(state, index) {
    const entry = state.steps[index], hash = entry.transactionHash ?? entry.reportedTransactionHash;
    if (!hash) return entry;
    const step = stepFor(state, index), observations = [];
    // A reported hash is only a recovery hint until both providers bind its
    // original transaction to this saved review. It cannot authorize a resend.
    const transactions = await Promise.all(clients.map(async client => {
      valid(await client.getChainId() === state.packet.plan.chainId, 'FORGE_DEPLOYMENT_WRONG_CHAIN');
      const tx = await client.getTransaction({ hash });
      valid(same(tx.hash, hash), 'FORGE_TRANSACTION_HASH_CHANGED');
      assertForgeDeploymentTransaction({ plan: state.packet.plan, index, transaction: tx, acceptanceReview: state.steps[1].review });
      return tx;
    }));
    const submitted = { ...entry, transactionHash: hash, reportedTransactionHash: hash };
    for (const [i, client] of clients.entries()) {
      let receipt;
      try { receipt = await client.getTransactionReceipt({ hash }); }
      catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return { ...submitted, status: 'SUBMITTED', inclusion: null };
        throw error;
      }
      const tx = transactions[i];
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      valid(same(hash, tx.hash) && same(hash, receipt.transactionHash) && same(tx.blockHash, block.hash)
        && same(receipt.blockHash, block.hash) && tx.blockNumber === receipt.blockNumber
        && receipt.blockNumber > BigInt(step.anchor.number) && same(receipt.from, step.transaction.from)
        && tx.transactionIndex === receipt.transactionIndex && Number.isSafeInteger(receipt.transactionIndex)
        && receipt.gasUsed > 0n && receipt.gasUsed <= tx.gas && receipt.effectiveGasPrice > 0n
        && receipt.effectiveGasPrice <= tx.maxFeePerGas && ['success', 'reverted'].includes(receipt.status)
        && (receipt.status === 'reverted' || index !== 0 || same(receipt.contractAddress, state.packet.plan.addresses.deployment)), 'FORGE_DEPLOYMENT_RECEIPT_MISMATCH');
      valid(same((await client.getBlock({ blockNumber: BigInt(step.anchor.number) })).hash, step.anchor.hash), 'FORGE_DEPLOYMENT_ANCHOR_CHANGED');
      observations.push({ blockNumber: String(block.number), blockHash: block.hash, status: receipt.status });
      valid(same((await client.getBlock({ blockNumber: block.number })).hash, block.hash), 'FORGE_DEPLOYMENT_REORG');
    }
    valid(observations.every(o => JSON.stringify(o) === JSON.stringify(observations[0])), 'FORGE_DEPLOYMENT_PROVIDERS_DISAGREE');
    return { ...submitted, status: observations[0].status === 'success' ? 'INCLUDED' : 'REVERTED', inclusion: observations[0] };
  }
  async function preflight(state, index) {
    const plan = state.packet.plan, step = stepFor(state, index), tx = step.transaction;
    valid(now() / 1000 < step.expiresAt - 15, 'FORGE_WALLET_REVIEW_EXPIRED');
    if (index === 1) valid((await inspectReceipt(state, 0)).status === 'INCLUDED', 'FORGE_CREATION_RECEIPT_REQUIRED');
    const head = await heads();
    for (const [i, client] of clients.entries()) {
      valid(same((await client.getBlock({ blockNumber: BigInt(step.anchor.number) })).hash, step.anchor.hash), 'FORGE_DEPLOYMENT_ANCHOR_CHANGED');
      const code = await client.getCode({ address: plan.pins.collection, blockNumber: head.number });
      valid(code && keccak256(code) === plan.pins.collectionCodeHash, 'FORGE_COLLECTION_CHANGED');
      const observed = state.packet.observations[i];
      valid(keccak256(await client.getCode({ address: administrator, blockNumber: head.number }) ?? '0x') === observed.administratorCodeHash, 'FORGE_ADMINISTRATOR_CHANGED');
      if (observed.delegation) valid(keccak256(await client.getCode({ address: observed.delegation, blockNumber: head.number }) ?? '0x') === observed.delegationCodeHash, 'FORGE_ADMINISTRATOR_CHANGED');
      if (index === 0) for (const address of Object.values(plan.addresses)) {
        const existing = await client.getCode({ address, blockNumber: head.number });
        valid(!existing || existing === '0x', 'FORGE_PREDICTED_ADDRESS_OCCUPIED');
      }
      else await inspectForgeStack({ client, plan, build, blockNumber: head.number, pendingGuardian: true });
      const count = await Promise.all(['pending', 'latest'].map(blockTag => client.getTransactionCount({ address: administrator, blockTag })));
      valid(count.every(n => String(n) === tx.nonce), 'FORGE_WALLET_NONCE_CHANGED');
      valid(await client.getBalance({ address: administrator }) >= BigInt(step.gasLimit) * BigInt(step.maxFeePerGas), 'FORGE_DEPLOYMENT_GAS_UNFUNDED');
      valid(await client.getGasPrice() <= BigInt(step.maxFeePerGas), 'FORGE_DEPLOYMENT_FEE_CHANGED');
      const call = { account: administrator, ...(tx.to ? { to: tx.to } : {}), data: tx.data, value: 0n,
        gas: BigInt(step.gasLimit), maxFeePerGas: BigInt(step.maxFeePerGas), maxPriorityFeePerGas: 0n };
      await client.call(call);
      valid(await client.estimateGas(call) <= BigInt(step.gasLimit), 'FORGE_DEPLOYMENT_GAS_LIMIT_CHANGED');
      valid(same((await client.getBlock({ blockNumber: head.number })).hash, head.hash)
        && String(await client.getTransactionCount({ address: administrator, blockTag: 'pending' })) === tx.nonce
        && String(await client.getTransactionCount({ address: administrator, blockTag: 'latest' })) === tx.nonce, 'FORGE_DEPLOYMENT_CONTEXT_CHANGED');
    }
    valid(now() / 1000 < step.expiresAt - 15, 'FORGE_WALLET_REVIEW_EXPIRED');
    return transactionFor(state, index);
  }
  async function reconcile(state) {
    state.evidence = null; state.candidates = null; state.verification = null;
    for (let index = 0; index < 2; index++) {
      try { state.steps[index] = await inspectReceipt(state, index); }
      catch (error) { state.verification ??= { ...verificationFailure(error, 'RECEIPTS'), index }; }
    }
    if (!state.verification && state.steps.every(step => step.status === 'INCLUDED')) {
      try {
        state.evidence = await verifyForgeDeployment({ clients, build, plan: state.packet.plan,
          transactionHashes: state.steps.map(step => step.transactionHash), acceptanceReview: state.steps[1].review, localFixture });
        if (!localFixture) state.candidates = forgeManifestCandidates({ plan: state.packet.plan, evidence: state.evidence, build });
        state.verification = { status: 'VERIFIED', stage: 'FINALIZED_DEPLOYMENT', code: null };
      } catch (error) {
        state.evidence = null; state.candidates = null;
        state.verification = verificationFailure(error, 'FINALIZED_DEPLOYMENT');
      }
    }
    return save(state);
  }
  async function run(operation, input = {}) {
    valid(!busy, 'OWNER_DEPLOYMENT_BUSY'); busy = true;
    try {
      let state = snapshot();
      valid(input.revision === state.revision, 'OWNER_DEPLOYMENT_REVISION_CHANGED');
      if (operation === 'prepare') {
        valid(!state.packet || state.steps.every(step => step.status === 'READY' || step.status === 'NONCE_CONSUMED'), 'FORGE_DEPLOYMENT_ALREADY_STARTED');
        const packet = await prepareForgeDeployment({ clients, endpoints, build, administrator, localFixture, pins });
        return save({ revision: state.revision, ...empty(), packet });
      }
      valid(state.packet, 'FORGE_DEPLOYMENT_REVIEW_REQUIRED');
      if (operation === 'recheck') return reconcile(state);
      const index = input.index;
      valid(index === 0 || index === 1, 'INVALID_FORGE_DEPLOYMENT_STEP');
      if (operation === 'prepare-acceptance') {
        valid(index === 1 && ['READY', 'NONCE_CONSUMED'].includes(state.steps[1].status), 'FORGE_ACCEPTANCE_ALREADY_REQUESTED');
        state.steps[0] = await inspectReceipt(state, 0);
        valid(state.steps[0].status === 'INCLUDED', 'FORGE_CREATION_RECEIPT_REQUIRED');
        const head = await heads(), nonces = await Promise.all(clients.flatMap(client => ['pending', 'latest'].map(blockTag => client.getTransactionCount({ address: administrator, blockTag }))));
        valid(nonces.every(n => n === nonces[0] && Number.isSafeInteger(n)), 'FORGE_WALLET_NONCE_CHANGED');
        const prices = await Promise.all(clients.map(client => client.getGasPrice()));
        state.steps[1] = { ...emptyStep(), review: buildForgeAcceptanceReview({ plan: state.packet.plan,
          nonce: String(nonces[0]), maxFeePerGas: String(prices.reduce((max, p) => p > max ? p : max, 0n) * 2n),
          anchor: { number: String(head.number), hash: head.hash, timestamp: Number(head.timestamp) } }) };
        await preflight(state, 1); return save(state);
      }
      if (operation === 'claim') {
        valid(state.steps[index].status === 'READY' && (index === 0 || state.steps[1].review), 'FORGE_WALLET_ALREADY_REQUESTED');
        valid(input.reviewHash === (index === 0 ? state.packet.plan.planHash : state.steps[1].review.reviewHash), 'FORGE_WALLET_REVIEW_CHANGED');
        const transaction = await preflight(state, index);
        state.steps[index].status = 'WALLET_REQUESTED';
        // FULL SQLite COMMIT completes before returning the first wallet request.
        return { ...save(state), transaction };
      }
      if (operation === 'recover') {
        valid(/^0x[0-9a-f]{64}$/i.test(input.transactionHash) && ['WALLET_REQUESTED', 'SUBMITTED', 'INCLUDED', 'REVERTED'].includes(state.steps[index].status), 'FORGE_TRANSACTION_RECOVERY_REQUIRED');
        valid(!state.steps[index].transactionHash || same(state.steps[index].transactionHash, input.transactionHash), 'FORGE_TRANSACTION_HASH_CHANGED');
        // Commit the unverified wallet/recovery report BEFORE any RPC lookup.
        // An outage or restart must not lose the only available hash. A bad hint
        // may be corrected, but an already verified transaction hash cannot change.
        state.steps[index].reportedTransactionHash = input.transactionHash;
        state.evidence = null; state.candidates = null; state.verification = null;
        state = save(state); return reconcile(state);
      }
      if (operation === 'resolve-nonce') {
        valid(['WALLET_REQUESTED', 'SUBMITTED', 'REVERTED'].includes(state.steps[index].status), 'FORGE_NONCE_RECOVERY_NOT_REQUIRED');
        const step = stepFor(state, index), head = await heads(localFixture ? 'latest' : 'finalized');
        for (const client of clients) {
          valid(BigInt(await client.getTransactionCount({ address: administrator, blockNumber: head.number })) > BigInt(step.transaction.nonce), 'FORGE_NONCE_STILL_UNRESOLVED');
          if (index === 0) for (const address of Object.values(state.packet.plan.addresses)) {
            const code = await client.getCode({ address, blockNumber: head.number });
            valid(!code || code === '0x', 'FORGE_DEPLOYMENT_EXISTS_RECOVER_HASH');
          }
          else await inspectForgeStack({ client, plan: state.packet.plan, build, blockNumber: head.number, pendingGuardian: true });
          valid(same((await client.getBlock({ blockNumber: head.number })).hash, head.hash), 'FORGE_DEPLOYMENT_REORG');
        }
        state.steps[index].status = 'NONCE_CONSUMED'; return save(state);
      }
      throw Error('UNKNOWN_OWNER_DEPLOYMENT_OPERATION');
    } finally { busy = false; }
  }
  snapshot();
  return { snapshot, run, close: () => db.close() };
}
