const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export async function recoverSetupTransaction({ journal, revision, transactionHash, clients }) {
  let state = journal.report(revision, transactionHash);
  const record = state.records.at(-1), expected = record.review.transaction;
  if (record.status === 'SUBMITTED') return { state, pending: false };
  for (const client of clients) {
    let tx;
    try { tx = await client.getTransaction({ hash: transactionHash }); }
    catch { continue; }
    if (!tx) continue;
    if (!same(tx.hash, transactionHash) || !same(tx.from, expected.from) || tx.chainId !== 4663
      || tx.nonce !== Number(BigInt(expected.nonce)) || tx.input !== expected.data || tx.value !== 0n
      || tx.gas !== BigInt(expected.gas) || tx.maxFeePerGas !== BigInt(expected.maxFeePerGas)
      || tx.maxPriorityFeePerGas !== 0n || tx.type !== 'eip1559' || tx.authorizationList?.length
      || !(expected.to ? same(tx.to, expected.to) : tx.to === null)) throw Error('SETUP_RECOVERY_MISMATCH');
    state = journal.recover(state.revision, transactionHash);
    return { state, pending: false };
  }
  return { state, pending: true };
}
