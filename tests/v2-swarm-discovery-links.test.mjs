import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SharedV2DiscoveryEngine } from "../broker/src/v4/discovery-engine.mjs";
import { readCurrentRobinhoodSeaDropObservations } from
  "../broker/src/v4/discovery/robinhood-seadrop-source.mjs";
import { seaDropObservationToOpportunity, V2_SEADROP_CODE_HASH,
  V2_SEADROP_ADAPTER_CODE_HASH, V2_REVIEWED_COLLECTION_CODE_HASHES } from
  "../broker/src/v4/discovery/seadrop-ingestor.mjs";
import { ArtBrokerLinkError, inspectArtBrokerLink, normalizeArtBrokerLink } from
  "../broker/src/v4/link-scanner.mjs";
import { PostgresV2OpportunityRepository } from
  "../broker/src/v4/postgres-opportunity-repository.mjs";
import { handleV2InspectUrl } from "../netlify/functions/broker-v2-inspect-url.mjs";
import { handleV2ReviewInspectUrl } from "../netlify/functions/broker-v2-review-inspect-url.mjs";
import { PublicError } from "../netlify/functions/_shared/http.mjs";

const NOW = new Date("2026-09-13T12:00:00.000Z");
const COLLECTION = `0x${"ab".repeat(20)}`;
const TX = `0x${"12".repeat(32)}`;
const BLOCK_HASH = `0x${"34".repeat(32)}`;
const PINNED_HASH = `0x${"56".repeat(32)}`;
const OWNER = `0x${"78".repeat(20)}`;

function configureInspectSite(t) {
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = "https://goghpunks.xyz";
  t.after(() => {
    if (previous === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous;
  });
}

function observation(overrides = {}) {
  const seconds = Math.floor(NOW.getTime() / 1_000);
  return {
    collection: COLLECTION, updateBlockNumber: "900", updateBlockHash: BLOCK_HASH,
    updateTransactionHash: TX, pinnedBlockNumber: "980", pinnedBlockHash: PINNED_HASH,
    checkedAt: NOW.toISOString(), collectionName: "Shared source fixture",
    maxSupply: 1000, totalSupply: 100,
    drop: { priceWei: "0", startTime: String(seconds - 60),
      endTime: String(seconds + 3600), walletLimit: 1, restrictFeeRecipients: false },
    contracts: { seaDropCodeHash: V2_SEADROP_CODE_HASH,
      adapterCodeHash: V2_SEADROP_ADAPTER_CODE_HASH,
      collectionCodeHash: V2_REVIEWED_COLLECTION_CODE_HASHES[0] },
    adapterRegistered: true, feeRecipientAllowed: true, ...overrides,
  };
}

test("link scanner rejects IP literals, numeric aliases and local DNS names", () => {
  for (const host of ["[::1]", "[::]", "[fd00::1]", "[fe80::1]", "[::ffff:127.0.0.1]",
    "[2001:4860:4860::8888]", "100.64.0.1", "100.127.255.254", "127.1", "2130706433",
    "0x7f000001", "0177.0.0.1", "0", "0.0.0.0", "10.1.2.3", "172.31.0.1",
    "192.168.1.1", "169.254.169.254", "224.0.0.1", "8.8.8.8", "localhost",
    "LOCALHOST.", "app.localhost", "localhost.localdomain", "app.local", "app.internal",
    "router.home.arpa", "intranet"]) {
    assert.throws(() => normalizeArtBrokerLink(`https://${host}/`),
      { code: "PRIVATE_URL_BLOCKED" }, host);
  }
});

test("link scanner rejects authority repairs, hidden delimiters and malformed hostnames", () => {
  for (const url of ["https:example.org", "https:/example.org", "https:///example.org",
    "https://example.org\\mint", "https://exam\nple.org/", "https://example.org/a b",
    " https://example.org/", "https://example.org/ ", "https://example.org/\u007f",
    "https://user:secret@example.org/", "https://@example.org/", "https://example.org:443/",
    "https://example.org:8443/", "https://%65xample.org/", "https://example.org/#",
    "https://example.org/#mint", "https://example.org/%oops", "https://bad_host.example/",
    "https://-bad.example/", "https://example..org/", "http://example.org/",
    "javascript:alert(1)", "data:text/plain,hello", "https://example.org/" + "a".repeat(2048)]) {
    assert.throws(() => normalizeArtBrokerLink(url), { code: "INVALID_URL" }, url);
  }
  for (const value of [null, undefined, 123, {}, new URL("https://example.org/")]) {
    assert.throws(() => normalizeArtBrokerLink(value), { code: "INVALID_URL" });
  }
});

test("canonical public links remain stable and exact mainnet explorer aliases keep their shape", () => {
  for (const host of ["robinhoodchain.blockscout.com", "explorer.chain.robinhood.com"]) {
    const link = normalizeArtBrokerLink(`HTTPS://${host.toUpperCase()}./address/${COLLECTION.toUpperCase()}/`);
    assert.deepEqual(link, { kind: "ROBINHOOD_CONTRACT", host, identity: COLLECTION,
      canonicalUrl: `https://${host}/address/${COLLECTION}` });
    assert.deepEqual(normalizeArtBrokerLink(link.canonicalUrl), link);
    assert.ok(Object.isFrozen(link));
  }
  assert.deepEqual(normalizeArtBrokerLink("https://Example.org./mint?edition=1"), {
    kind: "PROJECT_WEBSITE", host: "example.org", identity: null,
    canonicalUrl: "https://example.org/mint?edition=1",
  });
  assert.equal(normalizeArtBrokerLink("https://fdstudio.example/").kind, "PROJECT_WEBSITE");
  assert.equal(normalizeArtBrokerLink("https://robinhoodchain.blockscout.com.example.org/").kind,
    "PROJECT_WEBSITE");
});

test("testnet links never enter a mainnet resolver or fall through as project websites", async () => {
  let calls = 0;
  const resolver = async () => { calls += 1; return {}; };
  for (const path of [`/address/${COLLECTION}`, "/", "/address/not-a-contract"]) {
    await assert.rejects(inspectArtBrokerLink(`https://EXPLORER.TESTNET.CHAIN.ROBINHOOD.COM.${path}`,
      { resolvers: { ROBINHOOD_CONTRACT: resolver, PROJECT_WEBSITE: resolver } }),
    { code: "UNSUPPORTED_CHAIN" });
  }
  for (const url of ["https://[::1]/", "https://100.64.0.1/", "https://app.localhost/"]) {
    await assert.rejects(inspectArtBrokerLink(url, { resolvers: { PROJECT_WEBSITE: resolver } }),
      { code: "PRIVATE_URL_BLOCKED" });
  }
  assert.equal(calls, 0);
});

test("recognized platforms reject ambiguous paths and unsupported query data", () => {
  for (const url of ["https://opensea.io//collection/example", "https://opensea.io/collection//example",
    "https://opensea.io/other/../collection/example", "https://opensea.io/%2e/collection/example",
    "https://opensea.io/collection/example?", "https://opensea.io/collection/example?redirect=1",
    `https://robinhoodchain.blockscout.com/address/${COLLECTION}?chainId=46630`,
    `https://robinhoodchain.blockscout.com/address/${COLLECTION}/?`,
    `https://robinhoodchain.blockscout.com//address/${COLLECTION}`]) {
    assert.throws(() => normalizeArtBrokerLink(url), { code: "INVALID_URL" }, url);
  }
  for (const url of ["https://robinhoodchain.blockscout.com/address/not-an-address",
    `https://robinhoodchain.blockscout.com/tx/${TX}`, "https://x.com/bad!handle/status/123456",
    "https://x.com/example/status/123456?s=20&s=21", "https://x.com/example/status/123456?s=anything",
    "https://x.com/example/status/123456?redirect=1"]) {
    assert.throws(() => normalizeArtBrokerLink(url), { code: "UNSUPPORTED_URL" }, url);
  }
  assert.deepEqual(normalizeArtBrokerLink("https://twitter.com/Example/status/123456?s=20"), {
    kind: "X_POST", host: "x.com", identity: "123456",
    canonicalUrl: "https://x.com/Example/status/123456",
  });
  assert.equal(normalizeArtBrokerLink("https://opensea.io/collection/example/overview/").canonicalUrl,
    "https://opensea.io/collection/example");
  assert.equal(normalizeArtBrokerLink("https://opensea.io/drops/example").kind, "OPENSEA_DROP");
});

test("link inspection stays read-only even when trusted resolver evidence claims execution", async () => {
  const unresolved = await inspectArtBrokerLink("https://example.org/mint");
  assert.equal(unresolved.reason, "NO_TRUSTED_RESOLVER");
  assert.equal(unresolved.executable, false);
  assert.equal(unresolved.externalTransactionAccepted, false);
  const inspected = await inspectArtBrokerLink(`https://robinhoodchain.blockscout.com/address/${COLLECTION}`,
    { resolvers: { ROBINHOOD_CONTRACT: async (link) => {
      assert.equal(link.identity, COLLECTION);
      return { status: "PASSED", executable: true, externalTransactionAccepted: true };
    } } });
  assert.equal(inspected.executable, false);
  assert.equal(inspected.externalTransactionAccepted, false);
});

test("mocked chain source composes with real shared normalization, provenance and analysis dedupe", async () => {
  const source = await readCurrentRobinhoodSeaDropObservations({ now: NOW, maximum: 1,
    pool: { query: async () => ({ rows: [] }) }, pause: async () => {}, client: {
      getBlockNumber: async () => 1000n,
      getLogs: async ({ address, fromBlock, toBlock }) => {
        assert.equal(address, "0x00005ea00ac477b1030ce78506496e8c2de24bf5");
        assert.equal(fromBlock, 0n); assert.equal(toBlock, 980n);
        return [{ args: { nftContract: COLLECTION.toUpperCase() }, blockNumber: 900n,
          blockHash: BLOCK_HASH, transactionHash: TX }];
      },
      getBlock: async ({ blockNumber }) => {
        assert.equal(blockNumber, 980n); return { hash: PINNED_HASH };
      },
      getCode: async ({ blockNumber }) => { assert.equal(blockNumber, 980n); return "0x6000"; },
      readContract: async ({ functionName, blockNumber }) => {
        assert.equal(blockNumber, 980n);
        if (functionName === "getPublicDrop") return { mintPrice: 0n,
          startTime: BigInt(observation().drop.startTime), endTime: BigInt(observation().drop.endTime),
          maxTotalMintableByWallet: 1, restrictFeeRecipients: false };
        if (functionName === "name") return "Mocked chain collection";
        if (functionName === "maxSupply") return 1000n;
        if (functionName === "totalSupply") return 100n;
        if (functionName === "validateAdapter") return true;
        throw new Error(`Unexpected source read: ${functionName}`);
      },
    } });
  assert.equal(source.observations.length, 1);
  const { opportunity, screen } = seaDropObservationToOpportunity(source.observations[0], NOW);
  // Fixture bytecode is deliberately unreviewed; shared discovery cannot bless it.
  assert.equal(screen.status, "BLOCKED");
  assert.equal(opportunity.chainId, 4663);
  assert.equal(opportunity.expectedNftReceiver, null);
  assert.equal(opportunity.simulationStatus, "UNAVAILABLE");
  assert.equal(normalizeArtBrokerLink(opportunity.sourceUrls[0]).identity, COLLECTION);
  const engine = new SharedV2DiscoveryEngine();
  const eventSource = { sourceKind: "ROBINHOOD_SEADROP_EVENT", sourceIdentity: TX, now: NOW };
  const first = engine.ingest(opportunity, eventSource);
  const repeated = engine.ingest(opportunity, eventSource);
  assert.equal(first.deduplicated, false);
  assert.equal(repeated.deduplicated, true);
  assert.equal(repeated.sourceCount, 1);
  const second = engine.ingest({ ...opportunity, opportunityId: "other-source:collection",
    createdAt: new Date(NOW.getTime() + 1000).toISOString() }, {
    sourceKind: "MOCKED_METADATA", sourceIdentity: "collection-fixture", now: NOW,
  });
  assert.equal(second.sourceCount, 2);
  assert.equal(second.opportunity.opportunityId, first.opportunity.opportunityId);
  assert.equal(second.opportunity.createdAt, first.opportunity.createdAt);
  assert.deepEqual(engine.sources(opportunity.dedupeKey).map(({ sourceKind, sourceIdentity }) => (
    { sourceKind, sourceIdentity }
  )), [{ sourceKind: "ROBINHOOD_SEADROP_EVENT", sourceIdentity: TX },
    { sourceKind: "MOCKED_METADATA", sourceIdentity: "collection-fixture" }]);
  let analyses = 0;
  const analyze = async () => { analyses += 1; return { summary: "Shared collection evidence" }; };
  const [left, right] = await Promise.all([
    engine.analyzeOnce(opportunity.dedupeKey, screen.inputHash, analyze),
    engine.analyzeOnce(opportunity.dedupeKey, screen.inputHash, analyze),
  ]);
  assert.equal(analyses, 1);
  assert.deepEqual(left.analysis, right.analysis);
  const otherStage = engine.ingest({ ...opportunity, mintStage: "ALLOWLIST" }, eventSource);
  assert.notEqual(otherStage.opportunity.dedupeKey, opportunity.dedupeKey);
  assert.throws(() => engine.ingest({ ...opportunity, chainId: 46630 }, eventSource),
    /opportunity schema is invalid/);
});

test("PGlite: real discovery upserts preserve canonical identity, newest state and source provenance", async () => {
  // Load just the two owning tables and their index from the real migration.
  // One in-memory PostgreSQL instance; no network, disk database or schema clone.
  const { PGlite } = await import("@electric-sql/pglite");
  const database = new PGlite();
  try {
    const migration = await readFile(new URL(
      "../netlify/database/migrations/20260906010000_create_art_broker_v2.sql", import.meta.url), "utf8");
    const start = migration.indexOf("CREATE TABLE IF NOT EXISTS broker_v2_opportunities (");
    const end = migration.indexOf("CREATE TABLE IF NOT EXISTS broker_v2_opportunity_analysis (");
    assert.ok(start >= 0 && end > start);
    await database.exec(migration.slice(start, end));
    const repository = new PostgresV2OpportunityRepository({ connect: async () => ({
      query: (...args) => database.query(...args), release() {},
    }) });
    const original = seaDropObservationToOpportunity(observation(), NOW).opportunity;
    const source = { kind: "ROBINHOOD_SEADROP_EVENT", identity: TX,
      url: `https://robinhoodchain.blockscout.com/tx/${TX}`,
      discoveredAt: NOW.toISOString(), evidence: { updateBlockNumber: "900", updateBlockHash: BLOCK_HASH } };
    const first = await repository.ingest(original, source);
    assert.deepEqual(first, original);
    const later = new Date(NOW.getTime() + 60_000).toISOString();
    const recent = { ...original, opportunityId: "another-source:collection", createdAt: later,
      updatedAt: later, collectionName: "Newer blocked observation", screeningStatus: "BLOCKED",
      simulationStatus: "FAILED", riskLevel: "HIGH", riskScore: 100,
      endTime: new Date(NOW.getTime() + 30_000).toISOString() };
    const recentSource = { ...source, discoveredAt: later, evidence: { updateBlockNumber: "950",
      updateBlockHash: PINNED_HASH }, url: `https://explorer.chain.robinhood.com/address/${COLLECTION}` };
    const second = await repository.ingest(recent, recentSource);
    assert.equal(second.opportunityId, first.opportunityId);
    assert.equal(second.createdAt, first.createdAt);
    assert.equal(second.updatedAt, later);
    assert.equal(second.collectionName, recent.collectionName);
    assert.equal(second.screeningStatus, "BLOCKED");
    assert.equal(second.simulationStatus, "FAILED");
    assert.ok(Object.isFrozen(second));
    assert.ok(Object.isFrozen(second.sourceUrls));

    const older = new Date(NOW.getTime() - 60_000).toISOString();
    const stale = { ...original, opportunityId: "stale-source:collection", createdAt: older,
      updatedAt: older, collectionName: "Stale passed observation", simulationStatus: "PASSED" };
    const staleSource = { ...source, discoveredAt: older, evidence: { updateBlockNumber: "800" },
      url: "https://example.org/stale" };
    assert.deepEqual(await repository.ingest(stale, staleSource), second);
    // A previously unseen older source is still useful provenance, without
    // promoting its stale screening into the shared current opportunity.
    assert.deepEqual(await repository.ingest(stale, { ...staleSource, identity: `0x${"78".repeat(32)}` }),
      second);
    const rows = (await database.query(`SELECT opportunity_id, first_seen_at, updated_at,
      normalized, screening_status, simulation_status, risk_score, expires_at
      FROM broker_v2_opportunities`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].opportunity_id, first.opportunityId);
    assert.equal(new Date(rows[0].first_seen_at).toISOString(), first.createdAt);
    assert.equal(new Date(rows[0].updated_at).toISOString(), second.updatedAt);
    assert.deepEqual(rows[0].normalized, second);
    assert.equal(rows[0].screening_status, "BLOCKED");
    assert.equal(rows[0].simulation_status, "FAILED");
    assert.equal(rows[0].risk_score, 100);
    assert.equal(new Date(rows[0].expires_at).toISOString(), second.endTime);
    const sources = (await database.query(`SELECT opportunity_id, source_identity, source_url,
      evidence, discovered_at FROM broker_v2_opportunity_sources ORDER BY source_identity`)).rows;
    assert.equal(sources.length, 2);
    assert.ok(sources.every((entry) => entry.opportunity_id === first.opportunityId));
    assert.equal(sources[0].source_identity, TX);
    assert.equal(sources[0].source_url, recentSource.url);
    assert.deepEqual(sources[0].evidence, recentSource.evidence);
    assert.equal(new Date(sources[0].discovered_at).toISOString(), older);
    assert.deepEqual(sources[1].evidence, staleSource.evidence);

    // Equal ingestion timestamps retain the established last-writer behavior;
    // these clocks are not authenticated chain freshness evidence.
    const equalTime = await repository.ingest({ ...recent, collectionName: "Same clock update" }, recentSource);
    assert.equal(equalTime.collectionName, "Same clock update");
    assert.equal(equalTime.opportunityId, first.opportunityId);
    assert.equal(equalTime.createdAt, first.createdAt);
  } finally {
    await database.close();
  }
});

for (const [label, handle, origin, review] of [
  ["production", handleV2InspectUrl, "https://goghpunks.xyz", false],
  ["review", handleV2ReviewInspectUrl, "https://deploy-preview-42.preview.goghpunks.xyz", true],
]) {
  const request = (url, requestOrigin = origin) => new Request(
    `${origin}/api/v2/${review ? "review/" : ""}inspect-url`, {
      method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" },
      body: JSON.stringify({ tokenId: "93", url, ...(review ? { owner: OWNER } : {}) }),
    });
  const dependencies = { pool: {}, requireSession: async () => ({ walletAddress: OWNER }),
    readAuthority: async () => ({ owner: OWNER }) };

  test(`${label} inspect endpoint returns typed link input errors as HTTP 400`, async (t) => {
    configureInspectSite(t);
    let authorities = 0;
    for (const [url, code] of [
      ["javascript:alert(1)", "INVALID_URL"],
      ["https://[::1]/", "PRIVATE_URL_BLOCKED"],
      ["https://opensea.io/assets/not-a-collection", "UNSUPPORTED_URL"],
      [`https://explorer.testnet.chain.robinhood.com/address/${COLLECTION}`, "UNSUPPORTED_CHAIN"],
    ]) {
      const response = await handle(request(url), { ...dependencies,
        readAuthority: async (tokenId, { expectedOwner }) => {
          assert.equal(tokenId, "93"); assert.equal(expectedOwner, OWNER);
          authorities += 1; return { owner: OWNER };
        } });
      assert.equal(response.status, 400, `${label}: ${url}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.code, code);
      assert.equal(typeof payload.message, "string");
      assert.ok(payload.message.length > 0);
      assert.deepEqual(Object.keys(payload).sort(), ["code", "message", "ok"]);
    }
    assert.equal(authorities, 4, "authority still runs before link normalization");
  });

  test(`${label} inspect endpoint keeps unrelated and resolver failures private HTTP 503 errors`, async (t) => {
    configureInspectSite(t);
    const logged = t.mock.method(console, "error", () => {});
    for (const error of [new Error("private upstream failure details"),
      Object.assign(new Error("private same-code failure"), { code: "INVALID_URL" }),
      new ArtBrokerLinkError("INVALID_RESOLVER_RESULT", "private resolver failure details")]) {
      const response = await handle(request("https://example.org/mint"), { ...dependencies,
        inspect: async () => { throw error; } });
      assert.equal(response.status, 503);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.code, "V2_SERVICE_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(payload), /private|resolver failure|same-code/);
    }
    assert.equal(logged.mock.callCount(), 3);
  });

  test(`${label} inspect endpoint preserves origin and ownership gates and read-only success`, async (t) => {
    configureInspectSite(t);
    let inspections = 0;
    const inspect = async (url) => { inspections += 1; return inspectArtBrokerLink(url); };
    const wrongOrigin = await handle(request("https://[::1]/", "https://example.org"), {
      ...dependencies, inspect,
    });
    assert.equal(wrongOrigin.status, review ? 404 : 403);
    const wrongOwner = await handle(request("https://[::1]/"), { ...dependencies, inspect,
      readAuthority: async () => { throw new PublicError(403, "NOT_CURRENT_OWNER", "Owner changed."); } });
    assert.equal(wrongOwner.status, 403);
    assert.equal((await wrongOwner.json()).code, "NOT_CURRENT_OWNER");
    if (!review) {
      const unsigned = await handle(request("https://[::1]/"), { ...dependencies, inspect,
        requireSession: async () => { throw new PublicError(401, "V2_SESSION_REQUIRED", "Sign in."); } });
      assert.equal(unsigned.status, 401);
      assert.equal((await unsigned.json()).code, "V2_SESSION_REQUIRED");
    }
    assert.equal(inspections, 0);
    const valid = await handle(request(`https://robinhoodchain.blockscout.com/address/${COLLECTION}`),
      { ...dependencies, inspect });
    assert.equal(valid.status, 200);
    const payload = await valid.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.inspection.link.identity, COLLECTION);
    assert.equal(payload.inspection.status, "NEEDS_REVIEW");
    assert.equal(payload.inspection.executable, false);
    assert.equal(payload.inspection.externalTransactionAccepted, false);
    assert.equal(payload.transactionPrepared, false);
    assert.equal(payload.externalCalldataAccepted, false);
    assert.equal(inspections, 1);
  });
}
