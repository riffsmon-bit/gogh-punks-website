import { encodeFunctionData, decodeFunctionResult, keccak256, toHex, stringToHex } from 'viem';
import { MARKETPLACE_ACTIONS, MARKETPLACE_LIMITS, MARKETPLACE_PINS as P, MARKETPLACE_REVIEW_SCHEMA, ACCOUNT_ABI, SEAPORT_ABI, MARKETPLACE_BID_ABI, MARKETPLACE_GUARD_ABI } from './contracts.mjs';
const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i, UINT = /^(0|[1-9][0-9]{0,77})$/;
const ZERO = `0x${'0'.repeat(40)}`, ZERO_HASH = `0x${'0'.repeat(64)}`, MAX_UINT = 2n ** 256n - 1n;
const fail = code => { throw new Error(code); };
const addr = v => typeof v === 'string' && ADDRESS.test(v) && v.toLowerCase() !== ZERO ? v.toLowerCase() : fail('INVALID_ADDRESS');
const hash = v => typeof v === 'string' && HASH.test(v) ? v.toLowerCase() : fail('INVALID_HASH');
const uint = v => typeof v === 'string' && UINT.test(v) && BigInt(v) <= MAX_UINT ? BigInt(v) : fail('INVALID_EXACT_AMOUNT');
const stringify = v => JSON.stringify(v, (_, value) => typeof value === 'bigint' ? value.toString() : value);

// Only server-fetched protocol parameters enter here. Observational market-reader
// output is intentionally insufficient: its signatures and original order are absent.
export function normalizeNativeListing(raw, { collection, nowSeconds }) {
  collection = addr(collection); const now = BigInt(nowSeconds);
  if (raw?.chain !== 'robinhood' || String(raw.protocol_address).toLowerCase() !== P.seaport) fail('UNSUPPORTED_PROTOCOL_OR_CHAIN');
  if (raw.status !== 'ACTIVE' || ![1, '1'].includes(raw.remaining_quantity)) fail('ORDER_NOT_ACTIVE');
  const p = raw.protocol_data?.parameters;
  if (!p || p.orderType !== 0 || String(p.zone).toLowerCase() !== ZERO || String(p.zoneHash).toLowerCase() !== ZERO_HASH) fail('RESTRICTED_OR_PARTIAL_ORDER_UNSUPPORTED');
  if (!Array.isArray(p.offer) || p.offer.length !== 1 || p.offer[0].itemType !== 2) fail('SINGLE_ERC721_REQUIRED');
  const offered = p.offer[0], tokenId = uint(offered.identifierOrCriteria);
  if (addr(offered.token) !== collection || uint(offered.startAmount) !== 1n || uint(offered.endAmount) !== 1n) fail('NFT_IDENTITY_OR_AMOUNT');
  if (addr(raw.asset?.contract) !== collection || uint(raw.asset?.identifier) !== tokenId) fail('NFT_IDENTITY_OR_AMOUNT');
  const start = uint(p.startTime), end = uint(p.endTime);
  if (start > now || end <= now + 60n || start >= end) fail('ORDER_EXPIRED_OR_TOO_SOON');
  if (!Array.isArray(p.consideration) || p.consideration.length < 1 || p.consideration.length > 16
    || p.totalOriginalConsiderationItems !== p.consideration.length) fail('INVALID_CONSIDERATION');
  let total = 0n;
  const consideration = p.consideration.map(item => {
    if (item.itemType !== 0 || String(item.token).toLowerCase() !== ZERO || uint(item.identifierOrCriteria) !== 0n) fail('NATIVE_ETH_ONLY');
    const value = uint(item.startAmount);
    if (value !== uint(item.endAmount)) fail('FIXED_PRICE_REQUIRED');
    total += value; if (total > MAX_UINT) fail('INVALID_EXACT_AMOUNT');
    return { itemType: 0, token: ZERO, identifierOrCriteria: 0n, startAmount: value, endAmount: value, recipient: addr(item.recipient) };
  });
  if (total <= 0n || uint(raw.price?.current?.value) !== total || raw.price.current.currency !== 'ETH' || raw.price.current.decimals !== 18) fail('PRICE_TOTAL_MISMATCH');
  const signature = raw.protocol_data.signature;
  if (typeof signature !== 'string' || !/^0x(?:[0-9a-f]{128}|[0-9a-f]{130})$/i.test(signature)) fail('UNSUPPORTED_SIGNATURE');
  const parameters = { offerer: addr(p.offerer), zone: ZERO,
    offer: [{ itemType: 2, token: collection, identifierOrCriteria: tokenId, startAmount: 1n, endAmount: 1n }],
    consideration, orderType: 0, startTime: start, endTime: end, zoneHash: ZERO_HASH,
    salt: uint(p.salt), conduitKey: hash(p.conduitKey), totalOriginalConsiderationItems: BigInt(consideration.length) };
  return { orderHash: hash(raw.order_hash), parameters, counter: uint(p.counter), signature,
    tokenId: tokenId.toString(), collection, totalWei: total.toString() };
}

function requestIdentity(request) {
  if (!request || !MARKETPLACE_ACTIONS.includes(request.action) || request.walletRole !== 'AGENT') fail('INVALID_MARKETPLACE_REQUEST');
  const owner = addr(request.owner), punkId = uint(request.punkId).toString();
  if (BigInt(punkId) > 5016n) fail('INVALID_PUNK_ID');
  const budget = { maxTotalPriceWei: uint(request.budget?.maxTotalPriceWei),
    maxNetworkFeeWei: uint(request.budget?.maxNetworkFeeWei), minimumReserveWei: uint(request.budget?.minimumReserveWei) };
  return { owner, punkId, budget };
}

// dependency functions are SERVER OWNED; HTTP adapters must not accept them, raw
// orders, screen results, policy results, runtime hashes, or deployment pins from clients.
export async function prepareMarketplaceReview(request, deps) {
  const { owner, punkId, budget } = requestIdentity(request), { client } = deps;
  const base = { schema: MARKETPLACE_REVIEW_SCHEMA, action: request.action, chainId: P.chainId,
    owner, punkId, walletRole: 'AGENT', automaticSubmission: false, publicTransactions: 0,
    walletRequests: 0, broadcastAuthority: 'OWNER_WALLET_ONLY', availability: 'BLOCKED',
    blockers: [], transaction: null, collectionFloorVerified: false, selectedListingCoverage: 'EXACT_OWNER_SELECTION',
    safety: { status: 'NOT_CHECKED' }, simulation: { status: 'NOT_RUN' } };
  if (request.action === 'BUY_LISTINGS' && !deps.purchaseGuardDeployment) return { ...base, blockers: ['PURCHASE_POSTCONDITION_GUARD_NOT_DEPLOYED'], warning: 'Selected listings can be researched. A purchase requires the reviewed on-chain balance and receipt guard; no transaction was prepared.' };
  if (request.action !== 'BUY_LISTINGS' && !deps.disposableBidDeployment) {
    return { ...base, blockers: ['WETH_BID_ESCROW_NOT_DEPLOYED', 'OWNERSHIP_CONTINUITY_NOT_PROVEN'],
      warning: 'WETH bids are available only in the controlled test environment. No order was posted and no funds moved.' };
  }
  if (await client.getChainId() !== P.chainId) fail('WRONG_CHAIN');
  const anchor = await client.getBlock();
  if (!anchor.number || !HASH.test(anchor.hash) || !anchor.timestamp) fail('ANCHOR_UNAVAILABLE');
  base.anchor = { number: String(anchor.number), hash: anchor.hash, timestamp: String(anchor.timestamp) };
  base.expiresAt = Number(anchor.timestamp + BigInt(MARKETPLACE_LIMITS.reviewSeconds)) * 1000;
  const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args, blockNumber: anchor.number, ccipRead: false });
  const code = async address => { const value = await client.getCode({ address, blockNumber: anchor.number }); if (!value || value === '0x') fail('CONTRACT_CODE_UNAVAILABLE'); return value; };
  for (const [address, expected] of [[P.seaport, P.seaportCodeHash], [P.registry, P.registryCodeHash], [P.implementation, P.implementationCodeHash]]) {
    if (keccak256(await code(address)) !== expected) fail('DEPENDENCY_CODE_CHANGED');
  }
  const recovery = request.action === 'CANCEL_WETH_BID';
  if (!recovery && addr(await read(P.collection, ACCOUNT_ABI, 'ownerOf', [BigInt(punkId)])) !== owner) fail('NOT_CURRENT_OWNER');
  const wallet = addr(await read(P.registry, ACCOUNT_ABI, 'account', [BigInt(punkId)]));
  const walletCode = await code(wallet), walletOwner = recovery ? null : addr(await read(wallet, ACCOUNT_ABI, 'owner'));
  const token = await read(wallet, ACCOUNT_ABI, 'token');
  if ((!recovery && walletOwner !== owner) || token[0] !== 4663n || addr(token[1]) !== P.collection || token[2] !== BigInt(punkId)) fail('WALLET_BINDING_MISMATCH');
  // Canonical ERC6551 facade + exact implementation + matching immutable footer.
  if (!walletCode.toLowerCase().startsWith(`0x363d3d373d3d3d363d73${P.implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`)) fail('WALLET_IMPLEMENTATION_MISMATCH');
  base.wallet = wallet; base.recipient = wallet;
  base.accountState = String(await read(wallet, ACCOUNT_ABI, 'state'));
  const latestNonce = await client.getTransactionCount({ address: owner, blockTag: 'latest' });
  const pendingNonce = await client.getTransactionCount({ address: owner, blockTag: 'pending' });
  if (latestNonce !== pendingNonce) fail('OWNER_TRANSACTION_PENDING');
  let transaction, total = 0n;
  if (request.action === 'BUY_LISTINGS') {
    const collection = addr(request.selection?.collection);
    if (collection === P.collection) fail('CONTROLLING_COLLECTION_UNSUPPORTED');
    const ids = request.selection?.orderHashes;
    if (!Array.isArray(ids) || !ids.length || ids.length > MARKETPLACE_LIMITS.maxListings) fail('INVALID_LISTING_SELECTION');
    const hashes = ids.map(hash);
    if (new Set(hashes).size !== hashes.length) fail('DUPLICATE_ORDER');
    const raw = await deps.loadListings({ collection, orderHashes: hashes, anchor: base.anchor });
    if (!Array.isArray(raw) || raw.length !== hashes.length) fail('LISTING_SOURCE_INCOMPLETE');
    const orders = raw.map(item => normalizeNativeListing(item, { collection, nowSeconds: anchor.timestamp }));
    if (new Set(orders.map(o => o.orderHash)).size !== hashes.length || orders.some(o => !hashes.includes(o.orderHash))) fail('LISTING_SOURCE_MISMATCH');
    if (new Set(orders.map(o => o.tokenId)).size !== orders.length) fail('DUPLICATE_NFT');
    const collectionCodeHash = keccak256(await code(collection));
    const screen = await deps.screenCollection({ collection, codeHash: collectionCodeHash, anchor: base.anchor });
    if (screen?.status !== 'PASS' || screen.collection !== collection || screen.codeHash !== collectionCodeHash) fail('COLLECTION_SCREEN_REQUIRED');
    base.safety = { status: 'PASS', collectionCodeHash, scope: 'REVIEWED_RUNTIME_AND_FIXED_SEAPORT_ORDER', limitations: ['NO_PERFECT_SAFETY_GUARANTEE'] };
    const guard = deps.purchaseGuardDeployment;
    const guardAddress = addr(guard.address);
    if (guard.environment === 'OWNED_DISPOSABLE_CHAIN') { if (typeof deps.assertDisposable !== 'function') fail('DISPOSABLE_CHAIN_REQUIRED'); await deps.assertDisposable(); }
    else if (guard.environment !== 'REVIEWED_PRODUCTION') fail('GUARD_DEPLOYMENT_UNREVIEWED');
    if (keccak256(await code(guardAddress)) !== hash(guard.codeHash) || addr(await read(guardAddress, MARKETPLACE_GUARD_ABI, 'registry')) !== P.registry
      || await read(guardAddress, MARKETPLACE_GUARD_ABI, 'registryCodeHash') !== P.registryCodeHash) fail('PURCHASE_GUARD_BINDING_MISMATCH');
    const calls = [];
    for (const order of orders) {
      const calculated = await read(P.seaport, SEAPORT_ABI, 'getOrderHash', [{ ...order.parameters, counter: order.counter }]);
      if (calculated.toLowerCase() !== order.orderHash) fail('ORDER_HASH_MISMATCH');
      if (await read(P.seaport, SEAPORT_ABI, 'getCounter', [order.parameters.offerer]) !== order.counter) fail('ORDER_COUNTER_CHANGED');
      const status = await read(P.seaport, SEAPORT_ABI, 'getOrderStatus', [order.orderHash]);
      if (status[1] || status[2] !== 0n) fail('ORDER_CANCELLED_OR_FILLED');
      if (order.parameters.offerer === wallet || addr(await read(collection, ACCOUNT_ABI, 'ownerOf', [BigInt(order.tokenId)])) !== order.parameters.offerer) fail('SELLER_NOT_CURRENT_OWNER');
      total += BigInt(order.totalWei);
      calls.push({ to: P.seaport, value: BigInt(order.totalWei), data: encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'fulfillAdvancedOrder',
        args: [{ parameters: order.parameters, numerator: 1n, denominator: 1n, signature: order.signature, extraData: '0x' }, [], ZERO_HASH, wallet] }) });
    }
    calls.push({ to: guardAddress, value: 0n, data: encodeFunctionData({ abi: MARKETPLACE_GUARD_ABI, functionName: 'assertPurchase', args: [BigInt(punkId), owner, BigInt(base.accountState) + 1n, collection, collectionCodeHash, orders.map(o => BigInt(o.tokenId)), budget.minimumReserveWei, anchor.timestamp + 60n] }) });
    base.purchaseGuard = { address: guardAddress, codeHash: guard.codeHash };
    if (total > budget.maxTotalPriceWei) fail('PRICE_BUDGET_EXCEEDED');
    const balance = await client.getBalance({ address: wallet, blockNumber: anchor.number });
    if (balance < total + budget.minimumReserveWei) fail('PUNK_RESERVE_VIOLATION');
    base.selection = { collection, items: orders.map(o => ({ orderHash: o.orderHash, counter: String(o.counter), tokenId: o.tokenId, totalWei: o.totalWei })) };
    base.balance = { nativeWei: String(balance), remainingAfterPurchaseWei: String(balance - total), minimumReserveWei: String(budget.minimumReserveWei) };
    base.note = 'These exact selected listings are bought together or the whole purchase reverts. This is not a verified collection floor. The final on-chain check enforces the remaining balance, current owner, account state and NFT delivery, or the whole purchase reverts.';
    transaction = { from: owner, to: wallet, data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'executeBatch', args: [calls] }), value: 0n };
  } else {
    const deployment = deps.disposableBidDeployment;
    if (deployment.environment !== 'OWNED_DISPOSABLE_CHAIN' || typeof deps.assertDisposable !== 'function') fail('DISPOSABLE_CHAIN_REQUIRED');
    await deps.assertDisposable();
    const escrow = addr(deployment.address);
    if (keccak256(await code(escrow)) !== hash(deployment.codeHash)) fail('BID_ESCROW_CODE_CHANGED');
    base.bidEscrow = { address: escrow, codeHash: hash(deployment.codeHash) };
    if (keccak256(await code(P.weth)) !== P.wethCodeHash) fail('WETH_CODE_CHANGED');
    base.environment = 'OWNED_DISPOSABLE_CHAIN';
    if (request.action === 'CREATE_WETH_BID') {
      const collection = addr(request.selection?.collection), anyToken = request.selection?.anyToken === true;
      const tokenId = uint(request.selection?.tokenId).toString(), price = uint(request.selection?.priceWei), deadline = uint(request.selection?.deadline);
      if (collection === P.collection || price === 0n || price > budget.maxTotalPriceWei || (anyToken && tokenId !== '0')
        || deadline <= anchor.timestamp + 60n || deadline > anchor.timestamp + BigInt(MARKETPLACE_LIMITS.maxBidSeconds)) fail('INVALID_BID_SELECTION');
      const collectionCodeHash = keccak256(await code(collection));
      const screen = await deps.screenCollection({ collection, codeHash: collectionCodeHash, anchor: base.anchor });
      if (screen?.status !== 'PASS' || screen.collection !== collection || screen.codeHash !== collectionCodeHash) fail('COLLECTION_SCREEN_REQUIRED');
      const nonce = await read(escrow, MARKETPLACE_BID_ABI, 'nonces', [owner]);
      total = price; base.selection = { collection, tokenId, anyToken, priceWei: String(price), deadline: String(deadline) };
      base.safety = { status: 'CONTROLLED_TEST_ONLY', collectionCodeHash };
      base.warning = 'This controlled bid wraps the exact owner-funded ETH amount to WETH. Cancellation returns unused WETH to the original funder. Transfer away and back remains a public-release blocker.';
      transaction = { from: owner, to: escrow, value: price, data: encodeFunctionData({ abi: MARKETPLACE_BID_ABI, functionName: 'createBid', args: [BigInt(punkId), collection, BigInt(tokenId), anyToken, price, deadline, nonce, collectionCodeHash] }) };
    } else {
      const orderHash = hash(request.selection?.orderHash), bid = await read(escrow, MARKETPLACE_BID_ABI, 'bids', [orderHash]);
      if (addr(bid[0]) !== owner || addr(bid[1]) !== wallet || bid[3] !== BigInt(punkId)) fail('NOT_BID_FUNDER');
      base.selection = { orderHash, refundCurrency: 'WETH', maximumRefundWei: String(bid[5]), bidBinding: {
        collection: addr(bid[2]), tokenId: String(bid[4]), priceWei: String(bid[5]), salt: String(bid[6]), counter: String(bid[7]),
        createdAt: String(bid[8]), deadline: String(bid[9]), anyToken: bid[10], collectionCodeHash: hash(bid[11]), recipientCodeHash: hash(bid[12]) } };
      base.note = 'If settlement already won the race, this only records completion; it never returns spent bid funds.';
      transaction = { from: owner, to: escrow, value: 0n, data: encodeFunctionData({ abi: MARKETPLACE_BID_ABI, functionName: 'cancelBid', args: [orderHash] }) };
    }
  }
  const policy = recovery ? { decision: 'ALLOW', mode: 'RECOVERY', reason: 'ORIGINAL_BID_FUNDER' } : await deps.policyEvidence({ action: request.action, owner, punkId, wallet, selection: base.selection, totalPriceWei: String(total), budget, anchor: base.anchor });
  if (!recovery && (policy?.decision !== 'ALLOW' || policy.mode !== 'ASSIST' || policy.requiredSkillsEquipped !== true
    || policy.adapterApproved !== true || policy.budgetAllowed !== true)) fail('POLICY_NOT_ALLOWED');
  base.policy = recovery ? policy : { decision: 'ALLOW', mode: 'ASSIST', requiredSkillsEquipped: true, adapterApproved: true, budgetAllowed: true };
  let result, gas;
  try {
    result = await client.call({ account: owner, to: transaction.to, data: transaction.data, value: transaction.value, blockNumber: anchor.number, ccipRead: false });
    gas = await client.estimateGas({ account: owner, to: transaction.to, data: transaction.data, value: transaction.value });
  } catch { fail('SIMULATION_REVERTED_OR_UNAVAILABLE'); }
  if (request.action === 'BUY_LISTINGS') {
    let values;
    try { values = decodeFunctionResult({ abi: ACCOUNT_ABI, functionName: 'executeBatch', data: result.data }); } catch { fail('SIMULATION_RESULT_INVALID'); }
    if (values.length !== base.selection.items.length + 1 || values.at(-1) !== '0x' || values.slice(0, -1).some(data => decodeFunctionResult({ abi: SEAPORT_ABI, functionName: 'fulfillAdvancedOrder', data }) !== true)) fail('SIMULATION_RESULT_INVALID');
  }
  const gasPrice = await client.getGasPrice(); gas = (gas * 120n + 99n) / 100n;
  const maxFee = gas * gasPrice;
  if (maxFee <= 0n || maxFee > budget.maxNetworkFeeWei) fail('NETWORK_FEE_BUDGET_EXCEEDED');
  if (await client.getBalance({ address: owner, blockNumber: anchor.number }) < transaction.value + maxFee) fail('OWNER_GAS_OR_FUNDING_UNAVAILABLE');
  const end = await client.getBlock({ blockNumber: anchor.number });
  if (end.hash !== anchor.hash) fail('ANCHOR_CHANGED');
  const head = await client.getBlock();
  if (head.timestamp >= anchor.timestamp + 60n || head.timestamp < anchor.timestamp) fail('REVIEW_EXPIRED_DURING_PREPARATION');
  base.simulation = { status: 'PASS', anchorHash: anchor.hash, method: 'EXACT_OWNER_TRANSACTION_ETH_CALL', gasEstimate: String(gas), postState: request.action === 'BUY_LISTINGS' ? 'SEAPORT_FULFILLMENT_RETURN_VERIFIED' : 'CONTROLLED_ESCROW_CALL_SIMULATED' };
  base.cost = { currency: 'ETH', totalPriceWei: String(total), maximumNetworkFeeWei: String(maxFee), minimumReserveWei: String(budget.minimumReserveWei), payer: request.action === 'BUY_LISTINGS' ? 'PUNK_WALLET_PRICE_OWNER_GAS' : 'OWNER_WALLET' };
  base.idempotencyKey = keccak256(stringToHex(stringify({ chainId: 4663, action: request.action, owner, punkId, selection: base.selection })));
  base.transaction = { ...transaction, type: '0x0', nonce: toHex(pendingNonce), value: toHex(transaction.value), chainId: toHex(4663), gas: toHex(gas), gasPrice: toHex(gasPrice) };
  base.availability = request.action === 'BUY_LISTINGS' ? 'OWNER_REVIEW_READY' : 'DISPOSABLE_REVIEW_READY';
  return base;
}

// No send/sign/relay method exists here. The HTTP/browser layer owns a durable
// owner-scoped journal and must record WALLET_REQUESTED before the one wallet call.
