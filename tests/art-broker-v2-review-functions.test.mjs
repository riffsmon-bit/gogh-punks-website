import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleV2ReviewChat } from "../netlify/functions/broker-v2-review-chat.mjs";
import { handleV2ReviewInspectUrl } from "../netlify/functions/broker-v2-review-inspect-url.mjs";
import { handleV2ReviewRun } from "../netlify/functions/broker-v2-review-run.mjs";
import { isV2DeployPreview } from "../netlify/functions/_shared/v2-review.mjs";

const ORIGIN = "https://deploy-preview-42.preview.goghpunks.xyz";
const OWNER = "0x1111111111111111111111111111111111111111";
const PUNK_WALLET = "0x2222222222222222222222222222222222222222";
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
  }), { now: new Date("2026-09-06T14:00:00.000Z"),
    readAuthority: async () => ({ punkWallet: PUNK_WALLET }),
    answerConversation: async ({ inspection }) => ({
      reply: `I can explain this ${inspection.kind}.`, provider: "OPENAI",
      registryKey: "openai:auto", providerAvailable: true,
    }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.responseKind, "CONVERSATION");
  assert.equal(payload.draft, null);
  assert.equal(payload.provider.provider, "OPENAI");
  assert.equal(payload.transactionPrepared, false);
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
