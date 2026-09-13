import { keccak256Hex } from './keccak256.js';

// Reviewed immutable release; tests bind these public constants to its manifest.
export const AGENT_RECOVERY_PINS = Object.freeze({
  collection: '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
  registry: '0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844',
  implementation: '0xfdb26c2ec70956227728414ff4ab7a5eda64d13b',
  implementationHash: '0x7d37d360014ce94902655062605b8318581097df100ab2573be52904afa6badc',
  registryHash: '0x5a1001edb812b6ec2e233cbba6db4b7c680d0832453927696cf1ef623fff8e22',
});
const UINT = /^(0|[1-9]\d{0,77})$/, HEX = /^0x(0|[1-9a-f][0-9a-f]*)$/;
const HASH = /^0x[0-9a-f]{64}$/;
const MAX_FEE = 1_000_000_000_000_000n;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const addressWord = value => value.slice(2).padStart(64, '0');
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const emptyResult = `0x${word(32)}${word(0)}`;
export function agentRecoveryFail(code, message = 'Agent recovery could not be verified. Review again.') {
  throw Object.assign(new Error(message), { code: `AGENT_RECOVERY_${code}` });
}
function requireValue(value, code = 'INVALID_REVIEW') { if (!value) agentRecoveryFail(code); }
function record(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.getOwnPropertyDescriptor(value, key)?.enumerable
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
}
function address(value) {
  requireValue(typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0{40}$/.test(value));
  return value;
}
function uint(value, positive = false) {
  requireValue(typeof value === 'string' && UINT.test(value) && BigInt(value) < 2n ** 256n
    && (!positive || BigInt(value) > 0n));
  return BigInt(value);
}
function hex(value) { requireValue(typeof value === 'string' && HEX.test(value)); return BigInt(value); }
function addressResult(value) {
  requireValue(/^0x0{24}[0-9a-fA-F]{40}$/.test(value ?? ''), 'RPC_INVALID');
  return `0x${value.slice(-40).toLowerCase()}`;
}
function uintResult(value) {
  requireValue(/^0x[0-9a-fA-F]{64}$/.test(value ?? ''), 'RPC_INVALID'); return BigInt(value);
}
export function normalizeAgentRecoveryIntent(value) {
  record(value, ['schema', 'tokenId', 'action', 'amountWei', 'assetContract', 'assetTokenId']);
  requireValue(value.schema === 'GOGH_AGENT_RECOVERY_INTENT_V1'
    && typeof value.tokenId === 'string' && /^(0|[1-9]\d{0,3})$/.test(value.tokenId)
    && ['NATIVE', 'ENTRY_POINT', 'ERC721', 'ERC1155'].includes(value.action), 'INVALID_INTENT');
  uint(value.amountWei, true);
  if (['NATIVE', 'ENTRY_POINT'].includes(value.action)) {
    requireValue(value.assetContract === null && value.assetTokenId === null, 'INVALID_INTENT');
  } else {
    address(value.assetContract); uint(value.assetTokenId);
    requireValue(value.assetContract !== AGENT_RECOVERY_PINS.collection
      && (value.action !== 'ERC721' || value.amountWei === '1'), 'INVALID_INTENT');
  }
  return Object.freeze({ schema: value.schema, tokenId: value.tokenId, action: value.action,
    amountWei: value.amountWei, assetContract: value.assetContract, assetTokenId: value.assetTokenId });
}
export function agentRecoveryProxyRuntime(tokenId, salt) {
  requireValue(/^(0|[1-9]\d{0,3})$/.test(tokenId) && HASH.test(salt));
  return `0x363d3d373d3d3d363d73${AGENT_RECOVERY_PINS.implementation.slice(2)}5af43d82803e903d91602b57fd5bf3${salt.slice(2)}${word(4663)}${addressWord(AGENT_RECOVERY_PINS.collection)}${word(tokenId)}`;
}
// Browser independently derives calldata; API-provided calldata is never authority.
export function buildAgentRecoveryTransaction(intentValue, owner, account) {
  const intent = normalizeAgentRecoveryIntent(intentValue); address(owner); address(account);
  let data;
  if (intent.action === 'ENTRY_POINT') data = `0xb94668c0${word(intent.amountWei)}`;
  else {
    const target = intent.action === 'NATIVE' ? owner : intent.assetContract;
    let inner = '';
    if (intent.action === 'ERC721') inner = `42842e0e${addressWord(account)}${addressWord(owner)}${word(intent.assetTokenId)}`;
    if (intent.action === 'ERC1155') inner = `f242432a${addressWord(account)}${addressWord(owner)}${word(intent.assetTokenId)}${word(intent.amountWei)}${word(160)}${word(0)}`;
    data = `0x51945447${addressWord(target)}${word(intent.action === 'NATIVE' ? intent.amountWei : 0)}${word(128)}${word(0)}${word(inner.length / 2)}${inner.padEnd(Math.ceil(inner.length / 64) * 64, '0')}`;
  }
  return { chainId: '0x1237', from: owner, to: account, value: '0x0', data };
}
export function validateAgentRecoveryReview(value) {
  record(value, ['schema', 'intent', 'owner', 'account', 'accountSalt', 'accountRuntimeCodeHash',
    'assetRuntimeCodeHash', 'anchor', 'expiresAt', 'balances', 'session', 'transaction', 'maximumNetworkFeeWei']);
  requireValue(value.schema === 'GOGH_AGENT_RECOVERY_REVIEW_V1');
  const intent = normalizeAgentRecoveryIntent(value.intent); address(value.owner); address(value.account);
  requireValue(HASH.test(value.accountSalt) && value.accountRuntimeCodeHash === keccak256Hex(agentRecoveryProxyRuntime(intent.tokenId, value.accountSalt)));
  requireValue(['NATIVE', 'ENTRY_POINT'].includes(intent.action) ? value.assetRuntimeCodeHash === null : HASH.test(value.assetRuntimeCodeHash));
  record(value.anchor, ['number', 'hash', 'timestamp']); uint(value.anchor.number); uint(value.anchor.timestamp);
  requireValue(HASH.test(value.anchor.hash) && Number.isSafeInteger(value.expiresAt)
    && value.expiresAt > Number(value.anchor.timestamp) * 1000
    && value.expiresAt <= Number(value.anchor.timestamp) * 1000 + 95_000);
  record(value.balances, ['nativeWei', 'entryPointWei', 'assetUnits', 'ownerNativeWei']);
  for (const key of Object.keys(value.balances)) uint(value.balances[key]);
  record(value.session, ['active', 'reserveWei']); requireValue(typeof value.session.active === 'boolean'); uint(value.session.reserveWei);
  record(value.transaction, ['chainId', 'from', 'to', 'value', 'data', 'nonce', 'gas', 'gasPrice']);
  const exact = buildAgentRecoveryTransaction(intent, value.owner, value.account);
  requireValue(Object.entries(exact).every(([key, item]) => value.transaction[key] === item));
  const gas = hex(value.transaction.gas), gasPrice = hex(value.transaction.gasPrice); hex(value.transaction.nonce);
  requireValue(gas > 0n && gas <= 500_000n && gasPrice > 0n && gas * gasPrice <= MAX_FEE
    && uint(value.maximumNetworkFeeWei, true) === gas * gasPrice);
  return copy(value);
}

async function walletRead(provider, method, params = []) {
  try { return await provider.request({ method, params }); }
  catch { agentRecoveryFail('RPC_UNAVAILABLE', 'A chain read is unavailable. The saved transaction will not be resent.'); }
}

async function preflight(provider, review, now) {
  requireValue(review.expiresAt > now() + 5_000, 'REVIEW_EXPIRED');
  const rpc = (method, params = []) => walletRead(provider, method, params);
  const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
  const p = AGENT_RECOVERY_PINS, intent = review.intent;
  const [chain, accounts, registry, implementation, proxy, owner, controllingOwner, registered, salt,
    nonce, latestNonce, gasPrice, ownerBalance, nativeBalance, deposit, active, sessionWords] = await Promise.all([
    rpc('eth_chainId'), rpc('eth_accounts'), rpc('eth_getCode', [p.registry, 'latest']),
    rpc('eth_getCode', [p.implementation, 'latest']), rpc('eth_getCode', [review.account, 'latest']),
    call(review.account, '0x8da5cb5b'), call(p.collection, `0x6352211e${word(intent.tokenId)}`),
    call(p.registry, `0x2dd7c658${word(intent.tokenId)}`), call(p.registry, '0x6c74921e'),
    rpc('eth_getTransactionCount', [review.owner, 'pending']), rpc('eth_getTransactionCount', [review.owner, 'latest']),
    rpc('eth_gasPrice'), rpc('eth_getBalance', [review.owner, 'latest']),
    rpc('eth_getBalance', [review.account, 'latest']), call(review.account, '0xfd5e81c7'), call(review.account, '0xb89d7299'), call(review.account, '0x6753ffde'),
  ]);
  requireValue(hex(chain) === 4663n, 'WRONG_CHAIN');
  requireValue(Array.isArray(accounts) && accounts[0]?.toLowerCase() === review.owner
    && addressResult(owner) === review.owner && addressResult(controllingOwner) === review.owner, 'OWNER_CHANGED');
  requireValue(keccak256Hex(registry) === p.registryHash && keccak256Hex(implementation) === p.implementationHash
    && proxy?.toLowerCase() === agentRecoveryProxyRuntime(intent.tokenId, review.accountSalt)
    && addressResult(registered) === review.account && salt?.toLowerCase() === review.accountSalt, 'RUNTIME_CHANGED');
  requireValue(hex(nonce) === hex(review.transaction.nonce) && hex(latestNonce) === hex(nonce), 'NONCE_CHANGED');
  requireValue(hex(gasPrice) <= hex(review.transaction.gasPrice) && hex(ownerBalance) >= uint(review.maximumNetworkFeeWei), 'FEE_CHANGED');
  requireValue(uintResult(active) === (review.session.active ? 1n : 0n), 'SESSION_CHANGED');
  requireValue(typeof sessionWords === 'string' && /^0x[0-9a-fA-F]{960}$/.test(sessionWords), 'RPC_INVALID');
  const currentReserve = review.session.active ? BigInt(`0x${sessionWords.slice(-64)}`) : 0n;
  requireValue(currentReserve === uint(review.session.reserveWei), 'SESSION_CHANGED');
  const amount = uint(intent.amountWei);
  requireValue(intent.action !== 'ENTRY_POINT' || (!review.session.active && uintResult(deposit) >= amount), 'RECALL_REQUIRED');
  requireValue(intent.action !== 'NATIVE' || hex(nativeBalance) >= amount + uint(review.session.reserveWei), 'BALANCE_CHANGED');
  if (intent.assetContract) {
    const [code, held, supported] = await Promise.all([
      rpc('eth_getCode', [intent.assetContract, 'latest']),
      call(intent.assetContract, intent.action === 'ERC721' ? `0x6352211e${word(intent.assetTokenId)}`
        : `0x00fdd58e${addressWord(review.account)}${word(intent.assetTokenId)}`),
      call(intent.assetContract, `0x01ffc9a7${(intent.action === 'ERC721' ? '80ac58cd' : 'd9b67a26').padEnd(64, '0')}`),
    ]);
    requireValue(keccak256Hex(code) === review.assetRuntimeCodeHash && uintResult(supported) === 1n, 'ASSET_CHANGED');
    requireValue(intent.action === 'ERC721' ? addressResult(held) === review.account : uintResult(held) >= amount, 'ASSET_CHANGED');
  }
  const [simulation, estimate] = await Promise.all([
    rpc('eth_call', [review.transaction, 'latest']), rpc('eth_estimateGas', [review.transaction]),
  ]);
  requireValue(simulation === (intent.action === 'ENTRY_POINT' ? '0x' : emptyResult)
    && hex(estimate) > 0n && hex(estimate) <= hex(review.transaction.gas), 'SIMULATION_FAILED');
}

export function createAgentRecoveryController({ provider, fetchFunction = globalThis.fetch,
  storage = globalThis.localStorage, owner, tokenId, isCurrent, onChange = () => {},
  locks = globalThis.navigator?.locks, now = () => Date.now() }) {
  address(owner); requireValue(/^(0|[1-9]\d{0,3})$/.test(tokenId) && typeof isCurrent === 'function');
  const key = `gogh:agent-recovery:4663:${owner}:${tokenId}`;
  const terminal = ['EMPTY', 'CONFIRMED', 'REVERTED', 'REJECTED', 'CANCELLED'];
  function empty() { return { schema: 'GOGH_AGENT_RECOVERY_JOURNAL_V1', status: 'EMPTY', review: null, transactionHash: null, receipt: null }; }
  function read() {
    let text; try { text = storage.getItem(key); } catch { agentRecoveryFail('STORAGE_UNAVAILABLE'); }
    if (text === null) return empty();
    let value; try { value = JSON.parse(text); } catch { agentRecoveryFail('JOURNAL_INVALID'); }
    record(value, ['schema', 'status', 'review', 'transactionHash', 'receipt']);
    requireValue(value.schema === 'GOGH_AGENT_RECOVERY_JOURNAL_V1'
      && [...terminal, 'PREPARED', 'WALLET_REQUESTED', 'SUBMITTED'].includes(value.status), 'JOURNAL_INVALID');
    if (value.review) {
      validateAgentRecoveryReview(value.review);
      requireValue(value.review.owner === owner && value.review.intent.tokenId === tokenId, 'JOURNAL_INVALID');
    } else requireValue(value.status === 'EMPTY', 'JOURNAL_INVALID');
    requireValue(value.transactionHash === null || HASH.test(value.transactionHash), 'JOURNAL_INVALID');
    return value;
  }
  function save(value) {
    try { const text = JSON.stringify(value); storage.setItem(key, text); requireValue(storage.getItem(key) === text, 'STORAGE_UNAVAILABLE'); }
    catch { agentRecoveryFail('STORAGE_UNAVAILABLE'); }
    try { onChange(copy(value)); } catch { /* A rendering error cannot reopen a wallet request. */ }
    return copy(value);
  }
  async function locked(callback) {
    requireValue(typeof locks?.request === 'function', 'LOCK_UNAVAILABLE');
    return locks.request(key, { mode: 'exclusive' }, callback);
  }
  async function freshReview(intent) {
    requireValue(isCurrent(), 'SELECTION_CHANGED');
    let response, payload;
    try {
      response = await fetchFunction('/api/v2/agent-account/recovery', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent }) });
      payload = await response.json();
    } catch { agentRecoveryFail('PREPARATION_FAILED', 'Recovery checks are unavailable. The saved review is unchanged.'); }
    requireValue(response.ok && payload?.ok === true && payload.review, 'PREPARATION_FAILED');
    const review = validateAgentRecoveryReview(payload.review);
    requireValue(review.owner === owner && review.intent.tokenId === tokenId && same(review.intent, intent), 'SELECTION_CHANGED');
    return review;
  }
  async function reconcile(value) {
    if (!value.transactionHash) return value;
    const rpc = (method, params) => walletRead(provider, method, params);
    requireValue(hex(await rpc('eth_chainId', [])) === 4663n, 'WRONG_CHAIN');
    const [tx, receipt] = await Promise.all([rpc('eth_getTransactionByHash', [value.transactionHash]), rpc('eth_getTransactionReceipt', [value.transactionHash])]);
    if (!tx || !receipt) return value;
    const expected = value.review.transaction;
    requireValue(tx.hash?.toLowerCase() === value.transactionHash && tx.from?.toLowerCase() === expected.from
      && tx.to?.toLowerCase() === expected.to && (tx.input ?? tx.data)?.toLowerCase() === expected.data
      && hex(tx.value) === 0n && hex(tx.nonce) === hex(expected.nonce)
      && hex(tx.gas) === hex(expected.gas) && hex(tx.gasPrice) === hex(expected.gasPrice)
      && hex(tx.chainId) === 4663n && ['0x1', '0x0'].includes(receipt.status)
      && receipt.transactionHash?.toLowerCase() === value.transactionHash && HASH.test(receipt.blockHash), 'RECEIPT_MISMATCH');
    const [block, head] = await Promise.all([rpc('eth_getBlockByNumber', [receipt.blockNumber, false]), rpc('eth_blockNumber', [])]);
    requireValue(block?.hash === receipt.blockHash && hex(block.number) === hex(receipt.blockNumber), 'RECEIPT_MISMATCH');
    if (hex(head) - hex(receipt.blockNumber) + 1n < 12n) return value;
    if (receipt.status === '0x1' && value.review.intent.assetContract) {
      const intent = value.review.intent;
      const matching = (receipt.logs ?? []).filter(log => {
        if (log.removed || log.address?.toLowerCase() !== intent.assetContract || !Array.isArray(log.topics)) return false;
        const topics = log.topics.map(topic => typeof topic === 'string' ? topic.toLowerCase() : '');
        if (intent.action === 'ERC721') return topics.length === 4
          && topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
          && topics[1] === `0x${addressWord(value.review.account)}` && topics[2] === `0x${addressWord(value.review.owner)}`
          && topics[3] === `0x${word(intent.assetTokenId)}` && log.data === '0x';
        return topics.length === 4 && topics[0] === '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
          && topics[1] === `0x${addressWord(value.review.account)}` && topics[2] === `0x${addressWord(value.review.account)}`
          && topics[3] === `0x${addressWord(value.review.owner)}`
          && log.data?.toLowerCase() === `0x${word(intent.assetTokenId)}${word(intent.amountWei)}`;
      });
      requireValue(matching.length === 1, 'ASSET_RECEIPT_MISMATCH');
    }
    return save({ ...value, status: receipt.status === '0x1' ? 'CONFIRMED' : 'REVERTED',
      receipt: { transactionHash: value.transactionHash, blockNumber: hex(receipt.blockNumber).toString(), blockHash: receipt.blockHash, status: receipt.status } });
  }
  return Object.freeze({
    getState: () => copy(read()),
    prepare: intent => locked(async () => {
      requireValue(terminal.includes(read().status), 'PENDING_REVIEW');
      const normalized = normalizeAgentRecoveryIntent(intent);
      requireValue(normalized.tokenId === tokenId, 'SELECTION_CHANGED');
      return save({ ...empty(), status: 'PREPARED', review: await freshReview(normalized) });
    }),
    cancelReview: () => locked(async () => {
      const state = read(); requireValue(['PREPARED', 'REJECTED'].includes(state.status), 'PENDING_WALLET_REQUEST');
      return save({ ...state, status: 'CANCELLED' });
    }),
    submit: () => locked(async () => {
      let state = read(); requireValue(state.status === 'PREPARED', 'PENDING_WALLET_REQUEST');
      const review = validateAgentRecoveryReview(state.review), fresh = await freshReview(review.intent);
      for (const field of ['owner', 'account', 'accountSalt', 'accountRuntimeCodeHash', 'assetRuntimeCodeHash', 'session'])
        requireValue(same(review[field], fresh[field]), 'REVIEW_CHANGED');
      for (const field of ['from', 'to', 'value', 'data', 'chainId', 'nonce'])
        requireValue(review.transaction[field] === fresh.transaction[field], 'REVIEW_CHANGED');
      requireValue(hex(fresh.transaction.gas) <= hex(review.transaction.gas)
        && hex(fresh.transaction.gasPrice) <= hex(review.transaction.gasPrice), 'FEE_CHANGED');
      await preflight(provider, review, now);
      requireValue(isCurrent() && review.expiresAt > now() + 5_000, 'SELECTION_CHANGED');
      state = save({ ...state, status: 'WALLET_REQUESTED' });
      let hash;
      try { hash = await provider.request({ method: 'eth_sendTransaction', params: [copy(review.transaction)] }); }
      catch (error) {
        if (error?.code === 4001) return save({ ...state, status: 'REJECTED' });
        agentRecoveryFail('WALLET_RESULT_UNKNOWN', 'Check wallet activity and recover the original transaction. It will not be resent.');
      }
      requireValue(HASH.test(hash?.toLowerCase() ?? ''), 'WALLET_RESULT_UNKNOWN');
      return save({ ...state, status: 'SUBMITTED', transactionHash: hash.toLowerCase() });
    }),
    refresh: () => locked(async () => reconcile(read())),
    recover: hash => locked(async () => {
      const state = read(); requireValue(['WALLET_REQUESTED', 'SUBMITTED'].includes(state.status)
        && typeof hash === 'string' && HASH.test(hash.toLowerCase()), 'RECOVERY_INVALID');
      requireValue(!state.transactionHash || state.transactionHash === hash.toLowerCase(), 'RECOVERY_HASH_CHANGED');
      // Persist the submitted hash before reads; a provider outage must not lose it.
      return reconcile(save({ ...state, status: 'SUBMITTED', transactionHash: hash.toLowerCase() }));
    }),
  });
}
