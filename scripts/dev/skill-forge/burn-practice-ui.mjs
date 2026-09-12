import { createTrainingControl } from '/forge-training.js';
import { validateReviewedTrainingReview, validateReviewedTrainingSnapshot } from '/forge-reviewed-training.js';

if (location.hostname !== '127.0.0.1' || location.protocol !== 'http:') throw Error('LOCAL_PRACTICE_ONLY');
const $ = id => document.getElementById(id);
const dialog = $('burn-dialog');
let state, record, busy = false, training;
const request = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) throw Error(await response.text());
  return response.json();
};
const post = (action, body) => request(`/api/burn-practice/${action}`, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forge-nonce': state.localTrainingNonce }, body: JSON.stringify(body) });
const message = text => { $('burn-status').textContent = text; };
const flags = () => {
  $('prepare-burn').disabled = busy || !state || state.sourceOwner === '0x0000000000000000000000000000000000000000'
    || record && !['CANCELED', 'EXPIRED', 'REVERTED'].includes(record.status);
  $('refresh-burn').disabled = busy;
  $('confirm-burn').disabled = busy || record?.status !== 'PREPARED' || Date.now() > record.review.deadline * 1000
    || $('burn-typed').value !== 'BURN 7' || !$('burn-ack').checked;
  $('cancel-burn').disabled = busy || record?.status !== 'PREPARED';
};
const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
function showReview() {
  $('burn-typed').value = ''; $('burn-ack').checked = false;
  $('burn-fee').textContent = `ETH value: 0. Maximum local network fee: ${record.review.maximumNetworkFeeWei} wei. Supply: ${record.review.supply} → ${BigInt(record.review.supply) - 1n}; minimum 1,111.`;
  $('burn-expiry').textContent = `Review expires: ${new Date(record.review.deadline * 1000).toLocaleTimeString()}.`;
  $('burn-transaction').textContent = JSON.stringify(record.review.transaction, null, 2);
  if (!dialog.open) dialog.showModal();
  $('burn-typed').focus(); flags();
}
async function refresh() {
  state = await request('/api/burn-practice');
  if (state.localOnly !== true || state.productionAuthority !== false || state.chainId !== 31337
    || state.sourceTokenId !== 7 || state.targetTokenId !== 44) throw Error('INVALID_PRACTICE_STATE');
  record = state.record;
  $('burn-wallets').replaceChildren(...state.wallets.map(wallet => {
    const card = element('article', ''); card.append(element('h3', wallet.role), element('p', wallet.address),
      element('p', `Native balance: ${wallet.nativeWei} wei. Owner: ${wallet.owner}.`), element('p', wallet.tokenInventory)); return card;
  }));
  const unresolved = record && ['CHECKING', 'SUBMISSION_UNKNOWN', 'SUBMITTED'].includes(record.status);
  $('burn-supply').textContent = `Confirmed practice supply: ${state.supply}. Forge minimum: 1,111. Test #44 credits: ${unresolved ? 'awaiting burn receipt verification' : state.credits}.`;
  message(record ? `${record.status}: Test #7 → Test #44.${record.transactionHash ? ` Transaction: ${record.transactionHash}` : ''}`
    : 'Ready to review. Test #7 exists; Test #44 has no training credit yet.');
  if (record?.status === 'PREPARED') showReview();
  else if (dialog.open) dialog.close();
  const confirmed = record?.status === 'CONFIRMED';
  $('next-training').hidden = !confirmed;
  if (confirmed && !training) {
    const root = document.querySelector('[data-v2-panel=forge]');
    training = createTrainingControl({ root,
      getSelection: () => ({ tokenId: 44, chainId: 31337, preview: true }), request, localOnly: true,
      validateReview: validateReviewedTrainingReview, validateSnapshot: validateReviewedTrainingSnapshot });
    root.querySelector('.forge-banner').textContent = 'DISPOSABLE CHAIN 31337 · Burn receipt verified for Test #7 → Test #44. Production burns remain disabled.';
  }
  flags();
}
async function run(action) {
  if (busy) return;
  busy = true; flags();
  try { await action(); }
  catch (error) {
    if (dialog.open) dialog.close();
    // Refresh the server's attempted marker before offering any action again.
    try { await refresh(); } catch { state = null; }
    message(error.message);
  } finally { busy = false; flags(); }
}
$('prepare-burn').addEventListener('click', () => run(async () => {
  record = await post('prepare', { sourceTokenId: 7, targetTokenId: 44 }); showReview();
}));
$('confirm-burn').addEventListener('click', () => run(async () => {
  message('Submitting the reviewed disposable burn. Receipt verification is next.');
  record = await post('confirm', { intentId: record.review.intentId, typedConfirmation: $('burn-typed').value,
    acknowledgeAccessLoss: $('burn-ack').checked }); dialog.close(); await refresh();
}));
const cancel = () => run(async () => { await post('cancel', { intentId: record.review.intentId }); dialog.close(); await refresh(); });
$('cancel-burn').addEventListener('click', cancel);
dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) cancel(); });
$('refresh-burn').addEventListener('click', () => run(refresh));
$('burn-typed').addEventListener('input', flags); $('burn-ack').addEventListener('change', flags);
setInterval(() => {
  if (record?.status === 'PREPARED' && Date.now() > record.review.deadline * 1000) $('burn-expiry').textContent = 'This review expired. Cancel and prepare a fresh review.';
  flags();
}, 1000);
await run(refresh);
