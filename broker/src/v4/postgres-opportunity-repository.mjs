import { normalizeV2Opportunity } from "./opportunity.mjs";

export class PostgresV2OpportunityRepository {
  constructor(pool) {
    if (!pool || typeof pool.connect !== "function") throw new TypeError("opportunity pool is invalid");
    this.pool = pool;
  }

  async ingest(raw, source) {
    const opportunity = normalizeV2Opportunity(raw);
    if (!source || typeof source !== "object" || Array.isArray(source)
      || typeof source.kind !== "string" || !/^[A-Z0-9_]{2,48}$/.test(source.kind)
      || typeof source.identity !== "string" || !source.identity || source.identity.length > 512) {
      throw new TypeError("opportunity source is invalid");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`INSERT INTO broker_v2_opportunities
        (opportunity_id, dedupe_key, schema_version, chain_id, collection_contract,
         mint_contract, adapter_address, mint_stage, normalized, screening_status,
         simulation_status, risk_score, first_seen_at, updated_at, expires_at)
        VALUES ($1, $2, 2, 4663, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (dedupe_key) DO UPDATE SET normalized = EXCLUDED.normalized,
          screening_status = EXCLUDED.screening_status,
          simulation_status = EXCLUDED.simulation_status, risk_score = EXCLUDED.risk_score,
          updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at
        RETURNING opportunity_id`, [opportunity.opportunityId, opportunity.dedupeKey,
        opportunity.collectionContract, opportunity.mintContract, opportunity.adapter,
        opportunity.mintStage, JSON.stringify(opportunity), opportunity.screeningStatus,
        opportunity.simulationStatus, opportunity.riskScore, opportunity.createdAt,
        opportunity.updatedAt, opportunity.endTime]);
      const opportunityId = result.rows[0].opportunity_id;
      await client.query(`INSERT INTO broker_v2_opportunity_sources
        (opportunity_id, source_kind, source_identity, source_url, evidence, discovered_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (opportunity_id, source_kind, source_identity) DO UPDATE SET
          source_url = EXCLUDED.source_url, evidence = EXCLUDED.evidence,
          discovered_at = LEAST(broker_v2_opportunity_sources.discovered_at, EXCLUDED.discovered_at)`,
      [opportunityId, source.kind, source.identity, source.url ?? null,
        JSON.stringify(source.evidence ?? {}), source.discoveredAt ?? opportunity.createdAt]);
      await client.query("COMMIT");
      return Object.freeze({ ...opportunity, opportunityId });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async analyzeOnce({ opportunityId, inputHash, analyze }) {
    if (typeof opportunityId !== "string" || !/^[a-zA-Z0-9:_-]{8,256}$/.test(opportunityId)
      || typeof inputHash !== "string" || !/^[0-9a-f]{64}$/.test(inputHash)
      || typeof analyze !== "function") throw new TypeError("analysis request is invalid");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [inputHash]);
      const existing = await client.query(`SELECT art_styles, summary, provider, model_registry_key
        FROM broker_v2_opportunity_analysis WHERE input_hash = $1 LIMIT 1`, [inputHash]);
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return Object.freeze({ cacheHit: true, analysis: Object.freeze(existing.rows[0]) });
      }
      const analysis = await analyze();
      if (!analysis || !Array.isArray(analysis.artStyles) || typeof analysis.summary !== "string"
        || typeof analysis.provider !== "string" || typeof analysis.modelRegistryKey !== "string") {
        throw new TypeError("analysis result is invalid");
      }
      const versionResult = await client.query(`SELECT COALESCE(MAX(analysis_version), 0) + 1 AS version
        FROM broker_v2_opportunity_analysis WHERE opportunity_id = $1`, [opportunityId]);
      await client.query(`INSERT INTO broker_v2_opportunity_analysis
        (opportunity_id, analysis_version, art_styles, summary, provider, model_registry_key, input_hash)
        VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`, [opportunityId,
        Number(versionResult.rows[0].version), JSON.stringify(analysis.artStyles), analysis.summary,
        analysis.provider, analysis.modelRegistryKey, inputHash]);
      await client.query("COMMIT");
      return Object.freeze({ cacheHit: false, analysis: Object.freeze({ ...analysis }) });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
