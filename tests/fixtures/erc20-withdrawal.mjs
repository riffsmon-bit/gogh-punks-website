import { encodeAbiParameters, decodeFunctionData, encodeFunctionResult, keccak256 } from 'viem';
import { CODE } from './punk-agent-runtime.mjs';
import { ERC20_WITHDRAW_PINS, erc20ProxyRuntime } from '../../site/erc20-withdraw-wallet.js';
import { ERC20_WITHDRAW_ABI, Erc20WithdrawalCoordinator } from '../../broker/src/control-center/erc20-withdrawal.mjs';
export const OWNER = `0x${'1'.repeat(40)}`, ACCOUNT = `0x${'3'.repeat(40)}`, TOKEN = `0x${'4'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`;
export const HASH = `0x${'a'.repeat(64)}`, TX = `0x${'b'.repeat(64)}`, SALT = `0x${'0'.repeat(64)}`, NOW = 1789400000000;
const word = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const addressWord = value => `0x${value.slice(2).padStart(64, '0')}`;
export function erc20Fixture() {
  const f = { owner: OWNER, chain: 4663, now: NOW, state: 1n, source: 5000000n, destination: 2000000n, decimals: 6,
    symbol: 'USDC', fee: 0n, falseReturn: false, gasPrice: 1000n, gas: 60000n, nonce: 7, pending: 7, ownerEth: 10n ** 18n,
    code: { ...CODE }, tokenCode: '0x6000600055', finalized: true, receipt: null, transaction: null, sends: 0, calls: [] };
  f.selection = { tokenId: '93', role: 'AGENT', contract: TOKEN, owner: OWNER };
  f.codeFor = address => address.toLowerCase() === ERC20_WITHDRAW_PINS.AGENT.registry ? f.code.registry
    : address.toLowerCase() === ERC20_WITHDRAW_PINS.AGENT.implementation ? f.code.implementation
      : address.toLowerCase() === ACCOUNT ? erc20ProxyRuntime('93', 'AGENT', SALT) : f.tokenCode;
  f.result = units => encodeAbiParameters([{ type: 'bytes[]' }], [[word(f.source), word(f.destination), word(f.falseReturn ? 0 : 1), word(f.source - units), word(f.destination + units - f.fee)]]);
  f.client = {
    getChainId: async () => f.chain, getBlockNumber: async () => 1000n,
    getBlock: async ({ blockNumber, blockTag } = {}) => ({ number: blockTag === 'finalized' ? f.finalized ? 1001n : 999n : blockNumber ?? 1000n, hash: HASH, timestamp: BigInt(NOW / 1000) }),
    getCode: async ({ address }) => f.codeFor(address), getBalance: async () => f.ownerEth,
    getTransactionCount: async ({ blockTag }) => blockTag === 'pending' ? f.pending : f.nonce,
    getGasPrice: async () => f.gasPrice, estimateGas: async () => f.gas,
    readContract: async ({ functionName, args = [], blockNumber }) => {
      const values = { ownerOf: f.owner, owner: f.owner, account: ACCOUNT, accountSalt: SALT, state: f.state, decimals: f.decimals, symbol: f.symbol };
      if (functionName === 'balanceOf') {
        const source = args[0].toLowerCase() === ACCOUNT;
        return (source ? f.source : f.destination) + (f.receipt && blockNumber === 1001n ? source ? -f.units : f.units - f.fee : 0n);
      }
      if (!Object.hasOwn(values, functionName)) throw new Error(`Unexpected function ${functionName}`); return values[functionName];
    },
    call: async ({ data }) => {
      const decoded = decodeFunctionData({ abi: ERC20_WITHDRAW_ABI, data }); f.calls.push(decoded.functionName);
      if (decoded.functionName === 'executeBatch') {
        const transfer = decodeFunctionData({ abi: ERC20_WITHDRAW_ABI, data: decoded.args[0][2].data }); return { data: f.result(transfer.args[1]) };
      }
      return { data: encodeFunctionResult({ abi: ERC20_WITHDRAW_ABI, functionName: 'execute', result: word(f.falseReturn ? 0 : 1) }) };
    },
    getTransaction: async () => f.transaction,
    getTransactionReceipt: async () => f.receipt,
  };
  f.coordinator = new Erc20WithdrawalCoordinator({ clients: [f.client, new Proxy(f.client, {})], now: () => f.now });
  f.prepare = amount => f.coordinator.prepare({ ...f.selection, amount: amount ?? '1.25' });
  f.provider = { request: async ({ method, params = [] }) => {
    if (method === 'eth_chainId') return `0x${f.chain.toString(16)}`;
    if (method === 'eth_accounts') return [f.owner];
    if (method === 'eth_getBlockByNumber') return { number: params[0] === 'latest' ? '0x3e8' : params[0], hash: HASH, timestamp: `0x${BigInt(NOW / 1000).toString(16)}` };
    if (method === 'eth_getCode') return f.codeFor(params[0]);
    if (method === 'eth_getBalance') return `0x${f.ownerEth.toString(16)}`;
    if (method === 'eth_getTransactionCount') return `0x${(params[1] === 'pending' ? f.pending : f.nonce).toString(16)}`;
    if (method === 'eth_gasPrice') return `0x${f.gasPrice.toString(16)}`;
    if (method === 'eth_estimateGas') return `0x${f.gas.toString(16)}`;
    if (method === 'eth_call') {
      const decoded = decodeFunctionData({ abi: ERC20_WITHDRAW_ABI, data: params[0].data });
      if (['execute', 'executeBatch'].includes(decoded.functionName)) return (await f.client.call(params[0])).data;
      const value = await f.client.readContract({ functionName: decoded.functionName, args: decoded.args ?? [], blockNumber: 1000n });
      return encodeFunctionResult({ abi: ERC20_WITHDRAW_ABI, functionName: decoded.functionName, result: value });
    }
    if (method === 'eth_sendTransaction') { f.sends++; f.sent = params[0]; if (f.sendError) throw f.sendError; return TX; }
    throw new Error(`Unexpected method ${method}`);
  } };
  f.confirm = review => {
    f.units = BigInt(review.units);
    f.transaction = { ...review.transaction, input: review.transaction.data, hash: TX, chainId: 4663, value: 0n, nonce: Number(BigInt(review.transaction.nonce)), gas: BigInt(review.transaction.gas), gasPrice: BigInt(review.transaction.gasPrice), blockNumber: 1001n, blockHash: HASH };
    f.receipt = { transactionHash: TX, from: OWNER, to: ACCOUNT, blockNumber: 1001n, blockHash: HASH, status: 'success', gasUsed: f.gas, effectiveGasPrice: f.gasPrice,
      logs: [{ address: TOKEN, topics: [keccak256(new TextEncoder().encode('Transfer(address,address,uint256)')), addressWord(ACCOUNT), addressWord(OWNER)], data: word(f.units) }] };
  };
  let tail = Promise.resolve(); f.locks = { request: (_key, _options, run) => { const pending = tail.then(run); tail = pending.catch(() => {}); return pending; } };
  return f;
}
