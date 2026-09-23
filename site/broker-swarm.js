// Holder batch planning only. Every Punk uses the existing owner-reviewed mission
// endpoint and wallet flow; this module has no signer, scheduler or spending API.
import { buildSwarmFunding, restoreSwarmFunding, fundingIdentity, fundingJournalReference,
  ownerAllocationTransaction, allocationFundingStatus } from './broker-swarm-funding.js';
const LIMITS = ['1', '2', '3', '5', '10'];
const STATES = ['QUEUED', 'REVIEW', 'AUTHORIZING', 'AUTHORIZED', 'CHECK_STATUS'];
export function swarmCommand({ mode, target = '', daily, total, duration = 'FIXED' }) {
  if (!['SEARCH', 'DIRECTED'].includes(mode) || !LIMITS.includes(daily)
    || !(LIMITS.includes(total) || duration === 'KEEP_HUNTING' && total === '100')
    || !['FIXED', 'KEEP_HUNTING'].includes(duration)) throw Error('Choose supported per-Punk limits.');
  const contract = target.trim().toLowerCase();
  if (mode === 'DIRECTED' && (!/^0x[0-9a-f]{40}$/.test(contract) || BigInt(contract) === 0n)) throw Error('Enter the full Robinhood Chain collection contract.');
  const scope = mode === 'SEARCH' ? 'Clear my collection target.' : `Mint from ${contract}.`;
  const renewal = duration === 'KEEP_HUNTING' ? ' Keep hunting for up to 100 mints over 30 days.' : '';
  return `Autonomously find and mint free mints. ${scope} Max ${daily} mints per day and ${duration === 'KEEP_HUNTING' ? '100' : total} mints total.${renewal} Keep my existing art preferences, gas limit, reserve, blocked contracts and all other rules. Show the complete rules for review.`;
}
export function buildSwarmPlan({ owner, chainId, tokenIds, ownedTokenIds, options, fundingBatchId }) {
  if (!/^0x[0-9a-f]{40}$/i.test(owner ?? '') || chainId !== 4663) throw Error('Connect your owner wallet on Robinhood Chain.');
  if (!Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > 10 || new Set(tokenIds).size !== tokenIds.length
    || !Array.isArray(ownedTokenIds)
    || tokenIds.some(id => !/^[1-9][0-9]{0,3}$/.test(id) || Number(id) > 5016 || !ownedTokenIds.includes(id))) throw Error('Choose up to 10 currently owned Punks.');
  const command = swarmCommand(options);
  const total = options.duration === 'KEEP_HUNTING' ? '100' : options.total;
  const fundingBudgetEth = options.fundingBudgetEth ?? '';
  const funding = fundingBudgetEth === '' ? null : buildSwarmFunding({ owner, chainId, tokenIds, totalEth: fundingBudgetEth, batchId: fundingBatchId });
  return { owner: owner.toLowerCase(), chainId, options: { mode: options.mode, target: options.mode === 'DIRECTED' ? options.target.trim().toLowerCase() : '', daily: options.daily, total, duration: options.duration ?? 'FIXED', fundingBudgetEth: funding?.totalEth ?? '' },
    command, rows: tokenIds.map(tokenId => ({ tokenId, status: 'QUEUED', intentHash: null })),
    funding,
    dailyMaximum: tokenIds.length * Number(options.daily), totalMaximum: tokenIds.length * Number(total) };
}
export function mountSwarm({ root, getContext, getPunks, openReview, openStatus, openFunding, getFundingState = () => null, storage }) {
  const doc = root.ownerDocument, make = (tag, text) => { const n = doc.createElement(tag); if (text) n.textContent = text; return n; };
  // Browsers may throw while accessing the storage property itself (privacy
  // settings, disabled persistence). Keep the rest of the Control Center usable.
  try {
    if (storage === undefined) storage = globalThis.sessionStorage;
    if (!storage || ['getItem', 'setItem', 'removeItem'].some(key => typeof storage[key] !== 'function')) throw Error('Storage unavailable');
  } catch { storage = null; }
  let contextKey = '', rosterKey = '', plan = null, busy = false, message = '', generation = 0;
  let draft = { selected: new Set(), values: {} }, draftForm = null, draftFields = null, draftChecks = null;
  function clearDraft() {
    draft = { selected: new Set(), values: {} }; draftForm = null; draftFields = null; draftChecks = null;
  }
  function captureDraft() {
    if (!draftForm) return null;
    draft.values = Object.fromEntries(Object.entries(draftFields).map(([name, input]) => [name, input.value]));
    draft.selected = new Set([...draftChecks].filter(([, input]) => input.checked).map(([id]) => id));
    const field = Object.entries(draftFields).find(([, input]) => input === doc.activeElement);
    if (field) return { field: field[0], start: field[1].selectionStart, end: field[1].selectionEnd };
    const check = [...draftChecks].find(([, input]) => input === doc.activeElement);
    return check ? { tokenId: check[0] } : null;
  }
  const currentKey = () => { const c = getContext(); return c?.chainId === 4663 && /^0x[0-9a-f]{40}$/i.test(c.owner ?? '') ? c.owner.toLowerCase() : ''; };
  const storageKey = () => `gogh-swarm-review-v1:4663:${contextKey}`;
  const save = () => { const text = JSON.stringify(plan); storage.setItem(storageKey(), text); if (storage.getItem(storageKey()) !== text) throw Error('Swarm progress could not be saved. Free device storage before continuing.'); };
  function refresh() {
    const next = currentKey(), roster = [...new Set(getPunks().map(p => String(p.tokenId)))].sort().join(',');
    // Status polling must not replace an in-progress form or steal its focus.
    // Existing batch receipts still update, using passive journal reads only.
    if (contextKey === next && rosterKey === roster) { if (plan) render(); return; }
    const changed = next !== contextKey; contextKey = next; rosterKey = roster; generation++; busy = false;
    if (changed) {
      busy = false; plan = null; message = ''; clearDraft();
      if (next && storage) try {
        const raw = storage.getItem(storageKey());
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.owner !== next || saved.chainId !== 4663 || !Array.isArray(saved.rows) || saved.rows.some(r => !STATES.includes(r.status))) throw Error('Invalid saved batch');
          // Progress is informational, never transaction authority. A restored
          // review/attempt must be checked, not automatically submitted again.
          plan = buildSwarmPlan({ ...saved, fundingBatchId: saved.funding?.batchId, tokenIds: saved.rows.map(r => r.tokenId), ownedTokenIds: saved.rows.map(r => r.tokenId) });
          if (plan.funding) plan.funding = restoreSwarmFunding(saved.funding, { owner: next, chainId: 4663,
            tokenIds: saved.rows.map(r => r.tokenId), totalEth: plan.options.fundingBudgetEth });
          else if (saved.funding) throw Error('Saved funding has no matching budget');
          plan.rows = saved.rows.map(r => ({ tokenId: r.tokenId, status: r.status === 'QUEUED' ? 'QUEUED' : 'CHECK_STATUS', intentHash: null }));
          message = 'Saved batch restored. Check previously reviewed Punks before any new authorization.';
        }
      } catch { plan = null; message = 'Saved batch is unavailable. Check each Punk’s mission status before creating another batch.'; }
    }
    render();
  }
  function button(parent, text, action, disabled = false) {
    const n = make('button', text); n.type = 'button'; n.className = 'outline-button'; n.disabled = busy || disabled;
    n.addEventListener('click', () => { if (!n.disabled) void action(); }); parent.append(n); return n;
  }
  async function review(row) {
    const ticket = ++generation, key = contextKey;
    const current = () => ticket === generation && key === currentKey();
    if (!plan || !current() || !['QUEUED', 'REVIEW'].includes(row.status) || !getPunks().some(p => String(p.tokenId) === row.tokenId)) return;
    busy = true;
    try {
      row.status = 'REVIEW'; save(); message = `Preparing Punk #${row.tokenId}. No mission has been authorized.`; render();
      const draft = await openReview({ tokenId: row.tokenId, command: plan.command });
      if (!current()) return;
      if (!draft?.intentHash || draft.intent?.punkTokenId !== row.tokenId || draft.intent.expectedOwner !== key) throw Error('The mission review could not be prepared. Open this Punk to check its status and funding.');
      row.intentHash = draft.intentHash; save(); message = `Review Punk #${row.tokenId} and authorize it in your wallet. Other Punks are still waiting.`;
    } catch (error) { if (current()) { row.status = 'CHECK_STATUS'; message = error.message; try { save(); } catch { /* No wallet action is available from this row. */ } } }
    finally { if (current()) { busy = false; render(); } }
  }
  function authorization({ tokenId, intentHash }, status) {
    const row = plan?.rows.find(r => r.tokenId === tokenId && r.intentHash === intentHash);
    if (!row || contextKey !== currentKey() || !['AUTHORIZING', 'AUTHORIZED', 'CHECK_STATUS'].includes(status)) return;
    row.status = status; save(); message = status === 'AUTHORIZED' ? `Punk #${tokenId}’s mission was authorized. Review the next Punk when ready.`
      : status === 'AUTHORIZING' ? `Waiting for Punk #${tokenId}’s wallet confirmation. No other Punk will open a request.`
        : `Check Punk #${tokenId}’s status before retrying. This batch will not resend its authorization.`;
    render();
  }
  function fundingCurrent() {
    if (!plan?.funding || contextKey !== currentKey()) throw Error('The swarm funding selection changed. Reopen the original batch.');
    const saved = JSON.parse(storage.getItem(storageKey()));
    if (fundingIdentity(saved?.funding) !== fundingIdentity(plan.funding)) throw Error('The saved funding allocation changed. Check original transfers before continuing.');
    return plan.funding;
  }
  function fundingStatus(allocation) {
    try { return allocationFundingStatus(plan.funding, allocation, getFundingState(allocation.tokenId)); }
    catch { return 'CHECK_STATUS'; }
  }
  function fundingContext(tokenId) {
    try {
      const funding = fundingCurrent(), allocation = funding.allocations.find(row => row.tokenId === tokenId);
      if (!allocation?.opened || !getPunks().some(p => String(p.tokenId) === tokenId) || fundingStatus(allocation) === 'CONFIRMED') return null;
      return { batchId: funding.batchId, owner: funding.owner, chainId: 4663, tokenId,
        amountWei: allocation.amountWei, amountEth: allocation.amountEth };
    } catch { return null; }
  }
  function fundingPrepared({ batchId, tokenId, prepared }) {
    const funding = fundingCurrent(), allocation = funding.allocations.find(row => row.tokenId === tokenId);
    if (!allocation?.opened || funding.batchId !== batchId || !fundingContext(tokenId)
      || prepared?.source !== 'OWNER' || prepared.owner !== funding.owner || prepared.tokenId !== tokenId
      || prepared.amountWei !== allocation.amountWei || prepared.amount !== allocation.amountEth
      || prepared.destination !== prepared.transaction?.to
      || !ownerAllocationTransaction(prepared.transaction, funding.owner, allocation.amountWei)) throw Error('This transfer does not match the reviewed Swarm allocation. No funding was authorized.');
    if (allocation.transaction) {
      if (!['REVIEW', 'REJECTED'].includes(fundingStatus(allocation))) throw Error('This allocation already has a funding attempt. Recover its original transaction; do not send another deposit.');
      if (fundingIdentity(prepared.transaction) !== fundingIdentity(allocation.transaction)) throw Error('This saved review no longer matches your wallet. Check original deposits in wallet activity, then close this planner and create a new budget for only the Punks that still need gas. Do not repeat a pending deposit.');
    }
    const record = getFundingState(tokenId);
    if (['WALLET_REQUESTED', 'SUBMITTED'].includes(record?.status)
      || (record?.status !== 'REJECTED' && record?.transaction && fundingIdentity(record.transaction) === fundingIdentity(prepared.transaction))) throw Error('Check the original funding record before preparing another deposit.');
    allocation.transaction = structuredClone(prepared.transaction); save(); render();
    return fundingContext(tokenId);
  }
  async function fund(allocation) {
    if (busy || typeof openFunding !== 'function' || !plan?.funding?.allocations.includes(allocation)) return;
    const ticket = ++generation, key = contextKey;
    const current = () => ticket === generation && key === currentKey() && getPunks().some(p => String(p.tokenId) === allocation.tokenId);
    if (!current()) return;
    busy = true;
    try {
      const funding = fundingCurrent();
      if (!allocation.opened) {
        allocation.baseline = fundingJournalReference(getFundingState(allocation.tokenId), funding.owner, allocation.tokenId);
        allocation.opened = true;
      }
      save();
      message = `Open Punk #${allocation.tokenId}’s funding review. Review and confirm this deposit separately in your wallet.`; render();
      await openFunding({ tokenId: allocation.tokenId, amountWei: allocation.amountWei, amountEth: allocation.amountEth, batchId: funding.batchId });
      if (current()) message = 'Funding review opened. Check the saved deposit status here. A new deposit needs your wallet confirmation; the next Punk will wait for you.';
    } catch (error) { if (current()) message = error.message; }
    finally { if (current()) { busy = false; render(); } }
  }
  function render() {
    const focus = captureDraft();
    draftForm = null; draftFields = null; draftChecks = null;
    root.replaceChildren(); root.classList.add('swarm-panel'); root.setAttribute('aria-busy', String(busy));
    root.append(make('h3', 'SWARM · MULTIPLE PUNKS'), make('p', 'Choose up to 10 Punks owned by this wallet. Search supported free mints, or direct them to one free-mint collection. Each Punk keeps its own wallet, gas cap, reserve, taste and safety rules.'));
    root.append(make('p', 'Review and authorize each Punk separately. Account setup and permissions may cost network gas. Funding is separate. Shared discovery continues after authorization; this page does not need to stay open. A free mint is never guaranteed.'));
    if (!storage) { const note = make('p', 'Swarm planning is unavailable because this browser cannot save progress. Enable site storage or use another browser, then reload. No mission was started. You can still use individual Punk controls.'); note.setAttribute('role', 'status'); root.append(note); return; }
    if (message) { const note = make('p', message); note.setAttribute('role', 'status'); root.append(note); }
    if (!contextKey) { root.append(make('p', 'Connect your owner wallet on Robinhood Chain to choose Punks.')); return; }
    if (plan) {
      root.append(make('p', `${plan.rows.length} Punks · Up to ${plan.options.daily} per day and ${plan.options.total} total EACH. Combined maximum: ${plan.dailyMaximum} per day, ${plan.totalMaximum} total. ${plan.options.mode === 'SEARCH' ? 'Previous collection targets will be cleared in each new review.' : `Collection: ${plan.options.target}`}`));
      if (plan.options.duration === 'KEEP_HUNTING') root.append(make('p', 'Keep hunting · each Punk needs its own permission for up to 100 mints or 30 days, whichever comes first. Gas, reserve and daily limits can stop spending earlier. Renew in your wallet to continue afterward; renewal is never automatic.'));
      if (plan.funding) {
        root.append(make('h4', 'FUND SWARM'), make('p', `Total deposits: exactly ${plan.funding.totalEth} ETH, split between ${plan.rows.length} Punk Agent Accounts. Your connected wallet pays additional network fees for each separate deposit. Funds go directly to each Punk; there is no shared custody or automatic refill.`));
        root.append(make('p', 'Any indivisible remainder goes one wei at a time to the lowest Punk numbers. Review amounts below. Funding does not activate a mission; review each Punk’s mission separately. Finish each deposit before opening another. Once prepared, its amount and wallet transaction cannot change inside this batch.'));
        if (typeof openFunding !== 'function') root.append(make('p', 'Funding review is unavailable on this page. Use each Punk’s Fund screen.'));
      }
      for (const row of plan.rows) {
        const item = make('article'); const owned = getPunks().some(p => String(p.tokenId) === row.tokenId);
        const label = { QUEUED: 'Waiting for review', REVIEW: 'Awaiting your review', AUTHORIZING: 'Wallet confirmation pending', AUTHORIZED: 'Mission authorized · check live status', CHECK_STATUS: 'Check status before continuing' }[row.status];
        item.append(make('strong', `Punk #${row.tokenId} · ${owned ? label : 'Ownership changed · unavailable'}`));
        const allocation = plan.funding?.allocations.find(a => a.tokenId === row.tokenId);
        if (allocation) {
          const status = fundingStatus(allocation), fundingLabel = { NOT_REVIEWED: 'Deposit not reviewed', REVIEW: 'Review required · not confirmed', WALLET_REQUESTED: 'Wallet result pending · recover original request', SUBMITTED: 'Deposit submitted · check original receipt', CONFIRMED: 'Deposit confirmed in saved receipt', REVERTED: 'Deposit reverted · check history', REJECTED: 'Wallet request cancelled · review original allocation', CHECK_STATUS: 'Funding is not verified · check original history' }[status];
          item.append(make('p', `${allocation.amountEth} ETH · ${fundingLabel}`));
          if (status !== 'CONFIRMED') button(item, `${['NOT_REVIEWED', 'REVIEW', 'REJECTED'].includes(status) ? 'REVIEW FUNDING' : 'CHECK FUNDING'} #${row.tokenId}`, () => fund(allocation),
            !owned || typeof openFunding !== 'function' || plan.rows.some(r => r.status === 'AUTHORIZING'));
        }
        if (['QUEUED', 'REVIEW'].includes(row.status)) button(item, `REVIEW PUNK #${row.tokenId}`, () => review(row), !owned || plan.rows.some(r => r.status === 'AUTHORIZING'));
        button(item, 'OPEN PUNK / CHECK STATUS', () => openStatus(row.tokenId), !owned || plan.rows.some(r => r.status === 'AUTHORIZING'));
        root.append(item);
      }
      root.append(make('p', 'Closing this batch does not pause authorized missions. Use Pause on each Punk to stop new work; submitted transactions still need confirmation.'));
      button(root, 'CLOSE BATCH PLANNER', () => { storage.removeItem(storageKey()); plan = null; message = ''; clearDraft(); render(); }, plan.rows.some(r => r.status === 'AUTHORIZING'));
      return;
    }
    const ownedIds = new Set(getPunks().map(p => String(p.tokenId)));
    draft.selected = new Set([...draft.selected].filter(id => ownedIds.has(id)));
    const form = make('form'), selected = draft.selected, fields = {}, checks = new Map(), renderedOwner = contextKey;
    const roster = make('fieldset'); roster.append(make('legend', 'Choose your Punks'));
    for (const punk of getPunks()) { const id = String(punk.tokenId), label = make('label'), input = make('input'); input.type = 'checkbox'; input.value = id; input.checked = selected.has(id); checks.set(id, input);
      input.addEventListener('change', () => { input.checked ? selected.add(id) : selected.delete(id); });
      label.append(input, make('span', `Punk #${id}`)); roster.append(label); }
    form.append(roster);
    for (const [name, title, choices] of [['mode', 'Mission', [['SEARCH', 'Search supported free mints'], ['DIRECTED', 'Mint from one free collection']]],
      ['daily', 'Maximum mints per Punk per day', LIMITS.map(x => [x, x])],
      ['duration', 'How long to hunt', [['FIXED', 'Stop at my mission total'], ['KEEP_HUNTING', 'Keep hunting · up to 100 mints / 30 days']]],
      ['total', 'Maximum total mints per Punk', LIMITS.map(x => [x, x])]]) {
      const label = make('label', title), input = make('select'); input.name = name;
      for (const [value, text] of choices) { const option = make('option', text); option.value = value; input.append(option); }
      label.append(input); form.append(label); fields[name] = input;
    }
    const targetLabel = make('label', 'Collection contract · directed free mints only'), target = make('input'); target.placeholder = '0x…'; target.maxLength = 42; target.name = 'target'; targetLabel.append(target); targetLabel.hidden = true; form.append(targetLabel); fields.target = target;
    fields.mode.addEventListener('change', () => { targetLabel.hidden = fields.mode.value !== 'DIRECTED'; });
    fields.duration.addEventListener('change', () => { fields.total.disabled = fields.duration.value === 'KEEP_HUNTING'; });
    if (typeof openFunding === 'function') {
      const label = make('label', 'Optional total gas funding budget (ETH)'), input = make('input'); input.name = 'fundingBudgetEth'; input.value = ''; input.inputMode = 'decimal'; input.maxLength = 21; input.placeholder = 'Example: 0.003';
      label.append(input); form.append(label); fields.fundingBudgetEth = input;
      form.append(make('p', 'Leave blank to skip funding. Split up to 10 ETH equally, at most 1 ETH per Punk. Each deposit needs its own wallet confirmation and additional network gas. No funds move when you create the plan.'));
    }
    form.append(make('p', 'Keep hunting stops sooner when a Punk reaches its gas reserve, is paused, or fails a safety check. Daily limits still apply. After 100 mints or 30 days, review and renew that Punk’s wallet permission.'));
    for (const [name, input] of Object.entries(fields)) if (Object.hasOwn(draft.values, name)) input.value = draft.values[name];
    targetLabel.hidden = fields.mode.value !== 'DIRECTED'; fields.total.disabled = fields.duration.value === 'KEEP_HUNTING';
    const submit = make('button', 'REVIEW SWARM PLAN'); submit.type = 'submit'; submit.className = 'primary-button'; form.append(submit);
    form.addEventListener('submit', event => { event.preventDefault();
      if (form !== draftForm || renderedOwner !== currentKey()) { refresh(); return; }
      try {
      plan = buildSwarmPlan({ ...getContext(), tokenIds: [...selected], ownedTokenIds: getPunks().map(p => String(p.tokenId)), options: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value])) });
      save(); message = 'Batch planned. No wallet request was made. Review each Punk below.'; render();
    } catch (error) { plan = null; message = error.message; render(); } });
    root.append(form);
    draftForm = form; draftFields = fields; draftChecks = checks;
    const active = focus?.field ? fields[focus.field] : checks.get(focus?.tokenId);
    if (active && !active.disabled) {
      active.focus?.({ preventScroll: true });
      if (Number.isInteger(focus.start) && Number.isInteger(focus.end)) active.setSelectionRange?.(focus.start, focus.end);
    }
  }
  refresh(); render(); return { refresh, authorization, fundingContext, fundingPrepared };
}
