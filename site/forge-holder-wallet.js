import { encodePunkBurnApproval, encodeReviewedBurnCall } from './forge-burn-calldata.js';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const valid = v => { if (!v) throw Error('The burn review no longer matches the selected Punks. Recheck before continuing.'); };
export function validateHolderBurnEnvelope(payload, selected, release) {
  valid(payload?.ok === true && payload.mode === 'HOLDER_BURN' && payload.chainId === 4663
    && same(payload.owner, selected.owner) && payload.targetTokenId === String(selected.tokenId)
    && payload.sourceTokenId === String(selected.sourceTokenId) && payload.sourceTokenId !== payload.targetTokenId
    && selected.chainId === 4663 && selected.preview !== true && release?.status === 'LIVE'
    && release.productionBurnAuthorized === true && payload.collection === release.collection);
  const record = payload.record;
  if (record) {
    const { review, reviewHash, revision, status, reportedHash } = record, tx = review?.transaction;
    valid(review && /^[0-9a-f]{64}$/.test(review.intentId) && /^[0-9a-f]{64}$/.test(reviewHash)
      && Number.isSafeInteger(revision) && revision >= 0 && ['PREPARED', 'WALLET_REQUESTED', 'CONFIRMED', 'REVERTED', 'CANCELLED'].includes(status)
      && (reportedHash === null || /^0x[0-9a-f]{64}$/.test(reportedHash)) && ['APPROVE', 'BURN'].includes(review.action)
      && same(review.state?.owner, selected.owner) && review.state.sourceTokenId === payload.sourceTokenId
      && review.state.targetTokenId === payload.targetTokenId && Number.isSafeInteger(review.expiresAt));
    valid(tx && same(tx.from, selected.owner) && tx.chainId === '0x1237' && tx.value === '0x0'
      && Object.keys(tx).every(k => ['from', 'to', 'chainId', 'value', 'type', 'nonce', 'gas', 'gasPrice', 'data'].includes(k))
      && ['nonce', 'gas', 'gasPrice'].every(k => /^0x[0-9a-f]+$/.test(tx[k])) && (!tx.type || tx.type === '0x0')
      && BigInt(tx.gas) > 0n && BigInt(tx.gas) <= 500000n && BigInt(tx.gasPrice) > 0n
      && BigInt(tx.gas) * BigInt(tx.gasPrice) === BigInt(review.maximumNetworkFeeWei)
      && BigInt(review.maximumNetworkFeeWei) <= BigInt(release.feeCeilingWei));
    if (review.action === 'APPROVE') valid(same(tx.to, release.collection)
      && tx.data === encodePunkBurnApproval(release.trainingSource, payload.sourceTokenId));
    else valid(same(tx.to, release.trainingSource) && review.burn?.sourceTokenId === payload.sourceTokenId
      && review.burn.targetTokenId === payload.targetTokenId && review.burn.nonce === review.state.nonce
      && review.burn.stateHash === review.state.stateHash && Number(review.burn.deadline) * 1000 === review.expiresAt
      && tx.data === encodeReviewedBurnCall(review.burn));
  }
  return payload;
}

export async function submitHolderBurn({ envelope, selected, provider, release, isCurrent, claim, persistAttempt, persistHash, now = Date.now }) {
  const record = validateHolderBurnEnvelope(envelope, selected, release).record;
  valid(record?.status === 'PREPARED' && now() + 5000 < record.review.expiresAt);
  const walletMatches = async () => {
    valid(isCurrent());
    const [chain, accounts] = await Promise.all([provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' })]);
    valid(chain === '0x1237' && same(accounts?.[0], selected.owner) && isCurrent());
  };
  await walletMatches(); await persistAttempt(record.review.intentId);
  const claimed = validateHolderBurnEnvelope(await claim(record), selected, release);
  valid(claimed.record?.status === 'WALLET_REQUESTED' && claimed.record.reviewHash === record.reviewHash
    && JSON.stringify(claimed.record.review) === JSON.stringify(record.review)
    && JSON.stringify(claimed.transaction) === JSON.stringify(record.review.transaction));
  await walletMatches(); valid(now() + 1000 < record.review.expiresAt);
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [claimed.transaction] });
  valid(/^0x[0-9a-f]{64}$/i.test(hash));
  await persistHash(record.review.intentId, hash.toLowerCase());
  return hash.toLowerCase();
}
