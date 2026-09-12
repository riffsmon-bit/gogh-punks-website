import { assessSacrifice } from './burn-eligibility.mjs';

// Standalone component for the gated Forge. No signing provider or burn callback.
export function renderBurnWarning(container, snapshot, { onReviewWallet = () => {}, now } = {}) {
  const doc = container.ownerDocument;
  const report = assessSacrifice(snapshot, { now });
  const element = (tag, text) => { const node = doc.createElement(tag); node.textContent = text; return node; };
  container.replaceChildren();
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Permanent sacrifice safety');
  container.append(element('h2', 'PERMANENT SACRIFICE — BLOCKED'));
  const tokenLabel = value => /^(0|[1-9][0-9]{0,77})$/.test(String(value)) ? `#${value}` : 'not selected';
  container.append(element('p', `Punk to burn permanently: ${tokenLabel(snapshot?.punkToBurn)}. Punk to receive training: ${tokenLabel(snapshot?.punkToTrain)}.`));
  const warning = element('p', report.warning);
  warning.setAttribute('role', 'alert');
  container.append(warning);
  container.append(element('p', 'Check every wallet belonging to the Punk you will burn. Withdraw ETH, WETH, NFTs, other tokens and Agent gas deposits first. Stop its missions and wait for pending transactions to finish.'));
  container.append(element('p', 'Burning the Punk does not destroy its ERC-6551 wallet contracts. They remain at their addresses, but losing the parent NFT can remove your access. Assets left behind or sent there later are not moved to the Punk receiving training.'));
  container.append(element('p', `Forge minimum remaining supply: 1,111. Supply headroom: ${report.supply.headroom ?? 'unknown'}. This is not burn authorization.`));
  for (const wallet of snapshot?.wallets ?? []) {
    const card = element('section', '');
    card.append(element('h3', `${wallet.role} PUNK WALLET`));
    card.append(element('p', wallet.address ?? 'Address not verified'));
    // Preserve exact wei; do not round a dust balance to "0 ETH".
    card.append(element('p', `Native balance: ${wallet.nativeWei ?? 'unknown'} wei · EntryPoint: ${wallet.entryPointDepositWei ?? 'unknown'} wei`));
    card.append(element('p', `NFTs: ${wallet.nftCount ?? 'unknown'} · ERC20 assets: ${wallet.erc20AssetCount ?? 'unknown'} · Other assets: ${wallet.otherAssetCount ?? 'unknown'}`));
    const review = element('button', 'REVIEW WALLET / WITHDRAW ASSETS');
    review.type = 'button';
    review.addEventListener('click', () => onReviewWallet(wallet));
    card.append(review);
    container.append(card);
  }
  const list = element('ul', '');
  for (const reason of report.reasons) list.append(element('li', reason.message));
  container.append(list, element('p', 'Production sacrifice is not enabled. A checkbox cannot override these safety checks.'));
  const burn = element('button', 'SACRIFICE UNAVAILABLE');
  burn.type = 'button';
  burn.disabled = true;
  container.append(burn);
  return report;
}
