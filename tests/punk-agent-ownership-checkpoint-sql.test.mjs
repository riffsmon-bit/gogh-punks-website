import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const SESSION = "11111111-1111-4111-8111-111111111111";
const hash = digit => `0x${digit.repeat(64)}`;

async function database() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE broker_v2_agent_sessions (
    session_id UUID PRIMARY KEY,
    authorization_transaction_hash CHAR(66),
    session_generation BIGINT NOT NULL
  );`);
  await db.query(`INSERT INTO broker_v2_agent_sessions
    (session_id, authorization_transaction_hash, session_generation)
    VALUES ($1, $2, 7)`, [SESSION, hash("a")]);
  const migration = await readFile(new URL(
    "../netlify/database/migrations/20261002010000_add_punk_agent_ownership_checkpoints.sql",
    import.meta.url), "utf8");
  await db.exec(migration);
  return db;
}

test("ownership checkpoint migration enforces immutable binding and monotonic blocks", async () => {
  const db = await database();
  try {
    await db.query(`INSERT INTO broker_v2_agent_ownership_checkpoints
      (session_id, authorization_transaction_hash, session_generation,
       verified_block_number, verified_block_hash)
      VALUES ($1, $2, 7, 100, $3)`, [SESSION, hash("a"), hash("b")]);
    await db.query(`UPDATE broker_v2_agent_ownership_checkpoints
      SET verified_block_number = 101, verified_block_hash = $2 WHERE session_id = $1`,
    [SESSION, hash("c")]);
    const row = (await db.query(`SELECT verified_block_number::text, verified_block_hash
      FROM broker_v2_agent_ownership_checkpoints WHERE session_id = $1`, [SESSION])).rows[0];
    assert.deepEqual(row, { verified_block_number: "101", verified_block_hash: hash("c") });
    await assert.rejects(db.query(`UPDATE broker_v2_agent_ownership_checkpoints
      SET verified_block_number = 100 WHERE session_id = $1`, [SESSION]),
    /OWNERSHIP_CHECKPOINT_ROLLBACK_FORBIDDEN/);
    await assert.rejects(db.query(`UPDATE broker_v2_agent_ownership_checkpoints
      SET verified_block_hash = $2 WHERE session_id = $1`, [SESSION, hash("d")]),
    /OWNERSHIP_CHECKPOINT_HASH_CHANGE_FORBIDDEN/);
    await assert.rejects(db.query(`UPDATE broker_v2_agent_ownership_checkpoints
      SET session_generation = 8 WHERE session_id = $1`, [SESSION]),
    /OWNERSHIP_CHECKPOINT_BINDING_IMMUTABLE/);
    await assert.rejects(db.query(`DELETE FROM broker_v2_agent_ownership_checkpoints
      WHERE session_id = $1`, [SESSION]), /OWNERSHIP_CHECKPOINT_DELETE_FORBIDDEN/);
  } finally { await db.close(); }
});

test("ownership checkpoint migration rejects evidence for another authorization", async () => {
  const db = await database();
  try {
    await assert.rejects(db.query(`INSERT INTO broker_v2_agent_ownership_checkpoints
      (session_id, authorization_transaction_hash, session_generation,
       verified_block_number, verified_block_hash)
      VALUES ($1, $2, 7, 100, $3)`, [SESSION, hash("f"), hash("b")]),
    /foreign key constraint/);
  } finally { await db.close(); }
});
