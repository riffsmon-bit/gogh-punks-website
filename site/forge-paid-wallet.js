import { keccak256Hex } from './keccak256.js';
import { PAID_TRAINING_RELEASE } from './forge-paid-release.js';

export const PAID_ZERO_KEY = `0x${'0'.repeat(64)}`;
const OPERATIONS = ['buy', 'activate', 'learn', 'unlock', 'equip', 'unequip'];
const DOMAINS = ['collection', 'registry', 'legacyProgression', 'extension'];
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
// Reviewed transaction fields stay canonical. RPC responses may encode the
// same bounded integer with upper-case digits or leading zeroes.
const HEX = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/;
const RPC_QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;
const QUANTITY_METHODS = new Set(['eth_chainId', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_getBalance']);
const fail = () => { throw Error('The paid training review changed or could not be verified. Recheck before continuing.'); };
const valid = value => { if (!value) fail(); };
const uint = value => typeof value === 'string' && UINT.test(value) && BigInt(value) < 2n ** 256n;
const hash = value => typeof value === 'string' && HASH.test(value) && value !== PAID_ZERO_KEY;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const hex = value => `0x${BigInt(value).toString(16)}`;
const textHex = value => `0x${Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('')}`;
const selector = value => keccak256Hex(textHex(value)).slice(0, 10);
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getLogs']);
const PUBLIC_READ_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const rpcFailure = (code, method) => Object.assign(Error(code), { code, method });
function normalizeReadQuantity(value, method) {
  if (typeof value !== 'string' || !RPC_QUANTITY.test(value)) throw rpcFailure('PAID_RPC_QUANTITY_INVALID', method);
  return hex(value);
}
function normalizeReadResult(method, value) {
  if (QUANTITY_METHODS.has(method)) return normalizeReadQuantity(value, method);
  if (method === 'eth_getBlockByNumber' && value !== null) {
    return { ...value, number: normalizeReadQuantity(value?.number, method),
      timestamp: normalizeReadQuantity(value?.timestamp, method),
      ...(value?.baseFeePerGas === undefined ? {} : { baseFeePerGas: normalizeReadQuantity(value.baseFeePerGas, method) }) };
  }
  return value;
}
// Fixed, public, read-only endpoint. It receives no session cookie, key, signature or send method.
// This keeps archival reads independent of the wallet's selected RPC and its method restrictions.
export function createPaidTrainingReadProvider({ fetcher = globalThis.fetch, timeoutMs = 6000 } = {}) {
  let requestId = 0;
  return Object.freeze({ async request({ method, params = [] }) {
    if (!READ_METHODS.has(method) || !Array.isArray(params) || typeof fetcher !== 'function')
      throw rpcFailure('PAID_CHAIN_READ_UNAVAILABLE', method);
    const controller = new AbortController(), id = ++requestId;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(PUBLIC_READ_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), credentials: 'omit', cache: 'no-store',
        redirect: 'error', signal: controller.signal });
      if (!response.ok) throw rpcFailure('PAID_CHAIN_READ_UNAVAILABLE', method);
      const text = await response.text(); if (text.length > 2_000_000) throw rpcFailure('PAID_CHAIN_READ_UNAVAILABLE', method);
      const payload = JSON.parse(text);
      if (payload?.jsonrpc !== '2.0' || payload.id !== id || payload.error || !Object.hasOwn(payload, 'result'))
        throw rpcFailure('PAID_CHAIN_READ_UNAVAILABLE', method);
      return payload.result;
    } catch { throw rpcFailure(controller.signal.aborted ? 'PAID_CHAIN_READ_TIMEOUT' : 'PAID_CHAIN_READ_UNAVAILABLE', method); }
    finally { clearTimeout(timeout); }
  } });
}
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
  if (!recovery && uint(review.guard.deadline) && Number(review.guard.deadline) * 1000 <= now + 5000) {
    throw Object.assign(Error('This review expired or has too little time left. No wallet request was made. Refresh the unsent review, check the new fee, then confirm.'), { code: 'PAID_REVIEW_EXPIRED' });
  }
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
  isCurrent, now = Date.now, onProgress = () => {}, readProvider = createPaidTrainingReadProvider(), walletReadTimeoutMs = 8000 }) {
  let busy = false;
  return Object.freeze({ async submit(envelope, selection, action) {
    if (busy || wasAttempted()) throw Error('Recover the saved wallet request. It will not be sent again.');
    busy = true;
    let stage = 'Checking the saved review';
    const progress = value => { stage = value; onProgress(value); };
    try {
      valid(isCurrent() && paidReleaseAvailable(release, selection));
      const fixed = structuredClone(envelope), review = fixed.review;
      valid(uint(fixed.maximumNetworkFeeWei));
      validatePaidReview(review, selection, release, { action, maximumNetworkFeeWei: fixed.maximumNetworkFeeWei, now: now() });
      progress('Checking current ownership and training balances');
      const state = validatePaidSnapshot(await readCurrent(), selection, release, now()); valid(isCurrent());
      const transaction = validatePaidReview(review, selection, release, { state, action, now: now() });
      progress('Rechecking the transaction with the training service');
      const verified = await verify(structuredClone(review)); valid(isCurrent() && verified?.ok === true
        && paidReviewIdentity(verified.review) === paidReviewIdentity(review));
      const provider = getProvider(); valid(provider && typeof provider.request === 'function');
      const rpc = async (method, params = []) => {
        if (method === 'eth_sendTransaction') return provider.request({ method, params });
        let timeout;
        try {
          const result = await Promise.race([provider.request({ method, params }), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(rpcFailure('PAID_WALLET_READ_TIMEOUT', method)), walletReadTimeoutMs);
          })]);
          return normalizeReadResult(method, result);
        } catch (error) {
          if (['PAID_WALLET_READ_TIMEOUT', 'PAID_RPC_QUANTITY_INVALID'].includes(error?.code)) throw error;
          const code = Number(error?.code ?? error?.data?.originalError?.code);
          throw rpcFailure([-32601, -32602, 4200].includes(code) ? 'PAID_WALLET_RPC_UNSUPPORTED' : 'PAID_WALLET_READ_UNAVAILABLE', method);
        } finally { clearTimeout(timeout); }
      };
      const read = async (method, params = []) => normalizeReadResult(method, await readProvider.request({ method, params }));
      const walletContext = async () => {
        valid(isCurrent()); const [chain, accounts, pending, latest] = await Promise.all([rpc('eth_chainId'), rpc('eth_accounts'),
          rpc('eth_getTransactionCount', [review.owner, 'pending']), rpc('eth_getTransactionCount', [review.owner, 'latest'])]);
        valid(isCurrent());
        if (BigInt(chain) !== 4663n) throw rpcFailure('PAID_WALLET_WRONG_CHAIN', 'eth_chainId');
        if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== review.owner)
          throw rpcFailure('PAID_WALLET_ACCOUNT_CHANGED', 'eth_accounts');
        if (BigInt(pending) !== BigInt(latest)) throw rpcFailure('PAID_WALLET_PENDING_TRANSACTION', 'eth_getTransactionCount');
        if (BigInt(latest) !== BigInt(transaction.nonce)) throw rpcFailure('PAID_WALLET_NONCE_CHANGED', 'eth_getTransactionCount');
      };
      progress('Checking your wallet account, network and pending transactions');
      await walletContext();
      progress('Checking Robinhood Chain is up to date');
      const [readChain, head] = await Promise.all([read('eth_chainId'), read('eth_getBlockByNumber', ['latest', false])]);
      if (BigInt(readChain) !== 4663n) throw rpcFailure('PAID_CHAIN_MISMATCH', 'eth_chainId');
      valid(isCurrent() && hash(head?.hash) && HEX.test(head.number) && HEX.test(head.timestamp)
        && BigInt(head.number) >= BigInt(review.anchor.number) && BigInt(head.number) - BigInt(review.anchor.number) <= 1000n
        && Number(BigInt(head.timestamp)) * 1000 >= now() - 30000 && Number(BigInt(head.timestamp)) * 1000 <= now() + 5000);
      const call = (to, signature, suffix = '') => read('eth_call', [{ to, data: selector(signature) + suffix }, head.number]);
      progress('Checking contract details, payment and network fee');
      const [codes, owner, nonce, stateHash, anchor, constants, gas, balance] = await Promise.all([
        Promise.all(DOMAINS.map(key => read('eth_getCode', [release[key], head.number]))),
        call(release.collection, 'ownerOf(uint256)', word(review.tokenId)),
        call(release.extension, 'reviewNonce(uint256)', word(review.tokenId)),
        call(release.extension, 'reviewStateHash(uint256)', word(review.tokenId)),
        read('eth_getBlockByNumber', [hex(review.anchor.number), false]),
        Promise.all(['collection', 'registry', 'legacyProgression', 'treasury', 'creditPriceWei'].map(key => call(release.extension, `${key}()`))),
        rpc('eth_estimateGas', [transaction]), rpc('eth_getBalance', [review.owner, 'pending']),
      ]);
      valid(isCurrent() && codes.every((code, index) => /^0x(?:[0-9a-f]{2})+$/.test(code) && keccak256Hex(code) === release[`${DOMAINS[index]}CodeHash`])
        && owner === `0x${word(review.owner)}` && HASH.test(nonce) && BigInt(nonce) === BigInt(review.guard.nonce)
        && stateHash === review.guard.stateHash && anchor?.hash === review.anchor.hash
        && constants.every((value, index) => value === `0x${word(index === 4 ? release.priceWei : release[['collection', 'registry', 'legacyProgression', 'treasury'][index]])}`)
        && HEX.test(gas) && BigInt(gas) > 0n && BigInt(gas) <= BigInt(transaction.gas)
        && HEX.test(balance) && BigInt(balance) >= BigInt(transaction.value) + BigInt(transaction.gas) * BigInt(transaction.maxFeePerGas));
      const closingHead = await read('eth_getBlockByNumber', ['latest', false]);
      valid(isCurrent() && hash(closingHead?.hash) && HEX.test(closingHead.number) && HEX.test(closingHead.timestamp)
        && BigInt(closingHead.number) >= BigInt(head.number) && BigInt(closingHead.number) - BigInt(review.anchor.number) <= 1000n
        && Number(BigInt(closingHead.timestamp)) * 1000 >= now() - 30000 && Number(BigInt(closingHead.timestamp)) * 1000 <= now() + 5000
        && HEX.test(closingHead.baseFeePerGas) && BigInt(closingHead.baseFeePerGas) + BigInt(transaction.maxPriorityFeePerGas) <= BigInt(transaction.maxFeePerGas));
      progress('Checking for ownership changes before opening your wallet');
      const [logs, closingAnchor, closingOwner, closingNonce, closingState] = await Promise.all([
        read('eth_getLogs', [{ address: release.collection, fromBlock: hex(review.anchor.number), toBlock: closingHead.number,
          topics: [keccak256Hex(textHex('Transfer(address,address,uint256)')), null, null, `0x${word(review.tokenId)}`] }]),
        read('eth_getBlockByNumber', [hex(review.anchor.number), false]),
        read('eth_call', [{ to: release.collection, data: selector('ownerOf(uint256)') + word(review.tokenId) }, closingHead.number]),
        read('eth_call', [{ to: release.extension, data: selector('reviewNonce(uint256)') + word(review.tokenId) }, closingHead.number]),
        read('eth_call', [{ to: release.extension, data: selector('reviewStateHash(uint256)') + word(review.tokenId) }, closingHead.number]),
      ]);
      valid(isCurrent() && Array.isArray(logs) && logs.length === 0 && closingAnchor?.hash === review.anchor.hash
        && HEX.test(closingAnchor.number) && BigInt(closingAnchor.number) === BigInt(review.anchor.number)
        && HEX.test(closingAnchor.timestamp) && BigInt(closingAnchor.timestamp) === BigInt(review.anchor.timestamp)
        && closingOwner === owner && closingNonce === nonce && closingState === stateHash);
      const [canonicalClosing, closingReadChain] = await Promise.all([read('eth_getBlockByNumber', [closingHead.number, false]), read('eth_chainId')]);
      if (BigInt(closingReadChain) !== 4663n) throw rpcFailure('PAID_CHAIN_MISMATCH', 'eth_chainId');
      valid(isCurrent() && canonicalClosing?.number === closingHead.number && canonicalClosing?.hash === closingHead.hash);
      await walletContext(); validatePaidReview(review, selection, release, { action, now: now() });
      progress('Saving the request before opening your wallet');
      valid(isCurrent() && !wasAttempted()); await markAttempted(structuredClone(review));
      valid(isCurrent() && wasAttempted()); validatePaidReview(review, selection, release, { action, now: now() });
      progress('Waiting for your wallet confirmation');
      const transactionHash = await rpc('eth_sendTransaction', [transaction]);
      if (!HASH.test(transactionHash ?? '')) throw Error('The wallet response was lost. Recover the transaction hash from wallet activity.');
      return { transactionHash };
    } catch (error) {
      if (wasAttempted() || error?.code === 'PAID_REVIEW_EXPIRED') throw error;
      const contextGuidance = {
        PAID_WALLET_WRONG_CHAIN: 'Switch your wallet to Robinhood Chain, then refresh the unsent review.',
        PAID_WALLET_ACCOUNT_CHANGED: 'Select the wallet that owns this Punk, then refresh the unsent review.',
        PAID_WALLET_PENDING_TRANSACTION: 'Your wallet reports another pending transaction or an inconsistent transaction count. Check wallet activity, let pending transactions finish, then refresh the unsent review.',
        PAID_WALLET_NONCE_CHANGED: 'Your wallet transaction count changed after this review. Refresh the unsent review before confirming.',
        PAID_RPC_QUANTITY_INVALID: 'A network check returned an invalid number. Recheck the connection and refresh the unsent review.',
        PAID_CHAIN_MISMATCH: 'The chain reader is on another network. Recheck before continuing.',
      };
      const codes = ['PAID_CHAIN_READ_TIMEOUT', 'PAID_CHAIN_READ_UNAVAILABLE', 'PAID_WALLET_READ_TIMEOUT', 'PAID_WALLET_READ_UNAVAILABLE', 'PAID_WALLET_RPC_UNSUPPORTED', 'PAID_STORAGE_UNAVAILABLE', ...Object.keys(contextGuidance)];
      const code = codes.includes(error?.code) ? error.code : 'PAID_PREFLIGHT_UNVERIFIED';
      const guidance = contextGuidance[code] ?? (code === 'PAID_STORAGE_UNAVAILABLE' ? 'Allow site storage in your browser and reload before trying again.' : code === 'PAID_WALLET_RPC_UNSUPPORTED'
        ? `Your wallet's network service does not support a required check. Check Robinhood Chain's RPC setting in your wallet, then refresh the unsent review.`
        : 'Recheck your wallet connection and refresh the unsent review before trying again.');
      throw Object.assign(Error(`${stage} failed. No wallet request was made. ${guidance} (${code})`), { code, stage });
    } finally { busy = false; }
  } });
}
