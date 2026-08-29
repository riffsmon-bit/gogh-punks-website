import { createHash } from "node:crypto";

import { resolveOpenSeaDirectedMint, simulateDirectedPaidMint } from
  "../../broker/src/control-center/directed-opensea.mjs";
import { normalizePaidMintPolicy, ZERO_ADDRESS } from
  "../../broker/src/control-center/paid-mint-policy.mjs";
import { InMemoryPaidSpendLedger } from
  "../../broker/src/control-center/paid-spend-ledger.mjs";
import { snapshotExactRecord } from
  "../../broker/src/control-center/strict-record.mjs";
import { evaluateScoutingSchedule, normalizeScoutingSchedule } from
  "../../broker/src/connector/scouting-schedule.mjs";

const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;
const OWNER = "0x0000000000000000000000000000000000000001";

function tokenId(value) {
  if (typeof value !== "string" || !TOKEN_ID.test(value)) {
    throw new TypeError("Punk token ID is invalid");
  }
  return value;
}

function accountFor(value) {
  return `0x${BigInt(tokenId(value)).toString(16).padStart(40, "0")}`;
}

function ethToWei(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * 10n ** 18n
    + BigInt(fraction.padEnd(18, "0") || "0")).toString();
}

function boundedMintLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new TypeError("daily mint limit is invalid");
  }
  return value;
}

function fixtureAddress(namespace, slug) {
  return `0x${createHash("sha256").update(`${namespace}:${slug}`).digest("hex").slice(0, 40)}`;
}

function collectionName(slug) {
  return slug.split("-").filter(Boolean).map((part) =>
    `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class V2LocalSimulation {
  #ledger = new InMemoryPaidSpendLedger();
  #policies = new Map();
  #reviews = new Map();
  #activity = new Map();
  #schedules = new Map();
  #sequence = 0;
  #clock;

  constructor({ clock = () => Date.now() } = {}) {
    if (typeof clock !== "function") throw new TypeError("clock is invalid");
    this.#clock = clock;
  }

  session(rawTokenId) {
    const punkTokenId = tokenId(rawTokenId);
    const policy = this.#policies.get(punkTokenId) ?? this.#defaultPolicy(punkTokenId);
    return Object.freeze({
      tokenId: punkTokenId,
      owner: OWNER,
      account: accountFor(punkTokenId),
      policy: clone(policy),
      activity: clone(this.#activity.get(punkTokenId) ?? []),
    });
  }

  savePolicy(raw) {
    const input = snapshotExactRecord(raw,
      ["tokenId", "enabled", "dailyEth", "perMintEth", "dailyMintLimit"], "local policy");
    const punkTokenId = tokenId(input.tokenId);
    if (typeof input.enabled !== "boolean") throw new TypeError("paid mode is invalid");
    const policy = normalizePaidMintPolicy({
      schema: "GOGH_PUNK_PAID_MINT_POLICY_V2",
      chainId: 4663,
      punkTokenId,
      account: accountFor(punkTokenId),
      configuredBy: OWNER,
      currentOwner: OWNER,
      authorizationActive: true,
      freeMintsEnabled: true,
      paidMintsEnabled: input.enabled,
      dailyMintLimit: boundedMintLimit(input.dailyMintLimit),
      dailySpendLimitWei: ethToWei(input.dailyEth, "daily spend limit"),
      maxPerMintWei: ethToWei(input.perMintEth, "per-mint limit"),
      authorizationValidUntil: Math.floor(this.#clock() / 1_000) + 7 * 86_400,
    });
    this.#policies.set(punkTokenId, policy);
    this.#record(punkTokenId, "CHECKING_LIMITS",
      input.enabled ? "Local paid-mint limits saved for simulation."
        : "Paid mint simulation disabled; free-mint review remains available.");
    return clone(policy);
  }

  async resolve(raw) {
    const input = snapshotExactRecord(raw, ["tokenId", "url", "recipient"], "local resolver request");
    const punkTokenId = tokenId(input.tokenId);
    if (input.recipient !== accountFor(punkTokenId)) throw new TypeError("recipient is not this Punk wallet");
    const resolved = await resolveOpenSeaDirectedMint(input.url, {
      recipient: input.recipient,
      lookup: async (parsed) => ({
        chainId: 4663,
        collectionName: collectionName(parsed.slug),
        collection: fixtureAddress("collection", parsed.slug),
        mintContract: fixtureAddress("mint", parsed.slug),
        saleStage: "Public local fixture",
        saleActive: true,
        priceWei: "4000000000000000",
        currency: ZERO_ADDRESS,
        quantity: 1,
        eligibility: "ELIGIBLE",
        runtimeSupported: true,
        adapterId: "OPENSEA_STUDIO_V3",
        checkedBlockNumber: 42_000_000,
      }),
    });
    const reviewId = `review_${punkTokenId}_${++this.#sequence}`;
    this.#reviews.set(reviewId, Object.freeze({ punkTokenId, resolved }));
    this.#record(punkTokenId, "VERIFYING_CONTRACT",
      `Candidate found: ${resolved.collectionName}. Contract, price, recipient, and limits are ready for local simulation.`);
    return Object.freeze({ reviewId, review: clone(resolved), estimatedGasWei: "200000000000000" });
  }

  async simulate(raw) {
    const input = snapshotExactRecord(raw, ["tokenId", "reviewId"], "local simulation request");
    const punkTokenId = tokenId(input.tokenId);
    if (typeof input.reviewId !== "string" || !/^review_[0-9]{1,4}_[1-9][0-9]*$/.test(input.reviewId)) {
      throw new TypeError("review ID is invalid");
    }
    const stored = this.#reviews.get(input.reviewId);
    if (!stored || stored.punkTokenId !== punkTokenId) throw new TypeError("directed review is unavailable");
    const policy = this.#policies.get(punkTokenId) ?? this.#defaultPolicy(punkTokenId);
    const day = new Date(this.#clock()).toISOString().slice(0, 10);
    const ledgerUsage = await this.#ledger.usage(punkTokenId, day);
    const usage = {
      utcDay: day,
      amountSpentWei: (BigInt(ledgerUsage.reservedWei) + BigInt(ledgerUsage.confirmedWei)).toString(),
      paidMintCount: ledgerUsage.reservedMints + ledgerUsage.confirmedMints,
      totalMintCount: ledgerUsage.reservedMints + ledgerUsage.confirmedMints,
    };
    const result = await simulateDirectedPaidMint({
      resolved: stored.resolved,
      policy,
      usage,
      nowSeconds: Math.floor(this.#clock() / 1_000),
      revalidate: async () => ({ candidate: stored.resolved.candidate,
        eligibility: "ELIGIBLE", checkedBlockNumber: stored.resolved.checkedBlockNumber + 1 }),
      readCurrentOwner: async () => OWNER,
      simulate: async () => ({
        success: true,
        nativeSpentWei: stored.resolved.candidate.priceWei,
        approvals: [], outgoingNfts: [], outgoingTokens: [], contractCreations: [],
        nftReceipts: [{ collection: stored.resolved.candidate.collection,
          recipient: stored.resolved.candidate.recipient, quantity: 1 }],
      }),
    });
    this.#record(punkTokenId, result.ready ? "READY" : "SKIPPED", result.ready
      ? "Simulation passed. Expected spend and one NFT receipt matched; nothing was broadcast."
      : `Mint skipped safely: ${result.decision.code}.`);
    return clone(result);
  }

  scout(raw) {
    const input = snapshotExactRecord(raw, ["tokenId"], "local scout request");
    const punkTokenId = tokenId(input.tokenId);
    const schedule = this.#schedules.get(punkTokenId);
    if (schedule) {
      const decision = evaluateScoutingSchedule(schedule, this.#clock());
      if (!decision.allowed) {
        const error = new Error(`Scouting window is ${decision.state.toLowerCase()}`);
        error.code = "OUTSIDE_SCOUTING_WINDOW";
        throw error;
      }
    }
    this.#record(punkTokenId, "SCANNING", "Searching the locally supported mint-source fixture set.");
    this.#record(punkTokenId, "SKIPPED", "No eligible fixture was selected. No transaction was needed.");
    return Object.freeze({ status: "NO_ELIGIBLE_TARGETS", activity: clone(this.#activity.get(punkTokenId)) });
  }

  saveSchedule(raw) {
    const input = snapshotExactRecord(raw,
      ["tokenId", "startAt", "endAt", "timezone", "enabled"], "local schedule");
    const schedule = normalizeScoutingSchedule({ schema: "GOGH_SCOUTING_SCHEDULE_V1", ...input,
      tokenId: tokenId(input.tokenId) });
    this.#schedules.set(schedule.tokenId, schedule);
    this.#record(schedule.tokenId, "IDLE", schedule.enabled
      ? `Scouting window saved: ${schedule.startAt} through ${schedule.endAt}.`
      : "Scouting schedule disabled.");
    return clone(schedule);
  }

  schedule(rawTokenId) {
    const punkTokenId = tokenId(rawTokenId);
    const schedule = this.#schedules.get(punkTokenId) ?? null;
    return Object.freeze({ tokenId: punkTokenId, schedule: schedule ? clone(schedule) : null,
      decision: schedule ? evaluateScoutingSchedule(schedule, this.#clock()) : null });
  }

  activity(rawTokenId) {
    const punkTokenId = tokenId(rawTokenId);
    return Object.freeze({ tokenId: punkTokenId,
      activity: clone(this.#activity.get(punkTokenId) ?? []) });
  }

  #defaultPolicy(punkTokenId) {
    return normalizePaidMintPolicy({
      schema: "GOGH_PUNK_PAID_MINT_POLICY_V2", chainId: 4663, punkTokenId,
      account: accountFor(punkTokenId), configuredBy: OWNER, currentOwner: OWNER,
      authorizationActive: true, freeMintsEnabled: true, paidMintsEnabled: false,
      dailyMintLimit: 3, dailySpendLimitWei: "25000000000000000",
      maxPerMintWei: "10000000000000000",
      authorizationValidUntil: Math.floor(this.#clock() / 1_000) + 7 * 86_400,
    });
  }

  #record(punkTokenId, state, message) {
    const entries = this.#activity.get(punkTokenId) ?? [];
    entries.unshift(Object.freeze({ at: new Date(this.#clock()).toISOString(), state, message }));
    this.#activity.set(punkTokenId, entries.slice(0, 40));
  }
}

export { accountFor as localPunkAccount };
