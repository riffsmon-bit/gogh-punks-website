import { submitHolderBurn } from './forge-holder-wallet.js';

const COPY = {
  HOLDER_HISTORY_INCOMPLETE: 'We are still checking this Punk’s wallet history. You can leave and continue later.',
  HOLDER_INVENTORY_UNKNOWN: 'Some token holdings could not be verified. Burning stays unavailable until the check succeeds.',
  HOLDER_ASSETS_PRESENT: 'This Punk has assets. Withdraw them from its wallet, then recheck.',
  HOLDER_AUTOMATION_ACTIVE: 'Pause this Punk and revoke its automated spending permission first.',
  HOLDER_TRANSACTION_PENDING: 'Wait for this Punk’s pending transaction to finish, then recheck.',
  HOLDER_OBLIGATIONS_UNRESOLVED: 'Resolve the activity listed below before sacrificing this Punk.',
  HOLDER_BURN_NOT_RELEASED: 'Public sacrifice is not available yet. Complete wallet history and protection while a burn is awaiting confirmation must be verified first.',
  HOLDER_CREDITS_UNKNOWN: 'Unused Training Credits could not be verified. Recheck before choosing this Punk.',
  HOLDER_CREDITS_REMAIN: 'This Punk has unused Training Credits. Use them before choosing it for sacrifice.',
  HOLDER_SOURCE_STALE: 'The check is too old. Recheck for a fresh result.',
};
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const stamp = s => JSON.stringify([s?.owner?.toLowerCase(), String(s?.tokenId), s?.chainId, s?.revision ?? null]);
const eth = wei => { const n = BigInt(wei), whole = n / 10n ** 18n, tail = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, ''); return `${whole}${tail ? `.${tail}` : ''} ETH`; };

// Parent calls refresh() whenever owner, Punk, chain or session changes; it also
// increments an internal generation so A→B→A changes cannot revive old callbacks.
// request(url,{method,body}) returns parsed JSON and never sends wallet actions.
export function createHolderBurnPanel({ root, getSelection, getOwnedPunks, ensureSession, request, getProvider, onConfirmed,
  release = null, storage = globalThis.localStorage }) {
  const document = root.ownerDocument;
  let generation = 0, sourceId = '', source = null, envelope = null, busy = false, message = '', disposed = false;
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
  const selection = () => ({ ...getSelection(), sourceTokenId: sourceId });
  const path = s => `/api/v2/punks/${s.tokenId}/forge/holder-burn`;
  const key = s => `gogh:holder-burn:4663:${s.owner.toLowerCase()}:${s.sourceTokenId}:${s.tokenId}`;
  const selectionKey = s => `gogh:holder-burn:last:4663:${s.owner.toLowerCase()}:${s.tokenId}`;
  const saved = s => { try { return JSON.parse(storage.getItem(key(s)) ?? 'null'); } catch { return null; } };
  const persist = (s, value) => { storage.setItem(key(s), JSON.stringify(value)); if (storage.getItem(key(s)) !== JSON.stringify(value)) throw Error('Save the recovery record before opening your wallet.'); };
  async function perform(action) {
    if (busy || disposed) return;
    const s = selection(), captured = generation, identity = stamp(s);
    const current = () => !disposed && generation === captured && stamp(selection()) === identity && sourceId === s.sourceTokenId;
    busy = true; message = ''; render();
    try {
      await ensureSession(); if (!current()) return;
      await action(s, current);
    } catch (error) { if (current()) message = error?.message ?? 'The check could not finish. Recheck; a saved wallet request will not be resent.'; }
    finally { if (current()) { busy = false; render(); } }
  }
  async function api(s, body, current) {
    const payload = await request(path(s), { method: 'POST', body: { ...body, sourceTokenId: s.sourceTokenId } });
    if (!current()) throw Error('The selected Punk changed.');
    if (payload?.ok !== true) throw Error(payload?.message ?? 'This action could not be verified. Recheck before continuing.');
    if (!same(payload.owner, s.owner) || payload.sourceTokenId !== s.sourceTokenId || payload.targetTokenId !== String(s.tokenId)) throw Error('The selected Punks changed.');
    return payload;
  }
  const button = (text, fn, disabled = false) => { const b = el('button', text); b.type = 'button'; b.disabled = busy || disabled; b.addEventListener('click', fn); return b; };
  function render() {
    root.replaceChildren(); if (disposed) return;
    const s = selection();
    root.classList.add('forge-holder-panel');
    root.append(el('h3', `Train Punk #${s.tokenId ?? '—'}`), el('p', 'Sacrifice one eligible Punk to earn one Training Credit for the selected Punk. Learning and equipping a skill are separate wallet actions.'));
    if (!s.owner || s.chainId !== 4663) { root.append(el('p', 'Connect your wallet on Robinhood Chain to see eligible Punks.')); return; }
    const label = el('label', 'Punk to sacrifice'), select = el('select'); select.setAttribute('aria-label', 'Punk to sacrifice');
    select.append(el('option', 'Choose another owned Punk')); select.options[0].value = '';
    for (const punk of getOwnedPunks()) {
      const id = String(typeof punk === 'object' ? punk.tokenId ?? punk.id : punk);
      if (id === String(s.tokenId)) continue;
      const option = el('option', `Punk #${id}`); option.value = id; select.append(option);
    }
    if (sourceId && ![...select.options].some(o => o.value === sourceId)) {
      const recovered = el('option', `Punk #${sourceId} · saved review`); recovered.value = sourceId; select.append(recovered);
    }
    select.value = sourceId; select.disabled = busy;
    select.addEventListener('change', () => { generation++; sourceId = select.value; source = null; envelope = null; message = ''; busy = false;
      try { storage.setItem(selectionKey(s), sourceId); } catch { message = 'Your selection could not be saved. Wallet actions require recovery storage.'; } render(); });
    label.append(select); root.append(label);
    if (!sourceId) { root.append(el('p', 'The Punk you sacrifice is permanently destroyed. Its wallet assets do not move to the Punk you train.')); return; }
    if (!(envelope?.record?.status === 'CONFIRMED' && envelope.record.review.action === 'BURN')) root.append(button(source?.history && !source.history.complete ? 'Continue wallet check' : 'Check this Punk’s wallets', () => perform(async (chosen, current) => {
      const payload = await api(chosen, { operation: 'check' }, current); source = payload.source;
      const record = await request(`${path(chosen)}?sourceTokenId=${chosen.sourceTokenId}`, { method: 'GET' });
      if (current() && record?.ok) envelope = record;
    })));
    if (source) {
      if (source.history?.status === 'NOT_INDEXED') root.append(el('p', 'Complete NFT and token history is not available yet. This check does not start a background scan or authorize a sacrifice.'));
      else if (source.history && !source.history.complete) root.append(el('p', `Wallet history checked: ${source.history.progressPercent}%. This is saved, so you can continue later.`));
      const list = el('ul');
      for (const wallet of source.wallets ?? []) {
        const row = el('li', `${wallet.role} wallet · ${eth(wallet.nativeWei)} · ${eth(wallet.wethWei).replace('ETH', 'WETH')}`);
        const link = el('a', 'Open wallet'); link.href = `/broker/v2/?tab=withdraw&tokenId=${sourceId}`; row.append(' ', link); list.append(row);
      }
      root.append(list);
      if (source.training?.status === 'VERIFIED') root.append(el('p', `Unused Training Credits: ${source.training.burnCredits} from sacrifice · ${source.training.purchasedCredits} purchased.`));
      for (const blocker of source.blockers ?? []) root.append(el('p', COPY[blocker] ?? 'A safety check has not passed yet. Recheck before continuing.'));
      for (const check of source.obligations?.checks ?? []) if (check.status !== 'CLEAR') root.append(el('p', check.remediation));
      if (source.canBurn && !(envelope?.record?.status === 'CONFIRMED' && envelope.record.review.action === 'BURN')
        && (!envelope?.record || ['CONFIRMED', 'REVERTED', 'CANCELLED'].includes(envelope.record.status))) {
        const approvalDone = envelope?.record?.status === 'CONFIRMED' && envelope.record.review.action === 'APPROVE';
        root.append(button(approvalDone ? 'Review permanent sacrifice' : 'Review approval', () => perform(async (chosen, current) => {
          envelope = await api(chosen, { operation: 'prepare', action: approvalDone ? 'BURN' : 'APPROVE' }, current);
        })));
      }
    }
    const record = envelope?.record;
    if (record?.status === 'PREPARED') {
      const review = record.review, burning = review.action === 'BURN';
      root.append(el('h4', burning ? 'Permanent sacrifice' : 'Approve this one Punk'),
        el('p', burning ? `Punk #${sourceId} will permanently leave circulation. Punk #${s.tokenId} receives 1 Training Credit. Assets are not transferred.`
          : `Approve Punk #${sourceId} for the Forge. This does not burn it or create a credit. Approval has no expiry; revoke it if you abandon the burn.`),
        el('p', `Maximum network fee: ${eth(review.maximumNetworkFeeWei)}. Review expires ${new Date(review.expiresAt).toLocaleTimeString()}.`));
      const consentLabel = el('label'), consent = el('input'); consent.type = 'checkbox';
      consentLabel.append(consent, ' I reviewed nonstandard assets and off-chain obligations. Assets received later may become inaccessible.'); root.append(consentLabel);
      const typed = el('input'); typed.type = 'text'; typed.autocomplete = 'off'; typed.setAttribute('aria-label', `Type BURN ${sourceId}`);
      if (burning) { typed.placeholder = `BURN ${sourceId}`; root.append(typed); }
      const submit = button(burning ? 'Confirm burn · open wallet' : 'Confirm approval · open wallet', () => {
        const confirmation = typed.value, nonstandardReviewed = consent.checked, reviewedEnvelope = envelope;
        perform(async (chosen, current) => {
          const hash = await submitHolderBurn({ envelope: reviewedEnvelope, selected: chosen, provider: getProvider(), release, isCurrent: current,
            persistAttempt: async intentId => persist(chosen, { intentId, requested: true }),
            claim: async r => { const claimed = await api(chosen, { operation: 'claim', intentId: r.review.intentId, revision: r.revision, reviewHash: r.reviewHash,
              confirmation, nonstandardReviewed }, current); envelope = claimed; return claimed; },
            persistHash: async (intentId, transactionHash) => persist(chosen, { intentId, requested: true, transactionHash }) });
          message = `Transaction submitted: ${hash}. Recheck the original result.`;
          envelope = await request(`${path(chosen)}?sourceTokenId=${chosen.sourceTokenId}`, { method: 'GET' });
        });
      }, true);
      const enable = () => { submit.disabled = busy || !consent.checked || (burning && typed.value !== `BURN ${sourceId}`) || Date.now() + 5000 >= review.expiresAt; };
      consent.addEventListener('change', enable); typed.addEventListener('input', enable);
      if (!saved(s)?.requested) root.append(submit);
      root.append(button('Cancel unsent review', () => perform(async (chosen, current) => { envelope = await api(chosen,
        { operation: 'cancel', intentId: record.review.intentId, revision: record.revision }, current);
        storage.removeItem(key(chosen)); })));
    }
    if (record?.status === 'WALLET_REQUESTED' || saved(s)?.requested) {
      root.append(el('p', 'Your wallet request is saved. Recover its original transaction; it will not be sent again.'));
      const hashInput = el('input'); hashInput.placeholder = 'Transaction hash from wallet activity'; hashInput.setAttribute('aria-label', 'Original transaction hash');
      hashInput.value = saved(s)?.transactionHash ?? record?.reportedHash ?? ''; root.append(hashInput);
      root.append(button('Recheck original result', () => { const transactionHash = hashInput.value.trim(); perform(async (chosen, current) => {
        const loaded = await request(`${path(chosen)}?sourceTokenId=${chosen.sourceTokenId}`, { method: 'GET' });
        if (!current() || !loaded?.ok || !loaded.record) throw Error('The original review is unavailable. Recheck shortly.');
        envelope = loaded;
        if (loaded.record.status === 'WALLET_REQUESTED') envelope = await api(chosen, { operation: 'recover', intentId: loaded.record.review.intentId,
          revision: loaded.record.revision, transactionHash }, current);
        if (envelope.record?.status === 'CONFIRMED') {
          storage.removeItem(key(chosen));
          message = envelope.record.review.action === 'BURN' ? `Sacrifice confirmed. Punk #${chosen.tokenId} earned 1 Training Credit. Choose a skill to learn.` : 'Approval confirmed. Review the permanent sacrifice next.';
          if (envelope.record.review.action === 'BURN') { storage.removeItem(selectionKey(chosen)); await onConfirmed?.(envelope.record.receipt); }
        } else if (envelope.record?.status === 'REVERTED') { storage.removeItem(key(chosen)); message = 'The transaction reverted. No credit was created. Recheck before preparing a new review.'; }
        else if (envelope.record?.status === 'PREPARED') message = 'The server still has an unsent review. Cancel it before preparing a new wallet request.';
        else message = 'Confirmation is still pending. Recheck shortly.';
      }); }));
    }
    if (record?.status === 'CONFIRMED' && record.review.action === 'BURN') root.append(el('p', `Punk #${s.tokenId} earned 1 Training Credit. Open Learn a Skill, then equip your new skill.`));
    if (busy) root.append(el('p', 'Checking and saving your review…'));
    if (message) { const status = el('p', message); status.setAttribute('role', 'status'); root.append(status); }
  }
  return { async refresh() {
    const captured = ++generation; busy = false; sourceId = ''; source = null; envelope = null; message = '';
    const s = getSelection();
    if (s?.owner) { try { const prior = storage.getItem(selectionKey(s)); if (/^(0|[1-9][0-9]{0,3})$/.test(prior) && prior !== String(s.tokenId)) sourceId = prior; } catch { /* Read-only selection remains available. */ } }
    render();
    if (sourceId && saved(selection())?.requested) {
      const selected = selection();
      try {
        const payload = await request(`${path(selected)}?sourceTokenId=${sourceId}`, { method: 'GET' });
        if (!disposed && generation === captured && stamp(selected) === stamp(selection()) && payload?.ok
          && same(payload.owner, selected.owner) && payload.sourceTokenId === selected.sourceTokenId && payload.targetTokenId === String(selected.tokenId)) { envelope = payload; render(); }
      } catch { /* Saved recovery stays visible and can be rechecked after sign-in. */ }
    }
  },
    destroy() { generation++; disposed = true; root.replaceChildren(); } };
}
