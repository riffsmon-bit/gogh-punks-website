import assert from "node:assert/strict";
import test from "node:test";

import { localPunkAccount, V2LocalSimulation } from
  "../scripts/lib/v2-local-simulation.mjs";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");

test("local V2 service persists policy and runs an exact safe directed-mint simulation", async () => {
  const service = new V2LocalSimulation({ clock: () => NOW });
  const session = service.session("93");
  assert.equal(session.account, localPunkAccount("93"));
  assert.equal(session.policy.paidMintsEnabled, false);

  const review = await service.resolve({
    tokenId: "93",
    url: "https://opensea.io/collection/local-demo-drop",
    recipient: session.account,
  });
  const blocked = await service.simulate({ tokenId: "93", reviewId: review.reviewId });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.decision.code, "PAID_MODE_DISABLED");

  const saved = service.savePolicy({ tokenId: "93", enabled: true, dailyEth: "0.025",
    perMintEth: "0.01", dailyMintLimit: 3 });
  assert.equal(saved.paidMintsEnabled, true);
  const passed = await service.simulate({ tokenId: "93", reviewId: review.reviewId });
  assert.equal(passed.ready, true);
  assert.equal(passed.simulation.safe, true);
  assert.equal(passed.simulation.recipient, session.account);

  const activity = service.activity("93").activity;
  assert.ok(activity.some((entry) => entry.state === "READY"));
  assert.ok(activity.some((entry) => entry.state === "CHECKING_LIMITS"));
  assert.doesNotMatch(JSON.stringify(activity), /private.?key|signature|secret/i);
});

test("local V2 service isolates Punk state and rejects unsafe or malformed review input", async () => {
  const service = new V2LocalSimulation({ clock: () => NOW });
  const account = localPunkAccount("94");
  await assert.rejects(service.resolve({ tokenId: "94",
    url: "https://opensea.io/collection/example", recipient: localPunkAccount("93") }),
  /recipient/);
  await assert.rejects(service.resolve({ tokenId: "94",
    url: "https://evil.example/collection/example", recipient: account }), /OpenSea|supported/i);
  await assert.rejects(service.simulate({ tokenId: "94", reviewId: "review_94_1" }),
  /unavailable/);
  assert.throws(() => service.savePolicy({ tokenId: "94", enabled: true,
    dailyEth: "0.01", perMintEth: "0.02", dailyMintLimit: 0 }), /mint limit/);

  const scout = service.scout({ tokenId: "94" });
  assert.equal(scout.status, "NO_ELIGIBLE_TARGETS");
  assert.equal(service.activity("93").activity.length, 0);
  assert.equal(service.activity("94").activity.length, 2);
});
