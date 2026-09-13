import { pathToFileURL } from 'node:url';
import { createPublicClient, http } from 'viem';
import releaseArtifact from '../../../deployments/robinhood-forge-training.json' with { type: 'json' };
import { ROBINHOOD } from '../../../broker/src/config.mjs';
import { validateTrainingRelease } from '../../../broker/src/v4/skill-forge/training-release.mjs';
import { readReviewedTrainingState, assertTrainingOwnerContinuity } from '../../../broker/src/v4/skill-forge/training-state.mjs';
import { createProgressionReader, skillKey } from '../../../broker/src/v4/skill-forge/capability-resolver.mjs';
import { createResearchSkillRuntime, loadResearchSkillCatalog } from '../../../broker/src/v4/skill-forge/research-runtime.mjs';

const TOOLS = ['inspect_contract', 'get_metadata', 'rank_trait_sample', 'get_market_listings'];
const fail = code => { throw Error(code); };
function researchArguments(name, tokenId, args, collection) {
  const sample = ['get_metadata', 'rank_trait_sample'].includes(name);
  if (!TOOLS.includes(name) || !args || Object.getPrototypeOf(args) !== Object.prototype
    || Reflect.ownKeys(args).some(key => key !== (sample ? 'sampleTokenIds' : null))
    || Object.values(Object.getOwnPropertyDescriptors(args)).some(item => !Object.hasOwn(item, 'value'))) fail('MCP_RESEARCH_ARGUMENTS');
  const fixed = { contract: collection };
  if (sample) {
    const ids = args.sampleTokenIds;
    if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3 || !ids.includes(tokenId)
      || ids.some(id => typeof id !== 'string' || !/^[1-9][0-9]{0,3}$/.test(id))) fail('MCP_RESEARCH_SAMPLE_INVALID');
    return { ...fixed, tokenIds: [...ids], ...(name === 'rank_trait_sample' ? { numericMode: 'categorical' } : {}) };
  }
  return name === 'get_market_listings' ? { ...fixed, slug: 'gogh-punks-255843210', limit: 5 } : fixed;
}

// This read-only bridge never constructs a training coordinator, database store,
// signer, transaction, or wallet request. Configuration and packages are server
// owned, with exactly the existing release's owner, collection and version pins.
export function createV2McpResearch({ releaseReader = () => validateTrainingRelease(releaseArtifact),
  clientFactory = () => createPublicClient({ transport: http(ROBINHOOD.rpcUrl, { timeout: 5000, retryCount: 0 }), cacheTime: 0 }),
  stateReader = readReviewedTrainingState, continuityReader = assertTrainingOwnerContinuity,
  packageLoader = () => loadResearchSkillCatalog({ root: pathToFileURL(`${process.cwd()}/`) }),
  progressionFactory = createProgressionReader, researchFactory = createResearchSkillRuntime,
  environment = process.env,
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
    const packages = (await packageLoader()).filter(pack => release.skills.some(skill =>
      skill.key === skillKey(pack.manifest.skillId, pack.manifest.version)
      && skill.manifestHash === pack.manifestHash && skill.instructionHash === pack.instructionHash))
      .map(pack => ({ ...pack, status: 'READY', approved: true }));
    return researchFactory({ client, packages, apiKey: environment.OPENSEA_API_KEY,
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
        trainingCredits: before.credits, unlockedSlots: before.slots,
        learnedSkills: before.skills.filter(skill => skill.level > 0),
        equippedSkills: before.equipped.map((key, slot) => ({ slot, key })).filter(item => item.key !== `0x${'0'.repeat(64)}`),
        skillCoverage: 'CURRENT_SERVER_RELEASE', anchor: before.anchor, walletAuthority: 'NONE' };
    },
  });
}
