import { canonicalUint } from "./paid-mint-policy.mjs";
import { snapshotExactRecord } from "./strict-record.mjs";

function jobId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{8,160}$/.test(value)) {
    throw new TypeError("job ID is invalid");
  }
  return value;
}

function tokenId(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(value)) {
    throw new TypeError("Punk token ID is invalid");
  }
  return value;
}

function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new TypeError("UTC day is invalid");
  }
  return value;
}

function address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.toLowerCase();
}

function hash(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError("transaction hash is invalid");
  }
  return value.toLowerCase();
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export class PostgresPaidSpendLedger {
  constructor(pool) {
    if (!pool || typeof pool.connect !== "function") throw new TypeError("database pool is invalid");
    this.pool = pool;
  }

  async #transaction(operation) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async reserve(input) {
    input = snapshotExactRecord(input, ["jobId", "punkTokenId", "utcDay", "priceWei",
      "dailyLimitWei", "dailyMintLimit", "mintContract", "collection"], "reservation");
    const id = jobId(input.jobId);
    const punk = tokenId(input.punkTokenId);
    const utcDay = day(input.utcDay);
    const price = canonicalUint(input.priceWei, "price");
    const limit = canonicalUint(input.dailyLimitWei, "daily limit");
    const mintLimit = count(input.dailyMintLimit, "daily mint limit");
    const mintContract = address(input.mintContract, "mint contract");
    const collection = address(input.collection, "collection");
    if (price === 0n) throw new TypeError("price must be positive");
    return this.#transaction(async (client) => {
      const scope = `4663:${punk}:${utcDay}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [scope]);
      const prior = await client.query(
        "SELECT job_id, punk_token_id::text, utc_day::text, amount_wei::text, status, transaction_hash FROM broker_paid_mint_jobs WHERE job_id = $1",
        [id],
      );
      if (prior.rowCount > 0) {
        const row = prior.rows[0];
        if (row.punk_token_id !== punk || row.utc_day !== utcDay
          || row.amount_wei !== price.toString()) throw new Error("JOB_ID_CONFLICT");
        return Object.freeze({ ...row });
      }
      const usage = await client.query(
        `SELECT COALESCE(SUM(amount_wei), 0)::text AS committed_wei,
          COUNT(*)::int AS committed_mints
         FROM broker_paid_mint_jobs
         WHERE chain_id = 4663 AND punk_token_id = $1 AND utc_day = $2
           AND status IN ('RESERVED', 'CONFIRMED')`,
        [punk, utcDay],
      );
      const committed = BigInt(usage.rows[0].committed_wei);
      if (committed > limit || price > limit - committed) throw new Error("DAILY_SPEND_LIMIT");
      if (Number(usage.rows[0].committed_mints) >= mintLimit) throw new Error("DAILY_MINT_LIMIT");
      const inserted = await client.query(
        `INSERT INTO broker_paid_mint_jobs
          (chain_id, punk_token_id, utc_day, job_id, status, amount_wei,
           mint_contract, collection_address)
         VALUES (4663, $1, $2, $3, 'RESERVED', $4, $5, $6)
         RETURNING job_id, punk_token_id::text, utc_day::text, amount_wei::text,
           status, transaction_hash`,
        [punk, utcDay, id, price.toString(), mintContract, collection],
      );
      return Object.freeze({ ...inserted.rows[0] });
    });
  }

  async confirm(reservationJobId, transactionHash, blockNumber, receivedTokenId) {
    const id = jobId(reservationJobId);
    const tx = hash(transactionHash);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 1) {
      throw new TypeError("block number is invalid");
    }
    const received = canonicalUint(receivedTokenId, "received token ID").toString();
    return this.#transaction(async (client) => {
      const result = await client.query(
        `UPDATE broker_paid_mint_jobs SET status = 'CONFIRMED', transaction_hash = $2,
          block_number = $3, received_token_id = $4, updated_at = NOW()
         WHERE job_id = $1 AND status IN ('RESERVED', 'CONFIRMED')
           AND (transaction_hash IS NULL OR transaction_hash = $2)
         RETURNING job_id, status, transaction_hash, block_number,
           received_token_id::text`,
        [id, tx, blockNumber, received],
      );
      if (result.rowCount !== 1) throw new Error("JOB_NOT_CONFIRMABLE");
      return Object.freeze({ ...result.rows[0] });
    });
  }

  async markReorged(reservationJobId, transactionHash) {
    const id = jobId(reservationJobId);
    const tx = hash(transactionHash);
    return this.#transaction(async (client) => {
      const result = await client.query(
        `UPDATE broker_paid_mint_jobs SET status = 'REORGED', updated_at = NOW()
         WHERE job_id = $1 AND transaction_hash = $2 AND status = 'CONFIRMED'
         RETURNING job_id, status, transaction_hash`, [id, tx]);
      if (result.rowCount !== 1) throw new Error("CONFIRMED_JOB_NOT_FOUND");
      return Object.freeze({ ...result.rows[0] });
    });
  }
}
