import { assetKey, normalizeAddress, ROBINHOOD } from '../../config.mjs';
import { snapshotExactRecord, snapshotRecord } from '../../control-center/strict-record.mjs';

const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;
const UINT = /^(?:0|[1-9][0-9]{0,77})$/;
const HASH = /^0x[0-9a-f]{64}$/i;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

/** Shape of the existing original-Punk identity, not a new persisted wire format. */
export const PUNK_IDENTITY_JSON_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: Object.freeze(['chainId', 'collection', 'tokenId']),
  properties: Object.freeze({
    chainId: Object.freeze({ type: 'integer', const: ROBINHOOD.chainId }),
    collection: Object.freeze({ type: 'string', const: ROBINHOOD.canonicalCollection }),
    tokenId: Object.freeze({ type: 'string', pattern: TOKEN_ID.source }),
  }),
});

/**
 * @typedef {Readonly<{chainId: 4663, collection: string, tokenId: string}>} PunkIdentity
 * Skills and progression use this stable identity across transfers. Owner and
 * wallet addresses are observations/authority context, never identity keys.
 */

/** @returns {PunkIdentity} */
export function normalizePunkIdentity(value) {
  const source = snapshotExactRecord(value, ['chainId', 'collection', 'tokenId'], 'Punk identity');
  const collection = normalizeAddress(source.collection, 'Punk collection');
  if (source.chainId !== ROBINHOOD.chainId || collection !== ROBINHOOD.canonicalCollection
    || typeof source.tokenId !== 'string' || !TOKEN_ID.test(source.tokenId)) {
    throw new TypeError('PUNK_IDENTITY_INVALID');
  }
  return Object.freeze({ chainId: 4663, collection, tokenId: source.tokenId });
}

/** Reuses the existing assetKey encoding; it does not introduce a second database key. */
export function punkIdentityKey(value) {
  const identity = normalizePunkIdentity(value);
  return assetKey(identity.chainId, identity.collection, identity.tokenId);
}

function identityFromSnapshot(source) {
  return normalizePunkIdentity({ chainId: source.chainId, collection: source.collection,
    tokenId: source.tokenId });
}

function liveAddress(value, label) {
  const normalized = normalizeAddress(value, label);
  if (normalized === ZERO_ADDRESS) throw new TypeError(`${label} cannot be zero`);
  return normalized;
}

function blockHash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) throw new TypeError('PUNK_BLOCK_HASH_INVALID');
  return value.toLowerCase();
}

/**
 * Context guard for ORIGINAL NFT readV2PunkAuthority/readV2ChatAuthority results.
 * Caller must perform the authenticated fresh read and continuity checks.
 * A successful shape/binding check neither proves freshness nor grants authority.
 * Wrapped epoch authority has a separate reader and cannot be substituted here.
 * @returns {void}
 */
export function assertPunkAuthorityBinding(authority, expected) {
  const source = snapshotRecord(authority, 'Punk authority snapshot');
  const selection = snapshotExactRecord(expected, ['identity', 'owner', 'punkWallet'], 'Punk selection');
  if (Object.hasOwn(source, 'authorityModel') || Object.hasOwn(source, 'authorityEpoch')) {
    throw new TypeError('PUNK_AUTHORITY_MODEL_MISMATCH');
  }
  if (punkIdentityKey(identityFromSnapshot(source)) !== punkIdentityKey(selection.identity)) {
    throw new TypeError('PUNK_IDENTITY_MISMATCH');
  }
  if (liveAddress(source.owner, 'current owner') !== liveAddress(selection.owner, 'expected owner')) {
    throw new TypeError('PUNK_OWNER_MISMATCH');
  }
  if (liveAddress(source.punkWallet, 'Punk Wallet') !== liveAddress(selection.punkWallet, 'expected Punk Wallet')) {
    throw new TypeError('PUNK_WALLET_MISMATCH');
  }
  if (typeof source.activated !== 'boolean' || typeof source.blockNumber !== 'string'
    || !UINT.test(source.blockNumber) || typeof source.nativeBalanceWei !== 'string'
    || !UINT.test(source.nativeBalanceWei)) throw new TypeError('PUNK_AUTHORITY_SNAPSHOT_INVALID');
  if (Object.hasOwn(source, 'blockHash')) blockHash(source.blockHash);
}

/**
 * Checks the token/owner/block/epoch binding of the EXISTING resolver result.
 * state must come from the reviewed, pinned createProgressionReader and result
 * from resolvePunkCapabilities. Never use this to validate client-supplied tools
 * or packages: it does not rerun registry/package eligibility or chain reads.
 * It deliberately returns no permission token or economic authorization.
 * @returns {void}
 */
export function assertPunkCapabilityBinding(result, state) {
  const context = snapshotRecord(result, 'Punk capability result');
  const source = snapshotRecord(state, 'Punk progression snapshot');
  const identity = identityFromSnapshot(source);
  if (context.tokenId !== identity.tokenId) throw new TypeError('PUNK_IDENTITY_MISMATCH');
  if (liveAddress(context.owner, 'capability owner') !== liveAddress(source.owner, 'progression owner')) {
    throw new TypeError('PUNK_OWNER_MISMATCH');
  }
  if (blockHash(context.blockHash) !== blockHash(source.blockHash)) {
    throw new TypeError('PUNK_BLOCK_MISMATCH');
  }
  const resultHasEpoch = Object.hasOwn(context, 'authorityEpoch');
  const stateHasEpoch = Object.hasOwn(source, 'authorityEpoch');
  if (resultHasEpoch !== stateHasEpoch || stateHasEpoch && (
    typeof source.authorityEpoch !== 'string' || source.authorityEpoch.length === 0
    || source.authorityEpoch !== context.authorityEpoch
  )) throw new TypeError('PUNK_EPOCH_MISMATCH');
  if (context.walletAuthority !== 'NONE' || context.requiresSeparateEconomicAuthorization !== true) {
    throw new TypeError('CAPABILITIES_CANNOT_GRANT_WALLET_AUTHORITY');
  }
}
