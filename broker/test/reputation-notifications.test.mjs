import assert from "node:assert/strict";
import test from "node:test";
import { ROBINHOOD } from "../src/config.mjs";
import { rankCurators } from "../src/leaderboards.mjs";
import { NotificationDispatcher } from "../src/notifications/dispatcher.mjs";
import { buildCuratorReputation } from "../src/reputation.mjs";

const identity = {
  chainId: ROBINHOOD.chainId,
  collection: ROBINHOOD.canonicalCollection,
  tokenId: "317",
};

test("reputation keeps incomparable currencies separate", () => {
  const reputation = buildCuratorReputation({
    identity,
    acquisitions: [
      {
        collection: "0x0000000000000000000000000000000000000011",
        tokenId: 1,
        creator: "0x0000000000000000000000000000000000000021",
        currency: "0x0000000000000000000000000000000000000000",
        price: 3,
        acquiredAt: "2026-08-15T00:00:00Z",
        tasteMatch: 90,
        artScore: 80,
        mode: "OWNER_APPROVED",
      },
      {
        collection: "0x0000000000000000000000000000000000000012",
        tokenId: 2,
        creator: "0x0000000000000000000000000000000000000022",
        currency: "0x0000000000000000000000000000000000000031",
        price: 7,
        acquiredAt: "2026-08-16T00:00:00Z",
        tasteMatch: 70,
        artScore: 60,
        mode: "AUTONOMOUS",
        emergingArtist: true,
      },
    ],
  });
  assert.deepEqual(reputation.totalCapitalDeployedByCurrency, {
    "0x0000000000000000000000000000000000000000": "3",
    "0x0000000000000000000000000000000000000031": "7",
  });
  assert.equal(reputation.totalCapitalDeployedByCurrency.total, undefined);
});

test("leaderboard ranking is deterministic and exposes no profit formula", () => {
  const ranked = rankCurators("TOP_CURATOR", [
    { punk: "4663:0x2:2", averageTasteMatch: 80, averageArtScore: 80, artistDiversityScore: 80,
      recommendationConversionRate: 80, totalAcquisitions: 1, emergingArtistDiscoveries: 0 },
    { punk: "4663:0x1:1", averageTasteMatch: 80, averageArtScore: 80, artistDiversityScore: 80,
      recommendationConversionRate: 80, totalAcquisitions: 1, emergingArtistDiscoveries: 0 },
  ]);
  assert.equal(ranked[0].punk, "4663:0x1:1");
  assert.equal(ranked[0].score, 72);
});

test("notifications resolve the live owner and expose notification-only authority", async () => {
  const calls = [];
  const dispatcher = new NotificationDispatcher({
    resolveCurrentOwner: async () => "0x00000000000000000000000000000000000000aa",
    loadOwnerPrivateSettings: async (owner) => ({
      owner,
      channels: [{ type: "DISCORD", destination: "private-destination" }],
    }),
    adapters: new Map([
      ["DISCORD", { send: async (payload) => { calls.push(payload); return "receipt-1"; } }],
    ]),
  });
  const result = await dispatcher.dispatch({
    identity,
    type: "NEW_RECOMMENDATION",
    publicPayload: { recommendationId: "rec-1" },
  });
  assert.equal(result.owner, "0x00000000000000000000000000000000000000aa");
  assert.equal(result.authority, "NOTIFICATION_ONLY");
  assert.equal(result.delivered, 1);
  assert.equal(
    calls[0].punk,
    "4663:0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6:317",
  );
  assert.equal(calls[0].destination, "private-destination");
  assert.equal(JSON.stringify(result).includes("private-destination"), false);
});
