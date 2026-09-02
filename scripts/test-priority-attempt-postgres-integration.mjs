import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.argv.includes("--production-rollback")) {
  throw new Error("Pass --production-rollback to confirm the integration test must roll back.");
}

const connectionString = process.env.SUPABASE_DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (typeof connectionString !== "string" || !/^postgres(?:ql)?:\/\//.test(connectionString)) {
  throw new Error("SUPABASE_DATABASE_URL or SUPABASE_DB_URL is required");
}

const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const OWNER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
const RELEASE = "a".repeat(40);
const hash = (label) => `0x${createHash("sha256").update(`${randomUUID()}:${label}`).digest("hex")}`;

const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 2_000,
  allowExitOnIdle: true,
  application_name: "gogh-priority-attempt-integration-rollback",
});
const client = await pool.connect();
let assertions = 0;
const check = (condition, message) => {
  assertions += 1;
  assert.ok(condition, message);
};

async function fixture({ requestedMints = 3, completedMints = 0, state = "ACTIVE",
  expired = false } = {}) {
  const tokenId = String(800_000 + assertions);
  const depositHash = hash(`deposit:${tokenId}`);
  const sessionId = randomUUID();
  await client.query(
    `INSERT INTO gogh_broker_punk_agent_gas_accounts
       (chain_id, collection_address, punk_token_id, owner_snapshot, credited_wei, spent_wei)
     VALUES (4663, $1, $2::numeric, $3, 1000000, 0)`,
    [COLLECTION, tokenId, OWNER],
  );
  await client.query(
    `INSERT INTO gogh_broker_punk_agent_gas_deposits
       (transaction_hash, chain_id, collection_address, punk_token_id, owner_address,
        agent_address, amount_wei, block_number, confirmed_at)
     VALUES ($1, 4663, $2, $3::numeric, $4, $5, 1000000, 1, NOW() - INTERVAL '1 hour')`,
    [depositHash, COLLECTION, tokenId, OWNER, AGENT],
  );
  await client.query(
    `INSERT INTO gogh_broker_punk_priority_sessions
       (session_id, chain_id, collection_address, punk_token_id, owner_snapshot,
        deposit_transaction_hash, requested_mints, completed_mints, duration_days,
        state, starts_at, expires_at)
     VALUES ($1::uuid, 4663, $2, $3::numeric, $4, $5, $6, $7, 1, $8,
       NOW() - INTERVAL '1 hour',
       CASE WHEN $9 THEN NOW() - INTERVAL '1 second' ELSE NOW() + INTERVAL '1 hour' END)`,
    [sessionId, COLLECTION, tokenId, OWNER, depositHash, requestedMints,
      completedMints, state, expired],
  );
  return { sessionId, tokenId };
}

async function begin(sessionId) {
  return (await client.query(
    "SELECT * FROM gogh_broker_begin_punk_priority_attempt($1::uuid, $2, 6::smallint, 120)",
    [sessionId, RELEASE],
  )).rows[0];
}

async function reserve(attempt, nonce = "1") {
  return (await client.query(
    `SELECT * FROM gogh_broker_reserve_punk_priority_submission(
       $1::uuid, $2::uuid, $3, $4, $5::numeric
     )`,
    [attempt.attempt_id, attempt.lease_token, AGENT, "0x3333333333333333333333333333333333333333",
      nonce],
  )).rows[0];
}

async function note(attempt, transactionHash) {
  return (await client.query(
    "SELECT * FROM gogh_broker_note_punk_priority_submission($1::uuid, $2::uuid, $3)",
    [attempt.attempt_id, attempt.lease_token, transactionHash],
  )).rows[0];
}

async function record(attempt, { status, minted = false, transactionHash = null,
  gasUsed = null, gasPrice = null, gasCost = null, terminalState = null }) {
  return (await client.query(
    `SELECT * FROM gogh_broker_record_punk_priority_attempt_v2(
       $1::uuid, $2::uuid, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9
     )`,
    [attempt.attempt_id, attempt.lease_token, status, minted, transactionHash,
      gasUsed, gasPrice, gasCost, terminalState],
  )).rows[0];
}

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(4663210001)");
  const migration = await readFile(new URL(
    "../supabase/migrations/20260902013000_repair_priority_attempt_reliability.sql",
    import.meta.url,
  ), "utf8");
  await client.query(migration);

  // Historical signature: prove the formerly ambiguous RETURNS TABLE function executes.
  const legacyFixture = await fixture();
  const legacy = (await client.query(
    `SELECT * FROM gogh_broker_record_punk_priority_attempt(
       $1::uuid, 'NO_ELIGIBLE_TARGETS', FALSE, NULL, NULL, NULL, NULL, NULL
     )`,
    [legacyFixture.sessionId],
  )).rows[0];
  check(legacy.completed_mints === 0, "qualified legacy function must preserve mint count");
  check(legacy.requested_mints === 3, "qualified legacy function must preserve request count");

  // Successful mint, gas charge, transaction persistence, completion, and replay.
  const mintFixture = await fixture({ requestedMints: 1 });
  const mintAttempt = await begin(mintFixture.sessionId);
  check(mintAttempt.executable === true, "first attempt must be executable");
  check((await reserve(mintAttempt)).reserved === true, "submission must reserve durably");
  const mintHash = hash("mint");
  check((await note(mintAttempt, mintHash)).noted === true, "transaction hash must persist");
  const mint = await record(mintAttempt, { status: "MINT_CONFIRMED", minted: true,
    transactionHash: mintHash, gasUsed: "100", gasPrice: "6", gasCost: "600" });
  check(mint.completed_mints === 1, "successful mint increments once");
  check(mint.requested_mints === 1, "requested mint count is immutable");
  check(mint.session_state === "COMPLETE", "requested count completes deterministically");
  check(mint.spent_wei === "600", "receipt cost charges exact available gas");
  check(mint.usage_recorded === true, "first receipt creates usage");
  const storedHash = (await client.query(
    "SELECT last_transaction_hash FROM gogh_broker_punk_priority_sessions WHERE session_id=$1",
    [mintFixture.sessionId],
  )).rows[0].last_transaction_hash;
  check(storedHash === mintHash, "session persists transaction hash");
  const replay = await record(mintAttempt, { status: "MINT_CONFIRMED", minted: true,
    transactionHash: mintHash, gasUsed: "100", gasPrice: "6", gasCost: "600" });
  check(replay.completed_mints === 1, "replay cannot double-count a mint");
  check(replay.spent_wei === "600", "replay cannot double-charge gas");
  check(replay.usage_recorded === false && replay.attempt_recorded === false,
    "replay reports no second logical record");
  const afterRecordedFailure = await record(mintAttempt, { status: "GLOBAL_STATE_READ_FAILED" });
  check(afterRecordedFailure.completed_mints === 1,
    "failure after settlement cannot alter completed mint count");

  const hashReuseFixture = await fixture();
  const hashReuseAttempt = await begin(hashReuseFixture.sessionId);
  await reserve(hashReuseAttempt);
  await client.query("SAVEPOINT duplicate_transaction_hash");
  let duplicateHashRejected = false;
  try {
    await note(hashReuseAttempt, mintHash);
  } catch (error) {
    duplicateHashRejected = error?.code === "23505";
    await client.query("ROLLBACK TO SAVEPOINT duplicate_transaction_hash");
  }
  check(duplicateHashRejected,
    "one transaction hash cannot identify a second logical priority attempt");

  // Successful non-mint/no-op and failed automation are independently recordable exactly once.
  const noopFixture = await fixture();
  const noopAttempt = await begin(noopFixture.sessionId);
  const noop = await record(noopAttempt, { status: "NO_ELIGIBLE_TARGETS" });
  check(noop.completed_mints === 0 && noop.attempt_recorded === true,
    "no-op records without a mint");
  const failureFixture = await fixture();
  const failureAttempt = await begin(failureFixture.sessionId);
  const failure = await record(failureAttempt, { status: "GLOBAL_V3_WORKER_BINDING_CLOSED" });
  check(failure.completed_mints === 0 && failure.attempt_recorded === true,
    "automation failure records once without charging");

  // Near-concurrent duplicate claims select one logical attempt and one executor.
  const duplicateFixture = await fixture();
  const firstClaim = await begin(duplicateFixture.sessionId);
  const secondClaim = await begin(duplicateFixture.sessionId);
  check(firstClaim.executable === true && secondClaim.executable === false,
    "duplicate claims permit exactly one executor");
  check(firstClaim.attempt_id === secondClaim.attempt_id,
    "duplicate claims share one durable attempt identity");

  // Expiry at selection and expiry between selection/result both terminate deterministically.
  const expiredFixture = await fixture({ expired: true });
  const expired = await begin(expiredFixture.sessionId);
  check(expired.executable === false && expired.session_state === "EXPIRED",
    "already expired session cannot execute");
  const racingExpiryFixture = await fixture();
  const racingAttempt = await begin(racingExpiryFixture.sessionId);
  await client.query(
    "UPDATE gogh_broker_punk_priority_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE session_id=$1",
    [racingExpiryFixture.sessionId],
  );
  const racingResult = await record(racingAttempt, { status: "NO_ELIGIBLE_TARGETS" });
  check(racingResult.session_state === "EXPIRED",
    "expiry between selection and recording stops the session");

  // A session already terminal/completed never creates an executable attempt.
  const terminalFixture = await fixture({ requestedMints: 1, completedMints: 1,
    state: "COMPLETE" });
  const terminal = await begin(terminalFixture.sessionId);
  check(terminal.executable === false && terminal.session_state === "COMPLETE",
    "terminal completed session cannot execute");

  // A reservation survives retry and prevents a second submission even without a tx hash.
  const reservedFixture = await fixture();
  const reservedAttempt = await begin(reservedFixture.sessionId);
  await reserve(reservedAttempt, "9");
  const reservedRetry = await begin(reservedFixture.sessionId);
  check(reservedRetry.executable === false
    && reservedRetry.reason === "SUBMISSION_RESERVED_AWAITING_RECONCILIATION",
  "crash after reservation blocks duplicate transaction submission");

  const counts = await client.query(
    `SELECT (SELECT COUNT(*) FROM gogh_broker_punk_agent_gas_usage
              WHERE session_id=$1)::integer AS usage_count,
            (SELECT COUNT(*) FROM gogh_broker_punk_priority_attempts
              WHERE session_id=$1)::integer AS attempt_count`,
    [mintFixture.sessionId],
  );
  check(counts.rows[0].usage_count === 1 && counts.rows[0].attempt_count === 1,
    "one result creates one usage row and one attempt row");

  console.log(JSON.stringify({
    postgresIntegration: "PASS",
    assertions,
    transaction: "ROLLED_BACK",
    syntheticOnly: true,
  }));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
}
