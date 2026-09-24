import * as creationClient from './punk-agent-creation.js';
import { createSwarmWalletReadProvider } from './swarm-wallet-rpc.js';

const eth = value => { const n = BigInt(value), fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return (n / 10n ** 18n).toString() + (fraction ? '.' + fraction : '') + ' ETH'; };
const pending = record => ['WALLET_REQUESTED', 'SUBMITTED'].includes(record?.status);
export function mountAgentWalletCreation({ root, getContext, getProvider, onCreated, onStateChange,
  client = creationClient, storage, locks = globalThis.navigator?.locks, readProvider = createSwarmWalletReadProvider() }) {
  if (!root) {
    const getState = () => ({ owner: null, tokenId: null, busy: false, snapshot: null, record: null });
    return { refresh() {}, async check() { return getState(); }, getState };
  }
  try { if (storage === undefined) storage = globalThis.localStorage; } catch { storage = null; }
  const doc = root.ownerDocument;
  const node = (tag, text, name) => { const n = doc.createElement(tag); if (text) n.textContent = text;
    if (name) n.setAttribute('data-agent-wallet-creation-' + name, ''); return n; };
  let contextKey = '', providerKey = null, revision = 0, busy = false, review = null, snapshot = null, record = null, journalError = false;
  const title = node('h3', 'CREATE YOUR PUNK’S AGENT WALLET', 'title');
  const intro = node('p', 'Create the Agent Account first, then choose how to fund it. Creation sends 0 ETH and costs only the displayed network fee. It does not authorize a mission, change existing permissions or deposit funds.');
  const info = node('p', '', 'info'), status = node('p', '', 'status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const checkButton = node('button', 'CHECK AGENT WALLET', 'check'), prepare = node('button', 'REVIEW WALLET CREATION', 'prepare');
  const preview = node('section', '', 'review'), details = node('dl', '', 'details');
  const consentLabel = node('label'), consent = node('input', '', 'consent'); consent.type = 'checkbox';
  consentLabel.append(consent, node('span', 'I reviewed this Punk, the Agent Account address and the maximum network fee. This creates the wallet only.'));
  const confirm = node('button', 'CONFIRM CREATION IN WALLET', 'confirm'), discard = node('button', 'DISCARD UNSENT REVIEW', 'discard');
  preview.append(node('h4', 'REVIEW ACCOUNT CREATION'), details, consentLabel, confirm, discard);
  const recovery = node('section', '', 'recovery'), hashLabel = node('label', 'Original, speed-up or cancellation transaction hash');
  const hash = node('input', '', 'hash'); hash.type = 'text'; hash.maxLength = 66; hash.placeholder = '0x…'; hashLabel.append(hash);
  const recover = node('button', 'CHECK SAVED TRANSACTION', 'recover');
  recovery.append(node('p', 'An unknown or pending request will not be resent. Recover the saved creation before opening another wallet request.'), hashLabel, recover);
  const link = node('a', 'VIEW TRANSACTION', 'link'); link.target = '_blank'; link.rel = 'noopener noreferrer';
  root.hidden = false; root.replaceChildren(title, intro, info, checkButton, prepare, status, preview, recovery, link);
  for (const n of [checkButton, prepare, confirm, discard, recover]) { n.type = 'button'; n.className = 'outline-button'; }
  function current() {
    const c = getContext(), id = String(c?.tokenId);
    return c && c.chainId === 4663 && !c.preview && /^0x[0-9a-f]{40}$/i.test(c.owner ?? '')
      && /^(0|[1-9]\d{0,3})$/.test(id) && BigInt(id) <= 5016n ? { owner: c.owner.toLowerCase(), tokenId: id } : null;
  }
  const identityKey = c => c ? `${c.owner}:${c.tokenId}` : '';
  function getState() {
    const c = current(), matches = identityKey(c) === contextKey && getProvider() === providerKey;
    return structuredClone({ owner: c?.owner ?? null, tokenId: c?.tokenId ?? null, busy,
      snapshot: matches ? snapshot : null, record: matches ? record : null });
  }
  function changed() {
    // Optional guide rendering cannot interrupt transaction journaling/recovery.
    try { Promise.resolve(onStateChange?.(getState())).catch(() => {}); } catch { /* observer only */ }
  }
  function loadRecord() {
    const c = current(); record = c && storage ? client.getAgentWalletCreationRecord(c.owner, { storage }) : null;
    hash.value = record?.transactionHash ?? ''; journalError = false;
  }
  function render() {
    const c = current(), unavailable = !c || !storage || journalError, blocked = unavailable || busy || pending(record);
    root.setAttribute('aria-busy', String(busy));
    title.textContent = c ? `CREATE PUNK #${c.tokenId}’S AGENT WALLET` : 'CREATE YOUR PUNK’S AGENT WALLET';
    info.textContent = !c ? 'Select a Punk and connect its owner wallet on Robinhood Chain.'
      : !storage ? 'Allow browser storage before creating an account, so pending requests can be recovered.'
      : pending(record) ? `Creation for Punk #${record.review.tokenId} needs transaction recovery below.`
      : snapshot?.created ? `Agent Account verified: ${snapshot.account}. You can review funding below. Any existing mission permissions remain unchanged.`
      : snapshot ? `Agent Account to create: ${snapshot.account}. Review creation before depositing funds.` : 'Check the Agent Account first. This read does not open a transaction in your wallet.';
    checkButton.disabled = unavailable || busy;
    prepare.disabled = blocked || !snapshot || snapshot.created;
    preview.hidden = !review; consent.disabled = blocked;
    confirm.disabled = blocked || !review || !consent.checked || Date.now() >= review.expiresAt;
    discard.disabled = blocked || !review; recovery.hidden = !pending(record);
    recover.disabled = unavailable || busy || !pending(record) || !/^0x[0-9a-f]{64}$/i.test(hash.value);
    hash.disabled = busy; link.hidden = !record?.transactionHash;
    if (record?.transactionHash) link.href = `https://robinhoodchain.blockscout.com/tx/${record.transactionHash}`;
  }
  function refresh() {
    const next = identityKey(current()), provider = getProvider();
    const contextChanged = next !== contextKey || provider !== providerKey;
    if (contextChanged) {
      contextKey = next; providerKey = provider; revision++; review = null; snapshot = null; record = null;
      consent.checked = false; status.textContent = ''; hash.value = ''; journalError = false;
      try { loadRecord(); } catch (error) { journalError = true; status.textContent = error.message; }
    }
    render();
    if (contextChanged) changed();
  }
  async function run(action) {
    const c = current(); if (busy || !c || !storage || journalError) return;
    if (identityKey(c) !== contextKey || getProvider() !== providerKey) { refresh(); return; }
    const version = revision, provider = getProvider();
    const isCurrent = () => identityKey(current()) === identityKey(c) && revision === version && getProvider() === provider;
    busy = true; render(); changed();
    try { await action(c, provider, isCurrent); }
    catch (error) { if (isCurrent()) status.textContent = error?.message ?? 'Creation could not be checked. Preserve any saved transaction.'; }
    finally { busy = false; refresh(); changed(); }
    return getState();
  }
  async function ready(value, isCurrent) {
    if (!isCurrent()) return;
    snapshot = value; review = null; consent.checked = false;
    if (value.created && !pending(record)) {
      status.textContent = 'Agent Account verified. Choose funding next; no mission was authorized by this check.';
      if (isCurrent()) await onCreated?.(value);
    } else if (!pending(record)) status.textContent = 'The Agent Account has not been created yet. Review its address and creation fee next.';
  }
  async function check() {
    refresh();
    await run(async (c, provider, isCurrent) => {
      snapshot = null; review = null; consent.checked = false;
      status.textContent = 'Checking the owner, pinned registry and Agent Account…';
      const value = await client.readAgentWalletCreation(provider, { ...c, readProvider });
      if (isCurrent()) { loadRecord(); await ready(value, isCurrent); }
    });
    return getState();
  }
  checkButton.addEventListener('click', check);
  prepare.addEventListener('click', () => run(async (c, provider, isCurrent) => {
    loadRecord(); if (pending(record)) throw Error('Recover the saved creation before preparing another wallet request.');
    review = null; consent.checked = false; status.textContent = 'Checking and simulating wallet creation only…';
    const value = await client.prepareAgentWalletCreation(provider, { ...c, readProvider }); if (!isCurrent()) return;
    if (value.created) { await ready(value, isCurrent); return; }
    review = value; details.replaceChildren();
    const add = (label, text) => details.append(node('dt', label), node('dd', text));
    add('Punk', '#' + value.tokenId); add('Owner', value.owner); add('Agent Account', value.account); add('Registry', value.registry);
    add('ETH deposited', '0 ETH'); add('Maximum network fee', eth(value.maximumNetworkFeeWei));
    add('Review expires', new Date(value.expiresAt).toLocaleTimeString());
    status.textContent = 'Simulation passed. Review the address and fee, then confirm separately in your wallet.';
  }));
  consent.addEventListener('change', render); hash.addEventListener('input', render);
  discard.addEventListener('click', () => { review = null; consent.checked = false; revision++; render(); changed(); });
  confirm.addEventListener('click', () => run(async (c, provider, isCurrent) => {
    if (!review || !consent.checked || pending(record)) return;
    const shown = review; status.textContent = 'Rechecking ownership and the exact creation transaction before opening your wallet…';
    try {
      const result = await client.submitAgentWalletCreation(provider, shown, { storage, locks, isCurrent, readProvider });
      if (isCurrent()) {
        record = result; status.textContent = result.status === 'REJECTED' ? 'Creation cancelled in your wallet. Nothing was confirmed.'
          : 'Creation request saved. Check its transaction below before funding. No mission permission was requested.';
      }
    } finally {
      if (isCurrent()) {
        review = null; consent.checked = false;
        try { loadRecord(); } catch (error) { journalError = true; throw error; }
      }
    }
  }));
  recover.addEventListener('click', () => run(async (c, provider, isCurrent) => {
    const inspectedHash = hash.value.trim(); status.textContent = 'Checking the saved transaction. No new transaction will be sent…';
    const result = await client.recoverAgentWalletCreation(provider, c.owner, { hash: inspectedHash, storage, locks, isCurrent, readProvider });
    if (!isCurrent() || !result) return;
    record = result; hash.value = pending(result) && result.transactionHash !== inspectedHash ? inspectedHash : result.transactionHash ?? '';
    status.textContent = result.status === 'CONFIRMED' ? `Creation for Punk #${result.review.tokenId} confirmed. No mission permission was requested.`
      : result.status === 'CANCELLED' ? 'The creation request was cancelled. You may check the account and prepare a fresh review.'
      : result.status === 'REVERTED' ? 'Creation reverted. No account creation was confirmed; the network fee may have been spent.'
      : 'The transaction is still pending. Recheck it later; do not send another.';
    if (result.status === 'CONFIRMED' && result.review.tokenId === c.tokenId) {
      const value = await client.readAgentWalletCreation(provider, { ...c, readProvider }); await ready(value, isCurrent);
    }
    if (isCurrent() && result.receipt?.feeExceeded) status.textContent += ` Your wallet changed the fee above the review. Actual network fee: ${eth(result.receipt.actualNetworkFeeWei)}.`;
  }));
  refresh(); return { refresh, check, getState };
}
