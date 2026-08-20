import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../../broker/src/config.mjs";

function pool() {
  return getDatabase().pool;
}

function boundedInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function positiveInteger(value, name, maximum) {
  return boundedInteger(value, name, 1, maximum);
}

function safeErrorCode(value) {
  const code = String(value ?? "OPENSEA_UNKNOWN_ERROR").toUpperCase();
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : "OPENSEA_UNCLASSIFIED_ERROR";
}

export class PostgresMetadataRepository {
  constructor(database = null) {
    this.database = database;
  }

  _query(text, values) {
    return (this.database ?? pool()).query(text, values);
  }

  async pendingCandidates(chainId, { limit }) {
    if (chainId !== ROBINHOOD.chainId) throw new TypeError("Metadata chain must be Robinhood");
    const boundedLimit = positiveInteger(limit, "metadata batch limit", 50);
    const result = await this._query(
      `WITH candidates AS (
         SELECT punk.chain_id, punk.collection_address, punk.token_id,
                0 AS priority, punk.updated_at AS observed_at
           FROM broker_punks AS punk
          WHERE punk.chain_id = $1
            AND punk.collection_address = $2
         UNION ALL
         SELECT acquisition.chain_id, acquisition.nft_collection_address,
                acquisition.nft_token_id, 1 AS priority, acquisition.acquired_at AS observed_at
           FROM broker_acquisitions AS acquisition
          WHERE acquisition.chain_id = $1
         UNION ALL
         SELECT opportunity.chain_id, opportunity.collection_address,
                opportunity.token_id, 2 AS priority, opportunity.discovered_at AS observed_at
           FROM broker_opportunities AS opportunity
          WHERE opportunity.chain_id = $1
            AND opportunity.canonical = TRUE
            AND opportunity.scoutable = TRUE
       ), ranked AS (
         SELECT chain_id, collection_address, token_id, priority, observed_at,
                ROW_NUMBER() OVER (
                  PARTITION BY chain_id, collection_address, token_id
                  ORDER BY priority, observed_at DESC
                ) AS identity_rank
           FROM candidates
       )
       SELECT candidate.chain_id, candidate.collection_address,
              candidate.token_id::text, candidate.priority
         FROM ranked AS candidate
         LEFT JOIN broker_nft_metadata AS cached
           ON cached.chain_id = candidate.chain_id
          AND cached.collection_address = candidate.collection_address
          AND cached.token_id = candidate.token_id
        WHERE candidate.identity_rank = 1
          AND (cached.refresh_after IS NULL OR cached.refresh_after <= NOW())
        ORDER BY candidate.priority, candidate.observed_at DESC,
                 candidate.collection_address, candidate.token_id
        LIMIT $3`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, boundedLimit],
    );
    return result.rows.map((row) => Object.freeze({
      chainId: Number(row.chain_id),
      collection: row.collection_address,
      tokenId: String(row.token_id),
      priority: Number(row.priority),
    }));
  }

  async save(record, { refreshHours, errorCode = null }) {
    if (record.chainId !== ROBINHOOD.chainId) throw new TypeError("Metadata chain must be Robinhood");
    const boundedRefresh = positiveInteger(refreshHours, "metadata refresh hours", 720);
    const result = await this._query(
      `INSERT INTO broker_nft_metadata
        (chain_id, collection_address, token_id, source, metadata_status,
         name, description, display_image_url, collection_slug, token_standard,
         traits, opensea_url, source_payload_hash, attempt_count, last_error_code,
         fetched_at, refresh_after, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11::jsonb, $12, $13, 1, $14, NOW(),
               NOW() + ($15 * INTERVAL '1 hour'), NOW())
       ON CONFLICT (chain_id, collection_address, token_id) DO UPDATE
         SET source = EXCLUDED.source,
             metadata_status = EXCLUDED.metadata_status,
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             display_image_url = EXCLUDED.display_image_url,
             collection_slug = EXCLUDED.collection_slug,
             token_standard = EXCLUDED.token_standard,
             traits = EXCLUDED.traits,
             opensea_url = EXCLUDED.opensea_url,
             source_payload_hash = EXCLUDED.source_payload_hash,
             attempt_count = broker_nft_metadata.attempt_count + 1,
             last_error_code = EXCLUDED.last_error_code,
             fetched_at = EXCLUDED.fetched_at,
             refresh_after = EXCLUDED.refresh_after,
             updated_at = NOW()
       RETURNING metadata_status, attempt_count, refresh_after`,
      [
        record.chainId,
        record.collection,
        record.tokenId,
        record.source,
        record.status,
        record.name,
        record.description,
        record.displayImageUrl,
        record.collectionSlug,
        record.tokenStandard,
        JSON.stringify(record.traits),
        record.openSeaUrl,
        record.payloadHash,
        record.status === "ERROR" ? safeErrorCode(errorCode) : null,
        boundedRefresh,
      ],
    );
    return result.rows[0];
  }
}

export function metadataConfiguration(environment = process.env) {
  const enabled = environment.BROKER_METADATA_ENABLED ?? "false";
  if (enabled !== "true" && enabled !== "false") {
    throw new TypeError("BROKER_METADATA_ENABLED must be exactly true or false");
  }
  return Object.freeze({
    enabled: enabled === "true",
    batchSize: positiveInteger(environment.BROKER_METADATA_BATCH_SIZE ?? 12, "BROKER_METADATA_BATCH_SIZE", 50),
    availableRefreshHours: positiveInteger(
      environment.BROKER_METADATA_REFRESH_HOURS ?? 24,
      "BROKER_METADATA_REFRESH_HOURS",
      720,
    ),
    notFoundRefreshHours: positiveInteger(
      environment.BROKER_METADATA_NOT_FOUND_REFRESH_HOURS ?? 24,
      "BROKER_METADATA_NOT_FOUND_REFRESH_HOURS",
      720,
    ),
    errorRefreshHours: positiveInteger(
      environment.BROKER_METADATA_ERROR_REFRESH_HOURS ?? 1,
      "BROKER_METADATA_ERROR_REFRESH_HOURS",
      72,
    ),
    timeoutMs: boundedInteger(
      environment.BROKER_METADATA_TIMEOUT_MS ?? 8_000,
      "BROKER_METADATA_TIMEOUT_MS",
      1_000,
      30_000,
    ),
  });
}
