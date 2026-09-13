import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, parseAbiParameters } from 'viem';
import { reconcileMarketplaceReview } from '../broker/src/v4/marketplace/reconcile.mjs';
import { prepareMarketplaceReview } from '../broker/src/v4/marketplace/review.mjs';
import { MARKETPLACE_BID_ABI, MARKETPLACE_EVENTS_ABI, MARKETPLACE_REVIEW_SCHEMA } from '../broker/src/v4/marketplace/contracts.mjs';

// Independent, fully offline regressions for defects reproduced in 2ff4136.
// Production transaction construction remains blocked. All RPCs below are fixtures.
const address = digit => `0x${digit.repeat(40)}`;
const hash = digit => `0x${digit.repeat(64)}`;
const owner = address('1'), wallet = address('2'), escrow = address('3');
const orderHash = hash('4'), transactionHash = hash('5'), blockHash = hash('6');
const runtime = '0x60006000f3';

function fixture({ event, status = 3 } = {}) {
  const tx = { from: owner, to: escrow, type: '0x0', value: '0x0', nonce: '0x7', gas: '0x186a0', gasPrice: '0xa', chainId: '0x1237',
    data: encodeFunctionData({ abi: MARKETPLACE_BID_ABI, functionName: 'cancelBid', args: [orderHash] }) };
  const bidBinding = { collection: address('8'), tokenId: '1', priceWei: '100', salt: '1', counter: '0',
    createdAt: '900', deadline: '2000', anyToken: false, collectionCodeHash: hash('a'), recipientCodeHash: hash('b') };
  const review = { schema: MARKETPLACE_REVIEW_SCHEMA, action: 'CANCEL_WETH_BID', owner, punkId: '93', wallet,
    selection: { orderHash, maximumRefundWei: '100', refundCurrency: 'WETH', bidBinding }, transaction: tx,
    bidEscrow: { address: escrow, codeHash: keccak256(runtime) } };
  const actual = { from: owner, to: escrow, type: 'legacy', value: 0n, nonce: 7, gas: 100000n, gasPrice: 10n, chainId: 4663,
    input: tx.data, hash: transactionHash, blockHash, blockNumber: 100n };
  const logs = event ? [{ address: escrow,
    topics: encodeEventTopics({ abi: MARKETPLACE_EVENTS_ABI, eventName: event,
      args: event === 'BidCancelled' ? { orderHash, funder: owner } : { orderHash } }),
    data: event === 'BidCancelled' ? encodeAbiParameters(parseAbiParameters('uint256'), [100n]) : '0x' }] : [];
  const receipt = { transactionHash, from: owner, to: escrow, status: 'success', blockHash, blockNumber: 100n,
    gasUsed: 50000n, effectiveGasPrice: 10n, logs };
  const stateReads = [], codeReads = [];
  const bid = [owner, wallet, address('8'), 93n, 1n, 100n, 1n, 0n, 900, 2000, false, hash('a'), hash('b'), status];
  const client = {
    getChainId: async () => 4663,
    getTransaction: async ({ hash: requested }) => { assert.equal(requested, transactionHash); return actual; },
    getTransactionReceipt: async ({ hash: requested }) => { assert.equal(requested, transactionHash); return receipt; },
    getBlock: async () => ({ number: 100n, hash: blockHash, timestamp: 1000n }),
    getBlockNumber: async () => 112n,
    getCode: async request => {
      codeReads.push(request);
      assert.equal(request.address, escrow); assert.equal(request.blockNumber, 100n);
      return runtime;
    },
    readContract: async request => {
      stateReads.push(request);
      assert.equal(request.address, escrow);
      assert.equal(request.functionName, 'bids');
      assert.deepEqual(request.args, [orderHash]);
      assert.equal(request.blockNumber, 100n);
      assert.equal(request.ccipRead, false);
      return bid;
    },
  };
  return { review, actual, receipt, client, stateReads, codeReads, bid };
}
const reconcile = f => reconcileMarketplaceReview(f.review, { client: f.client, transactionHash });

test('first cancellation reconciles the exact original refund event', async () => {
  const output = await reconcile(fixture({ event: 'BidCancelled' }));
  assert.equal(output.status, 'BID_CANCELLED');
  assert.equal(output.refundedWethWei, '100');
  assert.equal(output.refundInThisTransaction, true);
});

test('a settlement event from the cancellation receipt reconciles without claiming a refund', async () => {
  const output = await reconcile(fixture({ event: 'BidSettled', status: 2 }));
  assert.equal(output.status, 'BID_ALREADY_SETTLED');
  assert.equal(output.refundedWethWei, '0');
  assert.equal(output.refundInThisTransaction, false);
});

for (const [label, status, expected] of [['already settled', 2, 'BID_ALREADY_SETTLED'], ['already cancelled', 3, 'BID_ALREADY_CANCELLED']]) {
  test(`successful ${label} no-op cancellation reconciles without inventing a refund or delivery`, async () => {
    const f = fixture({ status });
    const output = await reconcile(f);
    assert.equal(output.status, expected);
    assert.equal(output.refundedWethWei, '0');
    assert.equal(output.refundInThisTransaction, false);
    assert.equal(output.items, undefined);
    assert.equal(f.stateReads.length, 1, 'exact bid read at the canonical receipt block');
    assert.equal(f.codeReads.length, 1, 'historical escrow runtime checked before trusting state');
  });
}

for (const [label, mutate] of [
  ['sender', f => { f.actual.from = address('9'); }],
  ['recipient', f => { f.actual.to = address('9'); }],
  ['calldata', f => { f.actual.input = '0x1234'; }],
  ['value', f => { f.actual.value = 1n; }],
  ['nonce', f => { f.actual.nonce = 8; }],
  ['chain', f => { f.actual.chainId = 1; }],
  ['gas limit', f => { f.actual.gas = 100001n; }],
  ['gas price', f => { f.actual.gasPrice = 11n; }],
  ['EIP-7702 authorization', f => { f.actual.authorizationList = [{}]; }],
  ['receipt transaction hash', f => { f.receipt.transactionHash = hash('9'); }],
  ['noncanonical receipt', f => { f.receipt.blockHash = hash('9'); }],
  ['returned transaction hash', f => { f.actual.hash = hash('9'); }],
  ['returned transaction block hash', f => { f.actual.blockHash = hash('9'); }],
  ['returned transaction block number', f => { f.actual.blockNumber = 99n; }],
  ['canonical header number', f => { f.client.getBlock = async () => ({ number: 99n, hash: blockHash }); }],
  ['transaction type', f => { f.actual.type = 'unreviewed'; }],
  ['missing transaction type', f => { delete f.actual.type; }],
  ['missing gas price', f => { delete f.actual.gasPrice; }],
  ['zero gas price', f => { f.actual.gasPrice = 0n; }],
  ['missing gas limit', f => { delete f.actual.gas; }],
  ['additional access list', f => { f.actual.accessList = [{}]; }],
  ['additional priority fee', f => { f.actual.maxPriorityFeePerGas = 1n; }],
  ['additional blob fee', f => { f.actual.maxFeePerBlobGas = 1n; }],
]) {
  test(`reject substituted ${label}`, async () => {
    const f = fixture({ event: 'BidCancelled' }); mutate(f);
    await assert.rejects(reconcile(f), /ORIGINAL_TRANSACTION_MISMATCH|RECEIPT_NOT_CANONICAL/);
  });
}

test('mined effective gasPrice cannot hide a higher unreviewed EIP-1559 fee ceiling', async () => {
  const f = fixture({ event: 'BidCancelled' });
  f.actual.type = 'eip1559'; f.actual.maxFeePerGas = 1000n; f.actual.maxPriorityFeePerGas = 100n;
  await assert.rejects(reconcile(f), /ORIGINAL_TRANSACTION_MISMATCH/);
});

test('legacy type cannot hide additional EIP-1559 fee fields', async () => {
  const f = fixture({ event: 'BidCancelled' });
  f.actual.maxFeePerGas = 1000n;
  await assert.rejects(reconcile(f), /ORIGINAL_TRANSACTION_MISMATCH/);
});

for (const [label, index, value] of [
  ['funder', 0, address('9')], ['recipient', 1, address('9')], ['collection', 2, address('9')],
  ['Punk', 3, 94n], ['token ID', 4, 2n], ['price', 5, 101n], ['salt', 6, 2n], ['counter', 7, 1n],
  ['creation time', 8, 901], ['deadline', 9, 2001], ['criteria flag', 10, true],
  ['collection runtime', 11, hash('c')], ['recipient runtime', 12, hash('c')],
]) {
  test(`no-op cancellation rejects substituted historical bid ${label}`, async () => {
    const f = fixture({ status: 2 }); f.bid[index] = value;
    await assert.rejects(reconcile(f), /BID_RECOVERY_BINDING_MISMATCH/);
  });
}

test('changed escrow runtime cannot authenticate a historical terminal state', async () => {
  const f = fixture({ status: 2 }); f.client.getCode = async () => '0x60016000f3';
  await assert.rejects(reconcile(f), /SETTLEMENT_CODE_MISMATCH/);
  assert.equal(f.stateReads.length, 0);
});

test('active historical bid cannot be called already settled', async () => {
  await assert.rejects(reconcile(fixture({ status: 1 })), /BID_RECOVERY_EVIDENCE_MISSING/);
});

test('cancellation event inconsistent with settled state is rejected', async () => {
  await assert.rejects(reconcile(fixture({ event: 'BidCancelled', status: 2 })), /BID_RECOVERY_EVIDENCE_MISSING|BID_RECOVERY_EVIDENCE_MISMATCH/);
});

test('unknown receipt status cannot become a terminal revert', async () => {
  const f = fixture({ event: 'BidCancelled' }); delete f.receipt.status;
  await assert.rejects(reconcile(f), /RECEIPT|MISMATCH/);
});

for (const [label, mutate] of [
  ['missing gas used', f => { delete f.receipt.gasUsed; }],
  ['excess gas used', f => { f.receipt.gasUsed = f.actual.gas + 1n; }],
  ['missing effective price', f => { delete f.receipt.effectiveGasPrice; }],
  ['excess effective price', f => { f.receipt.effectiveGasPrice = f.actual.gasPrice + 1n; }],
]) {
  test(`receipt fee evidence rejects ${label}`, async () => {
    const f = fixture({ event: 'BidCancelled' }); mutate(f);
    await assert.rejects(reconcile(f), /RECEIPT_FEE_EVIDENCE_MISMATCH/);
  });
}

test('reorganization during historical-state verification prevents terminal recovery', async () => {
  const f = fixture({ status: 2 }); let reads = 0;
  f.client.getBlock = async () => ({ number: 100n, hash: ++reads === 1 ? blockHash : hash('9') });
  await assert.rejects(reconcile(f), /RECEIPT_NOT_CANONICAL/);
});

test('insufficient confirmations defer historical terminal interpretation', async () => {
  const f = fixture({ status: 2 }); f.client.getBlockNumber = async () => 100n;
  assert.equal((await reconcile(f)).status, 'PENDING_FINALITY');
  assert.equal(f.stateReads.length, 0);
});

test('public purchase and bid construction remain blocked before any RPC', async () => {
  const noRpc = new Proxy({}, { get() { throw new Error('unexpected RPC'); } });
  for (const action of ['BUY_LISTINGS', 'CREATE_WETH_BID', 'CANCEL_WETH_BID']) {
    const result = await prepareMarketplaceReview({ action, owner, punkId: '93', walletRole: 'AGENT',
      budget: { maxTotalPriceWei: '100', maxNetworkFeeWei: '100', minimumReserveWei: '0' } }, { client: noRpc });
    assert.equal(result.availability, 'BLOCKED'); assert.equal(result.transaction, null);
    assert.equal(result.automaticSubmission, false); assert.equal(result.publicTransactions, 0);
    assert.equal(result.walletRequests, 0); assert.equal(result.collectionFloorVerified, false);
  }
});
