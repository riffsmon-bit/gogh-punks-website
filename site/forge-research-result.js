const integer = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);
const requireResult = value => { if (!value) throw Error('The research result could not be verified. Recheck the skill.'); };
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 128;
function amount(value, decimals) {
  requireResult(integer(value) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36);
  if (!decimals) return value;
  const padded = value.padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return padded.slice(0, -decimals) + (fraction ? `.${fraction}` : '');
}

// Metadata and market text are untrusted declarations. Always render as text;
// no remote HTML, images, links, or wallet requests enter these reports.
export function renderPlannedResearchResult({ document: doc, action, result }) {
  requireResult(result?.chainId === 4663 && result.walletAuthority === 'NONE' && result.executable === false);
  const root = doc.createElement('section'); root.className = 'forge-research-summary';
  const el = (tag, text) => { const node = doc.createElement(tag); node.textContent = text; return node; };
  const paragraph = text => root.append(el('p', text));
  if (action === 'rank_observed_listings') {
    requireResult(result.schema === 'GOGH_OBSERVED_LISTING_RANKS_V1' && result.collectionFloorVerified === false
      && result.collectionFloor === null && Array.isArray(result.rankedGroups) && result.rankedGroups.length <= 20);
    if (!result.rankedGroups.length) paragraph(result.coverage?.status === 'UNAVAILABLE'
      ? 'Listing prices could not be checked. Try again shortly.'
      : 'No supported listings were returned in this sample. This does not mean the collection has no listings.');
    for (const group of result.rankedGroups) {
      requireResult(Array.isArray(group.listings) && group.listings.length <= 20 && group.paymentToken?.chainId === 4663);
      const token = group.paymentToken;
      requireResult(/^0x[0-9a-f]{40}$/i.test(token.address));
      const currency = token.address === `0x${'0'.repeat(40)}` ? 'ETH' : `Token ${token.address.slice(0, 8)}…${token.address.slice(-4)}`;
      root.append(el('h4', `${currency} · lowest observed ${amount(group.observedMinimumTotalAmount, token.decimals)}`));
      const list = doc.createElement('ol');
      for (const listing of group.listings) {
        requireResult(integer(listing.asset?.tokenId) && integer(listing.price?.totalAmount));
        list.append(el('li', `NFT #${listing.asset.tokenId} · ${amount(listing.price.totalAmount, token.decimals)} ${currency}`));
      }
      root.append(list);
    }
    paragraph('Prices are compared within this limited sample, using the same payment currency. These are observations, not a verified collection floor or a purchase quote.');
  } else if (action === 'research_collection') {
    requireResult(result.schema === 'GOGH_COLLECTION_RESEARCH_V1' && count(result.coverage?.requestedCount)
      && count(result.coverage.observedCount) && result.coverage.observedCount <= result.coverage.requestedCount
      && Array.isArray(result.traitCoverage) && result.traitCoverage.length <= 2560);
    paragraph(`Metadata available for ${result.coverage.observedCount} of ${result.coverage.requestedCount} selected Punks.`);
    const list = doc.createElement('ul');
    for (const trait of result.traitCoverage.slice(0, 8)) {
      requireResult(typeof trait.traitType === 'string' && trait.traitType.length <= 128 && count(trait.observedTokenCount));
      list.append(el('li', `${trait.traitType} · declared by ${trait.observedTokenCount} sampled Punk${trait.observedTokenCount === 1 ? '' : 's'}`));
    }
    if (list.childNodes.length) root.append(list);
    if (result.traitCoverage.length > 8) paragraph('More traits are included in the evidence below.');
    paragraph('This covers your selected sample. Trait counts do not establish rarity, authenticity or value.');
  } else if (action === 'classify_collection') {
    requireResult(result.schema === 'GOGH_DECLARED_ART_STYLE_MATCHES_V1' && result.visualClassification === 'UNAVAILABLE'
      && count(result.recognizedTokenCount) && count(result.unknownTokenCount)
      && Array.isArray(result.declaredStyleCounts) && result.declaredStyleCounts.length <= 20);
    paragraph(`${result.recognizedTokenCount} sampled Punk${result.recognizedTokenCount === 1 ? ' has' : 's have'} a recognized art-style label; ${result.unknownTokenCount} remain unknown.`);
    for (const style of result.declaredStyleCounts) {
      requireResult(typeof style.style === 'string' && /^[A-Z_]{1,64}$/.test(style.style) && count(style.tokenCount));
      paragraph(`${style.style.replaceAll('_', ' ')} · ${style.tokenCount} sampled Punk${style.tokenCount === 1 ? '' : 's'}`);
    }
    paragraph('Art Curator reads style labels declared in metadata. It has not analyzed the artwork images. Missing labels are unknown, not a judgment about the art.');
  } else throw Error('Choose an available research action.');
  return root;
}
