// Fixed ABI encoder for a NEW reviewed-progression deployment. This module cannot
// read a wallet, sign, send, grant authority, or select a destination contract.
// Its output still requires pinned deployment/owner/state checks and explicit review.
const ZERO = `0x${'0'.repeat(64)}`;
const HASH = /^0x[0-9a-f]{64}$/i;
const OPERATIONS = ['learn', 'unlock', 'equip', 'unequip', 'claim-rarity'];
const FIELDS = ['tokenId', 'operation', 'skillKey', 'slot', 'startingSlots', 'rarityProof', 'nonce', 'stateHash', 'deadline'];
function uint(value, max = (1n << 256n) - 1n) {
  if (typeof value !== 'bigint' && !(typeof value === 'number' && Number.isSafeInteger(value))
    && !(typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value))) throw Error('INVALID_TRAINING_UINT');
  const n = BigInt(value); if (n < 0n || n > max) throw Error('INVALID_TRAINING_UINT'); return n;
}
const word = n => uint(n).toString(16).padStart(64, '0');
export function encodeReviewedTrainingCall(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).some(k => !FIELDS.includes(k))
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => d.get || d.set)) throw Error('INVALID_TRAINING_REVIEW');
  const token = uint(input.tokenId, 9999n), operation = OPERATIONS.indexOf(input.operation);
  if (operation < 0 || !HASH.test(input.stateHash) || input.stateHash.toLowerCase() === ZERO) throw Error('INVALID_TRAINING_REVIEW');
  const key = input.skillKey ?? ZERO, slot = uint(input.slot ?? 0, 6n), starting = uint(input.startingSlots ?? 0, 3n);
  const proof = input.rarityProof ?? [], nonce = uint(input.nonce), deadline = uint(input.deadline, (1n << 64n) - 1n);
  if (!HASH.test(key) || !Array.isArray(proof) || proof.length > 32 || proof.some(p => !HASH.test(p)) || deadline === 0n
    || ([0, 2].includes(operation) ? key.toLowerCase() === ZERO : key.toLowerCase() !== ZERO)
    || (![2, 3].includes(operation) && slot !== 0n)
    || (operation === 4 ? starting < 1n : starting !== 0n || proof.length !== 0)) throw Error('INVALID_TRAINING_REVIEW');
  // One dynamic tuple parameter: outer offset, nine-word head, bounded bytes32[] tail.
  return `0x11fb3835${word(32)}${word(token)}${word(operation)}${key.slice(2).toLowerCase()}${word(slot)}${word(starting)}${word(9 * 32)}${word(nonce)}${input.stateHash.slice(2).toLowerCase()}${word(deadline)}${word(proof.length)}${proof.map(p => p.slice(2).toLowerCase()).join('')}`;
}
export function encodeTrainingReviewCancellation(tokenId) {
  return `0x2624d0da${word(uint(tokenId, 9999n))}`;
}
