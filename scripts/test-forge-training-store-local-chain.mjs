import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi } from 'viem';
import { startPreview } from './dev/skill-forge/preview-server.mjs';
import { createPinnedMemoryPostgres } from './dev/skill-forge/pinned-pglite-memory.mjs';
import { createPostgresTrainingStore } from '../broker/src/v4/skill-forge/postgres-training-store.mjs';
import { TRAINING_REVIEW_SCHEMA, durableTrainingTransaction, trainingDigest } from '../broker/src/v4/skill-forge/durable-training-review.mjs';
import { readDurableTrainingReceipt } from '../broker/src/v4/skill-forge/training-receipt-verifier.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--disposable-only') throw Error('Pass --disposable-only; no production mode exists.');
const abi = parseAbi(['function trainingCredits(uint256) view returns(uint256)',
  'function learnedLevel(uint256,bytes32) view returns(uint8)',
  'function trainingReviewNonce(uint256) view returns(uint256)',
  'function trainingReviewStateHash(uint256) view returns(bytes32)',
  'function snapshotHash() view returns(bytes32)',
  'function ownerOf(uint256) view returns(address)',
  'function transferFrom(address,address,uint256)']);
let database, preview;
try {
  database = await createPinnedMemoryPostgres();
  await database.exec(await readFile(new URL('../netlify/database/migrations/20260910180000_stage_forge_training_intents.sql', import.meta.url), 'utf8'));
  // NEW disposable Anvil instance. Never resume or mutate either user practice server.
  preview = await startPreview({ controlCenterTraining: true, reviewedTraining: true });
  const response = await fetch(`${preview.url}/api/forge?tokenId=44`);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.localOnly, true); assert.equal(state.canBurn, false);
  const transport = http(`http://127.0.0.1:${preview.resumeConfig.rpcPort}`, { retryCount: 0 });
  const client = createPublicClient({ transport, cacheTime: 0 });
  assert.equal(await client.getChainId(), 31337);
  assert.match(await client.request({ method: 'web3_clientVersion' }), /anvil/i);
  const owner = state.owner.toLowerCase(), progression = state.progression.toLowerCase();
  const collection = state.collection.toLowerCase(), key = state.skills.find(skill => skill.id === 3).key;
  const block = await client.getBlock({ blockTag: 'latest' });
  const codeHash = keccak256(await client.getCode({ address: progression, blockNumber: block.number }));
  const snapshotHash = await client.readContract({ address: progression, abi, functionName: 'snapshotHash', blockNumber: block.number });
  const binding = { chainId: 31337, collection, progression,
    deploymentHash: `0x${trainingDigest(JSON.stringify({ localOnly: true, collection, progression, codeHash, snapshotHash }))}` };
  const read = (functionName, args = [44n]) => client.readContract({ address: progression, abi, functionName, args });
  assert.equal(await read('trainingCredits'), 1n);
  const review = { schema: TRAINING_REVIEW_SCHEMA, ...binding, owner, tokenId: '44',
    action: { operation: 'learn', skillKey: key, slot: 0, startingSlots: 0, rarityProof: [] },
    guard: { nonce: String(await read('trainingReviewNonce')), stateHash: await read('trainingReviewStateHash'),
      deadline: String(block.timestamp + 50n) },
    anchor: { number: String(block.number), hash: block.hash, timestamp: String(block.timestamp) },
    transaction: { nonce: String(await client.getTransactionCount({ address: owner, blockTag: 'pending' })),
      gas: '500000', maxFeePerGas: String((await client.getGasPrice()) * 2n), maxPriorityFeePerGas: '0' } };
  const transaction = durableTrainingTransaction(review);
  await client.call({ account: owner, to: progression, data: transaction.data, value: 0n });
  assert.ok(await client.estimateGas({ account: owner, to: progression, data: transaction.data, value: 0n }) <= BigInt(transaction.gas));
  const store = createPostgresTrainingStore({ pool: database.pool, deployment: binding });
  const prepared = await store.prepare({ requestKey: randomBytes(32).toString('hex'), review });
  const scope = { intentId: prepared.intentId, owner, tokenId: '44' };
  const claimed = await store.claim(scope, 0, prepared.reviewHash); assert.equal(claimed.claimed, true);
  // Exactly one reviewed action, only through the owned, unlocked Anvil fixture.
  assert.equal(await client.getChainId(), 31337);
  const wallet = createWalletClient({ transport, account: owner });
  const hash = await wallet.sendTransaction({ chain: null, to: progression, data: transaction.data, value: 0n,
    nonce: Number(transaction.nonce), gas: BigInt(transaction.gas), type: 'eip1559',
    maxFeePerGas: BigInt(transaction.maxFeePerGas), maxPriorityFeePerGas: 0n });
  assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'success');
  // Model a lost client response: SQL has no transaction hash yet. A fresh worker
  // recovers from read-only RPC evidence without requesting another signature.
  const unknown = await store.markUnknown(scope, claimed.record.revision);
  const worker = createPostgresTrainingStore({ pool: database.pool, deployment: binding });
  assert.equal((await worker.claim(scope, 0, prepared.reviewHash)).claimed, false);
  const evidence = await readDurableTrainingReceipt({ client, review, transactionHash: hash,
    expectedRuntimeHash: codeHash, expectedSnapshotHash: snapshotHash });
  const submitted = await worker.bindVerifiedTransaction(scope, unknown.revision, evidence.transaction);
  const included = await worker.recordVerifiedObservation(scope, submitted.revision, evidence.observation);
  assert.equal(included.status, 'INCLUDED_SUCCESS'); assert.equal(included.holdsTraining, true);
  assert.equal(await read('trainingCredits'), 0n); assert.equal(await read('learnedLevel', [44n, key]), 1);
  assert.equal(await read('trainingReviewNonce'), BigInt(review.guard.nonce) + 1n);
  assert.equal(await client.getTransactionCount({ address: owner }), Number(transaction.nonce) + 1);
  const events = await database.query('SELECT status FROM broker_forge_training_intent_events WHERE intent_id=$1 ORDER BY revision', [prepared.intentId]);
  assert.deepEqual(events.rows.map(row => row.status), ['PREPARED', 'WALLET_REQUESTED', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'INCLUDED_SUCCESS']);
  const [, buyer] = await client.request({ method: 'eth_accounts' });
  const transfer = await wallet.writeContract({ chain: null, address: collection, abi, functionName: 'transferFrom', args: [owner, buyer, 44n] });
  assert.equal((await client.waitForTransactionReceipt({ hash: transfer })).status, 'success');
  assert.equal((await client.readContract({ address: collection, abi, functionName: 'ownerOf', args: [44n] })).toLowerCase(), buyer.toLowerCase());
  assert.equal(await read('learnedLevel', [44n, key]), 1);
  assert.equal(await worker.get({ ...scope, owner: buyer.toLowerCase() }), null);
  assert.equal(await worker.hasUnresolvedTraining('44'), true);
  console.log(JSON.stringify({ result: 'PASS', chainId: 31337, database: 'PostgreSQL WASM / PGlite 0.5.8',
    reviewedTrainingTransactions: 1, fixtureTransferTransactions: 1, fixtureSetupTransactionsExcluded: true,
    reviewedActionHash: hash, inclusionVerified: true, finalized: false,
    unknownSubmissionRecoveredWithoutResend: true, learnedSkillPersistsAfterTransfer: true,
    privateReviewNotReturnedToBuyer: true, publicChainTransactions: 0, productionBurns: 0,
    productionTrainingAuthorized: false, productionBurnAuthorized: false }, null, 2));
} finally {
  try { await preview?.close(); } finally { await database?.close(); }
}
