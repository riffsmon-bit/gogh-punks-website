import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATION_V3_PRODUCTION_ORIGIN,
  forwardProductionAutomationV3Run,
  getProductionAutomationV3Activity,
  isDeployPreview,
} from "../netlify/functions/_shared/automation-v3-production-bridge.mjs";
import { requireAutomationV3RunOrigin } from
  "../netlify/functions/broker-autonomy-v3-run.mjs";

const release = "a".repeat(40);
const heartbeat = Object.freeze({
  release,
  startedAt: "2026-08-28T13:52:50.000Z",
  completedAt: "2026-08-28T13:52:57.000Z",
  status: "NO_ELIGIBLE_TARGETS",
  submitted: 0,
  tokenId: null,
  account: null,
  collection: null,
  transactionHash: null,
  failureCode: null,
});
const usage = Object.freeze({
  confirmedMints: "728",
  mintingPunks: "111",
  autonomousPreferenceWallets: "2",
  recordedRuns: "1172",
  trackedSince: "2026-08-24T23:12:46.460Z",
  latestConfirmedAt: "2026-08-28T13:37:38.368Z",
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("only the exact Netlify deploy-preview context uses the production bridge", () => {
  assert.equal(isDeployPreview({ CONTEXT: "deploy-preview" }), true);
  assert.equal(isDeployPreview({ CONTEXT: "production" }), false);
  assert.equal(isDeployPreview({ CONTEXT: "branch-deploy" }), false);
  assert.equal(isDeployPreview({ CONTEXT: "DEPLOY-PREVIEW" }), false);
  assert.equal(isDeployPreview(
    {}, "https://deploy-preview-9--gogh-punks.netlify.app/api/broker/autonomy-v3-status",
  ), true);
  assert.equal(isDeployPreview(
    {}, "https://deploy-preview-13.preview.goghpunks.xyz/api/broker/autonomy-v3-status",
  ), true);
  assert.equal(isDeployPreview(
    {}, "https://deploy-preview-0--gogh-punks.netlify.app/api/broker/autonomy-v3-status",
  ), false);
  assert.equal(isDeployPreview(
    {}, "https://deploy-preview-9--gogh-punks.netlify.app.evil.example/api",
  ), false);
  assert.equal(isDeployPreview({}, "http://deploy-preview-9--gogh-punks.netlify.app/api"), false);
  assert.equal(isDeployPreview(
    {}, "https://deploy-preview-13.preview.goghpunks.xyz.evil.example/api",
  ), false);
});

test("custom preview manual runs accept only their exact served browser origin", () => {
  const url = "https://deploy-preview-13.preview.goghpunks.xyz/api/broker/autonomy-v3-run";
  assert.doesNotThrow(() => requireAutomationV3RunOrigin(new Request(url, {
    method: "POST", headers: { origin: "https://deploy-preview-13.preview.goghpunks.xyz" },
  }), {}));
  assert.throws(() => requireAutomationV3RunOrigin(new Request(url, {
    method: "POST", headers: { origin: "https://deploy-preview-12.preview.goghpunks.xyz" },
  }), {}), /origin was rejected/);
  assert.throws(() => requireAutomationV3RunOrigin(new Request(url, {
    method: "POST", headers: { origin: "https://attacker.example" },
  }), {}), /origin was rejected/);
});

test("preview activity reads the fixed production endpoint and validates its evidence", async () => {
  let call;
  const result = await getProductionAutomationV3Activity(async (url, options) => {
    call = { url, options };
    return jsonResponse({
      ok: true,
      activity: {
        checkedAt: "2026-08-28T13:53:00.000Z",
        configured: true,
        online: true,
        executionReady: true,
        platformHealth: { status: "HEALTHY", reason: null,
          lastSuccessfulAt: "2026-08-28T13:52:57.000Z", consecutiveFailures: 0 },
        heartbeat,
        usage,
        punk: null,
      },
    });
  });
  assert.equal(call.url, `${AUTOMATION_V3_PRODUCTION_ORIGIN}/api/broker/autonomy-v3-activity`);
  assert.equal(call.options.method, "GET");
  assert.equal(call.options.redirect, "error");
  assert.equal(result.online, true);
  assert.equal(result.heartbeat.release, release);
  assert.equal(result.usage.confirmedMints, "728");
});

test("preview activity forwards one exact Punk selection", async () => {
  let call;
  const result = await getProductionAutomationV3Activity(async (url) => {
    call = url;
    return jsonResponse({ ok: true, activity: {
      checkedAt: "2026-08-28T13:53:00.000Z", configured: true, online: true,
      executionReady: true,
      platformHealth: { status: "HEALTHY", reason: null,
        lastSuccessfulAt: "2026-08-28T13:52:57.000Z", consecutiveFailures: 0 },
      heartbeat, usage, punk: { heartbeat: {
        tokenId: "93", state: "SKIPPED", jobId: "12345678",
        lastScheduledScan: "2026-08-28T13:52:50.000Z",
        lastActualScan: "2026-08-28T13:52:57.000Z", lastSuccessfulMint: null,
        nextScanEstimate: "2026-08-28T16:07:50.000Z", reason: "NO_ELIGIBLE_TARGETS",
        updatedAt: "2026-08-28T13:52:57.000Z",
      }, events: [] },
    } });
  }, "93");
  assert.equal(call,
    `${AUTOMATION_V3_PRODUCTION_ORIGIN}/api/broker/autonomy-v3-activity?tokenId=93`);
  assert.equal(result.punk.heartbeat.tokenId, "93");
});

test("preview activity preserves validated legacy production evidence during rollout", async () => {
  const result = await getProductionAutomationV3Activity(async () => jsonResponse({
    ok: true,
    activity: {
      checkedAt: "2026-08-28T13:53:00.000Z",
      online: true,
      heartbeat,
      usage,
      punk: { heartbeat: {
        tokenId: "93", state: "MINTED", jobId: "12345678",
        lastScheduledScan: "2026-08-28T13:52:50.000Z",
        lastActualScan: "2026-08-28T13:52:57.000Z",
        lastSuccessfulMint: `0x${"1".repeat(64)}`,
        nextScanEstimate: "2026-08-28T16:07:50.000Z", reason: "MINT_CONFIRMED",
        updatedAt: "2026-08-28T13:52:57.000Z",
      }, events: [] },
    },
  }), "93");

  assert.equal(result.configured, true);
  assert.equal(result.executionReady, true);
  assert.equal(result.platformHealth.status, "HEALTHY");
  assert.equal(result.platformHealth.lastSuccessfulAt, heartbeat.completedAt);
  assert.equal(result.punk.heartbeat.state, "MINTED");
});

test("preview activity fails closed on malformed production evidence", async () => {
  await assert.rejects(
    getProductionAutomationV3Activity(async () => jsonResponse({
      ok: true,
      activity: {
        checkedAt: "not-a-time",
        configured: true,
        online: true,
        executionReady: true,
        platformHealth: { status: "HEALTHY", reason: null,
          lastSuccessfulAt: "2026-08-28T13:52:57.000Z", consecutiveFailures: 0 },
        heartbeat,
        usage,
      },
    })),
    /time is invalid/,
  );
  await assert.rejects(
    getProductionAutomationV3Activity(async () => jsonResponse({
      ok: true,
      activity: {
        checkedAt: "2026-08-28T13:53:00.000Z",
        configured: true,
        online: "yes",
        executionReady: true,
        platformHealth: { status: "HEALTHY", reason: null,
          lastSuccessfulAt: "2026-08-28T13:52:57.000Z", consecutiveFailures: 0 },
        heartbeat,
        usage,
      },
    })),
    /state is invalid/,
  );
  await assert.rejects(
    getProductionAutomationV3Activity(async () => jsonResponse({
      ok: true,
      activity: {
        checkedAt: "2026-08-28T13:53:00.000Z",
        configured: true,
        online: true,
        heartbeat,
        usage,
      },
    })),
    /state is invalid/,
  );
});

test("preview manual runs forward only structured intents to production", async () => {
  let call;
  const result = await forwardProductionAutomationV3Run(
    { tokenId: "96" },
    async (url, options) => {
      call = { url, options };
      return jsonResponse({
        ok: true,
        run: {
          tokenId: "96",
          status: "NO_ELIGIBLE_TARGETS",
          submitted: 0,
          collection: null,
          transactionHash: null,
        },
      });
    },
  );
  assert.equal(call.url, `${AUTOMATION_V3_PRODUCTION_ORIGIN}/api/broker/autonomy-v3-run`);
  assert.equal(call.options.headers.origin, AUTOMATION_V3_PRODUCTION_ORIGIN);
  assert.deepEqual(JSON.parse(call.options.body), { tokenId: "96" });
  assert.deepEqual(result, {
    status: 200,
    ok: true,
    run: {
      tokenId: "96",
      status: "NO_ELIGIBLE_TARGETS",
      submitted: 0,
      collection: null,
      transactionHash: null,
    },
  });
});

test("preview manual runs preserve bounded production rejections", async () => {
  const result = await forwardProductionAutomationV3Run(
    { tokenId: "96" },
    async () => jsonResponse({
      ok: false,
      code: "PUNK_AUTOMATION_INACTIVE",
      message: "Punk #96 is not currently authorized for autonomous V3 mints.",
    }, 409),
  );
  assert.deepEqual(result, {
    status: 409,
    ok: false,
    code: "PUNK_AUTOMATION_INACTIVE",
    message: "Punk #96 is not currently authorized for autonomous V3 mints.",
  });
});

test("preview manual runs reject false confirmed-mint claims", async () => {
  await assert.rejects(
    forwardProductionAutomationV3Run(
      { tokenId: "96" },
      async () => jsonResponse({
        ok: true,
        run: {
          tokenId: "96",
          status: "MINT_CONFIRMED",
          submitted: 0,
          collection: null,
          transactionHash: null,
        },
      }),
    ),
    /incomplete/,
  );
});
