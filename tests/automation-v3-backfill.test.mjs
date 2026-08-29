import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import automationManifest from "../deployments/robinhood-automation-v3.json" with { type: "json" };
import {
  backfillAutomationV3Enrollments, normalizeAutomationV3BackfillTokenIds,
} from "../netlify/functions/_shared/automation-v3-backfill.mjs";
import {
  activationTokenIds, backfillMode,
} from "../scripts/backfill-automation-v3-enrollments.mjs";

const address = (character) => `0x${character.repeat(40)}`;

test("V3 enrollment backfill is dry-run first and enrolls only live active Punks", async () => {
  const enrolled = [];
  const state = (tokenId) => ({
    tokenId, created: tokenId !== "2", active: tokenId === "1",
    account: address("1"), owner: address("2"),
    authorization: {
      active: tokenId !== "3", effective: tokenId !== "3", validUntil: "9999999999",
    },
  });
  const dry = await backfillAutomationV3Enrollments(["3", "1", "2"], {
    nowSeconds: 1_000, readPunk: async (tokenId) => state(tokenId),
    enroll: async (punk) => enrolled.push(punk.tokenId),
  });
  assert.equal(dry.mode, "DRY_RUN");
  assert.deepEqual(dry.counts, { discovered: 3, eligible: 1, enrolled: 0, skipped: 2 });
  assert.deepEqual(enrolled, []);
  assert.equal(dry.authorizesAgent, false);
  assert.equal(dry.sendsTransaction, false);

  const applied = await backfillAutomationV3Enrollments(["1", "2", "3"], {
    apply: true, nowSeconds: 1_000, readPunk: async (tokenId) => state(tokenId),
    enroll: async (punk) => enrolled.push(punk.tokenId),
  });
  assert.equal(applied.mode, "APPLY");
  assert.deepEqual(enrolled, ["1"]);
  assert.equal(applied.counts.enrolled, 1);
});

test("V3 enrollment backfill fails closed on malformed lists and live evidence", async () => {
  assert.throws(() => normalizeAutomationV3BackfillTokenIds(["01"]));
  assert.throws(() => normalizeAutomationV3BackfillTokenIds(["1", "1"]));
  assert.throws(() => normalizeAutomationV3BackfillTokenIds(Array(201).fill("1")));
  const result = await backfillAutomationV3Enrollments(["1"], {
    readPunk: async () => ({ tokenId: "2", created: true, active: true }),
    enroll: async () => assert.fail("invalid evidence must not enroll"),
  });
  assert.equal(result.results[0].reason, "LIVE_CHECK_FAILED");
});

test("activation discovery accepts only the exact V3 facade event identity", () => {
  const exact = { args: {
    tokenId: 93n, chainId: 4663n,
    collection: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
    implementation: automationManifest.contracts.GoghPunkAccountV3.address,
    implementationVersion: 3n,
  } };
  assert.deepEqual(activationTokenIds([exact, exact]), ["93"]);
  assert.deepEqual(activationTokenIds([{ args: { ...exact.args, chainId: 1n } }]), []);
  assert.deepEqual(activationTokenIds([{ args: {
    ...exact.args, implementationVersion: 2n,
  } }]), []);
});

test("backfill CLI is explicit, confirmation-gated, and has no signing or sending path", async () => {
  assert.equal(backfillMode([]), "DRY_RUN");
  assert.equal(backfillMode(["--dry-run"]), "DRY_RUN");
  assert.equal(backfillMode(["--apply"]), "APPLY");
  assert.throws(() => backfillMode(["--apply", "extra"]));
  const source = await readFile(
    new URL("../scripts/backfill-automation-v3-enrollments.mjs", import.meta.url), "utf8",
  );
  assert.doesNotMatch(source, /privateKeyToAccount|eth_send|sendTransaction|writeContract|--broadcast/);
  assert.match(source, /BROKER_AUTOMATION_V3_BACKFILL_CONFIRM/);
  assert.match(source, /backfillAutomationV3Enrollments/);
  assert.match(source, /LIVE_EVIDENCE_UNAVAILABLE/);
  assert.doesNotMatch(source, /error\.message/);
});
