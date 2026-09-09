import { FORGE_CATALOG } from './forge-catalog.js';
import { createTrainingControl } from './forge-training.js';
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
export function createForgeControl({ root, getSelection, ensureSession, request, trainingAdapter }) {
  if (trainingAdapter) return createTrainingControl({ root, getSelection, request: trainingAdapter.request, localOnly: trainingAdapter.localOnly });
  let key = '', snapshot = null, busy = false, sequence = 0;
  const status = root.querySelector('[data-forge-status]');
  const report = root.querySelector('[data-forge-report]');
  const connect = root.querySelector('[data-forge-connect]');
  const context = () => { const s = getSelection(); return s ? `${s.owner}:${s.tokenId}:${s.chainId}:${s.preview}` : ''; };
  function selectionChanged() {
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
    connect.textContent = busy ? 'CHECKING…' : snapshot ? 'RECHECK OWNER & LAB' : 'CONNECT RESEARCH LAB';
    const slots = root.querySelector('[data-forge-slots]'); slots.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const slot = el('div', null, 'forge-socket');
      slot.append(el('span', `SLOT ${i + 1}`), el('b', '—'), el('small', 'NOT CONNECTED')); slots.append(slot);
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
    return payload;
  }
  async function run(action = null) {
    selectionChanged(); if (busy) return;
    const selected = getSelection(); if (!selected || selected.preview || selected.chainId !== 4663) return;
    const ticket = ++sequence, original = key;
    busy = true; report.replaceChildren(); status.textContent = 'Checking your current-owner sign-in. No transaction will be requested.'; render();
    try {
      await ensureSession();
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
      if (ticket === sequence && original === context()) status.textContent = `${error.message} No training or wallet change was made.`;
    } finally { if (ticket === sequence && original === context()) { busy = false; render(); } }
  }
  connect.addEventListener('click', () => run());
  window.addEventListener('gogh:owner-snapshot', selectionChanged);
  selectionChanged(); render();
  return { selectionChanged };
}
