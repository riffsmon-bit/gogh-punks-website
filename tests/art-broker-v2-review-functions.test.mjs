import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleV2ReviewChat } from "../netlify/functions/broker-v2-review-chat.mjs";
import { handleV2ReviewInspectUrl } from "../netlify/functions/broker-v2-review-inspect-url.mjs";
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
  assert.deepEqual(payload.draft.intent.preferences.prefer, ["PIXEL_ART"]);
  assert.equal(payload.draft.provider.provider, "DETERMINISTIC_REVIEW_PARSER");
  assert.deepEqual(authorityReads, [["93", { expectedOwner: OWNER }]]);
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
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /eth_sendTransaction|eth_sendRawTransaction|private[_ ]?key/i);
  }
});
