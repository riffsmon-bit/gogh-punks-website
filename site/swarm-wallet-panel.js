import * as walletClient from './swarm-wallet-client.js';
import { SWARM_WALLET_RELEASE } from './swarm-wallet-release.js';
import { buildSwarmFunding, fundingEth } from './broker-swarm-funding.js';
import { createSwarmWalletReadProvider } from './swarm-wallet-rpc.js';
import { swarmWalletErrorMessage } from './swarm-wallet-errors.js';

export function mountSwarmWallet({ root, getContext, getPunks, getProvider, release = SWARM_WALLET_RELEASE,
  client = walletClient, storage, readProvider, locks = globalThis.navigator?.locks }) {
  if (!root) return { refresh() {} };
  if (!release || release.status !== 'LIVE') { root.hidden = true; return { refresh() {} }; }
  readProvider ??= createSwarmWalletReadProvider();
  try { if (storage === undefined) storage = globalThis.localStorage; } catch { storage = null; }
  const doc = root.ownerDocument;
  const el = (tag, text, name) => { const n = doc.createElement(tag); if (text) n.textContent = text;
    if (name) n.setAttribute('data-swarm-wallet-' + name, ''); return n; };
  let ownerKey = '', providerKey = null, rosterKey = '', revision = 0, rosterRevision = 0, activeBatch = false,
    busy = false, snapshot = null, review = null, record = null;
  const selectedIds = new Set();
  root.hidden = false; root.classList.add('swarm-wallet');
  const title = el('h3', 'YOUR SWARM WALLET');
  const intro = el('p', 'Keep a separate ETH budget for your Punks. You control this wallet: approve each gas-funding batch yourself, or withdraw unused ETH. No automatic refill or worker access.');
  const steps = el('ol');
  for (const text of ['Create your Swarm Wallet once.', 'Add ETH from your connected wallet.', 'Select activated Punks and review one gas-funding batch.', 'Confirm the batch in your wallet, then configure each Punk’s mission below.']) steps.append(el('li', text));
  const info = el('p', 'Check your Swarm Wallet to begin.', 'info');
  const status = el('p', '', 'status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const check = el('button', 'CHECK SWARM WALLET', 'check'), create = el('button', 'REVIEW WALLET CREATION', 'create');
  const createNote = el('p', 'Creating the wallet costs a network fee. It deposits nothing and grants no mission permission.');
  const forms = el('div', '', 'forms');
  function amountControl(label, name) {
    const wrapper = el('label', label), input = el('input', '', name);
    input.type = 'text'; input.inputMode = 'decimal'; input.maxLength = 80; input.placeholder = '0.001'; wrapper.append(input); return { wrapper, input };
  }
  const deposit = amountControl('ETH to add from your connected wallet', 'deposit-amount');
  const depositButton = el('button', 'REVIEW DEPOSIT', 'deposit');
  const picks = el('fieldset', '', 'punks');
  const batch = amountControl('Total ETH to split between selected Punks', 'batch-amount');
  const batchNote = el('p', 'Select 1–10 Punks with activated Agent Accounts. The total is split equally; any smallest-unit remainder goes to lower Punk numbers. Maximum 1 ETH per Punk. One wallet confirmation funds the entire batch or none of it. Funding does not start missions or change reserves.');
  const batchButton = el('button', 'REVIEW GAS BATCH', 'batch');
  const withdrawal = amountControl('Unused ETH to return to your connected wallet', 'withdraw-amount');
  const withdrawButton = el('button', 'REVIEW WITHDRAWAL', 'withdraw');
  forms.append(deposit.wrapper, depositButton, picks, batch.wrapper, batchNote, batchButton, withdrawal.wrapper, withdrawButton);
  const preview = el('section', '', 'review'), details = el('dl', '', 'details');
  const consentLabel = el('label'), consent = el('input', '', 'consent'); consent.type = 'checkbox';
  consentLabel.append(consent, el('span', 'I reviewed the destination, every amount and the maximum network fee.'));
  const confirmStatus = el('p', '', 'confirm-status'); confirmStatus.setAttribute('aria-live', 'polite');
  const confirm = el('button', 'CONFIRM IN WALLET', 'confirm'), discard = el('button', 'DISCARD UNSENT REVIEW', 'discard');
  const warning = el('p', 'Your connected wallet pays the network fee. Depositing gas does not activate a mission. A transfer to a Punk stays in that Punk’s wallet; withdrawing here only recovers ETH still in your Swarm Wallet.');
  preview.append(el('h4', 'REVIEW BEFORE OPENING YOUR WALLET'), details, warning, consentLabel, confirmStatus, confirm, discard);
  const recovery = el('section', '', 'recovery'), hashLabel = el('label', 'Original, speed-up or cancellation transaction hash from wallet activity');
  const hash = el('input', '', 'hash'); hash.type = 'text'; hash.placeholder = '0x…'; hash.maxLength = 66;
  hashLabel.append(hash); const recover = el('button', 'CHECK TRANSACTION', 'recover');
  recovery.append(el('p', 'A pending or unknown result will not be resent. Check the original transaction, or paste its speed-up or cancellation hash from wallet activity. A replacement must be confirmed before another action is available.'), hashLabel, recover);
  const link = el('a', 'VIEW TRANSACTION', 'link'); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.hidden = true;
  root.replaceChildren(title, intro, steps, info, check, create, createNote, forms, status, preview, recovery, link);
  const buttons = [check, create, depositButton, batchButton, withdrawButton, confirm, discard, recover];
  for (const n of buttons) { n.type = 'button'; n.className = 'outline-button'; }
  const current = () => { const c = getContext(); return c?.chainId === 4663 && !c.preview && /^0x[0-9a-f]{40}$/i.test(c.owner ?? '') ? c.owner.toLowerCase() : ''; };
  const pending = () => ['WALLET_REQUESTED', 'SUBMITTED'].includes(record?.status);
  function render() {
    root.setAttribute('aria-busy', String(busy));
    const unavailable = !current() || !storage, blocked = unavailable || busy || pending();
    for (const button of buttons) button.disabled = blocked;
    check.disabled = unavailable || busy;
    const fundingUnavailable = snapshot?.dependenciesVerified === false;
    for (const button of [create, depositButton, batchButton]) button.disabled ||= fundingUnavailable;
    create.hidden = snapshot?.created !== false; createNote.hidden = create.hidden;
    forms.hidden = snapshot?.created !== true;
    preview.hidden = !review;
    recovery.hidden = !pending();
    recover.disabled = unavailable || busy || !pending() || !/^0x[0-9a-f]{64}$/i.test(hash.value);
    confirm.disabled = blocked || !review || !consent.checked || Date.now() >= review.expiresAt;
    confirmStatus.textContent = unavailable ? 'Connect the owner wallet and allow site storage before confirming.'
      : pending() ? 'A wallet request is already saved. Check its transaction below; it will not be sent again.'
        : busy ? 'Checking this request. Wait for its result before trying again.'
          : review && Date.now() >= review.expiresAt ? 'This review expired. Discard it and review the action again before opening your wallet.'
            : !consent.checked ? 'Check the confirmation box above after reviewing the amounts and fee. Then Confirm in wallet becomes available.'
              : 'Choose Confirm in wallet to open the separate wallet approval for this reviewed action only.';
    for (const n of [deposit.input, batch.input, withdrawal.input, consent]) n.disabled = blocked;
    hash.disabled = busy;
    for (const n of picks.querySelectorAll('input')) n.disabled = blocked;
    if (!current()) info.textContent = 'Connect your owner wallet on Robinhood Chain.';
    else if (!storage) info.textContent = 'Allow site storage before using the Swarm Wallet. Pending transactions must be recoverable.';
    else if (snapshot) info.textContent = (snapshot.created ? `Swarm Wallet: ${snapshot.vault} · ${fundingEth(snapshot.balanceWei)} ETH available` : 'Your Swarm Wallet has not been created yet. Review creation to continue.')
      + (fundingUnavailable ? ' Punk account verification is unavailable, so funding is paused. You can still review withdrawal of unused ETH.' : '');
    else info.textContent = 'Check your Swarm Wallet. This read does not open MetaMask.';
    link.hidden = !record?.transactionHash;
    link.textContent = pending() ? 'VIEW PENDING TRANSACTION' : 'VIEW LAST TRANSACTION';
    if (record?.transactionHash) link.href = `https://robinhoodchain.blockscout.com/tx/${record.transactionHash}`;
  }
  function loadRecord() {
    record = current() && storage ? client.getSwarmWalletRecord(current(), { storage }) : null;
    hash.value = record?.transactionHash ?? '';
  }
  function refresh() {
    const owner = current(), ids = getPunks().map(p => String(p.tokenId)).sort((a,b) => Number(a)-Number(b)), roster = ids.join(',');
    const provider = getProvider(), changed = owner !== ownerKey || provider !== providerKey;
    if (changed) {
      ownerKey = owner; providerKey = provider; revision++; snapshot = null; review = null; record = null; selectedIds.clear();
      deposit.input.value = ''; batch.input.value = ''; withdrawal.input.value = ''; consent.checked = false; status.textContent = ''; hash.value = '';
      try { loadRecord(); } catch (error) { status.textContent = swarmWalletErrorMessage(error); }
    }
    if (changed || roster !== rosterKey) {
      // A holder's wallet is independent of the owned-Punk roster. Hydration
      // must not discard CREATE/read/deposit/withdrawal or receipt recovery.
      rosterRevision++; rosterKey = roster;
      if (!changed && (review?.action.kind === 'BATCH' || activeBatch)) {
        review = null; consent.checked = false;
        status.textContent = 'Your Punk roster changed. Review the funding batch again. Check any saved transaction below before trying again.';
      }
      for (const id of selectedIds) if (!ids.includes(id)) selectedIds.delete(id);
      picks.replaceChildren(el('legend', 'Punks to fund'));
      for (const id of ids) {
        const label = el('label'), input = el('input'); input.type = 'checkbox'; input.value = id; input.checked = selectedIds.has(id);
        input.addEventListener('change', () => { input.checked ? selectedIds.add(id) : selectedIds.delete(id); invalidate(); });
        label.append(input, el('span', `Punk #${id}`)); picks.append(label);
      }
    }
    render();
  }
  function invalidate() { revision++; review = null; consent.checked = false; render(); }
  async function run(action, { batch = false } = {}) {
    if (busy || !current() || !storage) return;
    if (current() !== ownerKey || getProvider() !== providerKey) { refresh(); return; }
    busy = true; activeBatch = batch;
    const owner = current(), version = revision, rosterVersion = rosterRevision, provider = getProvider();
    const isCurrent = () => current() === owner && revision === version && getProvider() === provider
      && (!batch || rosterRevision === rosterVersion);
    render();
    try { await action(owner, isCurrent, provider); }
    catch (error) { if (isCurrent()) status.textContent = swarmWalletErrorMessage(error); }
    finally {
      // A result may arrive after a roster/connection change. Its durable
      // journal still belongs to this owner and must remain visible for recovery.
      if (!isCurrent() && current() === owner && ownerKey === owner) {
        try {
          loadRecord();
          status.textContent = pending() ? 'Your wallet request is saved. Check its transaction below before another action; it will not be resent.'
            : batch && rosterRevision !== rosterVersion ? 'Your Punk roster changed. Review the funding batch again. No new review is ready.'
              : 'Your wallet connection or review changed. Check your wallet and prepare a fresh review.';
        } catch (error) { status.textContent = swarmWalletErrorMessage(error); }
      }
      busy = false; activeBatch = false; render();
    }
  }
  function amountWei(input) {
    const value = input.value.trim();
    if (!/^(0|[1-9]\d{0,59})(\.\d{1,18})?$/.test(value)) throw Error('Enter an exact positive ETH amount.');
    const [whole, fraction = ''] = value.split('.'); const amount = BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));
    if (amount <= 0n) throw Error('Enter an ETH amount greater than zero.'); return String(amount);
  }
  function showReview(value) {
    review = value; consent.checked = false; details.replaceChildren();
    const add = (label, text) => { details.append(el('dt', label), el('dd', text)); };
    add('Action', { CREATE:'Create your Swarm Wallet', DEPOSIT:'Add ETH to your Swarm Wallet', BATCH:'Fund selected Punk Agent Accounts', WITHDRAW:'Withdraw unused ETH to your owner wallet' }[value.action.kind]);
    add('Owner', value.owner); add('Swarm Wallet', value.vault);
    if (value.action.amountWei) add('Amount', `${fundingEth(value.action.amountWei)} ETH`);
    if (value.action.kind === 'BATCH') {
      let total = 0n;
      for (const allocation of value.allocations) { add(`Punk #${allocation.tokenId}`, `${fundingEth(allocation.amountWei)} ETH → ${allocation.account}`); total += BigInt(allocation.amountWei); }
      add('Total from Swarm Wallet', `${fundingEth(total)} ETH`);
    }
    add('Maximum network fee · paid by your connected wallet', `${fundingEth(value.maximumNetworkFeeWei)} ETH`);
    add('Review expires', new Date(value.expiresAt).toLocaleTimeString());
    status.textContent = 'Simulation passed. Review every amount, then confirm separately in your wallet.';
    render(); preview.scrollIntoView?.({ block:'nearest' });
  }
  const prepare = (action, options) => run(async (owner, isCurrent, provider) => {
    loadRecord(); if (pending()) throw Error('Check the original pending transaction first.');
    review = null; consent.checked = false; status.textContent = 'Checking ownership, balances and the exact transaction…';
    const prepared = await client.prepareSwarmWallet(provider, { owner, release, readProvider, action: typeof action === 'function' ? action(owner) : action });
    if (isCurrent()) showReview(prepared);
  }, options);
  check.addEventListener('click', () => run(async (owner, isCurrent, provider) => {
    status.textContent = 'Checking your Swarm Wallet…';
    const value = await client.readSwarmWallet(provider, { owner, release, readProvider });
    if (isCurrent()) { snapshot = value; loadRecord(); status.textContent = pending() ? 'A previous wallet request needs recovery below.' : 'Wallet checked. Choose an action to review.'; }
  }));
  create.addEventListener('click', () => prepare({ kind:'CREATE' }));
  depositButton.addEventListener('click', () => prepare(() => ({ kind:'DEPOSIT', amountWei:amountWei(deposit.input) })));
  withdrawButton.addEventListener('click', () => prepare(() => ({ kind:'WITHDRAW', amountWei:amountWei(withdrawal.input) })));
  batchButton.addEventListener('click', () => prepare(owner => {
    const funding = buildSwarmFunding({ owner, chainId:4663, tokenIds:[...selectedIds], totalEth:batch.input.value.trim() });
    return { kind:'BATCH', allocations:funding.allocations.map(({tokenId,amountWei}) => ({tokenId,amountWei})) };
  }, { batch: true }));
  for (const input of [deposit.input, batch.input, withdrawal.input]) input.addEventListener('input', invalidate);
  consent.addEventListener('change', render); hash.addEventListener('input', render);
  discard.addEventListener('click', invalidate);
  confirm.addEventListener('click', () => run(async (owner, isCurrent, provider) => {
    if (!review || !consent.checked || pending()) return;
    const shown = review; status.textContent = 'Rechecking the reviewed transaction before opening your wallet…';
    try {
      const result = await client.submitSwarmWallet(provider, shown, { release, readProvider, isCurrent, storage, locks });
      if (isCurrent()) { record = result; hash.value = result.transactionHash ?? ''; status.textContent = result.status === 'REJECTED' ? 'Wallet request cancelled. Nothing was confirmed.' : 'Wallet request saved. Check the original transaction below for confirmation.'; }
    } finally { if (isCurrent()) { review = null; consent.checked = false; loadRecord(); } }
  }, { batch: review?.action.kind === 'BATCH' }));
  recover.addEventListener('click', () => run(async (owner, isCurrent, provider) => {
    status.textContent = 'Checking your saved transaction or its replacement. No new transaction will be sent…';
    const inspectedHash = hash.value.trim();
    const result = await client.recoverSwarmWallet(provider, owner, { release, readProvider, storage, locks, hash:inspectedHash, isCurrent });
    if (!isCurrent()) return;
    record = result; hash.value = pending() ? inspectedHash : result.transactionHash ?? '';
    status.textContent = result.status === 'CONFIRMED' ? 'Transaction confirmed. Your Swarm Wallet action is complete. Funding does not start a mission.'
      : result.status === 'CANCELLED' ? 'Original request cancelled in your wallet. The intended Swarm action did not execute; the cancellation used a network fee.'
      : result.status === 'REVERTED' ? 'The transaction reverted. The intended transfer did not complete; the network fee may have been spent.'
        : 'Confirmation is still pending. Check this original transaction again later; do not send another.';
    if (result.receipt?.feeExceeded) status.textContent += ` Your wallet changed the network fee above the original review. Actual fee: ${fundingEth(result.receipt.actualNetworkFeeWei)} ETH. This check sent no new transaction.`;
    if (['CONFIRMED','REVERTED','CANCELLED'].includes(result.status)) {
      const value = await client.readSwarmWallet(provider, { owner, release, readProvider });
      if (isCurrent()) snapshot = value;
    }
  }));
  refresh(); return { refresh };
}
