import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi } from 'viem';
import { startPreview } from './dev/skill-forge/preview-server.mjs';
import { createPinnedMemoryPostgres } from './dev/skill-forge/pinned-pglite-memory.mjs';
import { createPostgresTrainingStore } from '../broker/src/v4/skill-forge/postgres-training-store.mjs';
import { TRAINING_REVIEW_SCHEMA, durableTrainingTransaction, trainingDigest } from '../broker/src/v4/skill-forge/durable-training-review.mjs';
import { readDurableTrainingReceipt } from '../broker/src/v4/skill-forge/training-receipt-verifier.mjs';
import { reconcileTrainingBatch } from '../broker/src/v4/skill-forge/training-reconciler.mjs';
import { createTrainingCoordinator } from '../broker/src/v4/skill-forge/training-coordinator.mjs';
import { TRAINING_STATE_ABI } from '../broker/src/v4/skill-forge/training-state.mjs';
import { trainingDeploymentBinding, validateTrainingRelease } from '../broker/src/v4/skill-forge/training-release.mjs';

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
  await database.exec(await readFile(new URL('../netlify/database/migrations/20260911140000_settle_forge_training_intents.sql', import.meta.url), 'utf8'));
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
  // Both clients point at THIS disposable Anvil. This checks the actual worker /
  // contract integration, not independent public-provider or L1 finality.
  await client.request({ method: 'anvil_mine', params: ['0x80', '0x0'] });
  const clients = [client, createPublicClient({ transport, cacheTime: 0 })];
  const reconciliation = await reconcileTrainingBatch({ store: worker, clients,
    expectedRuntimeHash: codeHash, expectedSnapshotHash: snapshotHash });
  assert.deepEqual(reconciliation.errors, {}); assert.equal(reconciliation.settled, 1);
  assert.equal((await worker.get(scope)).status, 'SETTLED_SUCCESS');
  assert.equal(await worker.hasUnresolvedTraining('44'), false);
  assert.equal(await worker.get({ ...scope, owner: buyer.toLowerCase() }), null);
  // The new owner can explicitly review/equip the inherited learned skill after
  // settlement. No old private review, wallet claim or automatic resend crosses ownership.
  const constant = name => client.readContract({ address: progression, abi: TRAINING_STATE_ABI, functionName: name });
  const registry = (await constant('registry')).toLowerCase(), trainingSource = (await constant('trainingSource')).toLowerCase();
  const definition = await client.readContract({ address: registry, abi: TRAINING_STATE_ABI, functionName: 'definition', args: [key] });
  const release = validateTrainingRelease({ schema: 'GOGH_FORGE_TRAINING_RELEASE_V1', status: 'OWNER_CANARY', chainId: 31337,
    collection, collectionCodeHash: keccak256(await client.getCode({ address: collection })),
    registry, registryCodeHash: keccak256(await client.getCode({ address: registry })), progression, progressionCodeHash: codeHash,
    trainingSource, trainingSourceCodeHash: keccak256(await client.getCode({ address: trainingSource })),
    allocationRoot: await constant('allocationRoot'), snapshotHash, allowedOwners: [owner,buyer.toLowerCase()],
    skills: [{ key, name: 'Contract Detective', manifestHash: definition.manifestHash, instructionHash: definition.instructionHash }],
    feeCeilingWei: '1000000000000000', productionTrainingAuthorized: false, productionBurnAuthorized: false }, { localFixture: true });
  const coordinator = createTrainingCoordinator({ pool: database.pool, storeFactory: createPostgresTrainingStore,
    client, release, localFixture: true });
  const nextKey = randomBytes(32).toString('hex');
  const prepareInput = { owner: buyer.toLowerCase(), tokenId: '44', action: { operation: 'equip', skillKey: key, slot: 0 }, requestKey: nextKey };
  await assert.rejects(() => coordinator.prepare({ ...prepareInput, owner }), /STATE_UNVERIFIED/);
  await assert.rejects(() => coordinator.prepare({ ...prepareInput, action: { ...prepareInput.action, credits: 100 } }), /ACTION_INVALID/);
  const nextPrepared = (await coordinator.prepare(prepareInput)).record;
  const nextReview = nextPrepared.review;
  const replay = await coordinator.prepare(prepareInput);
  assert.equal(replay.record.intentId, nextPrepared.intentId);
  assert.equal(replay.record.reviewHash, nextPrepared.reviewHash);
  await assert.rejects(() => coordinator.prepare({ ...prepareInput, action: { operation: 'unequip', slot: 0 } }), /IDEMPOTENCY_CONFLICT/);
  const nextScope = { ...scope, owner: buyer.toLowerCase(), intentId: nextPrepared.intentId };
  const nextClaim = await coordinator.claim(nextScope, 0, nextPrepared.reviewHash);
  assert.equal(nextClaim.claimed, true);
  assert.equal((await coordinator.claim(nextScope, 0, nextPrepared.reviewHash)).claimed, false);
  const nextTx = durableTrainingTransaction(nextReview);
  const buyerWallet = createWalletClient({ transport, account: buyer });
  const nextHash = await buyerWallet.sendTransaction({ chain: null, to: progression, data: nextTx.data, value: 0n,
    nonce: Number(nextTx.nonce), gas: BigInt(nextTx.gas), type: 'eip1559',
    maxFeePerGas: BigInt(nextTx.maxFeePerGas), maxPriorityFeePerGas: BigInt(nextTx.maxPriorityFeePerGas) });
  assert.equal((await client.waitForTransactionReceipt({ hash: nextHash })).status, 'success');
  const nextWorker = createPostgresTrainingStore({ pool: database.pool, deployment: trainingDeploymentBinding(release) });
  // Mirror the native database's restricted request role: only the worker may
  // write receipt observations, even when recovery already found a mined receipt.
  const recoveryCoordinator=createTrainingCoordinator({pool:database.pool,client,release,localFixture:true,
    storeFactory:options=>({...createPostgresTrainingStore(options),recordVerifiedObservation:()=>{throw Error('REQUEST_ROLE_CANNOT_WRITE_RECEIPT');}})});
  assert.equal((await recoveryCoordinator.mutate(nextScope,'recover',nextClaim.record.revision,nextHash)).status,'SUBMITTED');
  await client.request({ method: 'anvil_mine', params: ['0x80', '0x0'] });
  const nextReconciliation = await reconcileTrainingBatch({ store: nextWorker, clients,
    expectedRuntimeHash: codeHash, expectedSnapshotHash: snapshotHash });
  assert.deepEqual(nextReconciliation.errors, {}); assert.equal(nextReconciliation.settled, 1);
  assert.equal((await nextWorker.get(nextScope)).status, 'SETTLED_SUCCESS');
  assert.equal((await coordinator.get(nextScope)).record.status, 'SETTLED_SUCCESS');
  assert.equal(await worker.hasUnresolvedTraining('44'), false);
  assert.equal(await read('trainingCredits'), 0n);
  assert.equal(await read('trainingReviewNonce'), BigInt(review.guard.nonce) + 2n);
  const abandoned=(await coordinator.prepare({owner:buyer.toLowerCase(),tokenId:'44',action:{operation:'unequip',slot:0},requestKey:randomBytes(32).toString('hex')})).record;
  const abandonedScope={...nextScope,intentId:abandoned.intentId};
  assert.equal((await coordinator.claim(abandonedScope,0,abandoned.reviewHash)).claimed,true);
  // Model rejecting the wallet prompt: no send, no transaction hash, no changed nonce.
  await client.request({method:'evm_setNextBlockTimestamp',params:[Number(abandoned.review.guard.deadline)+1]});
  await client.request({method:'anvil_mine',params:['0x80','0x0']});
  const expiredBlock=await client.getBlock({blockTag:'latest'});
  const expiry=await reconcileTrainingBatch({store:nextWorker,clients,expectedRuntimeHash:codeHash,
    expectedSnapshotHash:snapshotHash,now:()=>Number(expiredBlock.timestamp)*1000});
  assert.deepEqual(expiry.errors,{});assert.equal(expiry.settled,1);
  assert.equal((await nextWorker.get(abandonedScope)).status,'REVIEW_EXPIRED');
  assert.equal(await nextWorker.hasUnresolvedTraining('44'),false);
  await assert.rejects(()=>client.call({account:buyer,to:progression,data:durableTrainingTransaction(abandoned.review).data,value:0n}));
  const freshReview={...abandoned.review,anchor:{number:String(expiredBlock.number),hash:expiredBlock.hash,timestamp:String(expiredBlock.timestamp)},
    guard:{...abandoned.review.guard,deadline:String(expiredBlock.timestamp+5n)}};
  await client.call({account:buyer,to:progression,data:durableTrainingTransaction(freshReview).data,value:0n});
  const fresh=await nextWorker.prepare({requestKey:randomBytes(32).toString('hex'),review:freshReview});
  assert.equal(fresh.review.transaction.nonce,abandoned.review.transaction.nonce);
  await nextWorker.cancelPrepared({...nextScope,intentId:fresh.intentId},0);
  console.log(JSON.stringify({ result: 'PASS', chainId: 31337, database: 'PostgreSQL WASM / PGlite 0.5.8',
    reviewedTrainingTransactions: 2, fixtureTransferTransactions: 1, fixtureSetupTransactionsExcluded: true,
    reviewedActionHash: hash, inclusionVerified: true, anvilFinalizedTagSettlementTested: true, publicFinalityTested: false,
    unknownSubmissionRecoveredWithoutResend: true, learnedSkillPersistsAfterTransfer: true,
    sellerHoldReleasedByWorker: true, buyerCanEquipInheritedSkillAfterSettlement: true,
    coordinatorRuntimePinsSimulationFeesAndContinuityTested: true, preparedResponseRetryKeepsSameReview: true,
    rejectedWalletReviewReleasesAfterFinalizedExpiry: true, expiredCallCannotTrain: true, freshReviewReusesUnusedNonce: true,
    privateReviewNotReturnedToBuyer: true, publicChainTransactions: 0, productionBurns: 0,
    productionTrainingAuthorized: false, productionBurnAuthorized: false }, null, 2));
} finally {
  try { await preview?.close(); } finally { await database?.close(); }
}
