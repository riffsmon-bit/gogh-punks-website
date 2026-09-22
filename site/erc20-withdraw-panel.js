import { exactErc20Amount, formatErc20Amount, submitErc20Withdrawal, validateErc20Review } from './erc20-withdraw-wallet.js';

const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const short = value => `${value.slice(0, 8)}…${value.slice(-6)}`;
function element(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
export function createErc20WithdrawalPanel({ root, getSelection, getProvider = () => getSelection()?.provider, ensureSession, request,
  storage = undefined, now = () => Date.now(), locks = globalThis.navigator?.locks }) {
  if (!root) return { refresh() {}, selectionChanged() {} };
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const storageAvailable = !!storage && ['getItem', 'setItem', 'removeItem'].every(name => typeof storage[name] === 'function');
  let busy = false, asset = null, review = null, attempt = null, selectionKey = '';
  root.classList.add('erc20-withdraw');
  const title = element('h3', 'Withdraw tokens'), intro = element('p', 'Move tokens from this Punk to your connected owner wallet. Choose where the tokens are held, then enter their exact Robinhood Chain contract address.');
  const roleLabel = element('label', 'Tokens are held in'), role = element('select');
  for (const [value, label] of [['V3', 'Punk Wallet · V3'], ['AGENT', 'Agent Account · separate wallet']]) { const option = element('option', label); option.value = value; role.append(option); }
  roleLabel.append(role);
  const contractLabel = element('label', 'Token contract address'), contract = element('input'); contract.type = 'text'; contract.placeholder = '0x…'; contract.spellcheck = false; contract.autocomplete = 'off'; contractLabel.append(contract);
  const amountLabel = element('label', 'Amount'), amount = element('input'); amount.type = 'text'; amount.inputMode = 'decimal'; amount.placeholder = '0.0'; amount.autocomplete = 'off'; amountLabel.append(amount); amountLabel.hidden = true;
  const controls = element('div', '', 'erc20-withdraw-actions'), weth = element('button', 'Use WETH'), inspect = element('button', 'Check token'), prepare = element('button', 'Review withdrawal'), submit = element('button', 'Confirm in wallet');
  for (const button of [weth, inspect, prepare, submit]) button.type = 'button';
  controls.append(weth, inspect, prepare, submit); prepare.hidden = true; submit.hidden = true;
  const info = element('p'), preview = element('dl', '', 'erc20-withdraw-review'), state = element('p', 'Connect your owner wallet and select a Punk to begin.'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
  const warning = element('p', 'Your connected wallet pays the network fee. Only standard tokens that transfer the exact amount are supported. A simulation checks current behavior; it cannot guarantee future behavior of a malicious or upgradeable token. Fee-charging, rebasing and unusual tokens are blocked when the checks detect unsupported behavior. Token names do not prove authenticity.');
  const recovery = element('div', '', 'erc20-withdraw-recovery'), recoveryLabel = element('label', 'Original transaction hash from wallet activity'), hash = element('input'); hash.type = 'text'; hash.placeholder = '0x…'; hash.spellcheck = false; recoveryLabel.append(hash);
  const recover = element('button', 'Check original transaction'); recover.type = 'button';
  const originalPunk = element('a', 'Open the Punk with the pending withdrawal'); originalPunk.hidden = true;
  const explorer = element('a', 'View transaction'); explorer.target = '_blank'; explorer.rel = 'noopener noreferrer'; explorer.hidden = true;
  recovery.append(recoveryLabel, recover, explorer, originalPunk); recovery.hidden = true;
  const legacy = element('p'), legacyLink = element('a', 'Open older wallets and recovery'); legacy.append('V1 and V2 wallets are separate. ', legacyLink);
  root.replaceChildren(title, intro, roleLabel, contractLabel, amountLabel, controls, info, preview, state, recovery, warning, legacy);
  function selected() {
    const current = getSelection();
    return current && current.chainId === 4663 && current.preview !== true && /^(0|[1-9]\d{0,3})$/.test(String(current.tokenId ?? '')) && /^0x[0-9a-fA-F]{40}$/.test(current.owner ?? '')
      ? { ...current, tokenId: String(current.tokenId), owner: current.owner.toLowerCase() } : null;
  }
  const key = current => current ? `gogh:erc20-withdraw:v1:4663:${current.owner}:${current.tokenId}` : '';
  const ownerKey = current => current ? `gogh:erc20-withdraw:owner:v1:4663:${current.owner}` : '';
  function render() {
    root.setAttribute('aria-busy', String(busy));
    const current = selected(), locked = busy || !current || !storageAvailable || !!attempt;
    for (const input of [role, contract, amount, weth, inspect, prepare]) input.disabled = locked;
    submit.disabled = locked || !review || now() >= review.expiresAt;
    recover.disabled = busy || !current || !attempt || attempt.review?.tokenId !== current.tokenId || !/^0x[0-9a-fA-F]{64}$/.test(hash.value);
    hash.disabled = busy || attempt?.review?.tokenId !== current?.tokenId;
    originalPunk.hidden = !attempt?.review || attempt.review.tokenId === current?.tokenId;
    if (attempt?.review) originalPunk.href = `/broker/v2/?tab=collection&tokenId=${attempt.review.tokenId}#token-withdrawals`; prepare.hidden = !asset || !!attempt; submit.hidden = !review || !!attempt;
    amountLabel.hidden = !asset || !!attempt; recovery.hidden = !attempt;
    legacyLink.href = current ? `/broker/punk/${current.tokenId}?tab=assets` : '/broker/v2/';
  }
  function clearReview() { review = null; preview.replaceChildren(); render(); }
  function persist(value) {
    const current = selected(); if (!current || key(current) !== selectionKey) throw new Error('The selected wallet changed.');
    if (value.status === 'WALLET_REQUESTED' && (storage.getItem(selectionKey) || storage.getItem(ownerKey(current)))) throw new Error('An earlier withdrawal is waiting for recovery. Check wallet activity before continuing.');
    if (value.status === 'REJECTED') { storage.removeItem(selectionKey); storage.removeItem(ownerKey(current)); attempt = null; clearReview(); return; }
    // Storage failure blocks sending; no in-memory-only fallback for money movement.
    storage.setItem(ownerKey(current), JSON.stringify(value));
    storage.setItem(selectionKey, JSON.stringify(value));
    if (storage.getItem(selectionKey) !== JSON.stringify(value) || storage.getItem(ownerKey(current)) !== JSON.stringify(value)) throw new Error('Transaction recovery could not be saved. Allow browser storage before withdrawing.');
    attempt = value; hash.value = value.transactionHash ?? ''; render();
  }
  async function api(body, expectedKey = selectionKey) {
    const current = selected(); if (!current || key(current) !== expectedKey) throw new Error('The selected Punk or wallet changed. Start a fresh review.');
    await ensureSession(); const result = await request(`/api/v2/punks/${current.tokenId}/erc20-withdraw`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!result?.ok) throw new Error(result?.message || 'The token checks are unavailable. Nothing was sent.');
    if (key(selected()) !== expectedKey) throw new Error('The selected Punk or wallet changed.');
    return result;
  }
  async function run(work) {
    if (busy) return; busy = true; render();
    try { await work(); } catch (error) { state.textContent = error?.message || 'The token checks failed. Check the original transaction before trying again.'; }
    finally { busy = false; render(); }
  }
  function showReview(value) {
    preview.replaceChildren();
    for (const [name, text] of [['Amount', `${formatErc20Amount(value.units, value.decimals)} ${asset?.symbol ?? 'TOKEN'}`],
      ['From', `${value.role === 'V3' ? 'Punk Wallet V3' : 'Agent Account'} · ${value.account}`], ['To your wallet', value.owner],
      ['Token contract', value.contract], ['Maximum network fee', `${formatErc20Amount(value.maximumNetworkFeeWei, 18)} ETH`]]) {
      const group = element('div'); group.append(element('dt', name), element('dd', text)); preview.append(group);
    }
    state.textContent = 'Simulation passed: the exact amount reaches your owner wallet. Confirm within 60 seconds; your wallet will show the final transaction.';
  }
  weth.addEventListener('click', () => { contract.value = WETH; asset = null; clearReview(); info.textContent = 'WETH selected. Check its balance before entering an amount.'; render(); });
  role.addEventListener('change', () => { asset = null; info.textContent = ''; clearReview(); });
  contract.addEventListener('input', () => { asset = null; info.textContent = ''; clearReview(); });
  amount.addEventListener('input', clearReview);
  inspect.addEventListener('click', () => run(async () => {
    clearReview(); state.textContent = 'Checking wallet ownership and token balance…';
    const result = await api({ operation: 'inspect', role: role.value, contract: contract.value.trim() });
    asset = result.asset; amount.value = ''; info.textContent = `${asset.symbol} · ${formatErc20Amount(asset.sourceBalance, asset.decimals)} available in ${role.value === 'V3' ? 'Punk Wallet V3' : 'Agent Account'} (${short(asset.account)}).`;
    state.textContent = BigInt(asset.sourceBalance) > 0n ? 'Enter an amount to review. Tokens will go only to your connected owner wallet.' : 'This wallet has no balance of this token. Check the other wallet or another token contract.';
  }));
  prepare.addEventListener('click', () => run(async () => {
    exactErc20Amount(amount.value, asset.decimals); state.textContent = 'Simulating the exact withdrawal and checking fees…';
    const result = await api({ operation: 'prepare', role: role.value, contract: contract.value.trim(), amount: amount.value });
    review = validateErc20Review(result.review); showReview(review);
  }));
  submit.addEventListener('click', () => run(async () => {
    const current = selected(), expectedKey = selectionKey, original = review;
    const provider = getProvider();
    if (!provider || !original) throw new Error('Reconnect your wallet and review again.');
    state.textContent = 'Rechecking ownership and balances before opening your wallet…';
    const transactionHash = await submitErc20Withdrawal(provider, original, {
      now, locks, persistAttempt: persist, verifyReview: value => api({ operation: 'verify', review: value }, expectedKey),
      contextCurrent: () => key(selected()) === expectedKey && review === original,
    });
    explorer.href = `https://robinhoodchain.blockscout.com/tx/${transactionHash}`; explorer.hidden = false;
    state.textContent = 'Withdrawal submitted. Check the original transaction to verify delivery; do not submit it again.';
  }));
  hash.addEventListener('input', render);
  recover.addEventListener('click', () => run(async () => {
    const original = attempt; validateErc20Review(original.review); state.textContent = 'Checking the original transaction and token delivery…';
    const result = await api({ operation: 'recover', review: original.review, transactionHash: hash.value.trim() });
    explorer.href = `https://robinhoodchain.blockscout.com/tx/${hash.value.trim()}`; explorer.hidden = false;
    if (['CONFIRMED', 'REVERTED'].includes(result.status)) {
      storage.setItem(`${selectionKey}:last`, JSON.stringify({ ...original, result })); storage.removeItem(selectionKey); storage.removeItem(ownerKey(selected()));
      attempt = null; asset = null; clearReview();
      state.textContent = result.status === 'CONFIRMED' ? 'Withdrawal confirmed. The exact token amount reached your owner wallet. Check the token again for the updated balance.'
        : 'The withdrawal reverted on-chain. Tokens were not withdrawn; the network fee may still have been charged. You may check the balance and create a new review.';
    } else {
      persist({ ...original, transactionHash: hash.value.trim().toLowerCase(), status: result.status });
      state.textContent = result.status === 'REQUIRES_ATTENTION' ? 'The transaction is final, but exact token delivery could not be verified. Check the transaction and balances. This withdrawal will not be sent again.'
        : 'The original transaction is waiting for confirmation. Recheck shortly; nothing was resent.';
    }
  }));
  function refresh() {
    const current = selected(), nextKey = key(current);
    if (busy && nextKey === selectionKey) return;
    if (!storageAvailable) { selectionKey = nextKey; state.textContent = 'Browser storage is unavailable. Allow storage for this site before withdrawing so your original transaction can be recovered safely.'; render(); return; }
    if (nextKey !== selectionKey) {
      selectionKey = nextKey; review = null; asset = null; attempt = null; preview.replaceChildren(); info.textContent = ''; explorer.hidden = true;
      try {
        const saved = nextKey ? storage.getItem(nextKey) || storage.getItem(ownerKey(current)) : null;
        if (saved) { attempt = JSON.parse(saved); validateErc20Review(attempt.review); if (attempt.review.owner !== current.owner) throw new Error('Mismatched recovery record'); hash.value = attempt.transactionHash ?? ''; }
        state.textContent = !current ? 'Connect your owner wallet and select a Punk to begin.' : attempt ? `A wallet request for Punk #${attempt.review.tokenId} is saved. Recover its original transaction before starting another token withdrawal from this owner wallet.` : 'Choose the wallet holding your tokens, then check a token contract.';
      } catch { attempt = { status: 'RECOVERY_INVALID' }; state.textContent = 'The saved transaction record cannot be read. Check wallet activity before proceeding; this page will not send another withdrawal.'; }
    }
    render();
  }
  refresh(); return { refresh, selectionChanged: refresh };
}
