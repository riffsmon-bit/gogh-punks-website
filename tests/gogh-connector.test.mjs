import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryConnectorAuth } from "../broker/src/connector/connector-auth.mjs";
import { GoghConnector } from "../broker/src/connector/gogh-connector.mjs";
import { InMemoryConnectorStore } from "../broker/src/connector/connector-store.mjs";
import { evaluateScoutingSchedule, normalizeScoutingSchedule } from
  "../broker/src/connector/scouting-schedule.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const SIGNATURE = `0x${"22".repeat(65)}`;
const now = Date.parse("2026-08-27T12:00:00.000Z");

function schedule(overrides = {}) {
  return { schema: "GOGH_SCOUTING_SCHEDULE_V1", tokenId: "93",
    startAt: "2026-08-27T11:00:00.000Z", endAt: "2026-08-27T13:00:00.000Z",
    timezone: "UTC", enabled: true, ...overrides };
}

async function fixture() {
  const clock = () => now;
  const auth = new InMemoryConnectorAuth({ clock,
    verifySignature: async ({ wallet }) => wallet === OWNER,
    readOwner: async () => OWNER });
  const challenge = auth.createChallenge({ wallet: OWNER, punkIds: ["93"],
    scopes: ["punk:read", "agent:read", "agent:scout", "mint:inspect", "mint:directed", "agent:pause"] });
  const session = await auth.complete({ challengeId: challenge.challengeId,
    wallet: OWNER, signature: SIGNATURE });
  const store = new InMemoryConnectorStore({ clock });
  let scouts = 0;
  const connector = new GoghConnector({ auth, store, clock, executionMode: "simulate",
    dependencies: {
      listPunks: async () => [{ tokenId: "93" }],
      requireCurrentOwner: async () => true,
      getPunkStatus: async (tokenId) => ({ tokenId, state: "ACTIVE" }),
      getPunkWallet: async (tokenId) => ({ tokenId, punkWallet: OWNER }),
      getPunkPortfolio: async (tokenId) => ({ tokenId, nftCount: 3 }),
      getAgentStatus: async (tokenId) => ({ tokenId, state: "IDLE" }),
      sendScout: async () => ({ status: "queued", jobId: `job_${++scouts}` }),
      inspectMint: async () => ({ supported: true, priceWei: "4" }),
      prepareMint: async () => ({ reviewId: "review_1", collection: "Example",
        mintPriceWei: "4", estimatedGasWei: "1", maximumExpectedSpendWei: "5",
        dailyBudgetRemainingWei: "10", simulation: "ready" }),
      executeMint: async () => ({ safe: true, broadcast: false }),
      pauseAgent: async () => ({ state: "PAUSED" }),
      resumeAgent: async () => ({ state: "IDLE" }),
    } });
  return { auth, store, connector, accessToken: session.accessToken, scouts: () => scouts };
}

test("UTC schedule is canonical and active only inside its bounded window", () => {
  assert.equal(evaluateScoutingSchedule(schedule(), now).state, "ACTIVE");
  assert.equal(evaluateScoutingSchedule(schedule(), now - 2 * 60 * 60_000).state, "SCHEDULED");
  assert.equal(evaluateScoutingSchedule(schedule(), now + 2 * 60 * 60_000).state, "EXPIRED");
  assert.equal(evaluateScoutingSchedule(schedule({ enabled: false }), now).state, "DISABLED");
  assert.throws(() => normalizeScoutingSchedule(schedule({ endAt: "2027-10-01T00:00:00.000Z" })),
    /31 days/);
});
test("wallet challenge binds wallet, Punks, scopes, chain, expiry, and cannot be replayed", async () => {
  const auth = new InMemoryConnectorAuth({ clock: () => now, verifySignature: async () => true,
    readOwner: async () => OWNER });
  const challenge = auth.createChallenge({ wallet: OWNER, punkIds: ["93"], scopes: ["punk:read"] });
  assert.match(challenge.message, /Chain ID: 4663/);
  assert.match(challenge.message, /Punks: 93/);
  await auth.complete({ challengeId: challenge.challengeId, wallet: OWNER, signature: SIGNATURE });
  await assert.rejects(auth.complete({ challengeId: challenge.challengeId,
    wallet: OWNER, signature: SIGNATURE }), /expired/);
});

test("session rejects missing scope and unauthorized Punk", async () => {
  const auth = new InMemoryConnectorAuth({ clock: () => now, verifySignature: async () => true,
    readOwner: async () => OWNER });
  const challenge = auth.createChallenge({ wallet: OWNER, punkIds: ["93"], scopes: ["punk:read"] });
  const session = await auth.complete({ challengeId: challenge.challengeId, wallet: OWNER,
    signature: SIGNATURE });
  assert.throws(() => auth.require(session.accessToken, "mint:directed", "93"), /scope/);
  assert.throws(() => auth.require(session.accessToken, "punk:read", "94"), /cannot control/);
});

test("connector exposes typed read tools", async () => {
  const value = await fixture();
  const listed = await value.connector.call({ accessToken: value.accessToken,
    tool: "list_my_punks", arguments: {} });
  assert.equal(listed.result.punks[0].tokenId, "93");
  const status = await value.connector.call({ accessToken: value.accessToken,
    tool: "get_punk_status", arguments: { tokenId: "93" } });
  assert.equal(status.result.state, "ACTIVE");
});

test("scouting schedule blocks outside window and permits inside window", async () => {
  const value = await fixture();
  await value.connector.call({ accessToken: value.accessToken, tool: "set_scouting_schedule",
    arguments: { tokenId: "93", startAt: "2026-08-27T11:00:00.000Z",
      endAt: "2026-08-27T13:00:00.000Z", timezone: "UTC", enabled: true },
    idempotencyKey: "schedule:93:one" });
  const scout = await value.connector.call({ accessToken: value.accessToken,
    tool: "send_agent_scouting", arguments: { tokenId: "93" },
    idempotencyKey: "scout:93:inside" });
  assert.equal(scout.result.status, "queued");

  await value.connector.call({ accessToken: value.accessToken, tool: "set_scouting_schedule",
    arguments: { tokenId: "93", startAt: "2026-08-27T13:00:01.000Z",
      endAt: "2026-08-27T14:00:00.000Z", timezone: "UTC", enabled: true },
    idempotencyKey: "schedule:93:future" });
  await assert.rejects(value.connector.call({ accessToken: value.accessToken,
    tool: "send_agent_scouting", arguments: { tokenId: "93" },
    idempotencyKey: "scout:93:outside" }), /SCHEDULED/);
});

test("idempotency prevents duplicate scout jobs", async () => {
  const value = await fixture();
  const request = { accessToken: value.accessToken, tool: "send_agent_scouting",
    arguments: { tokenId: "93" }, idempotencyKey: "same-scout-request" };
  const [one, two] = await Promise.all([value.connector.call(request), value.connector.call(request)]);
  assert.deepEqual(one, two);
  assert.equal(value.scouts(), 1);
});

test("directed intent accepts URL, quantity one, and simulates without broadcast", async () => {
  const value = await fixture();
  const prepared = await value.connector.call({ accessToken: value.accessToken,
    tool: "prepare_directed_mint", arguments: { tokenId: "93",
      url: "https://opensea.io/collection/example", quantity: 1 },
    idempotencyKey: "prepare:example:93" });
  assert.match(prepared.result.intentId, /^mint_/);
  const executed = await value.connector.call({ accessToken: value.accessToken,
    tool: "execute_directed_mint", arguments: { intentId: prepared.result.intentId },
    idempotencyKey: "execute:example:93" });
  assert.equal(executed.executionMode, "simulate");
  assert.equal(executed.result.simulation.broadcast, false);
});

test("connector never accepts raw transaction fields", async () => {
  const value = await fixture();
  await assert.rejects(value.connector.call({ accessToken: value.accessToken,
    tool: "prepare_directed_mint", arguments: { tokenId: "93",
      url: "https://opensea.io/collection/example", quantity: 1,
      to: OWNER, calldata: "0x", value: "0" }, idempotencyKey: "raw-fields-rejected" }),
  /invalid/);
  await assert.rejects(value.connector.call({ accessToken: value.accessToken,
    tool: "send_transaction", arguments: {} }), /not supported/);
});

test("audit records successful and rejected connector commands without signatures", async () => {
  const value = await fixture();
  await value.connector.call({ accessToken: value.accessToken, tool: "get_punk_status",
    arguments: { tokenId: "93" } });
  await assert.rejects(value.connector.call({ accessToken: value.accessToken,
    tool: "prepare_directed_mint", arguments: { tokenId: "93", url: "x", quantity: 2 },
    idempotencyKey: "bad-quantity-key" }));
  const audit = value.store.auditFor("93");
  assert.equal(audit.length, 2);
  assert.equal(Object.hasOwn(audit[0], "signature"), false);
});
