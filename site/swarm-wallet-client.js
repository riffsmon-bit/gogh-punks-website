import { keccak256Hex } from './keccak256.js';
import { AGENT_RECOVERY_PINS, agentRecoveryProxyRuntime } from './punk-agent-recovery.js';

// Owner-reviewed transactions only. Reads and recovery never request a signature.
const CHAIN = 4663, ETH = 10n ** 18n, MAX_FEE = 10n ** 15n, MAX_GAS = 5_000_000n;
const UINT = /^(0|[1-9][0-9]{0,77})$/, QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/;
const HASH = /^0x[0-9a-f]{64}$/, ADDRESS = /^0x[0-9a-f]{40}$/;
const READS = new Set(['eth_chainId', 'eth_accounts', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_gasPrice', 'eth_estimateGas', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
const STATES = ['WALLET_REQUESTED', 'SUBMITTED', 'CONFIRMED', 'REVERTED', 'CANCELLED', 'REJECTED'];
const copy = value => structuredClone(value);
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const equal = (a, b) => stable(a) === stable(b);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const textHex = text => `0x${Array.from(new TextEncoder().encode(text), byte => byte.toString(16).padStart(2, '0')).join('')}`;
const digest = text => keccak256Hex(textHex(text));
const selector = signature => digest(signature).slice(0, 10);
const word = value => BigInt(value).toString(16).padStart(64, '0');
const hex = value => `0x${BigInt(value).toString(16)}`;
function fail(code, message = 'Swarm wallet checks failed. Recheck the original review before continuing.') {
  throw Object.assign(Error(message), { code: `SWARM_WALLET_${code}` });
}
function valid(condition, code = 'UNVERIFIED', message) { if (!condition) fail(code, message); }
function exact(value, keys) {
  valid(value && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value')), 'INVALID_REVIEW');
}
function address(value) { valid(typeof value === 'string' && ADDRESS.test(value) && BigInt(value) !== 0n, 'INVALID_ADDRESS'); return value; }
function ownerAddress(value) { return address(typeof value === 'string' ? value.toLowerCase() : value); }
function uint(value, positive = false) {
  valid(typeof value === 'string' && UINT.test(value) && BigInt(value) < 2n ** 256n && (!positive || BigInt(value) > 0n), 'INVALID_AMOUNT');
  return BigInt(value);
}
function quantity(value) { valid(typeof value === 'string' && QUANTITY.test(value), 'RPC_INVALID'); return BigInt(value); }
// Normalize provider responses at the read boundary, never reviewed payloads.
function rpcQuantity(value) {
  valid(typeof value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(value), 'RPC_INVALID');
  return hex(BigInt(value));
}
function rpcChain(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? hex(value) : rpcQuantity(value);
}
function rpcResult(method, value) {
  if (method === 'eth_chainId') return rpcChain(value);
  if (['eth_getTransactionCount', 'eth_getBalance', 'eth_gasPrice', 'eth_estimateGas'].includes(method)) return rpcQuantity(value);
  if (method === 'eth_getBlockByNumber' && value && typeof value === 'object') return {
    ...value, number: rpcQuantity(value.number), timestamp: rpcQuantity(value.timestamp),
    hash: typeof value.hash === 'string' ? value.hash.toLowerCase() : value.hash,
  };
  return value;
}
function hash(value) { valid(typeof value === 'string' && HASH.test(value) && BigInt(value) !== 0n, 'RPC_INVALID'); return value; }
function resultWord(value) { valid(typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value), 'RPC_INVALID'); return value.toLowerCase(); }
function resultAddress(value) { const result = resultWord(value); valid(/^0x0{24}/.test(result), 'RPC_INVALID'); return address(`0x${result.slice(-40)}`); }
function resultBool(value) { const n = BigInt(resultWord(value)); valid(n === 0n || n === 1n, 'RPC_INVALID'); return n === 1n; }
function bytecode(value) { valid(typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(value) && value.length <= 100_002, 'RUNTIME_CHANGED'); return value.toLowerCase(); }
function normalizeRuntime(value) {
  valid(value && typeof value.object === 'string' && value.immutableReferences && typeof value.immutableReferences === 'object', 'RELEASE_UNAVAILABLE');
  const object = bytecode(value.object.startsWith('0x') ? value.object : `0x${value.object}`);
  const size = (object.length - 2) / 2, occupied = new Set(), immutableReferences = {};
  const entries = Object.entries(value.immutableReferences);
  valid(entries.length > 0 && entries.length <= 32, 'RELEASE_UNAVAILABLE');
  for (const [key, ranges] of entries) {
    valid(/^\d+$/.test(key) && Array.isArray(ranges) && ranges.length > 0 && ranges.length <= 128, 'RELEASE_UNAVAILABLE');
    immutableReferences[key] = ranges.map(range => {
      exact(range, ['start', 'length']);
      valid(Number.isSafeInteger(range.start) && range.start >= 0 && range.length === 32 && range.start + 32 <= size, 'RELEASE_UNAVAILABLE');
      for (let i = range.start; i < range.start + 32; i++) { valid(!occupied.has(i), 'RELEASE_UNAVAILABLE'); occupied.add(i); }
      return { start: range.start, length: 32 };
    });
  }
  valid(occupied.size < size, 'RELEASE_UNAVAILABLE');
  return { object, immutableReferences };
}
function releaseConfig(release) {
  valid(release?.status === 'LIVE' && release.chainId === CHAIN, 'RELEASE_UNAVAILABLE', 'Swarm wallet is not released on this chain. No wallet request is available.');
  const p = AGENT_RECOVERY_PINS;
  valid(release.collection === p.collection && release.registry === p.registry && release.implementation === p.implementation
    && release.registryCodeHash === p.registryHash && release.implementationCodeHash === p.implementationHash, 'RELEASE_UNAVAILABLE');
  const normalized = { status: 'LIVE', chainId: CHAIN, factory: address(release.factory), factoryCodeHash: hash(release.factoryCodeHash),
    collection: p.collection, registry: p.registry, implementation: p.implementation,
    registryCodeHash: p.registryHash, implementationCodeHash: p.implementationHash, vaultRuntime: normalizeRuntime(release.vaultRuntime) };
  valid(new Set([normalized.factory, p.collection, p.registry, p.implementation]).size === 4, 'RELEASE_UNAVAILABLE');
  return normalized;
}
function matchesRuntime(code, runtime) {
  const actual = bytecode(code).slice(2).split(''), expected = runtime.object.slice(2).split('');
  valid(actual.length === expected.length, 'RUNTIME_CHANGED');
  for (const ranges of Object.values(runtime.immutableReferences)) {
    let immutable;
    for (const { start, length } of ranges) {
      const value = actual.slice(start * 2, (start + length) * 2).join('');
      valid(immutable === undefined || immutable === value, 'RUNTIME_CHANGED'); immutable = value;
      actual.fill('0', start * 2, (start + length) * 2); expected.fill('0', start * 2, (start + length) * 2);
    }
  }
  valid(actual.join('') === expected.join(''), 'RUNTIME_CHANGED');
}
function rpcReader(provider, readProvider) {
  valid(typeof provider?.request === 'function', 'PROVIDER_UNAVAILABLE');
  // Wallet identity and pending nonces stay tied to the connected extension.
  // All contract/state checks may use the fixed public reader; it cannot send.
  const walletMethods = new Set(['eth_accounts', 'eth_getTransactionCount']);
  const request = async (method, params) => {
    if (!readProvider || walletMethods.has(method)) return provider.request({ method, params });
    valid(typeof readProvider.request === 'function', 'READ_UNAVAILABLE');
    if (method === 'eth_chainId') {
      const [walletChain, readChain] = await Promise.all([provider.request({ method, params }), readProvider.request({ method, params })]);
      valid(rpcChain(walletChain) === rpcChain(readChain), 'READ_CHAIN_CHANGED');
      return walletChain;
    }
    return readProvider.request({ method, params });
  };
  return async (method, params = []) => {
    valid(READS.has(method), 'READ_ONLY'); let timeout;
    try {
      return rpcResult(method, await Promise.race([Promise.resolve().then(() => request(method, params)), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Object.assign(Error('Read timed out'), { code: 'SWARM_WALLET_READ_TIMEOUT' })), 8000);
      })]));
    } catch (error) {
      if (['SWARM_WALLET_READ_TIMEOUT', 'SWARM_WALLET_READ_CHAIN_CHANGED', 'SWARM_WALLET_RPC_INVALID', 'SWARM_WALLET_FEE_CHANGED'].includes(error?.code)) throw error;
      fail('READ_UNAVAILABLE', 'A required chain read is unavailable. No new wallet request was made. Recheck any saved transaction.');
    } finally { clearTimeout(timeout); }
  };
}
async function walletContext(rpc, owner, expectedNonce) {
  const [chain, accounts, pending, latest] = await Promise.all([rpc('eth_chainId'), rpc('eth_accounts'),
    rpc('eth_getTransactionCount', [owner, 'pending']), rpc('eth_getTransactionCount', [owner, 'latest'])]);
  valid(quantity(chain) === BigInt(CHAIN) && Array.isArray(accounts) && accounts[0]?.toLowerCase() === owner, 'OWNER_CHANGED');
  const nonce = quantity(pending); valid(nonce === quantity(latest) && nonce <= BigInt(Number.MAX_SAFE_INTEGER), 'NONCE_CHANGED', 'Wait for your pending wallet transaction, then review again.');
  valid(expectedNonce === undefined || nonce === uint(expectedNonce), 'NONCE_CHANGED');
  return nonce.toString();
}
function block(value, fresh = false) {
  const number = quantity(value?.number), timestamp = quantity(value?.timestamp); hash(value?.hash);
  if (fresh) valid(timestamp * 1000n >= BigInt(Date.now() - 30_000) && timestamp * 1000n <= BigInt(Date.now() + 5000), 'STALE_CHAIN');
  return { number: number.toString(), timestamp: timestamp.toString(), hash: value.hash };
}
async function canonical(rpc, anchor) {
  valid(equal(block(await rpc('eth_getBlockByNumber', [hex(anchor.number), false])), anchor), 'CHAIN_CHANGED');
}
async function contracts(rpc, release, owner, at) {
  const call = (to, signature, suffix = '') => rpc('eth_call', [{ to, data: selector(signature) + suffix }, at]);
  const names = ['chainId', 'collection', 'registry', 'implementation', 'registryCodeHash', 'implementationCodeHash', 'accountSalt', 'canonicalRegistry'];
  const [factoryCode, factoryWords, vaultWord, createdWord] = await Promise.all([
    rpc('eth_getCode', [release.factory, at]),
    Promise.all(names.map(name => call(release.factory, `${name}()`))), call(release.factory, 'getVault(address)', word(owner)),
    call(release.factory, 'isVaultCreated(address)', word(owner)),
  ]);
  valid(keccak256Hex(bytecode(factoryCode)) === release.factoryCodeHash, 'RUNTIME_CHANGED');
  const accountSalt = resultWord(factoryWords[6]), canonicalRegistry = resultAddress(factoryWords[7]);
  const expected = [word(CHAIN), word(release.collection), word(release.registry), word(release.implementation),
    release.registryCodeHash.slice(2), release.implementationCodeHash.slice(2), accountSalt.slice(2), word(canonicalRegistry)].map(v => `0x${v}`);
  valid(factoryWords.every((value, index) => resultWord(value) === expected[index]), 'CONFIG_CHANGED');
  // The pinned factory runtime binds its immutable salt and canonical registry.
  // Withdrawal must remain available when a funding dependency is unavailable.
  let dependenciesVerified = false;
  try {
    const [registryCode, implementationCode, salt, canonicalWord, registryChain, registryCollection, registryImplementation] = await Promise.all([
      rpc('eth_getCode', [release.registry, at]), rpc('eth_getCode', [release.implementation, at]), call(release.registry, 'accountSalt()'),
      call(release.registry, 'canonicalRegistry()'), call(release.registry, 'ROBINHOOD_CHAIN_ID()'), call(release.registry, 'GOGH_PUNKS()'), call(release.registry, 'implementation()'),
    ]);
    dependenciesVerified = keccak256Hex(bytecode(registryCode)) === release.registryCodeHash && keccak256Hex(bytecode(implementationCode)) === release.implementationCodeHash
      && resultWord(salt) === accountSalt && resultAddress(canonicalWord) === canonicalRegistry && BigInt(resultWord(registryChain)) === BigInt(CHAIN)
      && resultAddress(registryCollection) === release.collection && resultAddress(registryImplementation) === release.implementation;
  } catch { /* Only owner withdrawal may proceed without verified funding dependencies. */ }
  const vault = resultAddress(vaultWord), created = resultBool(createdWord);
  valid(![owner, release.factory, release.collection, release.registry, release.implementation, canonicalRegistry].includes(vault), 'CONFIG_CHANGED');
  const code = await rpc('eth_getCode', [vault, at]);
  valid(created === (code !== '0x'), 'RUNTIME_CHANGED');
  if (!created) return { vault, created, vaultNonce: null, accountSalt, canonicalRegistry, vaultCodeHash: null, dependenciesVerified };
  matchesRuntime(code, release.vaultRuntime);
  const [values, vaultOwner, nonce] = await Promise.all([Promise.all(names.map(name => call(vault, `${name}()`))), call(vault, 'owner()'), call(vault, 'nonce()')]);
  valid(values.every((value, index) => resultWord(value) === expected[index]) && resultAddress(vaultOwner) === owner, 'CONFIG_CHANGED');
  return { vault, created, vaultNonce: BigInt(resultWord(nonce)).toString(), accountSalt, canonicalRegistry, vaultCodeHash: keccak256Hex(bytecode(code)), dependenciesVerified };
}
export async function readSwarmWallet(provider, { owner, release, readProvider }) {
  const config = releaseConfig(release), holder = ownerAddress(owner), rpc = rpcReader(provider, readProvider);
  const ownerNonce = await walletContext(rpc, holder), anchor = block(await rpc('eth_getBlockByNumber', ['latest', false]), true);
  const details = await contracts(rpc, config, holder, hex(anchor.number));
  const [balance, ownerBalance] = await Promise.all([rpc('eth_getBalance', [details.vault, hex(anchor.number)]), rpc('eth_getBalance', [holder, 'pending'])]);
  await canonical(rpc, anchor); await walletContext(rpc, holder, ownerNonce);
  return freeze({ schema: 'GOGH_SWARM_WALLET_STATE_V1', owner: holder, chainId: CHAIN, factory: config.factory, ...details,
    balanceWei: quantity(balance).toString(), ownerBalanceWei: quantity(ownerBalance).toString(), ownerNonce, anchor });
}
function normalizeAction(action) {
  valid(action && ['CREATE', 'DEPOSIT', 'BATCH', 'WITHDRAW'].includes(action.kind), 'INVALID_ACTION');
  exact(action, action.kind === 'CREATE' ? ['kind'] : action.kind === 'BATCH' ? ['kind', 'allocations'] : ['kind', 'amountWei']);
  if (action.kind === 'CREATE') return { kind: 'CREATE' };
  if (action.kind !== 'BATCH') {
    const amount = uint(action.amountWei, true); valid(action.kind !== 'DEPOSIT' || amount <= 10n * ETH, 'INVALID_AMOUNT');
    return { kind: action.kind, amountWei: amount.toString() };
  }
  valid(Array.isArray(action.allocations) && action.allocations.length > 0 && action.allocations.length <= 10, 'INVALID_BATCH');
  let previous = 0n;
  const allocations = action.allocations.map(row => {
    exact(row, ['tokenId', 'amountWei']); const id = uint(row.tokenId, true), amount = uint(row.amountWei, true);
    valid(id > previous && id <= 5016n && amount <= ETH, 'INVALID_BATCH'); previous = id;
    return { tokenId: row.tokenId, amountWei: row.amountWei };
  });
  return { kind: 'BATCH', allocations };
}
const total = action => action.kind === 'BATCH' ? action.allocations.reduce((sum, row) => sum + BigInt(row.amountWei), 0n) : BigInt(action.amountWei ?? '0');
function calldata(action, nonce, deadline) {
  if (action.kind === 'CREATE') return selector('createVault()');
  if (action.kind === 'DEPOSIT') return selector('deposit()');
  if (action.kind === 'WITHDRAW') return selector('withdrawToOwner(uint256,uint256,uint256)') + word(action.amountWei) + word(nonce) + word(deadline);
  return selector('fundBatch((uint256,uint256)[],uint256,uint256)') + word(96) + word(nonce) + word(deadline)
    + word(action.allocations.length) + action.allocations.map(row => word(row.tokenId) + word(row.amountWei)).join('');
}
async function destinations(rpc, config, state, action) {
  if (action.kind !== 'BATCH') return [];
  return Promise.all(action.allocations.map(async row => {
    const at = hex(state.anchor.number), call = (to, signature, suffix = '') => rpc('eth_call', [{ to, data: selector(signature) + suffix }, at]);
    const [holder, registered] = await Promise.all([call(config.collection, 'ownerOf(uint256)', word(row.tokenId)), call(config.registry, 'account(uint256)', word(row.tokenId))]);
    const account = resultAddress(registered);
    valid(resultAddress(holder) === state.owner && ![state.owner, state.vault, config.factory].includes(account), 'PUNK_OWNER_CHANGED');
    const [code, controllingOwner] = await Promise.all([rpc('eth_getCode', [account, at]), call(account, 'owner()')]);
    valid(bytecode(code) === agentRecoveryProxyRuntime(row.tokenId, state.accountSalt) && resultAddress(controllingOwner) === state.owner, 'AGENT_CHANGED');
    return { ...row, account };
  }));
}
function funds(state, action, fee) {
  valid(action.kind === 'WITHDRAW' || state.dependenciesVerified, 'DEPENDENCIES_UNAVAILABLE', 'Funding dependencies could not be verified. You can still review withdrawal of unused ETH to your wallet.');
  valid(action.kind === 'CREATE' ? !state.created : state.created, 'VAULT_STATE_CHANGED');
  valid(!['BATCH', 'WITHDRAW'].includes(action.kind) || uint(state.balanceWei) >= total(action), 'INSUFFICIENT_VAULT_FUNDS');
  valid(uint(state.ownerBalanceWei) >= fee + (action.kind === 'DEPOSIT' ? total(action) : 0n), 'INSUFFICIENT_OWNER_FUNDS');
}
async function simulate(rpc, review) {
  const [result, estimate, gasPrice] = await Promise.all([rpc('eth_call', [review.transaction, 'latest']), rpc('eth_estimateGas', [review.transaction]), rpc('eth_gasPrice')]);
  valid(review.action.kind === 'CREATE' ? resultAddress(result) === review.vault : result === '0x', 'SIMULATION_FAILED');
  valid(quantity(estimate) > 0n && quantity(estimate) <= quantity(review.transaction.gas)
    && quantity(gasPrice) > 0n && quantity(gasPrice) <= quantity(review.transaction.gasPrice), 'FEE_CHANGED');
}
async function closingChecks(rpc, review, state) {
  const head = block(await rpc('eth_getBlockByNumber', ['latest', false]), true);
  valid(uint(head.number) >= uint(state.anchor.number) && uint(head.number) - uint(review.anchor.number) <= 1000n, 'CHAIN_CHANGED');
  await Promise.all([canonical(rpc, review.anchor), canonical(rpc, state.anchor), canonical(rpc, head)]);
  const data = review.created ? selector('nonce()') : selector('isVaultCreated(address)') + word(review.owner);
  const result = await rpc('eth_call', [{ to: review.created ? review.vault : review.factory, data }, 'latest']);
  valid(review.created ? BigInt(resultWord(result)) === uint(review.vaultNonce) : !resultBool(result), 'NONCE_CHANGED');
  await walletContext(rpc, review.owner, quantity(review.transaction.nonce).toString());
}
export async function prepareSwarmWallet(provider, { owner, release, action, readProvider }) {
  const config = releaseConfig(release), normalized = normalizeAction(action), state = await readSwarmWallet(provider, { owner, release: config, readProvider });
  const rpc = rpcReader(provider, readProvider), allocations = await destinations(rpc, config, state, normalized);
  funds(state, normalized, 0n);
  const expiresAt = Number(BigInt(state.anchor.timestamp) + 90n) * 1000;
  const transaction = { chainId: '0x1237', from: state.owner, to: normalized.kind === 'CREATE' ? config.factory : state.vault,
    value: normalized.kind === 'DEPOSIT' ? hex(normalized.amountWei) : '0x0', data: calldata(normalized, state.vaultNonce, expiresAt / 1000), nonce: hex(state.ownerNonce) };
  const observedPrice = quantity(await rpc('eth_gasPrice')); valid(observedPrice > 0n, 'FEE_CHANGED');
  // The base fee can move between the quote and simulation. Include a bounded
  // 20% allowance in the exact transaction and displayed maximum; never raise
  // it at confirmation or bypass MAX_FEE when the network becomes expensive.
  const gasPrice = (observedPrice * 120n + 99n) / 100n; transaction.gasPrice = hex(gasPrice);
  const estimate = quantity(await rpc('eth_estimateGas', [transaction])); valid(estimate > 0n, 'SIMULATION_FAILED');
  const gas = (estimate * 120n + 99n) / 100n + 10_000n; valid(gas <= MAX_GAS && gas * gasPrice <= MAX_FEE, 'FEE_LIMIT'); transaction.gas = hex(gas);
  const review = { schema: 'GOGH_SWARM_WALLET_REVIEW_V1', owner: state.owner, chainId: CHAIN, releaseIdentity: digest(stable(config)), factory: config.factory,
    action: normalized, vault: state.vault, created: state.created, vaultNonce: state.vaultNonce, accountSalt: state.accountSalt,
    canonicalRegistry: state.canonicalRegistry, vaultCodeHash: state.vaultCodeHash, allocations, anchor: state.anchor, expiresAt,
    transaction, maximumNetworkFeeWei: (gas * gasPrice).toString() };
  funds(state, normalized, gas * gasPrice); await simulate(rpc, review); await closingChecks(rpc, review, state);
  validateReview(review, config, true);
  return freeze(review);
}
function validateReview(value, config, fresh = false) {
  exact(value, ['schema', 'owner', 'chainId', 'releaseIdentity', 'factory', 'action', 'vault', 'created', 'vaultNonce', 'accountSalt',
    'canonicalRegistry', 'vaultCodeHash', 'allocations', 'anchor', 'expiresAt', 'transaction', 'maximumNetworkFeeWei']);
  valid(value.schema === 'GOGH_SWARM_WALLET_REVIEW_V1' && value.chainId === CHAIN, 'INVALID_REVIEW');
  address(value.owner); address(value.factory); address(value.vault); address(value.canonicalRegistry); hash(value.releaseIdentity); resultWord(value.accountSalt);
  const action = normalizeAction(value.action); valid(equal(action, value.action), 'INVALID_REVIEW');
  valid(value.created === (action.kind !== 'CREATE') && (value.created ? value.vaultNonce !== null && uint(value.vaultNonce) >= 0n && !!hash(value.vaultCodeHash) : value.vaultNonce === null && value.vaultCodeHash === null), 'INVALID_REVIEW');
  exact(value.anchor, ['number', 'hash', 'timestamp']); uint(value.anchor.number); uint(value.anchor.timestamp); hash(value.anchor.hash);
  valid(Number.isSafeInteger(value.expiresAt) && BigInt(value.expiresAt) === (uint(value.anchor.timestamp) + 90n) * 1000n, 'INVALID_REVIEW');
  if (fresh) valid(value.expiresAt > Date.now() + 5000 && Number(value.anchor.timestamp) * 1000 <= Date.now() + 5000, 'REVIEW_EXPIRED', 'This review expired. Prepare and review it again; no wallet request was made.');
  const tx = value.transaction; exact(tx, ['chainId', 'from', 'to', 'value', 'data', 'nonce', 'gasPrice', 'gas']);
  valid(tx.chainId === '0x1237' && tx.from === value.owner && tx.to === (action.kind === 'CREATE' ? value.factory : value.vault)
    && tx.value === (action.kind === 'DEPOSIT' ? hex(action.amountWei) : '0x0')
    && tx.data === calldata(action, value.vaultNonce, value.expiresAt / 1000), 'INVALID_REVIEW');
  valid(quantity(tx.nonce) <= BigInt(Number.MAX_SAFE_INTEGER) && quantity(tx.gas) > 0n && quantity(tx.gas) <= MAX_GAS && quantity(tx.gasPrice) > 0n
    && quantity(tx.gas) * quantity(tx.gasPrice) === uint(value.maximumNetworkFeeWei, true) && uint(value.maximumNetworkFeeWei) <= MAX_FEE, 'FEE_LIMIT');
  valid(Array.isArray(value.allocations) && value.allocations.length === (action.allocations?.length ?? 0), 'INVALID_REVIEW');
  value.allocations.forEach((row, index) => { exact(row, ['tokenId', 'amountWei', 'account']); address(row.account);
    valid(row.tokenId === action.allocations[index].tokenId && row.amountWei === action.allocations[index].amountWei, 'INVALID_REVIEW'); });
  if (config) valid(value.releaseIdentity === digest(stable(config)) && value.factory === config.factory, 'RELEASE_CHANGED');
  return value;
}
function storageFor(storage) {
  try { const result = storage === undefined ? globalThis.localStorage : storage; valid(typeof result?.getItem === 'function' && typeof result?.setItem === 'function', 'STORAGE_UNAVAILABLE'); return result; }
  catch { fail('STORAGE_UNAVAILABLE', 'Allow browser storage before opening a wallet request. Preserve any existing transaction history.'); }
}
const journalKey = owner => `gogh:swarm-wallet:4663:${address(owner)}`;
function validateRecord(record, owner) {
  exact(record, ['schema', 'owner', 'status', 'review', 'transactionHash', 'receipt']);
  valid(record.schema === 'GOGH_SWARM_WALLET_JOURNAL_V1' && record.owner === owner && STATES.includes(record.status), 'JOURNAL_INVALID');
  validateReview(record.review); valid(record.review.owner === owner, 'JOURNAL_INVALID');
  valid(['SUBMITTED', 'CONFIRMED', 'REVERTED', 'CANCELLED'].includes(record.status) ? !!hash(record.transactionHash) : record.transactionHash === null, 'JOURNAL_INVALID');
  if (['CONFIRMED', 'REVERTED', 'CANCELLED'].includes(record.status)) {
    const receipt = record.receipt, cancelled = record.status === 'CANCELLED';
    const hasFeeProof = !!receipt && Object.hasOwn(receipt, 'actualNetworkFeeWei');
    exact(receipt, ['transactionHash', 'blockNumber', 'blockHash', 'status', 'events', ...(cancelled ? ['cancellation'] : []),
      ...(hasFeeProof ? ['gasUsed', 'effectiveGasPrice', 'actualNetworkFeeWei', 'feeExceeded'] : [])]);
    valid(receipt.transactionHash === record.transactionHash && uint(receipt.blockNumber) >= uint(record.review.anchor.number)
      && !!hash(receipt.blockHash) && receipt.status === (record.status === 'REVERTED' ? '0x0' : '0x1') && Array.isArray(receipt.events), 'JOURNAL_INVALID');
    if (record.status === 'CONFIRMED') valid(equal(receipt.events, eventProof(record.review)), 'JOURNAL_INVALID');
    else valid(receipt.events.length === 0, 'JOURNAL_INVALID');
    // Older confirmed journals predate fee reconciliation and remain readable.
    if (hasFeeProof) valid(uint(receipt.gasUsed, true) * uint(receipt.effectiveGasPrice, true) === uint(receipt.actualNetworkFeeWei, true)
      && receipt.feeExceeded === (uint(receipt.actualNetworkFeeWei) > uint(record.review.maximumNetworkFeeWei)), 'JOURNAL_INVALID');
    if (cancelled) {
      exact(receipt.cancellation, ['from', 'to', 'chainId', 'nonce', 'value', 'input', 'gas', 'feeCap']);
      valid(hasFeeProof && cancellationTransaction(receipt.cancellation, record.review), 'JOURNAL_INVALID');
      valid(quantity(receipt.cancellation.gas) >= uint(receipt.gasUsed, true)
        && quantity(receipt.cancellation.feeCap) >= uint(receipt.effectiveGasPrice, true), 'JOURNAL_INVALID');
    }
  } else valid(record.receipt === null, 'JOURNAL_INVALID');
  return record;
}
export function getSwarmWalletRecord(owner, { storage } = {}) {
  const holder = ownerAddress(owner), store = storageFor(storage); let raw;
  try { raw = store.getItem(journalKey(holder)); } catch { fail('STORAGE_UNAVAILABLE'); }
  if (raw === null) return null;
  try { return freeze(copy(validateRecord(JSON.parse(raw), holder))); } catch { fail('JOURNAL_INVALID', 'Saved Swarm wallet history is unreadable. Check the original wallet activity before another transaction.'); }
}
function save(record, storage) {
  validateRecord(record, record.owner); const encoded = JSON.stringify(record);
  try { storage.setItem(journalKey(record.owner), encoded); valid(storage.getItem(journalKey(record.owner)) === encoded, 'STORAGE_UNAVAILABLE'); }
  catch { fail('STORAGE_UNAVAILABLE', 'The wallet request could not be saved. Check wallet activity before trying anything again.'); }
  return freeze(copy(record));
}
async function locked(owner, locks, isCurrent, run) {
  valid(typeof isCurrent === 'function' && isCurrent(), 'SELECTION_CHANGED');
  let manager; try { manager = locks === undefined ? globalThis.navigator?.locks : locks; } catch { fail('LOCKS_UNAVAILABLE'); }
  valid(typeof manager?.request === 'function', 'LOCKS_UNAVAILABLE', 'This browser cannot protect Swarm wallet requests across tabs. Use a browser with Web Locks.');
  return manager.request(journalKey(owner), { mode: 'exclusive' }, async () => { valid(isCurrent(), 'SELECTION_CHANGED'); return run(); });
}
export async function submitSwarmWallet(provider, review, { release, isCurrent, storage, locks, readProvider }) {
  const config = releaseConfig(release), shown = copy(review); validateReview(shown, config, true);
  const store = storageFor(storage), rpc = rpcReader(provider, readProvider);
  return locked(shown.owner, locks, isCurrent, async () => {
    const previous = getSwarmWalletRecord(shown.owner, { storage: store });
    valid(!previous || !['WALLET_REQUESTED', 'SUBMITTED'].includes(previous.status), 'REQUEST_PENDING', 'Recover the original Swarm wallet request before preparing another. It will not be sent again.');
    valid(!previous || previous.status === 'REJECTED' || !equal(previous.review.transaction, shown.transaction), 'ALREADY_ATTEMPTED');
    const state = await readSwarmWallet(provider, { owner: shown.owner, release: config, readProvider });
    for (const key of ['factory', 'vault', 'created', 'vaultNonce', 'accountSalt', 'canonicalRegistry', 'vaultCodeHash']) valid(equal(state[key], shown[key]), 'REVIEW_CHANGED');
    valid(state.ownerNonce === quantity(shown.transaction.nonce).toString(), 'NONCE_CHANGED');
    valid(equal(await destinations(rpc, config, state, shown.action), shown.allocations), 'AGENT_CHANGED');
    funds(state, shown.action, uint(shown.maximumNetworkFeeWei));
    await simulate(rpc, shown); await closingChecks(rpc, shown, state);
    validateReview(shown, config, true); valid(isCurrent(), 'SELECTION_CHANGED');
    valid(equal(getSwarmWalletRecord(shown.owner, { storage: store }), previous), 'JOURNAL_CHANGED');
    let record = { schema: 'GOGH_SWARM_WALLET_JOURNAL_V1', owner: shown.owner, status: 'WALLET_REQUESTED', review: shown, transactionHash: null, receipt: null };
    save(record, store);
    // Nothing asynchronous may intervene between the final current check and the wallet request.
    valid(isCurrent(), 'SELECTION_CHANGED');
    let transactionHash;
    try { transactionHash = await provider.request({ method: 'eth_sendTransaction', params: [copy(shown.transaction)] }); }
    catch (error) {
      if (error?.code === 4001) return save({ ...record, status: 'REJECTED' }, store);
      fail('WALLET_RESULT_UNKNOWN', 'The wallet result is unknown. Recover the original transaction from wallet activity; this request will not be sent again.');
    }
    valid(typeof transactionHash === 'string' && HASH.test(transactionHash.toLowerCase()), 'WALLET_RESULT_UNKNOWN');
    record = { ...record, status: 'SUBMITTED', transactionHash: transactionHash.toLowerCase() };
    return save(record, store);
  });
}
function eventProof(review) {
  const { action, owner, vault, factory, vaultNonce } = review;
  const event = (address, signature, topics, data) => ({ address, topics: [digest(signature), ...topics.map(value => `0x${word(value)}`)], data: `0x${data.map(word).join('')}` });
  if (action.kind === 'CREATE') return [event(factory, 'VaultCreated(address,address)', [owner, vault], [])];
  if (action.kind === 'DEPOSIT') return [event(vault, 'Deposit(address,uint256)', [owner], [action.amountWei])];
  if (action.kind === 'WITHDRAW') return [event(vault, 'Withdrawn(uint256,address,uint256)', [vaultNonce, owner], [action.amountWei])];
  return [...review.allocations.map(row => event(vault, 'PunkFunded(uint256,uint256,address,uint256)', [vaultNonce, row.tokenId, row.account], [row.amountWei])),
    event(vault, 'BatchFunded(uint256,uint256,uint256)', [vaultNonce], [review.allocations.length, total(action)])];
}
function cancellationTransaction(tx, review) {
  return tx.from?.toLowerCase() === review.owner && tx.to?.toLowerCase() === review.owner
    && quantity(tx.chainId) === quantity(review.transaction.chainId) && quantity(tx.nonce) === quantity(review.transaction.nonce)
    && quantity(tx.value) === 0n && (tx.input ?? tx.data)?.toLowerCase() === '0x';
}
function verifyTransaction(tx, review, transactionHash) {
  valid(tx && tx.hash?.toLowerCase() === transactionHash && tx.from?.toLowerCase() === review.owner, 'TRANSACTION_MISMATCH');
  for (const key of ['chainId', 'nonce']) valid(quantity(tx[key]) === quantity(review.transaction[key]), 'TRANSACTION_MISMATCH');
  const cancelled = cancellationTransaction(tx, review);
  valid(cancelled || tx.to?.toLowerCase() === review.transaction.to && (tx.input ?? tx.data)?.toLowerCase() === review.transaction.data
    && quantity(tx.value) === quantity(review.transaction.value), 'TRANSACTION_MISMATCH');
  valid(tx.authorizationList === undefined || Array.isArray(tx.authorizationList) && tx.authorizationList.length === 0, 'TRANSACTION_MISMATCH');
  const type = tx.type === undefined ? 0n : quantity(tx.type), gas = quantity(tx.gas);
  valid([0n, 1n, 2n].includes(type), 'TRANSACTION_MISMATCH');
  let feeCap;
  if (type === 2n) {
    feeCap = quantity(tx.maxFeePerGas);
    valid(quantity(tx.maxPriorityFeePerGas) <= feeCap && (tx.gasPrice === undefined || quantity(tx.gasPrice) <= feeCap), 'TRANSACTION_MISMATCH');
  } else {
    valid(tx.maxFeePerGas === undefined && tx.maxPriorityFeePerGas === undefined, 'TRANSACTION_MISMATCH');
    feeCap = quantity(tx.gasPrice);
  }
  // Recovery attests an owner-signed transaction; it never authorizes a higher fee.
  // Above-review fee edits may close the journal only after finalized receipt proof.
  valid(gas > 0n && feeCap > 0n, 'TRANSACTION_MISMATCH');
  return { cancelled, gas, feeCap, type, withinReviewFee: gas * feeCap <= uint(review.maximumNetworkFeeWei) };
}
export async function recoverSwarmWallet(provider, owner, { release, storage, locks, hash: suppliedHash, isCurrent, readProvider }) {
  const config = releaseConfig(release), holder = ownerAddress(owner), store = storageFor(storage), rpc = rpcReader(provider, readProvider);
  return locked(holder, locks, isCurrent, async () => {
    let record = getSwarmWalletRecord(holder, { storage: store });
    if (!record || record.status === 'REJECTED') return record;
    validateReview(record.review, config);
    const transactionHash = suppliedHash?.toLowerCase() ?? record.transactionHash;
    if (!transactionHash) return record;
    hash(transactionHash);
    if (['CONFIRMED', 'REVERTED', 'CANCELLED'].includes(record.status)) {
      valid(record.transactionHash === transactionHash, 'HASH_CHANGED'); return record;
    }
    const context = async () => { const [chain, accounts] = await Promise.all([rpc('eth_chainId'), rpc('eth_accounts')]);
      valid(quantity(chain) === BigInt(CHAIN) && Array.isArray(accounts) && accounts[0]?.toLowerCase() === holder && isCurrent(), 'SELECTION_CHANGED'); };
    await context();
    const tx = await rpc('eth_getTransactionByHash', [transactionHash]); valid(tx !== null, 'TRANSACTION_UNAVAILABLE');
    const verified = verifyTransaction(tx, record.review, transactionHash);
    await context();
    // An unfinalized replacement must never erase the original recovery hash.
    if (!verified.cancelled && verified.withinReviewFee && (record.transactionHash === null || record.transactionHash === transactionHash)) {
      record = save({ ...record, status: 'SUBMITTED', transactionHash, receipt: null }, store);
    }
    const receipt = await rpc('eth_getTransactionReceipt', [transactionHash]);
    if (receipt === null) return record;
    valid(receipt.transactionHash?.toLowerCase() === transactionHash && ['0x0', '0x1'].includes(receipt.status)
      && receipt.from?.toLowerCase() === holder && receipt.to?.toLowerCase() === tx.to?.toLowerCase(), 'RECEIPT_MISMATCH');
    valid(quantity(receipt.gasUsed) > 0n && quantity(receipt.gasUsed) <= verified.gas && quantity(receipt.effectiveGasPrice) > 0n
      && quantity(receipt.effectiveGasPrice) <= verified.feeCap && (verified.type === 2n || quantity(receipt.effectiveGasPrice) === verified.feeCap), 'RECEIPT_MISMATCH');
    const number = quantity(receipt.blockNumber); hash(receipt.blockHash);
    valid(number >= uint(record.review.anchor.number) && quantity(tx.blockNumber) === number && tx.blockHash?.toLowerCase() === receipt.blockHash
      && quantity(tx.transactionIndex) === quantity(receipt.transactionIndex), 'RECEIPT_MISMATCH');
    const [included, head] = await Promise.all([rpc('eth_getBlockByNumber', [hex(number), false]), rpc('eth_getBlockByNumber', ['latest', false])]);
    const mined = block(included), latest = block(head, true);
    valid(mined.number === number.toString() && mined.hash === receipt.blockHash && uint(latest.number) >= number, 'CHAIN_CHANGED');
    if (uint(latest.number) - number + 1n < 12n) return record;
    let events = [], cancellation;
    if (verified.cancelled) {
      valid(receipt.status === '0x1' && Array.isArray(receipt.logs) && receipt.logs.length === 0
        && await rpc('eth_getCode', [holder, hex(number)]) === '0x', 'CANCELLATION_UNVERIFIED');
      cancellation = { from: holder, to: holder, chainId: tx.chainId, nonce: tx.nonce, value: '0x0', input: '0x', gas: tx.gas, feeCap: hex(verified.feeCap) };
    } else if (receipt.status === '0x1') {
      const actual = await contracts(rpc, config, holder, hex(number));
      valid(actual.created && actual.vault === record.review.vault && actual.accountSalt === record.review.accountSalt
        && actual.canonicalRegistry === record.review.canonicalRegistry, 'CONFIG_CHANGED');
      valid(record.review.action.kind === 'WITHDRAW' || actual.dependenciesVerified, 'CONFIG_CHANGED');
      if (record.review.created) valid(actual.vaultCodeHash === record.review.vaultCodeHash, 'RUNTIME_CHANGED');
      if (['BATCH', 'WITHDRAW'].includes(record.review.action.kind)) valid(uint(actual.vaultNonce) > uint(record.review.vaultNonce), 'RECEIPT_MISMATCH');
      events = eventProof(record.review); valid(Array.isArray(receipt.logs), 'RECEIPT_MISMATCH');
      const relevant = receipt.logs.filter(log => [record.review.vault, config.factory].includes(log.address?.toLowerCase()));
      valid(relevant.length === events.length, 'DELIVERY_UNVERIFIED');
      relevant.forEach((log, index) => {
        valid(log.removed !== true && log.transactionHash?.toLowerCase() === transactionHash && log.blockHash?.toLowerCase() === mined.hash
          && quantity(log.blockNumber) === number && equal({ address: log.address?.toLowerCase(), topics: log.topics?.map(topic => topic.toLowerCase()), data: log.data?.toLowerCase() }, events[index]), 'DELIVERY_UNVERIFIED');
      });
    }
    await canonical(rpc, mined); await context();
    const actualNetworkFeeWei = quantity(receipt.gasUsed) * quantity(receipt.effectiveGasPrice);
    return save({ ...record, transactionHash, status: verified.cancelled ? 'CANCELLED' : receipt.status === '0x1' ? 'CONFIRMED' : 'REVERTED', receipt: {
      transactionHash, blockNumber: number.toString(), blockHash: mined.hash, status: receipt.status, events, ...(cancellation ? { cancellation } : {}),
      gasUsed: quantity(receipt.gasUsed).toString(), effectiveGasPrice: quantity(receipt.effectiveGasPrice).toString(), actualNetworkFeeWei: actualNetworkFeeWei.toString(),
      feeExceeded: actualNetworkFeeWei > uint(record.review.maximumNetworkFeeWei),
    } }, store);
  });
}
