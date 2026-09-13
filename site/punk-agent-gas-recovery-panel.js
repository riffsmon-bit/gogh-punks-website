import { getAgentGasFundingState, recheckAgentGasFunding, recoverAgentGasFunding } from './punk-agent-gas-funding.js';

export function createGasFundingRecovery({ root, getSelection, provider, onConfirmed }) {
  root.innerHTML = `<h4>SAVED GAS FUNDING</h4><p data-funding-state role="status"></p>
    <a data-funding-link target="_blank" rel="noopener noreferrer" hidden>View original transaction ↗</a>
    <div class="welcome-actions"><button type="button" class="outline-button" data-funding-recheck>RECHECK FUNDING</button></div>
    <form data-funding-recover><label>Original transaction hash from wallet activity<input name="hash" autocomplete="off" spellcheck="false" placeholder="0x…" required pattern="0x[0-9a-fA-F]{64}" /></label>
    <button type="submit" class="outline-button">RECOVER ORIGINAL TRANSACTION</button></form>`;
  const status = root.querySelector('[data-funding-state]'), link = root.querySelector('[data-funding-link]');
  const recheck = root.querySelector('[data-funding-recheck]'), form = root.querySelector('form');
  let identity = null, epoch = 0, busy = false;
  const key = selection => selection?.chainId === 4663 && /^0x[0-9a-f]{40}$/.test(selection.owner ?? '')
    && /^(0|[1-9]\d{0,3})$/.test(selection.tokenId ?? '') ? `${selection.owner}:${selection.tokenId}` : null;
  function refresh() {
    const selection = getSelection(), next = key(selection);
    if (next !== identity) { identity = next; epoch++; busy = false; form.elements.hash.value = ''; }
    root.hidden = !next;
    if (!next) return;
    try {
      const saved = getAgentGasFundingState(selection.owner, selection.tokenId);
      root.hidden = !saved;
      if (!saved) return;
      const pending = ['WALLET_REQUESTED', 'SUBMITTED'].includes(saved.status);
      status.textContent = saved.status === 'CONFIRMED' ? 'Gas funding confirmed. Your mission still needs its own approval.'
        : saved.status === 'REVERTED' ? 'Funding reverted. No funding transfer completed; the network fee may have been charged. Review again when ready.'
          : saved.status === 'REJECTED' ? 'Funding was cancelled before submission. You can review it again.'
            : saved.transactionHash ? 'Funding is submitted. Recheck for confirmation; it will not be sent again.'
              : 'The wallet result is missing. Paste the original transaction hash from wallet activity to recover it. Do not submit another funding request.';
      link.hidden = !saved.transactionHash;
      if (saved.transactionHash) link.href = `https://robinhoodchain.blockscout.com/tx/${saved.transactionHash}`;
      form.hidden = !pending || !!saved.transactionHash;
      recheck.hidden = !pending || !saved.transactionHash;
    } catch (error) { status.textContent = error.message; form.hidden = true; recheck.hidden = true; link.hidden = true; }
    root.querySelectorAll('button, input').forEach(input => { input.disabled = busy; });
  }
  async function run(hash) {
    const selection = getSelection(), current = key(selection), capturedEpoch = epoch;
    if (!current || busy) return;
    const isCurrent = () => key(getSelection()) === current && epoch === capturedEpoch;
    busy = true; refresh(); status.textContent = 'Checking the original funding transaction…';
    try {
      const result = hash ? await recoverAgentGasFunding(provider(), selection.owner, selection.tokenId, hash, { isCurrent })
        : await recheckAgentGasFunding(provider(), selection.owner, selection.tokenId, { isCurrent });
      if (!isCurrent()) return;
      busy = false; refresh();
      if (result?.status === 'CONFIRMED') await onConfirmed?.(selection);
    } catch (error) { if (isCurrent()) { busy = false; refresh(); status.textContent = error.message; } }
    finally { if (isCurrent()) { busy = false; root.querySelectorAll('button, input').forEach(input => { input.disabled = false; }); } }
  }
  recheck.addEventListener('click', () => void run(null));
  form.addEventListener('submit', event => { event.preventDefault(); void run(form.elements.hash.value.trim()); });
  return Object.freeze({ refresh });
}
