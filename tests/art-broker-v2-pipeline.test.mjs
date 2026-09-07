import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { SharedV2DiscoveryEngine } from "../broker/src/v4/discovery-engine.mjs";
import { draftStrategyFromConversation } from "../broker/src/v4/intent-draft.mjs";
import { inspectArtBrokerLink, normalizeArtBrokerLink } from "../broker/src/v4/link-scanner.mjs";
import { ART_BROKER_MCP_TOOLS, FORBIDDEN_ART_BROKER_MCP_TOOLS,
  GoghArtBrokerMcpServer, handleArtBrokerMcpJsonRpc } from
  "../broker/src/v4/mcp/art-broker-mcp.mjs";
import { screenKnownSafeMint } from "../broker/src/v4/security-screen.mjs";
import { validateMintSimulation } from "../broker/src/v4/simulation.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const MINT = "0x3333333333333333333333333333333333333333";
const ADAPTER = "0x4444444444444444444444444444444444444444";
const HASH = `0x${"a".repeat(64)}`;
const NOW = new Date("2026-09-06T16:00:00.000Z");

function opportunity(overrides = {}) {
  return { schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2,
    opportunityId: "seadrop:neon-alley:public", chainId: 4663,
    collectionContract: MINT, mintContract: MINT, adapter: ADAPTER,
    mintStage: "PUBLIC", mintMethod: "mintPublic(address,uint256)", priceWei: "0",
    estimatedGasCostWei: "180000000000000", supply: 777, walletLimit: 1,
    startTime: "2026-09-06T15:00:00.000Z", endTime: "2026-09-07T15:00:00.000Z",
    website: "https://neon.example", socialUrls: { x: "https://x.com/neon", discord: null,
      farcaster: null }, sourceUrls: ["https://opensea.io/collection/neon-alley"],
    artStyles: ["PIXEL_ART", "CYBERPUNK"], imageReference: null,
    collectionName: "Neon Alley", contractCodeHash: HASH, adapterCodeHash: HASH,
    screeningStatus: "PASSED", simulationStatus: "PASSED", riskLevel: "LOW", riskScore: 8,
    expectedNftReceiver: WALLET, unexpectedApprovals: false, unexpectedTransfers: false,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...overrides };
}

test("conversation becomes a pending structured confirmation, never active authority", () => {
  const draft = draftStrategyFromConversation({
    message: "You've got .03 ETH. Keep .01 ETH untouched. Find free pixel art on Robinhood. Only collections with an X account and website. Nothing above 2,000 supply. Maximum three today. Don't spend over .0005 ETH gas on a mint. Go shopping.",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET,
  }, NOW);
  assert.equal(draft.status, "PENDING_OWNER_CONFIRMATION");
  assert.equal(draft.economicPermissionsActivated, false);
  assert.equal(draft.intent.operatingMode, "AUTONOMOUS");
  assert.equal(draft.intent.mintMode, "FREE_ONLY");
  assert.equal(draft.intent.minimumReserveWei, "10000000000000000");
  assert.equal(draft.intent.maxGasPerMintWei, "500000000000000");
  assert.equal(draft.intent.dailyMintLimit, 3);
  assert.equal(draft.intent.maximumCollectionSupply, 2000);
  assert.deepEqual(draft.intent.preferences.prefer, ["PIXEL_ART"]);
  assert.equal(draft.intent.requiresWebsite, true);
  assert.deepEqual(draft.intent.preferredSocialPlatforms, ["X"]);
  assert.equal(draft.confirmation.activationRequired, true);
});

test("taste feedback expressed in words updates explicit avoid state", () => {
  const draft = draftStrategyFromConversation({ message: "Stop collecting PFPs. More weird art.",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET }, NOW);
  assert.deepEqual(draft.intent.preferences.prefer, ["WEIRD"]);
  assert.deepEqual(draft.intent.preferences.avoid, ["PFP"]);
});

test("short natural language limits remain deterministic", () => {
  const draft = draftStrategyFromConversation({
    message: "Find free pixel art with a website and X. Three max today. Keep .01 ETH in reserve.",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET,
  }, NOW);
  assert.equal(draft.intent.dailyMintLimit, 3);
  assert.equal(draft.intent.requiresSocial, true);
  assert.deepEqual(draft.intent.preferredSocialPlatforms, ["X"]);
});

test("conversation can require either a website or a social profile", () => {
  const draft = draftStrategyFromConversation({
    message: "Find free pixel art. Require a website or social profile. One mint total.",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET,
  }, NOW);
  assert.equal(draft.intent.onlinePresenceRequirement, "WEBSITE_OR_SOCIAL");
  assert.equal(draft.intent.requiresWebsite, false);
  assert.equal(draft.intent.requiresSocial, false);
  assert.deepEqual(draft.confirmation.requirements, [
    "Website or social profile", "Simulation", "Security screening",
  ]);
  assert.ok(draft.changes.includes("REQUIRE_WEBSITE_OR_SOCIAL"));
});

test("conversation updates daily and total mint limits as a pending strategy", () => {
  const draft = draftStrategyFromConversation({
    message: "Set my maximum to 3 mints per day and 12 mints total for this strategy.",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET,
  }, NOW);
  assert.equal(draft.intent.dailyMintLimit, 3);
  assert.equal(draft.intent.totalMintLimit, 12);
  assert.ok(draft.changes.includes("DAILY_LIMIT"));
  assert.ok(draft.changes.includes("TOTAL_LIMIT"));
  assert.equal(draft.economicPermissionsActivated, false);
});

test("bare chat mint quantity sets one clear mission quantity", () => {
  const draft = draftStrategyFromConversation({
    message: "Find me 6 mints.", punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET,
  }, NOW);
  assert.equal(draft.intent.dailyMintLimit, 6);
  assert.equal(draft.intent.totalMintLimit, 6);
  assert.ok(draft.changes.includes("DAILY_LIMIT"));
  assert.ok(draft.changes.includes("TOTAL_LIMIT"));
  assert.equal(draft.status, "PENDING_OWNER_CONFIRMATION");
});

test("natural mission language understands a quantity before free mints", () => {
  const draft = draftStrategyFromConversation({
    message: "i life pixel art i have gas let's go out and mint 6 free mints, do not comeback until the mission is complete",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET,
  }, NOW);
  assert.equal(draft.intent.mintMode, "FREE_ONLY");
  assert.deepEqual(draft.intent.preferences.prefer, ["PIXEL_ART"]);
  assert.equal(draft.intent.dailyMintLimit, 6);
  assert.equal(draft.intent.totalMintLimit, 6);
  assert.ok(draft.changes.includes("DAILY_LIMIT"));
  assert.ok(draft.changes.includes("TOTAL_LIMIT"));
  assert.equal(draft.status, "PENDING_OWNER_CONFIRMATION");
});

test("chat understands a standalone max-mint count and asks when the count is missing", () => {
  const bounded = draftStrategyFromConversation({
    message: "Find me free pixel art. Max one mint.",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET,
  }, NOW);
  assert.equal(bounded.intent.totalMintLimit, 1);
  assert.ok(bounded.changes.includes("TOTAL_LIMIT"));
  assert.equal(bounded.status, "PENDING_OWNER_CONFIRMATION");
  const unclear = draftStrategyFromConversation({
    message: "Find me pixel art and max mint.",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET,
  }, NOW);
  assert.equal(unclear.status, "NEEDS_CLARIFICATION");
  assert.deepEqual(unclear.ambiguous, ["TOTAL_LIMIT"]);
});

test("a specific-mint mission binds only a server-resolved Robinhood contract", () => {
  const targeted = draftStrategyFromConversation({ message: "Watch this mint when public opens.",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET, targetContract: MINT }, NOW);
  assert.deepEqual(targeted.intent.allowedContracts, [MINT]);
  assert.ok(targeted.changes.includes("TARGET_CONTRACT"));
  const unresolved = draftStrategyFromConversation({ message: "Watch this mint when public opens.",
    punkTokenId: "119", expectedOwner: OWNER, punkWallet: WALLET }, NOW);
  assert.equal(unresolved.status, "NEEDS_CLARIFICATION");
  assert.deepEqual(unresolved.ambiguous, ["TARGET_CONTRACT"]);
});

test("link normalization accepts information but never external transaction authority", async () => {
  assert.deepEqual(normalizeArtBrokerLink("https://opensea.io/collection/pepemfersnft/overview"), {
    kind: "OPENSEA_COLLECTION", host: "opensea.io", identity: "pepemfersnft",
    canonicalUrl: "https://opensea.io/collection/pepemfersnft" });
  const inspected = await inspectArtBrokerLink("https://opensea.io/collection/pepemfersnft/overview");
  assert.equal(inspected.status, "NEEDS_REVIEW");
  assert.equal(inspected.executable, false);
  assert.equal(inspected.externalTransactionAccepted, false);
  assert.deepEqual(normalizeArtBrokerLink(`https://robinhoodchain.blockscout.com/address/${MINT}`), {
    kind: "ROBINHOOD_CONTRACT", host: "robinhoodchain.blockscout.com", identity: MINT,
    canonicalUrl: `https://robinhoodchain.blockscout.com/address/${MINT}` });
  assert.throws(() => normalizeArtBrokerLink("https://127.0.0.1/mint"),
    (error) => error.code === "PRIVATE_URL_BLOCKED");
  assert.throws(() => normalizeArtBrokerLink("javascript:alert(1)"),
    (error) => error.code === "INVALID_URL");
});

test("security screening passes only a pinned known-selector mint to the Punk Wallet", () => {
  const safe = screenKnownSafeMint({ chainId: 4663, expectedPunkWallet: WALLET,
    expectedNftReceiver: WALLET, mintContract: MINT, expectedValueWei: "0",
    transaction: { to: MINT, valueWei: "0", data: "0x12345678" },
    allowedSelectors: ["0x12345678"], adapterRecognized: true, chainCodePinned: true,
    proxyChanged: false, containsDelegatecall: false, requestsApproval: false,
    requestsAssetTransfer: false });
  assert.equal(safe.status, "PASSED");
  const blocked = screenKnownSafeMint({ chainId: 4663, expectedPunkWallet: WALLET,
    expectedNftReceiver: OWNER, mintContract: MINT, expectedValueWei: "0",
    transaction: { to: ADAPTER, valueWei: "1", data: "0x095ea7b3" },
    allowedSelectors: ["0x12345678"], adapterRecognized: false, chainCodePinned: false,
    proxyChanged: true, containsDelegatecall: true, requestsApproval: true,
    requestsAssetTransfer: true });
  assert.equal(blocked.status, "BLOCKED");
  assert.deepEqual(blocked.reasons, ["WRONG_TRANSACTION_RECIPIENT", "UNEXPECTED_ETH_VALUE",
    "UNRECOGNIZED_FUNCTION_SELECTOR", "UNRECOGNIZED_ADAPTER", "UNPINNED_CONTRACT_CODE",
    "PROXY_OR_CODE_CHANGED", "DELEGATECALL_DETECTED", "UNEXPECTED_APPROVAL",
    "UNEXPECTED_ASSET_TRANSFER", "WRONG_NFT_RECEIVER"]);
});

test("simulation rejects unexpected approvals, transfers, receiver, and unverifiable effects", () => {
  const passed = validateMintSimulation({ success: true, reverted: false, valueWei: "0",
    nftReceiver: WALLET, estimatedGasWei: "180000000000000", approvals: [],
    unexpectedTransfers: [], postCallVerified: true }, { valueWei: "0", punkWallet: WALLET });
  assert.equal(passed.status, "PASSED");
  assert.equal(passed.executionAuthorized, false);
  const failed = validateMintSimulation({ success: true, reverted: false, valueWei: "1",
    nftReceiver: OWNER, estimatedGasWei: "?", approvals: [{}], unexpectedTransfers: [{}],
    postCallVerified: false }, { valueWei: "0", punkWallet: WALLET });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.reasons.length, 6);
});

test("shared discovery deduplicates sources and computes one cached collection analysis", async () => {
  const engine = new SharedV2DiscoveryEngine();
  const first = engine.ingest(opportunity(), { sourceKind: "OPENSEA", sourceIdentity: "neon", now: NOW });
  const second = engine.ingest(opportunity({ sourceUrls: ["https://neon.example"] }),
    { sourceKind: "WEBSITE", sourceIdentity: "https://neon.example", now: NOW });
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(second.sourceCount, 2);
  let calls = 0;
  const inputHash = createHash("sha256").update("neon-v1").digest("hex");
  const analyze = async () => { calls += 1; return { styles: ["PIXEL_ART"] }; };
  const [left, right] = await Promise.all([
    engine.analyzeOnce(first.opportunity.dedupeKey, inputHash, analyze),
    engine.analyzeOnce(first.opportunity.dedupeKey, inputHash, analyze),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(left.analysis, right.analysis);
});

test("MCP exposes safe Gogh capabilities and no wallet-control backdoor", async () => {
  const names = ART_BROKER_MCP_TOOLS.map(({ name }) => name);
  for (const forbidden of FORBIDDEN_ART_BROKER_MCP_TOOLS) assert.equal(names.includes(forbidden), false);
  const getPunk = ART_BROKER_MCP_TOOLS.find(({ name }) => name === "get_punk");
  assert.deepEqual(getPunk.inputSchema.required, ["tokenId"]);
  assert.equal(getPunk.inputSchema.additionalProperties, false);
  const calls = [];
  const server = new GoghArtBrokerMcpServer({
    authenticate: async () => ({ owner: OWNER }),
    dependencies: {
      requireCurrentOwner: async (id, owner) => calls.push([id, owner]),
      get_punk_wallet: async (id) => ({ tokenId: id, wallet: WALLET }),
    },
  });
  assert.deepEqual(await server.call({ accessToken: "local", name: "get_punk_wallet",
    arguments: { tokenId: "119" } }), { tokenId: "119", wallet: WALLET });
  assert.deepEqual(calls, [["119", OWNER]]);
  await assert.rejects(server.call({ accessToken: "local", name: "get_private_key", arguments: {} }),
    (error) => error.code === "UNKNOWN_TOOL");
  const listed = await handleArtBrokerMcpJsonRpc(server, { jsonrpc: "2.0", id: 1,
    method: "tools/list" });
  assert.equal(listed.result.tools.length, ART_BROKER_MCP_TOOLS.length);
  assert.equal(JSON.stringify(listed).includes("scope"), false);
});
