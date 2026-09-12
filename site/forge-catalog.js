// Display catalog only. Neither a card nor a lab test grants an equipped capability.
export const FORGE_CATALOG = Object.freeze([
  ['contract-detective', 'Contract Detective', 'TESTING', 'Inspect collection bytecode, interfaces and proxy slots.', 'inspect_contract'],
  ['rarity-eye', 'Rarity Eye', 'TESTING', 'Rank an explicit three-token trait sample—not collection-wide rarity.', 'rank_trait_sample'],
  ['market-scout', 'Market Scout', 'TESTING', 'Read current Gogh listings from OpenSea. No purchases.', 'get_market_listings'],
  ['sniper', 'Sniper', 'ADAPTING', 'Planned Mint Link and Floor Snipe missions. Execution not enabled.'],
  ['mint-hunter', 'Mint Hunter', 'ADAPTING', 'Skill-gated free minting within owner policy. Acceptance pending.'],
  ['scheduled-hunter', 'Scheduled Hunter', 'UNDER_REVIEW', 'Bounded time-window missions.'],
  ['art-curator', 'Art Curator', 'UNDER_REVIEW', 'Art classification and taste matching.'],
  ['social-scout', 'Social Scout', 'UNDER_REVIEW', 'Public project research.'],
  ['paid-mint-license', 'Paid Mint License', 'BLOCKED', 'Higher-risk paid mint capability; not enabled.'],
  ['collection-researcher', 'Collection Researcher', 'UNDER_REVIEW', 'Collection-level metadata and research.'],
  ['listing-watcher', 'Listing Watcher', 'UNDER_REVIEW', 'Watch new marketplace listings.'],
  ['portfolio-curator', 'Portfolio Curator', 'UNDER_REVIEW', 'Analyze collected art with explicit coverage.'],
  ['whitelist-scout', 'Whitelist Scout', 'UNDER_REVIEW', 'Research published mint eligibility.'],
].map(([id, name, status, description, test]) => Object.freeze({ id, name, status,
  description, test: test ?? null, image: `/assets/skill-forge/v1/${id}.png`, learnable: false })));
