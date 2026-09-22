import { readCanonicalTrainingState, createCanonicalProgressionReader } from '../../../broker/src/v4/skill-forge/paid-canonical.mjs';
import { pathToFileURL } from 'node:url';
import releaseArtifact from '../../../deployments/robinhood-forge-training.json' with { type: 'json' };
import { ROBINHOOD } from '../../../broker/src/config.mjs';
import { validateTrainingRelease } from '../../../broker/src/v4/skill-forge/training-release.mjs';
import { assertTrainingOwnerContinuity } from '../../../broker/src/v4/skill-forge/training-state.mjs';
import { skillKey } from '../../../broker/src/v4/skill-forge/capability-resolver.mjs';
import { createResearchSkillRuntime, loadResearchSkillCatalog } from '../../../broker/src/v4/skill-forge/research-runtime.mjs';
import { createForgeRpcClients } from '../../../broker/src/v4/skill-forge/rpc-clients.mjs';
import { createMintResearchContextReader } from './v2-mint-research-context.mjs';

const TOOLS = ['inspect_contract', 'get_metadata', 'rank_trait_sample', 'get_market_listings', 'inspect_mint_link', 'inspect_mint', 'simulate_mint', 'prepare_mint',
  'rank_observed_listings', 'research_collection', 'classify_collection', 'research_project'];
const fail = code => { throw Error(code); };
function researchArguments(name, tokenId, args, collection) {
  const mint = ['inspect_mint', 'simulate_mint', 'prepare_mint'].includes(name);
  const link = name === 'inspect_mint_link';
  const sample = ['get_metadata', 'rank_trait_sample', 'research_collection', 'classify_collection'].includes(name);
  if (!TOOLS.includes(name) || !args || Object.getPrototypeOf(args) !== Object.prototype
    || Reflect.ownKeys(args).some(key => key !== (sample ? 'sampleTokenIds' : mint ? 'opportunityId' : link ? 'url' : null))
    || Object.values(Object.getOwnPropertyDescriptors(args)).some(item => !Object.hasOwn(item, 'value'))) fail('MCP_RESEARCH_ARGUMENTS');
  if (mint) {
    if (typeof args.opportunityId !== 'string' || !/^[a-zA-Z0-9:_-]{8,256}$/.test(args.opportunityId)) fail('MCP_RESEARCH_ARGUMENTS');
    return { opportunityId: args.opportunityId };
  }
  if (link) {
    if (typeof args.url !== 'string' || args.url.length > 2048 || args.url.length < 1) fail('MCP_RESEARCH_ARGUMENTS');
    return { url: args.url };
  }
  const fixed = { contract: collection };
  if (sample) {
    const ids = args.sampleTokenIds;
    if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3 || !ids.includes(tokenId)
      || ids.some(id => typeof id !== 'string' || !/^[1-9][0-9]{0,3}$/.test(id))) fail('MCP_RESEARCH_SAMPLE_INVALID');
    return { ...fixed, tokenIds: [...ids], ...(name === 'rank_trait_sample' ? { numericMode: 'categorical' } : {}) };
  }
  if (name === 'research_project') return { ...fixed, slug: 'gogh-punks-255843210' };
  return ['get_market_listings', 'rank_observed_listings'].includes(name) ? { ...fixed, slug: 'gogh-punks-255843210', limit: 5 } : fixed;
}

// Exact registry versions choose reviewed local packages. No implicit v1 fallback.
const REVIEWED_PACKAGES = Object.freeze([
  [3, 1, 'contract-detective'], [4, 1, 'rarity-eye'], [8, 1, 'market-scout'],
  [8, 2, 'market-scout'], [2, 1, 'link-sniper'], [1, 1, 'mint-hunter'],
  [9, 1, 'floor-hunter'], [11, 1, 'collection-researcher'], [6, 1, 'art-curator'],
  [7, 1, 'social-scout'],
]);
export function mcpResearchPackageSelection(release) {
  return REVIEWED_PACKAGES.filter(([id, version]) => release.skills.some(skill => skill.key === skillKey(id, version)))
    .map(([, version, slug]) => ({ slug, version }));
}

// This read-only bridge never requests signing, submission or database writes.
// Mint context uses the restricted Forge database reader only when needed.
// Server-owned configuration retains the release's exact owner, collection and version pins.
export function createV2McpResearch({ pool, releaseReader = () => validateTrainingRelease(releaseArtifact),
  clientFactory = () => createForgeRpcClients(environment)[1],
  stateReader = readCanonicalTrainingState, continuityReader = assertTrainingOwnerContinuity,
  packageLoader = ({ selection }) => loadResearchSkillCatalog({ root: pathToFileURL(`${process.cwd()}/`), selection }),
  progressionFactory = createCanonicalProgressionReader, researchFactory = createResearchSkillRuntime,
  environment = process.env, mintContextFactory = createMintResearchContextReader,
} = {}) {
  function released(owner) {
    const release = releaseReader();
    return release.status === 'OWNER_CANARY' && release.allowedOwners.includes(owner) ? release : null;
  }
  async function snapshot({ owner, tokenId }) {
    owner = owner.toLowerCase();
    const release = released(owner);
    if (!release) return null;
    const client = clientFactory();
    const before = await stateReader({ client, release, owner, tokenId });
    return { client, release, owner, tokenId, before };
  }
  async function unchanged(context) {
    const { client, release, owner, tokenId, before } = context;
    const after = await stateReader({ client, release, owner, tokenId });
    if (before.nonce !== after.nonce || before.stateHash !== after.stateHash) fail('MCP_RESEARCH_CONTEXT_CHANGED');
    // Includes canonical-block and Transfer-log checks, so transfer away and back
    // is rejected even when ownerOf is the same again by the end of the read.
    await continuityReader({ client, release, owner, tokenId, anchor: before.anchor });
  }
  async function runtime({ client, release }) {
    const selection = mcpResearchPackageSelection(release);
    const packages = (selection.length ? await packageLoader({ selection }) : []).filter(pack => release.skills.some(skill =>
      skill.key === skillKey(pack.manifest.skillId, pack.manifest.version)
      && skill.manifestHash === pack.manifestHash && skill.instructionHash === pack.instructionHash))
      .map(pack => ({ ...pack, status: 'READY', approved: true }));
    return researchFactory({ client, packages, apiKey: environment.OPENSEA_API_KEY, environment,
      mintContextReader: pool && packages.some(pack => pack.slug === 'mint-hunter')
        ? mintContextFactory({ pool, client, environment }) : undefined,
      readState: progressionFactory({ client, chainId: release.chainId, collection: release.collection,
        registry: release.registry, progression: release.progression, registryCodeHash: release.registryCodeHash,
        progressionCodeHash: release.progressionCodeHash }) });
  }
  return Object.freeze({
    async resolve(identity) {
      const context = await snapshot(identity);
      if (!context) return null; // Unreleased is not a verified empty loadout.
      const research = await runtime(context);
      const capabilities = await research.resolve({ tokenId: context.tokenId, owner: context.owner });
      await unchanged(context);
      return capabilities;
    },
    async call({ tokenId, owner, name, arguments: args = {} }) {
      // Reject target/owner/capability injection before any RPC or package read.
      researchArguments(name, tokenId, args, ROBINHOOD.canonicalCollection);
      const context = await snapshot({ tokenId, owner });
      if (!context) fail('MCP_RESEARCH_NOT_RELEASED');
      const research = await runtime(context);
      const result = await research.call({ tokenId, owner: context.owner, name,
        arguments: researchArguments(name, tokenId, args, context.release.collection) });
      await unchanged(context);
      return { mode: 'EQUIPPED_RESEARCH', tokenId, owner: context.owner, chainId: context.release.chainId,
        result, observedAt: new Date().toISOString(), walletAuthority: 'NONE', canBurn: false,
        requiresSeparateEconomicAuthorization: true };
    },
    async getSkills(identity) {
      const context = await snapshot(identity);
      if (!context) return { tokenId: identity.tokenId, status: 'UNAVAILABLE', learnedSkills: null,
        equippedSkills: null, unlockedSlots: null, trainingCredits: null, walletAuthority: 'NONE' };
      const { before, tokenId } = context;
      await unchanged(context);
      return { tokenId, status: 'VERIFIED', chainId: context.release.chainId, owner: context.owner,
        trainingCredits: before.credits, purchasedCredits: before.purchasedCredits ?? null, unlockedSlots: before.slots,
        learnedSkills: before.skills.filter(skill => skill.level > 0),
        equippedSkills: before.equipped.map((key, slot) => ({ slot, key })).filter(item => item.key !== `0x${'0'.repeat(64)}`),
        skillCoverage: 'CURRENT_SERVER_RELEASE', anchor: before.anchor, walletAuthority: 'NONE' };
    },
  });
}
