import { runAutomationV3Once } from "./_shared/automation-v3-runner.mjs";
import {
  assertV1RegistrationEnabled, BROKER_MIGRATION_PAUSE_REASON,
  V1_REGISTRATION_CLOSED, V1_RETIRED_REASON,
} from "./_shared/broker-migration-state.mjs";
import { enrollAutomationV3Punk } from "./_shared/automation-v3-worker-state.mjs";
import {
  automationV3LaneEnvironment, regularAutomationV3AgentLanes,
} from "./_shared/automation-v3-agent-pool.mjs";
import { resolveAutomationV3PunkAgent } from "./_shared/automation-v3-punk-agent.mjs";
import {
  forwardProductionAutomationV3Run, isDeployPreview,
} from "./_shared/automation-v3-production-bridge.mjs";
import { json, PublicError, readJson, requireSameOrigin } from "./_shared/http.mjs";

function exactBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !Object.hasOwn(body, "tokenId")
    || typeof body.tokenId !== "string"
    || !/^(?:0|[1-9][0-9]{0,3})$/.test(body.tokenId)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose a valid Punk to run.");
  }
  return body.tokenId;
}

function allBody(body) {
  return Boolean(body && typeof body === "object" && !Array.isArray(body)
    && Object.keys(body).length === 1 && body.all === true);
}

export function requireAutomationV3RunOrigin(request, environment = process.env) {
  if (!isDeployPreview(environment, request.url)) {
    requireSameOrigin(request);
    return;
  }
  // The browser calls the deploy-preview function from the exact preview origin. The preview
  // function then performs a separate fixed-origin server request to production. Do not compare
  // the browser's preview Origin with production SITE_URL, and do not accept sibling/attacker
  // preview origins.
  let servedOrigin;
  try {
    servedOrigin = new URL(request.url).origin;
  } catch {
    servedOrigin = null;
  }
  if (!servedOrigin || request.headers.get("origin") !== servedOrigin) {
    throw new PublicError(403, "ORIGIN_REJECTED", "The request origin was rejected.");
  }
}

export async function runSelectedAutomationV3(body, dependencies = {}) {
  const tokenId = exactBody(body);
  const environment = dependencies.environment ?? process.env;
  assertV1RegistrationEnabled(environment, { now: dependencies.now });
  const runOnce = dependencies.runOnce ?? runAutomationV3Once;
  const enroll = dependencies.enroll ?? enrollAutomationV3Punk;
  let lane = null;
  let punk;
  if (dependencies.readPunk) {
    punk = await dependencies.readPunk(tokenId);
    lane = dependencies.lane ?? { laneId: 1, address: punk?.authorization?.agent };
  } else {
    ({ lane, punk } = await resolveAutomationV3PunkAgent(tokenId, environment, {
      assignment: dependencies.assignment,
      database: dependencies.database,
    }));
  }
  if (punk?.tokenId !== tokenId || punk?.created !== true || punk?.active !== true) {
    throw new PublicError(
      409,
      "PUNK_AUTOMATION_INACTIVE",
      `Punk #${tokenId} is not currently authorized for autonomous V3 mints.`,
    );
  }
  await enroll(punk, { agentAddress: lane.address, agentLane: lane.laneId });
  const runOptions = { requestedTokenId: tokenId, laneId: lane.laneId,
    agentAddress: lane.address };
  if (!dependencies.runOnce) {
    runOptions.environment = automationV3LaneEnvironment(environment, lane.laneId);
    runOptions.laneId = lane.laneId;
  }
  const result = await runOnce(runOptions);
  return Object.freeze({
    tokenId,
    status: result.status,
    submitted: result.submitted,
    collection: result.collection ?? null,
    transactionHash: result.transactionHash ?? null,
  });
}

export async function runAllAutomationV3(body, dependencies = {}) {
  if (!allBody(body)) {
    throw new PublicError(400, "INVALID_REQUEST", "The all-Punk scan request is invalid.");
  }
  const runOnce = dependencies.runOnce ?? runAutomationV3Once;
  const environment = dependencies.environment ?? process.env;
  assertV1RegistrationEnabled(environment, { now: dependencies.now });
  if (dependencies.runOnce) {
    const result = await runOnce({ requestedTokenId: null });
    return Object.freeze({
      tokenId: result.tokenId ?? null,
      status: result.status,
      submitted: result.submitted,
      collection: result.collection ?? null,
      transactionHash: result.transactionHash ?? null,
    });
  }
  const results = await Promise.all(regularAutomationV3AgentLanes(environment).map((lane) =>
    runOnce({ requestedTokenId: null,
      environment: automationV3LaneEnvironment(environment, lane.laneId),
      laneId: lane.laneId })));
  const submitted = results.reduce((total, result) => total + Number(result.submitted ?? 0), 0);
  const result = results.find((candidate) => Number(candidate.submitted ?? 0) > 0)
    ?? results.find((candidate) => candidate.status === "RUN_IN_PROGRESS") ?? results[0];
  return Object.freeze({
    tokenId: result.tokenId ?? null,
    status: result.status,
    submitted,
    collection: result.collection ?? null,
    transactionHash: result.transactionHash ?? null,
    lanes: Object.freeze(results.map((candidate, index) => Object.freeze({
      laneId: regularAutomationV3AgentLanes(environment)[index].laneId,
      status: candidate.status,
      submitted: Number(candidate.submitted ?? 0),
    }))),
  });
}

function responseFor(result) {
  const status = result.status === "RUN_IN_PROGRESS" ? 202 : 200;
  return json({ ok: true, run: result }, status, {
    "netlify-cdn-cache-control": "no-store",
  });
}

export default async function handler(request) {
  try {
    if (request.method !== "POST") {
      return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    }
    const preview = isDeployPreview(process.env, request.url);
    requireAutomationV3RunOrigin(request, process.env);
    const body = await readJson(request, 1_024);
    if (preview) {
      if (!allBody(body)) exactBody(body);
      const forwarded = await forwardProductionAutomationV3Run(body);
      return forwarded.ok
        ? json({ ok: true, run: forwarded.run }, forwarded.status, {
          "netlify-cdn-cache-control": "no-store",
        })
        : json({ ok: false, code: forwarded.code, message: forwarded.message }, forwarded.status);
    }
    return responseFor(allBody(body)
      ? await runAllAutomationV3(body)
      : await runSelectedAutomationV3(body));
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    if (new Set([BROKER_MIGRATION_PAUSE_REASON, V1_REGISTRATION_CLOSED,
      V1_RETIRED_REASON]).has(error?.code)) {
      return json({ ok: false, code: error.code, message: error.message }, 503, {
        "netlify-cdn-cache-control": "no-store",
      });
    }
    console.error(JSON.stringify({
      event: "AUTOMATION_V3_MANUAL_RUN_FAILED",
      code: typeof error?.code === "string" ? error.code : "FAILED",
    }));
    return json({
      ok: false,
      code: "RUN_FAILED_SAFELY",
      message: "The agent scan stopped safely. No browser transaction was submitted.",
    }, 503);
  }
}

export const config = {
  path: "/api/broker/autonomy-v3-run",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 4,
    windowSize: 60,
  },
};
