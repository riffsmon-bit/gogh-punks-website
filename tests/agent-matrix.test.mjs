import assert from "node:assert/strict";
import test from "node:test";

import {
  filterMatrixEvents, matrixEventMessage, mergeMatrixEvents, normalizeMatrixEvent,
} from "../site/agent-matrix.js";

const mint = Object.freeze({
  tokenId: "93", eventId: "event-mint-0001", state: "MINTED",
  reason: "MINT_CONFIRMED", occurredAt: "2026-08-30T12:00:03.000Z",
  collection: "0x1111111111111111111111111111111111111111",
  transactionHash: `0x${"2".repeat(64)}`, source: "worker",
});
const scan = Object.freeze({
  tokenId: "94", eventId: "event-scan-0001", state: "SCANNING",
  reason: null, occurredAt: "2026-08-30T12:00:02.000Z", source: "scheduler",
});
const skipped = Object.freeze({
  tokenId: "93", eventId: "event-skip-0001", state: "SKIPPED",
  reason: "SIMULATION_FAILED", occurredAt: "2026-08-30T12:00:01.000Z", source: "worker",
});

test("Matrix normalization accepts only bounded truthful worker evidence", () => {
  assert.equal(normalizeMatrixEvent(mint).state, "MINTED");
  assert.equal(normalizeMatrixEvent({ ...mint, tokenId: "10000" }), null);
  assert.equal(normalizeMatrixEvent({ ...mint, state: "FAKE_MINTING" }), null);
  assert.equal(normalizeMatrixEvent({ ...mint, transactionHash: "0x1234" }).transactionHash, null);
});

test("Matrix events deduplicate, sort newest-first, and remain bounded", () => {
  const merged = mergeMatrixEvents([scan, skipped], [mint, scan], 2);
  assert.deepEqual(merged.map(({ eventId }) => eventId), ["event-mint-0001", "event-scan-0001"]);
  assert.equal(Object.isFrozen(merged), true);
});

test("Matrix filters select owned Punks, real mints, scans, warnings, and one Punk", () => {
  const events = mergeMatrixEvents([], [mint, scan, skipped]);
  assert.deepEqual(filterMatrixEvents(events, "mine", [93]).map(({ tokenId }) => tokenId), ["93", "93"]);
  assert.deepEqual(filterMatrixEvents(events, "mints").map(({ state }) => state), ["MINTED"]);
  assert.deepEqual(filterMatrixEvents(events, "scans").map(({ state }) => state), ["SCANNING", "SKIPPED"]);
  assert.deepEqual(filterMatrixEvents(events, "errors").map(({ state }) => state), ["SKIPPED"]);
  assert.deepEqual(filterMatrixEvents(events, "all", [], "94").map(({ tokenId }) => tokenId), ["94"]);
});

test("Matrix copy describes recorded outcomes without claiming fabricated activity", () => {
  assert.equal(matrixEventMessage(mint), "Mint confirmed and recorded in the Punk wallet.");
  assert.equal(matrixEventMessage(scan), "Searching supported mint sources.");
  assert.equal(matrixEventMessage(skipped),
    "Candidate skipped because transaction simulation failed.");
});
