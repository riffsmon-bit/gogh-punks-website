import { createAgentRecoveryController } from './punk-agent-recovery.js';

const actions = { NATIVE: 'Agent ETH', ENTRY_POINT: 'EntryPoint gas deposit', ERC721: 'ERC-721 NFT', ERC1155: 'ERC-1155 tokens' };
const pendingStates = ['PREPARED', 'WALLET_REQUESTED', 'SUBMITTED'];
const immutableCopy = value => {
  const copy = JSON.parse(JSON.stringify(value));
  const freeze = item => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(copy); return copy;
};
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export function recoveryEth(value) {
  if (!/^\d+$/.test(String(value ?? ''))) return 'NOT VERIFIED';
  const wei = BigInt(value), fraction = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${wei / 10n ** 18n}${fraction ? `.${fraction}` : ''} ETH`;
}
export function agentRecoveryIntent(tokenId, draft) {
  const action = draft.action;
  if (!Object.hasOwn(actions, action)) throw Error('Choose a supported recovery action.');
  const nft = action === 'ERC721' || action === 'ERC1155';
  let amountWei = '1';
  if (action !== 'ERC721') {
    const amount = draft.amount.trim();
    if (nft) {
      if (!/^[1-9]\d{0,77}$/.test(amount)) throw Error('Enter a positive whole token quantity.');
      amountWei = amount;
    } else {
      if (!/^(0|[1-9]\d{0,59})(\.\d{1,18})?$/.test(amount)) throw Error('Enter a positive ETH amount with at most 18 decimals.');
      const [whole, fraction = ''] = amount.split('.');
      amountWei = (BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))).toString();
    }
  }
  if (BigInt(amountWei) <= 0n || BigInt(amountWei) >= 2n ** 256n) throw Error('The recovery amount is outside the supported range.');
  const assetContract = nft ? draft.contract.trim().toLowerCase() : null;
  const assetTokenId = nft ? draft.assetTokenId.trim() : null;
  if (nft && (!/^0x[0-9a-f]{40}$/.test(assetContract) || /^0x0{40}$/.test(assetContract)
    || !/^(0|[1-9]\d{0,77})$/.test(assetTokenId) || BigInt(assetTokenId) >= 2n ** 256n)) {
    throw Error('Enter the full NFT contract address and a decimal token ID.');
  }
  return { schema: 'GOGH_AGENT_RECOVERY_INTENT_V1', tokenId, action, amountWei, assetContract, assetTokenId };
}
export function agentRecoveryMessage(state, now = Date.now()) {
  return {
    EMPTY: 'Choose the asset and amount. Review checks current ownership and custody; confirmation is a separate step.',
    PREPARED: state.review?.expiresAt <= now + 5_000
      ? 'Review expired. Cancel the unsent review, then review again. Your draft is retained.'
      : 'Review ready. Check the Agent source, fixed owner destination, amount and maximum network fee.',
    WALLET_REQUESTED: 'Wallet result unresolved. Check wallet activity and recover the original transaction hash. Do not send a replacement.',
    SUBMITTED: 'Transaction saved. Recheck its receipt; completion requires 12 confirmations. It will not be resent.',
    CONFIRMED: 'Recovery confirmed with 12 confirmations. Recheck balances and Collection for current custody.',
    REVERTED: 'Transaction reverted. No recovery completed; the network fee may have been charged. Review again before retrying.',
    REJECTED: 'Wallet confirmation declined. Your draft is retained; prepare a fresh review when ready.',
    CANCELLED: 'Unsent review cancelled. Your draft is retained; review again when ready.',
  }[state.status] ?? 'Recovery state unavailable. Recheck before continuing.';
}
export function agentRecoveryError(error) {
  const messages = {
    STORAGE_UNAVAILABLE: 'Browser recovery storage is unavailable. Restore access before continuing; keep any existing transaction hash.',
    JOURNAL_INVALID: 'The saved recovery record could not be verified. Keep wallet activity and transaction hashes for support; do not clear browser data or send a replacement.',
    LOCK_UNAVAILABLE: 'This browser cannot safely lock recovery across tabs. Use a browser with Web Locks; keep any pending transaction record.',
    PREPARATION_FAILED: 'Recovery review is unavailable. Recheck your sign-in, Agent balance and custody. An active mission must be recalled before withdrawing its EntryPoint deposit.',
    REVIEW_EXPIRED: 'Review expired. Cancel the unsent review and prepare a fresh one. Your draft is retained.',
    REVIEW_REQUIRED: 'A displayed recovery review is required. Cancel the unsent review and prepare a fresh one.',
    REVIEW_CHANGED: 'The recovery review changed. Cancel the unsent review and prepare a fresh one before confirming.',
    FEE_CHANGED: 'Network fees or the owner’s gas balance changed. Cancel the unsent review and review the current fee again.',
    BALANCE_CHANGED: 'The Agent balance or protected reserve changed. Cancel the unsent review and review a supported amount.',
    SESSION_CHANGED: 'The mission session changed. Cancel the unsent review and verify the current reserve before reviewing again.',
    ASSET_CHANGED: 'The NFT custody, token quantity or contract changed. Cancel the unsent review and verify the asset again.',
    RUNTIME_CHANGED: 'The Agent account could not be verified against its approved deployment. Recovery is blocked; retain the review for support.',
    SIMULATION_FAILED: 'The recovery simulation no longer passes. Cancel the unsent review and recheck current custody and balances.',
    RECALL_REQUIRED: 'Recall the active mission in Talk and verify revocation before reviewing the EntryPoint withdrawal.',
    OWNER_CHANGED: 'Current Punk ownership changed. Reconnect the current owner and recheck this Punk.',
    SELECTION_CHANGED: 'The wallet, network or selected Punk changed. Return to the original selection to inspect its saved recovery.',
    WRONG_CHAIN: 'Switch your wallet to Robinhood Chain, then recheck the saved recovery.',
    WALLET_RESULT_UNKNOWN: 'The wallet result is unknown. Check wallet activity and recover the original transaction hash. It will not be resent.',
    RECEIPT_MISMATCH: 'The transaction or receipt does not match this reviewed recovery. Keep the original transaction hash and recheck; no completion is assumed.',
    ASSET_RECEIPT_MISMATCH: 'NFT delivery is not verified. Keep the saved transaction and recheck its receipt.',
    RECOVERY_INVALID: 'Enter the original full transaction hash from wallet activity.',
    RECOVERY_HASH_CHANGED: 'This recovery already has a saved transaction hash. Recheck that original transaction.',
  };
  const code = String(error?.code ?? '').replace(/^AGENT_RECOVERY_/, '');
  return messages[code] ?? error?.message ?? 'Recovery could not be verified. Your draft and saved transaction are retained.';
}

export function createAgentRecoveryPanel({ root, getSelection, ensureSession,
  getProvider = () => window.__GOGH_WALLET_PROVIDER__, createController = createAgentRecoveryController,
  now = () => Date.now(), schedule = callback => window.setInterval(callback, 1_000),
  unschedule = timer => window.clearInterval(timer) }) {
  if (!root) return null;
  let key = '', controller = null, provider = null, busy = false, error = '', blocked = false, generation = 0;
  let journal = { status: 'EMPTY', review: null }, reviewKey = '';
  const drafts = new Map();
  const identity = () => { const s = getSelection(); return `${s?.owner?.toLowerCase()}:${s?.tokenId}:${s?.chainId}:${s?.preview}`; };
  const available = () => { const s = getSelection(); return /^0x[0-9a-f]{40}$/i.test(s?.owner ?? '')
    && /^(0|[1-9]\d{0,3})$/.test(String(s?.tokenId ?? '')) && s.chainId === 4663 && !s.preview && typeof getProvider()?.request === 'function'; };
  root.classList.add('agent-recovery-panel'); root.id = 'agent-recovery'; root.setAttribute('aria-labelledby', 'agent-recovery-title');
  const title = el('h3', 'AGENT OWNER RECOVERY'); title.id = 'agent-recovery-title'; title.tabIndex = -1;
  const intro = el('p', 'Withdraw from this Punk’s separate Agent Account to the current owner wallet. The owner pays the network fee. V3 Punk Wallet assets use their existing recovery controls.');
  const status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const form = el('div', null, 'agent-recovery-fields');
  function field(labelText, name, tag = 'input') {
    const label = el('label', labelText), input = el(tag); input.name = name;
    input.setAttribute('data-agent-recovery-field', name);
    if (tag === 'input') { input.autocomplete = 'off'; input.spellcheck = false; }
    label.append(input); form.append(label); return { label, input };
  }
  const action = field('ASSET TO RECOVER', 'action', 'select');
  for (const [value, text] of Object.entries(actions)) { const option = el('option', text); option.value = value; action.input.append(option); }
  const amount = field('AMOUNT IN ETH', 'amount'); amount.input.inputMode = 'decimal';
  const contract = field('NFT CONTRACT ADDRESS', 'contract'); contract.input.maxLength = 42;
  const token = field('NFT TOKEN ID', 'assetTokenId'); token.input.inputMode = 'numeric'; token.input.maxLength = 78;
  const instructions = el('p', 'Native withdrawals preserve the active mission reserve. Recall in Talk before withdrawing an active mission’s EntryPoint gas deposit. NFT withdrawals require verified Agent custody.');
  const facts = el('dl', null, 'agent-recovery-facts');
  const confirmation = el('label', null, 'transaction-confirm'), checkbox = el('input'); checkbox.type = 'checkbox';
  confirmation.append(checkbox, el('span', 'I reviewed this asset, amount, Agent source and fixed owner destination. Confirm opens my wallet.'));
  const controls = el('div', null, 'agent-recovery-actions');
  function button(text, name, callback) { const node = el('button', text, 'outline-button'); node.type = 'button';
    node.setAttribute('data-agent-recovery-action', name); node.addEventListener('click', () => { void callback(); }); controls.append(node); return node; }
  const access = button('RECHECK RECOVERY ACCESS', 'access', () => selectionChanged(true));
  const review = button('REVIEW RECOVERY', 'prepare', () => work(async current => {
    const intent = agentRecoveryIntent(String(getSelection().tokenId), readDraft());
    await ensureSession(message => { if (current()) status.textContent = message; });
    if (current()) await controller.prepare(intent);
  }));
  const confirm = button('CONFIRM IN WALLET', 'submit', () => {
    if (!checkbox.checked || blocked || journal.status !== 'PREPARED' || journal.review.expiresAt <= now() + 5_000) return;
    const expectedReview = immutableCopy(journal.review);
    return work(async current => { await ensureSession(); if (current() && checkbox.checked) await controller.submit({ expectedReview }); }, true);
  });
  const cancel = button('CANCEL UNSENT REVIEW', 'cancel', () => work(() => controller.cancelReview()));
  const refresh = button('RECHECK SAVED RECEIPT', 'refresh', () => work(() => controller.refresh()));
  const hashLabel = el('label', 'ORIGINAL TRANSACTION HASH FROM WALLET ACTIVITY'), hashInput = el('input');
  hashInput.autocomplete = 'off'; hashInput.spellcheck = false; hashInput.maxLength = 66; hashInput.placeholder = '0x…';
  hashInput.setAttribute('data-agent-recovery-field', 'hash'); hashLabel.append(hashInput);
  const recover = button('RECOVER ORIGINAL TRANSACTION', 'recover', () => {
    const hash = hashInput.value.trim();
    return work(() => { if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('Enter the original full transaction hash from wallet activity.'); return controller.recover(hash); });
  });
  const link = el('a', 'VIEW SAVED TRANSACTION ↗'); link.target = '_blank'; link.rel = 'noopener noreferrer';
  root.append(title, intro, status, form, instructions, facts, confirmation, hashLabel, controls, link);
  const fields = [action.input, amount.input, contract.input, token.input];
  function readDraft() { return { action: action.input.value, amount: amount.input.value, contract: contract.input.value, assetTokenId: token.input.value }; }
  function setDraft(draft = {}) { action.input.value = draft.action ?? 'NATIVE'; amount.input.value = draft.amount ?? ''; contract.input.value = draft.contract ?? ''; token.input.value = draft.assetTokenId ?? ''; }
  function accept(state) {
    journal = state;
    const next = JSON.stringify(state.review);
    if (next !== reviewKey) { reviewKey = next; checkbox.checked = false; blocked = false; }
  }
  function render() {
    const enabled = available() && controller;
    const isPending = pendingStates.includes(journal.status), prepared = journal.status === 'PREPARED';
    root.setAttribute('aria-busy', String(busy));
    title.textContent = `AGENT OWNER RECOVERY${getSelection()?.tokenId != null ? ` · PUNK #${getSelection().tokenId}` : ''}`;
    status.textContent = error || (!enabled ? getSelection()?.preview ? 'Design preview only. Recovery requires the current owner wallet.'
      : 'Connect the current Punk owner on Robinhood Chain to inspect saved recovery.' : busy && !['WALLET_REQUESTED', 'SUBMITTED'].includes(journal.status)
        ? 'Checking recovery…' : agentRecoveryMessage(journal, now()));
    for (const input of fields) input.disabled = !enabled || busy || isPending;
    const nft = ['ERC721', 'ERC1155'].includes(action.input.value);
    contract.label.hidden = !nft; token.label.hidden = !nft; amount.label.hidden = action.input.value === 'ERC721';
    amount.label.firstChild.textContent = nft ? 'TOKEN QUANTITY' : 'AMOUNT IN ETH';
    amount.input.inputMode = nft ? 'numeric' : 'decimal';
    facts.replaceChildren(); facts.hidden = !journal.review;
    if (journal.review) {
      const v = journal.review, intent = v.intent;
      for (const [name, value] of [['ACTION', actions[intent.action]], ['FROM AGENT ACCOUNT', v.account], ['FIXED CURRENT-OWNER DESTINATION', v.owner],
        ['AMOUNT', intent.assetContract ? `${intent.amountWei} token unit(s)` : recoveryEth(intent.amountWei)],
        ...(intent.assetContract ? [['NFT', `${intent.assetContract} · TOKEN #${intent.assetTokenId}`]] : []),
        ['MAXIMUM NETWORK FEE · PAID BY OWNER', recoveryEth(v.maximumNetworkFeeWei)],
        ['REVIEW EXPIRES', `${new Date(v.expiresAt).toLocaleString()}${v.expiresAt <= now() + 5_000 ? ' · EXPIRED' : ''}`]]) {
        const row = el('div'); row.append(el('dt', name), el('dd', value)); facts.append(row);
      }
    }
    review.disabled = !enabled || busy || isPending;
    access.hidden = Boolean(controller); access.disabled = busy || !available();
    confirmation.hidden = !prepared; checkbox.disabled = !enabled || busy || blocked || !prepared || journal.review.expiresAt <= now() + 5_000;
    confirm.hidden = !prepared; confirm.disabled = checkbox.disabled || !checkbox.checked;
    cancel.hidden = !['PREPARED', 'REJECTED'].includes(journal.status); cancel.disabled = !enabled || busy;
    refresh.disabled = !enabled || busy; refresh.hidden = !journal.review;
    const recoverable = ['WALLET_REQUESTED', 'SUBMITTED'].includes(journal.status);
    hashLabel.hidden = !recoverable; recover.hidden = !recoverable; recover.disabled = !enabled || busy;
    hashInput.disabled = busy || !enabled || Boolean(journal.transactionHash);
    if (journal.transactionHash) hashInput.value = journal.transactionHash;
    link.hidden = !/^0x[0-9a-f]{64}$/i.test(journal.transactionHash ?? '');
    if (!link.hidden) link.href = `https://robinhoodchain.blockscout.com/tx/${journal.transactionHash}`;
  }
  async function work(callback, submitting = false) {
    selectionChanged(); if (busy || !available() || !controller) return;
    const ticket = generation, original = key;
    const current = () => ticket === generation && original === identity() && provider === getProvider() && available();
    let failed = false;
    busy = true; error = ''; render();
    try { await callback(current); }
    catch (failure) { failed = true; if (current()) { error = agentRecoveryError(failure); if (submitting) { checkbox.checked = false; blocked = true; } } }
    finally { if (current()) {
      try { accept(controller.getState()); } catch (failure) { controller = null; error = agentRecoveryError(failure); }
      if (failed && submitting && journal.status === 'PREPARED') blocked = true;
      busy = false; render();
    } }
  }
  function selectionChanged(force = false) {
    const next = identity(), nextProvider = getProvider();
    if (!force && next === key && nextProvider === provider) return;
    if (key) drafts.set(key, { ...readDraft(), hash: hashInput.value });
    key = next; provider = nextProvider; ++generation; busy = false; error = ''; controller = null; blocked = false;
    journal = { status: 'EMPTY', review: null }; reviewKey = ''; checkbox.checked = false;
    const draft = drafts.get(key); setDraft(draft); hashInput.value = draft?.hash ?? '';
    if (available()) {
      const selected = getSelection(), original = key, originalProvider = provider, ticket = generation;
      const current = () => ticket === generation && original === identity() && originalProvider === getProvider() && available();
      try { controller = createController({ provider, owner: selected.owner.toLowerCase(), tokenId: String(selected.tokenId),
        isCurrent: current, onChange: state => { if (current()) { accept(state); render(); } } });
        accept(controller.getState());
        if (!draft && journal.review) {
          const intent = journal.review.intent;
          setDraft({ action: intent.action, amount: intent.assetContract ? intent.amountWei : recoveryEth(intent.amountWei).replace(/ ETH$/, ''),
            contract: intent.assetContract ?? '', assetTokenId: intent.assetTokenId ?? '' });
        }
      } catch (failure) { controller = null; error = agentRecoveryError(failure); }
    }
    render();
  }
  action.input.addEventListener('change', () => { checkbox.checked = false; render(); });
  checkbox.addEventListener('change', render);
  selectionChanged();
  // Expiry is presentation only: no session, review, RPC or wallet request.
  const timer = schedule(() => { if (!root.hidden && journal.status === 'PREPARED') render(); });
  return { selectionChanged, openAsset(asset) {
    selectionChanged();
    if (busy || pendingStates.includes(journal.status)) { error = 'Finish or cancel the saved recovery before choosing another asset.'; render(); return; }
    if (!['ERC721', 'ERC1155'].includes(asset.standard)) return;
    setDraft({ action: asset.standard, contract: asset.collection, assetTokenId: asset.tokenId, amount: '1' });
    error = ''; checkbox.checked = false; render(); title.focus();
  }, destroy() { ++generation; unschedule(timer); } };
}
