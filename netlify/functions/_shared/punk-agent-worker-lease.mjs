// Transaction pooling cannot retain a session advisory lock on one backend.
// The previous key (4663,8004) is retired after a paused deployment drains old
// invocations. Both paid and free execution share this transaction-scoped key.
export const PUNK_AGENT_WORKER_LOCK = Object.freeze([4663, 8005]);

function lost() {
  return Object.assign(new Error('Worker database lease is no longer held'),
    {code: 'WORKER_LEASE_LOST'});
}

export async function acquirePunkAgentWorkerLease(pool, {now = Date.now} = {}) {
  const connection = await pool.connect();
  const started = now();
  let closed = false, broken = false, identity;
  const onError = () => { broken = true; };
  connection.on?.('error', onError);
  const release = async () => {
    if (closed) return;
    closed = true;
    try { await connection.query('ROLLBACK'); }
    catch { broken = true; }
    finally {
      connection.removeListener?.('error', onError);
      connection.release(broken);
    }
  };
  try {
    await connection.query('BEGIN');
    identity = (await connection.query(`SELECT
      pg_try_advisory_xact_lock($1::integer, $2::integer) AS acquired,
      pg_backend_pid() AS pid, txid_current()::text AS transaction_id,
      set_config('idle_in_transaction_session_timeout', '120s', true),
      set_config('statement_timeout', '10s', true)`,
    PUNK_AGENT_WORKER_LOCK)).rows[0];
    if (identity?.acquired !== true) {
      await release();
      return Object.freeze({acquired: false, release});
    }
  } catch (error) { await release(); throw error; }
  return Object.freeze({acquired: true, release, async assertHeld() {
    // A thawed function must not resume signing after its transaction expired.
    if (closed || broken || now() - started >= 110_000) throw lost();
    let row;
    try {
      row = (await connection.query(`SELECT pg_backend_pid() AS pid,
        txid_current()::text AS transaction_id, EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted
          AND pid = pg_backend_pid() AND classid = $1::oid AND objid = $2::oid
          AND objsubid = 2) AS held`, PUNK_AGENT_WORKER_LOCK)).rows[0];
    } catch { broken = true; throw lost(); }
    if (!row?.held || row.pid !== identity.pid
      || row.transaction_id !== identity.transaction_id) { broken = true; throw lost(); }
  }});
}
