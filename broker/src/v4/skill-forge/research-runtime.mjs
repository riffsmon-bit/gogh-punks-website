import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSkillToolGate, manifestHash, instructionHash } from './capability-resolver.mjs';
import { inspectContract, retrieveInlineMetadata, rankTraitSample } from './research-tools.mjs';
import { createMarketReader } from './market-reader.mjs';

const PACKAGES = ['contract-detective', 'rarity-eye', 'market-scout'];
const ROOT = new URL('../../../../', import.meta.url);
export async function loadResearchSkillCatalog() {
  return Promise.all(PACKAGES.map(async slug => {
    const dir = new URL(`broker/skills/${slug}/v1/`, ROOT);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
    const instructions = await readFile(new URL('SKILL.md', dir), 'utf8');
    if (!['broker/src/v4/skill-forge/research-tools.mjs', 'broker/src/v4/skill-forge/market-reader.mjs'].includes(manifest.implementation)) throw new Error('UNREVIEWED_IMPLEMENTATION');
    const digest = createHash('sha256').update(await readFile(new URL(manifest.implementation, ROOT))).digest('hex');
    if (digest !== manifest.implementationSha256) throw new Error('IMPLEMENTATION_HASH_MISMATCH');
    return Object.freeze({ manifest, instructions, status: 'TESTING', approved: false,
      manifestHash: manifestHash(manifest), instructionHash: instructionHash(instructions) });
  }));
}
function argsOnly(args, permitted) {
  if (!args || Object.getPrototypeOf(args) !== Object.prototype || Object.keys(args).some(k => !['tokenId', 'owner', ...permitted].includes(k))) throw new Error('INVALID_RESEARCH_ARGUMENTS');
}
export function createResearchSkillRuntime({ readState, packages, client, apiKey, fetchImpl }) {
  // No key means no market tool, rather than fake or cached-as-live market data.
  const market = apiKey ? createMarketReader({ apiKey, fetchImpl }) : null;
  const implementations = {
    inspect_contract: async args => { argsOnly(args, ['contract']); return inspectContract({ client, contract: args.contract }); },
    get_metadata: async args => { argsOnly(args, ['contract', 'tokenIds']); return retrieveInlineMetadata({ client, contract: args.contract, tokenIds: args.tokenIds }); },
    rank_trait_sample: async args => {
      argsOnly(args, ['contract', 'tokenIds', 'numericMode']);
      const metadata = await retrieveInlineMetadata({ client, contract: args.contract, tokenIds: args.tokenIds });
      return { ...rankTraitSample(metadata.tokens, { numericMode: args.numericMode ?? 'reject' }), metadataEvidence: { blockNumber: metadata.blockNumber, blockHash: metadata.blockHash, metadataHash: metadata.metadataHash } };
    },
    ...(market ? { get_market_listings: async args => { argsOnly(args, ['slug', 'contract', 'limit']); return market.getListings({ slug: args.slug, contract: args.contract, limit: args.limit }); } } : {}),
  };
  // The same fresh gate supplies provider-neutral instruction context and enforces each call.
  return createSkillToolGate({ readState, packages, implementations });
}
