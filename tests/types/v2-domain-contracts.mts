// Compiler-only consumers of the authoritative JSDoc surface. Never execute.
// Negative compiler assertions fail the gate if a protected constraint becomes any.
import {
  normalizePunkIdentity, normalizePunkCollectingIntent, normalizePunkSkill,
  normalizeV2Opportunity, screenKnownSafeMint, validateMintSimulation,
  matchV2Opportunity, resolvePunkCapabilities, normalizeAgentHeartbeat,
  assertPunkAuthorityBinding, assertPunkCapabilityBinding,
} from '../../broker/src/v4/domain/index.mjs';
import type {
  PunkIdentity, PunkWalletSummary, OwnerAuthority, ReadOwnerAuthority,
  PunkProfile, PunkCollectingIntent, PunkSkill, SkillDefinition, SkillLoadout,
  EffectiveCapabilities, NormalizedOpportunity, SecurityScreenResult,
  SimulationResult, PolicyDecision, ExecutionAttempt, PunkActivity,
  AIProvider, AIProviderResult, AgentHeartbeat,
} from '../../broker/src/v4/domain/types.mjs';
import { providerResult } from '../../broker/src/v4/ai/provider.mjs';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type IsAny<T> = 0 extends (1 & T) ? true : false;

// Aliases must track the owning implementation, rather than a second schema.
type DerivedResults = [
  Expect<Equal<PunkIdentity, ReturnType<typeof normalizePunkIdentity>>>,
  Expect<Equal<PunkCollectingIntent, ReturnType<typeof normalizePunkCollectingIntent>>>,
  Expect<Equal<PunkSkill, ReturnType<typeof normalizePunkSkill>>>,
  Expect<Equal<NormalizedOpportunity, ReturnType<typeof normalizeV2Opportunity>>>,
  Expect<Equal<SecurityScreenResult, ReturnType<typeof screenKnownSafeMint>>>,
  Expect<Equal<SimulationResult, ReturnType<typeof validateMintSimulation>>>,
  Expect<Equal<PolicyDecision, ReturnType<typeof matchV2Opportunity>>>,
  Expect<Equal<EffectiveCapabilities, ReturnType<typeof resolvePunkCapabilities>>>,
  Expect<Equal<AIProviderResult, ReturnType<typeof providerResult>>>,
  Expect<Equal<AgentHeartbeat, ReturnType<typeof normalizeAgentHeartbeat>>>,
  Expect<Equal<IsAny<PunkIdentity>, false>>,
  Expect<Equal<IsAny<PunkCollectingIntent>, false>>,
  Expect<Equal<IsAny<PunkSkill>, false>>,
  Expect<Equal<IsAny<NormalizedOpportunity>, false>>,
  Expect<Equal<IsAny<SecurityScreenResult>, false>>,
  Expect<Equal<IsAny<PolicyDecision>, false>>,
  Expect<Equal<IsAny<EffectiveCapabilities>, false>>,
  Expect<Equal<IsAny<SimulationResult>, false>>,
  Expect<Equal<IsAny<AIProviderResult>, false>>,
  Expect<Equal<IsAny<AgentHeartbeat>, false>>,
];

declare const input: unknown;
const identity: PunkIdentity = normalizePunkIdentity(input);
const canonicalChain: 4663 = identity.chainId;
const tokenId: string = identity.tokenId;
// @ts-expect-error A token-bound identity cannot be rewritten by a consumer.
identity.tokenId = '44';
// @ts-expect-error Identity is fixed to the original collection's chain.
const wrongChain: PunkIdentity = { ...identity, chainId: 1 };
// @ts-expect-error Token IDs use canonical decimal strings, never JS numbers.
const numericToken: PunkIdentity = { ...identity, tokenId: 93 };
// @ts-expect-error Owner is a fresh observation, not a stable identity key.
const ownerIdentity: PunkIdentity = { ...identity, owner: '0xowner' };

declare const authority: OwnerAuthority;
const wallet: PunkWalletSummary = authority;
const nativeBalance: bigint = BigInt(wallet.nativeBalanceWei);
// @ts-expect-error A read-only authority observation has no signer method.
authority.signTransaction({});
// @ts-expect-error Read models are immutable.
wallet.owner = '0xother';
// @ts-expect-error Large balances remain decimal strings across transport.
const lossyWallet: PunkWalletSummary = { ...wallet, nativeBalanceWei: 1 };
declare const readAuthority: ReadOwnerAuthority;
const fresh: Promise<OwnerAuthority> = readAuthority(tokenId, { expectedOwner: authority.owner });
// @ts-expect-error Current-owner readers accept a string token ID.
readAuthority(93);
// @ts-expect-error Current-owner readers do not accept an injected signer.
readAuthority(tokenId, { signTransaction: () => '0x' });
const noAuthority: void = assertPunkAuthorityBinding(authority,
  { identity, owner: authority.owner, punkWallet: authority.punkWallet });

declare const profile: PunkProfile;
const historicalCount: number = profile.collectionCount;
if (profile.strategy) {
  const intent: PunkCollectingIntent = profile.strategy.intent;
  const state: 'ACTIVE' | 'PAUSED' = profile.strategy.state;
  void [intent, state];
}
// @ts-expect-error No active strategy is a legitimate null result.
const mustHaveStrategy: NonNullable<PunkProfile['strategy']> = profile.strategy;

declare const definition: SkillDefinition;
declare const loadout: SkillLoadout;
const exactMask: bigint = definition.capabilities;
const level: number | undefined = loadout.equipped[0]?.level;
// @ts-expect-error Solidity capability masks must not be narrowed to JS numbers.
const lossyDefinition: SkillDefinition = { ...definition, capabilities: 8 };
// @ts-expect-error Token-bound learned/equipped snapshots are immutable.
loadout.equipped.push(loadout.equipped[0]);
declare const capabilities: EffectiveCapabilities;
const walletAuthority: 'NONE' = capabilities.walletAuthority;
const separateAuthorization: true = capabilities.requiresSeparateEconomicAuthorization;
const noCapabilityAuthority: void = assertPunkCapabilityBinding(capabilities, loadout);
// @ts-expect-error Skills may expose research tools, never wallet signing authority.
const signingSkills: EffectiveCapabilities = { ...capabilities, walletAuthority: 'SIGN' };
// @ts-expect-error Skill eligibility does not carry economic authorization.
const economicSkills: EffectiveCapabilities = { ...capabilities, requiresSeparateEconomicAuthorization: false };
// @ts-expect-error The resolver's tool list cannot be extended by a consumer.
capabilities.effectiveMcpTools.push('send_transaction');

declare const simulation: SimulationResult;
const simulationStatus: 'FAILED' | 'PASSED' = simulation.status;
const gas: string | null = simulation.estimatedGasWei;
const simulationAuthorization: false = simulation.executionAuthorized;
// @ts-expect-error Passing simulation does not authorize a transaction.
const authorizedSimulation: SimulationResult = { ...simulation, executionAuthorized: true };
// @ts-expect-error Failed simulation can have an unknown gas estimate.
const guaranteedGas: string = simulation.estimatedGasWei;
declare const conversationalSkill: PunkSkill;
const conversationalAuthority: 'READ_ONLY' = conversationalSkill.authority;
const conversationalEffect: 'NONE' = conversationalSkill.policyEffect;

declare const attempt: ExecutionAttempt;
const terminal: ExecutionAttempt = { idempotencyKey: attempt.idempotencyKey, state: 'CONFIRMED' };
// @ts-expect-error Unknown execution states cannot enter a typed transition view.
const unknownState: ExecutionAttempt = { ...attempt, state: 'SIGNED_BY_AI' };
// @ts-expect-error Transition views do not hold wallet signatures.
const signedAttempt: ExecutionAttempt = { ...attempt, signature: '0x' };
declare const activity: PunkActivity;
// @ts-expect-error Public event detail must be narrowed before use.
const secret: string = activity.detail.privateKey;
declare const provider: AIProvider;
const completion: Promise<AIProviderResult> = provider.invoke('CHAT', { prompt: 'Explain this collection.' });
// @ts-expect-error Intelligence task names cannot request arbitrary execution.
provider.invoke('SIGN_TRANSACTION', { prompt: 'Send funds.' });
// @ts-expect-error Provider inputs require a bounded prompt, not wallet calldata.
provider.invoke('CHAT', { transaction: { data: '0x' } });
// @ts-expect-error Providers own intelligence transport, not transaction signing.
provider.signTransaction({});

void [canonicalChain, tokenId, nativeBalance, fresh, noAuthority, historicalCount,
  exactMask, level, walletAuthority, separateAuthorization, noCapabilityAuthority,
  simulationStatus, gas, simulationAuthorization, conversationalAuthority,
  conversationalEffect, terminal, completion];
export type { DerivedResults };
