// Browse-only roadmap, NOT registry entries or executable skill manifests.
// Candidates have no key/hash/tool authority and cannot consume training credits.
const opensea = 'https://github.com/ProjectOpenSea/opensea-skill/tree/70c513e73b8bf429affbd680ac6f2ae043c396b5/opensea-api';
const bankr = 'https://github.com/BankrBot/skills/tree/abcab502b450327b154f6fbbdbbf4451807f2ce8';
export const roadmap = [
  { id: 'proposal:scheduled-hunter', name: 'Scheduled Hunter', category: 'execution', status: 'UNDER_REVIEW', capability: 'SCHEDULED_MISSION',
    description: 'Set a start time, deadline and bounded attempts for an approved mission.', boundary: 'Scheduling never adds spend authority or extends an expired owner authorization.',
    source: 'Requested Gogh-native extension; no external runtime accepted.', missing: 'Durable scheduling, timezone clarification, cancellation, idempotency, expiry and receipt-backed end-to-end tests.' },
  { id: 'proposal:art-curator', name: 'Art Curator', category: 'research', status: 'UNDER_REVIEW', capability: 'ART_CLASSIFY',
    description: 'Match art styles and visual characteristics to the owner’s preferences.', boundary: 'Recommendations only. Classification cannot override security or spend limits.',
    source: 'Requested Gogh-native analysis; no evaluated classifier package accepted.', missing: 'Provider-neutral image/metadata pipeline, labeled evaluation data, uncertainty reporting and accuracy tests.' },
  { id: 'proposal:social-scout', name: 'Social Scout', category: 'discovery', status: 'UNDER_REVIEW', capability: 'SOCIAL_READ',
    description: 'Research public Farcaster profiles, project posts and launch information.', boundary: 'Read-only. No social posting, third-party signing or security guarantees.',
    source: 'Bankr Neynar package · source inspected, authenticated workflow not tested.', sourceUrl: `${bankr}/neynar`, missing: 'License review, read-only API allowlist, credentials, source attribution and live acceptance. X coverage is not implied.' },
  { id: 'proposal:paid-mint-license', name: 'Paid Mint License', category: 'execution', status: 'BLOCKED', capability: 'PAID_MINT',
    description: 'Proposed permission for non-zero mint prices inside explicit owner limits.', boundary: 'Higher risk. Does not authorize secondary-market purchases or override free-only policy.',
    source: 'Requested Gogh-native policy/executor extension; not activated.', missing: 'Separate security review; equipped permission, max value, daily spend, reserve, approved adapter, simulation and owner authorization.' },
  { id: 'proposal:collection-researcher', name: 'Collection Researcher', category: 'research', status: 'BLOCKED', capability: 'COLLECTION_READ (proposed)',
    description: 'Inspect collection details, NFT metadata, traits and public project information.', boundary: 'Read-only. An indexer response is not proof of authenticity or a burn-safe wallet.',
    source: 'OpenSea API skill · shares the same upstream integration as Market Scout.', sourceUrl: opensea, missing: 'Authenticated live reads, contract/chain identity checks, metadata normalization and provenance tests.' },
  { id: 'proposal:listing-watcher', name: 'Listing Watcher', category: 'discovery', status: 'BLOCKED', capability: 'LISTING_WATCH (proposed)',
    description: 'Monitor new listings and report changes that match an owner’s filters.', boundary: 'Monitoring and alerts only. No order fulfillment or automatic purchases.',
    source: 'OpenSea API/event interfaces · not a separate proven Gogh integration.', sourceUrl: opensea, missing: 'Live data access, durable cursors, deduplication, reconnect handling, freshness and alert delivery tests.' },
  { id: 'proposal:portfolio-curator', name: 'Portfolio Curator', category: 'research', status: 'BLOCKED', capability: 'PORTFOLIO_READ (proposed)',
    description: 'Summarize a Punk’s holdings and collection distribution with coverage disclosed.', boundary: 'Read-only. Cannot certify empty wallets, rebalance funds or hand custody to another wallet provider.',
    source: 'Bankr Zerion package · source inspected, Robinhood coverage unverified.', sourceUrl: `${bankr}/zerion`, missing: 'Robinhood chain coverage, credentials/license review, address-bound reads and incomplete-inventory handling.' },
  { id: 'proposal:whitelist-scout', name: 'Whitelist Scout', category: 'discovery', status: 'UNDER_REVIEW', capability: 'ALLOWLIST_READ (proposed)',
    description: 'Check published allowlist eligibility for a selected Punk Wallet.', boundary: 'No claims, signatures, bypassing eligibility, or access to private community data.',
    source: 'Requested future Gogh adapter; no end-to-end implementation accepted.', missing: 'Approved source and allowlist-proof adapters, current-wallet binding, sale-stage validation and live acceptance.' },
].map((entry, index) => Object.freeze({ ...entry, mark: String(index + 6).padStart(2, '0'),
  key: null, version: null, manifestHash: null, instructionHash: null, tools: [], comingSoon: true, learnable: false }));

export function previewLibrary(fixtures) {
  const categories = { 1: 'execution', 2: 'execution', 3: 'research', 4: 'research', 8: 'discovery' };
  return [...fixtures.map(skill => ({ ...skill, category: categories[skill.id], learnable: false, comingSoon: false,
    source: skill.id === 8 ? 'OpenSea API source inspected; Gogh wrapper fixture-tested only.' : 'Gogh-native local fixture. See the source audit for demonstrated scope.',
    missing: skill.id === 2 ? 'Full mint-link acceptance and separately reviewed marketplace-purchase integration. The two-mode picker adds no authority.' : 'Complete skill acceptance and production capability integration.' })), ...roadmap];
}
