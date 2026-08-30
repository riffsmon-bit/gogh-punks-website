import assert from "node:assert/strict";
import test from "node:test";

import { encodeFunctionData } from "viem";

import { reviewOpenSeaMintForPunk } from
  "../broker/src/connector/opensea-directed-review.mjs";
import { handleOpenSeaConnectorRequest, requireTrustedOrigin } from
  "../netlify/functions/broker-connector-opensea.mjs";

const OWNER = `0x${"1".repeat(40)}`;
const ACCOUNT = `0x${"2".repeat(40)}`;
const COLLECTION = `0x${"3".repeat(40)}`;
const SEA_DROP = "0x00005ea00ac477b1030ce78506496e8c2de24bf5";
const FEE = "0x0000a26b00c1f0df003000390027140000faa719";
const ZERO = `0x${"0".repeat(40)}`;
const ABI = [{ type: "function", name: "mintPublic", stateMutability: "payable", inputs: [
  { name: "nftContract", type: "address" }, { name: "feeRecipient", type: "address" },
  { name: "minterIfNotPayer", type: "address" }, { name: "quantity", type: "uint256" },
], outputs: [] }];

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status,
    headers: { "content-type": "application/json" } });
}

function dependencies(overrides = {}) {
  return {
    apiKey: "server-key-123",
    readPunk: async (tokenId) => ({ tokenId, owner: OWNER, account: ACCOUNT,
      created: true, active: true }),
    fetchImpl: async (url) => url.endsWith("/mint")
      ? response({ target: SEA_DROP, value: "0", calldata: encodeFunctionData({ abi: ABI,
        functionName: "mintPublic", args: [COLLECTION, FEE, ZERO, 1n] }) })
      : response({ name: "Test Drop", chain: "robinhood" }),
    nowMs: Date.parse("2026-08-28T05:00:00.000Z"),
    createIntent: async ({ review }) => ({
      intentId: "dmi_11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-08-28T05:05:00.000Z", reviewId: review.reviewId,
    }),
    ...overrides,
  };
}

test("OpenSea connector inspects on demand without requesting mint calldata", async () => {
  const calls = [];
  const result = await reviewOpenSeaMintForPunk({ action: "inspect", tokenId: "93",
    walletAddress: OWNER, url: "https://opensea.io/collection/test-drop/overview" },
  dependencies({ fetchImpl: async (url) => {
    calls.push(url);
    return response({ name: "Test Drop", chain: "robinhood" });
  } }));
  assert.equal(result.status, "DROP_DETAILS_RETRIEVED");
  assert.equal(result.collectionName, "Test Drop");
  assert.equal(result.executionReady, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/v2\/drops\/test-drop$/);
});

test("bounded proposal decodes canonical quantity-one free SeaDrop calldata", async () => {
  const result = await handleOpenSeaConnectorRequest({ action: "prepare", tokenId: "93",
    walletAddress: OWNER, url: "https://opensea.io/drops/test-drop" }, dependencies());
  assert.equal(result.status, "BOUNDED_PROPOSAL_REVIEWED");
  assert.equal(result.executionReady, false);
  assert.equal(result.simulationPerformed, false);
  assert.equal(result.proposal.collection, COLLECTION);
  assert.equal(result.proposal.quantity, 1);
  assert.equal(result.proposal.currentFreeAdapterCompatible, true);
  assert.equal(result.safety.signingPerformed, false);
  assert.equal(result.safety.submissionPerformed, false);
  assert.match(result.reviewId, /^osr_[0-9a-f]{64}$/);
  assert.match(result.intentId, /^dmi_/);
  assert.equal(result.expiresAt, "2026-08-28T05:05:00.000Z");
});

test("single-use intent execution revalidates exact ownership, recipient, price, and calldata", async () => {
  const prepared = await handleOpenSeaConnectorRequest({ action: "prepare", tokenId: "93",
    walletAddress: OWNER, url: "https://opensea.io/drops/test-drop" }, dependencies());
  let consumed = 0;
  const result = await handleOpenSeaConnectorRequest({ action: "execute", tokenId: "93",
    walletAddress: OWNER, intentId: prepared.intentId }, dependencies({
    consumeIntent: async () => {
      consumed += 1;
      return { intentId: prepared.intentId, reviewId: prepared.reviewId,
        sourceUrl: prepared.sourceUrl, expiresAt: prepared.expiresAt };
    },
  }));
  assert.equal(consumed, 1);
  assert.equal(result.status, "INTENT_REVALIDATED");
  assert.equal(result.executionReady, false);
  assert.match(result.message, /execution remains disabled/);

  await assert.rejects(handleOpenSeaConnectorRequest({ action: "execute", tokenId: "93",
    walletAddress: OWNER, intentId: prepared.intentId }, dependencies({
    consumeIntent: async () => ({ intentId: prepared.intentId,
      reviewId: `osr_${"f".repeat(64)}`, sourceUrl: prepared.sourceUrl,
      expiresAt: prepared.expiresAt }),
  })), /price or transaction changed/i);
});

test("review fails closed for ownership mismatch and unknown request fields", async () => {
  await assert.rejects(reviewOpenSeaMintForPunk({ action: "inspect", tokenId: "93",
    walletAddress: `0x${"4".repeat(40)}`, url: "https://opensea.io/drops/test-drop" },
  dependencies()), /does not currently own/);
  await assert.rejects(reviewOpenSeaMintForPunk({ action: "inspect", tokenId: "93",
    walletAddress: OWNER, url: "https://opensea.io/drops/test-drop", extra: true },
  dependencies()), /missing or unknown/);
});

test("paid and noncanonical proposals are never marked executable", async () => {
  const paid = dependencies({ fetchImpl: async (url) => url.endsWith("/mint")
    ? response({ target: SEA_DROP, value: "4000000000000000", calldata: encodeFunctionData({
      abi: ABI, functionName: "mintPublic", args: [COLLECTION, FEE, ZERO, 1n],
    }) }) : response({ name: "Paid Drop", chain: "robinhood" }) });
  const result = await reviewOpenSeaMintForPunk({ action: "prepare", tokenId: "93",
    walletAddress: OWNER, url: "https://opensea.io/drops/paid-drop" }, paid);
  assert.equal(result.status, "PROPOSAL_REQUIRES_ADDITIONAL_VALIDATION");
  assert.equal(result.proposal.priceKind, "PAID");
  assert.equal(result.executionReady, false);

  const quantityTwo = dependencies({ fetchImpl: async (url) => url.endsWith("/mint")
    ? response({ target: SEA_DROP, value: "0", calldata: encodeFunctionData({ abi: ABI,
      functionName: "mintPublic", args: [COLLECTION, FEE, ZERO, 2n] }) })
    : response({ name: "Bad Drop", chain: "robinhood" }) });
  await assert.rejects(reviewOpenSeaMintForPunk({ action: "prepare", tokenId: "93",
    walletAddress: OWNER, url: "https://opensea.io/drops/bad-drop" }, quantityTwo),
  /quantity-one/);
});

test("preview requests are limited to the exact served origin", () => {
  const url = "https://deploy-preview-9--gogh-punks.netlify.app/api/broker/connector/opensea";
  assert.doesNotThrow(() => requireTrustedOrigin(new Request(url, {
    headers: { origin: "https://deploy-preview-9--gogh-punks.netlify.app" },
  }), {}));
  assert.throws(() => requireTrustedOrigin(new Request(url, {
    headers: { origin: "https://attacker.example" },
  }), {}), /origin was rejected/);
});
