import { createReviewedBurnPreparation } from './reviewed-burn.mjs';
import { holderBurnSelection, readHolderSource, readHolderStandardInventory } from './holder-source.mjs';
import { validateHolderObligations } from './holder-obligations.mjs';
import { readHolderCreditEvidence } from './holder-credit-evidence.mjs';

const valid = (v, code) => { if (!v) throw Error(code); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const terminal = ['CANCELLED', 'CONFIRMED', 'REVERTED'];
export function createHolderBurnCoordinator({ clients, release, store, selection: input, historyScanner, checkObligations,
  readSource = readHolderSource, readInventory = readHolderStandardInventory, readCredits = readHolderCreditEvidence, now = Date.now,
  preparationFactory = createReviewedBurnPreparation }) {
  const selection = holderBurnSelection(input.owner, input.sourceTokenId, input.targetTokenId);
  valid(clients?.length === 2 && clients[0] !== clients[1] && release.chainId === 4663
    && release.collection === selection.collection && ['TESTING', 'LIVE', 'PAUSED'].includes(release.status), 'HOLDER_BURN_NOT_RELEASED');
  const pins = { ...release, burnSource: release.trainingSource, burnSourceCodeHash: release.trainingSourceCodeHash };
  const services = clients.map(client => preparationFactory({ client, deployment: pins, reviewStore: store.reviewStore, now }));
  function released() { valid(release.status === 'LIVE' && release.productionBurnAuthorized === true, 'HOLDER_BURN_NOT_RELEASED'); }
  async function check({ excludeIntentId = null } = {}) {
    const source = await readSource({ clients, selection, now });
    const history = await historyScanner.advance(source);
    // History and live balances must refer to the exact same canonical anchor.
    const inventory = history.complete && history.cursor === source.anchor.number && same(history.anchorHash, source.anchor.hash)
      ? await readInventory({ clients, source, assets: history.assets })
      : { complete: false, empty: false, assets: [], scope: 'OBSERVED_STANDARD_ERC20_ERC721_ERC1155', nonstandardAssets: 'OWNER_REVIEW_REQUIRED' };
    const obligations = await checkObligations({ ...source, excludeIntentId });
    let training;
    try { training = await readCredits({ clients, release, source, now }); }
    catch { training = { status: 'UNKNOWN', clear: false, burnCredits: null, purchasedCredits: null }; }
    const blockers = [];
    if (training.status !== 'VERIFIED') blockers.push('HOLDER_CREDITS_UNKNOWN');
    else if (!training.clear) blockers.push('HOLDER_CREDITS_REMAIN');
    if (!history.complete) blockers.push('HOLDER_HISTORY_INCOMPLETE');
    if (!inventory.complete) blockers.push('HOLDER_INVENTORY_UNKNOWN');
    else if (!inventory.empty) blockers.push('HOLDER_ASSETS_PRESENT');
    if (source.wallets.some(w => [w.nativeWei, w.wethWei, w.entryPointDepositWei].some(v => BigInt(v) !== 0n))) blockers.push('HOLDER_ASSETS_PRESENT');
    if (source.wallets.some(w => w.sessionActive)) blockers.push('HOLDER_AUTOMATION_ACTIVE');
    if (source.wallets.some(w => w.pendingTransaction)) blockers.push('HOLDER_TRANSACTION_PENDING');
    try { validateHolderObligations(obligations, source); } catch { blockers.push('HOLDER_OBLIGATIONS_UNRESOLVED'); }
    if (release.status !== 'LIVE' || release.productionBurnAuthorized !== true) blockers.push('HOLDER_BURN_NOT_RELEASED');
    const stale = Math.abs(now() / 1000 - Number(source.anchor.timestamp)) >= 30;
    if (stale) blockers.push('HOLDER_SOURCE_STALE');
    const result = { schema: 'GOGH_HOLDER_BURN_CHECK_V1', selection, checkedAt: now(), anchor: source.anchor, wallets: source.wallets,
      inventory, obligations, training, history: { ...history, assets: undefined }, blockers: [...new Set(blockers)],
      canBurn: blockers.length === 0, confirmationText: `BURN ${selection.sourceTokenId}`, expectedCreditGain: '1',
      limitations: 'Standard ERC20, ERC721 and ERC1155 receipts and current holdings are checked. Nonstandard assets and off-chain obligations need your separate review. Later deposits may become inaccessible.' };
    return result;
  }
  async function prepare(action) {
    released(); valid(['APPROVE', 'BURN'].includes(action), 'HOLDER_BURN_ACTION_INVALID');
    const current = await store.current();
    valid(!current || terminal.includes(current.status), 'HOLDER_RECOVER_EXISTING_REVIEW');
    const sourceEvidence = await check();
    valid(sourceEvidence.canBurn === true, sourceEvidence.blockers[0] ?? 'HOLDER_SOURCE_BLOCKED');
    const service = preparationFactory({ client: clients[0], deployment: pins, now });
    const prepared = await service.prepare({ ...selection, action });
    const record = await store.save({ ...prepared, sourceEvidence });
    await Promise.all(services.map(s => s.recheck(record.review)));
    return { record, source: sourceEvidence };
  }
  async function claim({ intentId, revision, reviewHash, confirmation, nonstandardReviewed }) {
    released();
    const record = await store.get(intentId);
    valid(record?.status === 'PREPARED' && record.revision === revision && record.reviewHash === reviewHash, 'HOLDER_JOURNAL_CHANGED');
    valid(nonstandardReviewed === true, 'HOLDER_NONSTANDARD_REVIEW_REQUIRED');
    if (record.review.action === 'BURN') valid(confirmation === `BURN ${selection.sourceTokenId}`, 'HOLDER_CONFIRMATION_REQUIRED');
    const fresh = await check({ excludeIntentId: intentId });
    valid(fresh.canBurn === true, fresh.blockers[0] ?? 'HOLDER_SOURCE_BLOCKED');
    await Promise.all(services.map(s => s.recheck(record.review)));
    valid(now() < record.review.expiresAt, 'BURN_REVIEW_EXPIRED');
    const claimed = await store.update(intentId, revision, 'WALLET_REQUESTED', null);
    return { record: claimed, transaction: claimed.review.transaction };
  }
  async function recover({ intentId, revision, transactionHash }) {
    const record = await store.get(intentId);
    valid(record?.status === 'WALLET_REQUESTED' && record.revision === revision
      && /^0x[0-9a-f]{64}$/i.test(transactionHash), 'HOLDER_JOURNAL_CHANGED');
    const hash = transactionHash.toLowerCase();
    valid(record.reportedHash === null || record.reportedHash === hash, 'HOLDER_ORIGINAL_HASH_REQUIRED');
    // Candidate hashes are not attached until both independent providers verify
    // the exact reviewed transaction; an unrelated pasted hash cannot poison it.
    const receipts = await Promise.all(services.map(s => s.verifyReceipt(record.review, hash)));
    if (receipts.some(r => r.status === 'PENDING')) return { record, pending: true };
    valid(JSON.stringify(receipts[0]) === JSON.stringify(receipts[1]), 'HOLDER_RECEIPT_PROVIDERS_DISAGREE');
    const receipt = receipts[0];
    const confirmations = await Promise.all(clients.map(async client => {
      const r = await client.getTransactionReceipt({ hash }), block = await client.getBlock({ blockNumber: r.blockNumber });
      valid(same(r.blockHash, block.hash), 'HOLDER_RECEIPT_REORG');
      if (receipt.blockHash) valid(same(receipt.blockHash, block.hash), 'HOLDER_RECEIPT_REORG');
      const head = await client.getBlockNumber();
      return { blockNumber: String(r.blockNumber), blockHash: block.hash, confirmed: head >= r.blockNumber + 12n };
    }));
    valid(confirmations[0].blockNumber === confirmations[1].blockNumber
      && same(confirmations[0].blockHash, confirmations[1].blockHash), 'HOLDER_RECEIPT_PROVIDERS_DISAGREE');
    if (confirmations.some(r => !r.confirmed)) return { record, pending: true };
    // Closing canonical check covers reverted receipts too.
    for (const client of clients) valid(same((await client.getBlock({ blockNumber: BigInt(confirmations[0].blockNumber) })).hash,
      confirmations[0].blockHash), 'HOLDER_RECEIPT_REORG');
    return { record: await store.update(intentId, revision, receipt.status, hash, { ...receipt,
      blockNumber: confirmations[0].blockNumber, blockHash: confirmations[0].blockHash, verifiedProviders: 2 }) };
  }
  async function cancel({ intentId, revision }) {
    const record = await store.get(intentId);
    valid(record?.status === 'PREPARED' && record.revision === revision, 'HOLDER_JOURNAL_CHANGED');
    return { record: await store.update(intentId, revision, 'CANCELLED', null) };
  }
  // Recovery intentionally does not require current source ownership. After a
  // confirmed burn ownerOf(source) reverts, yet the original holder needs proof.
  return { check, prepare, claim, recover, cancel, get: async () => ({ record: await store.current() }) };
}
