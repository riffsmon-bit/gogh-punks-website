import { assertV2ExecutionCapability, v2ExecutionIdentity } from "./execution-boundary.mjs";
import { matchV2Opportunity } from "./policy-matcher.mjs";
import { normalizePunkCollectingIntent, punkCollectingIntentHash } from "./collecting-intent.mjs";
import { normalizeV2Opportunity } from "./opportunity.mjs";
import { screenKnownSafeMint } from "./security-screen.mjs";
import { validateMintSimulation } from "./simulation.mjs";

export class V2ExecutorError extends Error {
  constructor(code, message) { super(message); this.name = "V2ExecutorError"; this.code = code; }
}
function fail(code, message) { throw new V2ExecutorError(code, message); }

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
    const authority = await this.#authority(intent.punkTokenId);
    const currentOwner = String(authority.owner ?? "").toLowerCase();
    const punkWallet = String(authority.punkWallet ?? "").toLowerCase();
    if (currentOwner !== intent.expectedOwner || punkWallet !== intent.punkWallet) {
      fail("OWNERSHIP_CHANGED", "Current on-chain Punk authority no longer matches the strategy.");
    }
    const state = { currentOwner, punkWallet, punkWalletBalanceWei: String(authority.nativeBalanceWei),
      dailyMints: Number(usage.dailyMints ?? 0), totalMints: Number(usage.totalMints ?? 0),
      opportunityMints: Number(usage.opportunityMints ?? 0) };
    const match = matchV2Opportunity(intent, opportunity, state, now);
    if (!match.matched) fail("POLICY_REJECTED", `Opportunity failed policy: ${match.reasons.join(", ")}`);
    assertV2ExecutionCapability(intent.operatingMode, { production });
    const strategyHash = punkCollectingIntentHash(intent, now);
    const idempotencyKey = v2ExecutionIdentity({ chainId: 4663, punkWallet,
      opportunityId: opportunity.opportunityId, strategyHash, accountNonce: String(accountNonce),
      operatingMode: intent.operatingMode });
    const reserved = await this.#attempts.reserve({ idempotencyKey, intent, strategyVersion,
      opportunity, strategyHash, accountNonce: String(accountNonce), owner: currentOwner });
    if (reserved.replayed === true) return Object.freeze({ ...reserved.result, replayed: true });
    const transaction = await this.#adapter({ intent, opportunity, authority });
    const screening = screenKnownSafeMint({ ...transaction.screening,
      expectedPunkWallet: punkWallet, expectedNftReceiver: punkWallet,
      mintContract: opportunity.mintContract, expectedValueWei: opportunity.priceWei,
      chainId: 4663, transaction: transaction.envelope });
    if (!screening.safeToConsider) {
      await this.#attempts.transition(idempotencyKey, "REJECTED", { reasons: screening.reasons });
      fail("SECURITY_SCREEN_BLOCKED", `Security screen blocked: ${screening.reasons.join(", ")}`);
    }
    const evidence = await this.#simulate({ envelope: transaction.envelope, authority,
      opportunity, pinnedBlock: authority.blockNumber });
    const simulation = validateMintSimulation(evidence,
      { valueWei: opportunity.priceWei, punkWallet });
    if (simulation.status !== "PASSED") {
      await this.#attempts.transition(idempotencyKey, "REJECTED", { reasons: simulation.reasons });
      fail("SIMULATION_FAILED", `Simulation failed: ${simulation.reasons.join(", ")}`);
    }
    if (BigInt(simulation.estimatedGasWei) > BigInt(intent.maxGasPerMintWei)) {
      await this.#attempts.transition(idempotencyKey, "REJECTED", { reasons: ["GAS_LIMIT_EXCEEDED"] });
      fail("GAS_LIMIT_EXCEEDED", "The simulated gas cost exceeds the owner limit.");
    }
    await this.#attempts.transition(idempotencyKey, "SIMULATED", { screening, simulation });
    await this.#attempts.transition(idempotencyKey, "OWNER_APPROVAL_PENDING", { screening, simulation });
    return Object.freeze({ idempotencyKey, mode: intent.operatingMode,
      status: intent.operatingMode === "ASK" ? "RECOMMENDATION_READY" : "OWNER_APPROVAL_REQUIRED",
      transaction: intent.operatingMode === "ASSIST" ? Object.freeze({ ...transaction.envelope }) : null,
      screening, simulation, policyMatch: match, submitted: false, productionAuthorized: false,
      replayed: false });
  }
}
