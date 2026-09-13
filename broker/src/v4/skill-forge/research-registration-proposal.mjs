import { encodeFunctionData, parseAbi } from 'viem';
import { SKILL_CAPABILITIES, skillKey } from './capability-resolver.mjs';
import { loadResearchSkillCatalog } from './research-runtime.mjs';

const ABI = parseAbi(['function register(uint32,uint16,bytes32,bytes32,bytes32,uint256,uint8) returns(bytes32)']);
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const SELECTION = Object.freeze([{ slug: 'market-scout', version: 2 }, { slug: 'link-sniper', version: 1 }, { slug: 'mint-hunter', version: 1 }]);

// A review artifact, not a transaction. No sender, destination, nonce, fee or
// READY transition is encoded; the root must select and verify a deployment.
export async function buildResearchRegistrationProposal({ root } = {}) {
  const packages = await loadResearchSkillCatalog({ ...(root ? { root } : {}), selection: SELECTION });
  return {
    schema: 'GOGH_RESEARCH_SKILL_REGISTRATION_PROPOSAL_V1', chainId: 4663,
    status: 'REVIEW_REQUIRED', transactionSubmitted: false, productionAuthorized: false,
    definitions: packages.map(pack => {
      const m = pack.manifest, capabilities = m.capabilities.reduce((mask, name) => mask | SKILL_CAPABILITIES[name], 0n);
      return { slug: pack.slug, skillId: m.skillId, version: m.version, key: skillKey(m.skillId, m.version),
        manifestHash: pack.manifestHash, instructionHash: pack.instructionHash,
        implementation: m.implementation, implementationSha256: m.implementationSha256,
        capabilities: capabilities.toString(), riskTier: m.riskTier, prerequisite: ZERO_HASH,
        initialRegistryStatus: 'DISCOVERED', readyTransitionIncluded: false,
        reviewOnlyRegisterCalldata: encodeFunctionData({ abi: ABI, functionName: 'register',
          args: [m.skillId, m.version, pack.manifestHash, pack.instructionHash, ZERO_HASH, capabilities, m.riskTier] }),
        walletAuthority: 'NONE', runtimeStatus: pack.status, runtimeApproved: pack.approved };
    }),
    requiredBeforeActivation: [
      'Independent implementation and package-hash review.',
      'Current registry owner, code hashes, nonce, chain and registration state checks.',
      'Explicit administrator confirmation and a separate TESTING-to-READY evidence attestation.',
      'Server release must select the exact reviewed versions and pins.',
      'Mint Hunter requires the current owner/confirmed strategy/shared opportunity context service.',
      'Holder must learn and equip a skill; transfer continuity and owner authority remain separate checks.',
    ],
  };
}
