import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { runInNewContext } from 'node:vm';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbiParameters } from 'viem';
import { MARKETPLACE_PINS as P, MARKETPLACE_EVENTS_ABI } from '../broker/src/v4/marketplace/contracts.mjs';

// Independent HTTP state-machine tests: only the already-reviewed marketplace
// preparation/reconciliation modules are stubbed. The actual practice server,
// claims, filesystem journal, bounded recovery, fill verification and HTTP guards
// run unchanged. A test-only directory suffix isolates filesystem journals from
// other parallel test files. No RPC, credential, signer or existing practice process is used.
const moduleURL = new URL('../scripts/dev/marketplace/practice-server.mjs?independent-review', import.meta.url).href;
const fixtureJournalPrefix = `gogh-market-practice-journal-independent-${process.pid}-`;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === moduleURL && specifier === 'node:fs/promises')
    return { url: 'data:text/javascript,' + encodeURIComponent(`export {readFile,writeFile,rename,rm} from 'node:fs/promises'; import {mkdtemp as create} from 'node:fs/promises'; export const mkdtemp=p=>create(p+'independent-${process.pid}-');`), shortCircuit: true };
  if (context.parentURL === moduleURL && specifier.endsWith('/marketplace/review.mjs'))
    return { url: 'data:text/javascript,export const prepareMarketplaceReview=(r,d)=>d.__prepare(r)', shortCircuit: true };
  if (context.parentURL === moduleURL && specifier.endsWith('/marketplace/reconcile.mjs'))
    return { url: 'data:text/javascript,export const reconcileMarketplaceReview=(r,d)=>d.client.__reconcile(r,d)', shortCircuit: true };
  return next(specifier, context);
} });
let startMarketplacePractice;
try { ({ startMarketplacePractice } = await import(moduleURL)); } finally { hooks.deregister(); }
const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const owner = address(1), seller = address(2), collection = address(3), escrow = address(4);
const wallet = '0xcadcfd37e715bc031cf0cec7fa2335091c878c83', runtime = '0x60006000f3';
const zeroHash = hash(0), orderHash = hash(900);
const price = 100000000000000n;

async function fixture(t, { loseOwnerResponse = false, loseOwnerBeforeSend = false, loseSellerResponse = false, revertSeller = false } = {}) {
  let head = 100n, timestamp = BigInt(Math.floor(Date.now() / 1000));
  let ownerNonce = 7, sellerNonce = 11, ownerSends = 0, sellerSends = 0;
  let creation = null, bidRow = null, receiptReorg = false, owned = true;
  const blocks = new Map(), transactions = new Map(), receipts = new Map();
  const block = number => ({ number, hash: hash(Number(number)), timestamp, transactions: blocks.get(number) ?? [] });
  const client = {
    transport: { url: 'http://127.0.0.1:45678' }, getChainId: async () => 4663,
    request: async ({ method }) => { if (method === 'web3_clientVersion') return 'anvil/offline-independent-fixture'; assert.equal(method, 'evm_mine'); head++; return '0x0'; },
    getBalance: async () => 1000000000000000000n,
    getBlockNumber: async () => head,
    getBlock: async ({ blockNumber } = {}) => block(blockNumber ?? head),
    getTransactionCount: async ({ address: account }) => account === owner ? ownerNonce : sellerNonce,
    getTransaction: async ({ hash: txHash }) => transactions.get(txHash),
    getTransactionReceipt: async ({ hash: txHash }) => receipts.get(txHash),
    getCode: async () => runtime,
    call: async () => ({ data: '0x' }),
    readContract: async ({ functionName }) => {
      if (functionName === 'balanceOf') return 0n;
      if (functionName === 'bids') return bidRow;
      if (functionName === 'getOrderStatus') return [true, false, bidRow?.[13] === 2 ? 1n : 0n, 1n];
      if (functionName === 'ownerOf') return wallet;
      if (functionName === 'orderComponents') return {
        offerer: escrow, zone: escrow,
        offer: [{ itemType: 1, token: P.weth, identifierOrCriteria: 0n, startAmount: price, endAmount: price }],
        consideration: [{ itemType: 2, token: collection, identifierOrCriteria: bidRow[4], startAmount: 1n, endAmount: 1n, recipient: wallet }],
        orderType: 2, startTime: timestamp - 1n, endTime: timestamp + 3600n,
        zoneHash: zeroHash, salt: 1n, conduitKey: zeroHash, counter: 0n,
      };
      throw Error(`UNEXPECTED_READ_${functionName}`);
    },
    __reconcile: async (review, { transactionHash }) => {
      assert.equal(transactions.get(transactionHash)?.input, review.transaction.data);
      if (receiptReorg) throw Error('RECEIPT_NOT_CANONICAL');
      return { status: review.action === 'CREATE_WETH_BID' ? 'BID_ACTIVE' : 'COMPLETED', transactionHash,
        ...(review.action === 'CREATE_WETH_BID' ? { orderHash } : { items: review.selection.items }) };
    },
  };
  function mine({ from, to, input, value, nonce, logs = [], status = 'success' }) {
    const number = ++head, txHash = hash(1000 + transactions.size);
    const tx = { from, to, input, value, nonce, hash: txHash, chainId: 4663, blockNumber: number, blockHash: hash(Number(number)) };
    const receipt = { transactionHash: txHash, blockNumber: number, blockHash: tx.blockHash, status, logs };
    blocks.set(number, [tx]); transactions.set(txHash, tx); receipts.set(txHash, receipt);
    if (from === owner) ownerNonce++; else sellerNonce++;
    return receipt;
  }
  const before = new Set(await readdir(tmpdir()));
  let journalDir;
  const journal = async () => JSON.parse(await readFile(join(journalDir, 'journal.json'), 'utf8'));
  const deps = { disposableBidDeployment: { environment: 'OWNED_DISPOSABLE_CHAIN', address: escrow, codeHash: keccak256(runtime) },
    __prepare: async request => {
      assert.equal(request.owner, owner); assert.equal(request.punkId, '93');
      const selection = request.action === 'BUY_LISTINGS' ? { collection, items: [{ tokenId: '10001', totalWei: String(price) }] } : request.selection;
      return { action: request.action, expiresAt: Date.now() + 60000, walletRequests: 0, publicTransactions: 0, selection,
        cost: { totalPriceWei: String(price), maximumNetworkFeeWei: '1000', minimumReserveWei: '1000' },
        transaction: { from: owner, to: request.action === 'BUY_LISTINGS' ? wallet : escrow,
          data: request.action === 'BUY_LISTINGS' ? '0x1234' : '0x5678', value: '0x0', nonce: `0x${ownerNonce.toString(16)}` } };
    } };
  const session = await startMarketplacePractice({ client, owner, wallet, collection, escrow, deps, budget: {}, seller,
    assertDisposable: async () => { if (!owned) throw Error('OWNED_PROCESS_EXITED'); }, anchor: block(100n), makeListing: async () => ({ order_hash: orderHash }),
    sendReview: async review => {
      ownerSends++;
      const saved = (await journal()).records.at(-1);
      assert.equal(saved.status, 'WALLET_REQUESTED', 'claim must reach disk before invoking the sender');
      assert.equal(saved.claim.nonce, String(ownerNonce));
      assert.equal(saved.claim.from, owner); assert.equal(saved.claim.to, review.transaction.to);
      assert.equal(saved.claim.data, review.transaction.data); assert.equal(saved.hash, null);
      if (loseOwnerBeforeSend) throw Error('SENDER_RESPONSE_LOST');
      const receipt = mine({ from: owner, to: review.transaction.to, input: review.transaction.data, value: 0n, nonce: ownerNonce });
      if (review.action === 'CREATE_WETH_BID') {
        creation = review;
        bidRow = [owner, wallet, collection, 93n, BigInt(review.selection.tokenId), price, 1n, 0n, timestamp, BigInt(review.selection.deadline), review.selection.anyToken, hash(5), hash(6), 1];
      }
      if (loseOwnerResponse) throw Error('SENDER_RESPONSE_LOST');
      return receipt;
    },
    send: async (from, to, data) => {
      sellerSends++;
      const saved = (await journal()).bids[0][1];
      assert.equal(saved.fillState, 'REQUESTED', 'seller claim must reach disk before invoking the sender');
      assert.equal(saved.claim.from, seller); assert.equal(saved.claim.to, P.seaport); assert.equal(saved.claim.data, data);
      assert.equal(saved.claim.nonce, String(sellerNonce));
      const log = (at, name, args, values, types) => ({ address: at,
        topics: encodeEventTopics({ abi: MARKETPLACE_EVENTS_ABI, eventName: name, args }),
        data: values ? encodeAbiParameters(parseAbiParameters(types), values) : '0x' });
      const transfer = log(collection, 'Transfer', { from: seller, to: wallet, tokenId: 10001n });
      const settled = log(escrow, 'BidSettled', { orderHash });
      const fulfilled = log(P.seaport, 'OrderFulfilled', { offerer: escrow, zone: escrow },
        [orderHash, seller, [], []], 'bytes32,address,(uint8,address,uint256,uint256)[],(uint8,address,uint256,uint256,address)[]');
      if (!revertSeller) bidRow[13] = 2;
      const receipt = mine({ from, to, input: data, value: 0n, nonce: sellerNonce, logs: [transfer, settled, fulfilled], status: revertSeller ? 'reverted' : 'success' });
      if (loseSellerResponse || revertSeller) throw Error('SELLER_RESPONSE_LOST');
      return receipt;
    },
  });
  journalDir = join(tmpdir(), (await readdir(tmpdir())).find(name => !before.has(name) && name.startsWith(fixtureJournalPrefix)));
  assert.ok(journalDir);
  t.after(() => session.close());
  const state = async () => fetch(session.url + '/api/state').then(r => r.json());
  const nonce = (await state()).nonce;
  const post = async (operation, input = {}) => {
    const response = await fetch(session.url + '/api/action', { method: 'POST', headers: {
      origin: session.url, 'content-type': 'application/json', 'x-practice-nonce': nonce,
    }, body: JSON.stringify({ operation, input }) });
    return { status: response.status, body: await response.json() };
  };
  const prepare = async (bid = false) => {
    const result = await post(bid ? 'prepare_bid' : 'prepare_purchase', bid ? { anyToken: false } : { quantity: 1 });
    assert.equal(result.status, 200); return result.body.review.id;
  };
  const confirm = reviewId => post('confirm', { reviewId, phrase: 'CONFIRM COPY' });
  return { post, prepare, confirm, state, journal, get ownerSends() { return ownerSends; }, get sellerSends() { return sellerSends; },
    expireBid() { timestamp = BigInt(creation.selection.deadline) + 1n; },
    loseOwnedProcess() { owned = false; }, consumeOwnerNonce() { ownerNonce++; }, reorgReceipt() { receiptReorg = true; },
  };
}

test('independent: owner response lost after broadcast recovers the original disk claim exactly once', async t => {
  const f = await fixture(t, { loseOwnerResponse: true }), id = await f.prepare();
  assert.equal((await f.confirm(id)).status, 409);
  assert.equal((await f.state()).review.status, 'WALLET_REQUESTED');
  const recovered = await f.post('recheck');
  assert.equal(recovered.status, 200); assert.equal(recovered.body.lastResult.status, 'COMPLETED');
  const txHash = recovered.body.lastResult.transactionHash;
  assert.equal((await f.confirm(id)).body.lastResult.transactionHash, txHash);
  assert.equal(f.ownerSends, 1);
});

test('independent: pre-broadcast response loss never retries the sender or permits a replacement review', async t => {
  const f = await fixture(t, { loseOwnerBeforeSend: true }), id = await f.prepare();
  assert.equal((await f.confirm(id)).status, 409);
  for (let i = 0; i < 3; i++) assert.equal((await f.confirm(id)).body.review.status, 'WALLET_REQUESTED');
  assert.equal((await f.post('prepare_purchase', { quantity: 1 })).body.code, 'PRACTICE_TRANSACTION_CLAIMED');
  assert.equal(f.ownerSends, 1);
});

test('independent: a consumed original nonce with no recoverable transaction remains blocked', async t => {
  const f = await fixture(t, { loseOwnerBeforeSend: true }), id = await f.prepare();
  await f.confirm(id); f.consumeOwnerNonce();
  assert.equal((await f.post('recheck')).body.code, 'PRACTICE_NONCE_CONFLICT');
  assert.equal((await f.confirm(id)).body.code, 'PRACTICE_NONCE_CONFLICT');
  assert.equal(f.ownerSends, 1);
});

test('independent: rejected canonical receipt after recovering a lost response never reports completion or resends', async t => {
  const f = await fixture(t, { loseOwnerResponse: true }), id = await f.prepare();
  await f.confirm(id); f.reorgReceipt();
  const result = await f.post('recheck'); assert.equal(result.status, 409);
  assert.equal((await f.state()).lastResult, null);
  assert.equal((await f.state()).review.status, 'RECONCILIATION_REQUIRED');
  await f.confirm(id); assert.equal(f.ownerSends, 1);
});

test('independent: expired offer must not retain the prominent active-offer result', async t => {
  const f = await fixture(t), id = await f.prepare(true);
  assert.equal((await f.confirm(id)).body.lastResult.status, 'BID_ACTIVE');
  f.expireBid();
  const result = await f.post('recheck');
  assert.equal(result.status, 200); assert.equal(result.body.bids[0].status, 'BID_EXPIRED');
  assert.equal(result.body.lastResult.status, 'BID_EXPIRED');
  assert.equal(result.body.review.status, 'BID_EXPIRED');
  assert.equal((await f.post('fill_bid', { orderHash })).status, 409);
  assert.equal(f.sellerSends, 0);
  const cancel = await f.post('prepare_cancel', { orderHash });
  assert.equal(cancel.status, 200, 'expiry must preserve the cancellation route');
  assert.equal(cancel.body.review.action, 'CANCEL_WETH_BID');
  assert.equal(f.ownerSends, 1, 'cancellation preparation is not a refund broadcast');
});

test('independent: lost seller response recovers its own disk claim, verifies fill and never sends twice', async t => {
  const f = await fixture(t, { loseSellerResponse: true }), id = await f.prepare(true);
  await f.confirm(id);
  assert.equal((await f.post('fill_bid', { orderHash })).status, 409);
  assert.equal((await f.state()).bids[0].fillState, 'REQUESTED');
  const result = await f.post('recheck');
  assert.equal(result.status, 200); assert.equal(result.body.lastResult.status, 'BID_FILLED');
  assert.equal(result.body.bids[0].fillState, 'COMPLETED');
  await f.post('fill_bid', { orderHash }); await f.post('recheck');
  assert.equal(f.sellerSends, 1);
});

test('independent: a previously completed result becomes unverified when its canonical receipt can no longer be proved', async t => {
  const f = await fixture(t), id = await f.prepare();
  assert.equal((await f.confirm(id)).body.lastResult.status, 'COMPLETED');
  f.reorgReceipt();
  assert.equal((await f.post('recheck')).status, 409);
  const state = await f.state();
  assert.notEqual(state.lastResult?.status, 'COMPLETED', 'do not retain an authoritative complete result after losing its canonical receipt');
  const replacement = await f.post('prepare_purchase', { quantity: 1 });
  assert.equal(replacement.status, 409, 'unverified original claim must block replacement preparation');
  assert.equal(f.ownerSends, 1);
});

test('independent: a reverted seller attempt is surfaced distinctly and its original claim is never retried', async t => {
  const f = await fixture(t, { revertSeller: true }), id = await f.prepare(true);
  await f.confirm(id);
  assert.equal((await f.post('fill_bid', { orderHash })).status, 409);
  const result = await f.post('recheck');
  assert.equal(result.status, 200); assert.equal(result.body.bids[0].fillState, 'REVERTED');
  assert.equal(result.body.bids[0].status, 'BID_ACTIVE');
  await f.post('fill_bid', { orderHash }); await f.post('recheck');
  assert.equal(f.sellerSends, 1);
});

test('independent: changed signer nonce blocks a prepared review before a durable send claim', async t => {
  const f = await fixture(t), id = await f.prepare();
  f.consumeOwnerNonce();
  const result = await f.confirm(id);
  assert.equal(result.status, 409); assert.equal(result.body.code, 'PRACTICE_TRANSACTION_PENDING');
  assert.equal(f.ownerSends, 0);
  const record = (await f.journal()).records.at(-1);
  assert.equal(record.status, 'PREPARED'); assert.equal(record.claim, null);
});

test('independent: loss of the owned process prevents confirmation and sanitizes state errors', async t => {
  const f = await fixture(t), id = await f.prepare();
  f.loseOwnedProcess();
  const result = await f.confirm(id);
  assert.equal(result.status, 409); assert.equal(result.body.code, 'PRACTICE_CHECK_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result.body), /OWNED_PROCESS_EXITED/);
  assert.equal(f.ownerSends, 0);
});

test('independent: stale review identifier cannot confirm the replacement unsent review', async t => {
  const f = await fixture(t), oldId = await f.prepare();
  await f.post('cancel_review', { reviewId: oldId });
  const newId = await f.prepare(); assert.notEqual(newId, oldId);
  assert.equal((await f.confirm(oldId)).status, 409);
  assert.equal(f.ownerSends, 0);
  assert.equal((await f.confirm(newId)).status, 200);
  assert.equal(f.ownerSends, 1);
});

async function uiFixture() {
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener() {}
  }
  const actions = ['buy-one', 'buy-two', 'bid-one', 'bid-collection', 'confirm', 'cancel-review', 'recheck'];
  const buttons = actions.map(action => { const button = new Element('button'); button.dataset.action = action; return button; });
  const elements = new Map(['review', 'bids', 'confirmation', 'review-detail', 'status', 'balances', 'result', 'bid-list'].map(id => ['#' + id, new Element()]));
  for (const button of buttons) elements.set(`[data-action="${button.dataset.action}"]`, button);
  const context = { document: { createElement: tag => new Element(tag), querySelector: selector => elements.get(selector), querySelectorAll: () => buttons },
    fetch: () => new Promise(() => {}), AbortSignal, setInterval: () => {}, Date };
  runInNewContext((await readFile(new URL('../scripts/dev/marketplace/practice.js', import.meta.url), 'utf8'))
    + '\nglobalThis.renderFixture=value=>{state=value;busy=false;notice=null;render();};', context);
  return { render: context.renderFixture, get: selector => elements.get(selector),
    rows: () => elements.get('#bid-list').children };
}
const renderedState = ({ status = 'BID_EXPIRED', fillState = null } = {}) => ({ busy: false, lastError: null,
  review: { id: 'review', status, action: 'CREATE_WETH_BID' }, lastResult: { status },
  balance: { nativeWei: '0', funderWethWei: '0' },
  bids: [{ orderHash, status: status === 'BID_FILLED' ? 'FILLED' : status, fillState, tokenId: '10001', anyToken: false, expiresAt: Date.now() - 1000 }] });

test('independent UI: expired offer explains recovery, disables filling, and keeps cancellation and new missions usable', async () => {
  const ui = await uiFixture(); ui.render(renderedState());
  assert.match(ui.get('#status').textContent, /Offer expired.*Cancel.*unused WETH/i);
  assert.equal(ui.get('[data-action="buy-one"]').disabled, false);
  const row = ui.rows()[0];
  assert.equal(row.children.find(node => node.dataset.operation === 'fill_bid').disabled, true);
  assert.equal(row.children.find(node => node.dataset.operation === 'prepare_cancel').disabled, false);
  assert.ok(row.children.some(node => node.textContent.startsWith('Offer deadline:')));
});

test('independent UI: reverted seller attempt cannot invite another send; later cancellation removes refund instructions', async () => {
  const ui = await uiFixture(); ui.render(renderedState({ status: 'BID_ACTIVE', fillState: 'REVERTED' }));
  let row = ui.rows()[0];
  assert.ok(row.children.some(node => /Seller attempt reverted/.test(node.textContent)));
  assert.equal(row.children.find(node => node.dataset.operation === 'fill_bid').disabled, true);
  assert.equal(row.children.find(node => node.dataset.operation === 'prepare_cancel').disabled, false);
  ui.render(renderedState({ status: 'BID_CANCELLED', fillState: 'REVERTED' })); row = ui.rows()[0];
  assert.ok(row.children.some(node => /Cancelled/.test(node.textContent)));
  assert.ok(!row.children.some(node => /cancel to recover/.test(node.textContent)));
});
