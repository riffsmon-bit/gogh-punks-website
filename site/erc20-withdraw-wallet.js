import { keccak256Hex } from './keccak256.js';

export const ERC20_WITHDRAW_CHAIN = 4663;
export const ERC20_WITHDRAW_COLLECTION = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
export const ERC20_WITHDRAW_PINS = Object.freeze({
  V3: Object.freeze({ registry: '0x7d4f654cd95104dc22c64fc8c70937f32fcbac52',
    registryHash: '0x6aa5390e63f46d3712dad94040d41b8051d8d6c273c7bfb28ac7308bae63c645',
    implementation: '0xb24199845ca42966e755b2dad7c8a9a490afeb13',
    implementationHash: '0x63b26b5f3bce8b3adb52d1c1d9c9067c9c24cc63e5c961a6d9e399dbf4396520' }),
  AGENT: Object.freeze({ registry: '0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844',
    registryHash: '0x5a1001edb812b6ec2e233cbba6db4b7c680d0832453927696cf1ef623fff8e22',
    implementation: '0xfdb26c2ec70956227728414ff4ab7a5eda64d13b',
    implementationHash: '0x7d37d360014ce94902655062605b8318581097df100ab2573be52904afa6badc' }),
});
export const ERC20_WITHDRAW_MAX_FEE = 1_000_000_000_000_000n;
const UINT = /^(0|[1-9]\d{0,77})$/, HASH = /^0x[0-9a-f]{64}$/;
export const erc20Word = value => BigInt(value).toString(16).padStart(64, '0');
const aw = value => value.slice(2).padStart(64, '0');
const quantity = value => `0x${BigInt(value).toString(16)}`;
const selector = text => keccak256Hex(`0x${Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('')}`).slice(0, 10);
const sel = Object.freeze({ account: selector('account(uint256)'), salt: selector('accountSalt()'), state: selector('state()'),
  batch: selector('executeBatch((address,uint256,bytes)[])') });
export class Erc20WithdrawalError extends Error {
  constructor(code, message) { super(message); this.name = 'Erc20WithdrawalError'; this.code = `ERC20_WITHDRAW_${code}`; }
}
export function erc20Fail(code, message = 'The token withdrawal could not be verified. Check the wallet and review again.') {
  throw new Erc20WithdrawalError(code, message);
}
const check = (ok, code, message) => { if (!ok) erc20Fail(code, message); };
export function erc20Address(value) {
  check(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value), 'INVALID_ADDRESS');
  return value.toLowerCase();
}
export function exactErc20Amount(value, decimals) {
  check(Number.isInteger(decimals) && decimals >= 0 && decimals <= 36, 'UNSUPPORTED_TOKEN');
  check(typeof value === 'string' && value.length <= 116 && /^(0|[1-9]\d*)(\.\d+)?$/.test(value), 'INVALID_AMOUNT', 'Enter a positive token amount without commas or scientific notation.');
  const [whole, fraction = ''] = value.split('.');
  check(fraction.length <= decimals, 'INVALID_AMOUNT', `This token supports at most ${decimals} decimal places.`);
  const amount = BigInt(whole + fraction.padEnd(decimals, '0'));
  check(amount > 0n && amount < 2n ** 256n, 'INVALID_AMOUNT', 'Enter a positive amount within the token balance.');
  return amount;
}
export function formatErc20Amount(value, decimals) {
  check(UINT.test(String(value)) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36, 'INVALID_AMOUNT');
  const text = String(value).padStart(decimals + 1, '0');
  return decimals ? `${text.slice(0, -decimals)}.${text.slice(-decimals)}`.replace(/\.?0+$/, '') : text;
}
export function erc20ProxyRuntime(tokenId, role, salt) {
  const pin = ERC20_WITHDRAW_PINS[role];
  check(pin && /^(0|[1-9]\d{0,3})$/.test(tokenId) && HASH.test(salt), 'INVALID_REVIEW');
  return `0x363d3d373d3d3d363d73${pin.implementation.slice(2)}5af43d82803e903d91602b57fd5bf3${salt.slice(2)}${erc20Word(4663)}${aw(ERC20_WITHDRAW_COLLECTION)}${erc20Word(tokenId)}`;
}
export function erc20TransferData(owner, units) {
  erc20Address(owner); check(UINT.test(String(units)) && BigInt(units) > 0n && BigInt(units) < 2n ** 256n, 'INVALID_AMOUNT');
  return `0xa9059cbb${aw(owner)}${erc20Word(units)}`;
}
export function erc20ExecuteData(contract, owner, units) {
  erc20Address(contract); const inner = erc20TransferData(owner, units).slice(2);
  return `0x51945447${aw(contract)}${erc20Word(0)}${erc20Word(128)}${erc20Word(0)}${erc20Word(inner.length / 2)}${inner.padEnd(Math.ceil(inner.length / 64) * 64, '0')}`;
}
export function erc20BalanceData(address) { return `0x70a08231${aw(erc20Address(address))}`; }
export function erc20SimulationData(contract, account, owner, units) {
  const data = [erc20BalanceData(account), erc20BalanceData(owner), erc20TransferData(owner, units), erc20BalanceData(account), erc20BalanceData(owner)];
  const tails = data.map(raw => `${aw(contract)}${erc20Word(0)}${erc20Word(96)}${erc20Word((raw.length - 2) / 2)}${raw.slice(2).padEnd(Math.ceil((raw.length - 2) / 64) * 64, '0')}`);
  let offset = data.length * 32;
  const offsets = tails.map(tail => { const value = erc20Word(offset); offset += tail.length / 2; return value; });
  return `${sel.batch}${erc20Word(32)}${erc20Word(data.length)}${offsets.join('')}${tails.join('')}`;
}
function wordResult(value) { check(/^0x[0-9a-fA-F]{64}$/.test(value ?? ''), 'RPC_INVALID'); return BigInt(value); }
function addressResult(value) { check(/^0x0{24}[0-9a-fA-F]{40}$/.test(value ?? ''), 'RPC_INVALID'); return erc20Address(`0x${value.slice(-40)}`); }
function decodeBytesArray(raw) {
  check(typeof raw === 'string' && /^0x[0-9a-fA-F]+$/.test(raw) && raw.length <= 4098, 'SIMULATION_FAILED');
  const data = raw.slice(2); check(data.length === 1088, 'SIMULATION_FAILED');
  const read = offset => { check(offset >= 0 && offset + 64 <= data.length, 'SIMULATION_FAILED'); return BigInt(`0x${data.slice(offset, offset + 64)}`); };
  check(read(0) === 32n && read(64) === 5n, 'SIMULATION_FAILED');
  let expected = 160;
  return Array.from({ length: 5 }, (_, i) => {
    const off = Number(read(128 + i * 64)); check(off === expected, 'SIMULATION_FAILED');
    const pos = 128 + off * 2, len = Number(read(pos)); check(len === 32, 'UNSUPPORTED_TOKEN');
    expected += 64; return wordResult(`0x${data.slice(pos + 64, pos + 128)}`);
  });
}
export function assertErc20Simulation(raw, { sourceBalance, destinationBalance, units }) {
  const [before, ownerBefore, result, after, ownerAfter] = decodeBytesArray(raw);
  check(result === 1n, 'FALSE_RETURN', 'This token did not confirm the transfer. Nothing was sent.');
  check(before === BigInt(sourceBalance) && ownerBefore === BigInt(destinationBalance)
    && before >= BigInt(units) && after === before - BigInt(units) && ownerAfter === ownerBefore + BigInt(units),
  'UNSUPPORTED_TOKEN', 'This token changes the transfer amount or balance unexpectedly. It is not supported by this withdrawal flow.');
  return true;
}
export function validateErc20Review(review) {
  check(review && review.schema === 'GOGH_ERC20_WITHDRAW_REVIEW_V1' && review.chainId === 4663 && ERC20_WITHDRAW_PINS[review.role]
    && /^(0|[1-9]\d{0,3})$/.test(review.tokenId), 'INVALID_REVIEW');
  for (const key of ['owner', 'account', 'contract']) check(erc20Address(review[key]) === review[key], 'INVALID_REVIEW');
  check(review.account !== review.owner && ![review.account, ERC20_WITHDRAW_COLLECTION, ...Object.values(ERC20_WITHDRAW_PINS).flatMap(p => [p.registry, p.implementation])].includes(review.contract), 'INVALID_REVIEW');
  for (const key of ['units', 'sourceBalance', 'destinationBalance', 'accountState']) check(typeof review[key] === 'string' && UINT.test(review[key]) && BigInt(review[key]) < 2n ** 256n, 'INVALID_REVIEW');
  check(exactErc20Amount(review.amount, review.decimals) === BigInt(review.units) && BigInt(review.units) <= BigInt(review.sourceBalance), 'INVALID_REVIEW');
  check(HASH.test(review.tokenCodeHash) && HASH.test(review.salt) && HASH.test(review.anchor?.hash) && UINT.test(review.anchor?.number)
    && UINT.test(review.anchor?.timestamp) && Number.isSafeInteger(review.expiresAt)
    && review.expiresAt === Number(review.anchor.timestamp) * 1000 + 60_000, 'INVALID_REVIEW');
  const t = review.transaction;
  check(t && Object.keys(t).sort().join(',') === 'chainId,data,from,gas,gasPrice,nonce,to,value'
    && t.from === review.owner && t.to === review.account && t.value === '0x0' && t.chainId === '0x1237'
    && t.data === erc20ExecuteData(review.contract, review.owner, review.units), 'INVALID_TRANSACTION');
  for (const key of ['gas', 'gasPrice', 'nonce']) check(/^0x(0|[1-9a-f][0-9a-f]*)$/.test(t[key] ?? ''), 'INVALID_TRANSACTION');
  check(BigInt(t.gas) > 0n && BigInt(t.gas) <= 500_000n && BigInt(t.gasPrice) > 0n
    && BigInt(t.gas) * BigInt(t.gasPrice) <= ERC20_WITHDRAW_MAX_FEE
    && review.maximumNetworkFeeWei === String(BigInt(t.gas) * BigInt(t.gasPrice)), 'FEE_CHANGED');
  return review;
}
export async function verifyErc20Wallet(provider, review, { now = () => Date.now() } = {}) {
  validateErc20Review(review); check(now() < review.expiresAt, 'EXPIRED', 'This review expired. Review the withdrawal again.');
  const rpc = (method, params = []) => provider.request({ method, params });
  const [connectedChain, connectedAccounts] = await Promise.all([rpc('eth_chainId'), rpc('eth_accounts')]);
  check(BigInt(connectedChain) === 4663n, 'WRONG_CHAIN', 'Switch your wallet to Robinhood Chain.');
  check(Array.isArray(connectedAccounts) && connectedAccounts[0]?.toLowerCase() === review.owner, 'OWNER_CHANGED', 'Connect the wallet that currently owns this Punk.');
  const pin = ERC20_WITHDRAW_PINS[review.role], block = await rpc('eth_getBlockByNumber', ['latest', false]);
  check(block && BigInt(block.timestamp) * 1000n <= BigInt(now() + 5000) && BigInt(block.timestamp) * 1000n > BigInt(now() - 30_000), 'STALE_BLOCK');
  const tag = block.number, call = (to, data) => rpc('eth_call', [{ to, data, gas: '0x186a0' }, tag]);
  const [chain, accounts, originalOwner, accountOwner, account, salt, state, registryCode, implementationCode, code, tokenCode, held, ownerHeld, decimals, nonce, pending, balance, canonical, gasPrice] = await Promise.all([
    rpc('eth_chainId'), rpc('eth_accounts'), call(ERC20_WITHDRAW_COLLECTION, `0x6352211e${erc20Word(review.tokenId)}`),
    call(review.account, '0x8da5cb5b'), call(pin.registry, `${sel.account}${erc20Word(review.tokenId)}`), call(pin.registry, sel.salt), call(review.account, sel.state),
    rpc('eth_getCode', [pin.registry, tag]), rpc('eth_getCode', [pin.implementation, tag]), rpc('eth_getCode', [review.account, tag]), rpc('eth_getCode', [review.contract, tag]),
    call(review.contract, erc20BalanceData(review.account)), call(review.contract, erc20BalanceData(review.owner)), call(review.contract, '0x313ce567'),
    rpc('eth_getTransactionCount', [review.owner, 'latest']), rpc('eth_getTransactionCount', [review.owner, 'pending']), rpc('eth_getBalance', [review.owner, tag]),
    rpc('eth_getBlockByNumber', [quantity(review.anchor.number), false]), rpc('eth_gasPrice'),
  ]);
  check(BigInt(chain) === 4663n, 'WRONG_CHAIN', 'Switch your wallet to Robinhood Chain.');
  check(Array.isArray(accounts) && accounts[0]?.toLowerCase() === review.owner && addressResult(originalOwner) === review.owner && addressResult(accountOwner) === review.owner, 'OWNER_CHANGED', 'Connect the wallet that currently owns this Punk.');
  check(addressResult(account) === review.account && salt === review.salt && code.toLowerCase() === erc20ProxyRuntime(review.tokenId, review.role, salt)
    && keccak256Hex(registryCode) === pin.registryHash && keccak256Hex(implementationCode) === pin.implementationHash
    && keccak256Hex(tokenCode) === review.tokenCodeHash, 'RUNTIME_CHANGED');
  check(wordResult(held) === BigInt(review.sourceBalance) && wordResult(ownerHeld) === BigInt(review.destinationBalance)
    && wordResult(state) === BigInt(review.accountState) && wordResult(decimals) === BigInt(review.decimals), 'BALANCE_CHANGED');
  check(BigInt(nonce) === BigInt(review.transaction.nonce) && BigInt(pending) === BigInt(nonce), 'NONCE_CHANGED');
  check(canonical?.hash === review.anchor.hash && BigInt(block.number) >= BigInt(review.anchor.number), 'STALE_BLOCK');
  check(BigInt(balance) >= BigInt(review.maximumNetworkFeeWei) && BigInt(gasPrice) <= BigInt(review.transaction.gasPrice), 'FEE_CHANGED');
  const simulation = await rpc('eth_call', [{ from: review.owner, to: review.account, value: '0x0', gas: '0xf4240', data: erc20SimulationData(review.contract, review.account, review.owner, review.units) }, tag]);
  assertErc20Simulation(simulation, review);
  const actual = await rpc('eth_call', [{ from: review.owner, to: review.account, value: '0x0', gas: review.transaction.gas, data: review.transaction.data }, tag]);
  check(actual === `0x${erc20Word(32)}${erc20Word(32)}${erc20Word(1)}`, 'FALSE_RETURN');
  const estimate = await rpc('eth_estimateGas', [review.transaction]);
  check(BigInt(estimate) <= BigInt(review.transaction.gas), 'FEE_CHANGED');
  return review;
}
export async function submitErc20Withdrawal(provider, supplied, { persistAttempt, verifyReview, contextCurrent = () => true, now = () => Date.now(), locks = globalThis.navigator?.locks }) {
  const review = JSON.parse(JSON.stringify(supplied)); validateErc20Review(review);
  check(typeof persistAttempt === 'function' && typeof verifyReview === 'function', 'RECOVERY_REQUIRED');
  check(typeof locks?.request === 'function', 'LOCK_UNAVAILABLE', 'This browser cannot safely coordinate wallet requests. Use a current browser and try again.');
  return locks.request(`gogh:erc20-withdraw:${review.owner}`, { mode: 'exclusive' }, async () => {
  try { await verifyReview(review); await verifyErc20Wallet(provider, review, { now }); }
  catch (error) { if (error instanceof Erc20WithdrawalError) throw error; erc20Fail('CHECK_UNAVAILABLE', 'The live wallet checks are unavailable. Nothing was sent. Reconnect and review again.'); }
  check(contextCurrent() && now() < review.expiresAt, 'STALE_SELECTION');
  // Save before opening the wallet. An unknown result can only be recovered, never resent.
  await persistAttempt({ review, status: 'WALLET_REQUESTED', transactionHash: null });
  let hash;
  try { hash = await provider.request({ method: 'eth_sendTransaction', params: [review.transaction] }); }
  catch (error) { if (error?.code === 4001) { await persistAttempt({ review, status: 'REJECTED', transactionHash: null }); erc20Fail('WALLET_REJECTED', 'You rejected the wallet request. Nothing was sent by this page. Review again whenever you are ready.'); } erc20Fail('WALLET_RESULT_UNKNOWN', 'The wallet result is not known. Check wallet activity and recover the original transaction before trying again.'); }
  check(typeof hash === 'string' && HASH.test(hash.toLowerCase()), 'WALLET_RESULT_UNKNOWN');
  await persistAttempt({ review, status: 'SUBMITTED', transactionHash: hash.toLowerCase() });
  return hash.toLowerCase();
  });
}
