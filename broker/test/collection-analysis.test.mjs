import test from "node:test";
import assert from "node:assert/strict";
import {
  PostgresCollectionAnalysisRepository,
} from "../../netlify/functions/broker/analysis-repository.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";

function analysis(overrides = {}) {
  return {
    analyzerVersion: "collection-evidence-v2",
    chainId: 4663,
    address: COLLECTION,
    standard: "ERC721",
    sourceVerified: true,
    proxyStatus: "DIRECT",
    riskLabel: "UNKNOWN",
    riskScore: 20,
    riskConfidence: 56,
    analyzedAt: "2026-08-17T12:00:00.000Z",
    observedBlock: "80",
    observedBlockHash: `0x${"ab".repeat(32)}`,
    observedBlockTimestamp: "1786968000",
    sourceMinBlock: "70",
    sourceMaxBlock: "79",
    identity: { status: "OBSERVED", name: "Pixel Dreams", symbol: "PXDRM" },
    art: { dimensions: { pixelArt: 72 }, caveat: "Metadata-only heuristic." },
    market: {
      sales: { last30Days: 2 },
      participants: { uniqueParticipants30d: 4 },
      ownerSample: { requested: 2, resolved: 2, uniqueOwners: 2 },
      volumes30dByCurrency: { "0x0000000000000000000000000000000000000000": "3" },
      caveats: ["Historical evidence only."],
    },
    evidence: {
      risk: { label: "UNKNOWN", score: 20, confidence: 56 },
      nft: {
        metadata: {
          status: "ONCHAIN_JSON",
          tokenId: "1",
          scheme: "data",
          metadataHash: `0x${"cd".repeat(32)}`,
        },
      },
    },
    opportunityPatch: {
      artScore: 72,
      artConfidence: 33,
      artStatus: "HEURISTIC",
      marketScore: 48,
      marketConfidence: 40,
      marketStatus: "OBSERVED_ACTIVITY",
      liquidityScore: null,
      liquidityStatus: "UNAVAILABLE",
    },
    ...overrides,
  };
}

test("analysis queue selects only canonical Scout collections with bounded retry settings", async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [{
          chain_id: "4663",
          collection_address: COLLECTION,
          standard: "ERC721",
          first_seen_block: "80",
          analyzed_at: null,
        }],
      };
    },
  };
  const repository = new PostgresCollectionAnalysisRepository(database);
  const pending = await repository.pendingCollections(4663, { limit: 12, retryHours: 6 });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].address, COLLECTION);
  assert.deepEqual(calls[0].values, [4663, 6, 12]);
  assert.match(calls[0].sql, /opportunity\.canonical = TRUE/);
  assert.match(calls[0].sql, /opportunity\.scoutable = TRUE/);
  await assert.rejects(
    () => repository.pendingCollections(4663, { limit: 101 }),
    /limit/,
  );
});

test("activity query is canonical, bounded, and returns a deduplicated token sample", async () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    token_id: index < 2 ? "1" : String(index),
    source_block_number: String(70 + index),
    source_block_hash: `0x${"ab".repeat(32)}`,
    source_block_timestamp: new Date(`2026-08-1${index + 1}T12:00:00.000Z`),
    metadata: {},
  }));
  const calls = [];
  const repository = new PostgresCollectionAnalysisRepository({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows };
    },
  });
  const activity = await repository.collectionActivity(4663, COLLECTION, { limit: 3 });
  assert.equal(activity.rows.length, 3);
  assert.equal(activity.truncated, true);
  assert.deepEqual(activity.tokenIds, ["1", "2"]);
  assert.deepEqual(calls[0].values, [4663, COLLECTION, 4]);
  assert.match(calls[0].sql, /source = 'ROBINHOOD_SEAPORT_ACTIVITY'/);
  assert.match(calls[0].sql, /canonical = TRUE/);
  assert.match(calls[0].sql, /source_block_timestamp IS NOT NULL/);
});

test("analysis persistence updates evidence and scores while forcing execution eligibility off", async () => {
  const calls = [];
  const database = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("UPDATE broker_collections")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE broker_opportunities")) return { rowCount: 2, rows: [] };
      return { rowCount: 0, rows: [] };
    },
  };
  const repository = new PostgresCollectionAnalysisRepository(database);
  const result = await repository.saveAnalysis(analysis());
  assert.equal(result.opportunitiesUpdated, 2);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  const snapshotInsert = calls.find(({ sql }) =>
    sql.includes("INSERT INTO broker_collection_signal_snapshots"));
  assert.ok(snapshotInsert);
  assert.equal(snapshotInsert.values[4], "1786968000");
  assert.equal(snapshotInsert.values[6], "70");
  assert.equal(snapshotInsert.values[7], "79");
  const opportunityUpdate = calls.find(({ sql }) => sql.includes("UPDATE broker_opportunities"));
  assert.match(opportunityUpdate.sql, /autonomous_execution_eligible = FALSE/);
  assert.match(opportunityUpdate.sql, /collectionSignals/);
  assert.match(opportunityUpdate.sql, /autonomous_execution_eligible = FALSE/);
  const collectionUpdate = calls.find(({ sql }) => sql.includes("UPDATE broker_collections"));
  assert.match(collectionUpdate.sql, /analysis_block_number = \$10/);
  assert.equal(collectionUpdate.values[9], "80");
  assert.equal(collectionUpdate.values[10], `0x${"ab".repeat(32)}`);
  assert.equal(collectionUpdate.values[11], "Pixel Dreams");
  assert.equal(collectionUpdate.values[12], "PXDRM");
  const scorePatch = JSON.parse(opportunityUpdate.values[2]);
  assert.equal(scorePatch.contractRiskScore, 20);
  assert.equal(scorePatch.contractRiskConfidence, 56);
  assert.equal(scorePatch.artScore, 72);
  assert.equal(scorePatch.marketScore, 48);
  assert.equal(scorePatch.liquidityScore, undefined);
  const summary = JSON.parse(opportunityUpdate.values[3]);
  assert.equal(summary.recommendation, "RESEARCH");
  assert.equal(summary.observedBlockTimestamp, "1786968000");
  assert.equal(summary.autonomousExecutionEligible, false);
  const publicSignals = JSON.parse(opportunityUpdate.values[4]);
  assert.equal(publicSignals.identity.name, "Pixel Dreams");
  assert.equal(publicSignals.observedBlockTimestamp, "1786968000");
  assert.equal(publicSignals.market.sales.last30Days, 2);
  assert.equal(publicSignals.liquidity.status, "UNAVAILABLE");
  assert.equal(publicSignals.executionEligible, false);
  const statuses = JSON.parse(opportunityUpdate.values[5]);
  assert.equal(statuses.art, "HEURISTIC");
  assert.equal(statuses.market, "OBSERVED_ACTIVITY");
});

test("analysis failures are sanitized and invalid persistence fails before SQL", async () => {
  const calls = [];
  const database = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [] };
    },
  };
  const repository = new PostgresCollectionAnalysisRepository(database);
  await repository.recordFailure(4663, COLLECTION, new Error("secret provider URL"));
  const failure = JSON.parse(calls[0].values[2]);
  assert.deepEqual(failure, { failureType: "Error" });
  assert.doesNotMatch(calls[0].values[2], /secret provider URL/);

  await assert.rejects(
    () => repository.saveAnalysis(analysis({ observedBlockHash: "0x01" })),
    /block hash/,
  );
  await assert.rejects(
    () => repository.saveAnalysis(analysis({ proxyStatus: "UNSAFE" })),
    /proxy status/,
  );
  await assert.rejects(
    () => repository.saveAnalysis(analysis({ sourceMaxBlock: "81" })),
    /source block range/,
  );
  await assert.rejects(
    () => repository.saveAnalysis(analysis({ analyzerVersion: "../unsafe" })),
    /analyzer version/,
  );
});

test("analysis advisory lock stays on one database connection", async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      return { rows: [{ pg_advisory_unlock: true }] };
    },
    release() {
      released = true;
    },
  };
  const repository = new PostgresCollectionAnalysisRepository({ connect: async () => client });
  const value = await repository.withChainLock(4663, async (locked) => {
    assert.equal(locked.database, client);
    return "locked";
  });
  assert.equal(value, "locked");
  assert.equal(released, true);
  assert.ok(calls.some((sql) => sql.includes("pg_advisory_unlock")));
});
