// Server-only compatibility facade. Existing modules remain the schema and
// behavior owners; these are direct exports, not more permissive wrappers.
export {
  PUNK_IDENTITY_JSON_SCHEMA, normalizePunkIdentity, punkIdentityKey,
  assertPunkAuthorityBinding, assertPunkCapabilityBinding,
} from './identity.mjs';
export {
  PUNK_COLLECTING_INTENT_SCHEMA, PUNK_COLLECTING_INTENT_VERSION,
  PUNK_COLLECTING_INTENT_JSON_SCHEMA, V2_OPERATING_MODES, V2_MINT_MODES,
  V2_ART_STYLES, normalizePunkCollectingIntent, punkCollectingIntentHash,
  collectingIntentConfirmation, defaultAskIntent,
} from '../collecting-intent.mjs';
export {
  PUNK_SKILL_SCHEMA, PUNK_SKILL_CAPABILITIES, normalizePunkSkill,
  draftPunkSkillFromConversation, activatePunkSkill,
} from '../punk-skill.mjs';
export {
  SKILL_CAPABILITIES, skillKey, manifestHash, instructionHash,
  createProgressionReader, resolvePunkCapabilities, createSkillToolGate,
} from '../skill-forge/capability-resolver.mjs';
export {
  NORMALIZED_V2_OPPORTUNITY_SCHEMA, normalizeV2Opportunity, v2OpportunityDedupeKey,
} from '../opportunity.mjs';
export { screenKnownSafeMint } from '../security-screen.mjs';
export { validateMintSimulation } from '../simulation.mjs';
export { matchV2Opportunity } from '../policy-matcher.mjs';
export {
  V2_EXECUTION_CAPABILITIES, v2ExecutionIdentity, assertV2ExecutionCapability,
  transitionV2ExecutionAttempt,
} from '../execution-boundary.mjs';
export { ART_BROKER_AI_TASKS, ArtBrokerAIProvider, ArtBrokerProviderError } from '../ai/provider.mjs';
export { normalizeAgentHeartbeat, activityMessage } from '../../control-center/agent-activity.mjs';

/** @typedef {import('./identity.mjs').PunkIdentity} PunkIdentity */
/** @typedef {import('./types.mjs').PunkProfile} PunkProfile */
/** @typedef {import('./types.mjs').PunkWalletSummary} PunkWalletSummary */
/** @typedef {import('./types.mjs').OwnerAuthority} OwnerAuthority */
/** @typedef {import('./types.mjs').PunkCollectingIntent} PunkCollectingIntent */
/** @typedef {import('./types.mjs').PunkSkill} PunkSkill */
/** @typedef {import('./types.mjs').SkillDefinition} SkillDefinition */
/** @typedef {import('./types.mjs').SkillLoadout} SkillLoadout */
/** @typedef {import('./types.mjs').EffectiveCapabilities} EffectiveCapabilities */
/** @typedef {import('./types.mjs').NormalizedOpportunity} NormalizedOpportunity */
/** @typedef {import('./types.mjs').SecurityScreenResult} SecurityScreenResult */
/** @typedef {import('./types.mjs').SimulationResult} SimulationResult */
/** @typedef {import('./types.mjs').PolicyDecision} PolicyDecision */
/** @typedef {import('./types.mjs').ExecutionAttempt} ExecutionAttempt */
/** @typedef {import('./types.mjs').PunkActivity} PunkActivity */
/** @typedef {import('./types.mjs').AIProvider} AIProvider */
