import { createTrainingControl } from '/forge-training.js';
import { validateReviewedTrainingReview, validateReviewedTrainingSnapshot } from '/forge-reviewed-training.js';
const requested = new URLSearchParams(location.search).get('testPunk');
let tokenId = ['1', '44', '7'].includes(requested) ? Number(requested) : 44;
const request = async (url, options) => { const response = await fetch(url, options); if (!response.ok) throw Error(await response.text()); return response.json(); };
const control = createTrainingControl({ root: document.querySelector('[data-v2-panel=forge]'),
  getSelection: () => ({ tokenId, chainId: 31337, preview: true }), request, localOnly: true,
  validateReview: validateReviewedTrainingReview, validateSnapshot: validateReviewedTrainingSnapshot });
const buttons = [...document.querySelectorAll('[data-punk]')];
const showSelection = () => buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.punk) === tokenId)));
for (const button of buttons) button.addEventListener('click', () => {
  tokenId = Number(button.dataset.punk); showSelection(); history.replaceState(null, '', `/control-center?testPunk=${tokenId}`); control.selectionChanged();
});
showSelection();
