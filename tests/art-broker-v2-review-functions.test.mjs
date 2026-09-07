import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleV2ReviewChat } from "../netlify/functions/broker-v2-review-chat.mjs";
import { handleV2ReviewInspectUrl } from "../netlify/functions/broker-v2-review-inspect-url.mjs";
import { handleV2ReviewRun } from "../netlify/functions/broker-v2-review-run.mjs";
import { requireV2SessionOrigin } from "../netlify/functions/broker-v2-session.mjs";
import { requireV2StrategyOrigin } from "../netlify/functions/broker-v2-strategy.mjs";
import { PublicError } from "../netlify/functions/_shared/http.mjs";
import { isV2DeployPreview } from "../netlify/functions/_shared/v2-review.mjs";

const ORIGIN = "https://deploy-preview-42.preview.goghpunks.xyz";
const OWNER = "0x1111111111111111111111111111111111111111";
const PUNK_WALLET = "0x2222222222222222222222222222222222222222";
const TARGET = "0x3333333333333333333333333333333333333333";
function request(path, body, origin = ORIGIN, base = ORIGIN) {
  return new Request(`${base}${path}`, { method: "POST", headers: {
    "content-type": "application/json", origin,
  }, body: JSON.stringify(body) });
}

test("review-only capabilities require the exact same deploy-preview origin", () => {
  assert.equal(isV2DeployPreview(request("/api/v2/review/chat", {})), true);
  assert.equal(isV2DeployPreview(request(
    "/api/v2/review/chat", {}, "https://goghpunks.xyz",
  )), false);
  const hostile = new Request("https://deploy-preview-42.preview.goghpunks.xyz.evil.test/api/v2/review/chat",
    { method: "POST", headers: { origin: "https://deploy-preview-42.preview.goghpunks.xyz.evil.test" },
      body: "{}" });
  assert.equal(isV2DeployPreview(hostile), false);
  assert.equal(isV2DeployPreview(request("/api/v2/review/chat", {},
    "https://goghpunks.xyz", "https://goghpunks.xyz")), false);
});

test("V2 wallet sign-in accepts only an exact self-originating deploy preview", () => {
  const customPreview = request("/api/v2/session", { action: "prepare" });
  assert.doesNotThrow(() => requireV2SessionOrigin(customPreview));
  const netlifyOrigin = "https://deploy-preview-42--gogh-punks.netlify.app";
  assert.doesNotThrow(() => requireV2SessionOrigin(request("/api/v2/session",
    { action: "prepare" }, netlifyOrigin, netlifyOrigin)));
  const hostile = new Request(`${ORIGIN}/api/v2/session`, { method: "POST",
    headers: { origin: "https://deploy-preview-42.preview.goghpunks.xyz.evil.test" },
    body: "{}" });
  assert.throws(() => requireV2SessionOrigin(hostile),
    (error) => error instanceof PublicError && error.code === "ORIGIN_REJECTED");
});

test("strategy activation accepts the exact custom and Netlify preview origins", () => {
  assert.doesNotThrow(() => requireV2StrategyOrigin(request(
    "/api/v2/punks/93/strategy", { action: "prepare_activation" })));
  const netlifyOrigin = "https://deploy-preview-42--gogh-punks.netlify.app";
  assert.doesNotThrow(() => requireV2StrategyOrigin(request(
    "/api/v2/punks/93/strategy", { action: "prepare_activation" },
    netlifyOrigin, netlifyOrigin)));
  const missingOrigin = new Request(`${ORIGIN}/api/v2/punks/93/strategy`, {
    method: "POST", body: "{}",
  });
  assert.throws(() => requireV2StrategyOrigin(missingOrigin),
    (error) => error instanceof PublicError && error.code === "V2_REVIEW_ONLY");
  const hostile = new Request(`${ORIGIN}/api/v2/punks/93/strategy`, {
    method: "POST", headers: { origin: `${ORIGIN}.evil.test` }, body: "{}",
  });
  assert.throws(() => requireV2StrategyOrigin(hostile),
    (error) => error instanceof PublicError && error.code === "V2_REVIEW_ONLY");
});

test("review chat live-binds the owner and returns an ephemeral structured draft", async () => {
  const authorityReads = [];
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93",
    message: "Find free pixel art with a website. Three max today. Keep .01 ETH in reserve.",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async (...args) => {
      authorityReads.push(args);
      return { punkWallet: PUNK_WALLET };
    } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.reviewMode, true);
  assert.equal(payload.persistence, "NONE");
  assert.equal(payload.economicPermissionsActivated, false);
  assert.equal(payload.transactionPrepared, false);
  assert.equal(payload.draft.intent.punkTokenId, "93");
  assert.equal(payload.draft.intent.expectedOwner, OWNER);
  assert.equal(payload.draft.intent.punkWallet, PUNK_WALLET);
  assert.equal(payload.draft.intent.mintMode, "FREE_ONLY");
  assert.equal(payload.draft.intent.minimumReserveWei, "10000000000000000");
  assert.equal(payload.draft.intent.dailyMintLimit, 3);
  assert.match(payload.reply, /3 MAX PER DAY\. 1 MAX FOR THIS STRATEGY/);
  assert.deepEqual(payload.draft.intent.preferences.prefer, ["PIXEL_ART"]);
  assert.equal(payload.draft.provider.provider, "DETERMINISTIC_REVIEW_PARSER");
  assert.deepEqual(authorityReads, [["93", { expectedOwner: OWNER }]]);
});

test("review chat applies follow-up instructions to the Punk's current structured intent", async () => {
  const first = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Find free pixel art with a website.",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  const firstPayload = await first.json();
  const second = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Assist me and find three things per day.",
    currentIntent: firstPayload.draft.intent,
  }), { now: new Date("2026-09-06T14:01:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  assert.equal(second.status, 200);
  const payload = await second.json();
  assert.equal(payload.draft.intent.operatingMode, "ASSIST");
  assert.equal(payload.draft.intent.dailyMintLimit, 3);
  assert.deepEqual(payload.draft.intent.preferences.prefer, ["PIXEL_ART"],
    "follow-up instructions must refine rather than reset confirmed taste");
  assert.equal(payload.draft.intent.requiresWebsite, true);
});

test("review chat asks for a missing max-mint number instead of activating a guess", async () => {
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Find pixel art and max mint.",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.responseKind, "CLARIFICATION_REQUIRED");
  assert.equal(payload.draft, null);
  assert.deepEqual(payload.clarificationFields, ["TOTAL_LIMIT"]);
  assert.match(payload.reply, /exact total limit/i);
  assert.equal(payload.economicPermissionsActivated, false);
});

test("review chat binds a specific mission only to an identified Robinhood contract", async () => {
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Watch this mint when public opens. Max one mint.",
    inspection: { kind: "ROBINHOOD_CONTRACT", status: "NEEDS_REVIEW", identity: TARGET },
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.responseKind, "STRATEGY_DRAFT");
  assert.deepEqual(payload.draft.intent.allowedContracts, [TARGET]);
  assert.equal(payload.draft.intent.totalMintLimit, 1);
  assert.equal(payload.economicPermissionsActivated, false);
});

test("review chat rejects an unverified contract identity carried by the browser", async () => {
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Watch this mint when public opens.",
    inspection: { kind: "ROBINHOOD_CONTRACT", status: "NEEDS_REVIEW", identity: "not-an-address" },
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_REQUEST");
});

test("review chat rejects a client-carried strategy bound to another owner", async () => {
  const first = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Find free pixel art.",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  const firstPayload = await first.json();
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Assist me.", currentIntent: {
      ...firstPayload.draft.intent,
      expectedOwner: "0x9999999999999999999999999999999999999999",
    },
  }), { now: new Date("2026-09-06T14:01:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "INVALID_REQUEST");
});

test("ordinary questions receive a grounded Punk reply instead of a fake strategy change", async () => {
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "What do you think about pixel art?",
    inspection: { kind: "OPENSEA_COLLECTION", status: "NEEDS_REVIEW" },
    history: [{ role: "OWNER", content: "I like pixel art." }],
    review: { checkedCount: 2, eligibleCount: 1,
      leadingCollectionName: "Neon Alley", leadingMatchScore: 94,
      missionStatus: "SCOUTING", missionTarget: 6, missionFound: 1,
      missionChecks: 2, missionCheckedOpportunities: 40 },
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }),
    answerConversation: async ({ inspection, history, review }) => ({
      reply: `I can explain this ${inspection.kind}; ${history.length} earlier turn, ${review.eligibleCount} match, and mission ${review.missionStatus}.`, provider: "OPENAI",
      registryKey: "openai:auto", providerAvailable: true,
    }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.responseKind, "CONVERSATION");
  assert.equal(payload.draft, null);
  assert.equal(payload.provider.provider, "OPENAI");
  assert.match(payload.reply, /1 earlier turn, 1 match, and mission SCOUTING/);
  assert.equal(payload.transactionPrepared, false);
});

test("review chat preserves a session challenge code from an asynchronous reply", async () => {
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "What do you think about pixel art?",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }),
    answerConversation: async () => {
      throw new PublicError(401, "V2_SESSION_REQUIRED", "Sign in with your wallet.");
    } });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, code: "V2_SESSION_REQUIRED",
    message: "Sign in with your wallet." });
});

test("review chat drafts an owner-bound read-only Punk skill", async () => {
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93",
    message: "Teach yourself to inspect links and explain contract risk.",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.responseKind, "SKILL_DRAFT");
  assert.equal(payload.skillDraft.state, "DRAFT");
  assert.equal(payload.skillDraft.expectedOwner, OWNER);
  assert.equal(payload.skillDraft.punkWallet, PUNK_WALLET);
  assert.equal(payload.skillDraft.authority, "READ_ONLY");
  assert.equal(payload.skillDraft.policyEffect, "NONE");
  assert.equal(payload.transactionPrepared, false);
});

test("review chat rejects a skill that asks for wallet authority", async () => {
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Teach yourself to sign any transaction.",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "UNSAFE_SKILL");
});

test("SEND PUNK OUT performs one read-only shared-discovery run", async () => {
  const first = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Find free pixel art.",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  const firstPayload = await first.json();
  const queries = [];
  const response = await handleV2ReviewRun(request("/api/v2/review/run", {
    owner: OWNER, tokenId: "93", intent: firstPayload.draft.intent,
  }), { now: new Date("2026-09-06T14:01:00.000Z"),
    readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET,
      nativeBalanceWei: "100000000000000000" }),
    pool: { query: async (sql) => {
      queries.push(sql);
      if (sql.includes("GROUP BY opportunity_id")) return { rows: [] };
      if (sql.includes("broker_v2_opportunities")) return { rows: [] };
      return { rows: [{ daily: 0, total: 0 }] };
    } } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reviewOnly, true);
  assert.equal(payload.authority, "NONE");
  assert.equal(payload.checkedCount, 0);
  assert.equal(payload.eligibleCount, 0);
  assert.equal(payload.transactionPrepared, false);
  assert.equal(payload.executionAttemptCreated, false);
  assert.equal(queries.length, 3);
});

test("a shared opportunity becomes review-eligible only with a fresh Punk-specific simulation", async () => {
  const first = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Find free pixel art.",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  const intent = (await first.json()).draft.intent;
  const normalized = {
    schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2,
    opportunityId: "seadrop:pixel-study:public",
    dedupeKey: "ignored-by-normalizer", chainId: 4663,
    collectionContract: "0x3333333333333333333333333333333333333333",
    mintContract: "0x00005ea00ac477b1030ce78506496e8c2de24bf5",
    adapter: "0xd4316dfbcfa3f51f1a9de77aaa5d9e6edf848777",
    mintStage: "PUBLIC", mintMethod: "mintPublic(address,address,address,uint256)",
    priceWei: "0", estimatedGasCostWei: "0", supply: 777, walletLimit: 2,
    startTime: "2026-09-06T13:00:00.000Z", endTime: "2026-09-07T14:00:00.000Z",
    website: null, socialUrls: { x: null, discord: null, farcaster: null },
    sourceUrls: ["https://robinhoodchain.blockscout.com/address/0x3333333333333333333333333333333333333333"],
    artStyles: ["PIXEL_ART"], imageReference: null, collectionName: "Pixel Study",
    contractCodeHash: `0x${"11".repeat(32)}`, adapterCodeHash: `0x${"22".repeat(32)}`,
    screeningStatus: "PASSED", simulationStatus: "UNAVAILABLE", riskLevel: "LOW", riskScore: 10,
    expectedNftReceiver: null, unexpectedApprovals: false, unexpectedTransfers: false,
    createdAt: "2026-09-06T13:00:00.000Z", updatedAt: "2026-09-06T13:30:00.000Z",
  };
  const response = await handleV2ReviewRun(request("/api/v2/review/run", {
    owner: OWNER, tokenId: "93", intent,
  }), { now: new Date("2026-09-06T14:01:00.000Z"),
    readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET,
      nativeBalanceWei: "100000000000000000" }),
    pool: { query: async (sql) => {
      if (sql.includes("GROUP BY opportunity_id")) return { rows: [] };
      if (sql.includes("broker_v2_opportunities opportunity")) return { rows: [{ normalized,
        simulation_status: "PASSED", gas_estimate: "100000000000000",
        expected_receiver: PUNK_WALLET }] };
      return { rows: [{ daily: 0, total: 0 }] };
    } } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.checkedCount, 1);
  assert.equal(payload.screeningPassedCount, 1);
  assert.equal(payload.simulationPassedCount, 1);
  assert.equal(payload.eligibleCount, 1);
  assert.equal(payload.opportunities[0].opportunity.expectedNftReceiver, PUNK_WALLET);
  assert.equal(payload.transactionPrepared, false);
});

test("safe preview test runs the full matcher with a non-live, non-persisted fixture", async () => {
  const first = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Find free pixel art.",
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  const firstPayload = await first.json();
  const response = await handleV2ReviewRun(request("/api/v2/review/run", {
    owner: OWNER, tokenId: "93", intent: firstPayload.draft.intent,
    testMode: "SAFE_FIXTURE",
  }), { now: new Date("2026-09-06T14:01:00.000Z"),
    readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET,
      nativeBalanceWei: "100000000000000000" }),
    pool: { query: async (sql) => sql.includes("broker_v2_opportunities")
      || sql.includes("GROUP BY opportunity_id") ? { rows: [] }
      : { rows: [{ daily: 0, total: 0 }] } } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.testMode, "SAFE_FIXTURE");
  assert.equal(payload.testOpportunityCount, 1);
  assert.equal(payload.checkedCount, 1);
  assert.equal(payload.eligibleCount, 1);
  assert.equal(payload.opportunities[0].previewFixture, true);
  assert.match(payload.opportunities[0].opportunity.collectionName, /PREVIEW TEST/);
  assert.equal(payload.transactionPrepared, false);
  assert.equal(payload.executionAttemptCreated, false);
});

test("review link inspection accepts information but no transaction authority", async () => {
  const response = await handleV2ReviewInspectUrl(request("/api/v2/review/inspect-url", {
    owner: OWNER, tokenId: "93", url: "https://opensea.io/collection/pepemfersnft/overview",
  }), {
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.inspection.link.kind, "OPENSEA_COLLECTION");
  assert.equal(payload.inspection.status, "NEEDS_REVIEW");
  assert.equal(payload.transactionPrepared, false);
  assert.equal(payload.externalCalldataAccepted, false);
});

test("review functions are absent from production and contain no transaction send path", async () => {
  const response = await handleV2ReviewChat(request("/api/v2/review/chat", {
    owner: OWNER, tokenId: "93", message: "Find free art.",
  }, "https://goghpunks.xyz", "https://goghpunks.xyz"), {
    readAuthority: async () => { throw new Error("must not read"); } });
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.code, "V2_REVIEW_ONLY");
  const sources = await Promise.all([
    readFile(new URL("../netlify/functions/broker-v2-review-chat.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-v2-review-inspect-url.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-v2-review-run.mjs", import.meta.url), "utf8"),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /eth_sendTransaction|eth_sendRawTransaction|private[_ ]?key/i);
  }
});
