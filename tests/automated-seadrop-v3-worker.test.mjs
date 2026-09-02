import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  activeZeroPriceSeaDropCollections,
  configuredAutomationV3PunkIds,
  configuredPrioritySeaDropCollections,
  configuredSeaDropCollections,
  confirmedAutomationV3GlobalState,
  confirmedIntentWindow,
  eligibleAutomationV3Profiles,
  fairlyOrderedAutomationV3Profiles,
  incrementalSeaDropCollections,
  mergePrioritySeaDropCollections,
  recentSeaDropCollections,
  recordWorkerFailureProfileOutcomes,
  rarityPriorityBoostSeconds,
  rotateAutomationV3Profiles,
  runAutomatedSeaDropV3Worker,
  scheduledAutomationV3ProfileBatch,
  selectAutomationV3RouteCandidates,
  selectActiveZeroPriceSeaDropCollections,
  selectReviewedStudioCollections,
  workerFailureProfileTokenIds,
  workerStageError,
} from "../scripts/run-automated-seadrop-v3-worker.mjs";
import {
  automationV3WorkerAvailability, automationV3WorkerConfigured, autonomyV3Status,
} from "../netlify/functions/broker-autonomy-v3-status.mjs";
import { automationV3Activity } from
  "../netlify/functions/broker-autonomy-v3-activity.mjs";

test("V3 worker remains disabled by default and uses the confirmed intent horizon", async () => {
  assert.deepEqual(await runAutomatedSeaDropV3Worker({}), {
    status: "DISABLED", submitted: 0,
  });
  assert.deepEqual(confirmedIntentWindow(1_000), { createdAt: 970, expiresAt: 1_090 });
});

test("platform discovery failures keep scheduled Punks queued instead of requiring repair", () => {
  const diagnostics = {
    scheduledTokenIds: ["1918", "1920"],
    processedTokenIds: [],
    profileOutcomes: [],
  };
  recordWorkerFailureProfileOutcomes(diagnostics, "DISCOVERY_RPC_UNAVAILABLE");
  assert.deepEqual(diagnostics.profileOutcomes, [
    {
      tokenId: "1918", state: "QUEUED",
      reason: "WAITING_FOR_PLATFORM_RECOVERY", account: null,
    },
    {
      tokenId: "1920", state: "QUEUED",
      reason: "WAITING_FOR_PLATFORM_RECOVERY", account: null,
    },
  ]);
  recordWorkerFailureProfileOutcomes(diagnostics, "DISCOVERY_INDEX_READ_FAILED", {
    affectedTokenIds: ["1920"],
  });
  assert.deepEqual(diagnostics.profileOutcomes[1], {
    tokenId: "1920", state: "QUEUED",
    reason: "WAITING_FOR_PLATFORM_RECOVERY", account: null,
  });
  recordWorkerFailureProfileOutcomes(diagnostics, "PROFILE_STATE_READ_FAILED", {
    affectedTokenIds: ["1920"],
  });
  assert.deepEqual(diagnostics.profileOutcomes[1], {
    tokenId: "1920", state: "QUEUED",
    reason: "WAITING_FOR_PLATFORM_RECOVERY", account: null,
  });
  recordWorkerFailureProfileOutcomes(diagnostics, "AUTONOMOUS_MINT_REVERTED", {
    affectedTokenIds: ["1918"],
  });
  assert.deepEqual(diagnostics.profileOutcomes[0], {
    tokenId: "1918", state: "ERROR", reason: "AUTONOMOUS_MINT_REVERTED", account: null,
  });
});

test("V3 global gate retries one closed public-RPC sample and still fails closed", async () => {
  const open = { configured: true, worker: { enabled: true } };
  const closed = { configured: false, worker: { enabled: true } };
  let reads = 0;
  let pauses = 0;
  assert.equal(await confirmedAutomationV3GlobalState(async () => {
    reads += 1;
    return reads === 1 ? closed : open;
  }, async () => { pauses += 1; }), open);
  assert.equal(reads, 2);
  assert.equal(pauses, 1);

  reads = 0;
  assert.equal(await confirmedAutomationV3GlobalState(async () => {
    reads += 1;
    return closed;
  }, async () => {}), closed);
  assert.equal(reads, 2);
});

test("hosted rotation applies a bounded rarity head start without bypassing owner fairness", async () => {
  assert.deepEqual([
    rarityPriorityBoostSeconds(1),
    rarityPriorityBoostSeconds(51),
    rarityPriorityBoostSeconds(52),
    rarityPriorityBoostSeconds(252),
    rarityPriorityBoostSeconds(754),
    rarityPriorityBoostSeconds(1_757),
    rarityPriorityBoostSeconds(3_011),
    rarityPriorityBoostSeconds(null),
  ], [1_200, 1_200, 600, 300, 120, 60, 0, 0]);

  let query;
  const profiles = [
    { token_id: "93", configured_by: "0x1111111111111111111111111111111111111111" },
    { token_id: "94", configured_by: "0x2222222222222222222222222222222222222222" },
  ];
  const ordered = await fairlyOrderedAutomationV3Profiles({
    query: async (sql, values) => {
      query = { sql, values };
      return { rows: [{ punk_token_id: "94" }, { punk_token_id: "93" }] };
    },
  }, profiles);
  assert.deepEqual(ordered.map(({ token_id }) => token_id), ["94", "93"]);
  assert.match(query.sql, /broker_punk_rarity_cache/);
  assert.match(query.sql, /effective_last_scheduled_scan/);
  assert.match(query.sql, /PARTITION BY owner_key/);
  assert.match(query.sql, /NULLS FIRST/);
});

test("V3 prefilter keeps exact reviewed clone bytecode and rejects drift", () => {
  const clone = "0x363d3d373d3d3d363d7309a26fc8fcef18192e267d7a6da9dfb4be81dd6a5af43d82803e903d91602b57fd5bf3";
  assert.deepEqual(selectReviewedStudioCollections(
    ["clone", "drift", "empty"],
    [clone, `${clone.slice(0, -2)}00`, "0x"],
  ), ["clone"]);
  assert.throws(
    () => selectReviewedStudioCollections(["clone"], []),
    /invalid reviewed Studio runtime evidence/,
  );
});

test("V3 prefilter retains only active zero-price public drops", () => {
  const collections = ["free", "paid", "closed"];
  const drop = (overrides = {}) => ({
    mintPrice: 0n,
    startTime: 900n,
    endTime: 1_100n,
    maxTotalMintableByWallet: 1,
    feeBps: 0,
    restrictFeeRecipients: false,
    ...overrides,
  });
  assert.deepEqual(selectActiveZeroPriceSeaDropCollections(collections, [
    { status: "success", result: drop() },
    { status: "success", result: drop({ mintPrice: 1n }) },
    { status: "success", result: drop({ endTime: 999n }) },
  ], 1_000n), ["free"]);
});

test("V3 directed targets are exact, bounded, and cannot be ambiguous", () => {
  const first = "0x1111111111111111111111111111111111111111";
  const second = "0x2222222222222222222222222222222222222222";
  assert.equal(configuredSeaDropCollections({}), null);
  assert.deepEqual(configuredSeaDropCollections({
    BROKER_AUTOMATION_V3_TARGET_COLLECTIONS: `${first},${second}`,
  }), [first, second]);
  assert.throws(() => configuredSeaDropCollections({
    BROKER_AUTOMATION_V3_TARGET_COLLECTIONS: `${first},${first}`,
  }), /duplicate directed/);
  assert.throws(() => configuredSeaDropCollections({
    BROKER_AUTOMATION_V3_TARGET_COLLECTIONS: `${first}, ${second}`,
  }), /invalid directed/);
  assert.throws(() => configuredSeaDropCollections({
    BROKER_AUTOMATION_V3_TARGET_COLLECTIONS: "0x1234",
  }));
  assert.deepEqual(configuredPrioritySeaDropCollections({
    BROKER_AUTOMATION_V3_PRIORITY_COLLECTIONS: second,
  }), [second]);
  assert.deepEqual(mergePrioritySeaDropCollections(
    [second], [first, second],
  ), [second, first]);
});

test("V3 route selection adds Scatter without starving SeaDrop and rotates reviewed targets", () => {
  const scatter = Array.from({ length: 5 }, (_, index) => ({
    collection: `scatter-${index}`,
  }));
  assert.deepEqual(
    selectAutomationV3RouteCandidates(scatter, ["sea-0", "sea-1", "sea-2"], 1)
      .map(({ kind, collection }) => [kind, collection]),
    [
      ["SCATTER", "scatter-1"], ["SCATTER", "scatter-2"],
      ["SEADROP", "sea-0"], ["SEADROP", "sea-1"],
    ],
  );
  assert.deepEqual(
    selectAutomationV3RouteCandidates(scatter, [], 4)
      .map(({ kind, collection }) => [kind, collection]),
    [
      ["SCATTER", "scatter-4"], ["SCATTER", "scatter-0"],
      ["SCATTER", "scatter-1"], ["SCATTER", "scatter-2"],
    ],
  );
});

test("V3 operator roster is canonical, unique, and bounded", () => {
  assert.deepEqual(configuredAutomationV3PunkIds({}), []);
  assert.deepEqual(configuredAutomationV3PunkIds({
    BROKER_AUTOMATION_V3_PUNK_IDS: "1797,1793,1772",
  }), ["1797", "1793", "1772"]);
  for (const value of ["01797", "1797,1797", "1797, 1793", "10000", ""]) {
    if (value === "") continue;
    assert.throws(() => configuredAutomationV3PunkIds({
      BROKER_AUTOMATION_V3_PUNK_IDS: value,
    }), /invalid configured V3 Punk list/);
  }
  assert.throws(() => configuredAutomationV3PunkIds({
    BROKER_AUTOMATION_V3_PUNK_IDS: Array.from({ length: 33 }, (_, index) => String(index)).join(","),
  }), /invalid configured V3 Punk list/);
});

test("V3 automatic profile uses enrolled, saved, configured, or immediately requested Punks", async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{
        token_id: "93", configured_by: null, economic_settings: null,
        risk_settings: null, artistic_preferences: null, automatic_profile: true,
      }] };
    },
  };
  const scheduled = await eligibleAutomationV3Profiles(database, null, ["1797"]);
  assert.deepEqual(scheduled.map((row) => String(row.token_id)), ["93"]);
  assert.equal(calls[0].values[3], 10_000);
  assert.deepEqual(calls[0].values[4], ["1797"]);
  assert.match(calls[0].sql, /broker_automation_v3_enrollments/);
  assert.match(calls[0].sql, /latest_saved_punks/);
  assert.match(calls[0].sql, /UNNEST\(\$5::numeric\[\]\)/);
  assert.match(calls[0].sql, /broker_scouting_schedules/);
  assert.match(calls[0].sql, /NOW\(\) >= schedule\.start_at/);
  assert.doesNotMatch(calls[0].sql, /m\.mode = 'AUTONOMOUS'/);

  const immediate = await eligibleAutomationV3Profiles(
    { query: async () => ({ rows: [] }) }, "1639", [],
  );
  assert.equal(String(immediate[0].token_id), "1639");
  assert.equal(immediate[0].automatic_profile, true);

  const configuredAndRequested = await eligibleAutomationV3Profiles(
    { query: async () => ({ rows: [] }) }, "1797", ["1797"],
  );
  assert.deepEqual(configuredAndRequested.map(({ token_id }) => token_id), ["1797"]);
});

test("V3 worker failures retain bounded stage diagnostics without leaking messages", () => {
  const generic = workerStageError("PROFILE_DATABASE_READ_FAILED", new Error("secret detail"));
  assert.equal(generic.code, "PROFILE_DATABASE_READ_FAILED");
  assert.equal(generic.message, "PROFILE_DATABASE_READ_FAILED");
  assert.equal(generic.cause.message, "secret detail");

  const classified = Object.assign(new Error("provider detail"), {
    code: "DISCOVERY_RPC_UNAVAILABLE",
  });
  assert.equal(workerStageError("DISCOVERY_SCAN_FAILED", classified), classified);
  assert.throws(() => workerStageError("not bounded", new Error()), /invalid worker stage/);
});

test("a submitted transaction failure belongs only to the Punk that sent it", () => {
  const diagnostics = { scheduledTokenIds: ["1788", "1793", "93"] };
  assert.deepEqual(workerFailureProfileTokenIds(diagnostics, "1788"), ["1788"]);
  assert.deepEqual(workerFailureProfileTokenIds(diagnostics), ["1788", "1793", "93"]);
  assert.throws(
    () => workerFailureProfileTokenIds(diagnostics, "94"),
    /not in the scheduled worker batch/,
  );
});

test("V3 public status distinguishes a safe automatic retry from an unstarted worker", () => {
  const release = "a".repeat(40);
  const failed = {
    release,
    status: "FAILED",
    completedAt: "2026-08-26T12:00:00.000Z",
  };
  assert.deepEqual(
    automationV3WorkerAvailability(true, failed, release, Date.parse(failed.completedAt)),
    {
      online: false,
      executionReady: false,
      status: "WORKER_RECOVERING",
      reason: "WORKER_RETRYING",
      platformHealth: {
        status: "RECOVERING",
        reason: "WORKER_RETRYING",
        lastSuccessfulAt: null,
        consecutiveFailures: 1,
      },
    },
  );
  assert.equal(automationV3WorkerAvailability(true, null, release).status, "WORKER_OUTAGE");
});

test("V3 public status requires the exact production worker binding", () => {
  const release = "a".repeat(40);
  const configured = {
    BROKER_AUTOMATION_V3_ENABLED: "true",
    BROKER_AUTOMATION_V3_WORKER_RELEASE: release,
    BROKER_AUTOMATION_V3_AGENT_ADDRESS:
      "0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d",
  };
  assert.equal(automationV3WorkerConfigured(configured), true);
  assert.equal(automationV3WorkerConfigured({ ...configured,
    BROKER_AUTOMATION_V3_ENABLED: "false" }), false);
  assert.equal(automationV3WorkerConfigured({ ...configured,
    BROKER_AUTOMATION_V3_WORKER_RELEASE: "not-a-release" }), false);
  assert.equal(automationV3WorkerConfigured({ ...configured,
    BROKER_AUTOMATION_V3_AGENT_ADDRESS:
      "0x0000000000000000000000000000000000000000" }), false);
});

test("lightweight browser activity uses recorded worker state without chain RPC", () => {
  const now = Date.parse("2026-08-26T12:00:00.000Z");
  const release = "a".repeat(40);
  const heartbeat = {
    release, startedAt: "2026-08-26T11:59:56.000Z",
    completedAt: "2026-08-26T11:59:58.000Z", status: "NO_ELIGIBLE_TARGETS",
    submitted: 0, tokenId: null, account: null, collection: null,
    transactionHash: null, failureCode: null,
  };
  const usage = { confirmedMints: "17" };
  const activity = automationV3Activity(heartbeat, usage, {
    BROKER_AUTOMATION_V3_ENABLED: "true",
    BROKER_AUTOMATION_V3_WORKER_RELEASE: release,
  }, now);
  assert.equal(activity.online, true);
  assert.equal(activity.heartbeat.status, "NO_ELIGIBLE_TARGETS");
  assert.equal(activity.usage.confirmedMints, "17");
  assert.equal(activity.punk, null);
});

test("scheduled V3 runs rotate fairly after the most recently successful Punk", async () => {
  const profiles = ["93", "94", "1728", "1797"].map((token_id) => ({ token_id }));
  assert.deepEqual(
    rotateAutomationV3Profiles(profiles, "94").map(({ token_id }) => token_id),
    ["1728", "1797", "93", "94"],
  );
  assert.deepEqual(
    rotateAutomationV3Profiles(profiles, "1797").map(({ token_id }) => token_id),
    ["93", "94", "1728", "1797"],
  );
  const database = { query: async (_sql, values) => {
    assert.deepEqual(values, [
      ["93", "94", "1728", "1797"],
      ["punk:93", "punk:94", "punk:1728", "punk:1797"],
    ]);
    return { rows: ["1728", "93", "1797", "94"].map((punk_token_id) => ({ punk_token_id })) };
  } };
  assert.deepEqual(
    (await fairlyOrderedAutomationV3Profiles(database, profiles)).map(({ token_id }) => token_id),
    ["1728", "93", "1797", "94"],
  );
  const directlyRequested = await fairlyOrderedAutomationV3Profiles(
    { query: async () => { throw new Error("must not query cursor"); } },
    [{ token_id: "1728" }], "1728",
  );
  assert.equal(directlyRequested[0].token_id, "1728");
});

test("scheduled V3 fairness gives each owner a turn before a large holder gets another", async () => {
  const largeOwner = "0x1111111111111111111111111111111111111111";
  const smallOwner = "0x2222222222222222222222222222222222222222";
  const profiles = ["93", "94", "95", "96", "3693"].map((token_id) => ({
    token_id,
    configured_by: token_id === "3693" ? smallOwner : largeOwner,
  }));
  const database = { query: async (sql, values) => {
    assert.match(sql, /ROW_NUMBER\(\) OVER/);
    assert.match(sql, /PARTITION BY owner_key/);
    assert.deepEqual(values[1], [largeOwner, largeOwner, largeOwner, largeOwner, smallOwner]);
    // PostgreSQL returns one round per owner before the second Punk belonging
    // to the same owner. Preserve that order exactly in the worker batch.
    return { rows: ["3693", "93", "94", "95", "96"].map((punk_token_id) => ({
      punk_token_id,
    })) };
  } };
  assert.deepEqual(
    (await fairlyOrderedAutomationV3Profiles(database, profiles)).map(({ token_id }) => token_id),
    ["3693", "93", "94", "95", "96"],
  );
});

test("scheduled V3 fairness cursor failure keeps the bounded roster available", async () => {
  const reports = [];
  const profiles = [{ token_id: "94" }, { token_id: "93" }];
  const ordered = await fairlyOrderedAutomationV3Profiles({
    query: async () => { throw new TypeError("database unavailable"); },
  }, profiles, null, (value) => reports.push(value));
  assert.deepEqual(ordered.map(({ token_id }) => token_id), ["93", "94"]);
  assert.match(reports[0], /AUTOMATION_V3_FAIRNESS_CURSOR_UNAVAILABLE/);
});

test("scheduled V3 passes rotate through a bounded roster without starving later Punks", () => {
  const profiles = Array.from({ length: 15 }, (_, tokenId) => ({ token_id: String(tokenId) }));
  assert.deepEqual(
    scheduledAutomationV3ProfileBatch(profiles, null, 0).map(({ token_id }) => token_id),
    ["0", "1", "2", "3", "4", "5"],
  );
  assert.deepEqual(
    scheduledAutomationV3ProfileBatch(profiles, null, 300_000).map(({ token_id }) => token_id),
    ["6", "7", "8", "9", "10", "11"],
  );
  assert.deepEqual(
    scheduledAutomationV3ProfileBatch(profiles, null, 600_000).map(({ token_id }) => token_id),
    ["12", "13", "14"],
  );
  assert.deepEqual(
    scheduledAutomationV3ProfileBatch(profiles, "14", 600_000).map(({ token_id }) => token_id),
    profiles.map(({ token_id }) => token_id),
  );
  assert.deepEqual(
    scheduledAutomationV3ProfileBatch(profiles, null, 600_000, 6, true)
      .map(({ token_id }) => token_id),
    ["0", "1", "2", "3", "4", "5"],
  );
  assert.throws(() => scheduledAutomationV3ProfileBatch(profiles, null, -1));
});

test("scheduled V3 passes include enrolled Punks beyond the former 32-Punk ceiling", async () => {
  const rows = Array.from({ length: 96 }, (_, tokenId) => ({
    token_id: String(tokenId), configured_by: null, economic_settings: null,
    risk_settings: null, artistic_preferences: null, automatic_profile: true,
  }));
  const profiles = await eligibleAutomationV3Profiles({
    query: async (_sql, values) => {
      assert.equal(values[3], 10_000);
      return { rows };
    },
  });
  assert.equal(profiles.length, 96);

  const scheduledTokenIds = new Set();
  for (let window = 0; window < 16; window += 1) {
    for (const { token_id: tokenId } of scheduledAutomationV3ProfileBatch(
      profiles, null, window * 300_000,
    )) scheduledTokenIds.add(tokenId);
  }
  assert.equal(scheduledTokenIds.size, 96);
  assert.equal(scheduledTokenIds.has("95"), true);
});

test("V3 discovery has a bounded parallel RPC ceiling", async () => {
  let active = 0;
  let maximumActive = 0;
  const ranges = [];
  const collections = await recentSeaDropCollections({
    getBlockNumber: async () => 1_000_000n,
    getLogs: async ({ fromBlock, toBlock }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      ranges.push([fromBlock, toBlock]);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return [];
    },
  }, 20n, { pause: async () => {} });
  assert.deepEqual(collections, []);
  assert.equal(ranges.length, 16);
  assert.equal(maximumActive, 4);
  assert.equal(ranges[0][1] - ranges.at(-1)[0] + 1n, 80_000n);
});

test("V3 discovery keeps safe successful hints when one bounded range fails", async () => {
  let calls = 0;
  const reports = [];
  const collections = await recentSeaDropCollections({
    getBlockNumber: async () => 100_000n,
    getLogs: async () => {
      calls += 1;
      if (calls === 3) throw new TypeError("provider timeout");
      return [];
    },
  }, 20n, { pause: async () => {}, report: (value) => reports.push(value) });
  assert.deepEqual(collections, []);
  assert.equal(calls, 16);
  assert.match(reports[0], /AUTOMATION_V3_DISCOVERY_PARTIAL/);
  assert.match(reports[0], /"failedRanges":1/);
});

test("V3 discovery fails closed when every bounded hint range fails", async () => {
  let calls = 0;
  await assert.rejects(() => recentSeaDropCollections({
    getBlockNumber: async () => 100_000n,
    getLogs: async () => {
      calls += 1;
      throw new TypeError("provider timeout");
    },
  }, 20n, { pause: async () => {}, report: () => {} }), (error) => {
    assert.equal(error.code, "DISCOVERY_RPC_UNAVAILABLE");
    return true;
  });
  assert.equal(calls, 16);
});

test("incremental discovery uses indexed hints when both log providers are unavailable", async () => {
  const collection = `0x${"1".repeat(40)}`;
  const reports = [];
  const result = await incrementalSeaDropCollections({
    getBlockNumber: async () => { throw new TypeError("primary unavailable"); },
  }, {
    query: async (sql) => {
      assert.match(sql, /broker_seadrop_public_drops/);
      return { rows: [{ collection_address: collection }] };
    },
  }, 20n, {
    fallbackClient: {
      getBlockNumber: async () => { throw new TypeError("fallback unavailable"); },
    },
    report: (value) => reports.push(value),
  });
  assert.deepEqual(result, [collection]);
  assert.equal(reports.some((value) => /DISCOVERY_INDEX_FALLBACK/.test(value)), true);
  assert.equal(reports.some((value) => /HEAD_UNAVAILABLE/.test(value)), true);
});

test("V3 candidate prefilter tolerates partial read failure but not total outage", async () => {
  const freeDrop = {
    mintPrice: 0n, startTime: 900n, endTime: 1_100n,
    maxTotalMintableByWallet: 1, feeBps: 0, restrictFeeRecipients: false,
  };
  let reads = 0;
  const client = {
    getBlockNumber: async () => 1_020n,
    getBlock: async () => ({ timestamp: 1_000n }),
    readContract: async () => {
      reads += 1;
      if (reads === 1) throw new TypeError("provider timeout");
      return freeDrop;
    },
  };
  const clone = "0x363d3d373d3d3d363d7309a26fc8fcef18192e267d7a6da9dfb4be81dd6a5af43d82803e903d91602b57fd5bf3";
  assert.deepEqual(await activeZeroPriceSeaDropCollections(
    client, { getCode: async () => clone },
    ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"],
  ), ["0x2222222222222222222222222222222222222222"]);

  await assert.rejects(() => activeZeroPriceSeaDropCollections({
    getBlockNumber: async () => 1_020n,
    getBlock: async () => ({ timestamp: 1_000n }),
    readContract: async () => { throw new TypeError("provider timeout"); },
  }, { getCode: async () => clone }, ["0x1111111111111111111111111111111111111111"]),
  (error) => {
    assert.equal(error.code, "DISCOVERY_RPC_UNAVAILABLE");
    return true;
  });

  let fallbackDropReads = 0;
  assert.deepEqual(await activeZeroPriceSeaDropCollections({
    getBlockNumber: async () => { throw new TypeError("primary unavailable"); },
    readContract: async () => { throw new TypeError("primary unavailable"); },
    getCode: async () => { throw new TypeError("primary unavailable"); },
  }, {
    getBlockNumber: async () => 1_020n,
    getBlock: async () => ({ timestamp: 1_000n }),
    readContract: async () => { fallbackDropReads += 1; return freeDrop; },
    getCode: async () => clone,
  }, ["0x1111111111111111111111111111111111111111"]), [
    "0x1111111111111111111111111111111111111111",
  ]);
  assert.equal(fallbackDropReads, 1);
});

test("V3 worker source binds both mint routes and no paid or approval path", async () => {
  const source = await readFile(
    new URL("../scripts/run-automated-seadrop-v3-worker.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /CLONE_COLLECTION_RUNTIME_CODE_HASH/);
  assert.match(source, /STUDIO_COLLECTION_RUNTIME_CODE_HASH/);
  assert.match(source, /length === 45/);
  assert.match(source, /length === 19_658/);
  assert.match(source, /maxMintsPerRun: 1/);
  assert.match(source, /value: 0n/);
  assert.match(source, /buildAutomatedSeaDropV3ExecutionBatch/);
  assert.match(source, /buildAutomatedScatterV3Execution/);
  assert.match(source, /attestAutomatedScatterV3CandidateLive/);
  assert.match(source, /primary\.call\(\{ account: agent/);
  assert.match(source, /secondary\.call\(\{ account: agent/);
  assert.match(source, /DISCOVERY_COLLECTION_LIMIT = 16/);
  assert.match(source, /DISCOVERY_LOG_CHUNK_SIZE = 5_000n/);
  assert.match(source, /DISCOVERY_MAX_LOG_CHUNKS = 16n/);
  assert.match(source, /DISCOVERY_LOG_BATCH_SIZE = 4/);
  assert.match(source, /retryCount: 0, timeout: 5_000/);
  assert.match(source, /DISCOVERY_BLOCK_WINDOW = DISCOVERY_LOG_CHUNK_SIZE \* DISCOVERY_MAX_LOG_CHUNKS/);
  assert.doesNotMatch(source, /toBlock > 1_000_000n/);
  assert.doesNotMatch(source, /DISCOVERY_LOG_CHUNK_SIZE = 50_000n/);
  assert.match(source, /collections\.size >= DISCOVERY_COLLECTION_LIMIT/);
  assert.match(source, /DIRECTED_COLLECTION_LIMIT = 8/);
  assert.match(source, /BROKER_AUTOMATION_V3_TARGET_COLLECTIONS/);
  assert.match(source, /BROKER_AUTOMATION_V3_PRIORITY_COLLECTIONS/);
  assert.match(source, /prioritySlotReservations/);
  assert.match(source, /acquisitionsToday >= liveCap - 1/);
  assert.match(source, /DISCOVERY_BATCH_SIZE = 8/);
  assert.match(source, /DISCOVERY_RUNTIME_BATCH_SIZE = 4/);
  assert.match(source, /DISCOVERY_BATCH_DELAY_MS = 250/);
  assert.match(source, /activeZeroPriceSeaDropCollections\(secondary, primary, collections\)/);
  assert.match(source, /maxContractRiskScore: 100/);
  assert.match(source, /minimumTasteMatch: 0/);
  assert.match(source, /SeaDrop discovery unavailable/);
  assert.match(source, /profileStateReadFailures/);
  assert.match(source, /candidateStateReadFailures/);
  assert.match(source, /TRANSACTION_CONFIRMATION_UNCERTAIN/);
  assert.match(source, /GLOBAL_STATE_READ_FAILED/);
  assert.match(source, /AUTOMATION_V3_WORKER_TIME_BUDGET_MS = 48_000/);
  assert.match(source, /AUTOMATION_V3_SUBMISSION_RESERVE_MS = 17_000/);
  assert.match(source, /scanBudgetExhausted: true/);
  assert.match(source, /timeout: Math\.max\(1_000, Math\.min\(8_000/);
  assert.doesNotMatch(source, /approve\(|setApprovalForAll|execute\(address,uint256,bytes/);
});

test("the verified V3 deployment remains closed until Guardian and worker configuration", () => {
  assert.deepEqual(autonomyV3Status(), {
    status: "DEPLOYED_CONFIGURATION_PENDING",
    capability: false,
    setupTransactionAvailable: false,
    automaticSubmission: false,
    reason: "AUTOMATION_V3_GUARDIAN_AND_WORKER_PENDING",
    bindings: {
      chainId: 4663,
      adapter: "0xd4316dfbcfa3f51f1a9de77aaa5d9e6edf848777",
      adapterRuntimeCodeHash:
        "0x8e99aa5602225a4aadcccc2ee4e0e5c42477ed40b5d927ee964e81d204b8b56b",
      policyModule: "0x555a0533b2575f765fe7a8c7bcf604120e76e1cd",
      policyModuleRuntimeCodeHash:
        "0x6b6e2ca26fb3c02bb620b05a21799b17f4d93a1c4d8b2af5ee83724c0b3cd88d",
      accountImplementation: "0xb24199845ca42966e755b2dad7c8a9a490afeb13",
      accountImplementationRuntimeCodeHash:
        "0x63b26b5f3bce8b3adb52d1c1d9c9067c9c24cc63e5c961a6d9e399dbf4396520",
      accountRegistry: "0x7d4f654cd95104dc22c64fc8c70937f32fcbac52",
      accountRegistryRuntimeCodeHash:
        "0x6aa5390e63f46d3712dad94040d41b8051d8d6c273c7bfb28ac7308bae63c645",
    },
  });
});
