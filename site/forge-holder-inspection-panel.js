const stamp = value => JSON.stringify([value?.owner?.toLowerCase(), String(value?.tokenId), value?.chainId, value?.revision]);
const amount = value => {
  const wei = BigInt(value), whole = wei / 10n ** 18n, fraction = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
};

// Public read-only view. It does not import any wallet submission module and
// never offers an approval/burn button, even if a response says canBurn:true.
export function createHolderBurnInspectionPanel({ root, getSelection, getOwnedPunks, ensureSession, request }) {
  const doc = root.ownerDocument;
  let generation = 0, sourceId = '', result = null, busy = false, error = '', disposed = false;
  const node = (tag, text) => { const el = doc.createElement(tag); if (text) el.textContent = text; return el; };
  function render() {
    root.replaceChildren(); if (disposed) return;
    root.classList.add('forge-holder-panel');
    const selected = getSelection();
    root.append(node('h3', 'Check sacrifice eligibility'), node('p', 'One eligible sacrifice earns one Training Credit. Public sacrifice is not available yet. You can inspect a Punk’s wallets here; this check cannot burn a Punk or request approval.'));
    if (!selected?.owner || selected.chainId !== 4663 || selected.preview === true) {
      root.append(node('p', 'Connect your wallet on Robinhood Chain to inspect your Punks.')); return;
    }
    const label = node('label', 'Punk to inspect'), select = node('select'); select.setAttribute('aria-label', 'Punk to inspect');
    const blank = node('option', 'Choose another owned Punk'); blank.value = ''; select.append(blank);
    const ids = [...new Set(getOwnedPunks().map(punk => String(typeof punk === 'object' ? punk.tokenId ?? punk.id : punk)))];
    for (const id of ids) if (/^(0|[1-9][0-9]{0,3})$/.test(id) && id !== String(selected.tokenId)) {
      const option = node('option', `Punk #${id}`); option.value = id; select.append(option);
    }
    select.value = sourceId; select.disabled = busy;
    select.addEventListener('change', () => { generation++; sourceId = select.value; result = null; error = ''; busy = false; render(); });
    label.append(select); root.append(label);
    if (ids.filter(id => id !== String(selected.tokenId)).length === 0) root.append(node('p', 'You need another owned Punk to sacrifice. The selected Punk stays with you and receives the credit.'));
    if (!sourceId) return;
    const check = node('button', busy ? 'Checking wallets…' : 'Check wallets'); check.type = 'button'; check.disabled = busy;
    check.addEventListener('click', async () => {
      if (busy || disposed) return;
      const captured = ++generation, identity = stamp(selected), source = sourceId;
      const current = () => !disposed && generation === captured && stamp(getSelection()) === identity && sourceId === source;
      busy = true; error = ''; result = null; render();
      try {
        await ensureSession(); if (!current()) return;
        const response = await request(`/api/v2/punks/${selected.tokenId}/forge/holder-burn`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'check', sourceTokenId: source }) });
        if (!current()) return;
        if (!response?.ok) throw Error(response?.message ?? 'The wallet check could not finish. Recheck shortly; nothing was approved or burned.');
        if (response.owner?.toLowerCase() !== selected.owner.toLowerCase() || response.sourceTokenId !== source
          || response.targetTokenId !== String(selected.tokenId)) throw Error('The selected Punks changed. Choose again and recheck.');
        result = response.source;
      } catch (failure) { if (current()) error = failure?.message ?? 'The wallet check could not finish. Recheck shortly.'; }
      finally { if (current()) { busy = false; render(); } }
    });
    root.append(check);
    if (result) {
      const list = node('ul');
      for (const wallet of result.wallets ?? []) {
        list.append(node('li', `${wallet.role}: ${amount(wallet.nativeWei)} ETH · ${amount(wallet.wethWei)} WETH · gas deposit ${amount(wallet.entryPointDepositWei)} ETH`));
      }
      root.append(list);
      if (result.training?.status === 'VERIFIED') root.append(node('p', `Unused Training Credits: ${result.training.burnCredits} from sacrifice, ${result.training.purchasedCredits} purchased.`));
      root.append(node('p', 'NFT and other-token inventory: not fully verified. Zero ETH does not mean this Punk’s wallets are empty.'));
      if (result.blockers?.includes('HOLDER_ASSETS_PRESENT')) root.append(node('p', 'Assets are still present. Withdraw them before considering sacrifice.'));
      if (result.blockers?.includes('HOLDER_CREDITS_REMAIN')) root.append(node('p', 'Use this Punk’s remaining Training Credits before considering sacrifice.'));
      if (result.blockers?.includes('HOLDER_AUTOMATION_ACTIVE')) root.append(node('p', 'Pause this Punk and revoke its automated spending permission before considering sacrifice.'));
      if (result.blockers?.includes('HOLDER_TRANSACTION_PENDING')) root.append(node('p', 'A transaction is pending. Wait for its confirmed result and recheck.'));
      root.append(node('p', 'Sacrifice is blocked. Complete token history, attached missions/refunds and protection for deposits made while confirmation is pending still need verification.'));
      const open = node('a', `Open Punk #${sourceId} wallet`); open.href = `/broker/v2/?tab=collection&tokenId=${sourceId}`; root.append(open);
    }
    if (error) { const status = node('p', error); status.setAttribute('role', 'alert'); root.append(status); }
  }
  return { refresh() { generation++; sourceId = ''; result = null; error = ''; busy = false; render(); },
    destroy() { generation++; disposed = true; root.replaceChildren(); } };
}
