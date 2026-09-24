// Guided orchestration only. Existing reviewed clients retain all wallet authority.
import { buildSwarmPlan } from './broker-swarm.js';
import { fundingEth } from './broker-swarm-funding.js';
import { createSwarmSetup, restoreSwarmSetup, captureSwarmSetupFunding,
  swarmSetupFundingStatus, updateSwarmSetupFunding, updateSwarmSetupMission } from './broker-swarm-setup-state.js';
import { mountSwarmWallet } from './swarm-wallet-panel.js';
import { getSwarmWalletRecord } from './swarm-wallet-client.js';
import { createSwarmWalletReadProvider } from './swarm-wallet-rpc.js';
import { mountAgentWalletCreation } from './punk-agent-creation-panel.js';
import { readAgentWalletCreation, getAgentWalletCreationRecord } from './punk-agent-creation.js';

const HASH = /^0x[0-9a-f]{64}$/;
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value)
  && !/^0x0{40}$/i.test(value) ? value.toLowerCase() : null;
const PENDING = ['WALLET_REQUESTED', 'SUBMITTED'];
const LIMITS = ['1', '2', '3', '5', '10'];
export function mountSwarmSetup({ root, getContext, getPunks, getProvider, openReview, checkMission, recoverMission, openStatus,
  storage, readAccount = readAgentWalletCreation, creationOptions = {}, walletOptions = {} }) {
  const doc = root.ownerDocument;
  const el = (tag, text, name) => { const n = doc.createElement(tag); if (text) n.textContent = text;
    if (name) n.setAttribute('data-swarm-setup-' + name, ''); return n; };
  try { storage ??= globalThis.localStorage; if (!storage) throw Error(); } catch { storage = null; }
  let key = '', provider = null, roster = '', setup = null, busy = false, generation = 0,
    stage = 'PLAN', message = '', activeToken = null, walletBound = '', creationControl, walletControl;
  const accounts = new Map();
  const readProvider = creationOptions.readProvider ?? walletOptions.readProvider ?? createSwarmWalletReadProvider();
  let draftFields = null, draftChecks = null;
  const heading = el('h3', 'SET UP YOUR SWARM');
  const intro = el('p', 'Choose your Punks, budget and free-mint rules once. This guide keeps your progress through wallet creation, one gas-funding batch and each Punk’s mission approval.');
  const steps = el('ol', '', 'steps'), summary = el('div', '', 'summary'), content = el('div', '', 'content');
  const note = el('p', '', 'status'); note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
  const creationHost = el('section', '', 'creation'), walletHost = el('section', '', 'wallet');
  creationHost.classList.add('swarm-agent-creation');
  const foot = el('div', '', 'navigation');
  root.classList.add('swarm-setup'); root.replaceChildren(heading, intro, steps, summary, note, content, creationHost, walletHost, foot);
  const context = () => { const c = getContext(); return c?.chainId === 4663 && !c.preview && /^0x[0-9a-f]{40}$/i.test(c.owner ?? '') ? { owner: c.owner.toLowerCase(), chainId: 4663 } : null; };
  const current = () => !!setup && context()?.owner === setup.owner && getProvider() === provider;
  const owned = id => getPunks().some(p => String(p.tokenId) === id);
  const allOwned = () => setup?.tokenIds.every(owned);
  const storeKey = () => `gogh-swarm-setup-v1:4663:${key}`;
  function save() {
    if (!storage || !current()) throw Error('Reconnect the plan’s owner before continuing.');
    const text = JSON.stringify(setup); storage.setItem(storeKey(), text);
    if (storage.getItem(storeKey()) !== text) throw Error('Swarm progress could not be saved. Free device storage before continuing.');
  }
  function rowUpdate(id, patch) { setup = updateSwarmSetupMission(setup, { tokenId: id, status: setup.missions.find(row => row.tokenId === id)?.status, ...patch }); save(); }
  const embeddedBusy = () => creationControl?.getState().busy || walletControl?.getState().busy;
  function button(parent, text, action, disabled = false, name) {
    const b = el('button', text, name); b.type = 'button'; b.className = 'outline-button'; b.disabled = busy || embeddedBusy() || disabled;
    b.addEventListener('click', () => { if (!b.disabled) void run(action); }); parent.append(b); return b;
  }
  async function run(action) {
    if (busy || embeddedBusy() || !current()) return;
    const version = generation, owner = key, selectedProvider = provider;
    const valid = () => generation === version && key === owner && context()?.owner === owner && getProvider() === selectedProvider;
    busy = true; render();
    try { await action(valid); } catch (error) { if (valid()) message = error?.message ?? 'The step could not finish. Your saved requests have not been resent.'; }
    finally { if (valid()) { busy = false; render(); } }
  }
  function fundingStatus() { try { return swarmSetupFundingStatus(setup, walletControl?.getState().record ?? null); } catch { return 'CHECK_STATUS'; } }
  function pendingCreation() { try { const r = (creationOptions.client?.getAgentWalletCreationRecord ?? getAgentWalletCreationRecord)(key, { storage }); return PENDING.includes(r?.status) ? r : null; } catch { return { unreadable: true }; } }
  function nextMissing() { return setup?.tokenIds.find(id => accounts.get(id)?.created !== true); }
  async function inspectWallets(valid) {
    if (!allOwned()) throw Error('A selected Punk is no longer in your wallet. No new action can proceed in this plan.');
    accounts.clear(); message = 'Checking selected Punk wallets. This does not open a wallet approval.';
    for (const tokenId of setup.tokenIds) {
      if (!valid()) return;
      message = `Checking Punk #${tokenId}…`; render();
      const value = await readAccount(getProvider(), { ...context(), tokenId, readProvider });
      if (!valid()) return;
      if (value.owner !== setup.owner || value.tokenId !== tokenId || value.chainId !== 4663) throw Error('A wallet check returned another Punk. Nothing was prepared.');
      accounts.set(tokenId, value);
    }
    const pending = pendingCreation();
    if (pending?.unreadable) throw Error('The saved account-creation request is unreadable. Recover it in Fund before continuing.');
    activeToken = pending?.review?.tokenId ?? nextMissing() ?? null;
    stage = 'WALLETS'; message = activeToken ? 'Create only the missing wallets below. Each creation needs its own wallet confirmation; it starts no mission.' : 'All selected Agent wallets exist. Continue to your gas budget.';
    creationControl.refresh();
    if (activeToken) await creationControl.check();
  }
  async function openFunding(valid) {
    if (nextMissing() || pendingCreation()) throw Error('Finish the saved wallet creation before funding.');
    stage = 'FUND'; message = setup.allocations.length ? 'Your selection and exact allocations are filled in below. Add the shortfall if needed, then review one funding batch.' : 'You chose to use existing gas. Each mission review will verify its balance and reserve before approval.';
    if (setup.allocations.length) {
      walletControl.setFundingPlan({ ...context(), tokenIds: setup.tokenIds, totalEth: setup.options.fundingBudgetEth });
      walletBound = setup.planId;
      await walletControl.check(); if (!valid()) return;
    }
  }
  async function missionReview(row, valid) {
    if (!allOwned() || !['QUEUED', 'REVIEW'].includes(row.status)) return;
    if (setup.missions.some(r => r.status === 'AUTHORIZING' || r.status === 'CHECK_STATUS' && r.attempt)) throw Error('Recover the outstanding mission approval before opening another.');
    rowUpdate(row.tokenId, { status: 'REVIEW', intentHash: null });
    const draft = await openReview({ tokenId: row.tokenId, command: setup.command, options: setup.options, guided: true });
    if (!valid()) return;
    if (draft?.cancelled) { rowUpdate(row.tokenId, { status: 'QUEUED' }); message = 'Review closed. No new mission was approved.'; return; }
    if (!HASH.test(draft?.intentHash ?? '') || draft.intent?.punkTokenId !== row.tokenId || draft.intent?.expectedOwner !== setup.owner) throw Error('This mission review no longer matches the selected Punk.');
    rowUpdate(row.tokenId, { intentHash: draft.intentHash }); message = `Review the full rules for Punk #${row.tokenId}. Funding alone does not start its mission.`;
  }
  async function inspectMission(row, valid) {
    const value = await checkMission(row.tokenId);
    if (!valid()) return;
    const now = Date.now(), runtime = value?.runtime, mission = value?.mission;
    if (value?.ok !== true || value.error || address(value.owner) !== setup.owner || String(value.tokenId) !== row.tokenId
      || value.chainId !== undefined && value.chainId !== 4663
      || !Number.isFinite(value.receivedAt) || value.receivedAt > now || now - value.receivedAt > 90_000
      || typeof runtime?.accountCreated !== 'boolean' || typeof runtime.sessionActive !== 'boolean'
      || runtime.accountCreated && (address(runtime.owner) !== setup.owner || !address(runtime.account))
      || runtime.owner !== undefined && address(runtime.owner) !== setup.owner
      || value.readiness?.databaseReady === false) throw Error('Mission status could not be verified. Sign in with this plan’s owner and retry.');
    const linked = runtime.accountCreated && address(mission?.account) === address(runtime.account)
      && address(mission?.intent?.expectedOwner) === setup.owner && String(mission?.intent?.punkTokenId) === row.tokenId;
    const until = Date.parse(mission?.validUntil), after = Date.parse(mission?.validAfter);
    const matching = !!row.attempt && row.attempt.sessionId === mission?.sessionId
      && HASH.test(mission?.authorizationTransactionHash ?? '')
      && (!row.attempt.transactionHash || row.attempt.transactionHash === mission.authorizationTransactionHash);
    if (runtime.sessionActive === true && linked && mission.status === 'ACTIVE'
      && Number.isFinite(until) && until > now && Number.isFinite(after) && after < until
      && (!row.attempt || matching)) {
      rowUpdate(row.tokenId, { status: matching ? 'AUTHORIZED' : 'EXISTING' });
      message = matching ? `Punk #${row.tokenId}’s approved mission is active.` : `Punk #${row.tokenId} already has an active mission. Its current rules are retained; this plan did not replace them.`;
    } else if (runtime.sessionActive === false && linked && matching
      && ['COMPLETED', 'CANCELLED', 'REVOKED', 'EXPIRED', 'INACTIVE', 'PAUSED'].includes(mission?.status)) {
      rowUpdate(row.tokenId, { status: 'SETTLED' }); message = `Punk #${row.tokenId}’s original mission is ${value.mission.status.toLowerCase()}. It will not be sent again; check Activity for its outcome.`;
    } else if (row.attempt || runtime.sessionActive || value.mission?.status === 'PENDING_RECEIPT') {
      rowUpdate(row.tokenId, { status: 'CHECK_STATUS' }); message = `Punk #${row.tokenId} needs its original approval checked. No new approval will be sent.`;
    } else {
      rowUpdate(row.tokenId, { status: 'QUEUED', intentHash: null }); message = `Punk #${row.tokenId} can open a fresh rules review. Nothing has been started by this check.`;
    }
  }
  function render() {
    root.setAttribute('aria-busy', String(busy)); note.textContent = message;
    steps.replaceChildren();
    for (const [value, label] of [['PLAN', '1 · Choose & review'], ['WALLETS', '2 · Prepare wallets'], ['FUND', '3 · Fund together'], ['MISSIONS', '4 · Approve missions']]) {
      const item = el('li', label); if (stage === value || stage === 'CHECK' && value === 'WALLETS') item.setAttribute('aria-current', 'step'); steps.append(item);
    }
    creationHost.hidden = stage !== 'WALLETS' || !activeToken; walletHost.hidden = stage !== 'FUND' || !setup?.allocations.length;
    foot.replaceChildren(); summary.replaceChildren();
    if (!setup) { if (!content.querySelector('form')) renderForm(); return; }
    content.replaceChildren();
    summary.append(el('p', `${setup.tokenIds.map(id => '#' + id).join(', ')} · ${setup.options.daily} mints/day and ${setup.options.total} total per Punk · ${setup.options.mode === 'DIRECTED' ? 'Directed free mint: ' + setup.options.target : 'Search supported free mints'}`));
    summary.append(el('p', `Combined limits: ${setup.dailyMaximum}/day, ${setup.totalMaximum} total. ${setup.allocations.length ? `${setup.options.fundingBudgetEth} ETH total gas funding, plus network fees.` : 'Use existing Agent gas; no new funding planned.'}`));
    if (!allOwned()) { content.append(el('p', 'Ownership changed. A selected Punk is unavailable; finish any saved transaction recovery, then make a new plan.')); }
    if (stage === 'CHECK') {
      for (const allocation of setup.allocations) content.append(el('p', `Punk #${allocation.tokenId}: ${allocation.amountEth} ETH`));
      content.append(el('p', 'Your existing taste, minimum reserve, gas cap and safety rules remain in force. Funding an already active Punk may resume its existing mission. Creating or funding a new wallet grants no mission permission.'));
      button(content, 'CHECK WALLETS & CONTINUE', inspectWallets, !allOwned(), 'check-wallets');
    } else if (stage === 'WALLETS') {
      for (const id of setup.tokenIds) content.append(el('p', `Punk #${id} · ${accounts.get(id)?.created ? 'Agent wallet verified' : 'Wallet setup needed'}`));
      const missing = nextMissing();
      if (activeToken) content.append(el('p', `Current wallet: Punk #${activeToken}. Other Punks remain queued here.`));
      if (missing || pendingCreation()) button(foot, 'CONTINUE WALLET SETUP', async valid => {
        activeToken = pendingCreation()?.review?.tokenId ?? nextMissing(); creationControl.refresh(); await creationControl.check(); if (!valid()) return;
      }, !allOwned(), 'next-wallet');
      else button(foot, 'CONTINUE TO BATCH FUNDING', openFunding, !allOwned(), 'to-funding');
    } else if (stage === 'FUND') {
      const status = setup.allocations.length ? fundingStatus() : 'CONFIRMED';
      content.append(el('p', setup.allocations.length ? `Funding progress: ${status.replaceAll('_', ' ')}. The same saved batch will not be sent twice.` : 'No deposit requested. Your Punks still need enough gas above their individual reserves.'));
      if (status === 'CONFIRMED') walletHost.hidden = true;
      button(foot, 'CONTINUE TO MISSION APPROVALS', async () => { stage = 'MISSIONS'; message = 'Your Punks stay in this plan. Review and approve each new mission below; each permission belongs to one Punk.'; }, status !== 'CONFIRMED' || !allOwned(), 'to-missions');
    } else if (stage === 'MISSIONS') {
      const labels = { QUEUED: 'Ready for rules review', REVIEW: 'Review opened · not approved', AUTHORIZING: 'Wallet approval pending', AUTHORIZED: 'Mission approved', CHECK_STATUS: 'Check original approval', EXISTING: 'Already active · current rules kept', SETTLED: 'Original mission ended · check Activity' };
      const next = setup.missions.find(row => ['QUEUED', 'REVIEW'].includes(row.status));
      const pending = setup.missions.some(row => row.status === 'AUTHORIZING' || row.status === 'CHECK_STATUS' && row.attempt);
      if (next) button(content, `REVIEW NEXT MISSION · #${next.tokenId}`, valid => missionReview(next, valid), !allOwned() || pending, 'next-mission');
      for (const row of setup.missions) {
        const card = el('article', '', 'mission'); card.append(el('strong', `Punk #${row.tokenId} · ${labels[row.status]}`));
        button(card, 'CHECK MISSION / SIGN IN', valid => inspectMission(row, valid), !owned(row.tokenId) || row.status === 'AUTHORIZING');
        if (row.attempt && row.status === 'CHECK_STATUS') {
          const label = el('label', 'Original approval transaction hash'), hash = el('input', '', 'mission-hash'); hash.value = row.attempt.transactionHash ?? ''; hash.maxLength = 66; label.append(hash); card.append(label);
          button(card, 'RECOVER MISSION CONFIRMATION', async valid => {
            if (!HASH.test(hash.value.trim().toLowerCase())) throw Error('Paste the original transaction hash from wallet activity. It will only be checked, never resent.');
            const transactionHash = hash.value.trim().toLowerCase();
            const result = await recoverMission({ tokenId: row.tokenId, ...row.attempt, authorizationTransactionHash: transactionHash });
            if (!valid()) return;
            if (result?.ok !== true || String(result.tokenId) !== row.tokenId || result.session?.sessionId !== row.attempt.sessionId
              || result.session.status !== 'ACTIVE' || result.session.transactionHash !== transactionHash
              || result.strategyActivated !== true) throw Error('The original mission receipt could not be verified. No new approval was sent.');
            rowUpdate(row.tokenId, { attempt: { ...row.attempt, transactionHash } });
            await inspectMission(setup.missions.find(item => item.tokenId === row.tokenId), valid);
          }, !owned(row.tokenId));
        }
        button(card, 'VIEW PUNK STATUS', () => openStatus(row.tokenId), !owned(row.tokenId) || pending); content.append(card);
      }
      if (setup.missions.every(row => ['AUTHORIZED', 'EXISTING', 'SETTLED'].includes(row.status))) content.append(el('p', 'Swarm setup is finished. Ended missions remain ended; active Punks follow their own approved rules. Check Activity for hunting, reserve limits and results; this page does not need to stay open.'));
      content.append(el('p', 'Existing missions retain their current rules. Recall a Punk separately before replacing an active mission. A free mint is not guaranteed.'));
    }
    button(foot, 'RECHECK SELECTED WALLETS', inspectWallets, !allOwned() || setup.missions.some(r => r.status === 'AUTHORIZING'), 'recheck');
    if (!allOwned()) {
      foot.append(el('p', 'A selected Punk is no longer in your wallet. Archive this plan to keep its transaction history and set up your remaining Punks. Archiving does not recall missions or move funds.'));
      button(foot, 'ARCHIVE UNAVAILABLE PLAN', () => {
        const liveRecord = (walletOptions.client?.getSwarmWalletRecord ?? getSwarmWalletRecord)(key, { storage });
        if (embeddedBusy() || PENDING.includes(liveRecord?.status) || pendingCreation()
          || setup.missions.some(r => r.status === 'AUTHORIZING' || owned(r.tokenId) && r.status === 'CHECK_STATUS' && r.attempt)) {
          throw Error('Check pending wallet requests for Punks you still own before archiving. Their original approvals remain saved.');
        }
        const archiveKey = `gogh-swarm-setup-archive-v1:4663:${key}:${setup.planId}`, text = JSON.stringify(setup);
        const existing = storage.getItem(archiveKey);
        if (existing && existing !== text) throw Error('An earlier copy of this plan is already saved. Its history was kept.');
        storage.setItem(archiveKey, text);
        if (storage.getItem(archiveKey) !== text) throw Error('The plan could not be archived. Free device storage before continuing.');
        storage.removeItem(storeKey()); setup = null; stage = 'PLAN'; activeToken = null; walletBound = ''; accounts.clear();
        walletControl.clearFundingPlan(); content.replaceChildren();
        message = 'Plan archived on this device with its original transaction history. Check Activity for Punks you still own; no mission or funding transaction was repeated.';
      }, false, 'archive');
    }
    button(foot, 'CLOSE SAVED PLAN', () => {
      const liveRecord = (walletOptions.client?.getSwarmWalletRecord ?? getSwarmWalletRecord)(key, { storage });
      if (embeddedBusy() || PENDING.includes(liveRecord?.status) || pendingCreation() || setup.missions.some(r => r.status === 'AUTHORIZING' || r.status === 'CHECK_STATUS' && r.attempt)) throw Error('Recover the pending transaction before closing this plan.');
      storage.removeItem(storeKey()); setup = null; stage = 'PLAN'; activeToken = null; walletBound = ''; accounts.clear(); walletControl.clearFundingPlan(); message = 'Plan closed. This does not recall or pause approved missions.'; content.replaceChildren();
    }, false, 'close');
  }
  function renderForm(preserve = false) {
    const values = preserve && draftFields ? Object.fromEntries(Object.entries(draftFields).map(([name, input]) => [name, input.value])) : {};
    const selected = new Set(preserve && draftChecks ? draftChecks.filter(n => n.checked).map(n => n.value) : []);
    const focused = preserve && draftFields ? Object.entries(draftFields).find(([, input]) => input === doc.activeElement) : null;
    const caret = focused ? [focused[1].selectionStart, focused[1].selectionEnd] : null;
    content.replaceChildren(); draftFields = null; draftChecks = null;
    if (!context()) { content.append(el('p', 'Connect your owner wallet on Robinhood Chain to set up a Swarm.')); return; }
    if (!storage) { content.append(el('p', 'Allow site storage so your progress and pending wallet requests can be recovered.')); return; }
    const form = el('form', '', 'plan-form'), picks = el('fieldset'); picks.append(el('legend', 'Choose up to 10 Punks'));
    const checks = [];
    for (const punk of getPunks()) { const label = el('label'), input = el('input'); input.type = 'checkbox'; input.value = String(punk.tokenId); input.checked = selected.has(input.value); checks.push(input); label.append(input, el('span', 'Punk #' + input.value)); picks.append(label); }
    form.append(picks); const fields = {};
    for (const [name, title, choices] of [['mode', 'Mission', [['SEARCH', 'Search supported free mints'], ['DIRECTED', 'Direct to one free collection']]], ['daily', 'Mints per Punk per day', LIMITS.map(x => [x, x])], ['duration', 'Duration', [['FIXED', 'Stop at the mission total'], ['KEEP_HUNTING', 'Keep hunting · up to 100 mints / 30 days']]], ['total', 'Total mints per Punk', LIMITS.map(x => [x, x])]]) {
      const label = el('label', title), input = el('select'); input.name = name; for (const [value, title] of choices) { const option = el('option', title); option.value = value; input.append(option); } fields[name] = input; label.append(input); form.append(label);
    }
    for (const [name, title, hint] of [['target', 'Directed collection contract', '0x…'], ['fundingBudgetEth', 'Total ETH to split across this Swarm', 'Leave blank to use existing gas']]) {
      const label = el('label', title), input = el('input'); input.name = name; input.placeholder = hint; input.maxLength = name === 'target' ? 42 : 21; if (name === 'fundingBudgetEth') input.inputMode = 'decimal'; fields[name] = input; label.append(input); form.append(label);
      if (name === 'target') { label.hidden = true; fields.mode.addEventListener('change', () => { label.hidden = fields.mode.value !== 'DIRECTED'; }); }
    }
    fields.duration.addEventListener('change', () => { fields.total.disabled = fields.duration.value === 'KEEP_HUNTING'; });
    form.append(el('p', 'Budget is split equally, up to 1 ETH per Punk. The Swarm Wallet funds the group in one transaction after any missing Agent wallets are created. Your connected wallet also pays network fees. Existing reserves and gas limits still apply.'));
    form.append(el('p', 'Keep hunting needs renewal after 100 mints or 30 days. Gas, reserve, daily limits and safety checks can stop it earlier.'));
    for (const [name, value] of Object.entries(values)) if (fields[name]) fields[name].value = value;
    fields.target.parentElement.hidden = fields.mode.value !== 'DIRECTED'; fields.total.disabled = fields.duration.value === 'KEEP_HUNTING';
    const submit = el('button', 'REVIEW COMPLETE SWARM PLAN', 'review-plan'); submit.type = 'submit'; submit.className = 'primary-button'; form.append(submit);
    const renderedOwner = key;
    form.addEventListener('submit', event => {
      event.preventDefault(); if (renderedOwner !== context()?.owner || busy) return;
      try {
        const options = Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.value]));
        const input = { ...context(), tokenIds: checks.filter(n => n.checked).map(n => n.value), ownedTokenIds: getPunks().map(p => String(p.tokenId)), options };
        buildSwarmPlan(input);
        setup = createSwarmSetup({ ...input, fundingBaselineRecord: walletControl.getState().record ?? null }); save();
        stage = 'CHECK'; message = 'Review your full plan. No sign-in, wallet approval or transaction has been requested.'; render();
      } catch (error) { setup = null; message = error.message; note.textContent = message; }
    }); content.append(form); draftFields = fields; draftChecks = checks;
    if (focused && fields[focused[0]]) { fields[focused[0]].focus?.({ preventScroll: true }); if (Number.isInteger(caret[0])) fields[focused[0]].setSelectionRange?.(...caret); }
  }
  function refresh() {
    const next = context()?.owner ?? '', nextProvider = getProvider(), nextRoster = getPunks().map(p => String(p.tokenId)).sort().join(',');
    if (next === key && provider === nextProvider) { const changed = roster !== nextRoster; if (!setup && changed) renderForm(true); roster = nextRoster; if (setup && changed) { if (!allOwned()) { generation++; busy = false; message = 'A selected Punk left your wallet. This plan cannot submit new actions.'; } render(); } creationControl?.refresh(); walletControl?.refresh(); return; }
    generation++; key = next; provider = nextProvider; roster = nextRoster; setup = null; accounts.clear(); activeToken = null; busy = false; stage = 'PLAN'; message = ''; walletBound = '';
    if (key && storage) try { const raw = storage.getItem(storeKey()); if (raw) { setup = restoreSwarmSetup(JSON.parse(raw), context()); stage = setup.missions.some(row => row.status !== 'QUEUED') ? 'MISSIONS' : setup.funding.attempt ? 'FUND' : 'CHECK'; message = 'Saved plan restored. Check original pending requests below; no approval or funding will be repeated automatically.'; } } catch { message = 'Saved Swarm progress could not be verified. Check the original wallet transactions before making a new plan.'; }
    content.replaceChildren(); creationControl?.refresh(); walletControl?.refresh(); if (setup && stage === 'FUND' && allOwned()) { try { walletControl.setFundingPlan({ ...context(), tokenIds: setup.tokenIds, totalEth: setup.options.fundingBudgetEth }); walletBound = setup.planId; } catch (error) { message = error.message; } } render();
  }
  creationControl = mountAgentWalletCreation({ ...creationOptions, root: creationHost, storage,
    getContext: () => ({ ...context(), tokenId: activeToken }), getProvider, readProvider,
    onStateChange: () => { if (setup && stage === 'WALLETS') render(); },
    onCreated: value => { if (current() && value.owner === setup.owner && setup.tokenIds.includes(value.tokenId)) { accounts.set(value.tokenId, value); message = `Punk #${value.tokenId}’s Agent wallet is verified. Continue with the next step below.`; render(); } },
  });
  walletControl = mountSwarmWallet({ ...walletOptions, root: walletHost, storage, getContext, getPunks, getProvider, readProvider,
    beforeReview: review => {
      if (!current() || !allOwned() || stage !== 'FUND' || walletBound !== setup.planId) throw Error('Reopen and check this Swarm plan before preparing funding.');
      if (review.action.kind === 'BATCH') {
        if (!['NOT_REVIEWED', 'REVIEW', 'REJECTED', 'REVERTED', 'CANCELLED'].includes(fundingStatus())) throw Error('This funding batch is confirmed or needs recovery. No repeat batch is allowed.');
        setup = captureSwarmSetupFunding(setup, review); save();
      }
    },
    onStateChange: value => {
      if (!setup || stage !== 'FUND') return;
      if (setup.funding.attempt) {
        const status = swarmSetupFundingStatus(setup, value.record);
        if (['WALLET_REQUESTED', 'SUBMITTED', 'CONFIRMED', 'REJECTED', 'REVERTED', 'CANCELLED'].includes(status)) {
          try { setup = updateSwarmSetupFunding(setup, value.record); save(); }
          catch { message = 'Progress could not be saved. Keep the original transaction; do not repeat this funding batch.'; }
        }
      }
      render();
    },
  });
  function authorization(identity, status, details = {}) {
    const row = setup?.missions.find(r => r.tokenId === identity.tokenId && r.intentHash === identity.intentHash);
    if (!current() || !row) return;
    rowUpdate(row.tokenId, details.rejected && !row.attempt?.transactionHash ? { status: 'QUEUED', attempt: null, intentHash: null } : { status });
    message = status === 'AUTHORIZED' ? setup.missions.every(item => ['AUTHORIZED', 'EXISTING', 'SETTLED'].includes(item.status))
      ? 'All selected Punks have been handled. Check Activity for each mission’s current status.'
      : `Punk #${row.tokenId}’s mission is approved. Continue with the next Punk here.` : 'The original mission approval remains saved in this plan.'; render();
  }
  function missionPrepared(identity, attempt) {
    const row = setup?.missions.find(r => r.tokenId === identity.tokenId && r.intentHash === identity.intentHash);
    if (!current() || !row) return;
    if (row.attempt) throw Error('Recover this Punk’s original mission approval before sending another.');
    rowUpdate(row.tokenId, { status: 'AUTHORIZING', attempt: { sessionId: attempt.sessionId, setupArtifactHash: attempt.setupArtifactHash, transactionHash: null } });
  }
  function missionSubmitted(identity, hash) {
    const row = setup?.missions.find(r => r.tokenId === identity.tokenId && r.intentHash === identity.intentHash);
    if (!current() || !row?.attempt) return;
    if (!HASH.test(hash)) throw Error('The mission approval hash could not be saved. Preserve the original wallet request.');
    rowUpdate(row.tokenId, { attempt: { ...row.attempt, transactionHash: hash } });
  }
  refresh(); render();
  return { refresh, authorization, missionPrepared, missionSubmitted, isGuidedMission: identity => current() && setup.missions.some(row => row.tokenId === identity.tokenId && row.intentHash === identity.intentHash), fundingContext: () => null, fundingPrepared: () => { throw Error('Use this plan’s single Swarm Wallet funding batch.'); } };
}
