import assert from "node:assert/strict";
import test from "node:test";

import deployment from "../deployments/robinhood-punk-agent-account.json" with { type: "json" };
import { defaultAskIntent } from "../broker/src/v4/collecting-intent.mjs";
import { draftPunkSkillFromConversation } from "../broker/src/v4/punk-skill.mjs";
import { runScheduledPunkAgentWorker } from
  "../netlify/functions/broker-punk-agent-worker.mjs";
import { handleV2AgentAccount } from
  "../netlify/functions/broker-v2-agent-account.mjs";
import { handleV2AgentAccountSetup } from
  "../netlify/functions/broker-v2-agent-account-setup.mjs";
import { handleV2Skill } from "../netlify/functions/broker-v2-skill.mjs";

const ORIGIN = "https://deploy-preview-42.preview.goghpunks.xyz";
const OWNER = "0x1111111111111111111111111111111111111111";
const PUNK_WALLET = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-09-07T12:00:00.000Z");

const undeployed = Object.freeze({ ...structuredClone(deployment), status: "UNDEPLOYED",
  contracts: { GoghPunkAgentAccount: null, GoghPunkAgentAccountRegistry: null },
  configuration: Object.fromEntries(Object.keys(deployment.configuration)
    .map((key) => [key, false])),
  authorization: { deploymentAuthorized: false, automaticSubmissionEnabled: false },
  notes: "Test fixture: no deployed Punk Agent Account contracts or authority.",
});

function setupRequest() {
  return new Request(`${ORIGIN}/api/v2/agent-account/setup`, { method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ owner: OWNER, tokenId: "93", intent: defaultAskIntent({
      punkTokenId: "93", expectedOwner: OWNER, punkWallet: PUNK_WALLET,
    }, NOW) }),
  });
}

function skillRequest(owner = OWNER) {
  const skill = draftPunkSkillFromConversation({
    message: "Teach yourself to inspect links and explain contract risk.",
    punkTokenId: "93", expectedOwner: OWNER, punkWallet: PUNK_WALLET, now: NOW,
  });
  return new Request(`${ORIGIN}/api/v2/skill`, { method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ owner, tokenId: "93", skill }),
  });
}

test("public Punk Agent Account status exposes blockers but never signer secrets", async () => {
  const request = new Request(`${ORIGIN}/api/v2/punks/93/agent-account`);
  const response = await handleV2AgentAccount(request, {
    manifest: undeployed, environment: {}, pool: { async query() { return { rows: [] }; } },
    requireSession: async () => ({ walletAddress: OWNER }),
    readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.readiness.ready, false);
  assert.equal(body.readiness.setupAvailable, false);
  assert.ok(body.readiness.blockers.includes("CONTRACTS_NOT_DEPLOYED"));
  assert.equal(body.signer.configured, false);
  assert.equal(JSON.stringify(body).includes("PRIVATE_KEY"), false);
  assert.equal(body.transactionSubmitted, false);
});

test("Punk Agent Account status rebinds persisted skills to live verified authority", async () => {
  const response = await handleV2AgentAccount(
    new Request(`${ORIGIN}/api/v2/punks/93/agent-account`), {
      manifest: undeployed, environment: {},
      pool: { async query(sql) {
        if (sql.includes("FROM broker_v2_punk_skills")) return { rows: [{
          skill_id: "skill_111111111111111111111111", name: "LINK REVIEW",
          description: "inspect links", capabilities: ["INSPECT_LINKS"],
          configured_by: OWNER, created_at: NOW,
        }] };
        return { rows: [] };
      } },
      requireSession: async () => ({ walletAddress: OWNER }),
      readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET }),
    });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.skills.length, 1);
  assert.equal(body.skills[0].punkWallet, PUNK_WALLET);
  assert.equal(body.skills[0].authority, "READ_ONLY");
  assert.equal(body.skills[0].policyEffect, "NONE");
});

test("owner-confirmed Punk skill is persisted without transaction authority", async () => {
  const queries = [];
  let released = false;
  const database = { async query(sql, parameters = []) {
    queries.push({ sql, parameters });
    if (sql.includes("INSERT INTO broker_v2_punk_skills")) {
      return { rows: [{ skill_id: parameters[0] }] };
    }
    return { rows: [] };
  }, release() { released = true; } };
  const response = await handleV2Skill(skillRequest(), {
    now: NOW, pool: { async connect() { return database; } },
    requireSession: async () => ({ walletAddress: OWNER }),
    readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET,
      blockNumber: "123" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.persisted, true);
  assert.equal(body.skill.state, "ACTIVE");
  assert.equal(body.skill.punkWallet, PUNK_WALLET);
  assert.equal(body.skill.authority, "READ_ONLY");
  assert.equal(body.skill.policyEffect, "NONE");
  assert.equal(body.transactionPrepared, false);
  assert.equal(body.transactionSubmitted, false);
  assert.match(body.ownerConfirmationHash, /^0x[0-9a-f]{64}$/);
  assert.ok(queries.some(({ sql }) => sql === "BEGIN"));
  assert.ok(queries.some(({ sql }) => sql.includes("'SKILL_LEARNED'")));
  assert.ok(queries.some(({ sql }) => sql === "COMMIT"));
  assert.equal(released, true);
});

test("Punk skill persistence rejects a different signed-in wallet before database access", async () => {
  let connected = false;
  let authorityRead = false;
  const response = await handleV2Skill(skillRequest(), {
    now: NOW, pool: { async connect() { connected = true; throw new Error("unexpected"); } },
    requireSession: async () => ({ walletAddress:
      "0x9999999999999999999999999999999999999999" }),
    readAuthority: async () => { authorityRead = true; return {}; },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "NOT_CURRENT_OWNER");
  assert.equal(connected, false);
  assert.equal(authorityRead, false);
});

test("owner setup is fail-closed before verified deployment readiness", async () => {
  let databaseTouched = false;
  const response = await handleV2AgentAccountSetup(setupRequest(), {
    manifest: undeployed, now: NOW, pool: { async connect() {
      databaseTouched = true; throw new Error("must not connect");
    } }, requireSession: async () => ({ walletAddress: OWNER }),
    readAuthority: async () => ({ owner: OWNER, punkWallet: PUNK_WALLET,
      blockNumber: "1" }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "PUNK_AGENT_ACCOUNT_NOT_READY");
  assert.equal(databaseTouched, false);
});

test("scheduled autonomous worker is disabled by default and locked by manifest", async () => {
  const disabled = await runScheduledPunkAgentWorker({ manifest: undeployed,
    environment: {}, pool: {} });
  assert.deepEqual(disabled, { status: "DISABLED", submitted: false });
  const locked = await runScheduledPunkAgentWorker({ manifest: undeployed,
    environment: { PUNK_AGENT_WORKER_ENABLED: "true" }, pool: {} });
  assert.equal(locked.status, "LOCKED");
  assert.equal(locked.submitted, false);
  assert.ok(locked.blockers.includes("AUTOMATIC_SUBMISSION_NOT_AUTHORIZED"));
  const paused = await runScheduledPunkAgentWorker({ manifest: undeployed,
    environment: { PUNK_AGENT_WORKER_ENABLED: "true", PAUSE_BACKGROUND_RPC: "true" }, pool: {} });
  assert.deepEqual(paused, { status: "BACKGROUND_DISABLED", submitted: false,
    reason: "EMERGENCY_PAUSE" });
});
