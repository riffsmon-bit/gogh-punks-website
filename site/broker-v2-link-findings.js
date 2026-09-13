import { displayEth } from './broker-v2-amounts.js';

const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const count = value => typeof value === 'string' && UINT.test(value) ? value : null;
// Display-only projection. No finding supplies an executable transaction or a
// security pass. Missing, mismatched and unsupported evidence stays unknown.
export function linkFindings(inspection) {
  const evidence = inspection?.evidence, anchor = evidence?.anchor, code = evidence?.contractInspection;
  if (inspection?.link?.kind !== 'ROBINHOOD_CONTRACT' || !ADDRESS.test(inspection.link.identity ?? '')
    || evidence?.chainId !== 4663 || evidence.source !== 'ROBINHOOD_MAINNET_RPC'
    || typeof evidence.contract !== 'string' || evidence.contract.toLowerCase() !== inspection.link.identity.toLowerCase()
    || anchor?.canonicalRechecked !== true || !HASH.test(anchor.blockHash ?? '')
    || !count(anchor.blockNumber) || evidence.walletAuthority !== 'NONE'
    || evidence.executionAuthorized !== false || inspection.status === 'BLOCKED'
    || !HASH.test(code?.codeHash ?? '') || !Number.isSafeInteger(code?.codeBytes) || code.codeBytes <= 0
    || code.chainId !== 4663 || typeof code.contract !== 'string'
    || code.contract.toLowerCase() !== evidence.contract.toLowerCase()
    || code.blockNumber !== anchor.blockNumber || code.blockHash !== anchor.blockHash) return null;
  const rows = [['Chain', 'Robinhood Chain'], ['Contract', evidence.contract]];
  const mint = evidence.mint;
  let summary = 'I found the contract on Robinhood Chain.';
  if (mint?.status === 'OBSERVED' && mint.standard === 'SEADROP_PUBLIC'
    && displayEth(mint.priceWei) !== '—') {
    const price = mint.priceWei === '0' ? 'Free' : `${displayEth(mint.priceWei)} ETH`;
    rows.push(['Mint price', price]); summary += ` Its listed public mint price is ${price.toLowerCase()}.`;
    rows.push(['Mint window', ({ OPEN: 'Open at this check', NOT_STARTED: 'Not started', ENDED: 'Ended',
      DISABLED: 'Not open' })[mint.publicWindow] ?? 'Could not verify']);
    if (count(mint.walletLimit)) rows.push(['Limit per wallet', mint.walletLimit]);
    if (count(mint.totalMinted) && count(mint.maxSupply)) rows.push(['Minted', `${mint.totalMinted} / ${mint.maxSupply}`]);
  } else rows.push(['Mint details', 'Not available for this contract']);
  rows.push(['Security', 'Full review still needed'], ['Simulation', 'Not run']);
  summary += ' These are observed details; a purchase still needs a fresh safety review, simulation and your approval.';
  return { rows, summary, contractUrl: `https://robinhoodchain.blockscout.com/address/${evidence.contract.toLowerCase()}` };
}

export function createLinkFindingsCard(findings, document = globalThis.document) {
  if (!findings) return null;
  const card = document.createElement('section'); card.className = 'link-findings';
  card.setAttribute('aria-label', 'Contract check results');
  const title = document.createElement('h3'); title.textContent = 'CONTRACT CHECK'; card.append(title);
  const list = document.createElement('dl');
  for (const [name, value] of findings.rows) {
    const row = document.createElement('div'), label = document.createElement('dt'), output = document.createElement('dd');
    label.textContent = name; output.textContent = value; row.append(label, output); list.append(row);
  }
  const link = document.createElement('a'); link.href = findings.contractUrl;
  link.textContent = 'VIEW CONTRACT ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer';
  card.append(list, link); return card;
}
