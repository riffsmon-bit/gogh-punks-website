import { getDatabase } from "@netlify/database";
import {
  createPublicClient, createWalletClient, getAddress, http, keccak256, parseAbi,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import manifest from "../deployments/robinhood-automation-v3.json" with { type: "json" };
import coreManifest from "../deployments/robinhood.json" with { type: "json" };
import { ROBINHOOD } from "../broker/src/config.mjs";
import { resolveRobinhoodRpcPair } from
  "../broker/src/infrastructure/robinhood-rpc-endpoints.mjs";
import { attestAutomatedSeaDropV3CandidateLive } from
  "../broker/src/discovery/automated-seadrop-v3-live-screen.mjs";
import { buildAutomatedSeaDropV3ExecutionBatch } from
  "../broker/src/recommendation/automated-seadrop-v3-execution-batch.mjs";
import {
  CLONE_COLLECTION_RUNTIME_CODE_HASH, CLONE_IMPLEMENTATION,
  CLONE_IMPLEMENTATION_CODE_HASH, NATIVE_CURRENCY, SEA_DROP, SEA_DROP_CODE_HASH,
  SEA_DROP_MINT_PUBLIC_SELECTOR, STUDIO_COLLECTION_RUNTIME_CODE_HASH,
} from "../broker/src/recommendation/automated-seadrop-v3-run-plan.mjs";
import { AUTOMATION_V3_AGENT, readAutomationV3GlobalState } from
  "../netlify/functions/_shared/autonomy-v3-live.mjs";
import { PUBLIC_DROP_UPDATED_EVENT } from
  "../broker/src/discovery/seadrop-public-drop-index.mjs";
import { createOpenSeaSocialProfileSource, rankSeaDropCollections } from
  "../broker/src/discovery/social-candidate-ranking.mjs";

const ACCOUNT_ABI = parseAbi([
  "function owner() view returns (address)",
  "function acquisitionNonce() view returns (uint256)",
]);
const COLLECTION_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const REGISTRY_ABI = parseAbi(["function account(uint256 tokenId) view returns (address)"]);
const AGENT_ABI = parseAbi(["function isAuthorized(address account,address agent) view returns (bool)"]);
const POLICY_ABI = [{
  type: "function", name: "policy", stateMutability: "view", inputs: [{ type: "address" }],
  outputs: [{ type: "tuple", components: [
    { name: "config", type: "tuple", components: [
      { name: "mode", type: "uint8" }, { name: "maxSpendPerTransaction", type: "uint256" },
      { name: "maxSpendPerDay", type: "uint256" }, { name: "maxSpendPerWeek", type: "uint256" },
      { name: "maxMintPrice", type: "uint256" }, { name: "maxSecondaryPurchasePrice", type: "uint256" },
      { name: "minimumNativeReserve", type: "uint256" }, { name: "maxAcquisitionsPerDay", type: "uint32" },
      { name: "maxIntentAge", type: "uint32" }, { name: "maxSlippageBps", type: "uint16" },
      { name: "requireCollectionAllowlist", type: "bool" }, { name: "allowUnknownCollections", type: "bool" },
    ] },
    { name: "configuredBy", type: "address" }, { name: "version", type: "uint64" },
    { name: "permissionGeneration", type: "uint64" }, { name: "accountPaused", type: "bool" },
  ] }],
}, ...parseAbi([
  "function featureFlags() view returns ((bool scoutMode,bool approvalPurchases,bool autonomousPurchases,bool autonomousMints,bool unknownCollectionExecution,bool selling,bool autonomousSelling))",
  "function acquisitionUsage(address account) view returns ((uint64 dayBucket,uint32 acquisitionsToday))",
  "function approvedAdapters(address account,address adapter) view returns (bool)",
  "function approvedMintContracts(address account,address venue) view returns (bool)",
  "function approvedSelectors(address account,bytes4 selector) view returns (bool)",
  "function currencyPolicy(address account,address currency) view returns ((bool allowed,uint256 maxSpendPerTransaction,uint256 maxSpendPerDay,uint256 maxSpendPerWeek,uint256 maxMintPrice,uint256 maxSecondaryPurchasePrice))",
  "function venueCurrencyMaximum(address account,address venue,address currency) view returns (uint256)",
  "function mintControls(address account) view returns ((bool ownerApprovedMints,bool autonomousFreeMints,bool autonomousPaidMints))",
])];
const PUBLIC_DROP_ABI = Object.freeze([{
  type: "function", name: "getPublicDrop", stateMutability: "view",
  inputs: [{ name: "nftContract", type: "address" }],
  outputs: [{
    name: "drop", type: "tuple", components: [
      { name: "mintPrice", type: "uint80" }, { name: "startTime", type: "uint48" },
      { name: "endTime", type: "uint48" },
      { name: "maxTotalMintableByWallet", type: "uint16" },
      { name: "feeBps", type: "uint16" }, { name: "restrictFeeRecipients", type: "bool" },
    ],
  }],
}]);
const MINT_STATS_ABI = parseAbi([
  "function getMintStats(address minter) view returns ((uint256 minterNumMinted,uint256 currentTotalSupply,uint256 maxSupply))",
]);

const CHAIN = {
  id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD.rpcUrl] } },
};

function readClient(url, signal) {
  return createPublicClient({
    chain: CHAIN,
    transport: http(url, {
      // Public RPCs can omit responses from large mixed batches even when they
      // accept the HTTP request. Small batches plus bounded retries keep the
      // worker inside free-provider throughput without weakening dual reads.
      batch: { batchSize: 5, wait: 25 }, retryCount: 1, retryDelay: 1_000,
      timeout: 12_000, fetchOptions: signal ? { signal } : undefined,
    }),
  });
}

function discoveryClient(url, signal) {
  return createPublicClient({
    chain: CHAIN,
    // Discovery hints are non-authoritative and every selected collection is
    // subsequently re-read and simulated by both full clients. A short,
    // no-retry transport prevents a slow hint provider from consuming the
    // scheduled function's entire execution budget.
    transport: http(url, {
      batch: false, retryCount: 0, timeout: 5_000,
      fetchOptions: signal ? { signal } : undefined,
    }),
  });
}

// A scheduled run has a 60-second wall-clock ceiling. Inspect only the newest
// bounded launch set on each pass; the five-minute schedule advances this
// window continuously, while explicit priority targets remain prepended.
const DISCOVERY_COLLECTION_LIMIT = 16;
const DIRECTED_COLLECTION_LIMIT = 8;
// Robinhood's public RPC has repeatedly timed out while resolving 50,000-block
// SeaDrop log ranges. Keep each discovery hint request small; every candidate
// still passes the separate confirmed-state, runtime, policy, and simulation
// gates before submission.
const DISCOVERY_LOG_CHUNK_SIZE = 5_000n;
// Netlify gives the scheduled worker a 60-second execution budget. Broadly
// rescanning one million fast Robinhood blocks required 200 sequential RPC
// calls and could not finish inside that budget. Scan the newest 80,000 blocks
// (roughly the current launch window) in at most sixteen requests. Scheduled
// launches that must be reserved longer remain supported by the exact priority
// and directed collection lists.
const DISCOVERY_MAX_LOG_CHUNKS = 16n;
const DISCOVERY_BLOCK_WINDOW = DISCOVERY_LOG_CHUNK_SIZE * DISCOVERY_MAX_LOG_CHUNKS;
const DISCOVERY_LOG_BATCH_SIZE = 4;
const DISCOVERY_INCREMENTAL_MAX_CHUNKS = 4n;
const DISCOVERY_REORG_OVERLAP = 64n;
const DISCOVERY_BATCH_SIZE = 8;
const DISCOVERY_RUNTIME_BATCH_SIZE = 4;
const DISCOVERY_BATCH_DELAY_MS = 250;
const CONFIGURED_PUNK_LIMIT = 32;
// The operator-provided emergency roster stays deliberately small, but the durable
// enrollment/mandate roster must include the collection's complete active population.
// Scheduled runs inspect only a small rotating batch, so loading the bounded roster does
// not expand a single worker's transaction or RPC budget.
const ELIGIBLE_PROFILE_LIMIT = 10_000;
// Netlify terminates the scheduled function at 60 seconds. Keep enough time
// outside the worker for the durable heartbeat and lease cleanup, and never
// begin a transaction unless both submission and confirmation fit inside the
// remaining budget.
export const AUTOMATION_V3_WORKER_TIME_BUDGET_MS = 48_000;
const AUTOMATION_V3_SUBMISSION_RESERVE_MS = 17_000;
const AUTOMATION_V3_PROFILE_BATCH_SIZE = 6;
const AUTOMATION_V3_CANDIDATE_BATCH_SIZE = 4;

export function socialCandidateValidationLimit(environment = {}) {
  const raw = environment.AGENT_MAX_CANDIDATES_TO_VALIDATE ?? "3";
  if (typeof raw !== "string" || !/^[1-8]$/.test(raw)) {
    throw new TypeError("AGENT_MAX_CANDIDATES_TO_VALIDATE must be 1 through 8");
  }
  return Math.min(Number(raw), AUTOMATION_V3_CANDIDATE_BATCH_SIZE);
}

function discoveryDelay() {
  return new Promise((resolve) => setTimeout(resolve, DISCOVERY_BATCH_DELAY_MS));
}

function boundedWorkerCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]{1,128}$/.test(value) ? value : null;
}

export function workerStageError(code, cause) {
  const normalized = boundedWorkerCode(code);
  if (!normalized) throw new TypeError("invalid worker stage code");
  if (boundedWorkerCode(cause?.code)) return cause;
  const error = new Error(normalized, { cause });
  error.code = normalized;
  return error;
}

async function workerStage(code, operation) {
  try {
    return await operation();
  } catch (error) {
    throw workerStageError(code, error);
  }
}

function readFacade(raw, url) {
  return Object.freeze({
    transport: Object.freeze({ url }),
    getBlockNumber: raw.getBlockNumber.bind(raw), getBlock: raw.getBlock.bind(raw),
    getCodeEvidence: async (request) => {
      const code = (await raw.getCode(request)) ?? "0x";
      if (code === "0x") throw new TypeError("runtime code missing");
      return Object.freeze({ codeHash: keccak256(code), length: (code.length - 2) / 2 });
    },
    readContract: raw.readContract.bind(raw), simulateContract: raw.simulateContract.bind(raw),
    estimateContractGas: raw.estimateContractGas.bind(raw),
  });
}

function jsonEqual(left, right) {
  const encode = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
  return encode(left) === encode(right);
}

function field(value, name, index) {
  const selected = value?.[name] ?? value?.[index];
  if (selected === undefined) throw new TypeError(`missing ${name}`);
  return selected;
}

async function accountState(client, blockNumber, account, agent) {
  const policyAddress = getAddress(manifest.contracts.BrokerPolicyModuleV3.address);
  const agentRegistry = getAddress(coreManifest.contracts.ArtAgentRegistry.address);
  const adapter = getAddress(manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.address);
  const request = (functionName, args = []) => client.readContract({ address: policyAddress, abi: POLICY_ABI, functionName, args, blockNumber });
  const [owner, nonce, policy, usage, flags, authorized, adapterAllowed, venueAllowed,
    selectorAllowed, currency, venueMaximum, controls, balance, block] = await Promise.all([
    client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "owner", blockNumber }),
    client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "acquisitionNonce", blockNumber }),
    request("policy", [account]), request("acquisitionUsage", [account]), request("featureFlags"),
    client.readContract({ address: agentRegistry, abi: AGENT_ABI, functionName: "isAuthorized", args: [account, agent], blockNumber }),
    request("approvedAdapters", [account, adapter]), request("approvedMintContracts", [account, getAddress(SEA_DROP)]),
    request("approvedSelectors", [account, SEA_DROP_MINT_PUBLIC_SELECTOR]), request("currencyPolicy", [account, NATIVE_CURRENCY]),
    request("venueCurrencyMaximum", [account, getAddress(SEA_DROP), NATIVE_CURRENCY]), request("mintControls", [account]),
    client.getBalance({ address: agent, blockNumber }), client.getBlock({ blockNumber }),
  ]);
  return { owner, nonce, policy, usage, flags, authorized, adapterAllowed, venueAllowed,
    selectorAllowed, currency, venueMaximum, controls, balance, block };
}

function rejectionDiagnostics(profiles, collections, candidates) {
  return {
    profiles: profiles.length,
    scheduledTokenIds: profiles.map(({ token_id: tokenId }) => String(tokenId)),
    processedTokenIds: [],
    profileOutcomes: [],
    recentSeaDropCollections: collections.length,
    onchainZeroPriceCandidates: candidates.length,
    missingActivatedAccounts: 0,
    liveScreenRejections: {},
    executionSimulationRejections: {},
    providerStateDisagreements: 0,
    executionSimulationsPassed: 0,
  };
}

function recordProfileOutcome(diagnostics, tokenId, state, reason, account = null) {
  if (!diagnostics || !/^(?:0|[1-9][0-9]{0,3})$/.test(String(tokenId))
    || !new Set(["MINTED", "SKIPPED", "ERROR", "READY"]).has(state)
    || !/^[A-Z0-9_]{3,64}$/.test(reason)
    || (account !== null && !/^0x[0-9a-f]{40}$/.test(account))) return;
  if (!diagnostics.processedTokenIds.includes(String(tokenId))) {
    diagnostics.processedTokenIds.push(String(tokenId));
  }
  const index = diagnostics.profileOutcomes.findIndex((item) => item.tokenId === String(tokenId));
  const outcome = Object.freeze({ tokenId: String(tokenId), state, reason, account });
  if (index === -1) diagnostics.profileOutcomes.push(outcome);
  else diagnostics.profileOutcomes[index] = outcome;
}

function recordExecutionSimulationRejection(diagnostics, error) {
  let current = error;
  const seen = new Set();
  let code = "LATEST_ACCOUNT_SIMULATION_FAILED";
  for (let depth = 0; current && typeof current === "object" && depth < 12; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    for (const key of ["signature", "raw"]) {
      const value = current[key];
      if (typeof value === "string" && /^0x[0-9a-fA-F]{8}/.test(value)) {
        code = `LATEST_ACCOUNT_SIMULATION_REVERT_${value.slice(2, 10).toUpperCase()}`;
        break;
      }
    }
    current = current.cause;
  }
  diagnostics.executionSimulationRejections[code] =
    (diagnostics.executionSimulationRejections[code] ?? 0) + 1;
}

function recordLiveScreenRejection(diagnostics, error) {
  let current = error;
  const seen = new Set();
  let code = "LIVE_SCREEN_FAILED";
  for (let depth = 0; current && typeof current === "object" && depth < 12; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current.code === "string" && /^[A-Z0-9_]{1,128}$/.test(current.code)) {
      code = current.code;
      break;
    }
    const status = current.status ?? current.statusCode
      ?? (Number.isSafeInteger(current.code) ? current.code : undefined);
    if (Number.isSafeInteger(status) && status >= 100 && status <= 599) {
      code = `LIVE_SCREEN_HTTP_${status}`;
      break;
    }
    current = current.cause;
  }
  if (code === "LIVE_SCREEN_FAILED" && typeof error?.name === "string") {
    const name = error.name.replaceAll(/[^A-Za-z0-9]/g, "_").toUpperCase();
    if (/^[A-Z0-9_]{1,96}$/.test(name)) code = `LIVE_SCREEN_${name}`;
  }
  diagnostics.liveScreenRejections[code] =
    (diagnostics.liveScreenRejections[code] ?? 0) + 1;
}

export function confirmedIntentWindow(nowSeconds, evidenceHorizonSeconds = 30) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= evidenceHorizonSeconds
    || !Number.isSafeInteger(evidenceHorizonSeconds) || evidenceHorizonSeconds < 1
    || evidenceHorizonSeconds > 30) {
    throw new TypeError("invalid confirmed intent time window");
  }
  // The live screen executes at a confirmed historical block. Starting the intent at the
  // wall clock would make it appear future-dated at that block and force every simulation
  // to revert. Keep the exact 120-second lifetime while anchoring its start to the oldest
  // block timestamp the screen is allowed to accept.
  return Object.freeze({
    createdAt: nowSeconds - evidenceHorizonSeconds,
    expiresAt: nowSeconds + (120 - evidenceHorizonSeconds),
  });
}

export function configuredAutomationV3PunkIds(environment = {}) {
  const raw = environment.BROKER_AUTOMATION_V3_PUNK_IDS;
  if (raw === undefined || raw === "") return Object.freeze([]);
  if (typeof raw !== "string" || raw.trim() !== raw || raw.length > 256) {
    throw new TypeError("invalid configured V3 Punk list");
  }
  const tokenIds = raw.split(",");
  if (tokenIds.length < 1 || tokenIds.length > CONFIGURED_PUNK_LIMIT
    || tokenIds.some((tokenId) => !/^(?:0|[1-9][0-9]{0,3})$/.test(tokenId))
    || new Set(tokenIds).size !== tokenIds.length) {
    throw new TypeError("invalid configured V3 Punk list");
  }
  return Object.freeze([...tokenIds]);
}

export async function eligibleAutomationV3Profiles(
  pool, requestedTokenId = null, configuredTokenIds = [],
) {
  if (requestedTokenId !== null
    && (typeof requestedTokenId !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(requestedTokenId))) {
    throw new TypeError("invalid requested Punk token ID");
  }
  const result = await pool.query(`
    WITH latest_saved_punks AS (
      SELECT DISTINCT ON (m.token_id) m.token_id
        FROM broker_art_mandates m
       WHERE m.chain_id = $1 AND m.collection_address = $2
       ORDER BY m.token_id, m.version DESC
    ), enrolled AS (
      SELECT e.token_id
        FROM broker_automation_v3_enrollments e
       WHERE e.chain_id = $1 AND e.collection_address = $2
      UNION
      SELECT token_id FROM latest_saved_punks
      UNION
      SELECT UNNEST($5::numeric[]) AS token_id
    )
    SELECT enrolled.token_id, NULL::text AS configured_by, NULL::jsonb AS economic_settings,
           NULL::jsonb AS risk_settings, NULL::jsonb AS artistic_preferences,
           TRUE AS automatic_profile
      FROM enrolled
      LEFT JOIN broker_scouting_schedules schedule
        ON schedule.chain_id = $1
       AND schedule.collection_address = $2
       AND schedule.token_id = enrolled.token_id
     WHERE ($3::numeric IS NULL OR enrolled.token_id = $3::numeric)
       AND (schedule.token_id IS NULL OR (schedule.enabled = TRUE
         AND NOW() >= schedule.start_at AND NOW() < schedule.end_at))
     ORDER BY enrolled.token_id
     LIMIT $4`, [4663, ROBINHOOD.canonicalCollection, requestedTokenId,
    ELIGIBLE_PROFILE_LIMIT, configuredTokenIds]);
  const rows = [...result.rows];
  const known = new Set(rows.map(({ token_id: tokenId }) => String(tokenId)));
  // An explicit owner-triggered scan is allowed immediately even when it falls
  // outside a saved recurring window. Environment-configured recurring Punks
  // are part of the SQL roster above so the persisted window cannot be bypassed.
  const automaticTokenIds = requestedTokenId === null ? [] : [requestedTokenId];
  for (const tokenId of automaticTokenIds) {
    if ((requestedTokenId === null || requestedTokenId === tokenId) && !known.has(tokenId)) {
      rows.push(Object.freeze({
        token_id: tokenId,
        configured_by: null,
        economic_settings: null,
        risk_settings: null,
        artistic_preferences: null,
        automatic_profile: true,
      }));
      known.add(tokenId);
    }
  }
  return rows.sort((left, right) => Number(left.token_id) - Number(right.token_id))
    .slice(0, ELIGIBLE_PROFILE_LIMIT);
}

export function rotateAutomationV3Profiles(profiles, lastMintedTokenId = null) {
  if (!Array.isArray(profiles) || profiles.length > ELIGIBLE_PROFILE_LIMIT
    || profiles.some((row) => !row || !/^(?:0|[1-9][0-9]{0,3})$/.test(String(row.token_id)))) {
    throw new TypeError("invalid V3 automation profile rotation");
  }
  const ordered = [...profiles].sort(
    (left, right) => Number(left.token_id) - Number(right.token_id),
  );
  if (lastMintedTokenId === null || ordered.length < 2
    || !/^(?:0|[1-9][0-9]{0,3})$/.test(String(lastMintedTokenId))) return ordered;
  const previous = Number(lastMintedTokenId);
  const next = ordered.findIndex((row) => Number(row.token_id) > previous);
  const offset = next === -1 ? 0 : next;
  return [...ordered.slice(offset), ...ordered.slice(0, offset)];
}

export async function fairlyOrderedAutomationV3Profiles(
  pool, profiles, requestedTokenId = null, report = console.error,
) {
  if (requestedTokenId !== null) return rotateAutomationV3Profiles(profiles);
  try {
    const tokenIds = profiles.map(({ token_id: tokenId }) => String(tokenId));
    const result = await pool.query(`
      SELECT requested.punk_token_id,
             heartbeat.last_scheduled_scan,
             heartbeat.last_actual_scan
        FROM UNNEST($1::numeric[]) WITH ORDINALITY
          AS requested(punk_token_id, roster_position)
        LEFT JOIN broker_punk_agent_heartbeats heartbeat
          ON heartbeat.chain_id = 4663
         AND heartbeat.punk_token_id = requested.punk_token_id
       ORDER BY heartbeat.last_scheduled_scan ASC NULLS FIRST,
                heartbeat.last_actual_scan ASC NULLS FIRST,
                requested.roster_position ASC`, [tokenIds]);
    const byTokenId = new Map(profiles.map((profile) => [String(profile.token_id), profile]));
    const ordered = (result.rows ?? []).map(({ punk_token_id: tokenId }) => (
      byTokenId.get(String(tokenId))
    )).filter(Boolean);
    if (ordered.length !== profiles.length) throw new TypeError("incomplete Punk fairness roster");
    return ordered;
  } catch (error) {
    report(JSON.stringify({
      event: "AUTOMATION_V3_FAIRNESS_CURSOR_UNAVAILABLE",
      type: String(error?.name ?? "Error").replace(/[^A-Za-z0-9_]/g, ""),
    }));
    return rotateAutomationV3Profiles(profiles);
  }
}

export function scheduledAutomationV3ProfileBatch(
  profiles, requestedTokenId = null, nowMs = Date.now(), batchSize = AUTOMATION_V3_PROFILE_BATCH_SIZE,
  oldestDueFirst = false,
) {
  if (!Array.isArray(profiles) || profiles.length > ELIGIBLE_PROFILE_LIMIT
    || profiles.some((row) => !row || !/^(?:0|[1-9][0-9]{0,3})$/.test(String(row.token_id)))
    || (requestedTokenId !== null
      && !/^(?:0|[1-9][0-9]{0,3})$/.test(String(requestedTokenId)))
    || !Number.isSafeInteger(nowMs) || nowMs < 0
    || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > CONFIGURED_PUNK_LIMIT
    || typeof oldestDueFirst !== "boolean") {
    throw new TypeError("invalid V3 scheduled profile batch");
  }
  if (requestedTokenId !== null || profiles.length <= batchSize) return [...profiles];
  if (oldestDueFirst) return [...profiles.slice(0, batchSize)];
  const batchCount = Math.ceil(profiles.length / batchSize);
  const fiveMinuteWindow = Math.floor(nowMs / 300_000);
  const offset = (fiveMinuteWindow % batchCount) * batchSize;
  return [...profiles.slice(offset, offset + batchSize)];
}

export async function recentSeaDropCollections(
  client, confirmations = 20n, dependencies = {},
) {
  const pause = dependencies.pause ?? discoveryDelay;
  const report = dependencies.report ?? console.error;
  const head = await client.getBlockNumber();
  const toBlock = head - confirmations;
  const fromBlock = toBlock + 1n > DISCOVERY_BLOCK_WINDOW
    ? toBlock - DISCOVERY_BLOCK_WINDOW + 1n : 0n;
  const ranges = [];
  let cursor = toBlock;
  let chunks = 0n;
  while (cursor >= fromBlock && chunks < DISCOVERY_MAX_LOG_CHUNKS) {
    const chunkFrom = cursor - fromBlock + 1n > DISCOVERY_LOG_CHUNK_SIZE
      ? cursor - DISCOVERY_LOG_CHUNK_SIZE + 1n : fromBlock;
    ranges.push(Object.freeze({ fromBlock: chunkFrom, toBlock: cursor }));
    chunks += 1n;
    if (chunkFrom === fromBlock || chunks >= DISCOVERY_MAX_LOG_CHUNKS) break;
    cursor = chunkFrom - 1n;
  }
  const collections = new Set();
  let successfulRanges = 0;
  let failedRanges = 0;
  for (let offset = 0; offset < ranges.length; offset += DISCOVERY_LOG_BATCH_SIZE) {
    const batch = ranges.slice(offset, offset + DISCOVERY_LOG_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((range) => client.getLogs({
      address: getAddress(SEA_DROP), event: PUBLIC_DROP_UPDATED_EVENT,
      fromBlock: range.fromBlock, toBlock: range.toBlock,
    })));
    for (const result of results) {
      if (result.status === "rejected") {
        failedRanges += 1;
        continue;
      }
      successfulRanges += 1;
      for (const log of result.value.toReversed()) {
        collections.add(getAddress(log.args.nftContract).toLowerCase());
        if (collections.size >= DISCOVERY_COLLECTION_LIMIT) break;
      }
      if (collections.size >= DISCOVERY_COLLECTION_LIMIT) break;
    }
    if (collections.size >= DISCOVERY_COLLECTION_LIMIT) break;
    if (offset + DISCOVERY_LOG_BATCH_SIZE < ranges.length) await pause();
  }
  if (successfulRanges === 0) {
    const error = new TypeError("SeaDrop discovery unavailable: every public-drop log read failed");
    error.code = "DISCOVERY_RPC_UNAVAILABLE";
    throw error;
  }
  if (failedRanges > 0) {
    report(JSON.stringify({
      event: "AUTOMATION_V3_DISCOVERY_PARTIAL",
      successfulRanges,
      failedRanges,
    }));
  }
  return [...collections];
}

function validDiscoveryDatabase(value) {
  return value && typeof value.query === "function";
}

export async function incrementalSeaDropCollections(
  client, database, confirmations = 20n, dependencies = {},
) {
  if (!validDiscoveryDatabase(database)) {
    const error = new TypeError("SeaDrop discovery index is unavailable");
    error.code = "DISCOVERY_INDEX_UNAVAILABLE";
    throw error;
  }
  const pause = dependencies.pause ?? discoveryDelay;
  const head = await client.getBlockNumber();
  const confirmedBlock = head > confirmations ? head - confirmations : 0n;
  const checkpointResult = await database.query(
    `SELECT indexed_through_block::text AS indexed_through_block
       FROM broker_seadrop_discovery_state
      WHERE chain_id = $1`,
    [4663],
  );
  const checkpointValue = checkpointResult.rows?.[0]?.indexed_through_block;
  const checkpoint = typeof checkpointValue === "string" && /^(?:0|[1-9][0-9]*)$/.test(checkpointValue)
    ? BigInt(checkpointValue) : null;
  const bootstrapWindow = DISCOVERY_LOG_CHUNK_SIZE * DISCOVERY_INCREMENTAL_MAX_CHUNKS;
  const firstUnseen = checkpoint === null
    ? (confirmedBlock + 1n > bootstrapWindow ? confirmedBlock - bootstrapWindow + 1n : 0n)
    : checkpoint + 1n;
  const fromBlock = checkpoint !== null && firstUnseen > DISCOVERY_REORG_OVERLAP
    ? firstUnseen - DISCOVERY_REORG_OVERLAP : firstUnseen;
  const maximumTo = fromBlock + bootstrapWindow - 1n;
  const toBlock = maximumTo < confirmedBlock ? maximumTo : confirmedBlock;
  const logs = [];
  if (fromBlock <= toBlock) {
    for (let cursor = fromBlock; cursor <= toBlock; cursor += DISCOVERY_LOG_CHUNK_SIZE) {
      const chunkTo = cursor + DISCOVERY_LOG_CHUNK_SIZE - 1n < toBlock
        ? cursor + DISCOVERY_LOG_CHUNK_SIZE - 1n : toBlock;
      logs.push(...await client.getLogs({
        address: getAddress(SEA_DROP), event: PUBLIC_DROP_UPDATED_EVENT,
        fromBlock: cursor, toBlock: chunkTo,
      }));
      if (chunkTo < toBlock) await pause();
    }
  }
  const latest = new Map();
  for (const log of logs) {
    const collection = getAddress(log.args.nftContract).toLowerCase();
    const drop = log.args.publicDrop;
    const blockNumber = BigInt(log.blockNumber);
    const prior = latest.get(collection);
    if (!prior || blockNumber >= prior.blockNumber) {
      latest.set(collection, {
        collection, blockNumber,
        blockHash: String(log.blockHash).toLowerCase(),
        transactionHash: String(log.transactionHash).toLowerCase(),
        mintPrice: BigInt(drop.mintPrice).toString(),
        startTime: BigInt(drop.startTime).toString(),
        endTime: BigInt(drop.endTime).toString(),
        maximum: Number(drop.maxTotalMintableByWallet),
      });
    }
  }
  const updates = [...latest.values()];
  await database.query(
    `WITH updates AS (
       SELECT * FROM UNNEST(
         $2::text[], $3::numeric[], $4::numeric[], $5::numeric[], $6::integer[],
         $7::numeric[], $8::text[], $9::text[]
       ) AS item(collection_address, mint_price_wei, start_time, end_time,
         max_total_mintable_by_wallet, update_block_number, update_block_hash,
         update_transaction_hash)
     ), upserted AS (
       INSERT INTO broker_seadrop_public_drops
         (chain_id, collection_address, mint_price_wei, start_time, end_time,
          max_total_mintable_by_wallet, update_block_number, update_block_hash,
          update_transaction_hash, updated_at)
       SELECT $1, collection_address, mint_price_wei, start_time, end_time,
              max_total_mintable_by_wallet, update_block_number, update_block_hash,
              update_transaction_hash, NOW()
         FROM updates
       ON CONFLICT (chain_id, collection_address) DO UPDATE
         SET mint_price_wei = EXCLUDED.mint_price_wei,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             max_total_mintable_by_wallet = EXCLUDED.max_total_mintable_by_wallet,
             update_block_number = EXCLUDED.update_block_number,
             update_block_hash = EXCLUDED.update_block_hash,
             update_transaction_hash = EXCLUDED.update_transaction_hash,
             updated_at = NOW()
       WHERE broker_seadrop_public_drops.update_block_number <= EXCLUDED.update_block_number
     )
     INSERT INTO broker_seadrop_discovery_state
       (chain_id, indexed_through_block, updated_at)
     VALUES ($1, $10, NOW())
     ON CONFLICT (chain_id) DO UPDATE
       SET indexed_through_block = GREATEST(
             broker_seadrop_discovery_state.indexed_through_block,
             EXCLUDED.indexed_through_block
           ),
           updated_at = NOW()`,
    [
      4663,
      updates.map((item) => item.collection),
      updates.map((item) => item.mintPrice),
      updates.map((item) => item.startTime),
      updates.map((item) => item.endTime),
      updates.map((item) => item.maximum),
      updates.map((item) => item.blockNumber.toString()),
      updates.map((item) => item.blockHash),
      updates.map((item) => item.transactionHash),
      toBlock.toString(),
    ],
  );
  const nowSeconds = Math.floor((dependencies.nowMs ?? Date.now()) / 1_000);
  const active = await database.query(
    `SELECT collection_address
       FROM broker_seadrop_public_drops
      WHERE chain_id = $1
        AND mint_price_wei = 0
        AND start_time <= $2
        AND end_time >= $2
        AND max_total_mintable_by_wallet > 0
      ORDER BY update_block_number DESC, collection_address
      LIMIT $3`,
    [4663, String(nowSeconds), DISCOVERY_COLLECTION_LIMIT],
  );
  return Object.freeze((active.rows ?? []).map(({ collection_address: value }) => (
    getAddress(value).toLowerCase()
  )));
}

function configuredCollectionList(environment, name, label) {
  const raw = environment[name];
  if (raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || raw.trim() !== raw || raw.length > 512) {
    throw new TypeError(`invalid ${label} SeaDrop collection list`);
  }
  const entries = raw.split(",");
  if (entries.length < 1 || entries.length > DIRECTED_COLLECTION_LIMIT
    || entries.some((entry) => entry === "" || entry.trim() !== entry)) {
    throw new TypeError(`invalid ${label} SeaDrop collection list`);
  }
  const normalized = entries.map((entry) => getAddress(entry).toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`duplicate ${label} SeaDrop collection`);
  }
  return Object.freeze(normalized);
}

export function configuredSeaDropCollections(environment = {}) {
  return configuredCollectionList(
    environment, "BROKER_AUTOMATION_V3_TARGET_COLLECTIONS", "directed",
  );
}

export function configuredPrioritySeaDropCollections(environment = {}) {
  return configuredCollectionList(
    environment, "BROKER_AUTOMATION_V3_PRIORITY_COLLECTIONS", "priority",
  );
}

export function mergePrioritySeaDropCollections(priorities = [], discovered = []) {
  if (!Array.isArray(priorities) || !Array.isArray(discovered)) {
    throw new TypeError("invalid SeaDrop discovery lists");
  }
  return Object.freeze([...new Set([...priorities, ...discovered])]
    .slice(0, DISCOVERY_COLLECTION_LIMIT));
}

async function pendingPriorityCollections(primary, secondary, account, priorities) {
  const pending = [];
  let readFailures = 0;
  for (const collection of priorities) {
    try {
      const [first, second] = await Promise.all([primary, secondary].map((client) => (
        client.readContract({
          address: collection, abi: MINT_STATS_ABI, functionName: "getMintStats",
          args: [account],
        })
      )));
      const firstMinted = BigInt(field(first, "minterNumMinted", 0));
      const secondMinted = BigInt(field(second, "minterNumMinted", 0));
      if (firstMinted !== secondMinted) throw new TypeError("priority mint state disagrees");
      if (firstMinted === 0n) pending.push(collection);
    } catch {
      // A failed or disagreeing read can only narrow execution: reserve the slot.
      readFailures += 1;
      pending.push(collection);
    }
  }
  return Object.freeze({ pending: Object.freeze(pending), readFailures });
}

export function selectActiveZeroPriceSeaDropCollections(collections, results, blockTimestamp) {
  if (!Array.isArray(collections) || !Array.isArray(results)
    || collections.length !== results.length || typeof blockTimestamp !== "bigint") {
    throw new TypeError("invalid SeaDrop prefilter evidence");
  }
  return collections.filter((collection, index) => {
    const entry = results[index];
    if (entry?.status !== "success") return false;
    const drop = entry.result;
    return drop?.mintPrice === 0n && drop.startTime <= blockTimestamp
      && drop.endTime >= blockTimestamp && drop.maxTotalMintableByWallet > 0;
  });
}

export function selectReviewedStudioCollections(collections, codes) {
  if (!Array.isArray(collections) || !Array.isArray(codes)
    || collections.length !== codes.length) {
    throw new TypeError("invalid reviewed Studio runtime evidence");
  }
  return collections.filter((collection, index) => {
    const code = codes[index];
    if (typeof code !== "string" || code === "0x") return false;
    const length = (code.length - 2) / 2;
    const codeHash = keccak256(code);
    return length === 45 && codeHash === CLONE_COLLECTION_RUNTIME_CODE_HASH
      || length === 19_658 && codeHash === STUDIO_COLLECTION_RUNTIME_CODE_HASH;
  });
}

export async function activeZeroPriceSeaDropCollections(
  client, runtimeClient, collections, confirmations = 20n,
) {
  if (collections.length === 0) return [];
  let blockNumber;
  let block;
  try {
    const head = await client.getBlockNumber();
    blockNumber = head - confirmations;
    block = await client.getBlock({ blockNumber });
  } catch {
    // This is only the bounded candidate prefilter. Final execution still requires the existing
    // independent-provider agreement, runtime, policy, price, recipient, and simulation gates.
    // A single discovery provider outage must not stop every enrolled Punk before those gates.
    const head = await runtimeClient.getBlockNumber();
    blockNumber = head - confirmations;
    block = await runtimeClient.getBlock({ blockNumber });
  }
  const results = [];
  for (let offset = 0; offset < collections.length; offset += DISCOVERY_BATCH_SIZE) {
    const batch = collections.slice(offset, offset + DISCOVERY_BATCH_SIZE);
    results.push(...await Promise.all(batch.map(async (collection) => {
      try {
        const result = await client.readContract({
          address: getAddress(SEA_DROP), abi: PUBLIC_DROP_ABI,
          functionName: "getPublicDrop", args: [collection], blockNumber,
        });
        return { status: "success", result };
      } catch (firstError) {
        try {
          const result = await runtimeClient.readContract({
            address: getAddress(SEA_DROP), abi: PUBLIC_DROP_ABI,
            functionName: "getPublicDrop", args: [collection], blockNumber,
          });
          return { status: "success", result };
        } catch (error) {
          return { status: "failure", error: error ?? firstError };
        }
      }
    })));
    await discoveryDelay();
  }
  const active = selectActiveZeroPriceSeaDropCollections(collections, results, block.timestamp);
  const publicDropReadFailures = results.filter((entry) => entry.status === "failure").length;
  if (publicDropReadFailures === results.length) {
    const error = new TypeError("SeaDrop discovery unavailable: every public-drop read failed");
    error.code = "DISCOVERY_RPC_UNAVAILABLE";
    throw error;
  }
  const codes = [];
  let codeReadFailures = 0;
  for (let offset = 0; offset < active.length; offset += DISCOVERY_RUNTIME_BATCH_SIZE) {
    const batch = active.slice(offset, offset + DISCOVERY_RUNTIME_BATCH_SIZE);
    codes.push(...await Promise.all(batch.map(async (collection) => {
      try {
        return (await runtimeClient.getCode({ address: collection, blockNumber })) ?? "0x";
      } catch {
        try {
          return (await client.getCode({ address: collection, blockNumber })) ?? "0x";
        } catch {
          codeReadFailures += 1;
          return "0x";
        }
      }
    })));
    await discoveryDelay();
  }
  const reviewed = selectReviewedStudioCollections(active, codes);
  if (active.length > 0 && codeReadFailures === active.length) {
    const error = new TypeError("SeaDrop discovery unavailable: every runtime read failed");
    error.code = "DISCOVERY_RPC_UNAVAILABLE";
    throw error;
  }
  return reviewed;
}

function liveState(profile, state, screen, maxFeePerGasWei) {
  const config = field(state.policy, "config", 0);
  const value = (object, name, index) => field(object, name, index);
  return {
    schema: "GOGH_AUTOMATED_SEADROP_V3_LIVE_STATE_V1", chainId: 4663,
    checkedAt: screen.checkedAt, blockNumber: Number(screen.pinnedBlock.number),
    blockHash: screen.pinnedBlock.hash, blockTimestamp: screen.pinnedBlock.timestamp,
    owner: getAddress(state.owner).toLowerCase(), account: profile.punk.account, agent: profile.agent,
    policyVersion: BigInt(value(state.policy, "version", 2)).toString(), nonce: BigInt(state.nonce).toString(),
    acquisitionsToday: Number(value(state.usage, "acquisitionsToday", 1)),
    agentBalanceWei: state.balance.toString(), maxFeePerGasWei: maxFeePerGasWei.toString(),
    accountPaused: value(state.policy, "accountPaused", 4), agentAuthorized: state.authorized,
    featureFlags: {
      scoutMode: value(state.flags, "scoutMode", 0), approvalPurchases: value(state.flags, "approvalPurchases", 1),
      autonomousPurchases: value(state.flags, "autonomousPurchases", 2), autonomousMints: value(state.flags, "autonomousMints", 3),
      unknownCollectionExecution: value(state.flags, "unknownCollectionExecution", 4), selling: value(state.flags, "selling", 5),
      autonomousSelling: value(state.flags, "autonomousSelling", 6),
    },
    policy: {
      mode: Number(value(config, "mode", 0)) === 3 ? "AUTONOMOUS" : "OTHER",
      maxSpendPerTransaction: BigInt(value(config, "maxSpendPerTransaction", 1)).toString(),
      maxSpendPerDay: BigInt(value(config, "maxSpendPerDay", 2)).toString(), maxSpendPerWeek: BigInt(value(config, "maxSpendPerWeek", 3)).toString(),
      maxMintPrice: BigInt(value(config, "maxMintPrice", 4)).toString(), maxSecondaryPurchasePrice: BigInt(value(config, "maxSecondaryPurchasePrice", 5)).toString(),
      minimumNativeReserve: BigInt(value(config, "minimumNativeReserve", 6)).toString(), maxAcquisitionsPerDay: Number(value(config, "maxAcquisitionsPerDay", 7)),
      maxIntentAge: Number(value(config, "maxIntentAge", 8)), maxSlippageBps: Number(value(config, "maxSlippageBps", 9)),
      requireCollectionAllowlist: value(config, "requireCollectionAllowlist", 10), allowUnknownCollections: value(config, "allowUnknownCollections", 11),
      autonomousFreeMints: value(state.controls, "autonomousFreeMints", 1), autonomousPaidMints: value(state.controls, "autonomousPaidMints", 2),
    },
    permissions: { adapterActive: true, adapterAllowed: state.adapterAllowed, venueAllowed: state.venueAllowed,
      selectorAllowed: state.selectorAllowed, currencyAllowed: value(state.currency, "allowed", 0), venueCurrencyMaximumWei: BigInt(state.venueMaximum).toString() },
    targets: [screen.screen.target],
  };
}

export async function runAutomatedSeaDropV3Worker(environment = process.env, dependencies = {}) {
  if (environment.BROKER_AUTOMATION_V3_ENABLED !== "true") return { status: "DISABLED", submitted: 0 };
  const clock = dependencies.now ?? Date.now;
  if (typeof clock !== "function") throw new TypeError("invalid V3 worker clock");
  const startedAtMs = clock();
  const deadlineMs = dependencies.deadlineMs ?? startedAtMs + AUTOMATION_V3_WORKER_TIME_BUDGET_MS;
  if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0
    || !Number.isSafeInteger(deadlineMs) || deadlineMs <= startedAtMs
    || deadlineMs - startedAtMs > AUTOMATION_V3_WORKER_TIME_BUDGET_MS) {
    throw new TypeError("invalid V3 worker time budget");
  }
  const controller = dependencies.abortSignal ? null : new AbortController();
  const abortSignal = dependencies.abortSignal ?? controller.signal;
  const abortTimer = dependencies.now || !controller ? null : setTimeout(
    () => controller.abort(), Math.max(0, deadlineMs - Date.now()),
  );
  const budgetExpired = (reserveMs = 0) => clock() >= deadlineMs - reserveMs;
  let currentDiagnostics = null;
  let transactionSubmitted = false;
  const budgetResult = () => ({
    status: "NO_ELIGIBLE_TARGETS", submitted: 0,
    diagnostics: { ...(currentDiagnostics ?? {}), scanBudgetExhausted: true },
  });
  try {
  const key = environment.BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY;
  let signingAccount = null;
  if (dependencies.readOnly !== true) {
    if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      const error = new TypeError("AGENT_SIGNER_UNAVAILABLE");
      error.code = "AGENT_SIGNER_UNAVAILABLE";
      throw error;
    }
    signingAccount = privateKeyToAccount(key);
    if (signingAccount.address.toLowerCase() !== AUTOMATION_V3_AGENT) {
      const error = new TypeError("AGENT_SIGNER_ADDRESS_MISMATCH");
      error.code = "AGENT_SIGNER_ADDRESS_MISMATCH";
      throw error;
    }
  }
  const { primary: primaryUrl, secondary: secondaryUrl } = resolveRobinhoodRpcPair(environment);
  const primary = dependencies.primary ?? readClient(primaryUrl, abortSignal);
  const secondary = dependencies.secondary ?? readClient(secondaryUrl, abortSignal);
  const discovery = dependencies.discovery ?? discoveryClient(primaryUrl, abortSignal);
  const database = dependencies.database ?? getDatabase().pool;
  const requestedTokenId = dependencies.requestedTokenId ?? null;
  const configuredTokenIds = configuredAutomationV3PunkIds(environment);
  const eligibleProfiles = await workerStage(
    "PROFILE_DATABASE_READ_FAILED",
    () => eligibleAutomationV3Profiles(database, requestedTokenId, configuredTokenIds),
  );
  const orderedProfiles = await workerStage(
    "PROFILE_ORDER_READ_FAILED",
    () => fairlyOrderedAutomationV3Profiles(
      database, eligibleProfiles, requestedTokenId, dependencies.report,
    ),
  );
  const profiles = scheduledAutomationV3ProfileBatch(
    orderedProfiles, requestedTokenId, startedAtMs, AUTOMATION_V3_PROFILE_BATCH_SIZE, true,
  );
  if (profiles.length === 0) return { status: "NO_AUTONOMOUS_MANDATES", submitted: 0 };
  currentDiagnostics = rejectionDiagnostics(profiles, [], []);
  currentDiagnostics.totalEligibleProfiles = orderedProfiles.length;
  currentDiagnostics.scheduledProfileBatch = profiles.length;
  currentDiagnostics.operatorConfiguredPunks = configuredTokenIds.length;
  if (budgetExpired()) return budgetResult();
  // A reviewed operator may temporarily constrain discovery to a small exact set.
  // This does not bypass any runtime, public-drop, dual-provider, policy, or simulation
  // gate below; it only prevents another eligible collection from consuming the Punk's
  // daily slot before a specifically selected launch.
  const directedCollections = configuredSeaDropCollections(environment);
  const priorityCollections = configuredPrioritySeaDropCollections(environment) ?? [];
  const discoveredCollections = directedCollections === null
    ? await workerStage(
      "DISCOVERY_SCAN_FAILED",
      () => incrementalSeaDropCollections(discovery, database),
    ) : [];
  if (budgetExpired()) return budgetResult();
  const collections = directedCollections
    ?? mergePrioritySeaDropCollections(priorityCollections, discoveredCollections);
  currentDiagnostics.recentSeaDropCollections = collections.length;
  currentDiagnostics.directedTargetCollections = directedCollections?.length ?? 0;
  currentDiagnostics.priorityTargetCollections = priorityCollections.length;
  // Use the archive provider for the indexed public-drop reads, then move the much
  // smaller active set to the canonical endpoint for runtime classification. This
  // avoids exhausting either provider's per-second allowance. Every selected target
  // is still independently re-read and simulated by both clients before submission.
  const analyzedCandidates = await workerStage(
    "CANDIDATE_PREFILTER_FAILED",
    () => activeZeroPriceSeaDropCollections(secondary, primary, collections),
  );
  if (budgetExpired()) return budgetResult();
  const maximumSocialCandidates = socialCandidateValidationLimit(environment);
  const operatorPriorities = new Set([...(directedCollections ?? []), ...priorityCollections]);
  const exactPriorityCandidates = analyzedCandidates.filter((collection) => (
    operatorPriorities.has(collection)
  ));
  const socialPool = analyzedCandidates.filter((collection) => !operatorPriorities.has(collection));
  let socialRanking = null;
  if (socialPool.length > 0 && (typeof dependencies.rankCandidates === "function"
    || typeof environment.OPENSEA_API_KEY === "string" && environment.OPENSEA_API_KEY.trim())) {
    socialRanking = await workerStage("SOCIAL_RANKING_FAILED", () => (
      dependencies.rankCandidates
        ? dependencies.rankCandidates(socialPool, maximumSocialCandidates)
        : rankSeaDropCollections(socialPool, {
          maximum: maximumSocialCandidates,
          source: createOpenSeaSocialProfileSource({ apiKey: environment.OPENSEA_API_KEY }),
        })
    ));
  }
  const sociallySelected = socialRanking
    ? socialRanking.selected.map(({ collection }) => collection)
    : socialPool.slice(0, maximumSocialCandidates);
  const candidates = [...new Set([...exactPriorityCandidates, ...sociallySelected])]
    .slice(0, AUTOMATION_V3_CANDIDATE_BATCH_SIZE);
  if (candidates.length === 0) {
    const diagnostics = rejectionDiagnostics(profiles, collections, candidates);
    diagnostics.totalEligibleProfiles = orderedProfiles.length;
    diagnostics.scheduledProfileBatch = profiles.length;
    diagnostics.analyzedCandidateBatch = 0;
    diagnostics.directedTargetCollections = directedCollections?.length ?? 0;
    diagnostics.priorityTargetCollections = priorityCollections.length;
    diagnostics.operatorConfiguredPunks = configuredTokenIds.length;
    diagnostics.socialRanking = socialRanking?.diagnostics ?? {
      discovered: socialPool.length, withWebsite: 0, withX: 0, highPriority: 0,
      sentToOnchainValidation: 0, maximumOnchainValidations: maximumSocialCandidates,
    };
    diagnostics.socialCandidates = socialRanking?.selected ?? [];
    for (const { token_id: tokenId } of profiles) {
      recordProfileOutcome(diagnostics, String(tokenId), "SKIPPED", "NO_ACTIVE_CANDIDATES");
    }
    return { status: "NO_ANALYZED_ACTIVE_TARGETS", submitted: 0, diagnostics };
  }
  // Global policy/runtime evidence is expensive (eleven reads from each independent
  // provider). It remains mandatory before any account or transaction work, but an idle
  // scan with no candidate no longer spends RPC budget re-proving unchanged global state.
  const global = await workerStage(
    "GLOBAL_STATE_READ_FAILED",
    () => readAutomationV3GlobalState(environment, { clients: [primary, secondary] }),
  );
  if (!global.configured || !global.worker.enabled) {
    const error = new TypeError("GLOBAL_V3_GATE_CLOSED");
    error.code = "GLOBAL_V3_GATE_CLOSED";
    throw error;
  }
  const diagnostics = rejectionDiagnostics(profiles, collections, candidates);
  currentDiagnostics = diagnostics;
  diagnostics.totalEligibleProfiles = orderedProfiles.length;
  diagnostics.scheduledProfileBatch = profiles.length;
  diagnostics.analyzedCandidateBatch = candidates.length;
  diagnostics.directedTargetCollections = directedCollections?.length ?? 0;
  diagnostics.priorityTargetCollections = priorityCollections.length;
  diagnostics.socialRanking = socialRanking?.diagnostics ?? {
    discovered: socialPool.length,
    withWebsite: 0,
    withX: 0,
    highPriority: 0,
    sentToOnchainValidation: sociallySelected.length,
    maximumOnchainValidations: maximumSocialCandidates,
  };
  diagnostics.socialCandidates = socialRanking?.selected ?? [];
  diagnostics.operatorConfiguredPunks = configuredTokenIds.length;
  diagnostics.prioritySlotReservations = 0;
  diagnostics.priorityStateReadFailures = 0;
  diagnostics.profileStateReadFailures = 0;
  diagnostics.candidateStateReadFailures = 0;
  diagnostics.candidateStateReadAttempts = 0;
  const registry = getAddress(manifest.contracts.GoghPunkAccountRegistryV3.address);
  const policyModule = getAddress(manifest.contracts.BrokerPolicyModuleV3.address);
  const agent = getAddress(AUTOMATION_V3_AGENT);
  for (const row of profiles) {
    if (budgetExpired()) return budgetResult();
    const tokenId = String(row.token_id);
    if (!diagnostics.processedTokenIds.includes(tokenId)) diagnostics.processedTokenIds.push(tokenId);
    let accountAddress;
    let expectedOwner;
    let priorityState;
    try {
      accountAddress = await primary.readContract({
        address: registry, abi: REGISTRY_ABI, functionName: "account", args: [BigInt(tokenId)],
      });
      if (((await primary.getCode({ address: accountAddress })) ?? "0x") === "0x") {
        diagnostics.missingActivatedAccounts += 1;
        recordProfileOutcome(diagnostics, tokenId, "ERROR", "ACCOUNT_NOT_CREATED");
        continue;
      }
      const ownerRequest = {
        address: getAddress(ROBINHOOD.canonicalCollection), abi: COLLECTION_ABI,
        functionName: "ownerOf", args: [BigInt(tokenId)],
      };
      const [primaryOwner, secondaryOwner] = await Promise.all([
        primary.readContract(ownerRequest), secondary.readContract(ownerRequest),
      ]);
      if (getAddress(primaryOwner) !== getAddress(secondaryOwner)) {
        diagnostics.providerStateDisagreements += 1;
        recordProfileOutcome(diagnostics, tokenId, "ERROR", "PROVIDER_OWNER_DISAGREEMENT");
        continue;
      }
      expectedOwner = getAddress(primaryOwner).toLowerCase();
      priorityState = await pendingPriorityCollections(
        primary, secondary, accountAddress, priorityCollections,
      );
    } catch {
      // One stale or rate-limited Punk must not stop the remaining authorized
      // roster. No transaction is built until all of this Punk's reads pass.
      diagnostics.profileStateReadFailures += 1;
      recordProfileOutcome(diagnostics, tokenId, "ERROR", "PROFILE_STATE_READ_FAILED");
      continue;
    }
    diagnostics.priorityStateReadFailures += priorityState.readFailures;
    for (const collection of candidates) {
      if (budgetExpired()) return budgetResult();
      diagnostics.candidateStateReadAttempts += 1;
      let latestNonce;
      let latestPolicy;
      try {
        [latestNonce, latestPolicy] = await Promise.all([
          primary.readContract({
            address: accountAddress, abi: ACCOUNT_ABI, functionName: "acquisitionNonce",
          }),
          primary.readContract({
            address: policyModule, abi: POLICY_ABI, functionName: "policy",
            args: [accountAddress],
          }),
        ]);
      } catch {
        diagnostics.candidateStateReadFailures += 1;
        continue;
      }
      const nowSeconds = Math.floor(Date.now() / 1_000);
      const intentWindow = confirmedIntentWindow(nowSeconds);
      const candidate = {
        collection,
        opportunityId: keccak256(stringToHex(`canonical-live-seadrop:${collection}`)),
        reasoningHash: keccak256(stringToHex(`reviewed-studio-active-zero-price:${collection}`)),
        contractRiskScore: 100, tasteMatch: 0,
        metadataSanitized: true, analysisComplete: true,
      };
      const scope = {
        account: accountAddress, agent, expectedOwner, policyModule,
        adapter: manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.address,
        adapterCodeHash: manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.runtimeBytecodeHash,
        nonce: BigInt(latestNonce).toString(), policyVersion: BigInt(field(latestPolicy, "version", 2)).toString(),
        createdAt: String(intentWindow.createdAt), expiresAt: String(intentWindow.expiresAt),
      };
      let screen;
      try {
        screen = await attestAutomatedSeaDropV3CandidateLive(candidate, scope,
          { primaryUrl, secondaryUrl }, { confirmations: 20, maximumEvidenceAgeSeconds: 30 },
          { primary: readFacade(primary, primaryUrl), secondary: readFacade(secondary, secondaryUrl) });
      } catch (error) {
        if (budgetExpired()) return budgetResult();
        recordLiveScreenRejection(diagnostics, error);
        continue;
      }
      const pinned = BigInt(screen.pinnedBlock.number);
      let first;
      let second;
      try {
        [first, second] = await Promise.all([
          accountState(primary, pinned, accountAddress, agent),
          accountState(secondary, pinned, accountAddress, agent),
        ]);
      } catch {
        if (budgetExpired()) return budgetResult();
        diagnostics.candidateStateReadFailures += 1;
        continue;
      }
      if (!jsonEqual(first, second)) {
        diagnostics.providerStateDisagreements += 1;
        continue;
      }
      const config = field(first.policy, "config", 0);
      const liveCap = Number(field(config, "maxAcquisitionsPerDay", 7));
      const acquisitionsToday = Number(field(first.usage, "acquisitionsToday", 1));
      if (priorityState.pending.length > 0 && !priorityCollections.includes(collection)
        && acquisitionsToday >= liveCap - 1) {
        diagnostics.prioritySlotReservations += 1;
        continue;
      }
      let maxFee;
      try {
        maxFee = (await primary.estimateFeesPerGas()).maxFeePerGas ?? 1n;
      } catch {
        diagnostics.candidateStateReadFailures += 1;
        continue;
      }
      const cap = liveCap;
      const profile = {
        schema: "GOGH_AUTOMATED_SEADROP_V3_PROFILE_V1", version: 1, chainId: 4663,
        punk: { tokenId, collection: ROBINHOOD.canonicalCollection, account: accountAddress, expectedOwner }, agent,
        infrastructure: { adapter: manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.address,
          adapterCodeHash: manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.runtimeBytecodeHash,
          seaDrop: SEA_DROP, seaDropCodeHash: SEA_DROP_CODE_HASH, cloneImplementation: CLONE_IMPLEMENTATION,
          cloneImplementationCodeHash: CLONE_IMPLEMENTATION_CODE_HASH,
          cloneCollectionRuntimeCodeHash: CLONE_COLLECTION_RUNTIME_CODE_HASH,
          studioCollectionRuntimeCodeHash: STUDIO_COLLECTION_RUNTIME_CODE_HASH },
        limits: { maxMintsPerUtcDay: cap, maxMintsPerRun: 1, maxGasPerMint: 700000,
          maxGasWeiPerRun: first.balance.toString(), minAgentReserveWei: "10000000000000", intentTtlSeconds: 120,
          maxEvidenceAgeSeconds: 30,
          maxContractRiskScore: 100,
          minimumTasteMatch: 0,
          stopOnFailure: true },
      };
      let tx;
      try {
        const batch = buildAutomatedSeaDropV3ExecutionBatch(
          profile, liveState(profile, first, screen, maxFee), { nowSeconds },
        );
        [tx] = batch.transactions;
        await primary.call({ account: agent, to: getAddress(tx.to), data: tx.data, value: 0n });
      } catch (error) {
        recordExecutionSimulationRejection(diagnostics, error);
        continue;
      }
      diagnostics.executionSimulationsPassed += 1;
      if (dependencies.readOnly === true) {
        recordProfileOutcome(
          diagnostics, tokenId, "READY", "ELIGIBLE_SIMULATION_PASSED",
          accountAddress.toLowerCase(),
        );
        return {
          status: "READ_ONLY_ELIGIBLE",
          submitted: 0,
          tokenId,
          account: accountAddress.toLowerCase(),
          collection,
          diagnostics,
        };
      }
      if (budgetExpired(AUTOMATION_V3_SUBMISSION_RESERVE_MS)) return budgetResult();
      const wallet = createWalletClient({
        account: signingAccount, chain: CHAIN,
        transport: http(primaryUrl, { retryCount: 0, timeout: 5_000 }),
      });
      const hash = await workerStage(
        "TRANSACTION_SUBMISSION_FAILED",
        () => wallet.sendTransaction({
          account: signingAccount, to: getAddress(tx.to), data: tx.data, value: 0n,
        }),
      );
      transactionSubmitted = true;
      const receipt = await workerStage(
        "TRANSACTION_CONFIRMATION_UNCERTAIN",
        () => primary.waitForTransactionReceipt({
          hash, confirmations: 1,
          timeout: Math.max(1_000, Math.min(8_000, deadlineMs - clock() - 4_000)),
        }),
      );
      if (receipt.status !== "success") {
        const error = new Error("AUTONOMOUS_MINT_REVERTED");
        error.code = "AUTONOMOUS_MINT_REVERTED";
        throw error;
      }
      recordProfileOutcome(
        diagnostics, tokenId, "MINTED", "MINT_CONFIRMED", accountAddress.toLowerCase(),
      );
      return { status: "MINT_CONFIRMED", submitted: 1, tokenId,
        account: accountAddress.toLowerCase(), collection, transactionHash: hash, diagnostics };
    }
    recordProfileOutcome(
      diagnostics, tokenId, "SKIPPED", "NO_ELIGIBLE_TARGETS",
      typeof accountAddress === "string" ? accountAddress.toLowerCase() : null,
    );
  }
  if (diagnostics.profileStateReadFailures === profiles.length) {
    const error = new Error("PROFILE_STATE_READ_FAILED");
    error.code = "PROFILE_STATE_READ_FAILED";
    throw error;
  }
  if (diagnostics.candidateStateReadAttempts > 0
    && diagnostics.candidateStateReadFailures === diagnostics.candidateStateReadAttempts) {
    const error = new Error("CANDIDATE_STATE_READ_FAILED");
    error.code = "CANDIDATE_STATE_READ_FAILED";
    throw error;
  }
  return { status: "NO_ELIGIBLE_TARGETS", submitted: 0, diagnostics };
  } catch (error) {
    if (!transactionSubmitted && (budgetExpired() || error?.name === "AbortError")) {
      return budgetResult();
    }
    if (currentDiagnostics && error && typeof error === "object") {
      const code = typeof error.code === "string" && /^[A-Z0-9_]{3,64}$/.test(error.code)
        ? error.code : "WORKER_RUN_FAILED";
      for (const tokenId of currentDiagnostics.scheduledTokenIds ?? []) {
        recordProfileOutcome(currentDiagnostics, tokenId, "ERROR", code);
      }
      error.diagnostics = currentDiagnostics;
    }
    throw error;
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
