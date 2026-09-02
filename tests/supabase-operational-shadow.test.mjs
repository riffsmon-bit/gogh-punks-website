import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  claimSupabasePunkJobs,
  completeSupabasePunkJob,
  enqueueSupabasePunkJobs,
  getPrepaidPunkAgentGasBalance,
  recordPunkPrioritySessionAttempt,
  recordPrepaidPunkAgentGasCredit,
  shadowAutomationV3Run,
  shadowOwnershipProjection,
  supabaseOperationalConfiguration,
} from "../netlify/functions/_shared/supabase-operational-store.mjs";

const RELEASE = "a".repeat(40);
const DATABASE_URL = "postgresql://server-only:secret@db.example.invalid/postgres";

function environment(mode = "SHADOW", extra = {}) {
  return {
    BROKER_SUPABASE_QUEUE_MODE: mode,
    SUPABASE_DATABASE_URL: DATABASE_URL,
    BROKER_AUTOMATION_V3_WORKER_RELEASE: RELEASE,
    ...extra,
  };
}

function recordingDatabase() {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE", values: [] }); },
  };
  return {
    calls,
    async connect() { calls.push({ sql: "CONNECT", values: [] }); return client; },
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
}

function cutoverEnvironment(mode = "CANARY") {
  return environment(mode, {
    BROKER_SUPABASE_QUEUE_CUTOVER_RELEASE: RELEASE,
    BROKER_SUPABASE_QUEUE_CUTOVER_ACK: "I_UNDERSTAND_PER_PUNK_QUEUE_CUTOVER",
  });
}

test("Supabase operational state defaults disabled and cutover requires an exact release ack", () => {
  assert.deepEqual(supabaseOperationalConfiguration({}), {
    mode: "DISABLED", configured: false, shadowWrites: false, drivesExecution: false,
  });
  assert.equal(supabaseOperationalConfiguration(environment()).shadowWrites, true);
  assert.equal(supabaseOperationalConfiguration(environment("ACTIVE")).drivesExecution, false);
  assert.equal(supabaseOperationalConfiguration(environment("ACTIVE", {
    BROKER_SUPABASE_QUEUE_CUTOVER_RELEASE: RELEASE,
    BROKER_SUPABASE_QUEUE_CUTOVER_ACK: "I_UNDERSTAND_PER_PUNK_QUEUE_CUTOVER",
  })).drivesExecution, true);
});

test("disabled shadow writes do not open a database connection", async () => {
  const database = recordingDatabase();
  assert.deepEqual(await shadowAutomationV3Run({}, {
    environment: { BROKER_SUPABASE_QUEUE_MODE: "DISABLED" }, database,
  }), { written: false, reason: "DISABLED" });
  assert.equal(database.calls.length, 0);
});

test("legacy worker results shadow as independent per-Punk jobs and states", async () => {
  const database = recordingDatabase();
  const output = await shadowAutomationV3Run({
    status: "NO_ELIGIBLE_TARGETS",
    submitted: 0,
    diagnostics: {
      scheduledTokenIds: ["93", "94"],
      profileOutcomes: [
        { tokenId: "93", state: "SKIPPED", reason: "NO_ELIGIBLE_TARGETS", account: null },
        { tokenId: "94", state: "ERROR", reason: "PROFILE_STATE_READ_FAILED", account: null },
      ],
    },
  }, {
    environment: environment(), database,
    release: RELEASE,
    jobId: "12345678-1234-1234-1234-123456789abc",
    startedAt: "2026-08-30T12:00:00.000Z",
    completedAt: "2026-08-30T12:00:02.000Z",
  });
  assert.equal(output.written, true);
  assert.equal(output.punks, 2);
  const punkWrites = database.calls.filter(({ sql }) => sql.includes("gogh_broker_punk_jobs"));
  assert.equal(punkWrites.length, 2);
  assert.equal(punkWrites[0].values[2], "93");
  assert.equal(punkWrites[0].values[6], "WAITING");
  assert.equal(punkWrites[1].values[2], "94");
  assert.equal(punkWrites[1].values[6], "ERROR");
  assert.equal(database.calls.at(-2).sql, "COMMIT");
  assert.equal(database.calls.at(-1).sql, "RELEASE");
});

test("canonical ownership snapshots shadow only exact unique rosters", async () => {
  const database = recordingDatabase();
  const output = await shadowOwnershipProjection(
    "0x" + "b".repeat(40), ["93", "1616"], 12345n,
    { environment: environment(), database, rpcSource: "configured-primary" },
  );
  assert.equal(output.written, true);
  assert.equal(output.tokenCount, 2);
  assert.match(database.calls[0].sql, /gogh_broker_ownership_projection/);
  assert.deepEqual(database.calls[0].values[2], ["93", "1616"]);
  await assert.rejects(() => shadowOwnershipProjection(
    "0x" + "b".repeat(40), ["93", "93"], 12345n,
    { environment: environment(), database },
  ), /evidence is invalid/);
});

test("queue claims remain disabled until the exact production cutover acknowledgement", async () => {
  const database = recordingDatabase();
  assert.deepEqual(await claimSupabasePunkJobs("worker:12345678", {
    environment: environment("CANARY"), database,
  }), { claimed: [], reason: "CUTOVER_NOT_ACKNOWLEDGED" });
  assert.equal(database.calls.length, 0);

  database.query = async (sql, values = []) => {
    database.calls.push({ sql, values });
    return { rows: [{ punk_token_id: "93" }] };
  };
  const claimed = await claimSupabasePunkJobs("worker:12345678", {
    environment: cutoverEnvironment(),
    database,
  });
  assert.equal(claimed.claimed.length, 1);
  assert.match(database.calls.at(-1).sql, /gogh_broker_claim_punk_jobs/);
});

test("canary enqueue requires explicit live authorization evidence and is idempotent", async () => {
  const database = recordingDatabase();
  await assert.rejects(() => enqueueSupabasePunkJobs(["93"], {
    environment: cutoverEnvironment(), database,
  }), /authorization evidence/);
  database.query = async (sql, values = []) => {
    database.calls.push({ sql, values });
    return { rows: [{ job_id: "12345678-1234-4234-9234-123456789abc" }] };
  };
  const result = await enqueueSupabasePunkJobs([
    { tokenId: "93", idempotencyKey: "scheduled:window-1:93" },
    { tokenId: "94", idempotencyKey: "scheduled:window-1:94" },
  ], {
    environment: cutoverEnvironment(), database, authorizationVerified: true,
    availableAt: "2026-08-30T12:00:00.000Z",
  });
  assert.equal(result.enqueued, 2);
  assert.equal(database.calls.length, 2);
  assert.match(database.calls[0].sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(database.calls[0].sql, /authorization_status = 'AUTHORIZED'/);
});

test("one leased Punk job completes or retries without mutating another Punk", async () => {
  function leasedDatabase(selectedTokenId) {
    const calls = [];
    const client = {
      async query(sql, values = []) {
        calls.push({ sql, values });
        if (sql.includes("UPDATE gogh_broker_punk_jobs")) {
          return { rows: [{ punk_token_id: selectedTokenId, state:
            values[2] === "SUCCEEDED" ? "SUCCEEDED" : "RETRY", attempts: 1, max_attempts: 5 }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    return { calls, async connect() { return client; } };
  }
  const failed = leasedDatabase("93");
  const retried = await completeSupabasePunkJob(
    "12345678-1234-4234-9234-123456789abc", "worker:canary-1",
    { status: "RETRYABLE_FAILURE", resultCode: "PUNK_RPC_FAILED" },
    { environment: cutoverEnvironment(), database: failed },
  );
  assert.equal(retried.state, "RETRY");
  assert.equal(retried.tokenId, "93");
  const healthy = leasedDatabase("94");
  const completed = await completeSupabasePunkJob(
    "87654321-4321-4321-9234-cba987654321", "worker:canary-1",
    { status: "SUCCEEDED", resultCode: "NO_ELIGIBLE_TARGETS" },
    { environment: cutoverEnvironment(), database: healthy },
  );
  assert.equal(completed.state, "SUCCEEDED");
  assert.equal(completed.tokenId, "94");
  assert.equal(failed.calls.some(({ values }) => values.includes?.("94")), false);
  assert.equal(healthy.calls.some(({ values }) => values.includes?.("93")), false);
});

test("Supabase migration provides RLS and atomic skip-locked per-Punk claims", async () => {
  const sql = await readFile(new URL(
    "../supabase/migrations/20260830210000_create_gogh_broker_operational_shadow.sql",
    import.meta.url,
  ), "utf8");
  for (const table of [
    "gogh_broker_punk_state", "gogh_broker_punk_jobs", "gogh_broker_worker_runs",
    "gogh_broker_agent_activity", "gogh_broker_ownership_projection",
    "gogh_broker_diagnostics",
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(sql, /REVOKE ALL ON FUNCTION/);
  assert.doesNotMatch(sql, /private_key|service_role_key/i);
});

test("Punk-specific prepaid gas migration reserves credit and prioritizes only its Punk", async () => {
  const sql = await readFile(new URL(
    "../supabase/migrations/20260831220000_add_punk_agent_gas_credits.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /gogh_broker_punk_agent_gas_accounts/);
  assert.match(sql, /gogh_broker_punk_agent_gas_deposits/);
  assert.match(sql, /gogh_broker_credit_punk_agent_gas/);
  assert.match(sql, /priority DESC, available_at, created_at, punk_token_id/);
  assert.match(sql, /ON CONFLICT \(transaction_hash\) DO NOTHING/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON FUNCTION gogh_broker_credit_punk_agent_gas/);
});

test("receipt metering migration charges idempotently and stages fixed-owner refunds", async () => {
  const sql = await readFile(new URL(
    "../supabase/migrations/20260901090000_add_priority_gas_usage_refunds.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /gogh_broker_punk_agent_gas_usage/);
  assert.match(sql, /actual_cost_wei = gas_used \* effective_gas_price_wei/);
  assert.match(sql, /ON CONFLICT \(transaction_hash\) DO NOTHING/);
  assert.match(sql, /gogh_broker_punk_agent_gas_refunds/);
  assert.match(sql, /owner_address/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON FUNCTION gogh_broker_record_punk_priority_attempt/);
});

test("additive priority repair qualifies table expressions and reserves before submission", async () => {
  const sql = await readFile(new URL(
    "../supabase/migrations/20260902013000_repair_priority_attempt_reliability.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS gogh_broker_punk_priority_attempts/);
  assert.match(sql, /gogh_broker_reserve_punk_priority_submission/);
  assert.match(sql, /gogh_broker_note_punk_priority_submission/);
  assert.match(sql, /gas_account\.spent_wei \+ selected_charge/);
  assert.match(sql, /priority_session\.completed_mints/);
  assert.match(sql, /priority_session\.requested_mints/);
  assert.match(sql, /priority_session\.expires_at/);
  assert.match(sql, /priority_session\.last_transaction_hash/);
  assert.doesNotMatch(sql, /\b(?:DROP TABLE|TRUNCATE|DELETE FROM)\b/i);
});

test("priority attempt forwards complete receipt gas evidence to one atomic database function", async () => {
  const database = recordingDatabase();
  database.query = async (sql, values = []) => {
    database.calls.push({ sql, values });
    return { rows: [{ punk_token_id: "93", state: "COMPLETE", requested_mints: 1,
      completed_mints: 1, expires_at: "2026-09-07T00:00:00.000Z",
      credited_wei: "500000000000000", spent_wei: "75000000000000",
      available_wei: "425000000000000", usage_recorded: true }] };
  };
  const result = await recordPunkPrioritySessionAttempt(
    { id: "11111111-1111-4111-8111-111111111111",
      leaseToken: "22222222-2222-4222-8222-222222222222" },
    { status: "MINT_CONFIRMED", submitted: 1, transactionHash: "0x" + "a".repeat(64),
      gasUsed: "150000", effectiveGasPriceWei: "500000000",
      transactionGasCostWei: "75000000000000" },
    { environment: environment("SHADOW"), database },
  );
  assert.equal(result.usageRecorded, true);
  assert.equal(result.availableWei, "425000000000000");
  assert.match(database.calls[0].sql, /gogh_broker_record_punk_priority_attempt_v2/);
  assert.deepEqual(database.calls[0].values.slice(5, 8), [
    "150000", "500000000", "75000000000000",
  ]);
});

test("prepaid gas store reads and credits exactly one selected Punk", async () => {
  const database = recordingDatabase();
  database.query = async (sql, values = []) => {
    database.calls.push({ sql, values });
    if (sql.includes("gogh_broker_credit_punk_agent_gas")) {
      return { rows: [{ credited: true, available_wei: "500000000000000",
        job_id: "12345678-1234-1234-1234-123456789abc" }] };
    }
    return { rows: [{ credited_wei: "500000000000000", spent_wei: "0",
      available_wei: "500000000000000", updated_at: "2026-08-31T12:00:00.000Z" }] };
  };
  const selectedEnvironment = environment("SHADOW", {
    BROKER_AUTOMATION_V3_AGENT_ADDRESS: "0x" + "3".repeat(40),
  });
  const credit = await recordPrepaidPunkAgentGasCredit({
    tokenId: "93", owner: "0x" + "1".repeat(40), agent: "0x" + "3".repeat(40),
    amountWei: "500000000000000", transactionHash: "0x" + "a".repeat(64),
    blockNumber: "51000000", confirmedAt: "2026-08-31T12:00:00.000Z",
  }, { environment: selectedEnvironment, database });
  assert.equal(credit.availableWei, "500000000000000");
  assert.equal(database.calls[0].values[1], "93");
  const balance = await getPrepaidPunkAgentGasBalance("93", {
    environment: selectedEnvironment, database,
  });
  assert.equal(balance.availableWei, "500000000000000");
  assert.equal(database.calls[1].values[1], "93");
});
