// Allocation and saved-receipt display only. No provider, signing or network API.
const ETH = 10n ** 18n;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const TOKEN = /^[1-9][0-9]{0,3}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const HASH = /^0x[0-9a-f]{64}$/;
const BATCH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES = ['WALLET_REQUESTED', 'SUBMITTED', 'CONFIRMED', 'REVERTED', 'REJECTED'];
export const fundingIdentity = value => Array.isArray(value) ? `[${value.map(fundingIdentity).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${fundingIdentity(value[k])}`).join(',')}}` : JSON.stringify(value);
const address = value => ADDRESS.test(value ?? '') && !/^0x0{40}$/.test(value);
export function fundingEth(wei) {
  const amount = BigInt(wei), fraction = (amount % ETH).toString().padStart(18, '0').replace(/0+$/, '');
  return `${amount / ETH}${fraction ? `.${fraction}` : ''}`;
}
function parseBudget(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d?)(?:\.\d{1,18})?$/.test(value)) throw Error('Enter an exact ETH budget with up to 18 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * ETH + BigInt(fraction.padEnd(18, '0'));
  if (amount <= 0n || amount > 10n * ETH) throw Error('The total funding budget must be greater than zero and no more than 10 ETH.');
  return amount;
}
export function buildSwarmFunding({ owner, chainId, tokenIds, totalEth, batchId = globalThis.crypto?.randomUUID?.() }) {
  if (!address(owner?.toLowerCase()) || chainId !== 4663 || !BATCH.test(batchId ?? '')) throw Error('Connect your owner wallet on Robinhood Chain to plan funding.');
  if (!Array.isArray(tokenIds) || !tokenIds.length || tokenIds.length > 10 || new Set(tokenIds).size !== tokenIds.length
    || tokenIds.some(id => !TOKEN.test(id) || Number(id) > 5016)) throw Error('Choose 1–10 different Punks for funding.');
  const total = parseBudget(totalEth), count = BigInt(tokenIds.length), each = total / count, remainder = total % count;
  if (each === 0n) throw Error('The budget must allocate at least one wei to every selected Punk.');
  const allocations = [...tokenIds].sort((a, b) => Number(a) - Number(b)).map((tokenId, index) => {
    const amount = each + (BigInt(index) < remainder ? 1n : 0n);
    if (amount > ETH) throw Error('Each Punk can receive at most 1 ETH per funding transfer. Reduce the total budget.');
    return { tokenId, amountWei: amount.toString(), amountEth: fundingEth(amount), opened: false, baseline: null, transaction: null };
  });
  return { schema: 'GOGH_SWARM_FUNDING_V1', batchId, owner: owner.toLowerCase(), chainId,
    totalWei: total.toString(), totalEth: fundingEth(total), allocations };
}
export function ownerAllocationTransaction(transaction, owner, amountWei) {
  return !!transaction && transaction.chainId === '0x1237' && transaction.from === owner
    && address(transaction.to) && transaction.to !== owner && transaction.data === '0x'
    && QUANTITY.test(transaction.nonce ?? '') && QUANTITY.test(transaction.value ?? '')
    && BigInt(transaction.value) === BigInt(amountWei)
    && Object.keys(transaction).sort().join(',') === 'chainId,data,from,nonce,to,value';
}
export function fundingJournalReference(record, owner, tokenId) {
  if (record === null) return null;
  if (!record || record.schema !== 'GOGH_AGENT_GAS_FUNDING_JOURNAL_V1' || !STATUSES.includes(record.status)
    || !address(record.owner) || !TOKEN.test(record.tokenId) || !record.transaction
    || owner !== undefined && record.owner !== owner || tokenId !== undefined && record.tokenId !== tokenId) throw Error('The saved funding record is unavailable. Check this Punk’s funding history.');
  return { status: record.status, transaction: structuredClone(record.transaction) };
}
export function restoreSwarmFunding(saved, { owner, chainId, tokenIds, totalEth }) {
  if (!saved || saved.schema !== 'GOGH_SWARM_FUNDING_V1') throw Error('The saved funding plan is invalid.');
  const restored = buildSwarmFunding({ owner, chainId, tokenIds, totalEth, batchId: saved.batchId });
  if (saved.owner !== restored.owner || saved.chainId !== restored.chainId || saved.totalWei !== restored.totalWei
    || saved.totalEth !== restored.totalEth || !Array.isArray(saved.allocations) || saved.allocations.length !== restored.allocations.length) throw Error('The saved funding amounts changed. Check original transfers before creating another batch.');
  restored.allocations.forEach((allocation, index) => {
    const prior = saved.allocations[index];
    if (!prior || prior.tokenId !== allocation.tokenId || prior.amountWei !== allocation.amountWei || prior.amountEth !== allocation.amountEth
      || typeof prior.opened !== 'boolean' || (!prior.opened && (prior.baseline !== null || prior.transaction !== null))) throw Error('The saved funding allocation changed.');
    if (prior.baseline !== null && (!prior.baseline || !STATUSES.includes(prior.baseline.status) || !prior.baseline.transaction)) throw Error('The original funding history is unreadable.');
    if (prior.transaction !== null && !ownerAllocationTransaction(prior.transaction, restored.owner, allocation.amountWei)) throw Error('The saved funding destination or amount changed.');
    allocation.opened = prior.opened;
    allocation.baseline = structuredClone(prior.baseline);
    allocation.transaction = structuredClone(prior.transaction);
  });
  return restored;
}
export function allocationFundingStatus(funding, allocation, record) {
  if (!allocation.opened) return 'NOT_REVIEWED';
  if (!allocation.transaction) return 'REVIEW';
  if (record === null) return allocation.baseline === null ? 'REVIEW' : 'CHECK_STATUS';
  if (record?.schema !== 'GOGH_AGENT_GAS_FUNDING_JOURNAL_V1' || record.owner !== funding.owner
    || record.tokenId !== allocation.tokenId || !STATUSES.includes(record.status)) return 'CHECK_STATUS';
  if (allocation.baseline && record?.status === allocation.baseline.status
    && fundingIdentity(record.transaction) === fundingIdentity(allocation.baseline.transaction)
    && fundingIdentity(record.transaction) !== fundingIdentity(allocation.transaction)) return 'REVIEW';
  if (!ownerAllocationTransaction(record.transaction, funding.owner, allocation.amountWei)
    || fundingIdentity(record.transaction) !== fundingIdentity(allocation.transaction)
    || (allocation.baseline?.status !== 'REJECTED' && allocation.baseline?.transaction
      && fundingIdentity(allocation.baseline.transaction) === fundingIdentity(record.transaction))) return 'CHECK_STATUS';
  if (['SUBMITTED', 'CONFIRMED', 'REVERTED'].includes(record.status) && !HASH.test(record.transactionHash ?? '')) return 'CHECK_STATUS';
  if (['CONFIRMED', 'REVERTED'].includes(record.status) && (record.receipt?.transactionHash !== record.transactionHash
    || !HASH.test(record.receipt.blockHash ?? '') || !QUANTITY.test(record.receipt.blockNumber ?? '')
    || record.receipt.status !== (record.status === 'CONFIRMED' ? '0x1' : '0x0'))) return 'CHECK_STATUS';
  return record.status;
}
