import { PAID_TRAINING_RELEASE } from './forge-paid-release.js';
import { createPaidTrainingWallet, paidReleaseAvailable, paidReleaseRecoverable, paidPurchaseUseful, paidReviewIdentity, PAID_ZERO_KEY,
  validatePaidReview, validatePaidSnapshot } from './forge-paid-wallet.js';
import { forgeResearchAction, forgeResearchNeedsSample } from './forge-research-actions.js';
import { renderPlannedResearchResult } from './forge-research-result.js';

const HASH = /^0x[0-9a-f]{64}$/;
const TERMINAL = new Set(['CONFIRMED_SUCCESS', 'CONFIRMED_REVERT', 'EXPIRED_UNUSED']);
const RECEIPTS = new Set(['PENDING', 'INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'CONFIRMED_SUCCESS', 'CONFIRMED_REVERT']);
const eth = value => { const n = BigInt(value), fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${n / 10n ** 18n}${fraction ? `.${fraction}` : ''} ETH`; };
const action = (operation, skillKey = PAID_ZERO_KEY, slot = 0) => ({ operation, skillKey, slot });
const STATUS = {
  PENDING: 'Receipt not yet verified. Keep the saved request and recheck its original hash.',
  INCLUDED_SUCCESS: 'The transaction was included successfully. Waiting for both providers to verify finality.',
  INCLUDED_REVERT: 'The transaction reverted. Waiting for both providers to verify finality; it will not be resent.',
  CONFIRMED_SUCCESS: 'The transaction is confirmed. Recheck balances and loadout before reviewing the next step.',
  CONFIRMED_REVERT: 'The reverted transaction is confirmed. No training change was applied; the network fee may have been spent.',
  EXPIRED_UNUSED: 'Both providers verified that the finalized chain passed this review’s deadline and its contract and wallet nonces remain unused. Close it and recheck before a new review.',
};

export function createPaidTrainingPanel({ root, getSelection, ensureSession, request, release = PAID_TRAINING_RELEASE,
  getProvider = () => window.__GOGH_WALLET_PROVIDER__, storage, locks, now = Date.now }) {
  if (!root) return null;
  // Browser privacy settings can throw on the property access itself.
  if (storage === undefined) try { storage = globalThis.localStorage; } catch { storage = null; }
  if (locks === undefined) try { locks = globalThis.navigator?.locks; } catch { locks = null; }
  const document = root.ownerDocument;
  root.style.overflowWrap = 'anywhere';
  const element = (tag, text) => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
    if (['input', 'select'].includes(tag)) Object.assign(node.style, { maxWidth: '100%', minWidth: '0', minHeight: '44px',
      padding: '10px', background: '#080d12', color: '#fff', border: '1px solid var(--line)', font: 'inherit' });
    if (tag === 'label') Object.assign(node.style, { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' });
    return node;
  };
  let key = '', sequence = 0, busy = false, state = null, journal = null, unreadable = false, message = '', timer, researchResult = null;
  const identity = () => { const s = getSelection(); return s ? `${s.owner?.toLowerCase()}:${s.tokenId}:${s.chainId}:${s.preview}` : ''; };
  const available = () => paidReleaseAvailable(release, getSelection());
  const recoverable = () => paidReleaseRecoverable(release, getSelection());
  const storageKey = selected => `gogh-paid-training-v1:4663:${release.extension}:${selected.owner.toLowerCase()}:${selected.tokenId}`;
  const api = (selected, body) => request(`/api/v2/punks/${selected.tokenId}/forge/paid-training`, body ? {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), timeoutMs: 45000,
  } : {});
  function assertSaved(selected, expected) {
    const saved = readSaved(selected);
    if (paidReviewIdentity(saved) !== paidReviewIdentity(expected)) {
      if (identity() === `${selected.owner?.toLowerCase()}:${selected.tokenId}:${selected.chainId}:${selected.preview}`) { journal = saved; state = null; }
      throw Error('The saved request changed in another tab. Recheck or recover it before continuing.');
    }
    return saved;
  }
  function persist(value, selected, lease) {
    if (!lease) throw Error('Paid training needs a protected browser session before saving a request.');
    assertSaved(selected, lease.expected);
    const name = storageKey(selected), encoded = JSON.stringify(value);
    storage.setItem(name, encoded); if (storage.getItem(name) !== encoded) throw Error('Save the pending paid training review before continuing.');
    lease.expected = structuredClone(value);
    if (identity() === `${selected.owner?.toLowerCase()}:${selected.tokenId}:${selected.chainId}:${selected.preview}`) journal = value;
  }
  function readSaved(selected) {
    if (!storage?.getItem || !storage?.setItem || !storage?.removeItem)
      throw Error('Browser storage is unavailable. Allow site storage and reload before paid training. No new wallet request was made.');
    const raw = storage.getItem(storageKey(selected)); if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.schema !== 1 || typeof saved.attempted !== 'boolean' || saved.transactionHash !== null && !HASH.test(saved.transactionHash)
      || typeof saved.maximumNetworkFeeWei !== 'string' || saved.status !== null && !RECEIPTS.has(saved.status) && !TERMINAL.has(saved.status)) throw Error('Saved paid training review is unreadable.');
    validatePaidReview(saved.review, selected, release, { maximumNetworkFeeWei: saved.maximumNetworkFeeWei, recovery: true, now: now() });
    return saved;
  }
  function selectionChanged() {
    const next = identity(); if (next === key) return; key = next; sequence++; busy = false; state = null; journal = null; unreadable = false; message = ''; researchResult = null;
    if (recoverable()) try { journal = readSaved(getSelection()); }
    catch { unreadable = true; message = 'Browser storage or the saved paid training review is unavailable. Allow site storage and reload; preserve wallet history and reconcile any earlier request before another purchase.'; }
    render();
  }
  async function work(fn) {
    if (busy || !recoverable() || unreadable || key !== identity()) return;
    const selected = { ...getSelection() }, original = key, ticket = ++sequence;
    const current = () => original === key && original === identity() && ticket === sequence;
    busy = true; render();
    try { await fn(selected, current); }
    catch (error) { if (current()) message = Number(error?.code) === 4001
      ? 'Wallet confirmation was rejected. The saved attempt remains held. Recover its original hash or check the expired request for finalized proof that it was unused.'
      : error?.message ?? 'Paid training could not be verified. Recover the saved request.'; }
    finally { if (current()) { busy = false; render(); } }
  }
  function journalWork(fn) {
    const expected = structuredClone(journal);
    return work(async (selected, current) => {
      if (typeof locks?.request !== 'function') throw Error('Paid training needs browser tab protection. Use a current browser on the secure site and reload. No wallet request was made.');
      const name = `gogh-paid-training:4663:${selected.owner.toLowerCase()}:${BigInt(selected.tokenId)}`;
      // Hold one owner/Punk lock through the wallet response, not just the storage write.
      // A queued click must still refer to the exact review displayed when it was clicked.
      await locks.request(name, { mode: 'exclusive' }, async () => {
        if (!current()) return;
        assertSaved(selected, expected);
        await fn(selected, current, { expected });
      });
    });
  }
  async function refresh(selected, current) {
    researchResult = null;
    try { const payload = await api(selected); if (!current()) return;
      if (payload?.release?.status !== 'OWNER_CANARY') { state = null; throw Error('Paid training is being prepared or paused. No new wallet request is available.'); }
      state = validatePaidSnapshot(payload, selected, release, now());
    } catch (error) { if (current()) state = null; throw error; }
  }
  const check = () => work(async (selected, current) => {
    await ensureSession(); if (!current()) return; await refresh(selected, current);
    if (current()) message = journal?.attempted ? 'A saved wallet attempt needs recovery. It will not open another wallet request.'
      : 'Balances and current owner verified. Each action needs its own review and wallet confirmation.';
  });
  const prepare = intended => journalWork(async (selected, current, lease) => {
    if (!available() || journal || !state) throw Error('Reconcile the saved review and recheck balances before another action.');
    await ensureSession(); if (!current()) return; await refresh(selected, current); if (!current()) return;
    const envelope = await api(selected, { operation: 'prepare', action: intended }); if (!current()) return;
    if (envelope?.ok !== true || typeof envelope.maximumNetworkFeeWei !== 'string') throw Error('Paid training preparation could not be verified.');
    validatePaidReview(envelope.review, selected, release, { state, action: intended, maximumNetworkFeeWei: envelope.maximumNetworkFeeWei, now: now() });
    persist({ schema: 1, review: envelope.review, maximumNetworkFeeWei: envelope.maximumNetworkFeeWei,
      attempted: false, transactionHash: null, status: null }, selected, lease);
    message = 'Review this exact action, payment and maximum network fee before opening your wallet.';
  });
  const confirm = () => journalWork(async (selected, current, lease) => {
    if (!available() || !journal || journal.attempted || !state) throw Error('Recheck or recover the saved review before continuing.');
    const saved = structuredClone(journal);
    await ensureSession(); if (!current()) return;
    const wallet = createPaidTrainingWallet({ getProvider, release, isCurrent: current, now,
      onProgress: value => { if (current()) { message = `${value}…`; render(); } },
      readCurrent: () => api(selected), verify: review => api(selected, { operation: 'verify', review }),
      wasAttempted: () => assertSaved(selected, lease.expected)?.attempted !== false,
      markAttempted: review => { if (!current() || paidReviewIdentity(review) !== paidReviewIdentity(saved.review)) throw Error('Selection changed.');
        persist({ ...saved, attempted: true }, selected, lease); },
    });
    const submitted = await wallet.submit({ review: saved.review, maximumNetworkFeeWei: saved.maximumNetworkFeeWei }, selected, saved.review.action);
    persist({ ...saved, attempted: true, transactionHash: submitted.transactionHash }, selected, lease);
    if (current()) { state = null; message = 'Wallet returned a transaction hash. Recheck its receipt; this review will not be sent again.'; }
  });
  const renew = () => journalWork(async (selected, current, lease) => {
    const saved = readSaved(selected);
    if (!available() || !saved || saved.attempted) throw Error('Recover the existing wallet request. Only unsent reviews can be refreshed.');
    await ensureSession(); if (!current()) return;
    await refresh(selected, current); if (!current()) return;
    const envelope = await api(selected, { operation: 'prepare', action: saved.review.action });
    if (!current()) return;
    if (envelope?.ok !== true || typeof envelope.maximumNetworkFeeWei !== 'string') throw Error('Paid training preparation could not be verified.');
    validatePaidReview(envelope.review, selected, release, { state, action: saved.review.action,
      maximumNetworkFeeWei: envelope.maximumNetworkFeeWei, now: now() });
    // Another tab may have opened the old request while the new review loaded.
    const latest = readSaved(selected);
    if (!latest || latest.attempted || paidReviewIdentity(latest) !== paidReviewIdentity(saved)) {
      journal = latest;
      throw Error('The saved request changed. Recover it before preparing another.');
    }
    persist({ ...saved, review: envelope.review, maximumNetworkFeeWei: envelope.maximumNetworkFeeWei }, selected, lease);
    message = 'Review refreshed. Check the payment and new maximum fee, then confirm in your wallet. Nothing was sent.';
  });
  const recover = value => journalWork(async (selected, current, lease) => {
    if (!journal?.attempted || !HASH.test(value)) throw Error('Enter the original transaction hash from wallet activity.');
    const saved = structuredClone(journal); validatePaidReview(saved.review, selected, release, { recovery: true, now: now() });
    await ensureSession(); if (!current()) return;
    const response = await api(selected, { operation: 'recover', review: saved.review, transactionHash: value }); if (!current()) return;
    if (response?.ok !== true || !RECEIPTS.has(response.status) || response.transactionHash !== value
      || paidReviewIdentity(response.review) !== paidReviewIdentity(saved.review)) throw Error('The receipt does not match the saved transaction.');
    persist({ ...saved, transactionHash: value, status: response.status }, selected, lease); state = null; message = STATUS[response.status];
  });
  const abandon = () => journalWork(async (selected, current, lease) => {
    if (!journal?.attempted || journal.transactionHash) throw Error('Recover the saved transaction hash.');
    const saved = structuredClone(journal); await ensureSession(); if (!current()) return;
    const response = await api(selected, { operation: 'abandon', review: saved.review }); if (!current()) return;
    if (response?.ok !== true || response.status !== 'EXPIRED_UNUSED' || paidReviewIdentity(response.review) !== paidReviewIdentity(saved.review))
      throw Error('The expired request was not proven unused. Keep the saved attempt and recheck.');
    persist({ ...saved, status: 'EXPIRED_UNUSED' }, selected, lease); state = null; message = STATUS.EXPIRED_UNUSED;
  });
  const discard = () => journalWork(async (selected, current, lease) => {
    const saved = readSaved(selected);
    if (!saved || saved.attempted && !TERMINAL.has(saved.status))
      throw Error('Keep the saved attempt until its receipt is confirmed or the finalized chain proves it expired unused.');
    assertSaved(selected, lease.expected);
    storage.removeItem(storageKey(selected)); if (storage.getItem(storageKey(selected)) !== null) throw Error('The saved review could not be cleared.');
    journal = null; state = null; message = 'Saved review closed. Recheck balances before preparing another action.';
  });
  const research = skillKey => work(async (selected, current) => {
    const name = forgeResearchAction(skillKey), skill = state?.skills.find(s => s.key === skillKey);
    if (!state?.activated || !skill?.available || !skill.level || !state.equipped.includes(skillKey) || !name) throw Error('Recheck the active equipped skill first.');
    researchResult = null; await ensureSession(); if (!current()) return;
    const sampleTokenIds = forgeResearchNeedsSample(name) ? [String(selected.tokenId),
      document.querySelector('[data-forge-sample-two]')?.value.trim(), document.querySelector('[data-forge-sample-three]')?.value.trim()] : undefined;
    const result = await request(`/api/v2/punks/${selected.tokenId}/forge/skill`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: name, skillKey, ...(sampleTokenIds ? { sampleTokenIds } : {}) }), timeoutMs: 45000 });
    if (!current()) return;
    if (result?.ok !== true || result.mode !== 'EQUIPPED_RESEARCH' || result.owner !== selected.owner.toLowerCase()
      || result.tokenId !== String(selected.tokenId) || result.skillKey !== skillKey || result.action !== name
      || result.chainId !== 4663 || result.walletAuthority !== 'NONE' || result.canBurn !== false) throw Error('Equipped research could not be verified.');
    researchResult = result; message = 'Research finished using the active equipped skill. No credit or wallet transaction was requested.';
  });
  function button(parent, text, run, disabled = false) {
    const node = element('button', text), rendered = key; node.type = 'button'; node.className = 'filter-button'; node.disabled = busy || disabled;
    node.style.maxWidth = '100%'; node.style.whiteSpace = 'normal'; node.style.overflowWrap = 'anywhere';
    node.addEventListener('click', () => { if (rendered !== identity()) { selectionChanged(); return; } if (!node.disabled) void run(); });
    parent.append(node); return node;
  }
  function render() {
    clearTimeout(timer); root.replaceChildren(); root.setAttribute('aria-busy', String(busy));
    root.append(element('h3', 'OPTIONAL PAID TRAINING'), element('p', 'One purchased Training Credit costs 0.0005 ETH, plus the network fee. The existing burn route remains separate.'));
    if (release.status === 'UNDEPLOYED') {
      root.append(element('p', 'Paid Training Credits are being prepared. Purchases and wallet confirmations are not available yet.')); return;
    }
    if (!recoverable()) { root.append(element('p', 'Paid training is not released for this selection. Connect an approved owner on Robinhood Chain and select their Punk.')); return; }
    const note = element('p', message || 'Check the current owner and balances. No wallet transaction is requested by this check.');
    note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite'); root.append(note);
    if (unreadable) return;
    button(root, 'RECHECK PAID TRAINING', check);
    if (journal) {
      const review = journal.review, operation = review.action.operation, skill = release.skills.find(s => s.key === review.action.skillKey);
      root.append(element('h4', `${operation.toUpperCase()}${skill ? ` · ${skill.name}` : ''}`), element('p', `Punk #${review.tokenId}${['equip', 'unequip'].includes(operation) ? ` · Slot ${review.action.slot + 1}` : ''}`),
        element('p', `Payment: ${operation === 'buy' ? '0.0005 ETH for exactly one purchased credit' : '0 ETH'}. Maximum network fee: ${eth(journal.maximumNetworkFeeWei)}.`));
      if (operation === 'buy') root.append(element('p', 'A successful purchase has no refund function. It buys one credit only; it does not learn or equip a skill and grants no spending or automation permission.'),
        element('p', `Payment goes through the reviewed contract to treasury ${release.treasury}.`));
      if (operation === 'activate') root.append(element('p', 'Setup keeps the Punk’s currently equipped skills. After setup, change equipment here; the previous training panel no longer controls the active loadout. Burn-earned credits remain usable in the burn training panel. This is an explicit, permanent choice for this Punk.'));
      if (['learn', 'unlock'].includes(operation)) root.append(element('p', 'Cost: 1 purchased credit. Burn-earned credits are not spent by this action.'));
      const deadline = Number(review.guard.deadline) * 1000;
      if (!journal.attempted) {
        root.append(element('p', deadline <= now() + 5000
          ? 'Review expired. No wallet request was made. Refresh the unsent review to continue.'
          : `Review expires ${new Date(deadline).toLocaleTimeString()}. Confirm promptly after reviewing; refresh it if you need more time.`));
        if (available() && state) button(root, 'CONFIRM PAID TRAINING IN WALLET', confirm, deadline <= now() + 5000);
        if (available()) button(root, 'REFRESH UNSENT REVIEW', renew);
        button(root, 'DISCARD UNSENT REVIEW', discard);
        if (deadline > now() + 5000) timer = setTimeout(render, Math.min(deadline - now() - 5000, 60000));
      } else {
        root.append(element('p', journal.status ? STATUS[journal.status] : 'A wallet request may have been submitted. Recover its original hash; never repeat the payment.'));
        if (!TERMINAL.has(journal.status)) {
          const label = element('label', 'Original transaction hash from wallet activity'), input = element('input');
          input.type = 'text'; input.maxLength = 66; input.placeholder = '0x…'; input.value = journal.transactionHash ?? '';
          input.style.width = '100%'; input.style.minHeight = '44px'; input.style.boxSizing = 'border-box'; label.append(input); root.append(label);
          button(root, 'RECOVER PAID TRAINING TRANSACTION', () => recover(input.value.trim().toLowerCase()));
          if (!journal.transactionHash) button(root, 'CHECK EXPIRED REQUEST', abandon);
        } else button(root, 'CLOSE CONFIRMED REVIEW', discard);
      }
      return;
    }
    if (!available()) { root.append(element('p', 'New paid training actions are paused. Recovery of saved transactions remains available.')); return; }
    if (!state) return;
    root.append(element('p', `Purchased credits: ${state.purchasedCredits}. Burn-earned credits: ${state.burnCredits}. These are separate balances and cannot be combined.`),
      element('p', state.activated ? `Active loadout · ${state.unlockedSlots} unlocked slot(s). Use this panel to change its equipment.`
        : 'Your existing loadout remains active. Buying a credit does not change it.'));
    button(root, 'REVIEW BUY 1 CREDIT · 0.0005 ETH', () => prepare(action('buy')), !paidPurchaseUseful(state));
    if (state.purchasesPaused) root.append(element('p', 'Credit purchases are paused.'));
    if (state.burnApprovalActive) root.append(element('p', 'This Punk is approved for sacrifice. Revoke its burn approval before buying credits for it.'));
    if (!state.activated) {
      root.append(element('p', 'Before using purchased credits for skills or slots, review paid training setup. Your existing equipped skills are kept; afterward, change equipment here. Burn-earned credits remain usable in the burn training panel.'));
      button(root, 'REVIEW PAID TRAINING SETUP', () => prepare(action('activate'))); return;
    }
    button(root, 'REVIEW UNLOCK SLOT · 1 PURCHASED CREDIT', () => prepare(action('unlock')),
      state.legacyAllocationClaimed === 0 || state.unlockedSlots >= 7 || BigInt(state.purchasedCredits) < 1n);
    if (state.legacyAllocationClaimed === 0) root.append(element('p', 'Claim the existing rarity allocation before unlocking an extra slot.'));
    for (const skill of state.skills) {
      const row = element('article'); row.append(element('h4', skill.name));
      if (!skill.level) button(row, 'REVIEW LEARN · 1 PURCHASED CREDIT', () => prepare(action('learn', skill.key)), !skill.available || BigInt(state.purchasedCredits) < 1n);
      else {
        row.append(element('p', `Learned level ${skill.level}. Learning again will not spend a duplicate credit.`));
        const label = element('label', 'Equip in slot'), select = element('select');
        for (let slot = 0; slot < state.unlockedSlots; slot++) { const option = element('option', `Slot ${slot + 1}`); option.value = String(slot); select.append(option); }
        select.value = '0'; label.append(select); row.append(label);
        button(row, 'REVIEW EQUIP', () => prepare(action('equip', skill.key, Number(select.value))), !skill.available || state.equipped.includes(skill.key));
        if (skill.available && state.equipped.includes(skill.key) && forgeResearchAction(skill.key)) button(row, 'RUN EQUIPPED RESEARCH', () => research(skill.key));
      }
      root.append(row);
    }
    state.equipped.forEach((equipped, slot) => { if (equipped !== PAID_ZERO_KEY) button(root, `REVIEW UNEQUIP SLOT ${slot + 1}`, () => prepare(action('unequip', PAID_ZERO_KEY, slot))); });
    if (researchResult) {
      root.append(element('h4', 'EQUIPPED RESEARCH RESULT'));
      if (researchResult.action === 'rank_trait_sample') root.append(element('p', `${researchResult.result.sampleSize} Punks compared. Sample-only rarity does not change the frozen allocation.`));
      else root.append(renderPlannedResearchResult({ document, action: researchResult.action, result: researchResult.result }));
      const details = element('details'), evidence = element('pre', JSON.stringify(researchResult.result, null, 2));
      evidence.style.whiteSpace = 'pre-wrap'; evidence.style.overflowWrap = 'anywhere';
      details.append(element('summary', 'View research evidence'), evidence); root.append(details);
    }
  }
  selectionChanged(); render();
  return { selectionChanged, refresh: check, destroy() { sequence++; clearTimeout(timer); root.replaceChildren(); } };
}
