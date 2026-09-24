// Owner-confirmed gas funding only. Recheck/recovery never submits a transaction.
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
// This compatibility exception is for eth_chainId, never stored transactions.
const onRobinhoodChain = value => value === 4663 || typeof value === 'string'
  && /^0x[0-9a-fA-F]{1,64}$/.test(value) && BigInt(value) === 4663n;
const STATUSES = ['WALLET_REQUESTED', 'SUBMITTED', 'CONFIRMED', 'REVERTED', 'REJECTED'];
const pending = value => ['WALLET_REQUESTED', 'SUBMITTED'].includes(value?.status);
const copy = value => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function fail(code, message) {
  throw Object.assign(new Error(message), { code: `AGENT_GAS_${code}` });
}
function identity(owner, tokenId) {
  if (!ADDRESS.test(owner ?? '') || /^0x0{40}$/.test(owner)
    || typeof tokenId !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(tokenId)) {
    fail('IDENTITY_INVALID', 'Choose a Punk and connect its owner wallet.');
  }
  return `gogh:agent-gas-funding:4663:${owner}:${tokenId}`;
}
function transactionValid(tx, owner) {
  return tx && tx.chainId === '0x1237' && tx.from === owner && ADDRESS.test(tx.to ?? '')
    && !/^0x0{40}$/.test(tx.to) && QUANTITY.test(tx.value ?? '') && QUANTITY.test(tx.nonce ?? '')
    && /^0x(?:[0-9a-f]{2})*$/.test(tx.data ?? '') && tx.data.length <= 338;
}
function validate(value, owner, tokenId) {
  if (!value || value.schema !== 'GOGH_AGENT_GAS_FUNDING_JOURNAL_V1'
    || value.owner !== owner || value.tokenId !== tokenId || !STATUSES.includes(value.status)
    || !transactionValid(value.transaction, owner)
    || !(value.transactionHash === null || HASH.test(value.transactionHash))
    || (['SUBMITTED', 'CONFIRMED', 'REVERTED'].includes(value.status) && !HASH.test(value.transactionHash ?? ''))
    || (['CONFIRMED', 'REVERTED'].includes(value.status)
      && (!value.receipt || value.receipt.transactionHash !== value.transactionHash
        || !HASH.test(value.receipt.blockHash ?? '') || !QUANTITY.test(value.receipt.blockNumber ?? '')
        || value.receipt.status !== (value.status === 'CONFIRMED' ? '0x1' : '0x0')))) {
    fail('JOURNAL_INVALID', 'The saved funding record cannot be read. Check wallet activity before funding again.');
  }
  return value;
}
export function getAgentGasFundingState(owner, tokenId, { storage = globalThis.localStorage } = {}) {
  const key = identity(owner, tokenId);
  let raw;
  try { raw = storage.getItem(key); }
  catch { fail('STORAGE_UNAVAILABLE', 'Saved funding records are unavailable. Allow browser storage before funding.'); }
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); }
  catch { fail('JOURNAL_INVALID', 'The saved funding record cannot be read. Check wallet activity before funding again.'); }
  return copy(validate(value, owner, tokenId));
}
function save(value, storage) {
  validate(value, value.owner, value.tokenId);
  try {
    storage.setItem(identity(value.owner, value.tokenId), JSON.stringify(value));
    if (!same(getAgentGasFundingState(value.owner, value.tokenId, { storage }), value)) throw Error('save failed');
  } catch { fail('STORAGE_UNAVAILABLE', 'Funding could not be saved. Check wallet activity before funding again.'); }
}
async function locked(owner, tokenId, { locks = globalThis.navigator?.locks, isCurrent }, callback) {
  if (typeof isCurrent !== 'function' || !isCurrent()) fail('SELECTION_CHANGED', 'Funding selection changed. Review again.');
  if (typeof locks?.request !== 'function') fail('LOCKS_UNAVAILABLE',
    'This browser cannot protect funding across tabs. Use a current Chrome, Safari or Firefox browser.');
  return locks.request(identity(owner, tokenId), { mode: 'exclusive' }, async () => {
    if (!isCurrent()) fail('SELECTION_CHANGED', 'Funding selection changed. Review again.');
    return callback();
  });
}

export async function submitJournaledAgentGasFunding(provider, prepared, {
  freshReview, isCurrent, storage = globalThis.localStorage, locks = globalThis.navigator?.locks,
}) {
  // Copy the displayed review before awaiting a cross-tab lock or fresh reads.
  const shown = copy(prepared);
  return locked(shown.owner, shown.tokenId, { locks, isCurrent }, async () => {
    if (pending(getAgentGasFundingState(shown.owner, shown.tokenId, { storage }))) {
      fail('FUNDING_PENDING', 'A funding request is already saved. Recheck it or recover its original transaction before funding again.');
    }
    const fresh = await freshReview(shown);
    if (!same(fresh, shown) || !isCurrent()) fail('REVIEW_CHANGED', 'Funding changed during review. Review again.');
    const record = { schema: 'GOGH_AGENT_GAS_FUNDING_JOURNAL_V1', owner: shown.owner,
      tokenId: shown.tokenId, status: 'WALLET_REQUESTED', transaction: copy(shown.transaction),
      transactionHash: null, receipt: null };
    try { save(record, storage); }
    catch (error) {
      // No wallet request has occurred. If a partial save is readable/writable,
      // leave a terminal record instead of an unresolvable unknown transaction.
      try { save({ ...record, status: 'REJECTED' }, storage); } catch { /* Storage is still unavailable. */ }
      throw error;
    }
    let hash;
    try { hash = await provider.request({ method: 'eth_sendTransaction', params: [copy(shown.transaction)] }); }
    catch (error) {
      if (error?.code === 4001) {
        save({ ...record, status: 'REJECTED' }, storage);
        fail('WALLET_REJECTED', 'You cancelled funding in your wallet. Review again when ready.');
      }
      fail('WALLET_RESULT_UNKNOWN', 'The wallet result was not received. Recover the original transaction from wallet activity; it will not be sent again.');
    }
    if (!HASH.test(hash ?? '')) fail('WALLET_RESULT_UNKNOWN',
      'The wallet did not return a transaction hash. Recover the original transaction from wallet activity; it will not be sent again.');
    save({ ...record, status: 'SUBMITTED', transactionHash: hash.toLowerCase() }, storage);
    return { hash: hash.toLowerCase() };
  });
}

function sameTransaction(tx, expected, hash) {
  return tx && tx.hash?.toLowerCase() === hash && tx.from?.toLowerCase() === expected.from
    && tx.to?.toLowerCase() === expected.to && (tx.input ?? tx.data)?.toLowerCase() === expected.data
    && ['value', 'nonce', 'chainId'].every(key => QUANTITY.test(tx[key] ?? '')
      && BigInt(tx[key]) === BigInt(expected[key]));
}
async function reconcile(provider, owner, tokenId, suppliedHash, options) {
  const { storage = globalThis.localStorage, locks = globalThis.navigator?.locks, isCurrent } = options;
  return locked(owner, tokenId, { locks, isCurrent }, async () => {
    let record = getAgentGasFundingState(owner, tokenId, { storage });
    if (!record || record.status === 'REJECTED') return record;
    const hash = suppliedHash ?? record.transactionHash;
    if (hash === null) return record;
    if (!HASH.test(hash ?? '') || (record.transactionHash !== null && record.transactionHash !== hash.toLowerCase())) {
      fail('HASH_MISMATCH', 'Use the original funding transaction hash from your wallet activity.');
    }
    const normalizedHash = hash.toLowerCase();
    const rpc = async (method, params = []) => {
      try { return await provider.request({ method, params }); }
      catch { fail('READ_UNAVAILABLE', 'Funding could not be checked. Recheck shortly; the saved transaction will not be sent again.'); }
    };
    const [chainId, accounts, tx] = await Promise.all([
      rpc('eth_chainId'), rpc('eth_accounts'), rpc('eth_getTransactionByHash', [normalizedHash]),
    ]);
    if (!onRobinhoodChain(chainId) || !Array.isArray(accounts) || accounts[0]?.toLowerCase() !== owner || !isCurrent()) {
      fail('SELECTION_CHANGED', 'Reconnect the funding wallet on Robinhood Chain and recheck.');
    }
    if (tx === null) fail('TRANSACTION_UNAVAILABLE', 'The original transaction is not visible yet. Recheck shortly.');
    if (!sameTransaction(tx, record.transaction, normalizedHash)) fail('TRANSACTION_MISMATCH',
      'That transaction does not match the funding you reviewed. Copy the original hash from wallet activity.');
    record = { ...record, status: 'SUBMITTED', transactionHash: normalizedHash, receipt: null };
    save(record, storage); // Retain a verified recovered hash even when receipt reads fail.
    const receipt = await rpc('eth_getTransactionReceipt', [normalizedHash]);
    if (receipt === null) return record;
    if (receipt.transactionHash?.toLowerCase() !== normalizedHash || !QUANTITY.test(receipt.blockNumber ?? '')
      || !HASH.test(receipt.blockHash ?? '') || !['0x0', '0x1'].includes(receipt.status)) {
      fail('RECEIPT_INVALID', 'Funding confirmation could not be verified. Recheck shortly.');
    }
    const [block, head] = await Promise.all([
      rpc('eth_getBlockByNumber', [receipt.blockNumber, false]), rpc('eth_blockNumber'),
    ]);
    if (!isCurrent()) fail('SELECTION_CHANGED', 'Funding selection changed. Recheck after reconnecting.');
    if (!block || block.number !== receipt.blockNumber || block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()
      || !QUANTITY.test(head ?? '') || BigInt(head) < BigInt(receipt.blockNumber)) {
      fail('RECEIPT_INVALID', 'Funding confirmation changed. Recheck shortly; nothing was resent.');
    }
    if (BigInt(head) - BigInt(receipt.blockNumber) + 1n < 12n) return record;
    const confirmed = { ...record, status: receipt.status === '0x1' ? 'CONFIRMED' : 'REVERTED',
      receipt: { transactionHash: normalizedHash, blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash.toLowerCase(), status: receipt.status } };
    save(confirmed, storage);
    return confirmed;
  });
}
export function recheckAgentGasFunding(provider, owner, tokenId, options = {}) {
  return reconcile(provider, owner, tokenId, null, options);
}
export function recoverAgentGasFunding(provider, owner, tokenId, hash, options = {}) {
  return reconcile(provider, owner, tokenId, hash, options);
}
