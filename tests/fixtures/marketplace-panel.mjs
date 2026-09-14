import { encodeFunctionData, hashStruct, keccak256 } from 'viem';
import { ACCOUNT_ABI, SEAPORT_ABI, MARKETPLACE_GUARD_ABI, MARKETPLACE_ORDER_TYPES, MARKETPLACE_PINS } from '../../broker/src/v4/marketplace/contracts.mjs';

// Controlled fixture only. No real order/signature/guard or provider connection.
export const PANEL_OWNER = `0x${'1'.repeat(40)}`, PANEL_OTHER = `0x${'2'.repeat(40)}`;
export const PANEL_COLLECTION = `0x${'3'.repeat(40)}`, PANEL_WALLET = `0x${'4'.repeat(40)}`;
export const PANEL_HASH = `0x${'a'.repeat(64)}`;
export const PANEL_RELEASE = { status: 'OWNER_ASSIST', chainId: 4663,
  purchaseGuardDeployment: { address: `0x${'5'.repeat(40)}`, codeHash: `0x${'b'.repeat(64)}` } };

export function marketplacePanelFixture({ now = Date.now(), intentId = 'e'.repeat(64), owner = PANEL_OWNER,
  punkId = '93', status = 'PREPARED' } = {}) {
  const timestamp = BigInt(Math.floor(now / 1000)), zero = `0x${'0'.repeat(40)}`, zeroHash = `0x${'0'.repeat(64)}`;
  const items = [], calls = [];
  for (const [index, price] of [400000000000000n, 600000000000001n].entries()) {
    const tokenId = BigInt(1599 + index);
    const parameters = { offerer: PANEL_OTHER, zone: zero,
      offer: [{ itemType: 2, token: PANEL_COLLECTION, identifierOrCriteria: tokenId, startAmount: 1n, endAmount: 1n }],
      consideration: [{ itemType: 0, token: zero, identifierOrCriteria: 0n, startAmount: price, endAmount: price, recipient: PANEL_OTHER }],
      orderType: 0, startTime: 1n, endTime: 2_000_000_000n, zoneHash: zeroHash, salt: BigInt(index + 2),
      conduitKey: zeroHash, totalOriginalConsiderationItems: 1n };
    items.push({ tokenId: String(tokenId), totalWei: String(price), counter: '0', orderHash: hashStruct({
      data: { ...parameters, counter: 0n }, primaryType: 'OrderComponents', types: MARKETPLACE_ORDER_TYPES }) });
    calls.push({ to: MARKETPLACE_PINS.seaport, value: price, data: encodeFunctionData({ abi: SEAPORT_ABI,
      functionName: 'fulfillAdvancedOrder', args: [{ parameters, numerator: 1n, denominator: 1n,
        signature: `0x${'a'.repeat(130)}`, extraData: '0x' }, [], zeroHash, PANEL_WALLET] }) });
  }
  const review = { schema: 'GOGH_MARKETPLACE_REVIEW_V1', action: 'BUY_LISTINGS', chainId: 4663,
    owner, punkId, wallet: PANEL_WALLET, walletRole: 'AGENT', recipient: PANEL_WALLET, accountState: '7',
    anchor: { number: '100', hash: `0x${'c'.repeat(64)}`, timestamp: String(timestamp) }, expiresAt: Number(timestamp + 60n) * 1000,
    selection: { collection: PANEL_COLLECTION, items }, purchaseGuard: structuredClone(PANEL_RELEASE.purchaseGuardDeployment),
    safety: { status: 'PASS', collectionCodeHash: `0x${'d'.repeat(64)}` }, simulation: { status: 'PASS' },
    policy: { decision: 'ALLOW', mode: 'ASSIST', requiredSkillsEquipped: true, adapterApproved: true, budgetAllowed: true },
    collectionFloorVerified: false, transaction: null,
    cost: { totalPriceWei: '1000000000000001', maximumNetworkFeeWei: '3000000', minimumReserveWei: '500000000000000' } };
  calls.push({ to: PANEL_RELEASE.purchaseGuardDeployment.address, value: 0n,
    data: encodeFunctionData({ abi: MARKETPLACE_GUARD_ABI, functionName: 'assertPurchase', args: [BigInt(punkId), owner, 8n,
      PANEL_COLLECTION, review.safety.collectionCodeHash, items.map(item => BigInt(item.tokenId)), 500000000000000n, timestamp + 60n] }) });
  const transaction = { from: owner, to: PANEL_WALLET, chainId: '0x1237', type: '0x0', nonce: '0x9', value: '0x0',
    gas: '0x186a0', gasPrice: '0x1e', data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'executeBatch', args: [calls] }) };
  const { data, ...fields } = transaction; review.transactionCommitment = { ...fields, dataHash: keccak256(data) };
  const confirmed = ['COMPLETED', 'REVERTED'].includes(status);
  const envelope = { ok: true, schema: 'GOGH_DURABLE_MARKETPLACE_V1', owner, punkId, chainId: 4663,
    availability: ({ PREPARED: 'OWNER_REVIEW_READY', WALLET_REQUESTED: 'RECOVERY_REQUIRED', COMPLETED: 'COMPLETED', REVERTED: 'REVERTED', CANCELLED: 'CANCELLED' })[status],
    blockers: [], transaction: null, walletClaimed: false, automaticSubmission: false, publicTransactions: 0,
    broadcastAuthority: 'OWNER_WALLET_ONLY', collectionFloorVerified: false,
    entry: { intentId, revision: 0, reviewHash: 'f'.repeat(64), status, review, reason: null,
      holdsPurchase: ['PREPARED', 'WALLET_REQUESTED'].includes(status), reportedHash: confirmed ? PANEL_HASH : null,
      receipt: confirmed ? { status, transactionHash: PANEL_HASH, confirmations: '12', publicTransactions: 0 } : null } };
  return { envelope, transaction, input: { selection: { collection: PANEL_COLLECTION,
    orderHashes: items.map(item => item.orderHash).sort() }, budget: { maxTotalPriceWei: '1100000000000000',
    maxNetworkFeeWei: '4000000', minimumReserveWei: '500000000000000' } } };
}
