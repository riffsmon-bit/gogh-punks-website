// Fixed unsigned calldata only. No provider, connection, signer, or transaction sender.
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const FIELDS = ['sourceTokenId', 'targetTokenId', 'nonce', 'stateHash', 'deadline'];
const uint = (value, max = (1n << 256n) - 1n) => {
  if (typeof value !== 'bigint' && !(typeof value === 'number' && Number.isSafeInteger(value))
    && !(typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value))) throw Error('INVALID_BURN_UINT');
  const result = BigInt(value); if (result < 0n || result > max) throw Error('INVALID_BURN_UINT'); return result;
};
const word = value => value.toString(16).padStart(64, '0');
export function encodeReviewedBurnCall(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== FIELDS.length
    || Reflect.ownKeys(input).some(key => !FIELDS.includes(key))
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(field => field.get || field.set)) throw Error('INVALID_BURN_REVIEW');
  const source = uint(input.sourceTokenId, 9999n), target = uint(input.targetTokenId, 9999n);
  const nonce = uint(input.nonce), deadline = uint(input.deadline, (1n << 64n) - 1n);
  if (source === target || !HASH.test(input.stateHash) || /^0x0{64}$/i.test(input.stateHash) || deadline === 0n) throw Error('INVALID_BURN_REVIEW');
  // One static five-word tuple: there is no dynamic offset or arbitrary call payload.
  return `0xab806ca2${word(source)}${word(target)}${word(nonce)}${input.stateHash.slice(2).toLowerCase()}${word(deadline)}`;
}
export function encodePunkBurnApproval(burnSource, tokenId) {
  if (!ADDRESS.test(burnSource) || /^0x0{40}$/i.test(burnSource)) throw Error('INVALID_BURN_SOURCE');
  return `0x095ea7b3${burnSource.slice(2).toLowerCase().padStart(64, '0')}${word(uint(tokenId, 9999n))}`;
}
export function encodeBurnReviewCancellation(tokenId) {
  return `0xa704dee0${word(uint(tokenId, 9999n))}`;
}
