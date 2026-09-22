import { keccak256Hex } from './keccak256.js';
import { PAID_TRAINING_RELEASE } from './forge-paid-release.js';

export const PAID_ZERO_KEY = `0x${'0'.repeat(64)}`;
const OPERATIONS = ['buy', 'activate', 'learn', 'unlock', 'equip', 'unequip'];
const DOMAINS = ['collection', 'registry', 'legacyProgression', 'extension'];
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const HEX = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/;
const fail = () => { throw Error('The paid training review changed or could not be verified. Recheck before continuing.'); };
const valid = value => { if (!value) fail(); };
const uint = value => typeof value === 'string' && UINT.test(value) && BigInt(value) < 2n ** 256n;
const hash = value => typeof value === 'string' && HASH.test(value) && value !== PAID_ZERO_KEY;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const hex = value => `0x${BigInt(value).toString(16)}`;
const textHex = value => `0x${Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('')}`;
const selector = value => keccak256Hex(textHex(value)).slice(0, 10);
export const paidReviewIdentity = value => Array.isArray(value) ? `[${value.map(paidReviewIdentity).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${paidReviewIdentity(value[key])}`).join(',')}}` : JSON.stringify(value);
function exact(value, keys) {
  valid(value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value')));
}
export function paidReleaseRecoverable(release, selection) {
  return release?.schema === 'GOGH_PAID_TRAINING_RELEASE_V1' && ['OWNER_CANARY', 'PAUSED'].includes(release.status)
    && release.chainId === 4663 && selection?.chainId === 4663 && !selection.preview
    && ADDRESS.test(selection.owner?.toLowerCase()) && /^[1-9][0-9]{0,3}$/.test(String(selection.tokenId))
    && Number(selection.tokenId) <= 5016 && release.allowedOwners?.includes(selection.owner.toLowerCase())
    && DOMAINS.every(key => ADDRESS.test(release[key]) && BigInt(release[key]) !== 0n && hash(release[`${key}CodeHash`]))
    && new Set(DOMAINS.map(key => release[key])).size === 4
    && ['collection', 'registry', 'legacyProgression', 'treasury', 'priceWei'].every(key => release[key] === PAID_TRAINING_RELEASE[key])
    && uint(release.feeCeilingWei) && BigInt(release.feeCeilingWei) > 0n && BigInt(release.feeCeilingWei) <= 100000000000000n
    && Array.isArray(release.skills) && release.skills.length > 0 && release.skills.length <= 32
    && new Set(release.skills.map(s => s.key)).size === release.skills.length
    && release.skills.every(s => hash(s.key) && typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 150
      && hash(s.manifestHash) && hash(s.instructionHash));
}
export function paidReleaseAvailable(release, selection) {
  return paidReleaseRecoverable(release, selection) && release.status === 'OWNER_CANARY'
    && release.canonicalReadersReviewed === true && release.productionPaymentsAuthorized === true;
}
export function paidPurchaseUseful(state) {
  const useful = state.skills.filter(skill => skill.available && skill.level === 0).length
    + (state.legacyAllocationClaimed > 0 ? 7 - state.unlockedSlots : 0);
  return !state.purchasesPaused && state.burnApprovalActive === false && BigInt(state.purchasedCredits) < BigInt(useful);
}
export function paidTrainingCalldata(tokenId, action, guard) {
  exact(action, ['operation', 'skillKey', 'slot']); exact(guard, ['nonce', 'stateHash', 'deadline']);
  valid(uint(String(tokenId)) && Number(tokenId) >= 1 && Number(tokenId) <= 5016 && OPERATIONS.includes(action.operation)
    && HASH.test(action.skillKey) && (['learn', 'equip'].includes(action.operation) ? hash(action.skillKey) : action.skillKey === PAID_ZERO_KEY)
    && Number.isInteger(action.slot) && action.slot >= 0 && action.slot <= 6
    && (['equip', 'unequip'].includes(action.operation) || action.slot === 0)
    && uint(guard.nonce) && hash(guard.stateHash) && uint(guard.deadline) && BigInt(guard.deadline) < 2n ** 64n);
  return `0xfbfc2393${word(tokenId)}${word(OPERATIONS.indexOf(action.operation))}${action.skillKey.slice(2)}${word(action.slot)}${word(guard.nonce)}${guard.stateHash.slice(2)}${word(guard.deadline)}`;
}
export function validatePaidSnapshot(payload, selection, release, now = Date.now()) {
  valid(paidReleaseAvailable(release, selection) && payload?.ok === true
    && paidReviewIdentity(payload.release) === paidReviewIdentity(release));
  const s = payload.state;
  valid(s && s.chainId === 4663 && s.owner === selection.owner.toLowerCase() && s.tokenId === String(selection.tokenId)
    && typeof s.activated === 'boolean' && typeof s.purchasesPaused === 'boolean' && typeof s.burnApprovalActive === 'boolean'
    && uint(s.purchasedCredits) && uint(s.burnCredits) && uint(s.reviewNonce) && hash(s.reviewStateHash)
    && Number.isInteger(s.unlockedSlots) && s.unlockedSlots >= 1 && s.unlockedSlots <= 7
    && Number.isInteger(s.legacyAllocationClaimed) && s.legacyAllocationClaimed >= 0 && s.legacyAllocationClaimed <= 3
    && uint(s.anchor?.number) && hash(s.anchor.hash) && uint(s.anchor.timestamp)
    && Number(s.anchor.timestamp) * 1000 >= now - 30000 && Number(s.anchor.timestamp) * 1000 <= now + 5000
    && Array.isArray(s.equipped) && s.equipped.length === s.unlockedSlots && s.equipped.every(key => HASH.test(key))
    && Array.isArray(s.skills) && s.skills.length === release.skills.length);
  s.skills.forEach((skill, index) => valid(Object.entries(release.skills[index]).every(([key, value]) => skill[key] === value)
    && Number.isInteger(skill.level) && skill.level >= 0 && skill.level <= 255 && typeof skill.available === 'boolean'));
  return structuredClone(s);
}
export function validatePaidReview(review, selection, release, { state, action = review?.action,
  maximumNetworkFeeWei, now = Date.now(), recovery = false } = {}) {
  valid(recovery ? paidReleaseRecoverable(release, selection) : paidReleaseAvailable(release, selection));
  exact(review, ['schema', 'chainId', 'collection', 'registry', 'legacyProgression', 'extension', 'extensionCodeHash',
    'treasury', 'priceWei', 'owner', 'tokenId', 'action', 'guard', 'anchor', 'transaction']);
  valid(review.schema === 'GOGH_PAID_TRAINING_REVIEW_V1' && review.chainId === 4663
    && [...DOMAINS, 'extensionCodeHash', 'treasury', 'priceWei'].every(key => review[key] === release[key])
    && review.owner === selection.owner.toLowerCase() && review.tokenId === String(selection.tokenId)
    && paidReviewIdentity(review.action) === paidReviewIdentity(action));
  const data = paidTrainingCalldata(review.tokenId, review.action, review.guard), t = review.transaction;
  exact(review.anchor, ['number', 'hash', 'timestamp']);
  exact(t, ['from', 'to', 'data', 'value', 'chainId', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas']);
  valid(uint(review.anchor.number) && hash(review.anchor.hash) && uint(review.anchor.timestamp)
    && BigInt(review.guard.deadline) > BigInt(review.anchor.timestamp)
    && BigInt(review.guard.deadline) <= BigInt(review.anchor.timestamp) + 60n
    && (recovery || Number(review.anchor.timestamp) * 1000 <= now + 5000 && Number(review.guard.deadline) * 1000 > now + 5000)
    && ['nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'value', 'chainId'].every(key => HEX.test(t[key]))
    && t.from === review.owner && t.to === release.extension && t.chainId === '0x1237' && t.data === data
    && t.value === (review.action.operation === 'buy' ? hex(release.priceWei) : '0x0')
    && BigInt(t.nonce) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(t.gas) > 0n && BigInt(t.gas) <= 2000000n
    && BigInt(t.maxFeePerGas) > 0n && BigInt(t.maxPriorityFeePerGas) <= BigInt(t.maxFeePerGas)
    && BigInt(t.gas) * BigInt(t.maxFeePerGas) <= BigInt(release.feeCeilingWei));
  if (maximumNetworkFeeWei !== undefined) valid(uint(maximumNetworkFeeWei) && BigInt(maximumNetworkFeeWei) === BigInt(t.gas) * BigInt(t.maxFeePerGas));
  if (['learn', 'equip'].includes(review.action.operation)) valid(release.skills.some(skill => skill.key === review.action.skillKey));
  if (state) {
    valid(state.owner === review.owner && state.tokenId === review.tokenId && state.reviewNonce === review.guard.nonce && state.reviewStateHash === review.guard.stateHash);
    const operation = review.action.operation, skill = state.skills.find(s => s.key === review.action.skillKey);
    valid(operation === 'buy' ? paidPurchaseUseful(state)
      : operation === 'activate' ? !state.activated : state.activated);
    if (['learn', 'unlock'].includes(operation)) valid(BigInt(state.purchasedCredits) >= 1n);
    if (operation === 'learn') valid(skill?.level === 0 && skill.available);
    if (operation === 'unlock') valid(state.legacyAllocationClaimed > 0 && state.unlockedSlots < 7);
    if (operation === 'equip') valid(skill?.level > 0 && skill.available && !state.equipped.includes(skill.key));
    if (['equip', 'unequip'].includes(operation)) valid(review.action.slot < state.unlockedSlots);
    if (operation === 'unequip') valid(state.equipped[review.action.slot] !== PAID_ZERO_KEY);
  }
  return structuredClone(t);
}

// No account connection, signing or transaction on mount, recovery or release discovery.
export function createPaidTrainingWallet({ getProvider, release, verify, readCurrent, wasAttempted, markAttempted,
  isCurrent, now = Date.now }) {
  let busy = false;
  return Object.freeze({ async submit(envelope, selection, action) {
    if (busy || wasAttempted()) throw Error('Recover the saved wallet request. It will not be sent again.');
    busy = true;
    try {
      valid(isCurrent() && paidReleaseAvailable(release, selection));
      const fixed = structuredClone(envelope), review = fixed.review;
      valid(uint(fixed.maximumNetworkFeeWei));
      validatePaidReview(review, selection, release, { action, maximumNetworkFeeWei: fixed.maximumNetworkFeeWei, now: now() });
      const state = validatePaidSnapshot(await readCurrent(), selection, release, now()); valid(isCurrent());
      const transaction = validatePaidReview(review, selection, release, { state, action, now: now() });
      const verified = await verify(structuredClone(review)); valid(isCurrent() && verified?.ok === true
        && paidReviewIdentity(verified.review) === paidReviewIdentity(review));
      const provider = getProvider(); valid(provider && typeof provider.request === 'function');
      const rpc = (method, params = []) => provider.request({ method, params });
      const walletContext = async () => {
        valid(isCurrent()); const [chain, accounts, pending, latest] = await Promise.all([rpc('eth_chainId'), rpc('eth_accounts'),
          rpc('eth_getTransactionCount', [review.owner, 'pending']), rpc('eth_getTransactionCount', [review.owner, 'latest'])]);
        valid(isCurrent() && chain === '0x1237' && accounts?.[0]?.toLowerCase() === review.owner
          && HEX.test(pending) && HEX.test(latest) && BigInt(pending) === BigInt(transaction.nonce) && BigInt(latest) === BigInt(transaction.nonce));
      };
      await walletContext();
      const head = await rpc('eth_getBlockByNumber', ['latest', false]);
      valid(isCurrent() && hash(head?.hash) && HEX.test(head.number) && HEX.test(head.timestamp)
        && BigInt(head.number) >= BigInt(review.anchor.number) && BigInt(head.number) - BigInt(review.anchor.number) <= 1000n
        && Number(BigInt(head.timestamp)) * 1000 >= now() - 30000 && Number(BigInt(head.timestamp)) * 1000 <= now() + 5000);
      const call = (to, signature, suffix = '') => rpc('eth_call', [{ to, data: selector(signature) + suffix }, head.number]);
      const [codes, owner, nonce, stateHash, anchor, constants, gas, balance] = await Promise.all([
        Promise.all(DOMAINS.map(key => rpc('eth_getCode', [release[key], head.number]))),
        call(release.collection, 'ownerOf(uint256)', word(review.tokenId)),
        call(release.extension, 'reviewNonce(uint256)', word(review.tokenId)),
        call(release.extension, 'reviewStateHash(uint256)', word(review.tokenId)),
        rpc('eth_getBlockByNumber', [hex(review.anchor.number), false]),
        Promise.all(['collection', 'registry', 'legacyProgression', 'treasury', 'creditPriceWei'].map(key => call(release.extension, `${key}()`))),
        rpc('eth_estimateGas', [transaction]), rpc('eth_getBalance', [review.owner, 'pending']),
      ]);
      valid(isCurrent() && codes.every((code, index) => /^0x(?:[0-9a-f]{2})+$/.test(code) && keccak256Hex(code) === release[`${DOMAINS[index]}CodeHash`])
        && owner === `0x${word(review.owner)}` && HASH.test(nonce) && BigInt(nonce) === BigInt(review.guard.nonce)
        && stateHash === review.guard.stateHash && anchor?.hash === review.anchor.hash
        && constants.every((value, index) => value === `0x${word(index === 4 ? release.priceWei : release[['collection', 'registry', 'legacyProgression', 'treasury'][index]])}`)
        && HEX.test(gas) && BigInt(gas) > 0n && BigInt(gas) <= BigInt(transaction.gas)
        && HEX.test(balance) && BigInt(balance) >= BigInt(transaction.value) + BigInt(transaction.gas) * BigInt(transaction.maxFeePerGas));
      const closingHead = await rpc('eth_getBlockByNumber', ['latest', false]);
      valid(isCurrent() && hash(closingHead?.hash) && HEX.test(closingHead.number) && HEX.test(closingHead.timestamp)
        && BigInt(closingHead.number) >= BigInt(head.number) && BigInt(closingHead.number) - BigInt(review.anchor.number) <= 1000n
        && Number(BigInt(closingHead.timestamp)) * 1000 >= now() - 30000 && Number(BigInt(closingHead.timestamp)) * 1000 <= now() + 5000
        && HEX.test(closingHead.baseFeePerGas) && BigInt(closingHead.baseFeePerGas) + BigInt(transaction.maxPriorityFeePerGas) <= BigInt(transaction.maxFeePerGas));
      const [logs, closingAnchor, closingOwner, closingNonce, closingState] = await Promise.all([
        rpc('eth_getLogs', [{ address: release.collection, fromBlock: hex(review.anchor.number), toBlock: closingHead.number,
          topics: [keccak256Hex(textHex('Transfer(address,address,uint256)')), null, null, `0x${word(review.tokenId)}`] }]),
        rpc('eth_getBlockByNumber', [hex(review.anchor.number), false]),
        rpc('eth_call', [{ to: release.collection, data: selector('ownerOf(uint256)') + word(review.tokenId) }, closingHead.number]),
        rpc('eth_call', [{ to: release.extension, data: selector('reviewNonce(uint256)') + word(review.tokenId) }, closingHead.number]),
        rpc('eth_call', [{ to: release.extension, data: selector('reviewStateHash(uint256)') + word(review.tokenId) }, closingHead.number]),
      ]);
      valid(isCurrent() && Array.isArray(logs) && logs.length === 0 && closingAnchor?.hash === review.anchor.hash
        && HEX.test(closingAnchor.number) && BigInt(closingAnchor.number) === BigInt(review.anchor.number)
        && HEX.test(closingAnchor.timestamp) && BigInt(closingAnchor.timestamp) === BigInt(review.anchor.timestamp)
        && closingOwner === owner && closingNonce === nonce && closingState === stateHash);
      const canonicalClosing = await rpc('eth_getBlockByNumber', [closingHead.number, false]);
      valid(isCurrent() && canonicalClosing?.number === closingHead.number && canonicalClosing?.hash === closingHead.hash);
      await walletContext(); validatePaidReview(review, selection, release, { action, now: now() });
      valid(isCurrent() && !wasAttempted()); await markAttempted(structuredClone(review));
      valid(isCurrent() && wasAttempted()); validatePaidReview(review, selection, release, { action, now: now() });
      const transactionHash = await rpc('eth_sendTransaction', [transaction]);
      if (!HASH.test(transactionHash ?? '')) throw Error('The wallet response was lost. Recover the transaction hash from wallet activity.');
      return { transactionHash };
    } finally { busy = false; }
  } });
}
