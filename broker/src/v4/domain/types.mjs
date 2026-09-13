// JSDoc contracts describe current values, not replacement runtime validators.
// Result aliases follow their owning implementation automatically.

/** @typedef {import('./identity.mjs').PunkIdentity} PunkIdentity */
/** @typedef {ReturnType<typeof import('../collecting-intent.mjs').normalizePunkCollectingIntent>} PunkCollectingIntent */
/** @typedef {ReturnType<typeof import('../punk-skill.mjs').normalizePunkSkill>} PunkSkill */
/** @typedef {ReturnType<typeof import('../opportunity.mjs').normalizeV2Opportunity>} NormalizedOpportunity */
/** @typedef {ReturnType<typeof import('../security-screen.mjs').screenKnownSafeMint>} SecurityScreenResult */
/** @typedef {ReturnType<typeof import('../simulation.mjs').validateMintSimulation>} SimulationResult */
/** @typedef {ReturnType<typeof import('../policy-matcher.mjs').matchV2Opportunity>} PolicyDecision */
/** @typedef {ReturnType<typeof import('../skill-forge/capability-resolver.mjs').resolvePunkCapabilities>} EffectiveCapabilities */
/** @typedef {import('../ai/provider.mjs').ArtBrokerAIProvider} AIProvider */
/** @typedef {ReturnType<typeof import('../ai/provider.mjs').providerResult>} AIProviderResult */
/** @typedef {ReturnType<typeof import('../../control-center/agent-activity.mjs').normalizeAgentHeartbeat>} AgentHeartbeat */

/**
 * Existing readV2PunkAuthority result. The canonical V3 Wallet is distinct from
 * the Agent Account used by owner-approved missions. No write methods appear in
 * this read model; owner funding/withdrawal endpoints retain their own reviews.
 * @typedef {PunkIdentity & Readonly<{
 *   owner: string, punkWallet: string, activated: boolean,
 *   blockNumber: string, nativeBalanceWei: string, blockHash?: string
 * }>} PunkWalletSummary
 */

/**
 * A current-owner observation, not a reusable permission or cryptographic proof.
 * ReadOwnerAuthority invokes ownerOf and reviewed registry reads. Its production
 * adapter must reject a mismatched expectedOwner and preserve continuity guards.
 * @typedef {PunkWalletSummary} OwnerAuthority
 * @callback ReadOwnerAuthority
 * @param {string} tokenId
 * @param {{expectedOwner?: string | null}} [options]
 * @returns {Promise<OwnerAuthority>}
 */

/**
 * Existing broker-v2-punk response.profile shape. collectionCount is historical
 * acquisitions in the current endpoint, not proof of present NFT ownership.
 * Null strategy means no visible ACTIVE/PAUSED strategy for this current owner.
 * @typedef {Readonly<{
 *   tokenId: string, owner: string, punkWallet: string, activated: boolean,
 *   nativeBalanceWei: string, collectionCount: number, todayActivityCount: number,
 *   strategy: null | Readonly<{version: number, intentHash: string,
 *     intent: PunkCollectingIntent, state: 'ACTIVE' | 'PAUSED',
 *     expiresAt: string, activatedAt: string | null}>
 * }>} PunkProfile
 */

/**
 * Existing registry definition(bytes32) ABI tuple, with Solidity uint256 values
 * returned as bigint by viem. JSON transport must deliberately encode these;
 * it must not Number() a capability mask or amount. READY is numeric status 4.
 * @typedef {Readonly<{
 *   manifestHash: string, instructionHash: string, prerequisite: string,
 *   capabilities: bigint, skillId: number, version: number, riskTier: number,
 *   status: number, disabled: boolean, deprecated: boolean, replacement: string,
 *   reviewEvidenceHash: string
 * }>} SkillDefinition
 */

/**
 * Existing progression snapshot from createProgressionReader. The registry ABI
 * and resolvePunkCapabilities own validation; displayed names are not authority.
 * This preserves token-bound progression when owner changes. Wrapped snapshots
 * may contain additional epoch fields; original owner authority stays separate.
 * @typedef {PunkIdentity & Readonly<{
 *   owner: string, slots: number, mask: string, blockNumber: string,
 *   blockHash: string, blockTime: number, authorityEpoch?: string,
 *   equipped: ReadonlyArray<Readonly<{slot: number, key: string, level: number,
 *     definition: SkillDefinition, available: boolean}>>
 * }>} SkillLoadout
 */

/**
 * Existing state-machine view consumed by transitionV2ExecutionAttempt. The
 * PostgreSQL row uses snake_case and remains owned by PostgresV2ExecutionStore;
 * a transition view is not a complete persisted row or signed transaction.
 * @typedef {'RESERVED' | 'SIMULATED' | 'OWNER_APPROVAL_PENDING' |
 *   'OWNER_APPROVED' | 'SUBMISSION_RESERVED' | 'SUBMITTED' | 'CONFIRMED' |
 *   'REVERTED' | 'RECONCILIATION_REQUIRED' | 'REJECTED' | 'CANCELLED' |
 *   'EXPIRED'} ExecutionState
 * @typedef {Readonly<{idempotencyKey: string, state: ExecutionState,
 *   updatedAt?: string}>} ExecutionAttempt
 */

/**
 * Existing broker-v2-activity entry. Detail is public, event-specific data from
 * the owning producer; no new authority/custody claims are inferred from it.
 * @typedef {Readonly<{id: string, type: string, detail: unknown,
 *   occurredAt: string, provenance: string}>} PunkActivity
 */

export {};
