import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateV4PunkOpportunity, v4ExecutionIdentity,
} from "../broker/src/v4/punk-policy.mjs";

const ADAPTER = "0x1111111111111111111111111111111111111111";
const COLLECTION = "0x2222222222222222222222222222222222222222";

function policy(overrides = {}) {
  return {
    automationEnabled: true,
    mintType: "FREE_ONLY",
    maximumMintPriceWei: "0",
    maximumGasPerMintWei: "200",
    dailyMintLimit: 5,
    totalRemainingMintLimit: 20,
    minimumNativeReserveWei: "1000",
    allowedAdapters: [ADAPTER],
    blockedContracts: [],
    maximumRiskScore: 25,
    expiresAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return { adapter: ADAPTER, collection: COLLECTION, priceWei: "0",
    estimatedGasCostWei: "100", riskScore: 20,
    screeningState: "PASSED", simulationState: "PASSED", ...overrides };
}

const STATE = Object.freeze({ punkWalletBalanceWei: "1100", dailyMints: 0 });

test("self-funded Punk policy permits only a fully screened affordable opportunity", () => {
  const result = evaluateV4PunkOpportunity(policy(), candidate(), STATE,
    "2026-09-02T00:00:00Z");
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.requiredBalanceWei, "1100");
});

test("V4 policy enforces price, gas, daily, total, reserve and risk limits", () => {
  const result = evaluateV4PunkOpportunity(policy({ totalRemainingMintLimit: 0 }), candidate({
    priceWei: "1", estimatedGasCostWei: "201", riskScore: 26,
  }), { punkWalletBalanceWei: "1000", dailyMints: 5 }, "2026-09-02T00:00:00Z");
  assert.deepEqual(result.reasons, [
    "PAID_MINT_BLOCKED", "MINT_PRICE_LIMIT_EXCEEDED", "GAS_LIMIT_EXCEEDED",
    "DAILY_MINT_LIMIT_REACHED", "TOTAL_MINT_LIMIT_REACHED", "RISK_LIMIT_EXCEEDED",
    "MINIMUM_RESERVE_VIOLATION",
  ]);
});

test("V4 policy fails closed for screening, simulation, adapter and blocked contracts", () => {
  const result = evaluateV4PunkOpportunity(policy({ blockedContracts: [COLLECTION] }), candidate({
    adapter: "0x3333333333333333333333333333333333333333",
    screeningState: "PENDING", simulationState: "FAILED",
  }), STATE, "2026-09-02T00:00:00Z");
  assert.deepEqual(result.reasons, [
    "SCREENING_NOT_PASSED", "SIMULATION_NOT_PASSED", "ADAPTER_NOT_ALLOWED",
    "CONTRACT_BLOCKED",
  ]);
});

test("execution identity is deterministic and changes with the Punk Account nonce", () => {
  const input = { chainId: 4663, punkAccount: ADAPTER, opportunityId: "seadrop:example",
    policyHash: `0x${"a".repeat(64)}`, accountNonce: "7" };
  assert.equal(v4ExecutionIdentity(input), v4ExecutionIdentity(input));
  assert.notEqual(v4ExecutionIdentity(input), v4ExecutionIdentity({ ...input, accountNonce: "8" }));
});

test("V4 schema is lane-free, additive, and reserves durable execution identity", async () => {
  const migration = await readFile(new URL(
    "../netlify/database/migrations/20260902044000_prepare_v4_self_funded_punks.sql",
    import.meta.url,
  ), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS broker_v4_punk_policy_proposals/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS broker_v4_executable_opportunities/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS broker_v4_execution_attempts/);
  assert.match(migration, /idempotency_key CHAR\(64\) NOT NULL UNIQUE/);
  assert.match(migration, /UNIQUE \(chain_id, punk_collection_address, punk_token_id, opportunity_id\)/);
  assert.match(migration, /submission_identity_hash CHAR\(66\) UNIQUE/);
  assert.doesNotMatch(migration, /lane_id|DROP TABLE|TRUNCATE|DELETE FROM/);
});
