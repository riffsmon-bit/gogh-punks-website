import { getDatabase } from "@netlify/database";
import { projectScoutLog } from "../../../broker/src/indexer/opportunity-projection.mjs";

const INDEXER_LOCK_NAMESPACE = 0x474f4748;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;

function validatedCheckpoint(checkpoint) {
  if (!checkpoint) return null;
  let blockNumber;
  try {
    blockNumber = BigInt(checkpoint.blockNumber);
  } catch {
    throw new TypeError("invalid indexer checkpoint");
  }
  if (blockNumber < 0n || !HASH_PATTERN.test(checkpoint.blockHash ?? "")) {
    throw new TypeError("invalid indexer checkpoint");
  }
  return Object.freeze({ blockNumber: blockNumber.toString(), blockHash: checkpoint.blockHash });
}

function pool() {
  return getDatabase().pool;
}

export class PostgresIndexerRepository {
  constructor(database = null, { clock = () => new Date() } = {}) {
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.database = database;
    this.clock = clock;
  }

  _query(text, values) {
    return (this.database ?? pool()).query(text, values);
  }

  async _transactionClient() {
    if (this.database) return { client: this.database, release: () => {} };
    const client = await pool().connect();
    return { client, release: () => client.release() };
  }

  async withChainLock(chainId, operation) {
    if (typeof operation !== "function") throw new TypeError("operation must be a function");
    const connectionSource = this.database ?? pool();
    if (typeof connectionSource.connect !== "function") {
      throw new TypeError("chain locking requires a database pool");
    }
    const client = await connectionSource.connect();
    let acquired = false;
    try {
      const result = await client.query(
        "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
        [INDEXER_LOCK_NAMESPACE, Number(chainId)],
      );
      acquired = result.rows[0]?.acquired === true;
      if (!acquired) throw new Error("another indexer worker holds the Robinhood chain lock");
      return await operation(new PostgresIndexerRepository(client, { clock: this.clock }));
    } finally {
      if (acquired) {
        await client.query("SELECT pg_advisory_unlock($1::integer, $2::integer)", [
          INDEXER_LOCK_NAMESPACE,
          Number(chainId),
        ]);
      }
      client.release();
    }
  }

  async checkpoint(chainId, stream) {
    const result = await this._query(
      `SELECT block_number, block_hash
         FROM broker_indexer_checkpoints
        WHERE chain_id = $1 AND stream = $2`,
      [chainId, stream],
    );
    const row = result.rows[0];
    return row
      ? { blockNumber: String(row.block_number), blockHash: row.block_hash }
      : null;
  }

  async insertLogs(chainId, stream, records, { checkpoint = null } = {}) {
    if (!Array.isArray(records)) throw new TypeError("records must be an array");
    const safeCheckpoint = validatedCheckpoint(checkpoint);
    if (records.length === 0 && !safeCheckpoint) return 0;
    const { client, release } = await this._transactionClient();
    let inserted = 0;
    const observedAt = this.clock();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        const result = await client.query(
          `INSERT INTO broker_indexed_logs
            (id, chain_id, stream, block_number, block_hash, transaction_hash,
             log_index, address, topics, data, block_timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
                   TO_TIMESTAMP($11::numeric))
           ON CONFLICT DO NOTHING`,
          [
            record.id,
            chainId,
            stream,
            record.blockNumber,
            record.blockHash,
            record.transactionHash,
            Number(BigInt(record.logIndex)),
            record.address,
            JSON.stringify(record.topics),
            record.data,
            record.blockTimestamp,
          ],
        );
        inserted += result.rowCount;

        const projection = projectScoutLog({ chainId, stream, record, observedAt });
        if (projection) {
          await client.query(
            `INSERT INTO broker_collections
              (chain_id, collection_address, standard, source_verified, evidence,
               first_seen_block)
             VALUES ($1, $2, $3, FALSE, $4::jsonb, $5)
             ON CONFLICT (chain_id, collection_address) DO UPDATE
               SET standard = CASE
                     WHEN broker_collections.standard IS NULL
                       OR broker_collections.standard = 'UNKNOWN'
                     THEN EXCLUDED.standard
                     ELSE broker_collections.standard
                   END,
                   evidence = broker_collections.evidence || EXCLUDED.evidence,
                   first_seen_block = LEAST(
                     COALESCE(broker_collections.first_seen_block, EXCLUDED.first_seen_block),
                     EXCLUDED.first_seen_block
                   )`,
            [
              projection.collection.chainId,
              projection.collection.address,
              projection.collection.standard,
              JSON.stringify(projection.collection.evidence),
              projection.collection.firstSeenBlock,
            ],
          );
          const opportunity = projection.opportunity;
          await client.query(
            `INSERT INTO broker_opportunities
              (id, chain_id, collection_address, token_id, source, opportunity_type,
               creator_address, marketplace_address, currency_address, expected_price,
               maximum_price, supply, metadata, scores, risk_label, confidence,
               scoutable, autonomous_execution_eligible, discovered_at,
               source_block_number, source_block_hash, source_transaction_hash,
               source_log_index, canonical, source_block_timestamp)
             VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
               $13::jsonb, $14::jsonb, $15, $16, $17, $18, $19, $20, $21, $22,
               $23, $24, $25)
             ON CONFLICT (id) DO UPDATE
               SET metadata = (broker_opportunities.metadata - 'reorged') || EXCLUDED.metadata,
                   scores = EXCLUDED.scores,
                   risk_label = EXCLUDED.risk_label,
                   confidence = EXCLUDED.confidence,
                   scoutable = TRUE,
                   autonomous_execution_eligible = FALSE,
                   discovered_at = LEAST(
                     broker_opportunities.discovered_at,
                     EXCLUDED.discovered_at
                   ),
                   source_block_number = EXCLUDED.source_block_number,
                   source_block_hash = EXCLUDED.source_block_hash,
                   source_block_timestamp = EXCLUDED.source_block_timestamp,
                   source_transaction_hash = EXCLUDED.source_transaction_hash,
                   source_log_index = EXCLUDED.source_log_index,
                   canonical = TRUE
             WHERE broker_opportunities.chain_id = EXCLUDED.chain_id
               AND broker_opportunities.source = EXCLUDED.source`,
            [
              opportunity.id,
              opportunity.chainId,
              opportunity.collection,
              opportunity.tokenId,
              opportunity.source,
              opportunity.opportunityType,
              opportunity.creator,
              opportunity.marketplace,
              opportunity.currency,
              opportunity.expectedPrice,
              opportunity.maximumPrice,
              JSON.stringify(opportunity.supply),
              JSON.stringify(opportunity.metadata),
              JSON.stringify(opportunity.scores),
              opportunity.riskLabel,
              opportunity.confidence,
              opportunity.scoutable,
              opportunity.autonomousExecutionEligible,
              opportunity.discoveredAt,
              opportunity.sourceBlockNumber,
              opportunity.sourceBlockHash,
              opportunity.sourceTransactionHash,
              opportunity.sourceLogIndex,
              opportunity.canonical,
              opportunity.sourceBlockTimestamp,
            ],
          );
        }
      }
      if (safeCheckpoint) {
        await client.query(
          `INSERT INTO broker_indexer_checkpoints
            (chain_id, stream, block_number, block_hash, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (chain_id, stream) DO UPDATE
             SET block_number = EXCLUDED.block_number,
                 block_hash = EXCLUDED.block_hash,
                 updated_at = NOW()
           WHERE broker_indexer_checkpoints.block_number <= EXCLUDED.block_number`,
          [chainId, stream, safeCheckpoint.blockNumber, safeCheckpoint.blockHash],
        );
      }
      await client.query("COMMIT");
      return inserted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }

  async saveCheckpoint(chainId, stream, checkpoint) {
    const safeCheckpoint = validatedCheckpoint(checkpoint);
    if (!safeCheckpoint) throw new TypeError("invalid indexer checkpoint");
    await this._query(
      `INSERT INTO broker_indexer_checkpoints
        (chain_id, stream, block_number, block_hash, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (chain_id, stream) DO UPDATE
         SET block_number = EXCLUDED.block_number,
             block_hash = EXCLUDED.block_hash,
             updated_at = NOW()
       WHERE broker_indexer_checkpoints.block_number <= EXCLUDED.block_number`,
      [chainId, stream, safeCheckpoint.blockNumber, safeCheckpoint.blockHash],
    );
  }

  async rewind(chainId, _stream, fromBlock) {
    const { client, release } = await this._transactionClient();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM broker_acquisitions
          WHERE chain_id = $1 AND block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await client.query(
        `DELETE FROM broker_adapter_snapshots
          WHERE chain_id = $1 AND observed_block >= $2`,
        [chainId, fromBlock.toString()],
      );
      await client.query(
        `DELETE FROM broker_collection_signal_snapshots
          WHERE chain_id = $1
            AND (
              analysis_block_number >= $2
              OR source_max_block >= $2
            )`,
        [chainId, fromBlock.toString()],
      );
      await client.query(
        `UPDATE broker_collections
            SET source_verified = FALSE,
                risk_label = 'UNKNOWN',
                risk_score = NULL,
                evidence = evidence || jsonb_build_object('reorged', TRUE),
                analyzed_at = NULL,
                analysis_attempted_at = NULL,
                analysis_failure = jsonb_build_object('reorged', TRUE),
                analysis_block_number = NULL,
                analysis_block_hash = NULL
          WHERE chain_id = $1 AND analysis_block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await client.query(
        `UPDATE broker_proposals AS proposal
            SET status = 'CANCELLED', updated_at = NOW()
           FROM broker_recommendations AS recommendation
           JOIN broker_opportunities AS opportunity
             ON opportunity.id = recommendation.opportunity_id
          WHERE proposal.recommendation_id = recommendation.id
            AND opportunity.chain_id = $1
            AND opportunity.source_block_number >= $2
            AND proposal.status IN ('PENDING', 'APPROVED')`,
        [chainId, fromBlock.toString()],
      );
      await client.query(
        `UPDATE broker_opportunities
            SET canonical = FALSE,
                scoutable = FALSE,
                autonomous_execution_eligible = FALSE,
                metadata = metadata || jsonb_build_object('reorged', TRUE)
          WHERE chain_id = $1 AND source_block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await client.query(
        `DELETE FROM broker_indexed_logs
          WHERE chain_id = $1 AND block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await client.query(
        `DELETE FROM broker_indexer_checkpoints
          WHERE chain_id = $1`,
        [chainId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
}
