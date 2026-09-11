import { createForgeControl } from '/broker-v2-forge.js';
const requested = new URLSearchParams(location.search).get('testPunk');
let tokenId = ['1', '44', '7'].includes(requested) ? Number(requested) : 1;
const request = async (url, options) => { const response = await fetch(url, options); if (!response.ok) throw Error(await response.text()); return response.json(); };
const control = createForgeControl({ root: document.querySelector('[data-v2-panel=forge]'), getSelection: () => ({ tokenId, chainId: 31337, preview: true }),
  trainingAdapter: { localOnly: true, request } });
const buttons = [...document.querySelectorAll('[data-punk]')];
const showSelection = () => buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.punk) === tokenId)));
for (const button of buttons) button.addEventListener('click', () => {
  tokenId = Number(button.dataset.punk); showSelection();
  history.replaceState(null, '', `/control-center?testPunk=${tokenId}`);
  control.selectionChanged();
});
showSelection();
