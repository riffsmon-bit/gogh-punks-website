import { createForgeControl } from '/broker-v2-forge.js';
let tokenId = 1;
const request = async (url, options) => { const response = await fetch(url, options); if (!response.ok) throw Error(await response.text()); return response.json(); };
const control = createForgeControl({ root: document.querySelector('[data-v2-panel=forge]'), getSelection: () => ({ tokenId, chainId: 31337, preview: true }),
  trainingAdapter: { localOnly: true, request } });
for (const button of document.querySelectorAll('[data-punk]')) button.addEventListener('click', () => { tokenId = Number(button.dataset.punk); control.selectionChanged(); });
