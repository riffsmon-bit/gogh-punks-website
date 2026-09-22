import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi } from 'viem';
import { ERC20_WITHDRAW_PINS, ERC20_WITHDRAW_COLLECTION as COLLECTION, ERC20_WITHDRAW_MAX_FEE,
  erc20Address, erc20Fail, erc20ProxyRuntime, exactErc20Amount, validateErc20Review, assertErc20Simulation,
  erc20SimulationData, erc20ExecuteData } from '../../../site/erc20-withdraw-wallet.js';

export const ERC20_WITHDRAW_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)', 'function account(uint256 tokenId) view returns (address)',
  'function owner() view returns (address)', 'function accountSalt() view returns (bytes32)', 'function state() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)',
  'function transfer(address to,uint256 amount) returns (bool)',
  'function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes)',
  'function executeBatch((address to,uint256 value,bytes data)[] calls) payable returns (bytes[])',
]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok, code, message) => { if (!ok) erc20Fail(code, message); };
const hex = value => `0x${BigInt(value).toString(16)}`;
const lower = value => String(value ?? '').toLowerCase();
const HASH = /^0x[0-9a-f]{64}$/;
const TRANSFER = keccak256(new TextEncoder().encode('Transfer(address,address,uint256)'));
const safeSymbol = value => typeof value === 'string' && /^[A-Za-z0-9 ._+-]{1,24}$/.test(value) ? value : 'TOKEN';
export function normalizeErc20Selection({ tokenId, role, contract, owner }) {
  check(typeof tokenId === 'string' && /^(0|[1-9]\d{0,3})$/.test(tokenId) && Object.hasOwn(ERC20_WITHDRAW_PINS, role), 'INVALID_SELECTION');
  const selected = { tokenId, role, contract: erc20Address(contract), owner: erc20Address(owner) };
  check(![COLLECTION, ...Object.values(ERC20_WITHDRAW_PINS).flatMap(p => [p.registry, p.implementation])].includes(selected.contract), 'UNSUPPORTED_TOKEN');
  return selected;
}
export function encodeErc20Withdrawal({ contract, owner, units }) {
  const inner = encodeFunctionData({ abi: ERC20_WITHDRAW_ABI, functionName: 'transfer', args: [owner, BigInt(units)] });
  return encodeFunctionData({ abi: ERC20_WITHDRAW_ABI, functionName: 'execute', args: [contract, 0n, inner, 0] });
}
function simulationData({ contract, owner, account, units }) {
  const balance = who => encodeFunctionData({ abi: ERC20_WITHDRAW_ABI, functionName: 'balanceOf', args: [who] });
  const data = [balance(account), balance(owner), encodeFunctionData({ abi: ERC20_WITHDRAW_ABI, functionName: 'transfer', args: [owner, BigInt(units)] }), balance(account), balance(owner)];
  return encodeFunctionData({ abi: ERC20_WITHDRAW_ABI, functionName: 'executeBatch', args: [data.map(data => ({ to: contract, value: 0n, data }))] });
}
async function readState(client, selection, blockNumber) {
  const pin = ERC20_WITHDRAW_PINS[selection.role], read = (address, functionName, args = []) => client.readContract({ address, abi: ERC20_WITHDRAW_ABI, functionName, args, blockNumber, gas: 100_000n });
  const [chain, block, originalOwner, account, salt, registryCode, implementationCode, tokenCode] = await Promise.all([
    client.getChainId(), client.getBlock({ blockNumber }), read(COLLECTION, 'ownerOf', [BigInt(selection.tokenId)]),
    read(pin.registry, 'account', [BigInt(selection.tokenId)]), read(pin.registry, 'accountSalt'),
    client.getCode({ address: pin.registry, blockNumber }), client.getCode({ address: pin.implementation, blockNumber }), client.getCode({ address: selection.contract, blockNumber }),
  ]);
  check(chain === 4663, 'WRONG_CHAIN'); check(lower(originalOwner) === selection.owner, 'OWNER_CHANGED', 'Connect the wallet that currently owns this Punk.');
  check(typeof block.number === 'bigint' && block.number === blockNumber && HASH.test(block.hash) && typeof block.timestamp === 'bigint', 'STALE_BLOCK');
  check(keccak256(registryCode ?? '0x') === pin.registryHash && keccak256(implementationCode ?? '0x') === pin.implementationHash, 'RUNTIME_CHANGED');
  check(tokenCode && tokenCode !== '0x' && tokenCode.length <= 49154, 'UNSUPPORTED_TOKEN');
  const normalizedAccount = erc20Address(account);
  check(![selection.owner, selection.contract].includes(normalizedAccount), 'UNSUPPORTED_TOKEN');
  const code = await client.getCode({ address: account, blockNumber });
  check(code && code !== '0x', 'ACCOUNT_NOT_ACTIVATED', 'This wallet is not activated. Activate it in the Punk Control Center before withdrawing tokens.');
  check(code.toLowerCase() === erc20ProxyRuntime(selection.tokenId, selection.role, salt), 'RUNTIME_CHANGED');
  const [accountOwner, state, sourceBalance, destinationBalance, decimals, symbol] = await Promise.all([
    read(account, 'owner'), read(account, 'state'),
    read(selection.contract, 'balanceOf', [account]), read(selection.contract, 'balanceOf', [selection.owner]), read(selection.contract, 'decimals'),
    read(selection.contract, 'symbol').catch(() => 'TOKEN'),
  ]);
  check(lower(accountOwner) === selection.owner, 'OWNER_CHANGED');
  check(typeof sourceBalance === 'bigint' && sourceBalance >= 0n && typeof destinationBalance === 'bigint' && destinationBalance >= 0n
    && typeof state === 'bigint' && state >= 0n && Number.isInteger(Number(decimals)) && Number(decimals) >= 0 && Number(decimals) <= 36, 'UNSUPPORTED_TOKEN');
  return { ...selection, account: normalizedAccount, salt, accountState: String(state), sourceBalance: String(sourceBalance), destinationBalance: String(destinationBalance),
    decimals: Number(decimals), symbol: safeSymbol(symbol), tokenCodeHash: keccak256(tokenCode), anchor: { number: String(block.number), hash: block.hash, timestamp: String(block.timestamp) } };
}
export class Erc20WithdrawalCoordinator {
  constructor({ clients, now = () => Date.now() }) {
    check(Array.isArray(clients) && clients.length === 2 && clients[0] !== clients[1], 'PROVIDERS_UNAVAILABLE');
    this.clients = clients; this.now = now;
  }
  async inspect(input) {
    const selection = normalizeErc20Selection(input), heads = await Promise.all(this.clients.map(c => c.getBlockNumber({ cacheTime: 0 })));
    const blockNumber = heads[0] < heads[1] ? heads[0] : heads[1];
    const states = await Promise.all(this.clients.map(c => readState(c, selection, blockNumber)));
    check(same(states[0], states[1]), 'PROVIDERS_DISAGREE');
    const state = states[0], stamp = Number(state.anchor.timestamp) * 1000;
    check(stamp <= this.now() + 5000 && stamp > this.now() - 30_000, 'STALE_BLOCK');
    const closing = await Promise.all(this.clients.map(c => c.getBlock({ blockNumber })));
    check(closing.every(b => b.number === blockNumber && b.hash === state.anchor.hash), 'STALE_BLOCK');
    return state;
  }
  async simulate(client, state, transaction) {
    const data = simulationData(state);
    check(data === erc20SimulationData(state.contract, state.account, state.owner, state.units), 'ENCODING_MISMATCH');
    const call = { account: state.owner, to: state.account, value: 0n, blockNumber: BigInt(state.anchor.number) };
    const [batch, actual, gas] = await Promise.all([client.call({ ...call, data, gas: 1_000_000n }),
      client.call({ ...call, data: transaction.data, gas: 500_000n }), client.estimateGas({ ...call, data: transaction.data, gas: 500_000n })]);
    assertErc20Simulation(batch.data, state);
    const result = decodeFunctionResult({ abi: ERC20_WITHDRAW_ABI, functionName: 'execute', data: actual.data });
    check(result === `0x${'0'.repeat(63)}1`, 'FALSE_RETURN');
    check(typeof gas === 'bigint' && gas > 0n && gas <= 500_000n, 'FEE_CHANGED');
    return gas;
  }
  async prepare(input) {
    const state = await this.inspect(input), units = exactErc20Amount(input.amount, state.decimals);
    check(units <= BigInt(state.sourceBalance), 'BALANCE_CHANGED', 'The selected wallet does not hold that many tokens.');
    state.units = String(units); state.amount = input.amount;
    const data = encodeErc20Withdrawal(state);
    check(data === erc20ExecuteData(state.contract, state.owner, state.units), 'ENCODING_MISMATCH');
    const transaction = { from: state.owner, to: state.account, data, value: '0x0', chainId: '0x1237' };
    const estimates = await Promise.all(this.clients.map(async client => {
      const [gas, gasPrice, nonce, pending, balance] = await Promise.all([this.simulate(client, state, transaction), client.getGasPrice(),
        client.getTransactionCount({ address: state.owner, blockTag: 'latest' }), client.getTransactionCount({ address: state.owner, blockTag: 'pending' }),
        client.getBalance({ address: state.owner, blockNumber: BigInt(state.anchor.number) })]);
      check(Number.isSafeInteger(nonce) && nonce >= 0 && nonce === pending, 'NONCE_CHANGED', 'Your wallet has a pending transaction. Wait for it to finish before reviewing this withdrawal.');
      check(typeof gasPrice === 'bigint' && gasPrice > 0n && typeof balance === 'bigint' && balance >= 0n, 'FEE_CHANGED');
      return { gas, gasPrice, nonce, balance };
    }));
    check(estimates[0].nonce === estimates[1].nonce, 'PROVIDERS_DISAGREE');
    const gas = (estimates.reduce((a, b) => b.gas > a ? b.gas : a, 0n) * 120n + 99n) / 100n;
    const gasPrice = estimates.reduce((a, b) => b.gasPrice > a ? b.gasPrice : a, 0n) * 2n, maximumNetworkFeeWei = gas * gasPrice;
    check(gas <= 500_000n && gasPrice > 0n && maximumNetworkFeeWei <= ERC20_WITHDRAW_MAX_FEE
      && estimates.every(e => e.balance >= maximumNetworkFeeWei), 'FEE_CHANGED', 'Your connected wallet needs enough ETH for the displayed maximum network fee.');
    Object.assign(transaction, { gas: hex(gas), gasPrice: hex(gasPrice), nonce: hex(estimates[0].nonce) });
    const review = { schema: 'GOGH_ERC20_WITHDRAW_REVIEW_V1', chainId: 4663, ...state, transaction,
      expiresAt: Number(state.anchor.timestamp) * 1000 + 60_000, maximumNetworkFeeWei: String(maximumNetworkFeeWei) };
    validateErc20Review(review); return review;
  }
  async verify(review) {
    validateErc20Review(review); check(this.now() < review.expiresAt, 'EXPIRED');
    const state = await this.inspect(review);
    for (const key of ['owner', 'account', 'contract', 'salt', 'accountState', 'sourceBalance', 'destinationBalance', 'decimals', 'tokenCodeHash']) check(state[key] === review[key], 'BALANCE_CHANGED');
    await Promise.all(this.clients.map(async client => {
      const [oldAnchor, gas, nonce, pending, gasPrice, balance] = await Promise.all([
        client.getBlock({ blockNumber: BigInt(review.anchor.number) }), this.simulate(client, { ...state, units: review.units }, review.transaction),
        client.getTransactionCount({ address: review.owner, blockTag: 'latest' }), client.getTransactionCount({ address: review.owner, blockTag: 'pending' }),
        client.getGasPrice(), client.getBalance({ address: review.owner, blockNumber: BigInt(state.anchor.number) }),
      ]);
      check(oldAnchor.number === BigInt(review.anchor.number) && oldAnchor.hash === review.anchor.hash, 'STALE_BLOCK');
      check(BigInt(nonce) === BigInt(review.transaction.nonce) && nonce === pending, 'NONCE_CHANGED');
      check(typeof gasPrice === 'bigint' && gasPrice > 0n && typeof balance === 'bigint' && balance >= 0n
        && gas <= BigInt(review.transaction.gas) && gasPrice <= BigInt(review.transaction.gasPrice) && balance >= BigInt(review.maximumNetworkFeeWei), 'FEE_CHANGED');
    }));
    check(this.now() < review.expiresAt, 'EXPIRED'); return { verified: true };
  }
  async recover({ review, transactionHash }) {
    validateErc20Review(review); check(typeof transactionHash === 'string' && HASH.test(transactionHash.toLowerCase()), 'INVALID_HASH');
    const hash = transactionHash.toLowerCase();
    const results = await Promise.all(this.clients.map(async client => {
      const [chain, transaction, receipt] = await Promise.all([client.getChainId(), client.getTransaction({ hash }).catch(() => null), client.getTransactionReceipt({ hash }).catch(() => null)]);
      check(chain === 4663, 'WRONG_CHAIN');
      if (!transaction) return { status: 'PENDING', transactionHash: hash };
      check(lower(transaction.hash) === hash && lower(transaction.from) === review.owner && lower(transaction.to) === review.account
        && transaction.input === review.transaction.data && transaction.value === 0n && BigInt(transaction.nonce) === BigInt(review.transaction.nonce)
        && transaction.chainId === 4663 && typeof transaction.gas === 'bigint' && transaction.gas > 0n
        && typeof (transaction.gasPrice ?? transaction.maxFeePerGas) === 'bigint' && (transaction.gasPrice ?? transaction.maxFeePerGas) > 0n && transaction.gas <= BigInt(review.transaction.gas)
        && (transaction.gasPrice ?? transaction.maxFeePerGas) <= BigInt(review.transaction.gasPrice), 'TRANSACTION_MISMATCH');
      if (!receipt) return { status: 'PENDING', transactionHash: hash };
      check(lower(receipt.transactionHash) === hash && lower(receipt.from) === review.owner && lower(receipt.to) === review.account
        && typeof receipt.blockNumber === 'bigint' && receipt.blockNumber > 0n && receipt.blockNumber >= BigInt(review.anchor.number)
        && typeof receipt.gasUsed === 'bigint' && receipt.gasUsed > 0n && typeof receipt.effectiveGasPrice === 'bigint' && receipt.effectiveGasPrice > 0n
        && receipt.gasUsed <= BigInt(review.transaction.gas) && receipt.effectiveGasPrice <= BigInt(review.transaction.gasPrice), 'TRANSACTION_MISMATCH');
      const [canonical, finalized, anchor, code, accountCode] = await Promise.all([client.getBlock({ blockNumber: receipt.blockNumber }), client.getBlock({ blockTag: 'finalized' }),
        client.getBlock({ blockNumber: BigInt(review.anchor.number) }), client.getCode({ address: review.contract, blockNumber: receipt.blockNumber }),
        client.getCode({ address: review.account, blockNumber: receipt.blockNumber })]);
      check(canonical.number === receipt.blockNumber && canonical.hash === receipt.blockHash && transaction.blockHash === receipt.blockHash && transaction.blockNumber === receipt.blockNumber
        && anchor.number === BigInt(review.anchor.number) && anchor.hash === review.anchor.hash && keccak256(code ?? '0x') === review.tokenCodeHash
        && accountCode?.toLowerCase() === erc20ProxyRuntime(review.tokenId, review.role, review.salt), 'RECEIPT_MISMATCH');
      check(typeof finalized.number === 'bigint' && finalized.number >= 0n && HASH.test(finalized.hash), 'RECEIPT_MISMATCH');
      if (finalized.number < receipt.blockNumber) return { status: 'CONFIRMING', transactionHash: hash };
      if (receipt.status === 'reverted') return { status: 'REVERTED', transactionHash: hash, blockNumber: String(receipt.blockNumber) };
      check(receipt.status === 'success', 'RECEIPT_MISMATCH');
      const sourceTopic = `0x${review.account.slice(2).padStart(64, '0')}`, ownerTopic = `0x${review.owner.slice(2).padStart(64, '0')}`;
      check(Array.isArray(receipt.logs), 'RECEIPT_MISMATCH');
      const relevant = receipt.logs.filter(log => lower(log.address) === review.contract && log.topics?.[0] === TRANSFER);
      const exact = relevant.length === 1 && relevant[0].topics.length === 3 && relevant[0].topics[1] === sourceTopic && relevant[0].topics[2] === ownerTopic
        && /^0x[0-9a-fA-F]{64}$/.test(relevant[0].data) && BigInt(relevant[0].data) === BigInt(review.units);
      // Block-level deltas deliberately fail closed when other transfers share the block.
      const balance = (address, blockNumber) => client.readContract({ address: review.contract, abi: ERC20_WITHDRAW_ABI, functionName: 'balanceOf', args: [address], blockNumber, gas: 100_000n });
      const [before, after, ownerBefore, ownerAfter] = await Promise.all([balance(review.account, receipt.blockNumber - 1n), balance(review.account, receipt.blockNumber),
        balance(review.owner, receipt.blockNumber - 1n), balance(review.owner, receipt.blockNumber)]);
      check([before, after, ownerBefore, ownerAfter].every(v => typeof v === 'bigint' && v >= 0n), 'RECEIPT_MISMATCH');
      const delivered = exact && before >= BigInt(review.units) && after === before - BigInt(review.units) && ownerAfter === ownerBefore + BigInt(review.units);
      return { status: delivered ? 'CONFIRMED' : 'REQUIRES_ATTENTION', transactionHash: hash, blockNumber: String(receipt.blockNumber),
        blockHash: receipt.blockHash, units: review.units, destination: review.owner };
    }));
    check(same(results[0], results[1]), 'PROVIDERS_DISAGREE'); return results[0];
  }
}
