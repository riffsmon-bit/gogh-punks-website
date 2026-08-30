import assert from "node:assert/strict";
import test from "node:test";

import { agentVisualState, confirmedMintHash } from "../site/agent-live-ui.js";

test("agent visual states animate only recorded work", () => {
  assert.equal(agentVisualState({ state: "SCANNING" }, true), "SCANNING");
  assert.equal(agentVisualState({ state: "QUEUED" }, true), "QUEUED");
  assert.equal(agentVisualState({ state: "SIMULATING" }, true), "SCANNING");
  assert.equal(agentVisualState({ state: "SUBMITTING" }, true), "MINTING");
  assert.equal(agentVisualState({ state: "CONFIRMING" }, true), "MINTING");
  assert.equal(agentVisualState({ state: "MINTED" }, true), "MINTED");
  assert.equal(agentVisualState({ state: "SKIPPED" }, true), "ACTIVE");
  assert.equal(agentVisualState(null, false), "INACTIVE");
});

test("confirmed mint notifications accept only exact transaction hashes", () => {
  const hash = `0x${"a".repeat(64)}`;
  assert.equal(confirmedMintHash({ lastSuccessfulMint: hash.toUpperCase().replace("0X", "0x") }), hash);
  assert.equal(confirmedMintHash({ transactionHash: hash }), hash);
  assert.equal(confirmedMintHash({ transactionHash: "0x1234" }), null);
  assert.equal(confirmedMintHash({}), null);
});
