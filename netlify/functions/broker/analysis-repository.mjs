import { getDatabase } from "@netlify/database";
import { ROBINHOOD, normalizeAddress } from "../../../broker/src/config.mjs";

const ANALYSIS_LOCK_NAMESPACE = 0x414e4c59;
const RISK_LABELS = new Set(["LOWER_RISK", "MEDIUM_RISK", "HIGHER_RISK", "UNKNOWN"]);
const STANDARDS = new Set(["ERC721", "ERC1155", "UNKNOWN"]);
const PROXY_STATUSES = new Set(["DIRECT", "PROXY", "UNKNOWN"]);
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const ANALYSIS_STATUSES = new Set([
  "ANALYZED",
  "HEURISTIC",
  "OBSERVED_ACTIVITY",
  "UNAVAILABLE",
]);

function pool() {
  return getDatabase().pool;
}

function boundedInteger(value, field, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${field} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export class PostgresCollectionAnalysisRepository {
  constructor(database = null) {
    this.database = database;
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
    if (Number(chainId) !== ROBINHOOD.chainId) throw new TypeError("analysis chain mismatch");
    if (typeof operation !== "function") throw new TypeError("operation must be a function");
    const connectionSource = this.database ?? pool();
    if (typeof connectionSource.connect !== "function") {
      throw new TypeError("analysis locking requires a database pool");
    }
    const client = await connectionSource.connect();
    let acquired = false;
    try {
      const result = await client.query(
        "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
        [ANALYSIS_LOCK_NAMESPACE, Number(chainId)],
      );
      acquired = result.rows[0]?.acquired === true;
      if (!acquired) throw new Error("another collection analyzer holds the Robinhood lock");
      return await operation(new PostgresCollectionAnalysisRepository(client));
    } finally {
      if (acquired) {
        await client.query("SELECT pg_advisory_unlock($1::integer, $2::integer)", [
          ANALYSIS_LOCK_NAMESPACE,
          Number(chainId),
        ]);
      }
      client.release();
    }
  }

  async pendingCollections(chainId, { limit = 10, retryHours = 24 } = {}) {
    if (Number(chainId) !== ROBINHOOD.chainId) throw new TypeError("analysis chain mismatch");
    const safeLimit = boundedInteger(limit, "limit", 1, 100);
    const safeRetryHours = boundedInteger(retryHours, "retryHours", 1, 720);
    const result = await this._query(
      `SELECT collection.chain_id, collection.collection_address, collection.standard,
              collection.first_seen_block, collection.analyzed_at
         FROM broker_collections AS collection
        WHERE collection.chain_id = $1
          AND EXISTS (
            SELECT 1
              FROM broker_opportunities AS opportunity
             WHERE opportunity.chain_id = collection.chain_id
               AND opportunity.collection_address = collection.collection_address
               AND opportunity.canonical = TRUE
               AND opportunity.scoutable = TRUE
          )
          AND COALESCE(
                collection.analysis_attempted_at,
                collection.analyzed_at,
                '-infinity'::timestamptz
              ) < NOW() - ($2::integer * INTERVAL '1 hour')
        ORDER BY collection.analysis_attempted_at ASC NULLS FIRST,
                 collection.first_seen_block ASC NULLS LAST,
                 collection.collection_address
        LIMIT $3`,
      [chainId, safeRetryHours, safeLimit],
    );
    return result.rows.map((row) => Object.freeze({
      chainId: Number(row.chain_id),
      address: normalizeAddress(row.collection_address),
      standard: row.standard ?? "UNKNOWN",
      firstSeenBlock: row.first_seen_block === null ? null : String(row.first_seen_block),
      analyzedAt: row.analyzed_at ? new Date(row.analyzed_at).toISOString() : null,
    }));
  }

  async collectionActivity(chainId, address, { limit = 200 } = {}) {
    if (Number(chainId) !== ROBINHOOD.chainId) throw new TypeError("analysis chain mismatch");
    const collection = normalizeAddress(address, "collection address");
    const safeLimit = boundedInteger(limit, "activity limit", 1, 500);
    const result = await this._query(
      `SELECT token_id, source_block_number, source_block_hash,
              source_block_timestamp, metadata
         FROM broker_opportunities
        WHERE chain_id = $1
          AND collection_address = $2
          AND source = 'ROBINHOOD_SEAPORT_ACTIVITY'
          AND canonical = TRUE
          AND scoutable = TRUE
          AND source_block_timestamp IS NOT NULL
        ORDER BY source_block_timestamp DESC, source_block_number DESC,
                 source_log_index DESC
        LIMIT $3`,
      [chainId, collection, safeLimit + 1],
    );
    const truncated = result.rows.length > safeLimit;
    const rows = result.rows.slice(0, safeLimit);
    const tokenIds = [...new Set(rows.map((row) => String(row.token_id)))].slice(0, 32);
    return Object.freeze({
      rows: Object.freeze(rows),
      tokenIds: Object.freeze(tokenIds),
      truncated,
    });
  }

  async saveAnalysis(analysis) {
    if (Number(analysis?.chainId) !== ROBINHOOD.chainId) {
      throw new TypeError("analysis chain mismatch");
    }
    const address = normalizeAddress(analysis.address, "analysis.address");
    if (!STANDARDS.has(analysis.standard)) throw new TypeError("invalid analysis standard");
    if (!PROXY_STATUSES.has(analysis.proxyStatus)) throw new TypeError("invalid proxy status");
    if (!RISK_LABELS.has(analysis.riskLabel)) throw new TypeError("invalid risk label");
    if (typeof analysis.sourceVerified !== "boolean") {
      throw new TypeError("sourceVerified must be boolean");
    }
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(analysis.analyzerVersion ?? "")) {
      throw new TypeError("invalid analyzer version");
    }
    const riskScore = Number(analysis.riskScore);
    const riskConfidence = Number(analysis.riskConfidence);
    if (![riskScore, riskConfidence].every((value) =>
      Number.isFinite(value) && value >= 0 && value <= 100)) {
      throw new TypeError("analysis scores must be between 0 and 100");
    }
    if (!HASH_PATTERN.test(analysis.observedBlockHash ?? "")) {
      throw new TypeError("analysis observed block hash is invalid");
    }
    let observedBlock;
    let observedBlockTimestamp;
    try {
      observedBlock = BigInt(analysis.observedBlock);
      observedBlockTimestamp = BigInt(analysis.observedBlockTimestamp);
    } catch {
      throw new TypeError("analysis block provenance is invalid");
    }
    if (observedBlock < 0n) throw new TypeError("analysis observed block is invalid");
    if (observedBlockTimestamp < 0n) {
      throw new TypeError("analysis observed block timestamp is invalid");
    }
    const optionalBlock = (value, field) => {
      if (value === null || value === undefined) return null;
      const parsed = BigInt(value);
      if (parsed < 0n) throw new TypeError(`${field} is invalid`);
      return parsed.toString();
    };
    const sourceMinBlock = optionalBlock(analysis.sourceMinBlock, "source minimum block");
    const sourceMaxBlock = optionalBlock(analysis.sourceMaxBlock, "source maximum block");
    if (
      (sourceMinBlock === null) !== (sourceMaxBlock === null)
      || (sourceMinBlock !== null && BigInt(sourceMinBlock) > BigInt(sourceMaxBlock))
      || (sourceMaxBlock !== null && BigInt(sourceMaxBlock) > observedBlock)
    ) throw new TypeError("analysis source block range is invalid");
    const collectionName = typeof analysis.identity?.name === "string"
      ? analysis.identity.name.slice(0, 160)
      : null;
    const collectionSymbol = typeof analysis.identity?.symbol === "string"
      ? analysis.identity.symbol.slice(0, 32)
      : null;
    const patch = analysis.opportunityPatch ?? {};
    for (const [field, value] of [
      ["artScore", patch.artScore],
      ["artConfidence", patch.artConfidence],
      ["marketScore", patch.marketScore],
      ["marketConfidence", patch.marketConfidence],
    ]) {
      if (value !== null && value !== undefined) {
        const score = Number(value);
        if (!Number.isFinite(score) || score < 0 || score > 100) {
          throw new TypeError(`${field} must be between 0 and 100`);
        }
      }
    }
    for (const field of ["artStatus", "marketStatus", "liquidityStatus"]) {
      if (!ANALYSIS_STATUSES.has(patch[field] ?? "UNAVAILABLE")) {
        throw new TypeError(`${field} is invalid`);
      }
    }

    const { client, release } = await this._transactionClient();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO broker_collection_signal_snapshots
          (chain_id, collection_address, analysis_block_number, analysis_block_hash,
           analysis_block_timestamp, analyzer_version, source_min_block,
           source_max_block, signals, captured_at)
         VALUES ($1, $2, $3, $4, TO_TIMESTAMP($5::numeric), $6, $7, $8,
                 $9::jsonb, $10)
         ON CONFLICT
           (chain_id, collection_address, analysis_block_number, analyzer_version)
         DO UPDATE SET
           analysis_block_timestamp = EXCLUDED.analysis_block_timestamp,
           source_min_block = EXCLUDED.source_min_block,
           source_max_block = EXCLUDED.source_max_block,
           signals = EXCLUDED.signals,
           captured_at = EXCLUDED.captured_at`,
        [
          analysis.chainId,
          address,
          observedBlock.toString(),
          analysis.observedBlockHash,
          observedBlockTimestamp.toString(),
          analysis.analyzerVersion,
          sourceMinBlock,
          sourceMaxBlock,
          JSON.stringify(analysis.evidence),
          analysis.analyzedAt,
        ],
      );
      const collectionResult = await client.query(
        `UPDATE broker_collections
            SET standard = $3,
                source_verified = $4,
                proxy_status = $5,
                risk_label = $6,
                risk_score = $7,
                evidence = $8::jsonb,
                analyzed_at = $9,
                analysis_block_number = $10,
                analysis_block_hash = $11,
                analysis_attempted_at = NOW(),
                analysis_failure = '{}'::jsonb,
                name = COALESCE($12, name),
                symbol = COALESCE($13, symbol)
          WHERE chain_id = $1 AND collection_address = $2`,
        [
          analysis.chainId,
          address,
          analysis.standard,
          analysis.sourceVerified,
          analysis.proxyStatus,
          analysis.riskLabel,
          riskScore,
          JSON.stringify(analysis.evidence),
          analysis.analyzedAt,
          observedBlock.toString(),
          analysis.observedBlockHash,
          collectionName,
          collectionSymbol,
        ],
      );
      if (collectionResult.rowCount !== 1) throw new Error("collection analysis target missing");
      const contractSummary = {
        analyzerVersion: analysis.analyzerVersion,
        observedBlock: observedBlock.toString(),
        observedBlockHash: analysis.observedBlockHash,
        observedBlockTimestamp: observedBlockTimestamp.toString(),
        riskConfidence,
        evidenceScope: "broker_collections",
        recommendation: "RESEARCH",
        autonomousExecutionEligible: false,
      };
      const scorePatch = {
        contractRiskScore: riskScore,
        contractRiskConfidence: riskConfidence,
      };
      if (patch.artScore !== null && patch.artScore !== undefined) {
        scorePatch.artScore = Number(patch.artScore);
        scorePatch.artConfidence = Number(patch.artConfidence ?? 0);
      }
      if (patch.marketScore !== null && patch.marketScore !== undefined) {
        scorePatch.marketScore = Number(patch.marketScore);
        scorePatch.marketConfidence = Number(patch.marketConfidence ?? 0);
      }
      const analysisStatus = {
        contract: "ANALYZED",
        art: patch.artStatus ?? "UNAVAILABLE",
        market: patch.marketStatus ?? "UNAVAILABLE",
        liquidity: patch.liquidityStatus ?? "UNAVAILABLE",
      };
      const publicSignals = {
        analyzerVersion: analysis.analyzerVersion,
        observedBlock: observedBlock.toString(),
        observedBlockHash: analysis.observedBlockHash,
        observedBlockTimestamp: observedBlockTimestamp.toString(),
        identity: {
          status: analysis.identity?.status ?? "UNAVAILABLE",
          name: collectionName,
          symbol: collectionSymbol,
          caveat: "Contract-returned labels do not verify authorship.",
        },
        metadata: {
          status: analysis.evidence?.nft?.metadata?.status ?? "UNAVAILABLE",
          tokenId: analysis.evidence?.nft?.metadata?.tokenId ?? null,
          scheme: analysis.evidence?.nft?.metadata?.scheme ?? null,
          metadataHash: analysis.evidence?.nft?.metadata?.metadataHash ?? null,
        },
        art: {
          status: analysisStatus.art,
          score: patch.artScore ?? null,
          confidence: patch.artConfidence ?? 0,
          dimensions: analysis.art?.dimensions ?? {},
          caveat: analysis.art?.caveat ?? "No art evidence available.",
        },
        market: {
          status: analysisStatus.market,
          score: patch.marketScore ?? null,
          confidence: patch.marketConfidence ?? 0,
          sales: analysis.market?.sales ?? {},
          participants: analysis.market?.participants ?? {},
          ownerSample: analysis.market?.ownerSample ?? {},
          volumes30dByCurrency: analysis.market?.volumes30dByCurrency ?? {},
          caveats: analysis.market?.caveats ?? [],
        },
        liquidity: {
          status: analysisStatus.liquidity,
          score: null,
          caveat: "Completed sales do not establish executable listing or bid depth.",
        },
        executionEligible: false,
      };
      const opportunityResult = await client.query(
        `UPDATE broker_opportunities
            SET scores = (
                  COALESCE(scores, '{}'::jsonb)
                    - 'artScore'
                    - 'artConfidence'
                    - 'marketScore'
                    - 'marketConfidence'
                    - 'liquidityScore'
                ) || $3::jsonb,
                metadata = metadata || jsonb_build_object(
                  'contractAnalysis',
                  $4::jsonb,
                  'collectionSignals',
                  $5::jsonb,
                  'analysisStatus',
                  COALESCE(metadata->'analysisStatus', '{}'::jsonb)
                    || $6::jsonb
                ),
                risk_label = $7,
                autonomous_execution_eligible = FALSE
          WHERE chain_id = $1
            AND collection_address = $2
            AND canonical = TRUE`,
        [
          analysis.chainId,
          address,
          JSON.stringify(scorePatch),
          JSON.stringify(contractSummary),
          JSON.stringify(publicSignals),
          JSON.stringify(analysisStatus),
          analysis.riskLabel,
        ],
      );
      await client.query("COMMIT");
      return Object.freeze({ opportunitiesUpdated: opportunityResult.rowCount });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }

  async recordFailure(chainId, address, error) {
    if (Number(chainId) !== ROBINHOOD.chainId) throw new TypeError("analysis chain mismatch");
    await this._query(
      `UPDATE broker_collections
          SET analysis_attempted_at = NOW(),
              analysis_failure = $3::jsonb
        WHERE chain_id = $1 AND collection_address = $2`,
      [
        chainId,
        normalizeAddress(address),
        JSON.stringify({ failureType: error?.name ?? "Error" }),
      ],
    );
  }
}
