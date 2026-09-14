import { verifyMarketplaceTransaction } from './marketplace-wallet-codec.js';
const A = /^0x[0-9a-f]{40}$/, H = /^0x[0-9a-f]{64}$/, D = /^[0-9a-f]{64}$/;
const U = /^(0|[1-9][0-9]{0,77})$/, Q = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const check = value => { if (!value) throw Error('The selected Punk purchase review could not be verified.'); };
const nonzero = value => A.test(value) && value !== `0x${'0'.repeat(40)}`;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical)}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
export function validateMarketplaceEnvelope(payload, selected) {
  check(payload?.ok === true && payload.schema === 'GOGH_DURABLE_MARKETPLACE_V1' && payload.chainId === 4663
    && payload.owner === selected?.owner?.toLowerCase() && payload.punkId === String(selected?.tokenId)
    && selected.chainId === 4663 && !selected.preview && A.test(payload.owner)
    && payload.automaticSubmission === false && payload.publicTransactions === 0
    && payload.broadcastAuthority === 'OWNER_WALLET_ONLY'
    && ['RELEASE_BLOCKED', 'EMPTY', 'OWNER_REVIEW_READY', 'RECOVERY_REQUIRED', 'COMPLETED', 'REVERTED', 'CANCELLED'].includes(payload.availability)
    && Array.isArray(payload.blockers) && typeof payload.walletClaimed === 'boolean');
  const entry = payload.entry;
  if (!entry) { check(payload.transaction === null && !payload.walletClaimed); return payload; }
  const review = entry.review;
  check(D.test(entry.intentId) && D.test(entry.reviewHash) && Number.isSafeInteger(entry.revision) && entry.revision >= 0
    && ['PREPARED', 'WALLET_REQUESTED', 'COMPLETED', 'REVERTED', 'CANCELLED'].includes(entry.status)
    && (entry.reportedHash === null || H.test(entry.reportedHash)) && review?.transaction === null
    && review.schema === 'GOGH_MARKETPLACE_REVIEW_V1' && review.action === 'BUY_LISTINGS' && review.chainId === 4663
    && review.owner === payload.owner && review.punkId === payload.punkId && review.walletRole === 'AGENT'
    && nonzero(review.wallet) && review.recipient === review.wallet && nonzero(review.selection?.collection)
    && review.selection.collection !== '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
    && review.collectionFloorVerified === false && review.safety?.status === 'PASS' && review.simulation?.status === 'PASS'
    && review.policy?.decision === 'ALLOW' && review.policy.mode === 'ASSIST' && review.policy.requiredSkillsEquipped === true
    && review.policy.adapterApproved === true && review.policy.budgetAllowed === true
    && Number.isSafeInteger(review.expiresAt) && U.test(review.anchor?.timestamp) && H.test(review.anchor.hash)
    && review.expiresAt === (Number(review.anchor.timestamp) + 60) * 1000
    && nonzero(review.purchaseGuard?.address) && H.test(review.purchaseGuard.codeHash)
    && Array.isArray(review.selection.items) && review.selection.items.length >= 1 && review.selection.items.length <= 5);
  check(review.selection.items.every(item => U.test(item.tokenId) && H.test(item.orderHash) && U.test(item.counter) && U.test(item.totalWei))
    && new Set(review.selection.items.map(item => item.tokenId)).size === review.selection.items.length
    && new Set(review.selection.items.map(item => item.orderHash)).size === review.selection.items.length
    && ['totalPriceWei', 'maximumNetworkFeeWei', 'minimumReserveWei'].every(key => U.test(review.cost?.[key]))
    && review.selection.items.reduce((sum, item) => sum + BigInt(item.totalWei), 0n) === BigInt(review.cost.totalPriceWei));
  const c = review.transactionCommitment;
  check(c && Object.keys(c).length === 9 && c.from === review.owner && c.to === review.wallet && c.chainId === '0x1237'
    && c.type === '0x0' && c.value === '0x0' && H.test(c.dataHash) && ['nonce', 'gas', 'gasPrice'].every(k => Q.test(c[k]))
    && BigInt(c.gas) > 0n && BigInt(c.gasPrice) > 0n && BigInt(c.gas) * BigInt(c.gasPrice) === BigInt(review.cost.maximumNetworkFeeWei));
  if (payload.transaction !== null) {
    check(payload.walletClaimed && entry.status === 'WALLET_REQUESTED' && payload.availability === 'RECOVERY_REQUIRED' && payload.blockers.length === 0);
    verifyMarketplaceTransaction(review, payload.transaction);
  } else check(!payload.walletClaimed);
  return payload;
}

export async function submitMarketplacePurchase({ envelope, selected, provider, claim, persistAttempt, persistHash, isCurrent, purchaseRelease }) {
  const original = validateMarketplaceEnvelope(envelope, selected).entry;
  check(original?.status === 'PREPARED' && envelope.availability === 'OWNER_REVIEW_READY' && envelope.blockers.length === 0
    && Date.now() + 5000 < original.review.expiresAt);
  check(purchaseRelease?.status === 'OWNER_ASSIST' && purchaseRelease.chainId === 4663
    && purchaseRelease.purchaseGuardDeployment?.address === original.review.purchaseGuard.address
    && purchaseRelease.purchaseGuardDeployment.codeHash === original.review.purchaseGuard.codeHash);
  const walletMatches = async () => {
    check(isCurrent());
    const [chain, accounts] = await Promise.all([provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' })]);
    check(chain === '0x1237' && accounts?.[0]?.toLowerCase() === original.review.owner && isCurrent());
  };
  await walletMatches();
  // Persist the attempt before the claim. An interrupted response remains reserved.
  await persistAttempt(original.intentId);
  const response = validateMarketplaceEnvelope(await claim(original), selected), entry = response.entry;
  check(isCurrent() && response.walletClaimed && entry?.status === 'WALLET_REQUESTED' && entry.intentId === original.intentId
    && entry.reviewHash === original.reviewHash && entry.revision === original.revision + 1
    && canonical(entry.review) === canonical(original.review));
  await walletMatches(); check(Date.now() + 1000 < original.review.expiresAt);
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [response.transaction] });
  check(typeof hash === 'string' && H.test(hash.toLowerCase()));
  await persistHash(original.intentId, hash.toLowerCase());
  return hash.toLowerCase();
}
