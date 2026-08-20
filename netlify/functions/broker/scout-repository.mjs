import { getDatabase } from "@netlify/database";
import { ROBINHOOD, normalizeAddress } from "../../../broker/src/config.mjs";

function pool() {
  return getDatabase().pool;
}

export class PostgresScoutRepository {
  constructor(database = null) {
    this.database = database;
  }

  _query(text, values) {
    return (this.database ?? pool()).query(text, values);
  }

  async upsertPunk({ tokenId, owner, ownerBlock, personaKey }) {
    const result = await this._query(
      `INSERT INTO broker_punks
        (chain_id, collection_address, token_id, owner_snapshot,
         owner_snapshot_block, persona_key, indexed_through_block, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $5, NOW())
       ON CONFLICT (chain_id, collection_address, token_id) DO UPDATE
         SET owner_snapshot = EXCLUDED.owner_snapshot,
             owner_snapshot_block = EXCLUDED.owner_snapshot_block,
             persona_key = EXCLUDED.persona_key,
             indexed_through_block = EXCLUDED.indexed_through_block,
             updated_at = NOW()
       RETURNING chain_id, collection_address, token_id, account_address,
                 owner_snapshot, owner_snapshot_block, persona_key`,
      [
        ROBINHOOD.chainId,
        ROBINHOOD.canonicalCollection,
        BigInt(tokenId).toString(),
        normalizeAddress(owner, "Scout owner"),
        BigInt(ownerBlock).toString(),
        personaKey,
      ],
    );
    return result.rows[0];
  }

  async analyzedOpportunities(limit) {
    const result = await this._query(
      `SELECT id, chain_id, collection_address, token_id, source, opportunity_type,
              creator_address, marketplace_address, currency_address, expected_price,
              maximum_price, metadata, scores, risk_label, confidence, discovered_at,
              source_block_number, source_transaction_hash
         FROM broker_opportunities
        WHERE chain_id = $1
          AND canonical = TRUE
          AND scoutable = TRUE
          AND metadata ? 'collectionSignals'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY source_block_timestamp DESC NULLS LAST, discovered_at DESC, id
        LIMIT $2`,
      [ROBINHOOD.chainId, limit],
    );
    return result.rows;
  }

  async latestArtMandate({ tokenId, owner }) {
    const result = await this._query(
      `SELECT chain_id, collection_address, token_id, version, mode,
              economic_settings, risk_settings, artistic_preferences,
              marketplace_permissions, configured_by, onchain_policy_version
         FROM broker_art_mandates
        WHERE chain_id = $1
          AND collection_address = $2
          AND token_id = $3
          AND configured_by = $4
        ORDER BY version DESC
        LIMIT 1`,
      [
        ROBINHOOD.chainId,
        ROBINHOOD.canonicalCollection,
        BigInt(tokenId).toString(),
        normalizeAddress(owner, "Scout owner"),
      ],
    );
    return result.rows[0] ?? null;
  }

  async saveRecommendation(record) {
    const connectionSource = this.database ?? pool();
    const client = typeof connectionSource.connect === "function"
      ? await connectionSource.connect()
      : connectionSource;
    const release = typeof client.release === "function" ? () => client.release() : () => {};
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO broker_recommendations
          (id, opportunity_id, punk_chain_id, punk_collection_address,
           punk_token_id, recommendation, scores, explanation, reasoning_hash,
           agent_version_hash, policy_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE
           SET recommendation = EXCLUDED.recommendation,
               scores = EXCLUDED.scores,
               explanation = EXCLUDED.explanation,
               reasoning_hash = EXCLUDED.reasoning_hash,
               agent_version_hash = EXCLUDED.agent_version_hash,
               policy_version = EXCLUDED.policy_version`,
        [
          record.id,
          record.opportunityId,
          ROBINHOOD.chainId,
          ROBINHOOD.canonicalCollection,
          record.tokenId,
          record.recommendation,
          JSON.stringify(record.scores),
          record.explanation,
          record.reasoningHash,
          record.agentVersionHash,
          record.policyVersion,
        ],
      );
      await client.query(
        `INSERT INTO broker_decision_logs
          (id, punk_chain_id, punk_collection_address, punk_token_id,
           event_type, opportunity_id, recommendation_id, public_detail,
           reasoning_hash, occurred_at)
         VALUES ($1, $2, $3, $4, 'SCOUT_RECOMMENDATION', $5, $6, $7::jsonb, $8, NOW())
         ON CONFLICT (id) DO UPDATE
           SET event_type = EXCLUDED.event_type,
               public_detail = EXCLUDED.public_detail,
               reasoning_hash = EXCLUDED.reasoning_hash`,
        [
          record.decisionId,
          ROBINHOOD.chainId,
          ROBINHOOD.canonicalCollection,
          record.tokenId,
          record.opportunityId,
          record.id,
          JSON.stringify(record.publicDetail),
          record.reasoningHash,
        ],
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
