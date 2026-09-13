import { encodeFunctionData, keccak256, parseAbi } from 'viem';
import deployment from '../../../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import { normalizePunkIdentity } from '../v4/domain/identity.mjs';
import { readPunkAgentAccountRuntime } from './punk-agent-account-runtime.mjs';
import { AGENT_RECOVERY_PINS, normalizeAgentRecoveryIntent, agentRecoveryProxyRuntime,
  validateAgentRecoveryReview, agentRecoveryFail } from '../../../site/punk-agent-recovery.js';

export const AGENT_RECOVERY_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function accountSalt() view returns (bytes32)',
  'function balanceOf(address owner,uint256 id) view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function safeTransferFrom(address from,address to,uint256 tokenId)',
  'function safeTransferFrom(address from,address to,uint256 tokenId,uint256 amount,bytes data)',
  'function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes)',
  'function withdrawEntryPointDeposit(uint256 amount)',
]);
const assert = (condition, code) => { if (!condition) agentRecoveryFail(code); };
const lower = value => typeof value === 'string' ? value.toLowerCase() : '';
const quantity = value => `0x${BigInt(value).toString(16)}`;
const sameAddress = (left, right) => lower(left) === lower(right);
const MAX_FEE = 1_000_000_000_000_000n;
// Server-side viem encoding is independent of the browser's typed encoder.
export function encodeAgentRecoveryTransaction(intentValue, owner, account) {
  const intent = normalizeAgentRecoveryIntent(intentValue), amount = BigInt(intent.amountWei);
  let data;
  if (intent.action === 'ENTRY_POINT') data = encodeFunctionData({ abi: AGENT_RECOVERY_ABI,
    functionName: 'withdrawEntryPointDeposit', args: [amount] });
  else {
    let inner = '0x';
    if (intent.action === 'ERC721') inner = encodeFunctionData({ abi: AGENT_RECOVERY_ABI,
      functionName: 'safeTransferFrom', args: [account, owner, BigInt(intent.assetTokenId)] });
    if (intent.action === 'ERC1155') inner = encodeFunctionData({ abi: AGENT_RECOVERY_ABI,
      functionName: 'safeTransferFrom', args: [account, owner, BigInt(intent.assetTokenId), amount, '0x'] });
    data = encodeFunctionData({ abi: AGENT_RECOVERY_ABI, functionName: 'execute',
      args: [intent.action === 'NATIVE' ? owner : intent.assetContract,
        intent.action === 'NATIVE' ? amount : 0n, inner, 0] });
  }
  return { chainId: '0x1237', from: lower(owner), to: lower(account), value: '0x0', data: lower(data) };
}
function manifestPins() {
  const p = AGENT_RECOVERY_PINS;
  assert(deployment.schema === 'GOGH_PUNK_AGENT_ACCOUNT_DEPLOYMENT_V1' && deployment.status === 'DEPLOYED'
    && sameAddress(deployment.canonicalCollection, p.collection)
    && sameAddress(deployment.contracts.GoghPunkAgentAccountRegistry.address, p.registry)
    && sameAddress(deployment.contracts.GoghPunkAgentAccount.address, p.implementation)
    && deployment.contracts.GoghPunkAgentAccount.runtimeBytecodeHash === p.implementationHash
    && deployment.contracts.GoghPunkAgentAccountRegistry.runtimeBytecodeHash === p.registryHash, 'DEPLOYMENT_MISMATCH');
}
export async function prepareAgentRecovery({ client, intent: supplied, owner: ownerValue, now = () => Date.now() }) {
  const intent = normalizeAgentRecoveryIntent(supplied), owner = lower(ownerValue), p = AGENT_RECOVERY_PINS;
  assert(/^0x[0-9a-f]{40}$/.test(owner) && !/^0x0{40}$/.test(owner), 'OWNER_CHANGED');
  normalizePunkIdentity({ chainId: 4663, collection: p.collection, tokenId: intent.tokenId });
  manifestPins();
  const block = await client.getBlock({ blockTag: 'latest' }), blockNumber = block?.number;
  assert(typeof blockNumber === 'bigint' && blockNumber >= 0n && /^0x[0-9a-f]{64}$/.test(block?.hash ?? '')
    && typeof block.timestamp === 'bigint' && block.timestamp >= 0n
    && Number.isSafeInteger(Number(block.timestamp) * 1000)
    && now() - Number(block.timestamp) * 1000 < 30_000 && Number(block.timestamp) * 1000 <= now() + 5_000, 'STALE_BLOCK');
  const pinned = { getChainId: () => client.getChainId(),
    readContract: query => client.readContract({ ...query, blockNumber }),
    getCode: query => client.getCode({ ...query, blockNumber }),
    getBalance: query => client.getBalance({ ...query, blockNumber }) };
  const runtime = await readPunkAgentAccountRuntime({ client: pinned, deployment,
    tokenId: intent.tokenId, expectedOwner: owner });
  assert(runtime.accountCreated === true, 'ACCOUNT_NOT_ACTIVATED');
  const read = (contract, functionName, args = []) => pinned.readContract({ address: contract,
    abi: AGENT_RECOVERY_ABI, functionName, args });
  const [originalOwner, salt, accountCode, ownerBalance, nonce, confirmedNonce, quotedGasPrice] = await Promise.all([
    read(p.collection, 'ownerOf', [BigInt(intent.tokenId)]), read(p.registry, 'accountSalt'),
    pinned.getCode({ address: runtime.account }), pinned.getBalance({ address: owner }),
    client.getTransactionCount({ address: owner, blockTag: 'pending' }),
    client.getTransactionCount({ address: owner, blockTag: 'latest' }), client.getGasPrice(),
  ]);
  assert(sameAddress(originalOwner, owner), 'OWNER_CHANGED');
  assert(accountCode?.toLowerCase() === agentRecoveryProxyRuntime(intent.tokenId, lower(salt)), 'RUNTIME_CHANGED');
  assert(Number.isSafeInteger(nonce) && nonce >= 0 && nonce === confirmedNonce, 'NONCE_CHANGED');
  const amount = BigInt(intent.amountWei), reserve = runtime.sessionActive ? runtime.session.minimumNativeReserveWei : 0n;
  assert(intent.action !== 'NATIVE' || runtime.nativeBalance >= amount + reserve, 'BALANCE_CHANGED');
  assert(intent.action !== 'ENTRY_POINT' || !runtime.sessionActive, 'RECALL_REQUIRED');
  assert(intent.action !== 'ENTRY_POINT' || runtime.entryPointDeposit >= amount, 'BALANCE_CHANGED');
  let assetUnits = 0n, assetRuntimeCodeHash = null;
  if (intent.assetContract) {
    assert(intent.assetContract !== runtime.account && ![p.registry, p.implementation].includes(intent.assetContract), 'INVALID_INTENT');
    const [code, held, supported] = await Promise.all([
      pinned.getCode({ address: intent.assetContract }),
      read(intent.assetContract, intent.action === 'ERC721' ? 'ownerOf' : 'balanceOf',
        intent.action === 'ERC721' ? [BigInt(intent.assetTokenId)] : [runtime.account, BigInt(intent.assetTokenId)]),
      read(intent.assetContract, 'supportsInterface', [intent.action === 'ERC721' ? '0x80ac58cd' : '0xd9b67a26']),
    ]);
    assert(typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(code) && supported === true, 'ASSET_CHANGED');
    assetRuntimeCodeHash = keccak256(code);
    assetUnits = intent.action === 'ERC721' ? sameAddress(held, runtime.account) ? 1n : 0n : held;
    assert(typeof assetUnits === 'bigint' && assetUnits >= amount, 'ASSET_CHANGED');
  }
  const transaction = encodeAgentRecoveryTransaction(intent, owner, runtime.account);
  assert(typeof quotedGasPrice === 'bigint' && quotedGasPrice > 0n, 'FEE_CHANGED');
  const gasPrice = quotedGasPrice * 2n;
  const call = { account: owner, to: runtime.account, data: transaction.data, value: 0n, gasPrice };
  const [simulation, estimate] = await Promise.all([
    client.call({ ...call, blockNumber }), client.estimateGas({ ...call, blockNumber }),
  ]);
  const expected = intent.action === 'ENTRY_POINT' ? '0x' : `0x${32n.toString(16).padStart(64, '0')}${'0'.repeat(64)}`;
  assert(simulation && Object.hasOwn(simulation, 'data')
    && (simulation.data === undefined ? '0x' : simulation.data) === expected
    && typeof estimate === 'bigint' && estimate > 0n, 'SIMULATION_FAILED');
  const gas = (estimate * 120n + 99n) / 100n, fee = gas * gasPrice;
  assert(gas <= 500_000n && fee <= MAX_FEE && ownerBalance >= fee, 'FEE_CHANGED');
  const closing = await client.getBlock({ blockNumber });
  assert(closing?.hash === block.hash && now() - Number(block.timestamp) * 1000 < 30_000, 'STALE_BLOCK');
  return validateAgentRecoveryReview({ schema: 'GOGH_AGENT_RECOVERY_REVIEW_V1', intent, owner,
    account: runtime.account, accountSalt: lower(salt), accountRuntimeCodeHash: keccak256(accountCode), assetRuntimeCodeHash,
    anchor: { number: blockNumber.toString(), hash: block.hash, timestamp: block.timestamp.toString() },
    expiresAt: Number(block.timestamp) * 1000 + 90_000,
    balances: { nativeWei: runtime.nativeBalance.toString(), entryPointWei: runtime.entryPointDeposit.toString(),
      assetUnits: assetUnits.toString(), ownerNativeWei: ownerBalance.toString() },
    session: { active: runtime.sessionActive, reserveWei: reserve.toString() },
    transaction: { ...transaction, nonce: quantity(nonce), gas: quantity(gas), gasPrice: quantity(gasPrice) },
    maximumNetworkFeeWei: fee.toString() });
}
