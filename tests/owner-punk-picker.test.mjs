import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import {
  automationPunkAgentSummaries, configuredAutomationPunkIds,
  createdAutomationV3PunkIds,
  enrolledAutomationPunkIds,
  indexedOwnerPunkIds,
  liveOwnerPunkIds,
  liveOwnerPunkSnapshot,
  mergeOwnerPunkDecorations,
  openSeaOwnerPunkIds,
  openSeaOwnerPunks,
  ownerPunkArtwork,
  ownerPunkView,
  proposedRetirementTierForOpenSeaRank,
  refreshIndexedOwnerPunks,
} from "../netlify/functions/broker-owner-punks.mjs";
import {
  copyPunkAccountAddress,
  decodeOwnerOfMulticall,
  decodeOnchainPunkDecoration,
  discoverWalletOwnedPunkIds,
  encodePunkBalanceOf,
  encodeOwnerOfMulticall,
  findBrowserOwnedPunks,
  hydrateOnchainPunkDecorations,
  priorityArtworkAccounts,
  readBrowserOwnerPunkBalance,
  mergeWalletAndActivatedPunks,
  requestedBrokerPunk,
  selectedPunkGalleryPath,
} from "../site/owner-accounts.js";

const OWNER = "0x1234567890123456789012345678901234567890";
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const ACCOUNT_A = "0x2222222222222222222222222222222222222222";
const ACCOUNT_B = "0x3333333333333333333333333333333333333333";
const MULTICALL_ABI = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])",
]);
const TOKEN_URI_ABI = parseAbi(["function tokenURI(uint256) view returns (string)"]);

test("watch-agent links accept only one bounded Punk route selection", () => {
  assert.equal(requestedBrokerPunk("https://goghpunks.xyz/broker/?punk=1616#automation-title"), "1616");
  for (const value of ["https://goghpunks.xyz/broker/?punk=01616", "javascript:alert(1)",
    "https://goghpunks.xyz/broker/?punk=10000", "not a url"]) {
    assert.equal(requestedBrokerPunk(value), null);
  }
});

test("owner roster supports a fast indexed view and defaults to reconciliation", () => {
  assert.equal(ownerPunkView("https://goghpunks.xyz/api/broker/owner-punks?view=indexed"),
    "indexed");
  assert.equal(ownerPunkView("https://goghpunks.xyz/api/broker/owner-punks?view=reconcile"),
    "reconcile");
  assert.equal(ownerPunkView("https://goghpunks.xyz/api/broker/owner-punks?view=unsafe"),
    "reconcile");
});

test("first-time wallets reconcile server-side instead of scanning 5,017 Punks on mobile", async () => {
  const source = await readFile(new URL("../site/owner-accounts.js", import.meta.url), "utf8");
  assert.match(source, /first-time holder can be absent/);
  assert.match(source, /view=reconcile/);
  assert.match(source, /reconciledInitially = true/);
  assert.doesNotMatch(source, /const walletOwned = await discoverWalletOwnedPunkIds/);
});

test("configured automation roster supplies bounded discovery hints without authority", () => {
  assert.deepEqual(configuredAutomationPunkIds({
    BROKER_AUTOMATION_V3_PUNK_IDS: "1797,1639,1755",
  }), ["1639", "1755", "1797"]);
  assert.deepEqual(configuredAutomationPunkIds({}), []);
  for (const value of ["1797,1797", "1797,01", "1797,10000", " 1797", "1797,"]) {
    assert.throws(() => configuredAutomationPunkIds({
      BROKER_AUTOMATION_V3_PUNK_IDS: value,
    }), /roster/);
  }
});

test("enrolled V3 Punks remain bounded owner-scoped discovery hints", async () => {
  let captured;
  const result = await enrolledAutomationPunkIds(OWNER, async (sql, values) => {
    captured = { sql, values };
    return { rows: [{ token_id: "93" }, { token_id: "94" }, { token_id: "94" }] };
  });
  assert.deepEqual(result, ["93", "94"]);
  assert.match(captured.sql, /broker_automation_v3_enrollments/);
  assert.match(captured.sql, /LOWER\(owner_snapshot\)/);
  assert.equal(captured.values[2], OWNER.toLowerCase());
  assert.equal(captured.values[3], 201);
});

test("owner agent summaries distinguish worker proof from configuration", async () => {
  let captured;
  const now = Date.parse("2026-08-29T12:10:00Z");
  const summaries = await automationPunkAgentSummaries(OWNER, async (sql, values) => {
    captured = { sql, values };
    return { rows: [
      { token_id: "93", configured: true, enrolled: true, account_address: ACCOUNT_A,
        nft_count: 8,
        worker_state: "SKIPPED", last_scheduled_scan: "2026-08-29T12:08:00Z",
        last_actual_scan: "2026-08-29T12:08:02Z", last_successful_mint: null,
        next_scan_estimate: "2026-08-29T14:23:00Z", reason: "NO_ELIGIBLE_TARGETS",
        updated_at: "2026-08-29T12:08:02Z", global_status: "NO_ELIGIBLE_TARGETS",
        global_completed_at: "2026-08-29T12:08:02Z" },
      { token_id: "1616", configured: true, enrolled: false, account_address: null,
        worker_state: null, last_scheduled_scan: null, last_actual_scan: null,
        last_successful_mint: null, next_scan_estimate: null, reason: null, updated_at: null,
        global_status: "NO_ELIGIBLE_TARGETS", global_completed_at: "2026-08-29T12:08:02Z" },
      { token_id: "1797", configured: true, enrolled: true, account_address: ACCOUNT_B,
        worker_state: "SKIPPED", last_scheduled_scan: "2026-08-29T08:00:00Z",
        last_actual_scan: "2026-08-29T08:00:02Z", last_successful_mint: null,
        next_scan_estimate: "2026-08-29T10:15:00Z", reason: "NO_ELIGIBLE_TARGETS",
        updated_at: "2026-08-29T08:00:02Z", global_status: "NO_ELIGIBLE_TARGETS",
        global_completed_at: "2026-08-29T12:08:02Z" },
      { token_id: "1798", configured: true, enrolled: true, account_address: ACCOUNT_B,
        worker_state: null, last_scheduled_scan: null, last_actual_scan: null,
        last_successful_mint: null, next_scan_estimate: null, reason: null, updated_at: null,
        global_status: null, global_completed_at: null },
      { token_id: "4184", configured: true, enrolled: true, account_address: ACCOUNT_A,
        worker_state: "CONFIRMING", last_scheduled_scan: "2026-08-29T12:09:00Z",
        last_actual_scan: "2026-08-29T12:09:02Z", last_successful_mint: null,
        next_scan_estimate: "2026-08-29T14:24:00Z", reason: "MINT_SUBMITTED",
        updated_at: "2026-08-29T12:09:30Z", global_status: "NO_ELIGIBLE_TARGETS",
        global_completed_at: "2026-08-29T12:09:30Z" },
      { token_id: "4185", configured: true, enrolled: true, account_address: ACCOUNT_A,
        worker_state: "MINTED", last_scheduled_scan: "2026-08-29T11:45:00Z",
        last_actual_scan: "2026-08-29T11:45:05Z",
        last_successful_mint: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        next_scan_estimate: "2026-08-29T11:50:00Z", reason: "MINT_CONFIRMED",
        updated_at: "2026-08-29T11:45:05Z", global_status: "FAILED",
        global_completed_at: "2026-08-29T12:09:45Z" },
      { token_id: "4186", configured: true, enrolled: true, account_address: ACCOUNT_A,
        worker_state: "ERROR", last_scheduled_scan: "2026-08-29T12:09:00Z",
        last_actual_scan: "2026-08-29T12:09:45Z", last_successful_mint: null,
        next_scan_estimate: "2026-08-29T14:24:00Z", reason: "DISCOVERY_SCAN_FAILED",
        updated_at: "2026-08-29T12:09:45Z", global_status: "FAILED",
        global_completed_at: "2026-08-29T12:09:45Z" },
    ] };
  }, now);
  assert.equal(summaries[0].status, "ACTIVE");
  assert.equal(summaries[0].nftCount, 8);
  assert.equal(summaries[0].lastActualScan, "2026-08-29T12:08:02.000Z");
  assert.equal(summaries[1].status, "NEEDS_ENROLLMENT");
  assert.equal(summaries[2].status, "NEEDS_ATTENTION");
  assert.equal(summaries[3].status, "WAITING_FOR_FIRST_SCAN");
  assert.equal(summaries[4].status, "MINTING");
  assert.equal(summaries[5].status, "ACTIVE");
  assert.equal(summaries[6].status, "RETRY_SCHEDULED");
  assert.match(captured.sql, /broker_punk_agent_heartbeats/);
  assert.match(captured.sql, /broker_automation_v3_worker_state/);
  assert.match(captured.sql, /broker_portfolio_snapshots/);
  assert.equal(captured.values[2], OWNER.toLowerCase());
});

test("live owner completion avoids a full scan when indexed candidates reconcile balance", async () => {
  const calls = [];
  const result = await liveOwnerPunkIds(OWNER, ["93", "94"], {
    client: {
      getBlockNumber: async () => 123n,
      readContract: async () => 2n,
      multicall: async ({ contracts, blockNumber }) => {
        assert.equal(blockNumber, 123n);
        calls.push(contracts.map(({ args }) => String(args[0])));
        return contracts.map(() => ({ status: "success", result: OWNER }));
      },
    },
  });
  assert.deepEqual(result, ["93", "94"]);
  assert.deepEqual(calls, [["93", "94"]]);
});

test("a complete 128-Punk indexed roster is neither truncated nor rescanned", async () => {
  const tokenIds = Array.from({ length: 128 }, (_, index) => String(index + 1));
  const calls = [];
  const snapshot = await liveOwnerPunkSnapshot(OWNER, tokenIds, {
    client: {
      getBlockNumber: async () => 321n,
      readContract: async () => 128n,
      multicall: async ({ contracts, blockNumber }) => {
        assert.equal(blockNumber, 321n);
        calls.push(contracts.length);
        return contracts.map(() => ({ status: "success", result: OWNER }));
      },
    },
  });
  assert.equal(snapshot.tokenIds.length, 128);
  assert.deepEqual(snapshot.tokenIds, tokenIds);
  assert.equal(snapshot.balance, 128n);
  assert.deepEqual(calls, [128], "the complete indexed roster needs one bounded verification");
});

test("a confirmed zero-Punk wallet returns a complete empty roster without ownerOf reads", async () => {
  let multicallCount = 0;
  const snapshot = await liveOwnerPunkSnapshot(OWNER, [], {
    client: {
      getBlockNumber: async () => 654n,
      readContract: async () => 0n,
      multicall: async () => {
        multicallCount += 1;
        return [];
      },
    },
  });
  assert.deepEqual(snapshot, { tokenIds: [], blockNumber: 654n, balance: 0n });
  assert.equal(multicallCount, 0);
});

test("live owner completion scans server-side only when hints omit an owned Punk", async () => {
  const calls = [];
  const owned = new Set(["93", "1616"]);
  const result = await liveOwnerPunkIds(OWNER, ["93"], {
    client: {
      getBlockNumber: async () => 456n,
      readContract: async () => 2n,
      multicall: async ({ contracts, blockNumber }) => {
        assert.equal(blockNumber, 456n);
        calls.push(contracts.length);
        return contracts.map(({ args }) => owned.has(String(args[0]))
          ? { status: "success", result: OWNER }
          : { status: "failure", error: new Error("not minted") });
      },
    },
  });
  assert.deepEqual(result, ["93", "1616"]);
  assert.equal(calls[0], 1, "the current index is checked before scanning");
  assert.equal(calls.slice(1).reduce((sum, value) => sum + value, 0), 5_017);
  assert.equal(calls.length, 27, "one hint check plus 26 bounded scan chunks");
});

test("a five-Punk wallet repairs one Punk omitted from a nonempty index", async () => {
  const expected = ["93", "94", "95", "96", "97"];
  const owned = new Set(expected);
  const result = await liveOwnerPunkIds(OWNER, expected.slice(0, 4), {
    client: {
      getBlockNumber: async () => 457n,
      readContract: async () => 5n,
      multicall: async ({ contracts }) => contracts.map(({ args }) => owned.has(String(args[0]))
        ? { status: "success", result: OWNER }
        : { status: "failure", error: new Error("not owned") }),
    },
  });
  assert.deepEqual(result, expected);
});

test("live owner snapshot pins balance and every owner read to one block", async () => {
  const reads = [];
  const snapshot = await liveOwnerPunkSnapshot(OWNER, ["93"], {
    client: {
      getBlockNumber: async () => 789n,
      readContract: async ({ blockNumber }) => {
        reads.push(blockNumber);
        return 1n;
      },
      multicall: async ({ contracts, blockNumber }) => {
        reads.push(blockNumber);
        return contracts.map(() => ({ status: "success", result: OWNER }));
      },
    },
  });
  assert.deepEqual(snapshot, { tokenIds: ["93"], blockNumber: 789n, balance: 1n });
  assert.deepEqual(reads, [789n, 789n]);
});

test("browser balanceOf is one bounded completeness assertion", async () => {
  const calls = [];
  assert.deepEqual(encodePunkBalanceOf(COLLECTION, OWNER), {
    to: COLLECTION,
    data: `0x70a08231${OWNER.slice(2).padStart(64, "0")}`,
  });
  const balance = await readBrowserOwnerPunkBalance({
    request: async (request) => {
      calls.push(request);
      return `0x${128n.toString(16).padStart(64, "0")}`;
    },
  }, COLLECTION, OWNER);
  assert.equal(balance, 128);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "eth_call");
  await assert.rejects(readBrowserOwnerPunkBalance({
    request: async () => `0x${201n.toString(16).padStart(64, "0")}`,
  }, COLLECTION, OWNER), /more Punks/);
});

test("complete live owner snapshots atomically refresh indexed ownership hints", async () => {
  let captured;
  const result = await refreshIndexedOwnerPunks(OWNER, ["1616", "93", "93"], 987n,
    async (sql, values) => {
      captured = { sql, values };
      return { rows: [{ cleared_count: 4, upserted_count: 2 }] };
    });
  assert.deepEqual(result, {
    tokenIds: ["93", "1616"], blockNumber: 987n, clearedCount: 4, upsertedCount: 2,
  });
  assert.match(captured.sql, /WITH owned AS/);
  assert.match(captured.sql, /owner_snapshot = NULL/);
  assert.match(captured.sql, /ON CONFLICT \(chain_id, collection_address, token_id\)/);
  assert.match(captured.sql, /owner_snapshot_block <= EXCLUDED\.owner_snapshot_block/);
  assert.deepEqual(captured.values, [
    4663, COLLECTION, OWNER.toLowerCase(), ["93", "1616"], "987",
  ]);
});

test("owner index refresh rejects unpinned, duplicate-overflow, and malformed evidence", async () => {
  const query = async () => ({ rows: [{ cleared_count: 0, upserted_count: 0 }] });
  await assert.rejects(refreshIndexedOwnerPunks(OWNER, ["01"], 1n, query), /invalid/);
  await assert.rejects(refreshIndexedOwnerPunks(OWNER, ["93"], -1n, query), /invalid/);
  await assert.rejects(refreshIndexedOwnerPunks("0xwrong", ["93"], 1n, query), /invalid/);
});

test("every owned V3 Punk wallet is discovered in one bounded multicall", async () => {
  const calls = [];
  const result = await createdAutomationV3PunkIds(["93", "94", "95"], {
    registry: REGISTRY,
    client: {
      multicall: async ({ contracts, allowFailure }) => {
        calls.push({ contracts, allowFailure });
        return [
          { status: "success", result: true },
          { status: "success", result: false },
          { status: "failure", error: new Error("read failed") },
        ];
      },
    },
  });
  assert.deepEqual(result, ["93"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].allowFailure, true);
  assert.deepEqual(calls[0].contracts.map(({ args }) => String(args[0])), ["93", "94", "95"]);
  assert.ok(calls[0].contracts.every(({ address: target }) => target === REGISTRY));
});

function addressWord(value) {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

test("Punk Account wallet copy is exact and refuses unavailable clipboard access", async () => {
  const writes = [];
  assert.equal(await copyPunkAccountAddress({
    clipboard: { writeText: async (value) => writes.push(value) },
  }, ACCOUNT_A.toUpperCase().replace(/^0X/, "0x")), ACCOUNT_A);
  assert.deepEqual(writes, [ACCOUNT_A]);
  await assert.rejects(copyPunkAccountAddress({}, ACCOUNT_A), /cannot be copied/);
  await assert.rejects(copyPunkAccountAddress({ clipboard: { writeText: async () => {} } },
    "0xnot-an-address"), /cannot be copied/);
});

test("indexed owner picker candidates are bounded, ordered, and explicitly non-authorizing", async () => {
  let captured;
  const result = await indexedOwnerPunkIds(OWNER, async (sql, values) => {
    captured = { sql, values };
    return { rows: [{ token_id: "12" }, { token_id: "1639" }, { token_id: "1639" }] };
  });
  assert.deepEqual(result, ["12", "1639"]);
  assert.match(captured.sql, /LOWER\(owner_snapshot\)/);
  assert.equal(captured.values[2], OWNER.toLowerCase());
  assert.equal(captured.values[3], 201);
});

test("owner Punk picker carries only sanitized cached artwork decoration", async () => {
  const rows = [{
    token_id: "93", nft_metadata_status: "AVAILABLE", nft_metadata_name: "Gogh Punk #93",
    nft_metadata_image_url: "https://i.seadn.io/s/raw/files/example.png",
    nft_metadata_description: null, nft_metadata_collection_slug: "gogh-punks-255843210",
    nft_metadata_token_standard: "ERC721", nft_metadata_traits: [],
    nft_metadata_opensea_url:
      "https://opensea.io/assets/robinhood/0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6/93",
    nft_metadata_fetched_at: "2026-08-25T12:00:00.000Z",
  }];
  const result = await ownerPunkArtwork(["93", "94"], async (sql) => {
    assert.match(sql, /broker_nft_metadata/);
    return { rows };
  });
  assert.equal(result[0].artwork.name, "Gogh Punk #93");
  assert.match(result[0].artwork.imageUrl, /^https:\/\/i\.seadn\.io\//);
  assert.equal(result[1].artwork.imageUrl, null);
});

test("OpenSea supplies bounded discovery hints while foreign NFTs are ignored", async () => {
  const calls = [];
  const result = await openSeaOwnerPunkIds(OWNER, {
    apiKey: "server-side-test-key",
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          nfts: [
            { identifier: "1639", collection: "gogh-punks-255843210", contract: COLLECTION,
              name: "Gogh Punk #1639", display_image_url: "https://i.seadn.io/s/raw/files/1639.png",
              rarity: { strategy_id: "openrarity", strategy_version: "1", rank: 40 } },
            { identifier: "1755", collection: "gogh-punks-255843210", contract: COLLECTION,
              image_url: "https://attacker.example/1755.png", rarity: { rank: "41" } },
            { identifier: "9", collection: "foreign", contract: COLLECTION },
            { identifier: "1797", collection: "gogh-punks-255843210",
              contract: "0x9999999999999999999999999999999999999999" },
          ],
          next: null,
        }),
      };
    },
  });
  assert.deepEqual(result, ["1639", "1755"]);
  assert.match(calls[0].url, /chain\/robinhood\/account\/0x1234/);
  assert.match(calls[0].url, /collection=gogh-punks-255843210/);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["x-api-key"], "server-side-test-key");
});

test("OpenSea owner decorations carry allowlisted artwork and current rarity rank only", async () => {
  const result = await openSeaOwnerPunks(OWNER, {
    apiKey: "server-side-test-key",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        nfts: [{
          identifier: "93", collection: "gogh-punks-255843210", contract: COLLECTION,
          name: "Gogh Punk #93", display_image_url: "https://i.seadn.io/s/raw/files/93.png",
          rarity: { strategy_id: "openrarity", strategy_version: "1.0", rank: 1800 },
        }],
        next: null,
      }),
    }),
  });
  assert.equal(result[0].artwork.imageUrl, "https://i.seadn.io/s/raw/files/93.png");
  assert.deepEqual(result[0].rarity, {
    source: "OPENSEA_OPENRARITY_CURRENT",
    rank: 1800,
    proposedTier: "UNCOMMON",
    rankBandSupply: 5016,
    strategyId: "openrarity",
    strategyVersion: "1.0",
    permanentSnapshot: false,
  });
  assert.equal(proposedRetirementTierForOpenSeaRank(1), "MYTHIC");
  assert.equal(proposedRetirementTierForOpenSeaRank(5016), "COMMON");
  assert.equal(proposedRetirementTierForOpenSeaRank(5017), null);
});

test("cached images win while OpenSea fills missing artwork and never upgrades rarity to proof", () => {
  const result = mergeOwnerPunkDecorations(["93", "94"], [{
    tokenId: "93", artwork: { name: "Cached #93", imageUrl: "https://i.seadn.io/cached.png" },
  }, { tokenId: "94", artwork: { name: "Cached #94", imageUrl: null } }], [{
    tokenId: "93", artwork: { name: "OpenSea #93", imageUrl: "https://i.seadn.io/os93.png" },
    rarity: { source: "OPENSEA_OPENRARITY_CURRENT", rank: 9 },
  }, {
    tokenId: "94", artwork: { name: "OpenSea #94", imageUrl: "https://i.seadn.io/os94.png" },
    rarity: { source: "OPENSEA_OPENRARITY_CURRENT", rank: 10 },
  }], ["94"], ["93"]);
  assert.equal(result[0].artwork.name, "Cached #93");
  assert.equal(result[0].rarity.rank, 9);
  assert.equal(result[1].artwork.name, "OpenSea #94");
  assert.equal(result[0].automationConfigured, false);
  assert.equal(result[1].automationConfigured, true);
  assert.equal(result[0].automationCreated, true);
  assert.equal(result[1].automationCreated, false);
});

test("canonical on-chain tokenURI supplies keyless artwork and only a rarity preview", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
  const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const metadata = `data:application/json;base64,${Buffer.from(JSON.stringify({
    name: "Gogh Punk #93",
    image,
    attributes: [{ trait_type: "Rarity", value: "Rare" }],
  })).toString("base64")}`;
  const result = encodeFunctionResult({
    abi: TOKEN_URI_ABI,
    functionName: "tokenURI",
    result: metadata,
  });
  const decoded = decodeOnchainPunkDecoration(result, "93");
  assert.equal(decoded.artwork.name, "Gogh Punk #93");
  assert.equal(decoded.artwork.imageUrl, image);
  assert.deepEqual(decoded.rarity, {
    source: "ONCHAIN_METADATA_TRAIT_CURRENT",
    proposedTier: "RARE",
    permanentSnapshot: false,
  });

  const calls = [];
  const hydrated = await hydrateOnchainPunkDecorations({
    async request(call) { calls.push(call); return result; },
  }, COLLECTION, [{ tokenId: "93", artwork: null, rarity: null }]);
  assert.equal(hydrated[0].artwork.imageUrl, image);
  assert.equal(hydrated[0].rarity.proposedTier, "RARE");
  assert.equal(calls[0].params[0].data.slice(0, 10), "0xc87b56dd");
});

test("initial artwork hydration is limited to active agents and the selected Punk", () => {
  const accounts = [
    { tokenId: "1", activated: false, automationConfigured: false },
    { tokenId: "2", activated: true, automationConfigured: false },
    { tokenId: "3", activated: false, automationConfigured: true },
    { tokenId: "4", activated: false, automationConfigured: false, automationCreated: true },
    { tokenId: "5", activated: false, automationConfigured: false },
  ];
  assert.deepEqual(priorityArtworkAccounts(accounts).map(({ tokenId }) => tokenId), ["2", "3", "4"]);
  assert.deepEqual(priorityArtworkAccounts(accounts, "5").map(({ tokenId }) => tokenId),
    ["2", "3", "4", "5"]);
});

test("wallet rechecks ownership and labels activated versus activatable Punks", async () => {
  const aggregate = (words) => encodeFunctionResult({
    abi: MULTICALL_ABI,
    functionName: "aggregate3",
    result: words.map((value) => [true, value]),
  });
  const responses = [
    aggregate([addressWord(OWNER), addressWord(OWNER), addressWord(REGISTRY)]),
    aggregate([addressWord(ACCOUNT_A), addressWord(ACCOUNT_B), addressWord(ACCOUNT_B)]),
    aggregate([`0x${1n.toString(16).padStart(64, "0")}`,
      `0x${0n.toString(16).padStart(64, "0")}`,
      `0x${0n.toString(16).padStart(64, "0")}`]),
  ];
  const calls = [];
  const provider = {
    async request(call) {
      calls.push(call);
      if (call.method === "eth_call" && call.params[0].to
        === "0xca11bde05977b3631167028862be2a173976ca11") return responses[calls.length - 1];
      throw new Error(`unexpected ${call.method}`);
    },
  };
  const gate = { capability: true, bindings: { punkCollection: COLLECTION,
    accountRegistry: REGISTRY } };
  const result = await findBrowserOwnedPunks(provider, gate, OWNER, ["7", "8", "9"]);
  assert.deepEqual(result.map(({ tokenId, activated }) => ({ tokenId, activated })), [
    { tokenId: "7", activated: true },
    { tokenId: "8", activated: false },
  ]);
  assert.equal(calls.length, 3);
});

test("live-verified activated Punks remain visible when the wallet scan is incomplete", () => {
  const result = mergeWalletAndActivatedPunks(["7", "8"], [{
    tokenId: "8", account: ACCOUNT_A, owner: OWNER, status: "ACTIVATED_ONCHAIN",
  }, {
    tokenId: "93", account: ACCOUNT_B, owner: OWNER, status: "ACTIVATED_ONCHAIN",
  }], OWNER);
  assert.deepEqual(result.map(({ tokenId, activated }) => ({ tokenId, activated })), [
    { tokenId: "7", activated: false },
    { tokenId: "8", activated: true },
    { tokenId: "93", activated: true },
  ]);
  assert.throws(() => mergeWalletAndActivatedPunks([], [{
    tokenId: "93", account: ACCOUNT_B, owner: REGISTRY,
  }], OWNER), /evidence/);
});

test("wallet scan ABI-matches Multicall3 and discovers every owned token in the bounded supply", async () => {
  const tokenIds = ["0", "1", "2"];
  const calls = tokenIds.map((tokenId) => ({
    target: COLLECTION,
    allowFailure: true,
    callData: `0x6352211e${BigInt(tokenId).toString(16).padStart(64, "0")}`,
  }));
  assert.equal(encodeOwnerOfMulticall(COLLECTION, tokenIds), encodeFunctionData({
    abi: MULTICALL_ABI,
    functionName: "aggregate3",
    args: [calls],
  }));
  const ownerWord = addressWord(OWNER);
  const result = encodeFunctionResult({
    abi: MULTICALL_ABI,
    functionName: "aggregate3",
    result: [[true, ownerWord], [false, "0x"], [true, addressWord(REGISTRY)]],
  });
  assert.deepEqual(decodeOwnerOfMulticall(result, tokenIds, OWNER), ["0"]);

  const providerCalls = [];
  const provider = { async request(call) {
    providerCalls.push(call);
    if (providerCalls.length === 1) return `0x${2n.toString(16).padStart(64, "0")}`;
    return result;
  } };
  assert.deepEqual(await discoverWalletOwnedPunkIds(provider, COLLECTION, OWNER), ["0"]);
  assert.equal(providerCalls[1].params[0].to,
    "0xca11bde05977b3631167028862be2a173976ca11");
});

test("broker picker selects only a live-verified wallet-owned Punk", async () => {
  const [html, accounts, endpoint] = await Promise.all([
    readFile(new URL("../site/broker/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/owner-accounts.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-owner-punks.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(html, /data-owned-punk-picker|data-account-activation/);
  assert.doesNotMatch(html, /data-mandate-punk-picker/);
  assert.match(html, /data-workspace-punk-picker/);
  assert.match(html, /data-workspace-punk-preview/);
  assert.match(html, /<select data-wizard-punks disabled>/);
  assert.match(html, /data-punk-gallery-primary/);
  assert.doesNotMatch(html, /data-activation-token/);
  assert.match(html, /data-owned-punk-count/);
  assert.match(html, /data-selected-punk-display/);
  assert.doesNotMatch(html, /Scout Punk<\/span><strong data-scout-token-display/);
  assert.match(accounts, /findBrowserOwnedPunks/);
  assert.match(accounts, /view=indexed/);
  assert.match(accounts, /view=reconcile/);
  assert.match(accounts, /Live ownership verified from indexed roster/);
  assert.match(accounts, /balanceOf is the cheap/);
  assert.match(accounts, /accounts\.length !== liveBalance/);
  assert.match(accounts, /renderSelectedPunkPreview/);
  assert.match(accounts, /priorityArtworkAccounts/);
  assert.match(accounts, /gogh:punk-selected/);
  assert.match(accounts, /gogh:owner-punks/);
  assert.match(accounts, /gogh:select-punk-request/);
  assert.match(endpoint, /DISCOVERY_CANDIDATES_ONLY_EACH_SELECTION_REQUIRES_LIVE_WALLET_OWNER_CHECK/);
  assert.match(endpoint, /liveMulticall: true/);
  assert.match(endpoint, /openSea: openSeaAvailable/);
  assert.match(endpoint, /called only after an owner connects/);
  assert.match(endpoint, /unrelated marketplace API/);
  assert.match(accounts, /discoverWalletOwnedPunkIds/);
  assert.match(accounts, /Copy V1 wallet address/);
  assert.match(accounts, /Legacy V1 Punk wallet/);
  assert.match(accounts, /https:\/\/opensea\.io\/\$\{item\.account\}/);
  assert.match(accounts, /data-selected-gallery-link/);
  assert.doesNotMatch(accounts, /new Set\(\["1639", "1797"/);
  assert.doesNotMatch(html, /href="\/punk\/1797"/);
  assert.doesNotMatch(html, /OWNER ONLY/);
  assert.doesNotMatch(accounts, /accounts\.find\(\(\{ tokenId \}\) => tokenId === "1797"\)/);
  assert.doesNotMatch(endpoint, /eth_send|privateKey|mnemonic/);
});

test("selected gallery navigation uses only the wallet-chosen Punk", () => {
  assert.equal(selectedPunkGalleryPath("93"), "/punk/93");
  assert.equal(selectedPunkGalleryPath("0"), "/punk/0");
  assert.throws(() => selectedPunkGalleryPath("01797"));
});
