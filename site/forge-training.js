// Shared Control Center training view. Only the loopback test harness supplies this adapter.
// No production deployment or wallet authority is inferred from a URL/query flag.
import { validateTrainingReview } from './forge-training-transaction.js';
const ZERO = /^0x0{64}$/;
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const UINT = /^(0|[1-9]\d{0,77})$/;
const identity = selection => JSON.stringify([String(selection?.tokenId ?? ''), selection?.owner?.toLowerCase() ?? null,
  selection?.chainId ?? null, selection?.preview ?? null]);
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
export function validateTrainingSnapshot(data, tokenId) {
  if (!data || data.localOnly !== true || data.chainId !== 31337 || data.canBurn !== false
    || data.productionReadyCount !== 0 || data.tokenId !== Number(tokenId)
    || !ADDRESS.test(data.owner) || !ADDRESS.test(data.progression) || !ADDRESS.test(data.collection) || !ADDRESS.test(data.registry)
    || !/^[0-9a-f]{64}$/.test(data.localTrainingNonce)
    || !/^0x[0-9a-f]{64}:0x[0-9a-f]{64}:\d+$/i.test(data.ownershipEpoch)
    || !HASH.test(data.blockHash) || !/^\d+$/.test(data.blockNumber)
    || !UINT.test(data.credits) || BigInt(data.credits) >= 2n ** 256n || !Number.isInteger(data.slots) || data.slots < 1
    || data.cap !== 7 || data.slots > data.cap || !Array.isArray(data.learned)
    || !Array.isArray(data.skills) || !Array.isArray(data.equipped) || data.equipped.length !== data.slots
    || data.equipped.some(key => !HASH.test(key)) || !Array.isArray(data.history)
    || data.capabilityContext?.walletAuthority !== 'NONE'
    || String(data.capabilityContext?.tokenId) !== String(tokenId)
    || data.capabilityContext?.owner?.toLowerCase() !== data.owner.toLowerCase()
    || !Array.isArray(data.capabilityContext.effectiveMcpTools)) throw Error('Unverified test-chain progression');
  const keys = data.skills.filter(s => s.key !== null).map(s => s.key);
  const learned = data.learned.map(s => s?.key);
  const equipped = data.equipped.filter(k => !ZERO.test(k));
  if (keys.some(k => !HASH.test(k) || ZERO.test(k)) || new Set(keys).size !== keys.length
    || data.skills.some(s => typeof s.name !== 'string' || s.name.length < 1 || s.name.length > 100)
    || learned.some(k => !keys.includes(k)) || new Set(learned).size !== learned.length
    || data.learned.some(s => !Number.isInteger(s.level) || s.level < 1 || s.level > 255)
    || equipped.some(k => !learned.includes(k)) || new Set(equipped).size !== equipped.length
    || data.capabilityContext.blockHash !== data.blockHash
    || data.capabilityContext.requiresSeparateEconomicAuthorization !== true
    || data.capabilityContext.effectiveMcpTools.some(t => !['inspect_contract', 'get_metadata', 'rank_trait_sample', 'inspect_mint_link'].includes(t))
    || !Array.isArray(data.capabilityContext.instructionPackages)
    || data.capabilityContext.instructionPackages.some(p => !equipped.includes(p.key))
    || data.history.some(e => !['TrainingCreditEarned', 'SkillLearned', 'SlotUnlocked', 'SkillEquipped', 'SkillUnequipped'].includes(e.name)
      || !HASH.test(e.transactionHash) || !UINT.test(e.blockNumber) || BigInt(e.blockNumber) > BigInt(data.blockNumber)
      || String(e.args?.tokenId) !== String(tokenId))) throw Error('Inconsistent test-chain progression');
  return data;
}
export function validateTrainingRecovery(recovery, state) {
  const allowed = ['CHECKING', 'AWAITING_WALLET', 'SUBMITTED', 'SUBMISSION_UNKNOWN', 'CONFIRMED', 'REVERTED'];
  if (!recovery || recovery.localOnly !== true || recovery.chainId !== 31337 || recovery.productionAuthority !== false
    || recovery.tokenId !== state.tokenId || recovery.owner?.toLowerCase() !== state.owner.toLowerCase()
    || recovery.progression?.toLowerCase() !== state.progression.toLowerCase() || !Array.isArray(recovery.records)
    || recovery.records.length > 4096 || new Set(recovery.records.map(r => r?.intentId)).size !== recovery.records.length
    || recovery.records.some(r => !r || !/^[0-9a-f]{64}$/.test(r.intentId) || r.tokenId !== state.tokenId || r.recoveryOnly !== true
      || r.chainId !== 31337 || !allowed.includes(r.status)
      || r.owner?.toLowerCase() !== state.owner.toLowerCase() || r.progression?.toLowerCase() !== state.progression.toLowerCase()
      || (r.transactionHash !== null && !HASH.test(r.transactionHash))
      || (['SUBMITTED', 'CONFIRMED', 'REVERTED'].includes(r.status) && !HASH.test(r.transactionHash)))
    || recovery.records.filter(r => !['CONFIRMED', 'REVERTED'].includes(r.status)).length > 1) throw Error('Unverified training recovery');
  return recovery;
}
export function createTrainingControl({ root, getSelection, request, localOnly }) {
  if (localOnly !== true || window.location.hostname !== '127.0.0.1' || window.location.protocol !== 'http:') throw Error('Local training adapter is not available here');
  let data = null, selected = null, selectedIdentity = null, sequence = 0, busy = false;
  const pendingReviews = new Map();
  const status = node('p', 'Load a disposable test Punk.', 'forge-note'); status.setAttribute('role', 'status');
  const refresh = node('button', 'REFRESH CONTRACT STATE', 'filter-button'); refresh.type = 'button';
  const recheck = node('button', 'RECHECK TRANSACTION RECEIPT', 'filter-button'); recheck.type = 'button'; recheck.hidden = true;
  const recoveryBox = node('section', '', 'forge-training-recovery'); recoveryBox.hidden = true;
  const recoveryLabel = node('label', 'Already have this test transaction’s hash?');
  const recoveryInput = node('input'); recoveryInput.type = 'text'; recoveryInput.maxLength = 66;
  recoveryInput.autocomplete = 'off'; recoveryInput.spellcheck = false; recoveryInput.placeholder = '0x…';
  recoveryInput.setAttribute('aria-label', 'Exact local training transaction hash');
  recoveryLabel.append(recoveryInput);
  const recoverButton = node('button', 'VERIFY EXISTING HASH · NO SEND', 'filter-button'); recoverButton.type = 'button';
  recoveryBox.append(recoveryLabel, node('p', 'Only the reviewed account, nonce, contract and action can match. This never resubmits.'), recoverButton);
  const stats = node('p', '', 'forge-training-stats');
  const slots = node('div', '', 'forge-slots');
  const library = node('div', '', 'forge-library');
  const tools = node('section', '', 'forge-training-tools');
  const history = node('ol', '', 'forge-training-history');
  const result = node('pre', '', 'forge-training-result');
  const modal = node('dialog', '', 'forge-training-confirm');
  const warning = node('p', 'DISPOSABLE CHAIN 31337 · No MetaMask, real Punk, production skill or production ETH. Burn stays locked.', 'forge-banner');
  root.replaceChildren(warning, refresh, recheck, recoveryBox, status, stats, node('h3', 'PUNK LOADOUT · LOCAL CONTRACT'), slots,
    node('h3', 'LEARN · THEN EQUIP'), library, tools, result, node('h3', 'CONFIRMED TRAINING HISTORY'), history, modal);
  const isCurrent = (ticket, token) => ticket === sequence && identity(getSelection()) === selectedIdentity && String(getSelection()?.tokenId) === String(token);
  function clear() { data = null; stats.textContent = ''; slots.replaceChildren(); library.replaceChildren(); tools.replaceChildren(); result.textContent = ''; history.replaceChildren(); if (modal.open) modal.close(); }
  const button = (text, fn, disabled = false) => { const b = node('button', text, 'filter-button'); b.type = 'button'; b.disabled = disabled || busy || pendingReviews.has(Number(selected)); b.addEventListener('click', fn); return b; };
  function render() {
    refresh.disabled = busy;
    recheck.hidden = !pendingReviews.has(Number(selected)); recheck.disabled = busy;
    recoveryBox.hidden = !pendingReviews.has(Number(selected)) || Boolean(pendingReviews.get(Number(selected))?.transactionHash);
    recoveryInput.disabled = busy; recoverButton.disabled = busy;
    if (!data) return;
    stats.textContent = `TEST PUNK #${data.tokenId} · ${data.credits} CREDIT(S) · ${data.learned.length} LEARNED · ${data.equipped.filter(k => !ZERO.test(k)).length}/${data.slots} EQUIPPED`;
    slots.replaceChildren(); library.replaceChildren(); tools.replaceChildren(); history.replaceChildren();
    for (let i = 0; i < data.cap; i++) {
      const key = data.equipped[i]; const skill = data.skills.find(s => s.key === key); const locked = i >= data.slots;
      const slot = node('article', '', `forge-socket ${skill ? 'is-equipped' : ''}`);
      slot.append(node('span', `SLOT ${i + 1}`));
      if (skill) { const image = node('img'); image.src = `/assets/skill-forge/v1/${skill.id === 3 ? 'contract-detective' : skill.id === 4 ? 'rarity-eye' : 'sniper'}.png`; image.alt = ''; slot.append(image); }
      slot.append(node('strong', skill?.name ?? (locked ? 'LOCKED' : 'EMPTY')));
      if (locked) slot.append(button('UNLOCK · 1 CREDIT', () => review('unlock'), data.credits === '0' || i !== data.slots));
      else {
        const select = node('select'); select.setAttribute('aria-label', `Skill for slot ${i + 1}`);
        select.append(node('option', 'Choose learned skill')); select.firstChild.value = '';
        for (const learned of data.learned) { const s = data.skills.find(x => x.key === learned.key); if (!s || data.equipped.includes(s.key)) continue;
          const option = node('option', s.name); option.value = s.key; select.append(option); }
        select.disabled = busy || pendingReviews.has(Number(selected)) || select.options.length < 2;
        slot.append(select, button('REVIEW EQUIP', () => select.value && review('equip', { slot: i, key: select.value }), select.disabled));
        if (skill) slot.append(button('UNEQUIP', () => review('unequip', { slot: i })));
      }
      slots.append(slot);
    }
    for (const s of data.skills.filter(s => [2, 3, 4].includes(s.id))) {
      const learned = data.learned.some(l => l.key === s.key);
      const card = node('article', '', 'forge-skill');
      card.append(node('h3', s.name), node('p', learned ? 'LEARNED · Remains attached to this test token.' : 'Local fixture · 1 training credit. Learning does not equip.'),
        button(learned ? 'LEARNED' : 'REVIEW LEARN · 1 CREDIT', () => review('learn', { key: s.key }), learned || data.credits === '0'));
      library.append(card);
    }
    tools.append(node('h3', 'EQUIPPED TOOL ACCESS'), node('p', 'Fresh contract-backed gate. Research targets the real Gogh collection on Robinhood; training remains local.'));
    for (const name of ['inspect_contract', 'rank_trait_sample']) {
      const allowed = data.capabilityContext.effectiveMcpTools.includes(name);
      tools.append(button(`${name.replaceAll('_', ' ').toUpperCase()} · ${allowed ? 'RUN' : 'UNEQUIPPED / LOCKED'}`, () => runTool(name), !allowed));
    }
    tools.append(node('p', 'Sniper has no implemented execution tool here. A learned icon never grants minting or purchasing.'));
    for (const event of data.history) { const item = node('li', `${event.name.replace(/([a-z])([A-Z])/g, '$1 $2')} · block ${event.blockNumber}`);
      item.append(node('small', event.transactionHash)); history.append(item); }
  }
  async function load() {
    const selection = getSelection(), token = selection?.tokenId; selected = token; selectedIdentity = identity(selection);
    const ticket = ++sequence; busy = true; recoveryInput.value = ''; clear(); render();
    status.textContent = 'Reading confirmed local contract state…';
    try {
      if (selection?.chainId !== 31337 || ![1, 44, 7].includes(Number(token))) throw Error('Select a disposable test Punk on chain 31337.');
      const next = validateTrainingSnapshot(await request(`/api/forge?tokenId=${token}`), token);
      if (selection.owner && selection.owner.toLowerCase() !== next.owner.toLowerCase()) throw Error('Selected owner no longer controls this test Punk.');
      if (!isCurrent(ticket, token)) return;
      const recovery = await request('/api/local-training/recover', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forge-nonce': next.localTrainingNonce }, body: JSON.stringify({ tokenId: Number(token) }) });
      if (!isCurrent(ticket, token)) return;
      validateTrainingRecovery(recovery, next);
      pendingReviews.delete(Number(token));
      const pending = recovery.records.find(r => ['CHECKING', 'AWAITING_WALLET', 'SUBMITTED', 'SUBMISSION_UNKNOWN'].includes(r.status));
      if (pending) pendingReviews.set(Number(token), { prepared: { intentId: pending.intentId }, captured: next, transactionHash: pending.transactionHash });
      data = next; status.textContent = pending ? 'Recovered an unresolved training request. Recheck its receipt; new transactions stay locked.'
        : `Confirmed local snapshot at block ${data.blockNumber}. No production permissions.`;
    } catch (e) { if (isCurrent(ticket, token)) { clear(); status.textContent = e.message; } }
    finally { if (isCurrent(ticket, token)) { busy = false; render(); } }
  }
  async function review(operation, extra = {}) {
    if (busy || !data || pendingReviews.has(Number(selected))) return;
    const captured = data, token = data.tokenId, ticket = sequence;
    busy = true; render(); status.textContent = 'Preparing exact transaction and gas estimate. Nothing submitted.';
    let prepared;
    try {
      prepared = validateTrainingReview(await request('/api/local-training/prepare', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forge-nonce': captured.localTrainingNonce },
        body: JSON.stringify({ tokenId: token, expectedBlock: captured.blockNumber, operation, ...extra }) }), captured, { operation, ...extra });
      if (!isCurrent(ticket, token)) return;
    } catch (e) { if (isCurrent(ticket, token)) { clear(); status.textContent = `${e.message} Refresh before reviewing again.`; } return; }
    finally { if (isCurrent(ticket, token)) { busy = false; render(); } }
    modal.replaceChildren(node('h3', `REVIEW ${operation.toUpperCase()} · TEST ONLY`),
      node('p', `Local Punk #${token} · chain 31337 · ${['learn', 'unlock'].includes(operation) ? 'cost: 1 training credit' : 'cost: 0 training credits'}`),
      node('p', `Skill: ${data.skills.find(s => s.key === extra.key)?.name ?? (operation === 'unlock' ? 'one additional slot' : `slot ${(extra.slot ?? 0) + 1}`)}`),
      node('p', `Progression contract: ${captured.progression}`),
      node('p', `ETH value: 0 · Estimated gas: ${prepared.estimatedGas} · Maximum test-network fee: ${prepared.maximumNetworkFeeWei} wei`),
      node('p', `Exact account nonce: ${BigInt(prepared.transaction.nonce)}`),
      node('p', `Review expires: ${new Date(prepared.expiresAt).toLocaleTimeString()}`),
      node('p', 'This submits a disposable local transaction. No real Punk is burned.'));
    const confirm = button('CONFIRM LOCAL TRANSACTION', async () => {
      if (busy || !isCurrent(ticket, token) || data !== captured) { modal.close(); return; }
      if (Date.now() > prepared.expiresAt) { modal.close(); status.textContent = 'Review expired. Refresh and prepare again.'; return; }
      pendingReviews.set(token, { prepared, captured });
      modal.close(); await submitPrepared(token, ticket);
    });
    modal.append(button('CANCEL', () => modal.close()), confirm); modal.showModal();
  }
  async function submitPrepared(token, ticket, reconcileOnly = false, recoveryHash = null) {
      const pending = pendingReviews.get(token); if (busy || !pending) return;
      const { prepared, captured } = pending;
      busy = true; render(); status.textContent = reconcileOnly ? 'Checking the saved transaction receipt. No wallet request will be made.'
        : 'Rechecking owner and state; submitting the exact reviewed transaction…';
      try {
        const response = await request(`/api/local-training/${recoveryHash ? 'recover-hash' : reconcileOnly ? 'status' : 'confirm'}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-nonce': captured.localTrainingNonce },
          body: JSON.stringify({ intentId: prepared.intentId, ...(recoveryHash ? { transactionHash: recoveryHash } : {}) }) });
        if (!isCurrent(ticket, token)) return;
        if (response.localOnly !== true || response.chainId !== 31337 || response.productionAuthority !== false || response.intentId !== prepared.intentId
          || !['CONFIRMED', 'SUBMITTED', 'AWAITING_WALLET', 'REVERTED', 'INVALIDATED', 'REJECTED', 'SUBMISSION_UNKNOWN', 'NOT_SUBMITTED', 'RECOVERY_REQUIRED'].includes(response.status)) throw Error('Transaction status could not be verified');
        if (response.transactionHash != null && !HASH.test(response.transactionHash)) throw Error('Unverified transaction hash');
        if (response.transactionHash) pending.transactionHash = response.transactionHash;
        if (response.status !== 'CONFIRMED') {
          clear();
          const terminal = ['REVERTED', 'INVALIDATED', 'REJECTED', 'NOT_SUBMITTED'].includes(response.status);
          if (terminal) pendingReviews.delete(token);
          status.textContent = `LOCAL TRANSACTION ${response.status}: ${response.transactionHash ?? 'no confirmed transaction hash'}. ${terminal ? 'Refresh state and prepare a new review.' : 'Recheck receipt; do not submit another transaction.'}`; return;
        }
        if (!HASH.test(response.transactionHash)) throw Error('Transaction receipt could not be verified');
        const next = response.snapshot ? validateTrainingSnapshot(response.snapshot, token) : null;
        pendingReviews.delete(token);
        data = next; clearViewAfterReceipt();
        status.textContent = `LOCAL TRANSACTION CONFIRMED: ${response.transactionHash}${next ? '' : ' · Refresh to retrieve progression.'}`;
      } catch (e) { if (isCurrent(ticket, token)) { clear(); status.textContent = `${e.message} Submission may be unresolved. Recheck this receipt; do not create a second transaction.`; } }
      finally { if (isCurrent(ticket, token)) { busy = false; render(); } }
  }
  function clearViewAfterReceipt() { slots.replaceChildren(); library.replaceChildren(); tools.replaceChildren(); result.textContent = ''; history.replaceChildren(); if (!data) stats.textContent = ''; }
  async function runTool(name) {
    if (busy || !data) return; const captured = data, ticket = sequence, token = data.tokenId;
    busy = true; result.textContent = ''; render(); status.textContent = 'Checking equipment and running read-only research…';
    try { const response = await request('/api/local-tool', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-nonce': captured.localTrainingNonce }, body: JSON.stringify({ tokenId: token, name }) });
      if (!isCurrent(ticket, token)) return;
      if (response.localOnly !== true || response.chainId !== 31337 || response.productionAuthority !== false || response.tokenId !== token || response.walletAuthority !== 'NONE') throw Error('Unverified research response');
      data = validateTrainingSnapshot(response.snapshot, token);
      result.textContent = JSON.stringify(response.result, null, 2); status.textContent = 'Research completed through the equipped-skill gate. Wallet authority: NONE.';
    } catch (e) { if (isCurrent(ticket, token)) { clear(); status.textContent = `${e.message} Refresh equipment before retrying.`; } }
    finally { if (isCurrent(ticket, token)) { busy = false; render(); } }
  }
  refresh.addEventListener('click', load);
  recheck.addEventListener('click', () => submitPrepared(Number(selected), sequence, true));
  recoverButton.addEventListener('click', () => {
    const hash = recoveryInput.value.trim();
    if (!HASH.test(hash)) { status.textContent = 'Enter the complete 0x-prefixed transaction hash. No request was sent.'; return; }
    return submitPrepared(Number(selected), sequence, true, hash);
  });
  const selectionChanged = () => { if (identity(getSelection()) !== selectedIdentity) return load(); };
  selectionChanged();
  return { selectionChanged };
}
