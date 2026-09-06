export class PostgresV2ExecutionStore {
  constructor(pool) {
    if (!pool || typeof pool.query !== "function") throw new TypeError("execution store pool is invalid");
    this.pool = pool;
  }

  async reserve({ idempotencyKey, intent, strategyVersion, opportunity, strategyHash, accountNonce, owner }) {
    const result = await this.pool.query(`INSERT INTO broker_v2_execution_attempts
      (idempotency_key, chain_id, punk_token_id, punk_account, owner_snapshot,
       opportunity_id, strategy_version, strategy_hash, account_nonce, operating_mode, state)
      VALUES ($1, 4663, $2::numeric, $3, $4, $5, $6, $7, $8::numeric, $9, 'RESERVED')
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING attempt_id, state`,
    [idempotencyKey, intent.punkTokenId, intent.punkWallet, owner,
      opportunity.opportunityId, strategyVersion, strategyHash, accountNonce, intent.operatingMode]);
    if (result.rows[0]) return Object.freeze({ replayed: false,
      attemptId: String(result.rows[0].attempt_id) });
    const existing = await this.pool.query(`SELECT attempt_id, state, transaction_hash,
        rejection_code FROM broker_v2_execution_attempts WHERE idempotency_key = $1`,
    [idempotencyKey]);
    if (!existing.rows[0]) throw new Error("execution reservation disappeared");
    return Object.freeze({ replayed: true, result: Object.freeze({ idempotencyKey,
      attemptId: String(existing.rows[0].attempt_id), status: existing.rows[0].state,
      transactionHash: existing.rows[0].transaction_hash,
      rejectionCode: existing.rows[0].rejection_code, submitted: false,
      productionAuthorized: false }) });
  }

  async transition(idempotencyKey, state, detail = {}) {
    const allowed = new Set(["SIMULATED", "REJECTED", "OWNER_APPROVAL_PENDING"]);
    if (!allowed.has(state)) throw new TypeError("execution store transition is invalid");
    const rejection = state === "REJECTED" ? String(detail.reasons?.[0] ?? "POLICY_REJECTED") : null;
    const result = await this.pool.query(`UPDATE broker_v2_execution_attempts
      SET state = $1, rejection_code = $2, updated_at = NOW()
      WHERE idempotency_key = $3 AND state = $4 RETURNING attempt_id`,
    [state, rejection, idempotencyKey,
      state === "OWNER_APPROVAL_PENDING" ? "SIMULATED" : "RESERVED"]);
    if (!result.rows[0]) throw new Error("execution attempt transition was rejected");
    return Object.freeze({ attemptId: String(result.rows[0].attempt_id), state });
  }
}
