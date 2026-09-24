import { keccak256Hex } from './keccak256.js';
import { AGENT_RECOVERY_PINS as PINS, agentRecoveryProxyRuntime } from './punk-agent-recovery.js';

// This module can send only the deployed registry's createAccount(uint256).
// Account creation is independent of funding, sessions and mission permission.
const CHAIN = 4663, MAX_GAS = 1_000_000n, MAX_FEE = 10n ** 15n;
const CANONICAL = '0x000000006551c19487814612e58fe06813775758';
const HASH = /^0x[0-9a-f]{64}$/, ADDRESS = /^0x[0-9a-f]{40}$/, QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/;
const READS = new Set(['eth_chainId', 'eth_accounts', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_gasPrice', 'eth_estimateGas', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
const pending = record => ['WALLET_REQUESTED', 'SUBMITTED'].includes(record?.status);
const copy = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const stable = value => Array.isArray(value) ? `[${value.map(stable)}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key]))}}` : JSON.stringify(value);
const equal = (a, b) => stable(a) === stable(b);
const word = value => BigInt(value).toString(16).padStart(64, '0');
const hex = value => '0x' + BigInt(value).toString(16);
const digest = text => keccak256Hex('0x' + Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join(''));
const selector = signature => digest(signature).slice(0, 10);
function valid(ok, code, message = 'Account creation could not be verified. Recheck this Punk before continuing.') {
  if (!ok) throw Object.assign(Error(message), { code: 'AGENT_CREATION_' + code });
}
function address(value) { valid(typeof value === 'string' && ADDRESS.test(value) && BigInt(value) !== 0n, 'IDENTITY'); return value; }
function identity(owner, tokenId) {
  const holder = address(typeof owner === 'string' ? owner.toLowerCase() : owner), id = String(tokenId);
  valid(/^(0|[1-9]\d{0,3})$/.test(id) && BigInt(id) <= 5016n, 'IDENTITY'); return { owner: holder, tokenId: id };
}
function quantity(value) { valid(typeof value === 'string' && QUANTITY.test(value), 'READ_INVALID'); return BigInt(value); }
function uint(value) { valid(typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value) && BigInt(value) < 2n ** 256n, 'REVIEW_INVALID'); return BigInt(value); }
function hash(value) { valid(typeof value === 'string' && HASH.test(value) && BigInt(value) !== 0n, 'READ_INVALID'); return value; }
function resultWord(value) { valid(/^0x[0-9a-fA-F]{64}$/.test(value ?? ''), 'READ_INVALID'); return value.toLowerCase(); }
function resultAddress(value) { const result = resultWord(value); valid(/^0x0{24}/.test(result), 'READ_INVALID'); return address('0x' + result.slice(-40)); }
function exact(value, keys) {
  valid(value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value')), 'REVIEW_INVALID');
}
function reader(provider, readProvider) {
  valid(typeof provider?.request === 'function', 'PROVIDER', 'Connect the Punk owner wallet on Robinhood Chain.');
  const walletMethods = new Set(['eth_accounts', 'eth_getTransactionCount']);
  const request = async (method, params) => {
    if (!readProvider || walletMethods.has(method)) return provider.request({ method, params });
    valid(typeof readProvider.request === 'function', 'READ_UNAVAILABLE');
    if (method === 'eth_chainId') {
      const [walletChain, readChain] = await Promise.all([provider.request({ method, params }), readProvider.request({ method, params })]);
      valid(quantity(walletChain) === quantity(readChain), 'READ_CHAIN_CHANGED', 'The chain reader and your wallet disagree. Reconnect on Robinhood Chain.');
      return walletChain;
    }
    return readProvider.request({ method, params });
  };
  return async (method, params = []) => {
    valid(READS.has(method), 'READ_ONLY'); let timer;
    try { return await Promise.race([Promise.resolve().then(() => request(method, params)), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('timeout')), 8000);
    })]); } catch (error) {
      if (['AGENT_CREATION_READ_CHAIN_CHANGED', 'AGENT_CREATION_READ_INVALID'].includes(error?.code)) throw error;
      if (error?.code === 'SWARM_WALLET_FEE_CHANGED') valid(false, 'FEE_CHANGED', 'Network fees changed. Review creation again.');
      valid(false, 'READ_UNAVAILABLE', 'A chain check is unavailable. No new wallet request was made by this check; preserve any saved transaction.');
    }
    finally { clearTimeout(timer); }
  };
}
async function wallet(rpc, owner, nonce) {
  const [chain, accounts] = await Promise.all([rpc('eth_chainId'), rpc('eth_accounts')]);
  valid(quantity(chain) === BigInt(CHAIN) && Array.isArray(accounts) && accounts[0]?.toLowerCase() === owner, 'OWNER_CHANGED', 'Reconnect this Punk’s owner wallet on Robinhood Chain.');
  if (nonce !== undefined) {
    const values = await Promise.all(['latest', 'pending'].map(tag => rpc('eth_getTransactionCount', [owner, tag])));
    valid(values.every(value => quantity(value) === uint(nonce)), 'NONCE_CHANGED', 'Your wallet has another transaction. Wait for it, then review creation again.');
  }
}
function block(value, fresh = false) {
  const number = quantity(value?.number), timestamp = quantity(value?.timestamp); hash(value?.hash);
  if (fresh) valid(timestamp * 1000n >= BigInt(Date.now() - 30_000) && timestamp * 1000n <= BigInt(Date.now() + 5000), 'STALE_CHAIN');
  return { number: String(number), timestamp: String(timestamp), hash: value.hash };
}
async function canonical(rpc, anchor) { valid(equal(block(await rpc('eth_getBlockByNumber', [hex(anchor.number), false])), anchor), 'CHAIN_CHANGED'); }
function accountAddress(tokenId, salt) {
  const initHash = keccak256Hex('0x3d60ad80600a3d3981f3' + agentRecoveryProxyRuntime(tokenId, salt).slice(2));
  return '0x' + keccak256Hex('0xff' + CANONICAL.slice(2) + salt.slice(2) + initHash.slice(2)).slice(-40);
}
async function binding(rpc, tokenId, at) {
  const call = (to, name, args = '') => rpc('eth_call', [{ to, data: selector(name) + args }, at]);
  const names = ['accountSalt()', 'canonicalRegistry()', 'ROBINHOOD_CHAIN_ID()', 'GOGH_PUNKS()', 'implementation()'];
  const [registryCode, implementationCode, values, ownerWord, accountWord, createdWord] = await Promise.all([
    rpc('eth_getCode', [PINS.registry, at]), rpc('eth_getCode', [PINS.implementation, at]),
    Promise.all(names.map(name => call(PINS.registry, name))), call(PINS.collection, 'ownerOf(uint256)', word(tokenId)),
    call(PINS.registry, 'account(uint256)', word(tokenId)), call(PINS.registry, 'isAccountCreated(uint256)', word(tokenId)),
  ]);
  valid(keccak256Hex(registryCode) === PINS.registryHash && keccak256Hex(implementationCode) === PINS.implementationHash, 'CODE_CHANGED');
  const accountSalt = resultWord(values[0]), owner = resultAddress(ownerWord), account = resultAddress(accountWord);
  valid(resultAddress(values[1]) === CANONICAL && BigInt(resultWord(values[2])) === BigInt(CHAIN)
    && resultAddress(values[3]) === PINS.collection && resultAddress(values[4]) === PINS.implementation
    && account === accountAddress(tokenId, accountSalt), 'CONFIG_CHANGED');
  const code = await rpc('eth_getCode', [account, at]), flag = BigInt(resultWord(createdWord));
  valid((flag === 0n || flag === 1n) && (flag === 1n) === (code !== '0x'), 'CODE_CHANGED');
  if (flag === 1n) valid(code?.toLowerCase() === agentRecoveryProxyRuntime(tokenId, accountSalt)
    && resultAddress(await call(account, 'owner()')) === owner, 'CODE_CHANGED');
  return { owner, tokenId, account, accountSalt, created: flag === 1n };
}
export async function readAgentWalletCreation(provider, context) {
  const { owner, tokenId } = identity(context.owner, context.tokenId), rpc = reader(provider, context.readProvider);
  await wallet(rpc, owner);
  const anchor = block(await rpc('eth_getBlockByNumber', ['latest', false]), true);
  const state = await binding(rpc, tokenId, hex(anchor.number));
  valid(state.owner === owner, 'PUNK_OWNER_CHANGED', 'This wallet no longer owns the selected Punk.');
  const nonce = quantity(await rpc('eth_getTransactionCount', [owner, 'latest'])).toString();
  const balanceWei = quantity(await rpc('eth_getBalance', [owner, 'pending'])).toString();
  await canonical(rpc, anchor); await wallet(rpc, owner, nonce);
  return freeze({ schema: 'GOGH_AGENT_CREATION_STATE_V1', chainId: CHAIN, ...state, nonce, balanceWei, anchor });
}
function validateReview(review, fresh = false) {
  exact(review, ['schema', 'owner', 'tokenId', 'chainId', 'registry', 'account', 'accountSalt', 'anchor', 'expiresAt', 'maximumNetworkFeeWei', 'transaction']);
  valid(review.schema === 'GOGH_AGENT_CREATION_REVIEW_V1' && review.chainId === CHAIN && review.registry === PINS.registry, 'REVIEW_INVALID');
  valid(equal(identity(review.owner, review.tokenId), { owner: review.owner, tokenId: review.tokenId }), 'REVIEW_INVALID');
  resultWord(review.accountSalt); valid(address(review.account) === accountAddress(review.tokenId, review.accountSalt), 'REVIEW_INVALID');
  exact(review.anchor, ['number', 'timestamp', 'hash']); uint(review.anchor.number); uint(review.anchor.timestamp); hash(review.anchor.hash);
  valid(Number.isSafeInteger(review.expiresAt) && BigInt(review.expiresAt) === (uint(review.anchor.timestamp) + 90n) * 1000n, 'REVIEW_INVALID');
  if (fresh) valid(review.expiresAt > Date.now() + 5000 && Number(review.anchor.timestamp) * 1000 <= Date.now() + 5000, 'EXPIRED', 'This creation review expired. Review it again before opening your wallet.');
  const tx = review.transaction; exact(tx, ['chainId', 'from', 'to', 'value', 'data', 'nonce', 'gas', 'gasPrice']);
  valid(tx.chainId === '0x1237' && tx.from === review.owner && tx.to === PINS.registry && tx.value === '0x0'
    && tx.data === selector('createAccount(uint256)') + word(review.tokenId), 'REVIEW_INVALID');
  quantity(tx.nonce); const gas = quantity(tx.gas), price = quantity(tx.gasPrice);
  valid(gas > 0n && gas <= MAX_GAS && price > 0n && gas * price === uint(review.maximumNetworkFeeWei) && gas * price <= MAX_FEE, 'FEE_LIMIT');
}
async function simulate(rpc, review) {
  const [result, estimate, price] = await Promise.all([rpc('eth_call', [review.transaction, 'latest']), rpc('eth_estimateGas', [review.transaction]), rpc('eth_gasPrice')]);
  valid(resultAddress(result) === review.account, 'SIMULATION');
  valid(quantity(estimate) > 0n && quantity(estimate) <= quantity(review.transaction.gas)
    && quantity(price) > 0n && quantity(price) <= quantity(review.transaction.gasPrice), 'FEE_CHANGED', 'Network fees changed. Review creation again.');
}
async function recheck(provider, rpc, review, readProvider) {
  const state = await readAgentWalletCreation(provider, { ...review, readProvider });
  valid(!state.created, 'ALREADY_CREATED', 'This Agent Account already exists. Check it and continue to funding.');
  valid(state.account === review.account && state.accountSalt === review.accountSalt && uint(state.nonce) === quantity(review.transaction.nonce), 'REVIEW_CHANGED');
  valid(uint(state.balanceWei) >= uint(review.maximumNetworkFeeWei), 'INSUFFICIENT_FUNDS', 'Your connected wallet needs enough ETH for the creation network fee.');
  await canonical(rpc, review.anchor); validateReview(review, true);
}
export async function prepareAgentWalletCreation(provider, context) {
  const state = await readAgentWalletCreation(provider, context);
  if (state.created) return state;
  const rpc = reader(provider, context.readProvider), observedPrice = quantity(await rpc('eth_gasPrice'));
  valid(observedPrice > 0n, 'FEE_CHANGED');
  // Review a bounded fee margin so a small base-fee movement does not force
  // another review before the wallet opens. The hard total-fee cap still applies.
  const gasPrice = (observedPrice * 120n + 99n) / 100n;
  const transaction = { chainId: '0x1237', from: state.owner, to: PINS.registry, value: '0x0',
    data: selector('createAccount(uint256)') + word(state.tokenId), nonce: hex(state.nonce), gas: '0x0', gasPrice: hex(gasPrice) };
  const { gas: unused, ...estimateTx } = transaction;
  const estimate = quantity(await rpc('eth_estimateGas', [estimateTx]));
  transaction.gas = hex((estimate * 120n + 99n) / 100n + 10_000n);
  const review = { schema: 'GOGH_AGENT_CREATION_REVIEW_V1', owner: state.owner, tokenId: state.tokenId, chainId: CHAIN, registry: PINS.registry,
    account: state.account, accountSalt: state.accountSalt, anchor: state.anchor, expiresAt: Number(uint(state.anchor.timestamp) + 90n) * 1000,
    maximumNetworkFeeWei: String(quantity(transaction.gas) * gasPrice), transaction };
  valid(estimate > 0n, 'SIMULATION'); validateReview(review, true); await simulate(rpc, review); await recheck(provider, rpc, review, context.readProvider);
  return freeze(review);
}
const key = owner => 'gogh:agent-wallet-creation:4663:' + address(owner);
function storageFor(storage) {
  try { const value = storage === undefined ? globalThis.localStorage : storage;
    valid(typeof value?.getItem === 'function' && typeof value?.setItem === 'function', 'STORAGE'); return value;
  } catch { valid(false, 'STORAGE', 'Allow browser storage so this creation request can be recovered.'); }
}
function validateRecord(record, owner) {
  exact(record, ['schema', 'owner', 'status', 'review', 'transactionHash', 'receipt']); validateReview(record.review);
  valid(record.schema === 'GOGH_AGENT_CREATION_JOURNAL_V1' && record.owner === owner && record.review.owner === owner
    && ['WALLET_REQUESTED', 'SUBMITTED', 'CONFIRMED', 'REVERTED', 'REJECTED', 'CANCELLED'].includes(record.status), 'JOURNAL');
  valid(['WALLET_REQUESTED', 'REJECTED'].includes(record.status) ? record.transactionHash === null : !!hash(record.transactionHash), 'JOURNAL');
  if (['CONFIRMED', 'REVERTED', 'CANCELLED'].includes(record.status)) {
    const receipt = record.receipt;
    exact(receipt, ['transactionHash', 'blockNumber', 'blockHash', 'status', 'actualNetworkFeeWei', 'feeExceeded', 'cancellation']);
    valid(receipt.transactionHash === record.transactionHash && uint(receipt.blockNumber) >= uint(record.review.anchor.number)
      && !!hash(receipt.blockHash) && receipt.status === (record.status === 'REVERTED' ? '0x0' : '0x1')
      && receipt.feeExceeded === (uint(receipt.actualNetworkFeeWei) > uint(record.review.maximumNetworkFeeWei)), 'JOURNAL');
    if (record.status === 'CANCELLED') {
      exact(receipt.cancellation, ['from', 'to', 'chainId', 'nonce', 'value', 'data']);
      valid(equal(receipt.cancellation, { from: owner, to: owner, chainId: '0x1237', nonce: record.review.transaction.nonce, value: '0x0', data: '0x' }), 'JOURNAL');
    } else valid(receipt.cancellation === null, 'JOURNAL');
  } else valid(record.receipt === null, 'JOURNAL');
  return record;
}
export function getAgentWalletCreationRecord(owner, { storage } = {}) {
  const holder = address(owner.toLowerCase()), store = storageFor(storage); let raw;
  try { raw = store.getItem(key(holder)); } catch { valid(false, 'STORAGE'); }
  if (raw === null) return null;
  try { return freeze(copy(validateRecord(JSON.parse(raw), holder))); }
  catch { valid(false, 'JOURNAL', 'Saved creation history is unreadable. Check wallet activity before another request.'); }
}
function save(record, storage) {
  validateRecord(record, record.owner); const encoded = JSON.stringify(record);
  try { storage.setItem(key(record.owner), encoded); valid(storage.getItem(key(record.owner)) === encoded, 'STORAGE'); }
  catch { valid(false, 'STORAGE', 'Creation history could not be saved. Check wallet activity before retrying.'); }
  return freeze(copy(record));
}
async function locked(owner, options, action) {
  valid(typeof options.isCurrent === 'function' && options.isCurrent(), 'CONTEXT_CHANGED');
  const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
  valid(typeof locks?.request === 'function', 'LOCKS', 'This browser cannot protect creation requests across tabs. Use a browser with Web Locks.');
  return locks.request(key(owner), { mode: 'exclusive' }, async () => { valid(options.isCurrent(), 'CONTEXT_CHANGED'); return action(); });
}
export async function submitAgentWalletCreation(provider, review, options) {
  const shown = copy(review); validateReview(shown, true); const store = storageFor(options.storage), rpc = reader(provider, options.readProvider);
  return locked(shown.owner, options, async () => {
    const previous = getAgentWalletCreationRecord(shown.owner, { storage: store });
    valid(!pending(previous), 'PENDING', `Recover the saved creation for Punk #${previous?.review.tokenId ?? shown.tokenId} before another wallet request.`);
    valid(!previous || previous.status === 'REJECTED' || !equal(previous.review.transaction, shown.transaction), 'ALREADY_ATTEMPTED');
    await recheck(provider, rpc, shown, options.readProvider); await simulate(rpc, shown); await recheck(provider, rpc, shown, options.readProvider);
    valid(options.isCurrent() && equal(getAgentWalletCreationRecord(shown.owner, { storage: store }), previous), 'CONTEXT_CHANGED');
    const record = { schema: 'GOGH_AGENT_CREATION_JOURNAL_V1', owner: shown.owner, status: 'WALLET_REQUESTED', review: shown, transactionHash: null, receipt: null };
    save(record, store); valid(options.isCurrent(), 'CONTEXT_CHANGED');
    let transactionHash;
    try { transactionHash = await provider.request({ method: 'eth_sendTransaction', params: [copy(shown.transaction)] }); }
    catch (error) {
      if (error?.code === 4001) return save({ ...record, status: 'REJECTED' }, store);
      valid(false, 'RESULT_UNKNOWN', 'The wallet result is unknown. Recover its transaction from wallet activity; this request will not be resent.');
    }
    valid(typeof transactionHash === 'string' && HASH.test(transactionHash.toLowerCase()), 'RESULT_UNKNOWN');
    return save({ ...record, status: 'SUBMITTED', transactionHash: transactionHash.toLowerCase() }, store);
  });
}
export async function recoverAgentWalletCreation(provider, owner, options) {
  const holder = address(owner.toLowerCase()), store = storageFor(options.storage), rpc = reader(provider, options.readProvider);
  return locked(holder, options, async () => {
    let record = getAgentWalletCreationRecord(holder, { storage: store });
    if (!record || record.status === 'REJECTED') return record;
    const transactionHash = options.hash?.toLowerCase() ?? record.transactionHash;
    if (!transactionHash) return record;
    hash(transactionHash);
    if (!pending(record)) { valid(transactionHash === record.transactionHash, 'HASH_CHANGED'); return record; }
    const context = async () => { await wallet(rpc, holder); valid(options.isCurrent(), 'CONTEXT_CHANGED'); };
    await context(); const tx = await rpc('eth_getTransactionByHash', [transactionHash]), expected = record.review.transaction;
    valid(tx && tx.hash?.toLowerCase() === transactionHash && tx.from?.toLowerCase() === holder
      && quantity(tx.chainId) === BigInt(CHAIN) && quantity(tx.nonce) === quantity(expected.nonce) && quantity(tx.value) === 0n, 'TRANSACTION_MISMATCH');
    const cancelled = tx.to?.toLowerCase() === holder && (tx.input ?? tx.data)?.toLowerCase() === '0x';
    valid(cancelled || tx.to?.toLowerCase() === PINS.registry && (tx.input ?? tx.data)?.toLowerCase() === expected.data, 'TRANSACTION_MISMATCH');
    valid(tx.authorizationList === undefined || Array.isArray(tx.authorizationList) && tx.authorizationList.length === 0, 'TRANSACTION_MISMATCH');
    const type = tx.type === undefined ? 0n : quantity(tx.type), gas = quantity(tx.gas);
    valid([0n, 1n, 2n].includes(type) && gas > 0n, 'TRANSACTION_MISMATCH');
    const feeCap = quantity(type === 2n ? tx.maxFeePerGas : tx.gasPrice);
    if (type === 2n) valid(quantity(tx.maxPriorityFeePerGas) <= feeCap, 'TRANSACTION_MISMATCH');
    else valid(tx.maxFeePerGas === undefined && tx.maxPriorityFeePerGas === undefined, 'TRANSACTION_MISMATCH');
    await context();
    if (!cancelled && gas * feeCap <= uint(record.review.maximumNetworkFeeWei) && (!record.transactionHash || record.transactionHash === transactionHash))
      record = save({ ...record, status: 'SUBMITTED', transactionHash, receipt: null }, store);
    const receipt = await rpc('eth_getTransactionReceipt', [transactionHash]); if (!receipt) return record;
    valid(receipt.transactionHash?.toLowerCase() === transactionHash && receipt.from?.toLowerCase() === holder && receipt.to?.toLowerCase() === tx.to?.toLowerCase()
      && ['0x0', '0x1'].includes(receipt.status) && quantity(receipt.gasUsed) > 0n && quantity(receipt.gasUsed) <= gas
      && quantity(receipt.effectiveGasPrice) <= feeCap && (type === 2n || quantity(receipt.effectiveGasPrice) === feeCap), 'RECEIPT_MISMATCH');
    const number = quantity(receipt.blockNumber); hash(receipt.blockHash);
    valid(number >= uint(record.review.anchor.number) && quantity(tx.blockNumber) === number && tx.blockHash?.toLowerCase() === receipt.blockHash
      && quantity(tx.transactionIndex) === quantity(receipt.transactionIndex), 'RECEIPT_MISMATCH');
    const [included, head] = await Promise.all([rpc('eth_getBlockByNumber', [hex(number), false]), rpc('eth_getBlockByNumber', ['latest', false])]);
    const mined = block(included), latest = block(head, true);
    valid(mined.number === String(number) && mined.hash === receipt.blockHash && uint(latest.number) >= number, 'CHAIN_CHANGED');
    const transactionIndex = quantity(receipt.transactionIndex);
    valid(Array.isArray(included.transactions) && transactionIndex < BigInt(included.transactions.length)
      && included.transactions[Number(transactionIndex)]?.toLowerCase() === transactionHash, 'RECEIPT_MISMATCH');
    if (uint(latest.number) - number + 1n < 12n) return record;
    await canonical(rpc, record.review.anchor);
    if (cancelled) {
      valid(receipt.status === '0x1' && Array.isArray(receipt.logs) && receipt.logs.length === 0
        && await rpc('eth_getCode', [holder, hex(number)]) === '0x', 'CANCELLATION_UNVERIFIED');
    } else if (receipt.status === '0x1') {
      const created = await binding(rpc, record.review.tokenId, hex(number));
      valid(created.created && created.account === record.review.account && created.accountSalt === record.review.accountSalt, 'CREATION_UNVERIFIED');
      // A permissionless canonical-registry creation may precede this idempotent
      // call. Exact transaction + canonical runtime proof also covers no-event success.
    }
    await canonical(rpc, mined); await context();
    const actualNetworkFeeWei = quantity(receipt.gasUsed) * quantity(receipt.effectiveGasPrice);
    return save({ ...record, transactionHash, status: cancelled ? 'CANCELLED' : receipt.status === '0x1' ? 'CONFIRMED' : 'REVERTED', receipt: {
      transactionHash, blockNumber: String(number), blockHash: mined.hash, status: receipt.status,
      actualNetworkFeeWei: String(actualNetworkFeeWei), feeExceeded: actualNetworkFeeWei > uint(record.review.maximumNetworkFeeWei),
      cancellation: cancelled ? { from: holder, to: holder, chainId: '0x1237', nonce: expected.nonce, value: '0x0', data: '0x' } : null,
    } }, store);
  });
}
