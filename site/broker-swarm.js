// Holder batch planning only. Every Punk uses the existing owner-reviewed mission
// endpoint and wallet flow; this module has no signer, scheduler or spending API.
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
export function buildSwarmPlan({ owner, chainId, tokenIds, ownedTokenIds, options }) {
  if (!/^0x[0-9a-f]{40}$/i.test(owner ?? '') || chainId !== 4663) throw Error('Connect your owner wallet on Robinhood Chain.');
  if (!Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > 10 || new Set(tokenIds).size !== tokenIds.length
    || tokenIds.some(id => !/^[1-9][0-9]{0,3}$/.test(id) || Number(id) > 5016 || !ownedTokenIds.includes(id))) throw Error('Choose up to 10 currently owned Punks.');
  const command = swarmCommand(options);
  const total = options.duration === 'KEEP_HUNTING' ? '100' : options.total;
  return { owner: owner.toLowerCase(), chainId, options: { mode: options.mode, target: options.mode === 'DIRECTED' ? options.target.trim().toLowerCase() : '', daily: options.daily, total, duration: options.duration ?? 'FIXED' },
    command, rows: tokenIds.map(tokenId => ({ tokenId, status: 'QUEUED', intentHash: null })),
    dailyMaximum: tokenIds.length * Number(options.daily), totalMaximum: tokenIds.length * Number(total) };
}
export function mountSwarm({ root, getContext, getPunks, openReview, openStatus, storage }) {
  const doc = root.ownerDocument, make = (tag, text) => { const n = doc.createElement(tag); if (text) n.textContent = text; return n; };
  // Browsers may throw while accessing the storage property itself (privacy
  // settings, disabled persistence). Keep the rest of the Control Center usable.
  try {
    if (storage === undefined) storage = globalThis.sessionStorage;
    if (!storage || ['getItem', 'setItem', 'removeItem'].some(key => typeof storage[key] !== 'function')) throw Error('Storage unavailable');
  } catch { storage = null; }
  let contextKey = '', rosterKey = '', plan = null, busy = false, message = '', generation = 0;
  const currentKey = () => { const c = getContext(); return c?.chainId === 4663 && /^0x[0-9a-f]{40}$/i.test(c.owner ?? '') ? c.owner.toLowerCase() : ''; };
  const storageKey = () => `gogh-swarm-review-v1:4663:${contextKey}`;
  const save = () => { const text = JSON.stringify(plan); storage.setItem(storageKey(), text); if (storage.getItem(storageKey()) !== text) throw Error('Swarm progress could not be saved. Free device storage before continuing.'); };
  function refresh() {
    const next = currentKey(), roster = getPunks().map(p => String(p.tokenId)).join(',');
    if (contextKey === next && rosterKey === roster) return;
    const changed = next !== contextKey; contextKey = next; rosterKey = roster; generation++; busy = false;
    if (changed) {
      busy = false; plan = null; message = '';
      if (next && storage) try {
        const raw = storage.getItem(storageKey());
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.owner !== next || saved.chainId !== 4663 || !Array.isArray(saved.rows) || saved.rows.some(r => !STATES.includes(r.status))) throw Error('Invalid saved batch');
          // Progress is informational, never transaction authority. A restored
          // review/attempt must be checked, not automatically submitted again.
          plan = buildSwarmPlan({ ...saved, tokenIds: saved.rows.map(r => r.tokenId), ownedTokenIds: saved.rows.map(r => r.tokenId) });
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
  function render() {
    root.replaceChildren(); root.classList.add('swarm-panel'); root.setAttribute('aria-busy', String(busy));
    root.append(make('h3', 'SWARM · MULTIPLE PUNKS'), make('p', 'Choose up to 10 Punks owned by this wallet. Search supported free mints, or direct them to one free-mint collection. Each Punk keeps its own wallet, gas cap, reserve, taste and safety rules.'));
    root.append(make('p', 'Review and authorize each Punk separately. Account setup and permissions may cost network gas. Funding is separate. Shared discovery continues after authorization; this page does not need to stay open. A free mint is never guaranteed.'));
    if (!storage) { const note = make('p', 'Swarm planning is unavailable because this browser cannot save progress. Enable site storage or use another browser, then reload. No mission was started. You can still use individual Punk controls.'); note.setAttribute('role', 'status'); root.append(note); return; }
    if (message) { const note = make('p', message); note.setAttribute('role', 'status'); root.append(note); }
    if (!contextKey) { root.append(make('p', 'Connect your owner wallet on Robinhood Chain to choose Punks.')); return; }
    if (plan) {
      root.append(make('p', `${plan.rows.length} Punks · Up to ${plan.options.daily} per day and ${plan.options.total} total EACH. Combined maximum: ${plan.dailyMaximum} per day, ${plan.totalMaximum} total. ${plan.options.mode === 'SEARCH' ? 'Previous collection targets will be cleared in each new review.' : `Collection: ${plan.options.target}`}`));
      if (plan.options.duration === 'KEEP_HUNTING') root.append(make('p', 'Keep hunting · each Punk needs its own permission for up to 100 mints or 30 days, whichever comes first. Gas, reserve and daily limits can stop spending earlier. Renew in your wallet to continue afterward; renewal is never automatic.'));
      for (const row of plan.rows) {
        const item = make('article'); const owned = getPunks().some(p => String(p.tokenId) === row.tokenId);
        const label = { QUEUED: 'Waiting for review', REVIEW: 'Awaiting your review', AUTHORIZING: 'Wallet confirmation pending', AUTHORIZED: 'Mission authorized · check live status', CHECK_STATUS: 'Check status before continuing' }[row.status];
        item.append(make('strong', `Punk #${row.tokenId} · ${owned ? label : 'Ownership changed · unavailable'}`));
        if (['QUEUED', 'REVIEW'].includes(row.status)) button(item, `REVIEW PUNK #${row.tokenId}`, () => review(row), !owned || plan.rows.some(r => r.status === 'AUTHORIZING'));
        button(item, 'OPEN PUNK / CHECK STATUS', () => openStatus(row.tokenId), !owned || plan.rows.some(r => r.status === 'AUTHORIZING'));
        root.append(item);
      }
      root.append(make('p', 'Closing this batch does not pause authorized missions. Use Pause on each Punk to stop new work; submitted transactions still need confirmation.'));
      button(root, 'CLOSE BATCH PLANNER', () => { storage.removeItem(storageKey()); plan = null; message = ''; render(); }, plan.rows.some(r => r.status === 'AUTHORIZING'));
      return;
    }
    const form = make('form'), selected = new Set(), fields = {};
    const roster = make('fieldset'); roster.append(make('legend', 'Choose your Punks'));
    for (const punk of getPunks()) { const id = String(punk.tokenId), label = make('label'), input = make('input'); input.type = 'checkbox'; input.value = id;
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
    form.append(make('p', 'Keep hunting stops sooner when a Punk reaches its gas reserve, is paused, or fails a safety check. Daily limits still apply. After 100 mints or 30 days, review and renew that Punk’s wallet permission.'));
    const submit = make('button', 'REVIEW SWARM PLAN'); submit.type = 'submit'; submit.className = 'primary-button'; form.append(submit);
    form.addEventListener('submit', event => { event.preventDefault(); try {
      plan = buildSwarmPlan({ ...getContext(), tokenIds: [...selected], ownedTokenIds: getPunks().map(p => String(p.tokenId)), options: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value])) });
      save(); message = 'Batch planned. No wallet request was made. Review each Punk below.'; render();
    } catch (error) { plan = null; message = error.message; render(); } });
    root.append(form);
  }
  refresh(); render(); return { refresh, authorization };
}
