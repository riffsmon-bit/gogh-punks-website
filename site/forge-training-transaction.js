// Minimal, fixed ABI encoding shared by the browser review and tests. No arbitrary calls.
const word = n => BigInt(n).toString(16).padStart(64, '0');
export function trainingCalldata({ tokenId, operation, key, slot }) {
  if (!/^(0|[1-9]\d*)$/.test(String(tokenId)) || BigInt(tokenId) >= 2n ** 256n) throw Error('Invalid training token');
  if (['learn', 'equip'].includes(operation) && !/^0x[0-9a-f]{64}$/i.test(key)) throw Error('Invalid skill key');
  if (['equip', 'unequip'].includes(operation) && (!Number.isInteger(slot) || slot < 0 || slot > 6)) throw Error('Invalid training slot');
  if (operation === 'learn') return `0x94768240${word(tokenId)}${key.slice(2)}`;
  if (operation === 'unlock') return `0x6a9787bc${word(tokenId)}`;
  if (operation === 'equip') return `0xc7cd679a${word(tokenId)}${word(slot)}${key.slice(2)}`;
  if (operation === 'unequip') return `0xf8d9be60${word(tokenId)}${word(slot)}`;
  throw Error('Training operation not allowed');
}
export function validateTrainingReview(review, state, action, now = Date.now()) {
  const tx = review?.transaction;
  if (!review || review.localOnly !== true || review.productionAuthority !== false || review.chainId !== 31337
    || review.tokenId !== state.tokenId || review.owner?.toLowerCase() !== state.owner.toLowerCase()
    || review.progression?.toLowerCase() !== state.progression.toLowerCase() || review.operation !== action.operation
    || review.skillKey !== (action.key ?? null) || review.slot !== (action.slot ?? null)
    || review.creditCost !== (['learn', 'unlock'].includes(action.operation) ? 1 : 0)
    || !/^[0-9a-f]{64}$/.test(review.intentId) || !Number.isSafeInteger(review.expiresAt)
    || !Number.isSafeInteger(review.createdAt) || review.createdAt > now + 5000 || review.expiresAt < now
    || review.expiresAt - review.createdAt > 60_000 || review.expiresAt <= review.createdAt
    || !tx || Object.keys(tx).sort().join(',') !== 'chainId,data,from,gas,gasPrice,nonce,to,value'
    || !/^0x(0|[1-9a-f][0-9a-f]{0,13})$/i.test(tx.nonce) || BigInt(tx.nonce) > BigInt(Number.MAX_SAFE_INTEGER)
    || tx.from?.toLowerCase() !== state.owner.toLowerCase() || tx.to?.toLowerCase() !== state.progression.toLowerCase()
    || tx.chainId !== '0x7a69' || tx.value !== '0x0'
    || tx.data?.toLowerCase() !== trainingCalldata({ tokenId: state.tokenId, ...action }).toLowerCase()
    || !/^0x[0-9a-f]{1,16}$/i.test(tx.gas) || !/^0x[0-9a-f]{1,16}$/i.test(tx.gasPrice)
    || BigInt(tx.gas) > 500_000n || BigInt(tx.gas) <= 0n || BigInt(tx.gasPrice) <= 0n
    || String(BigInt(tx.gas)) !== review.maximumGas
    || String(BigInt(tx.gas) * BigInt(tx.gasPrice)) !== review.maximumNetworkFeeWei) throw Error('Unverified training transaction review');
  return review;
}
