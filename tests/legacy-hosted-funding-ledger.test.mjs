import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildLegacyHostedFundingLedger } from
  "../scripts/lib/legacy-hosted-funding-ledger.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const OWNER_TWO = "0x2222222222222222222222222222222222222222";
const AGENT = "0x3333333333333333333333333333333333333333";
const PUNK_WALLET = "0x4444444444444444444444444444444444444444";
const DEPOSIT_ONE = `0x${"a".repeat(64)}`;
const DEPOSIT_TWO = `0x${"b".repeat(64)}`;
const USAGE = `0x${"c".repeat(64)}`;

function snapshot() {
  return {
    snapshotBlock: "53000000",
    hostedHistoryComplete: false,
    deposits: [
      { transactionHash: DEPOSIT_ONE, punkTokenId: "93", ownerAddress: OWNER,
        agentAddress: AGENT, amountWei: "1000", confirmedAt: "2026-09-01T00:00:00Z" },
      { transactionHash: DEPOSIT_TWO, punkTokenId: "94", ownerAddress: OWNER_TWO,
        agentAddress: AGENT, amountWei: "500", confirmedAt: "2026-09-01T00:01:00Z" },
    ],
    accounts: [
      { punkTokenId: "93", ownerSnapshot: OWNER, creditedWei: "1000", spentWei: "100" },
      { punkTokenId: "94", ownerSnapshot: OWNER_TWO, creditedWei: "500", spentWei: "0" },
    ],
    usage: [{ transactionHash: USAGE, punkTokenId: "93", actualCostWei: "100",
      chargedWei: "100" }],
    refunds: [],
    currentOwners: { "93": OWNER },
    punkWallets: { "93": PUNK_WALLET },
    depositEvidence: {
      [DEPOSIT_ONE]: { status: "CONFIRMED", transactionHash: DEPOSIT_ONE, from: OWNER,
        to: AGENT, valueWei: "1000", input: "0x", blockNumber: "52000000" },
      [DEPOSIT_TWO]: { status: "CONFIRMED", transactionHash: DEPOSIT_TWO, from: OWNER_TWO,
        to: AGENT, valueWei: "500", input: "0x", blockNumber: "52000001" },
    },
    usageEvidence: {
      [USAGE]: { status: "CONFIRMED", transactionHash: USAGE, valueWei: "0",
        gasCostWei: "100" },
    },
    hostedWallets: [{ laneId: 1, address: AGENT, balanceWei: "1400" }],
  };
}

test("legacy ledger classifies verified and ambiguous user balances without guessing", () => {
  const ledger = buildLegacyHostedFundingLedger(snapshot(), {
    generatedAt: "2026-09-02T00:00:00Z",
  });
  assert.equal(ledger.entries.length, 2);
  assert.equal(ledger.entries[0].classification, "USER_REFUNDABLE");
  assert.equal(ledger.entries[0].remainingUserBalanceWei, "900");
  assert.equal(ledger.entries[0].migrationEligible, true);
  assert.equal(ledger.entries[1].classification, "AMBIGUOUS_REQUIRES_REVIEW");
  assert.equal(ledger.totals.recordedUserLiabilityWei, "1400");
  assert.equal(ledger.totals.totalUserRefundableWei, "900");
  assert.equal(ledger.totals.totalUserMigratableWei, "900");
  assert.equal(ledger.totals.totalAmbiguousWei, "500");
  assert.equal(ledger.totals.totalProjectOwnedWei, "0");
  assert.equal(ledger.assertions.userLiabilitiesCovered, true);
  assert.equal(ledger.finalSweepReady, false);
});

test("refund/migration manifests are deterministic, choice-based, and permanently dry-run", () => {
  const first = buildLegacyHostedFundingLedger(snapshot(), {
    generatedAt: "2026-09-02T00:00:00Z",
  });
  const second = buildLegacyHostedFundingLedger(snapshot(), {
    generatedAt: "2026-09-02T00:00:00Z",
  });
  assert.deepEqual(first.manifests, second.manifests);
  assert.equal(first.dryRun, true);
  assert.equal(first.broadcastAuthorized, false);
  assert.equal(first.assertions.noBroadcastCapability, true);
  assert.equal(first.manifests[0].status, "DRY_RUN_ONLY");
  assert.equal(first.manifests[0].selectedOption, null);
  assert.deepEqual(first.manifests[0].options.map(({ type }) => type), [
    "REFUND_TO_OWNER", "FUND_PUNK_WALLET",
  ]);
});

test("ledger rejects duplicate credits and over-settled user balances", () => {
  const duplicate = snapshot();
  duplicate.accounts.push({ ...duplicate.accounts[0] });
  assert.throws(() => buildLegacyHostedFundingLedger(duplicate), /gas account is duplicated/);

  const overspent = snapshot();
  overspent.accounts[0] = { ...overspent.accounts[0], spentWei: "1001" };
  assert.throws(() => buildLegacyHostedFundingLedger(overspent), /over-settled/);
});

test("legacy preparation tools contain no signing, submission, sweep, or refund broadcast path", async () => {
  const sources = await Promise.all([
    "../scripts/build-legacy-hosted-funding-ledger.mjs",
    "../scripts/capture-legacy-hosted-funding-snapshot.mjs",
    "../scripts/lib/legacy-hosted-funding-ledger.mjs",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /sendTransaction|eth_sendTransaction|privateKey|mnemonic|sweepWallet/);
  }
  assert.match(sources[0], /permanently dry-run and has no broadcast mode/);
  assert.match(sources[1], /read-only and has no broadcast mode/);
});

test("additive reconciliation schema defaults payouts to dry-run and locks final sweep", async () => {
  const migration = await readFile(new URL(
    "../supabase/migrations/20260902043000_prepare_v4_legacy_reconciliation.sql",
    import.meta.url,
  ), "utf8");
  assert.match(migration, /state TEXT NOT NULL DEFAULT 'DRY_RUN'/);
  assert.match(migration, /final_sweep_ready BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /total_user_liability_wei = 0 AND total_ambiguous_wei = 0/);
  assert.match(migration, /transaction_hash TEXT UNIQUE/);
  assert.match(migration, /UNIQUE \(signer_address, signer_nonce\)/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = public/);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE|sendTransaction/);
});
