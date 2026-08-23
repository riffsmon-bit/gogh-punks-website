import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeExternalFreeMintStatus } from "../site/external-free-mint-test.js";

const candidate = {
  schema: "GOGH_EXTERNAL_FREE_MINT_SITE_STATUS_V1",
  status: "ADAPTER_REVIEWED_NOT_DEPLOYED",
  executionEnabled: false,
  executionMode: "LOCAL_ENCRYPTED_AGENT_RUNNER",
  punkTokenId: "1639",
  account: `0x${"11".repeat(20)}`,
  agent: `0x${"22".repeat(20)}`,
  candidate: {
    name: "Test", collection: `0x${"33".repeat(20)}`, venue: `0x${"44".repeat(20)}`,
    opportunityType: "FREE_MINT", assetStandard: "ERC721", quantity: "1",
    mintPriceWei: "0", verification: "UNVERIFIED_COLLECTION",
    openSeaUrl: "https://opensea.io/collection/test",
  },
  controls: {
    nativeValueWei: "0", tokenQuantity: "1", opaqueAdapterDataAllowed: false,
    tokenApprovalsAllowed: false, arbitraryTargetsAllowed: false,
    genericMintPermissionAllowed: false, containImmediatelyAfterRun: true,
  },
  readiness: { reviewedAdapterSource: true },
};

test("external free-mint site status accepts only bounded non-executable evidence", () => {
  assert.equal(normalizeExternalFreeMintStatus({ externalFreeMintTest: candidate }).candidate.name, "Test");
  for (const mutate of [
    (value) => { value.executionEnabled = true; },
    (value) => { value.punkTokenId = "1797"; },
    (value) => { value.candidate.mintPriceWei = "1"; },
    (value) => { value.candidate.quantity = "2"; },
    (value) => { value.controls.tokenApprovalsAllowed = true; },
    (value) => { value.controls.arbitraryTargetsAllowed = true; },
  ]) {
    const value = structuredClone(candidate);
    mutate(value);
    assert.throws(() => normalizeExternalFreeMintStatus({ externalFreeMintTest: value }), /INVALID_EXTERNAL_MINT_STATUS/);
  }
});

test("Punk page loads the separate external-mint module and displays contained evidence", async () => {
  const [html, source, status, evidence] = await Promise.all([
    readFile(new URL("../site/punk/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/external-free-mint-test.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-status.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_shared/external-free-mint-display.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-external-free-mint-test/);
  assert.match(html, /site does not hold the agent key/i);
  assert.match(source, /executionEnabled.*!== true/s);
  assert.match(status, /COMPLETED_AND_CONTAINED/);
  assert.match(evidence, /36c6cc619a3a3a2d634627e02f8ad233eda9180a9fe04724845b2dcbf7a1d833/);
  assert.match(evidence, /ccb0c093d1c37736b13c553fa9ff10482e41cdd851952da529099a66fbd7eeed/);
  assert.match(evidence, /PUNK_1797_EXTERNAL_FREE_MINT/);
  assert.match(evidence, /UNVERIFIED_COLLECTION/);
});
