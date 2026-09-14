import { decodeFunctionData, encodeFunctionData, keccak256, hashStruct } from 'viem';
import { ACCOUNT_ABI, SEAPORT_ABI, MARKETPLACE_GUARD_ABI, MARKETPLACE_ORDER_TYPES, MARKETPLACE_PINS as P } from '../broker/src/v4/marketplace/contracts.mjs';
const ZERO = `0x${'0'.repeat(40)}`, ZERO_HASH = `0x${'0'.repeat(64)}`;
const check = value => { if (!value) throw Error('Marketplace transaction does not match the purchase review.'); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function decode(abi, data, name) {
  const decoded = decodeFunctionData({ abi, data });
  check(decoded.functionName === name && same(encodeFunctionData({ abi, ...decoded }), data));
  return decoded.args;
}

// Verifies each call's economic meaning as well as its saved byte commitment.
// No arbitrary account call, NFT approval, or provider-selected address is allowed.
export function verifyMarketplaceTransaction(review, transaction) {
  const c = review.transactionCommitment, tx = transaction;
  check(tx && Object.keys(tx).length === 9 && Object.keys(tx).every(k => ['from', 'to', 'chainId', 'type', 'nonce', 'value', 'gas', 'gasPrice', 'data'].includes(k)));
  check(c && ['from', 'to', 'chainId', 'type', 'nonce', 'value', 'gas', 'gasPrice'].every(k => tx[k] === c[k]) && keccak256(tx.data) === c.dataHash);
  check(tx.chainId === '0x1237' && tx.type === '0x0' && tx.value === '0x0' && same(tx.from, review.owner) && same(tx.to, review.wallet));
  const [calls] = decode(ACCOUNT_ABI, tx.data, 'executeBatch'), items = review.selection.items;
  check(items.length >= 1 && items.length <= 5 && calls.length === items.length + 1);
  let total = 0n;
  for (let index = 0; index < items.length; index++) {
    const call = calls[index], item = items[index];
    check(same(call.to, P.seaport) && call.value === BigInt(item.totalWei));
    const [order, criteria, conduit, recipient] = decode(SEAPORT_ABI, call.data, 'fulfillAdvancedOrder');
    const p = order.parameters;
    check(typeof item.counter === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(item.counter)
      && hashStruct({ data: { ...p, counter: BigInt(item.counter) }, primaryType: 'OrderComponents', types: MARKETPLACE_ORDER_TYPES }) === item.orderHash);
    check(order.numerator === 1n && order.denominator === 1n && order.extraData === '0x' && criteria.length === 0 && conduit === ZERO_HASH && same(recipient, review.wallet));
    check(p.orderType === 0 && same(p.zone, ZERO) && p.zoneHash === ZERO_HASH && p.offer.length === 1
      && p.startTime <= BigInt(review.anchor.timestamp) && p.endTime > BigInt(review.anchor.timestamp) + 60n);
    const offered = p.offer[0];
    check(offered.itemType === 2 && same(offered.token, review.selection.collection) && offered.identifierOrCriteria === BigInt(item.tokenId)
      && offered.startAmount === 1n && offered.endAmount === 1n);
    check(p.consideration.length >= 1 && p.consideration.length <= 16 && p.totalOriginalConsiderationItems === BigInt(p.consideration.length));
    let price = 0n;
    for (const payment of p.consideration) {
      check(payment.itemType === 0 && same(payment.token, ZERO) && payment.identifierOrCriteria === 0n
        && payment.startAmount === payment.endAmount && !same(payment.recipient, ZERO));
      price += payment.startAmount;
    }
    check(price > 0n && price === BigInt(item.totalWei)); total += price;
  }
  const guard = calls.at(-1);
  check(same(guard.to, review.purchaseGuard.address) && guard.value === 0n);
  const [punkId, owner, accountState, collection, codeHash, ids, reserve, deadline] = decode(MARKETPLACE_GUARD_ABI, guard.data, 'assertPurchase');
  check(punkId === BigInt(review.punkId) && same(owner, review.owner) && accountState === BigInt(review.accountState) + 1n
    && same(collection, review.selection.collection) && codeHash === review.safety.collectionCodeHash
    && ids.length === items.length && ids.every((id, i) => id === BigInt(items[i].tokenId))
    && reserve === BigInt(review.cost.minimumReserveWei) && deadline === BigInt(review.anchor.timestamp) + 60n);
  check(total === BigInt(review.cost.totalPriceWei) && BigInt(tx.gas) * BigInt(tx.gasPrice) === BigInt(review.cost.maximumNetworkFeeWei));
  return true;
}
