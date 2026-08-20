import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ROBINHOOD } from "../src/config.mjs";
import {
  MAX_OPENSEA_RESPONSE_BYTES,
  OpenSeaMetadataSource,
  openSeaAssetUrl,
  sanitizeOpenSeaNft,
} from "../src/metadata/opensea.mjs";
import { refreshOpenSeaMetadata } from "../src/metadata/worker.mjs";
import {
  metadataConfiguration,
  PostgresMetadataRepository,
} from "../../netlify/functions/broker/metadata-repository.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";

function payload(overrides = {}) {
  return {
    nft: {
      contract: COLLECTION,
      identifier: "42",
      name: " Gogh\u0000 Punk   Acquisition ",
      description: "A\n  carefully curated NFT",
      display_image_url: "https://i.seadn.io/s/raw/files/example.png",
      collection: "example-collection",
      token_standard: "erc-721",
      traits: [
        { trait_type: "Style", value: "Pixel\u0007 Art" },
        { trait_type: "Count", value: 7 },
        { trait_type: "Nested", value: { unsafe: true } },
      ],
      ...overrides,
    },
  };
}

test("OpenSea metadata is identity-bound, display-sanitized, and attributed", () => {
  const record = sanitizeOpenSeaNft(payload(), {
    collection: COLLECTION.toUpperCase().replace("0X", "0x"),
    identifier: "042",
    payloadHash: `0x${"12".repeat(32)}`,
  });
  assert.equal(record.chainId, ROBINHOOD.chainId);
  assert.equal(record.collection, COLLECTION);
  assert.equal(record.tokenId, "42");
  assert.equal(record.name, "Gogh Punk Acquisition");
  assert.equal(record.description, "A carefully curated NFT");
  assert.equal(record.displayImageUrl, "https://i.seadn.io/s/raw/files/example.png");
  assert.equal(record.tokenStandard, "ERC721");
  assert.deepEqual(record.traits, [
    { traitType: "Style", value: "Pixel Art" },
    { traitType: "Count", value: "7" },
  ]);
  assert.equal(record.openSeaUrl, `https://opensea.io/assets/robinhood/${COLLECTION}/42`);
  assert.equal(record.status, "AVAILABLE");
  assert.equal(Object.hasOwn(record, "owner"), false);
  assert.equal(Object.hasOwn(record, "price"), false);
});

test("OpenSea metadata rejects missing or mismatched provider identity", () => {
  assert.throws(
    () => sanitizeOpenSeaNft(payload({ contract: undefined }), {
      collection: COLLECTION,
      identifier: "42",
      payloadHash: null,
    }),
    /contract does not match/,
  );
  assert.throws(
    () => sanitizeOpenSeaNft(payload({ identifier: undefined }), {
      collection: COLLECTION,
      identifier: "42",
      payloadHash: null,
    }),
    /token ID does not match/,
  );
  assert.throws(
    () => sanitizeOpenSeaNft(payload({ identifier: "43" }), {
      collection: COLLECTION,
      identifier: "42",
      payloadHash: null,
    }),
    /token ID does not match/,
  );
});

test("OpenSea metadata allows only the HTTPS i.seadn.io image origin", () => {
  for (const image of [
    "http://i.seadn.io/a.png",
    "https://evil.example/a.png",
    "https://i.seadn.io:444/a.png",
    "https://user:pass@i.seadn.io/a.png",
    "https://i.seadn.io/a.png#fragment",
    "javascript:alert(1)",
  ]) {
    const record = sanitizeOpenSeaNft(payload({ display_image_url: image }), {
      collection: COLLECTION,
      identifier: "42",
      payloadHash: null,
    });
    assert.equal(record.displayImageUrl, null);
  }
});

test("OpenSea source pins Robinhood, sends the key only in a header, and disables redirects", async () => {
  const requests = [];
  const apiKey = "server-side-secret";
  const source = new OpenSeaMetadataSource({
    apiKey,
    fetchFn: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const record = await source.nft({ collection: COLLECTION, tokenId: "42" });
  assert.equal(record.status, "AVAILABLE");
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `https://api.opensea.io/api/v2/chain/robinhood/contract/${COLLECTION}/nfts/42`,
  );
  assert.equal(requests[0].url.includes(apiKey), false);
  assert.equal(requests[0].options.headers["x-api-key"], apiKey);
  assert.equal(requests[0].options.redirect, "error");
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  assert.match(record.payloadHash, /^0x[0-9a-f]{64}$/);
});

test("OpenSea source caches a 404 shape without reading or trusting a payload", async () => {
  const source = new OpenSeaMetadataSource({
    apiKey: "server-side-secret",
    fetchFn: async () => new Response("not json", { status: 404 }),
  });
  const record = await source.nft({ collection: COLLECTION, tokenId: "42" });
  assert.equal(record.status, "NOT_FOUND");
  assert.equal(record.displayImageUrl, null);
  assert.equal(record.openSeaUrl, openSeaAssetUrl(COLLECTION, "42"));
});

test("OpenSea source refuses an oversized response before buffering its body", async () => {
  const source = new OpenSeaMetadataSource({
    apiKey: "server-side-secret",
    fetchFn: async () => new Response("{}", {
      headers: { "content-length": String(MAX_OPENSEA_RESPONSE_BYTES + 1) },
    }),
  });
  await assert.rejects(
    source.nft({ collection: COLLECTION, tokenId: "42" }),
    /exceeds the size limit/,
  );
});

test("OpenSea source enforces its response cap while streaming", async () => {
  const source = new OpenSeaMetadataSource({
    apiKey: "server-side-secret",
    fetchFn: async () => new Response(new Uint8Array(MAX_OPENSEA_RESPONSE_BYTES + 1)),
  });
  await assert.rejects(
    source.nft({ collection: COLLECTION, tokenId: "42" }),
    /exceeds the size limit/,
  );
});

test("OpenSea source aborts a slow request at the configured timeout", async () => {
  const source = new OpenSeaMetadataSource({
    apiKey: "server-side-secret",
    timeoutMs: 1_000,
    fetchFn: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
        once: true,
      });
    }),
  });
  await assert.rejects(
    source.nft({ collection: COLLECTION, tokenId: "42" }),
    (error) => error?.name === "AbortError",
  );
});

test("metadata repository prioritizes canonical Punks, acquisitions, then opportunities", async () => {
  const calls = [];
  const repository = new PostgresMetadataRepository({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ chain_id: 4663, collection_address: COLLECTION, token_id: "42", priority: 1 }] };
    },
  });
  const records = await repository.pendingCandidates(4663, { limit: 12 });
  assert.equal(records[0].tokenId, "42");
  assert.deepEqual(calls[0].values, [4663, ROBINHOOD.canonicalCollection, 12]);
  assert.match(calls[0].sql, /0 AS priority/);
  assert.match(calls[0].sql, /1 AS priority/);
  assert.match(calls[0].sql, /2 AS priority/);
  assert.ok(calls[0].sql.indexOf("broker_punks") < calls[0].sql.indexOf("broker_acquisitions"));
  assert.ok(calls[0].sql.indexOf("broker_acquisitions") < calls[0].sql.indexOf("broker_opportunities"));
  assert.match(calls[0].sql, /cached\.refresh_after IS NULL OR cached\.refresh_after <= NOW\(\)/);
  assert.match(calls[0].sql, /ROW_NUMBER\(\) OVER/);
});

test("metadata repository upsert is idempotent and stores only sanitized fields", async () => {
  const calls = [];
  const repository = new PostgresMetadataRepository({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ metadata_status: "ERROR", attempt_count: 2 }] };
    },
  });
  const record = {
    chainId: 4663,
    collection: COLLECTION,
    tokenId: "42",
    source: "OPENSEA_V2",
    status: "ERROR",
    name: null,
    description: null,
    displayImageUrl: null,
    collectionSlug: null,
    tokenStandard: "UNKNOWN",
    traits: [],
    openSeaUrl: openSeaAssetUrl(COLLECTION, "42"),
    payloadHash: null,
  };
  await repository.save(record, { refreshHours: 1, errorCode: "secret: bad" });
  assert.match(calls[0].sql, /ON CONFLICT \(chain_id, collection_address, token_id\) DO UPDATE/);
  assert.match(calls[0].sql, /attempt_count = broker_nft_metadata\.attempt_count \+ 1/);
  assert.equal(calls[0].values[13], "OPENSEA_UNCLASSIFIED_ERROR");
  assert.equal(calls[0].values.some((value) => String(value).includes("secret")), false);
  assert.equal(calls[0].values.length, 15);
});

test("metadata worker bounds failures and never makes provider metadata authoritative", async () => {
  const saved = [];
  const repository = {
    async pendingCandidates(chainId, { limit }) {
      assert.equal(chainId, 4663);
      assert.equal(limit, 2);
      return [
        { collection: COLLECTION, tokenId: "42" },
        { collection: COLLECTION, tokenId: "43" },
      ];
    },
    async save(record, options) { saved.push({ record, options }); },
  };
  const source = {
    async nft(candidate) {
      if (candidate.tokenId === "42") throw Object.assign(new Error("secret body"), {
        code: "OPENSEA_HTTP_429",
      });
      return {
        ...sanitizeOpenSeaNft(payload({ identifier: "43" }), {
          collection: COLLECTION,
          identifier: "43",
          payloadHash: null,
        }),
      };
    },
  };
  const result = await refreshOpenSeaMetadata({
    repository,
    source,
    configuration: {
      enabled: true,
      batchSize: 2,
      availableRefreshHours: 24,
      notFoundRefreshHours: 24,
      errorRefreshHours: 1,
    },
  });
  assert.deepEqual(
    { queued: result.queued, available: result.available, failed: result.failed },
    { queued: 2, available: 1, failed: 1 },
  );
  assert.equal(result.readOnly, true);
  assert.equal(result.authoritative, false);
  assert.equal(result.executionEnabled, false);
  assert.equal(saved[0].record.status, "ERROR");
  assert.equal(saved[0].options.errorCode, "OPENSEA_HTTP_429");
  assert.equal(JSON.stringify(saved).includes("secret body"), false);
});

test("metadata feature defaults off and configuration stays bounded", () => {
  const defaults = metadataConfiguration({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.batchSize, 12);
  assert.equal(defaults.timeoutMs, 8_000);
  assert.throws(
    () => metadataConfiguration({ BROKER_METADATA_ENABLED: "yes" }),
    /exactly true or false/,
  );
  assert.throws(
    () => metadataConfiguration({ BROKER_METADATA_BATCH_SIZE: "51" }),
    /between 1 and 50/,
  );
  assert.throws(
    () => metadataConfiguration({ BROKER_METADATA_TIMEOUT_MS: "999" }),
    /between 1000 and 30000/,
  );
});

test("metadata migration and scheduler remain cache-only and fail closed", async () => {
  const [migration, scheduler, environmentExample] = await Promise.all([
    readFile(
      new URL(
        "../../netlify/database/migrations/20260820204500_create_broker_nft_metadata.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../../netlify/functions/broker-metadata.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /PRIMARY KEY \(chain_id, collection_address, token_id\)/);
  assert.match(migration, /CHECK \(chain_id = 4663\)/);
  assert.match(migration, /display_image_url LIKE 'https:\/\/i\.seadn\.io\/%'/);
  assert.match(migration, /Never authoritative for ownership, execution, price, or safety/);
  assert.doesNotMatch(migration, /api_key|raw_payload|owner_snapshot/i);
  assert.match(scheduler, /metadataConfiguration\(process\.env\)/);
  assert.match(scheduler, /if \(!configuration\.enabled\)/);
  assert.match(scheduler, /reason: "NOT_CONFIGURED"/);
  assert.match(scheduler, /schedule: "3-59\/10 \* \* \* \*"/);
  assert.match(environmentExample, /BROKER_METADATA_ENABLED=false/);
  assert.doesNotMatch(environmentExample, /OPENSEA_API_KEY=\S+/);
});
