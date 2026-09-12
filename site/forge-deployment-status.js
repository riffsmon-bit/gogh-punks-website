// Display only. Transaction and deployment authority stays with server checks.
export function deploymentReceiptStatus(state, { localFixture = false } = {}) {
  const result = (text, error = false) => ({ text, error });
  const verification = state?.verification;
  if (verification?.code === 'FORGE_ARCHIVE_STATE_UNAVAILABLE')
    return result('Verification needs historical reads that the RPCs cannot serve. The saved transaction hashes remain available; setup verification is incomplete.', true);
  if (verification?.status === 'UNAVAILABLE')
    return result('An RPC read failed. The saved transaction hashes are retained. Recheck their verification; no transaction was resent.', true);
  if (verification?.status === 'FAILED')
    return result(`Setup verification failed (${verification.code}). Review the saved transaction and deployment record before continuing.`, true);
  if (state?.evidence) return result(localFixture
    ? 'Disposable deployment verified on this test chain. Registry paused.'
    : 'Live deployment verified at a finalized block by both RPCs. Registry paused. You can now read your Punk’s real progression state.');
  if (state?.steps?.some(step => step.status === 'WALLET_REQUESTED' && !step.transactionHash && !step.reportedTransactionHash))
    return result('A wallet request has no saved transaction hash. Recover the original hash from wallet activity; rechecking receipts alone cannot resolve it.', true);
  if (state?.steps?.some(step => step.reportedTransactionHash && !step.transactionHash))
    return result('A reported transaction hash is saved and awaits verification. Recheck the original transaction; it will not be resent.');
  if (state?.steps?.some(step => step.status === 'REVERTED'))
    return result('A setup transaction reverted. Review the saved receipt and resolve its nonce before preparing another transaction.', true);
  if (state?.steps?.some(step => step.status === 'SUBMITTED'))
    return result('An original transaction is awaiting its receipt. Recheck shortly; it will not be resent.');
  if (state?.steps?.every(step => step.status === 'INCLUDED')) return result(verification?.code === 'FORGE_DEPLOYMENT_FINALITY_PENDING'
    ? 'Both transaction receipts are verified. Waiting for the chain’s finalized block to include them; recheck shortly.'
    : 'Both transaction receipts are verified. Recheck for finalized deployment verification.');
  return result('Complete the two wallet transactions, then verify their receipts.');
}
