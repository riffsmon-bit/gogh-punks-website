import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSkillToolGate, manifestHash, instructionHash } from './capability-resolver.mjs';
import { inspectContract, retrieveInlineMetadata, rankTraitSample } from './research-tools.mjs';
import { createMarketReader } from './market-reader.mjs';
import { createMarketReaderV2 } from './market-reader-v2.mjs';
import { createLinkSniperV1 } from './link-sniper-v1.mjs';
import { createMintHunterV1 } from './mint-hunter-v1.mjs';
import { createFloorHunterV1 } from './floor-hunter-v1.mjs';
import { createCollectionResearcherV1 } from './collection-researcher-v1.mjs';
import { createArtCuratorV1 } from './art-curator-v1.mjs';
import { skillKey } from './capability-resolver.mjs';

const DEFAULT_SELECTION = Object.freeze([
  { slug: 'contract-detective', version: 1 }, { slug: 'rarity-eye', version: 1 }, { slug: 'market-scout', version: 1 },
]);
export const PLANNED_RESEARCH_SELECTION = Object.freeze([
  Object.freeze({ slug: 'floor-hunter', version: 1 }),
  Object.freeze({ slug: 'collection-researcher', version: 1 }),
  Object.freeze({ slug: 'art-curator', version: 1 }),
]);
const REVIEWED = Object.freeze({
  'contract-detective/1': [3, 'broker/src/v4/skill-forge/research-tools.mjs'],
  'rarity-eye/1': [4, 'broker/src/v4/skill-forge/research-tools.mjs'],
  'market-scout/1': [8, 'broker/src/v4/skill-forge/market-reader.mjs'],
  'market-scout/2': [8, 'broker/src/v4/skill-forge/market-reader-v2.mjs'],
  'link-sniper/1': [2, 'broker/src/v4/skill-forge/link-sniper-v1.mjs'],
  'mint-hunter/1': [1, 'broker/src/v4/skill-forge/mint-hunter-v1.mjs'],
  'floor-hunter/1': [9, 'broker/src/v4/skill-forge/floor-hunter-v1.mjs'],
  'collection-researcher/1': [11, 'broker/src/v4/skill-forge/collection-researcher-v1.mjs'],
  'art-curator/1': [6, 'broker/src/v4/skill-forge/art-curator-v1.mjs'],
});
const DEPENDENCIES = Object.freeze({
  'link-sniper/1': ['broker/src/v4/discovery/robinhood-link-resolver.mjs', 'broker/src/v4/link-scanner.mjs',
    'broker/src/v4/skill-forge/research-tools.mjs', 'broker/src/v4/discovery/seadrop-ingestor.mjs'],
  'mint-hunter/1': ['broker/src/v4/owner-assisted-seadrop-mint.mjs', 'broker/src/v4/policy-matcher.mjs',
    'broker/src/v4/collecting-intent.mjs', 'broker/src/v4/opportunity.mjs',
    'broker/src/v4/discovery/seadrop-ingestor.mjs', 'broker/src/config.mjs'],
  'floor-hunter/1': ['broker/src/v4/skill-forge/market-reader-v2.mjs'],
  'collection-researcher/1': ['broker/src/v4/skill-forge/collection-evidence-v1.mjs', 'broker/src/v4/skill-forge/research-tools.mjs'],
  'art-curator/1': ['broker/src/v4/skill-forge/collection-evidence-v1.mjs', 'broker/src/v4/skill-forge/research-tools.mjs',
    'broker/src/v4/collecting-intent.mjs'],
});
const ROOT = new URL('../../../../', import.meta.url);
export async function loadResearchSkillCatalog({ root = ROOT, selection = DEFAULT_SELECTION } = {}) {
  if (!Array.isArray(selection) || selection.length < 1 || selection.length > Object.keys(REVIEWED).length) throw Error('INVALID_SKILL_SELECTION');
  const seen = new Set();
  for (const item of selection) {
    if (!item || Object.getPrototypeOf(item) !== Object.prototype
      || Reflect.ownKeys(item).some(key => !['slug', 'version'].includes(key))
      || Object.values(Object.getOwnPropertyDescriptors(item)).some(d => !Object.hasOwn(d, 'value'))
      || typeof item.slug !== 'string' || !Number.isSafeInteger(item.version)) throw Error('INVALID_SKILL_SELECTION');
    const identity = `${item.slug}/${item.version}`;
    if (!Object.hasOwn(REVIEWED, identity) || seen.has(identity)) throw Error('UNREVIEWED_SKILL_VERSION');
    seen.add(identity);
  }
  return Promise.all(selection.map(async ({ slug, version }) => {
    const identity = `${slug}/${version}`;
    const dir = new URL(`broker/skills/${slug}/v${version}/`, root);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
    const instructions = await readFile(new URL('SKILL.md', dir), 'utf8');
    if (manifest.skillId !== REVIEWED[identity][0] || manifest.version !== version
      || manifest.implementation !== REVIEWED[identity][1]) throw new Error('UNREVIEWED_IMPLEMENTATION');
    const digest = createHash('sha256').update(await readFile(new URL(manifest.implementation, root))).digest('hex');
    if (digest !== manifest.implementationSha256) throw new Error('IMPLEMENTATION_HASH_MISMATCH');
    const paths = DEPENDENCIES[identity];
    if (paths) {
      const hashes = manifest.dependenciesSha256;
      if (!hashes || Object.keys(hashes).sort().join('|') !== [...paths].sort().join('|')) throw Error('DEPENDENCY_PINS_REQUIRED');
      for (const path of paths) {
        if (createHash('sha256').update(await readFile(new URL(path, root))).digest('hex') !== hashes[path]) throw Error('DEPENDENCY_HASH_MISMATCH');
      }
    }
    return Object.freeze({ slug, manifest, instructions, status: 'TESTING', approved: false,
      manifestHash: manifestHash(manifest), instructionHash: instructionHash(instructions) });
  }));
}
function argsOnly(args, permitted) {
  if (!args || Object.getPrototypeOf(args) !== Object.prototype
    || Reflect.ownKeys(args).some(k => !['tokenId', 'owner', ...permitted].includes(k))
    || Object.values(Object.getOwnPropertyDescriptors(args)).some(d => !Object.hasOwn(d, 'value'))) throw new Error('INVALID_RESEARCH_ARGUMENTS');
}
export function createResearchSkillRuntime({ readState, packages, client, apiKey, fetchImpl,
  environment = process.env, mintContextReader, now = () => new Date() }) {
  // No key means no market tool, rather than fake or cached-as-live market data.
  const market = apiKey ? createMarketReader({ apiKey, fetchImpl }) : null;
  const marketV2 = apiKey ? createMarketReaderV2({ apiKey, fetchImpl }) : null;
  const link = packages.some(p => p.manifest.skillId === 2 && p.manifest.version === 1)
    ? createLinkSniperV1({ fetchImpl, environment, now }) : null;
  const mint = typeof mintContextReader === 'function' && packages.some(p => p.manifest.skillId === 1 && p.manifest.version === 1)
    ? createMintHunterV1({ client, readContext: mintContextReader, now }) : null;
  const has = id => packages.some(p => p.manifest.skillId === id && p.manifest.version === 1);
  const floor = apiKey && has(9) ? createFloorHunterV1({ apiKey, fetchImpl, now: () => Number(now()) }) : null;
  const collection = client && has(11) ? createCollectionResearcherV1({ client }) : null;
  const art = client && has(6) ? createArtCuratorV1({ client }) : null;
  function selectedVersion(context, id) {
    const selected = packages.filter(p => p.manifest.skillId === id
      && context.instructionPackages.some(item => item.key === skillKey(id, p.manifest.version)));
    if (selected.length !== 1) throw Error('AMBIGUOUS_SKILL_VERSION');
    return selected[0].manifest.version;
  }
  const implementations = {
    ...(floor ? { rank_observed_listings: async (args, context) => {
      argsOnly(args, ['slug', 'contract', 'limit']);
      if (selectedVersion(context, 9) !== 1) throw Error('UNREVIEWED_SKILL_VERSION');
      return floor.rankObservedListings({ slug: args.slug, contract: args.contract, limit: args.limit });
    } } : {}),
    ...(collection ? { research_collection: async (args, context) => {
      argsOnly(args, ['contract', 'tokenIds']);
      if (selectedVersion(context, 11) !== 1) throw Error('UNREVIEWED_SKILL_VERSION');
      return collection.researchCollection({ contract: args.contract, tokenIds: args.tokenIds });
    } } : {}),
    ...(art ? { classify_collection: async (args, context) => {
      argsOnly(args, ['contract', 'tokenIds', 'preferredStyles']);
      if (selectedVersion(context, 6) !== 1) throw Error('UNREVIEWED_SKILL_VERSION');
      return art.classifyCollection({ contract: args.contract, tokenIds: args.tokenIds, preferredStyles: args.preferredStyles });
    } } : {}),
    inspect_contract: async args => { argsOnly(args, ['contract']); return inspectContract({ client, contract: args.contract }); },
    get_metadata: async args => { argsOnly(args, ['contract', 'tokenIds']); return retrieveInlineMetadata({ client, contract: args.contract, tokenIds: args.tokenIds }); },
    rank_trait_sample: async args => {
      argsOnly(args, ['contract', 'tokenIds', 'numericMode']);
      const metadata = await retrieveInlineMetadata({ client, contract: args.contract, tokenIds: args.tokenIds });
      return { ...rankTraitSample(metadata.tokens, { numericMode: args.numericMode ?? 'reject' }), metadataEvidence: { blockNumber: metadata.blockNumber, blockHash: metadata.blockHash, metadataHash: metadata.metadataHash } };
    },
    ...(market ? { get_market_listings: async (args, context) => {
      argsOnly(args, ['slug', 'contract', 'limit']);
      const version = selectedVersion(context, 8);
      if (![1, 2].includes(version)) throw Error('UNREVIEWED_SKILL_VERSION');
      return (version === 2 ? marketV2 : market).getListings({ slug: args.slug, contract: args.contract, limit: args.limit });
    } } : {}),
    ...(link ? { inspect_mint_link: async (args, context) => {
      argsOnly(args, ['url']);
      if (selectedVersion(context, 2) !== 1) throw Error('UNREVIEWED_SKILL_VERSION');
      return link.inspectMintLink({ url: args.url });
    } } : {}),
    ...(mint ? Object.fromEntries([['inspect_mint', 'inspectMint'], ['simulate_mint', 'simulateMint'], ['prepare_mint', 'prepareMint']]
      .map(([tool, method]) => [tool, async (args, context) => {
        argsOnly(args, ['opportunityId']);
        if (selectedVersion(context, 1) !== 1) throw Error('UNREVIEWED_SKILL_VERSION');
        return mint[method]({ tokenId: args.tokenId, owner: args.owner, opportunityId: args.opportunityId });
      }])) : {}),
  };
  // The same fresh gate supplies provider-neutral instruction context and enforces each call.
  return createSkillToolGate({ readState, packages, implementations });
}
