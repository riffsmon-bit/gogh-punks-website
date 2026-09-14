import { submitMarketplacePurchase, validateMarketplaceEnvelope } from './marketplace-wallet.js';

const ADDRESS = /^0x[0-9a-f]{40}$/, HASH = /^0x[0-9a-f]{64}$/, DIGEST = /^[0-9a-f]{64}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ZERO = `0x${'0'.repeat(40)}`, PUNKS = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
const TERMINAL = new Set(['COMPLETED', 'REVERTED', 'CANCELLED']);
const check = (value, code = 'PURCHASE_RESPONSE_INVALID') => { if (!value) throw Error(code); };
const uint = value => typeof value === 'string' && UINT.test(value) && BigInt(value) < 2n ** 256n;
const exact = (value, fields) => {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === fields.length
    && fields.every(key => Object.hasOwn(value, key))
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => d.enumerable && Object.hasOwn(d, 'value')), 'PURCHASE_INPUT_INVALID');
};
const eth = value => { const n = BigInt(value), fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${n / 10n ** 18n}${fraction ? `.${fraction}` : ''} ETH`; };
const short = value => `${value.slice(0, 8)}…${value.slice(-6)}`;
const sameInput = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function inputFor(value) {
  exact(value, ['selection', 'budget']); exact(value.selection, ['collection', 'orderHashes']);
  exact(value.budget, ['maxTotalPriceWei', 'maxNetworkFeeWei', 'minimumReserveWei']);
  check(typeof value.selection.collection === 'string', 'PURCHASE_INPUT_INVALID');
  const collection = value.selection.collection.toLowerCase(), hashes = value.selection.orderHashes;
  check(ADDRESS.test(collection) && ![ZERO, PUNKS].includes(collection) && Array.isArray(hashes)
    && hashes.length >= 1 && hashes.length <= 5
    && Reflect.ownKeys(hashes).length === hashes.length + 1
    && Array.from({ length: hashes.length }, (_, index) => Object.getOwnPropertyDescriptor(hashes, String(index)))
      .every(descriptor => descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable
        && typeof descriptor.value === 'string' && HASH.test(descriptor.value.toLowerCase())), 'PURCHASE_INPUT_INVALID');
  const orderHashes = hashes.map(hash => hash.toLowerCase()).sort();
  check(new Set(orderHashes).size === orderHashes.length && Object.values(value.budget).every(uint)
    && BigInt(value.budget.maxTotalPriceWei) > 0n && BigInt(value.budget.maxNetworkFeeWei) > 0n, 'PURCHASE_INPUT_INVALID');
  return { selection: { collection, orderHashes }, budget: { maxTotalPriceWei: value.budget.maxTotalPriceWei,
    maxNetworkFeeWei: value.budget.maxNetworkFeeWei, minimumReserveWei: value.budget.minimumReserveWei } };
}

const CSS = `
:host{display:block;color:var(--text,#f4f5ef);font-family:var(--font-body,Inter,system-ui,sans-serif);font-size:14px;line-height:1.5}
*{box-sizing:border-box} [hidden]{display:none!important} .card{min-width:0;border:1px solid var(--line,#303b49);border-radius:16px;overflow:hidden;background:var(--surface,#10151c)}
.body{padding:clamp(18px,4vw,30px)} .head{display:flex;gap:14px;align-items:flex-start;justify-content:space-between}.eyebrow{margin:0 0 9px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted,#a5b1c0);font-weight:800}
h2{font-size:clamp(23px,5vw,30px);line-height:1.15;letter-spacing:-.035em;margin:0;font-weight:750}p{margin:12px 0 0}.muted{color:var(--muted,#a5b1c0)}.badge{flex:none;border:1px solid var(--line,#303b49);border-radius:30px;padding:5px 9px;font-size:10px;text-transform:uppercase;letter-spacing:.07em;font-weight:750;white-space:nowrap;color:var(--cyan,#68e8ff)}
.badge.done{color:var(--success,#66ef9c)}.badge.warning{color:var(--warning,#ffc65a)}.identity{display:flex;flex-wrap:wrap;gap:5px 13px;margin-top:13px;font-size:12px;color:var(--muted,#a5b1c0)}
.items{display:grid;gap:0;margin:22px 0 0;padding:0;list-style:none;border-top:1px solid var(--line,#303b49)}.item{display:grid;grid-template-columns:40px minmax(0,1fr);align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--line,#303b49)}.mark{width:38px;height:38px;border-radius:10px;background:var(--surface-soft,#202936);color:var(--cyan,#68e8ff);display:grid;place-items:center;font-size:13px;font-weight:800}.item-content{min-width:0;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.item strong{font-weight:650}.amount{font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.costs{margin:20px 0 0;display:grid;gap:10px}.cost{display:flex;align-items:baseline;justify-content:space-between;gap:16px}.cost dt{color:var(--muted,#a5b1c0);font-size:12px}.cost dd{margin:0;text-align:right;max-width:65%;font-size:12px}.cost.total dt,.cost.total dd{color:var(--text,#f4f5ef);font-size:15px;font-weight:700}
.notice{padding:12px 14px;background:var(--surface-raised,#171e27);border-left:2px solid var(--cyan,#68e8ff);border-radius:0 7px 7px 0;font-size:12px}.notice.error{border-color:var(--warning,#ffc65a)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}button,a,input{font:inherit}button{min-height:46px;flex:1;padding:11px 16px;border-radius:9px;border:1px solid var(--line-strong,#536173);background:transparent;color:var(--text,#f4f5ef);font-size:12px;font-weight:750;cursor:pointer}button.primary{background:var(--acid,#d9ff43);color:#080b0f;border-color:transparent}button:disabled{opacity:.45;cursor:not-allowed}button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--focus,#fff);outline-offset:3px}
a{color:var(--cyan,#68e8ff);text-decoration:none;overflow-wrap:anywhere}a:hover{text-decoration:underline}.transaction{display:block;padding-top:14px;font-size:12px}.hash{display:block;margin-top:4px;font-family:ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere}
details{margin-top:18px;font-size:12px;color:var(--muted,#a5b1c0)}summary{cursor:pointer;padding:8px 0}.detail-row{margin:10px 0;overflow-wrap:anywhere}.detail-row span{display:block;color:var(--text,#f4f5ef);font-family:ui-monospace,monospace;font-size:11px;margin-top:3px}
label{display:block;margin-top:18px;color:var(--muted,#a5b1c0);font-size:12px}input{display:block;width:100%;min-width:0;margin-top:7px;min-height:46px;padding:10px 12px;background:var(--ink,#080b0f);border:1px solid var(--line-strong,#536173);border-radius:8px;color:var(--text,#f4f5ef);font-size:12px}.footer{padding:12px 24px;background:var(--surface-raised,#171e27);font-size:11px;color:var(--muted,#a5b1c0)}
@media(max-width:400px){.head{display:block}.badge{display:inline-block;margin-top:11px}.actions{flex-direction:column}.item-content .amount{flex-basis:100%;font-size:12px}.cost{gap:10px}.cost dd{max-width:60%}.cost.total{display:block}.cost.total dd{max-width:none;text-align:left;margin-top:5px;font-size:17px}.footer{padding:12px 18px}}
`;

// Owner-only UI seam. API/session, wallet provider, storage and reviewed release
// are injected. This module imports no transaction builder or production pins.
export function createMarketplacePurchasePanel({ container, api, getSelected, getOwner, getProvider,
  purchaseRelease, storage, authenticate, onSettled = () => {} }) {
  check(container?.attachShadow && typeof api === 'function' && typeof getSelected === 'function'
    && typeof getOwner === 'function', 'PURCHASE_PANEL_CONFIGURATION');
  const doc = container.ownerDocument, view = doc.defaultView, shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
  const node = (tag, text, className) => { const element = doc.createElement(tag); if (text != null) element.textContent = text;
    if (className) element.className = className; return element; };
  const style = node('style', CSS), mount = node('div'); shadow.replaceChildren(style, mount);
  let scopeKey = '', scope = null, generation = 0, busy = false, destroyed = false;
  let envelope = null, journal = null, errorText = '', storageBlocked = false, verificationFailed = false, recoveryDraft = '', expiryTimer;
  let explicitPreparation = false, authenticationRequired = false;
  const needsSession = error => ['V2_SESSION_REQUIRED', 'V2_SESSION_EXPIRED'].includes(error?.code);
  const volatileHashes = new Map(), notified = new Set();
  const released = () => purchaseRelease?.status === 'OWNER_ASSIST' && purchaseRelease.chainId === 4663;
  const selection = () => {
    const value = getSelected(), owner = getOwner()?.toLowerCase?.(), tokenId = String(value?.tokenId ?? '');
    if (!value || value.preview || value.chainId !== 4663 || !ADDRESS.test(owner ?? '') || owner === ZERO
      || !UINT.test(tokenId) || BigInt(tokenId) > 5016n) return null;
    return { owner, tokenId, chainId: 4663, preview: false,
      holdsSelectedPunk: !value.owner || value.owner.toLowerCase() === owner };
  };
  const keyFor = selected => selected ? `gogh-marketplace-purchase-v1:4663:${selected.owner}:${selected.tokenId}` : '';
  const recordKey = (key, intentId) => `${key}:intent:${intentId}`;
  const activeKey = key => `${key}:active`;
  function read(key) {
    check(storage?.getItem && storage?.setItem, 'PURCHASE_STORAGE_UNAVAILABLE');
    const raw = storage.getItem(key);
    if (raw === null) return null;
    check(typeof raw === 'string' && raw.length < 12_000, 'PURCHASE_STORAGE_UNAVAILABLE');
    try { return JSON.parse(raw); } catch { throw Error('PURCHASE_STORAGE_UNAVAILABLE'); }
  }
  function save(key, value) {
    try { const encoded = JSON.stringify(value); storage.setItem(key, encoded);
      check(storage.getItem(key) === encoded, 'PURCHASE_STORAGE_UNAVAILABLE'); }
    catch { throw Error('PURCHASE_STORAGE_UNAVAILABLE'); }
  }
  function record(selected, intentId) {
    const value = read(recordKey(keyFor(selected), intentId));
    check(value && value.schema === 1 && value.owner === selected.owner && value.punkId === selected.tokenId
      && value.chainId === 4663 && value.intentId === intentId && DIGEST.test(intentId)
      && typeof value.attempted === 'boolean' && (value.transactionHash === null || HASH.test(value.transactionHash))
      && ['DRAFT', 'DISCARDED', 'PREPARED', 'WALLET_REQUESTED', ...TERMINAL].includes(value.status), 'PURCHASE_STORAGE_UNAVAILABLE');
    if (value.input !== null) { check(UUID.test(value.requestId), 'PURCHASE_STORAGE_UNAVAILABLE'); inputFor(value.input); }
    else check(value.requestId === null, 'PURCHASE_STORAGE_UNAVAILABLE');
    return value;
  }
  function currentJournal(selected) {
    const active = read(activeKey(keyFor(selected)));
    if (active === null) return null;
    check(DIGEST.test(active.intentId ?? ''), 'PURCHASE_STORAGE_UNAVAILABLE');
    return record(selected, active.intentId);
  }
  function persist(selected, value) {
    save(recordKey(keyFor(selected), value.intentId), value);
    save(activeKey(keyFor(selected)), { intentId: value.intentId });
    if (keyFor(selected) === scopeKey) journal = value;
  }
  function sync() {
    const next = selection(), key = keyFor(next);
    if (key === scopeKey) return;
    ++generation; view.clearTimeout(expiryTimer); busy = false; scope = next; scopeKey = key;
    envelope = null; journal = null; errorText = ''; storageBlocked = false; verificationFailed = false; recoveryDraft = ''; explicitPreparation = false; authenticationRequired = false;
    if (next) try { journal = currentJournal(next); }
    catch { storageBlocked = true; errorText = 'Saved purchase details could not be read. Restore browser storage before continuing.'; }
  }
  const request = async (context, body = null, intentId = null) => {
    check(context.current(), 'PURCHASE_SELECTION_CHANGED');
    let payload;
    try {
      payload = await api(`/api/v2/punks/${context.selected.tokenId}/marketplace${intentId ? `?intentId=${intentId}` : ''}`,
        body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { method: 'GET' });
    } catch (error) {
      if (context.current() && needsSession(error)) authenticationRequired = true;
      throw error;
    }
    check(context.current(), 'PURCHASE_SELECTION_CHANGED');
    const validated = validateMarketplaceEnvelope(payload, context.selected);
    authenticationRequired = false; return validated;
  };
  function message(error) {
    if (error?.message === 'PURCHASE_STORAGE_UNAVAILABLE') { storageBlocked = true;
      return 'Browser storage could not save this purchase. Keep the original reference below and restore storage before continuing.'; }
    if (error?.message === 'PURCHASE_INPUT_INVALID') return 'Choose one to five exact ETH listings and enter whole wei amounts for your limits.';
    if (error?.message === 'PURCHASE_UNRESOLVED') return 'Check or cancel the original purchase before preparing another.';
    if (error?.message === 'PURCHASE_RELEASE_UNAVAILABLE') return 'Purchases are paused. Saved purchases can still be checked.';
    if (error?.message === 'PURCHASE_HASH_REQUIRED') return 'Enter the full original transaction hash from your wallet.';
    if (error?.message === 'PURCHASE_SIGN_IN_DECLINED') return 'Sign-in was declined. Your saved purchase is unchanged. Sign in when you are ready to check it.';
    if (error?.message === 'PURCHASE_SIGN_IN_UNAVAILABLE') return 'Sign-in could not be completed. Your saved purchase is unchanged. Try signing in again.';
    if (error?.code === 4001) return 'Wallet confirmation was declined. The original purchase remains reserved until its outcome is checked.';
    if (needsSession(error)) return 'Reconnect the original owner wallet and sign in to check this purchase.';
    return 'This purchase could not be verified. Check the saved original review before continuing.';
  }
  async function run(operation) {
    if (destroyed) return null;
    sync(); if (!scope || busy) return null;
    const selected = { ...scope }, key = scopeKey, ticket = ++generation;
    const current = () => !destroyed && ticket === generation && key === keyFor(selection());
    const context = { selected, key, current };
    busy = true; errorText = ''; render();
    try { const result = await operation(context); return current() ? result ?? envelope : null; }
    catch (error) { if (current()) { verificationFailed = true; errorText = message(error); } return null; }
    finally { if (current()) { busy = false; render(); } }
  }
  function verifyEntry(payload, expectedId = null, saved = null) {
    const entry = payload.entry;
    if (!entry) return;
    check(!expectedId || entry.intentId === expectedId);
    if (saved?.input) {
      const { selection: chosen, budget } = saved.input, review = entry.review;
      check(review.selection.collection === chosen.collection
        && sameInput(review.selection.items.map(item => item.orderHash).sort(), chosen.orderHashes)
        && BigInt(review.cost.totalPriceWei) <= BigInt(budget.maxTotalPriceWei)
        && BigInt(review.cost.maximumNetworkFeeWei) <= BigInt(budget.maxNetworkFeeWei)
        && review.cost.minimumReserveWei === budget.minimumReserveWei);
    }
    if (['COMPLETED', 'REVERTED'].includes(entry.status)) check(HASH.test(entry.reportedHash ?? '')
      && entry.receipt?.status === entry.status && entry.receipt.transactionHash === entry.reportedHash
      && uint(entry.receipt.confirmations) && BigInt(entry.receipt.confirmations) >= 12n);
    if (saved?.transactionHash && entry.reportedHash) check(saved.transactionHash === entry.reportedHash);
  }
  async function adopt(context, payload, expectedId = null) {
    let saved = expectedId ? record(context.selected, expectedId) : null;
    verifyEntry(payload, expectedId, saved); check(context.current(), 'PURCHASE_SELECTION_CHANGED');
    verificationFailed = false;
    envelope = payload;
    if (!payload.entry) return;
    const entry = payload.entry;
    if (!saved) {
      const existing = read(recordKey(context.key, entry.intentId));
      saved = existing ? record(context.selected, entry.intentId) : { schema: 1, owner: context.selected.owner,
        punkId: context.selected.tokenId, chainId: 4663, intentId: entry.intentId, requestId: null,
        input: null, attempted: false, transactionHash: null, status: entry.status };
      verifyEntry(payload, entry.intentId, saved);
    }
    persist(context.selected, { ...saved, status: entry.status,
      attempted: saved.attempted || entry.status === 'WALLET_REQUESTED' || ['COMPLETED', 'REVERTED'].includes(entry.status),
      transactionHash: entry.reportedHash ?? saved.transactionHash });
    if (TERMINAL.has(entry.status) && !notified.has(`${context.key}:${entry.intentId}:${entry.status}`)) {
      notified.add(`${context.key}:${entry.intentId}:${entry.status}`);
      await onSettled({ owner: context.selected.owner, punkId: context.selected.tokenId, chainId: 4663, entry: structuredClone(entry) });
      check(context.current(), 'PURCHASE_SELECTION_CHANGED');
    }
  }
  const cas = (entry, operation) => ({ operation, intentId: entry.intentId, revision: entry.revision, reviewHash: entry.reviewHash });
  async function load(context, { recover = true, retryPreparation = true } = {}) {
    const saved = currentJournal(context.selected); storageBlocked = false; journal = saved;
    // No public release means no idle work. A known paused release still reads
    // the scoped server journal, including on a device without local storage.
    if (purchaseRelease == null && !saved) { envelope = null; return; }
    let payload = await request(context, null, saved?.intentId);
    verifyEntry(payload, saved?.intentId, saved);
    if (retryPreparation && !payload.entry && saved?.status === 'DRAFT' && saved.input && released()) {
      payload = await request(context, { operation: 'prepare', input: { requestId: saved.requestId, action: 'BUY_LISTINGS', ...saved.input } });
    }
    await adopt(context, payload, saved?.intentId);
    if (!context.current()) return;
    const entry = payload.entry, originalHash = entry?.reportedHash ?? saved?.transactionHash ?? volatileHashes.get(recordKey(context.key, entry?.intentId));
    if (recover && entry?.status === 'WALLET_REQUESTED' && originalHash) {
      payload = await request(context, { ...cas(entry, 'recover'), transactionHash: originalHash });
      await adopt(context, payload, entry.intentId);
    }
  }
  const refresh = () => run(context => load(context));
  const signInToRecover = () => run(async context => {
    check(authenticationRequired && typeof authenticate === 'function');
    const originalIntentId = currentJournal(context.selected)?.intentId ?? null;
    try { await authenticate(); }
    catch (error) { throw Error(error?.code === 4001 ? 'PURCHASE_SIGN_IN_DECLINED' : 'PURCHASE_SIGN_IN_UNAVAILABLE'); }
    check(context.current(), 'PURCHASE_SELECTION_CHANGED');
    check((currentJournal(context.selected)?.intentId ?? null) === originalIntentId, 'PURCHASE_UNRESOLVED');
    // Signing in permits only lookup/recovery of the captured original scope.
    // It must never replay a missing draft preparation, claim or wallet send.
    await load(context, { retryPreparation: false });
  });
  const prepare = input => run(async context => {
    explicitPreparation = true; check(released(), 'PURCHASE_RELEASE_UNAVAILABLE');
    const normalized = inputFor(input), existing = currentJournal(context.selected);
    check(!storageBlocked, 'PURCHASE_STORAGE_UNAVAILABLE');
    check(context.selected.holdsSelectedPunk, 'PURCHASE_SELECTION_CHANGED');
    if (existing && !TERMINAL.has(existing.status) && existing.status !== 'DISCARDED') {
      check(existing.input && sameInput(existing.input, normalized), 'PURCHASE_UNRESOLVED');
      await load(context); return;
    }
    const requestId = view.crypto.randomUUID();
    const identity = JSON.stringify({ chainId: 4663, owner: context.selected.owner, punkId: context.selected.tokenId, requestId });
    const bytes = await view.crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    check(context.current(), 'PURCHASE_SELECTION_CHANGED');
    const intentId = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    const saved = { schema: 1, owner: context.selected.owner, punkId: context.selected.tokenId, chainId: 4663,
      requestId, intentId, input: normalized, attempted: false, transactionHash: null, status: 'DRAFT' };
    persist(context.selected, saved);
    const payload = await request(context, { operation: 'prepare', input: { requestId, action: 'BUY_LISTINGS', ...normalized } });
    await adopt(context, payload, intentId);
  });
  const cancel = () => run(async context => {
    const entry = envelope?.entry; check(entry?.status === 'PREPARED');
    const payload = await request(context, cas(entry, 'cancel')); await adopt(context, payload, entry.intentId);
  });
  const discard = () => run(async context => {
    const saved = currentJournal(context.selected);
    check(saved?.status === 'DRAFT' && !saved.attempted && !saved.transactionHash, 'PURCHASE_UNRESOLVED');
    const payload = await request(context, null, saved.intentId);
    // A late prepare response belongs to the original request. Expose its real
    // server state instead of abandoning a request that has been registered.
    if (payload.entry) { await adopt(context, payload, saved.intentId); return; }
    check(payload.entry === null);
    const latest = currentJournal(context.selected);
    check(latest?.intentId === saved.intentId && latest.status === 'DRAFT' && !latest.attempted && !latest.transactionHash, 'PURCHASE_UNRESOLVED');
    persist(context.selected, { ...latest, status: 'DISCARDED' });
    envelope = payload; verificationFailed = false;
  });
  const recover = () => run(async context => {
    const entry = envelope?.entry; check(entry?.status === 'WALLET_REQUESTED');
    const original = entry.reportedHash ?? journal?.transactionHash ?? volatileHashes.get(recordKey(context.key, entry.intentId));
    const candidate = original ?? recoveryDraft.trim().toLowerCase(); check(HASH.test(candidate ?? ''), 'PURCHASE_HASH_REQUIRED');
    const payload = await request(context, { ...cas(entry, 'recover'), transactionHash: candidate });
    // A manually supplied hash remains a hint until the server verifies/binds it.
    await adopt(context, payload, entry.intentId);
  });
  const confirm = () => run(async context => {
    check(!storageBlocked && !verificationFailed && journal?.input && !journal.attempted && context.selected.holdsSelectedPunk, 'PURCHASE_UNRESOLVED');
    const original = structuredClone(envelope), intentId = original.entry.intentId;
    verifyEntry(original, intentId, record(context.selected, intentId));
    const provider = await getProvider(); check(context.current() && selection()?.holdsSelectedPunk, 'PURCHASE_SELECTION_CHANGED');
    try {
      await submitMarketplacePurchase({ envelope: original, selected: context.selected, provider, purchaseRelease,
        isCurrent: () => context.current() && selection()?.holdsSelectedPunk,
        claim: async entry => {
          const claimed = await request(context, cas(entry, 'claim')); verifyEntry(claimed, intentId, record(context.selected, intentId));
          return claimed;
        },
        persistAttempt: async id => {
          check(context.current(), 'PURCHASE_SELECTION_CHANGED'); const saved = record(context.selected, id);
          check(!saved.attempted, 'PURCHASE_UNRESOLVED'); persist(context.selected, { ...saved, attempted: true });
        },
        persistHash: async (id, transactionHash) => {
          // A sent hash belongs to the captured original scope even after a UI transfer.
          volatileHashes.set(recordKey(context.key, id), transactionHash);
          const saved = record(context.selected, id);
          check(!saved.transactionHash || saved.transactionHash === transactionHash);
          persist(context.selected, { ...saved, attempted: true, transactionHash });
        } });
      if (context.current()) await load(context);
    } catch (error) {
      if (context.current()) {
        try {
          await load(context, { recover: false });
          if (error?.code === 4001 && envelope?.entry?.status === 'WALLET_REQUESTED' && !envelope.entry.reportedHash) {
            const payload = await request(context, cas(envelope.entry, 'decline')); await adopt(context, payload, envelope.entry.intentId);
          }
        } catch { /* The persisted attempt remains reserved when recovery is unavailable. */ }
      }
      throw error;
    }
  });

  function render() {
    view.clearTimeout(expiryTimer); mount.replaceChildren();
    const entry = envelope?.entry, show = !destroyed && scope && (entry || journal || errorText && (purchaseRelease != null || explicitPreparation));
    container.hidden = !show; if (!show) return;
    const status = entry?.status ?? (journal?.status === 'DISCARDED' ? 'DISCARDED' : 'DRAFT');
    const done = TERMINAL.has(status) || status === 'DISCARDED', uncertain = journal?.attempted || status === 'WALLET_REQUESTED';
    const card = node('section', null, 'card'); card.setAttribute('aria-label', 'Selected NFT purchase');
    const body = node('div', null, 'body'), head = node('div', null, 'head'), heading = node('div');
    heading.append(node('p', `Punk #${scope.tokenId} · selected purchase`, 'eyebrow'));
    const titles = { DRAFT: 'Your purchase is saved', DISCARDED: 'Unsent request discarded', PREPARED: uncertain ? 'Check the original purchase' : 'Review your purchase',
      WALLET_REQUESTED: 'Track your purchase', COMPLETED: 'Purchase complete', REVERTED: 'Purchase reverted', CANCELLED: 'Review cancelled' };
    heading.append(node('h2', !entry && !journal ? 'Check your purchases' : titles[status]));
    const badge = node('span', busy ? 'Checking' : !entry && !journal ? 'Unavailable' : ({ DRAFT: 'Saved', DISCARDED: 'Discarded', PREPARED: uncertain ? 'Recovery' : 'Owner review',
      WALLET_REQUESTED: 'Pending', COMPLETED: 'Confirmed', REVERTED: 'Reverted', CANCELLED: 'Cancelled' })[status],
    `badge${status === 'COMPLETED' ? ' done' : uncertain || status === 'REVERTED' ? ' warning' : ''}`);
    head.append(heading, badge); body.append(head);
    const review = entry?.review;
    if (review) {
      const identity = node('div', null, 'identity'); identity.append(node('span', `${review.selection.items.length} NFT${review.selection.items.length === 1 ? '' : 's'} · Robinhood`),
        node('span', `Collection ${short(review.selection.collection)}`)); body.append(identity);
      const items = node('ul', null, 'items');
      review.selection.items.forEach((item, index) => { const row = node('li', null, 'item'), content = node('div', null, 'item-content');
        content.append(node('strong', `Token #${item.tokenId}`), node('span', eth(item.totalWei), 'amount'));
        row.append(node('span', String(index + 1).padStart(2, '0'), 'mark'), content); items.append(row); }); body.append(items);
      const costs = node('dl', null, 'costs');
      const cost = (label, value, total = false) => { const row = node('div', null, `cost${total ? ' total' : ''}`);
        row.append(node('dt', label), node('dd', eth(value), 'amount')); costs.append(row); };
      cost(status === 'COMPLETED' ? 'Purchase total' : 'Selected price', review.cost.totalPriceWei, true);
      if (!done) {
        if (journal?.input) cost('Your purchase limit', journal.input.budget.maxTotalPriceWei);
        cost('Network fee · maximum', review.cost.maximumNetworkFeeWei);
        cost('Punk reserve · minimum', review.cost.minimumReserveWei);
      }
      body.append(costs);
      if (status === 'COMPLETED') body.append(node('p', 'Receipt verified. The selected NFTs were delivered to this Punk’s Agent Wallet.', 'muted'));
      else if (status === 'REVERTED') body.append(node('p', 'The purchase did not complete. A network fee may have been paid.', 'muted'));
      else if (status === 'CANCELLED') body.append(node('p', 'The unsent review was cancelled.', 'muted'));
      else body.append(node('p', uncertain ? 'Check the original transaction. This review will not open another wallet request.'
        : 'The Punk Wallet pays the NFT price. Your connected owner wallet pays the network fee.', 'notice'));
      const originalHash = entry.reportedHash ?? journal?.transactionHash ?? volatileHashes.get(recordKey(scopeKey, entry.intentId));
      if (originalHash) { const link = node('a', done ? 'View original transaction ↗' : 'Track original transaction ↗', 'transaction');
        link.href = `https://robinhoodchain.blockscout.com/tx/${originalHash}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.append(node('span', originalHash, 'hash')); body.append(link); }
      const details = node('details'); details.append(node('summary', 'Purchase details'));
      for (const [label, value] of [['Collection contract', review.selection.collection], ['Receiving Agent Wallet', review.wallet],
        ['Original owner', review.owner], ['Saved purchase reference', entry.intentId]]) {
        const row = node('p', label, 'detail-row'); row.append(node('span', value)); details.append(row);
      }
      for (const item of review.selection.items) { const row = node('p', `Token #${item.tokenId} · selected order`, 'detail-row');
        row.append(node('span', item.orderHash)); details.append(row); }
      body.append(details);
      if (!done && !originalHash && status === 'WALLET_REQUESTED') {
        const label = node('label', 'Original transaction hash from your wallet'), input = node('input');
        input.type = 'text'; input.placeholder = '0x…'; input.maxLength = 66; input.spellcheck = false;
        input.autocomplete = 'off'; input.value = recoveryDraft; input.setAttribute('aria-label', 'Original transaction hash');
        input.addEventListener('input', () => { recoveryDraft = input.value; }); label.append(input); body.append(label);
      }
    } else {
      body.append(node('p', status === 'DISCARDED' ? 'The unsent request was discarded. You can select new listings.'
        : journal ? 'The preparation response is unresolved. Check this saved request to continue with the same purchase.'
        : 'Check your original purchase to continue.', 'muted'));
      if (journal) body.append(node('p', journal.intentId, 'hash'));
    }
    if (errorText) { const error = node('p', errorText, 'notice error'); error.setAttribute('role', 'alert'); body.append(error); }
    const actions = node('div', null, 'actions');
    const button = (label, action, disabled = false, primary = false) => { const control = node('button', label, primary ? 'primary' : '');
      control.type = 'button'; control.disabled = busy || disabled; control.addEventListener('click', () => { void action(); }); actions.append(control); };
    if (authenticationRequired && typeof authenticate === 'function') button('Sign in to recover', signInToRecover, storageBlocked, true);
    if (!done) {
      if (entry?.status === 'PREPARED' && !uncertain) {
        const released = purchaseRelease?.status === 'OWNER_ASSIST' && purchaseRelease.chainId === 4663
          && purchaseRelease.purchaseGuardDeployment?.address === review.purchaseGuard.address
          && purchaseRelease.purchaseGuardDeployment.codeHash === review.purchaseGuard.codeHash;
        const expired = Date.now() + 5_000 >= review.expiresAt;
        if (!released || envelope.availability !== 'OWNER_REVIEW_READY' || envelope.blockers.length) body.append(node('p', 'Purchases are paused. This saved review can still be checked or cancelled.', 'notice'));
        else if (!journal?.input) body.append(node('p', 'Use the device that prepared this review, or cancel it before choosing new listings.', 'notice'));
        if (expired) body.append(node('p', 'This review expired. Cancel it before preparing a fresh purchase.', 'notice'));
        button('Confirm in wallet', confirm, !released || expired || !journal?.input || storageBlocked || verificationFailed
          || !selection()?.holdsSelectedPunk || envelope.availability !== 'OWNER_REVIEW_READY' || envelope.blockers.length > 0, true);
        button('Cancel review', cancel, storageBlocked || authenticationRequired);
        if (!expired) expiryTimer = view.setTimeout(render, Math.max(1, review.expiresAt - Date.now() - 5_000));
      } else if (entry?.status === 'WALLET_REQUESTED') {
        button('Check original transaction', recover, storageBlocked || authenticationRequired, true);
      } else if (entry?.status === 'PREPARED' && uncertain) {
        button('Cancel unclaimed review', cancel, storageBlocked || authenticationRequired);
      } else if (!entry && journal?.status === 'DRAFT' && !journal.attempted && !journal.transactionHash) {
        button('Discard unsent request', discard, storageBlocked || authenticationRequired);
      }
      button(busy ? 'Checking…' : 'Refresh status', refresh);
    }
    if (actions.childNodes.length) body.append(actions);
    card.append(body);
    if (!done) card.append(node('div', 'Exact selected listings · No collection floor claim', 'footer'));
    mount.append(card);
  }
  function clear() { ++generation; view.clearTimeout(expiryTimer); busy = false; envelope = null; journal = null;
    scope = null; scopeKey = ''; errorText = ''; recoveryDraft = ''; explicitPreparation = false; authenticationRequired = false; container.hidden = true; mount.replaceChildren(); }
  sync(); render();
  return Object.freeze({ refresh, prepare, clear, destroy() { clear(); destroyed = true; shadow.replaceChildren(); } });
}
