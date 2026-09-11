import { FORGE_CATALOG } from './forge-catalog.js';
import { createTrainingControl } from './forge-training.js';
import { validateForgeProfile, forgeSlotView } from './forge-profile-view.js';
import { createDurableTrainingPanel } from './forge-durable-training-panel.js';
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
export function createForgeControl({ root, getSelection, ensureSession, request, trainingAdapter }) {
  if (trainingAdapter) return createTrainingControl({ root, getSelection, request: trainingAdapter.request, localOnly: trainingAdapter.localOnly });
  const training = createDurableTrainingPanel({ root: root.querySelector('[data-forge-training]'),getSelection,ensureSession,request });
  let key = '', snapshot = null, busy = false, sequence = 0, lastCheck = 0;
  const status = root.querySelector('[data-forge-status]');
  const report = root.querySelector('[data-forge-report]');
  const connect = root.querySelector('[data-forge-connect]');
  const context = () => { const s = getSelection(); return s ? `${s.owner}:${s.tokenId}:${s.chainId}:${s.preview}` : ''; };
  function selectionChanged() {
    training?.selectionChanged();
    const current = context(); if (current === key) return;
    key = current; ++sequence; busy = false; snapshot = null; report.replaceChildren();
    const s = getSelection();
    root.querySelector('[data-forge-punk]').textContent = s ? `PUNK #${s.tokenId}` : 'SELECT YOUR PUNK';
    root.querySelector('[data-forge-sample-selected]').value = s?.tokenId ?? '';
    root.querySelector('[data-forge-sample-two]').value = s ? String(Number(s.tokenId) + 1) : '';
    root.querySelector('[data-forge-sample-three]').value = s ? String(Number(s.tokenId) + 2) : '';
    status.textContent = !s ? 'Select a Punk first.' : s.preview ? 'Design preview only. Live research requires the real owner wallet.' : 'Sign in to verify current ownership and check research-lab access.';
    render();
  }
  function render() {
    const s = getSelection(); connect.disabled = busy || !s || s.preview || s.chainId !== 4663;
    connect.textContent = busy ? 'CHECKING…' : snapshot ? 'RECHECK OWNER & FORGE' : 'CHECK FORGE & LOADOUT';
    const slots = root.querySelector('[data-forge-slots]'); slots.replaceChildren();
    const profile = snapshot?.profile;
    const set = (selector, text) => { const node = root.querySelector(selector); if (node) node.textContent = text; };
    set('[data-forge-profile-state]', profile?.verified ? 'ON-CHAIN LOADOUT · READ ONLY' : 'PERMANENT TRAINING · NOT VERIFIED');
    set('[data-forge-profile-summary]', profile?.verified
      ? `${profile.trainingCredits} TRAINING CREDIT(S) · ${profile.learnedSkills.length} LEARNED · ${profile.equippedSkills.length}/${profile.unlockedSlots} EQUIPPED`
      : 'Learned skills, credits and unlocked slots are unknown—not zero.');
    set('[data-forge-profile-note]', profile?.verified ? `Verified at block ${profile.blockNumber}. Training follows the original token. No transaction capability is granted by this view.`
      : profile?.note ?? 'Recheck to verify permanent progression. No equipment authority is assumed.');
    for (const item of forgeSlotView(profile)) {
      const slot = el('div', null, `forge-socket forge-socket-${item.state.toLowerCase()}`);
      slot.append(el('span', `SLOT ${item.slot + 1}`));
      const icon = item.skill?.packageVerified && FORGE_CATALOG.find(s => s.id === item.skill.slug);
      if (icon) { const img = el('img'); img.src = icon.image; img.alt = ''; img.width = 80; img.height = 80; slot.append(img); }
      slot.append(el('b', item.title), el('small', item.detail)); slots.append(slot);
    }
    const grid = root.querySelector('[data-forge-library]'); grid.replaceChildren();
    for (const skill of FORGE_CATALOG) {
      const card = el('article', null, 'forge-skill'); const image = el('img');
      image.src = skill.image; image.alt = ''; image.width = 96; image.height = 96; image.loading = 'lazy';
      card.append(image, el('span', skill.status.replaceAll('_', ' '), 'forge-state'), el('h3', skill.name), el('p', skill.description));
      const button = el('button', skill.test ? 'RUN READ-ONLY TEST' : 'COMING SOON', 'filter-button'); button.type = 'button';
      button.disabled = busy || !snapshot?.labAvailable || !skill.test || skill.test === 'get_market_listings' && !snapshot.marketAvailable;
      if (skill.test) button.addEventListener('click', () => run(skill.test));
      card.append(button); grid.append(card);
    }
  }
  function validate(payload, selected) {
    if (payload.tokenId !== selected.tokenId || payload.owner?.toLowerCase() !== selected.owner?.toLowerCase()
      || payload.chainId !== 4663 || payload.mode !== 'READ_ONLY_RESEARCH_LAB' || payload.walletAuthority !== 'NONE'
      || payload.canBurn !== false || payload.canLearn !== false || payload.canEquip !== false) throw new Error('Forge response could not be verified.');
    validateForgeProfile(payload.profile, selected);
    return payload;
  }
  async function run(action = null, { authenticate = true } = {}) {
    selectionChanged(); if (busy) return;
    const selected = getSelection(); if (!selected || selected.preview || selected.chainId !== 4663) return;
    const ticket = ++sequence, original = key;
    busy = true; lastCheck = Date.now(); if (authenticate || action) report.replaceChildren();
    status.textContent = authenticate ? 'Checking your current-owner sign-in. No transaction will be requested.' : 'Refreshing verified Forge state. No wallet prompt will be requested.'; render();
    try {
      if (authenticate) await ensureSession();
      if (ticket !== sequence || original !== context()) return;
      const options = action ? { method: 'POST', headers: { 'content-type': 'application/json' }, timeoutMs: 45000,
        body: JSON.stringify({ action, ...(action === 'rank_trait_sample' ? { sampleTokenIds: [selected.tokenId,
          root.querySelector('[data-forge-sample-two]').value.trim(), root.querySelector('[data-forge-sample-three]').value.trim()] } : {}) }) } : {};
      status.textContent = action ? 'Running a live read-only research test…' : 'Verifying Punk ownership and lab availability…';
      const payload = validate(await request(`/api/v2/punks/${selected.tokenId}/forge`, options), selected);
      if (ticket !== sequence || original !== context()) return;
      snapshot = payload;
      status.textContent = payload.labAvailable ? 'OWNER VERIFIED · Research tests available. No credits, equipment or spending authority granted.' : 'OWNER VERIFIED · Controlled research lab is not enabled for this owner yet.';
      if (action) {
        report.append(el('h3', 'LIVE RESEARCH RESULT'), el('p', `Punk #${selected.tokenId} · ${new Date(payload.observedAt).toLocaleString()} · ${action.replaceAll('_', ' ')}`));
        const result = payload.result;
        if (action === 'inspect_contract') report.append(el('p', `Code: ${result.codeBytes} bytes · block ${result.blockNumber}. This is evidence, not a security clearance.`));
        if (action === 'rank_trait_sample') report.append(el('p', `${result.sampleSize} sampled Punks ranked. Sample-only results do not change the frozen OpenSea rarity snapshot.`));
        if (action === 'get_market_listings') report.append(el('p', `${result.listings.length} current listings returned. No purchase or bidding capability enabled.`));
        const details = el('details'); details.append(el('summary', 'View structured evidence'), el('pre', JSON.stringify(result, null, 2)));
        report.append(details, el('p', 'Test completed—not a learned skill. Training credits and loadout remain unchanged.'));
      }
    } catch (error) {
      if (ticket === sequence && original === context()) {
        snapshot = null; report.replaceChildren();
        status.textContent = `${error.message} No training or wallet change was made.`;
      }
    } finally { if (ticket === sequence && original === context()) { busy = false; render(); } }
  }
  connect.addEventListener('click', () => run());
  window.addEventListener('gogh:owner-snapshot', selectionChanged);
  // Only refresh an already opened, authenticated bench. Never cause surprise SIWE
  // or wallet requests while idle, switching Punks, focusing a tab or reconnecting.
  const refreshIfVisible = () => {
    if (snapshot && !busy && !root.hidden && !document.hidden && Date.now() - lastCheck >= 30_000) void run(null, { authenticate: false });
  };
  window.addEventListener('focus', refreshIfVisible);
  document.addEventListener('visibilitychange', refreshIfVisible);
  const timer = window.setInterval(refreshIfVisible, 30_000);
  selectionChanged(); render();
  return { selectionChanged, destroy() {
    training?.destroy();
    ++sequence; window.clearInterval(timer); window.removeEventListener('gogh:owner-snapshot', selectionChanged);
    window.removeEventListener('focus', refreshIfVisible); document.removeEventListener('visibilitychange', refreshIfVisible);
  } };
}
