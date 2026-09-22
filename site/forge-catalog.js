// Display catalog only. Neither a card nor a lab test grants an equipped capability.
export const FORGE_CATALOG = Object.freeze([
  ['contract-detective', 'Contract Detective', 'TESTING', 'Inspect collection bytecode, interfaces and proxy slots.', 'inspect_contract'],
  ['rarity-eye', 'Rarity Eye', 'TESTING', 'Rank an explicit three-token trait sample—not collection-wide rarity.', 'rank_trait_sample'],
  ['market-scout', 'Market Scout', 'TESTING', 'Read current Gogh listings from OpenSea. No purchases.', 'get_market_listings'],
  ['floor-hunter', 'Floor Hunter', 'TESTING', 'Compare prices in a limited listing sample. No purchase or verified collection floor.', 'rank_observed_listings'],
  ['sniper', 'Link Sniper', 'TESTING', 'Inspect supported mint links. Equipped-tool tests passed; public skill release pending.'],
  ['mint-hunter', 'Mint Hunter', 'TESTING', 'Check free mints against your rules and simulate them. Public skill release pending.'],
  ['scheduled-hunter', 'Scheduled Hunter', 'UNDER_REVIEW', 'Bounded time-window missions.'],
  ['art-curator', 'Art Curator', 'TESTING', 'Read declared art styles from metadata. Does not analyze artwork images.', 'classify_collection'],
  ['social-scout', 'Social Scout', 'TESTING', 'Find project links declared by the collection. Social activity and account ownership remain unverified.', 'research_project'],
  ['paid-mint-license', 'Paid Mint License', 'BLOCKED', 'Higher-risk paid mint capability; not enabled.'],
  ['collection-researcher', 'Collection Researcher', 'TESTING', 'Summarize declared metadata from your selected three-Punk sample.', 'research_collection'],
  ['listing-watcher', 'Listing Watcher', 'UNDER_REVIEW', 'Watch new marketplace listings.'],
  ['portfolio-curator', 'Portfolio Curator', 'UNDER_REVIEW', 'Analyze collected art with explicit coverage.'],
  ['whitelist-scout', 'Whitelist Scout', 'UNDER_REVIEW', 'Research published mint eligibility.'],
].map(([id, name, status, description, test]) => Object.freeze({ id, name, status,
  description, test: test ?? null, image: `/assets/skill-forge/v1/${id === 'floor-hunter' ? 'market-scout' : id}.png`, learnable: false })));
