import { assertV2ExecutionCapability, v2ExecutionIdentity } from "./execution-boundary.mjs";
import { matchV2Opportunity } from "./policy-matcher.mjs";
import { normalizePunkCollectingIntent, punkCollectingIntentHash } from "./collecting-intent.mjs";
import { normalizeV2Opportunity } from "./opportunity.mjs";
import { screenKnownSafeMint } from "./security-screen.mjs";
import { validateMintSimulation } from "./simulation.mjs";
import { isDeepStrictEqual } from "node:util";
import { ROBINHOOD } from "../config.mjs";

export class V2ExecutorError extends Error {
  constructor(code, message) { super(message); this.name = "V2ExecutorError"; this.code = code; }
}
function fail(code, message) { throw new V2ExecutorError(code, message); }

// Dependencies receive detached, immutable data. Accessors and mutable exotic
// objects cannot stand in for the bytes or authority that were reviewed.
function snapshot(value, depth = 0) {
  if (value === null || ["string", "boolean", "bigint", "undefined"].includes(typeof value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || depth > 16
    || ![Object.prototype, Array.prototype].includes(Object.getPrototypeOf(value))) {
    fail("EXECUTION_CONTEXT_CHANGED", "Execution context must contain plain data.");
  }
  // Preserve sparse-array length: missing effect evidence must not become [].
  const copy = Array.isArray(value) ? new Array(value.length) : {};
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("EXECUTION_CONTEXT_CHANGED", "Execution context must contain plain data.");
    }
    Object.defineProperty(copy, key, { value: snapshot(descriptor.value, depth + 1), enumerable: true });
  }
  return Object.freeze(copy);
}

function matchingState(authority, intent, usage) {
  for (const key of ["dailyMints", "totalMints", "opportunityMints"]) {
    if (Object.hasOwn(usage, key) && (!Number.isSafeInteger(usage[key]) || usage[key] < 0)) {
      throw new TypeError("Punk matching state is invalid");
    }
  }
  const currentOwner = String(authority?.owner ?? "").toLowerCase();
  const punkWallet = String(authority?.punkWallet ?? "").toLowerCase();
  if (currentOwner !== intent.expectedOwner || punkWallet !== intent.punkWallet) {
    fail("OWNERSHIP_CHANGED", "Current on-chain Punk authority no longer matches the strategy.");
  }
  if (authority.chainId !== undefined && authority.chainId !== ROBINHOOD.chainId
    || authority.collection !== undefined && String(authority.collection).toLowerCase() !== ROBINHOOD.canonicalCollection
    || authority.tokenId !== undefined && String(authority.tokenId) !== intent.punkTokenId
    || Object.hasOwn(authority, "activated") && authority.activated !== true
    || authority.blockHash !== undefined && !/^0x[0-9a-f]{64}$/i.test(authority.blockHash)
    || authority.authorityEpoch !== undefined
    || !/^(?:0|[1-9]\d{0,77})$/.test(String(authority.blockNumber ?? ""))) {
    fail("EXECUTION_CONTEXT_CHANGED", "The authority snapshot does not match the selected Punk.");
  }
  return { currentOwner, punkWallet, punkWalletBalanceWei: authority.nativeBalanceWei,
    dailyMints: Object.hasOwn(usage, "dailyMints") ? usage.dailyMints : 0,
    totalMints: Object.hasOwn(usage, "totalMints") ? usage.totalMints : 0,
    opportunityMints: Object.hasOwn(usage, "opportunityMints") ? usage.opportunityMints : 0 };
}

function reviewedMatch(intent, opportunity, state, now) {
  // The intent normalizer rejects expired input before policy can name this reason.
  if (Date.parse(intent.expiration) <= new Date(now).getTime()) {
    fail("POLICY_REJECTED", "Opportunity failed policy: STRATEGY_EXPIRED");
  }
  const match = matchV2Opportunity(intent, opportunity, state, now);
  if (!match.matched) fail("POLICY_REJECTED", `Opportunity failed policy: ${match.reasons.join(", ")}`);
  return match;
}

export class StatelessV2Executor {
  #authority; #attempts; #adapter; #simulate; #clock;
  constructor({ readAuthority, attemptStore, buildKnownSafeMint, simulate,
    clock = () => new Date() }) {
    if (typeof readAuthority !== "function" || !attemptStore
      || typeof attemptStore.reserve !== "function" || typeof attemptStore.transition !== "function"
      || typeof buildKnownSafeMint !== "function" || typeof simulate !== "function"
      || typeof clock !== "function") throw new TypeError("executor dependencies are invalid");
    this.#authority = readAuthority; this.#attempts = attemptStore;
    this.#adapter = buildKnownSafeMint; this.#simulate = simulate; this.#clock = clock;
  }

  async prepare({ intent: rawIntent, strategyVersion, opportunity: rawOpportunity, accountNonce,
    usage = {}, production = false }) {
    const now = this.#clock();
    const intent = normalizePunkCollectingIntent(rawIntent, now);
    const opportunity = normalizeV2Opportunity(rawOpportunity, now);
    if (!Number.isSafeInteger(strategyVersion) || strategyVersion < 1) {
      throw new TypeError("strategy version is invalid");
    }
    const authority = snapshot(await this.#authority(intent.punkTokenId));
    const counts = snapshot(usage);
    const state = matchingState(authority, intent, counts);
    const { currentOwner, punkWallet } = state;
    reviewedMatch(intent, opportunity, state, now);
    assertV2ExecutionCapability(intent.operatingMode, { production });
    const strategyHash = punkCollectingIntentHash(intent, now);
    const idempotencyKey = v2ExecutionIdentity({ chainId: 4663, punkWallet,
      opportunityId: opportunity.opportunityId, strategyHash, accountNonce: String(accountNonce),
      operatingMode: intent.operatingMode });
    const reserved = await this.#attempts.reserve({ idempotencyKey, intent, strategyVersion,
      opportunity, strategyHash, accountNonce: String(accountNonce), owner: currentOwner });
    const refresh = async (reviewedOpportunity) => {
      const fresh = snapshot(await this.#authority(intent.punkTokenId));
      const freshState = matchingState(fresh, intent, counts);
      for (const key of ["chainId", "collection", "tokenId", "activated", "blockHash"]) {
        if (Object.hasOwn(authority, key) && fresh[key] === undefined) {
          fail("EXECUTION_CONTEXT_CHANGED", "The refreshed authority lost its reviewed binding.");
        }
      }
      if (BigInt(fresh.blockNumber) < BigInt(authority.blockNumber)
        || BigInt(fresh.blockNumber) === BigInt(authority.blockNumber) && authority.blockHash !== undefined
          && fresh.blockHash !== authority.blockHash) {
        fail("EXECUTION_CONTEXT_CHANGED", "The authority snapshot changed or moved backwards.");
      }
      // Current-owner equality is not transfer continuity. Managed execution
      // still requires its separate canonical transfer-history/session guard.
      return reviewedMatch(intent, reviewedOpportunity, freshState, this.#clock());
    };
    if (reserved.replayed === true) {
      await refresh(opportunity);
      return Object.freeze({ ...reserved.result, replayed: true });
    }
    let transaction, reviewed, screening, simulation, match;
    try {
      transaction = await this.#adapter(Object.freeze({ intent, opportunity, authority }));
      reviewed = snapshot(transaction);
      screening = screenKnownSafeMint({ ...reviewed.screening,
        expectedPunkWallet: punkWallet, expectedNftReceiver: punkWallet,
        mintContract: opportunity.mintContract, expectedValueWei: opportunity.priceWei,
        chainId: 4663, transaction: reviewed.envelope });
      if (!screening.safeToConsider) {
        fail("SECURITY_SCREEN_BLOCKED", `Security screen blocked: ${screening.reasons.join(", ")}`);
      }
      const evidence = await this.#simulate(Object.freeze({ envelope: reviewed.envelope, authority,
        opportunity, pinnedBlock: authority.blockNumber }));
      if (!isDeepStrictEqual(snapshot(transaction), reviewed)) {
        fail("EXECUTION_CONTEXT_CHANGED", "The adapter transaction changed after screening.");
      }
      simulation = validateMintSimulation(snapshot(evidence),
        { valueWei: opportunity.priceWei, punkWallet });
      if (simulation.status !== "PASSED") {
        fail("SIMULATION_FAILED", `Simulation failed: ${simulation.reasons.join(", ")}`);
      }
      if (BigInt(simulation.estimatedGasWei) > BigInt(intent.maxGasPerMintWei)) {
        fail("GAS_LIMIT_EXCEEDED", "The simulated gas cost exceeds the owner limit.");
      }
      match = await refresh({ ...opportunity, estimatedGasCostWei: simulation.estimatedGasWei });
      if (!isDeepStrictEqual(snapshot(transaction), reviewed)) {
        fail("EXECUTION_CONTEXT_CHANGED", "The adapter transaction changed during the authority refresh.");
      }
    } catch (error) {
      const reasons = error?.code === "SECURITY_SCREEN_BLOCKED" && screening ? screening.reasons
        : error?.code === "SIMULATION_FAILED" && simulation ? simulation.reasons
          : [error instanceof V2ExecutorError ? error.code : "PREPARATION_FAILED"];
      await this.#attempts.transition(idempotencyKey, "REJECTED", { reasons });
      throw error;
    }
    await this.#attempts.transition(idempotencyKey, "SIMULATED", { screening, simulation });
    await this.#attempts.transition(idempotencyKey, "OWNER_APPROVAL_PENDING", { screening, simulation });
    return Object.freeze({ idempotencyKey, mode: intent.operatingMode,
      status: intent.operatingMode === "ASK" ? "RECOMMENDATION_READY" : "OWNER_APPROVAL_REQUIRED",
      transaction: intent.operatingMode === "ASSIST" ? reviewed.envelope : null,
      screening, simulation, policyMatch: match, submitted: false, productionAuthorized: false,
      replayed: false });
  }
}
