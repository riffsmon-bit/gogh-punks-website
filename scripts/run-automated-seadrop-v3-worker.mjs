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
import {
  attestAutomatedSeaDropV3CandidateLive, attestOwnerPaidSeaDropV3CandidateLive,
} from
  "../broker/src/discovery/automated-seadrop-v3-live-screen.mjs";
import { attestAutomatedScatterV3CandidateLive } from
  "../broker/src/discovery/automated-scatter-v3-live-screen.mjs";
import { buildAutomatedSeaDropV3ExecutionBatch } from
  "../broker/src/recommendation/automated-seadrop-v3-execution-batch.mjs";
import {
  buildAutomatedScatterV3Execution, configuredScatterTargets, SCATTER_MINT_SELECTOR,
} from "../broker/src/recommendation/automated-scatter-v3-execution.mjs";
import { buildOwnerPaidSeaDropV3Execution } from
  "../broker/src/recommendation/owner-paid-seadrop-v3-execution.mjs";
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

export function selectAutomationV3RouteCandidates(
  scatterTargets, seaDropCandidates, rotationBucket = 0,
) {
  if (!Array.isArray(scatterTargets) || !Array.isArray(seaDropCandidates)
    || !Number.isSafeInteger(rotationBucket) || rotationBucket < 0
    || scatterTargets.some((target) => !target || typeof target.collection !== "string")
    || seaDropCandidates.some((collection) => typeof collection !== "string")) {
    throw new TypeError("invalid V3 route candidates");
  }
  const scatterOffset = scatterTargets.length === 0
    ? 0 : rotationBucket % scatterTargets.length;
  const rotatedScatterTargets = [
    ...scatterTargets.slice(scatterOffset), ...scatterTargets.slice(0, scatterOffset),
  ];
  const scatterQuota = seaDropCandidates.length === 0
    ? AUTOMATION_V3_CANDIDATE_BATCH_SIZE
    : Math.min(2, rotatedScatterTargets.length);
  return Object.freeze([
    ...rotatedScatterTargets.slice(0, scatterQuota).map((target) => Object.freeze({
      kind: "SCATTER", collection: target.collection, target,
    })),
    ...seaDropCandidates.slice(0, AUTOMATION_V3_CANDIDATE_BATCH_SIZE - scatterQuota)
      .map((collection) => Object.freeze({ kind: "SEADROP", collection, target: null })),
  ]);
}

function discoveryDelay() {
  return new Promise((resolve) => setTimeout(resolve, DISCOVERY_BATCH_DELAY_MS));
}

function globalGateRetryDelay() {
  return new Promise((resolve) => setTimeout(resolve, 1_000));
}

export async function confirmedAutomationV3GlobalState(
  readState, pause = globalGateRetryDelay,
) {
  if (typeof readState !== "function" || typeof pause !== "function") {
    throw new TypeError("invalid V3 global gate reader");
  }
  const first = await readState();
  if (first?.configured === true && first?.worker?.enabled === true) return first;
  await pause();
  return readState();
}

export function automationV3GlobalGateFailure(global) {
  if (global?.configured !== true) return "GLOBAL_V3_ONCHAIN_GATE_CLOSED";
  if (global?.worker?.enabled !== true) return "GLOBAL_V3_WORKER_BINDING_CLOSED";
  return null;
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

function scatterReadFacade(raw, url) {
  return Object.freeze({
    transport: Object.freeze({ url: new URL(url).href }),
    getBlockNumber: raw.getBlockNumber.bind(raw),
    getBlock: raw.getBlock.bind(raw),
    getCode: raw.getCode.bind(raw),
    readContract: raw.readContract.bind(raw),
    call: raw.call.bind(raw),
    estimateGas: raw.estimateGas.bind(raw),
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

async function accountState(client, blockNumber, account, agent, route = {}) {
  const policyAddress = getAddress(manifest.contracts.BrokerPolicyModuleV3.address);
  const agentRegistry = getAddress(coreManifest.contracts.ArtAgentRegistry.address);
  const adapter = getAddress(route.adapter
    ?? manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.address);
  const venue = getAddress(route.venue ?? SEA_DROP);
  const selector = route.selector ?? SEA_DROP_MINT_PUBLIC_SELECTOR;
  const request = (functionName, args = []) => client.readContract({ address: policyAddress, abi: POLICY_ABI, functionName, args, blockNumber });
  const [owner, nonce, policy, usage, flags, authorized, adapterAllowed, venueAllowed,
    selectorAllowed, currency, venueMaximum, controls, balance, block] = await Promise.all([
    client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "owner", blockNumber }),
    client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "acquisitionNonce", blockNumber }),
    request("policy", [account]), request("acquisitionUsage", [account]), request("featureFlags"),
    client.readContract({ address: agentRegistry, abi: AGENT_ABI, functionName: "isAuthorized", args: [account, agent], blockNumber }),
    request("approvedAdapters", [account, adapter]), request("approvedMintContracts", [account, venue]),
    request("approvedSelectors", [account, selector]), request("currencyPolicy", [account, NATIVE_CURRENCY]),
    request("venueCurrencyMaximum", [account, venue, NATIVE_CURRENCY]), request("mintControls", [account]),
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
    configuredScatterTargets: 0,
    missingActivatedAccounts: 0,
    liveScreenRejections: {},
    executionSimulationRejections: {},
    providerStateDisagreements: 0,
    executionSimulationsPassed: 0,
  };
}

function recordProfileOutcome(diagnostics, tokenId, state, reason, account = null) {
  if (!diagnostics || !/^(?:0|[1-9][0-9]{0,3})$/.test(String(tokenId))
    || !new Set(["QUEUED", "MINTED", "SKIPPED", "ERROR", "READY"]).has(state)
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

// These failures describe shared discovery/execution infrastructure, not a
// defect in any selected Punk. Execution still fails closed, but preserving a
// queued per-Punk outcome prevents a transient provider or platform gate issue
// from falsely asking every holder to repair or reactivate their Punk.
const PLATFORM_DELAY_FAILURE_CODES = new Set([
  "DISCOVERY_RPC_UNAVAILABLE",
  "DISCOVERY_INDEX_UNAVAILABLE",
  "DISCOVERY_INDEX_READ_FAILED",
  "DISCOVERY_INDEX_WRITE_FAILED",
  "DISCOVERY_SCAN_FAILED",
  "CANDIDATE_PREFILTER_FAILED",
  "CANDIDATE_STATE_READ_FAILED",
  "GLOBAL_STATE_READ_FAILED",
  "GLOBAL_V3_GATE_CLOSED",
  "GLOBAL_V3_ONCHAIN_GATE_CLOSED",
  "GLOBAL_V3_WORKER_BINDING_CLOSED",
  "PROFILE_STATE_READ_FAILED",
  "SOCIAL_RANKING_FAILED",
]);

export function isAutomationV3PlatformDelay(code) {
  return PLATFORM_DELAY_FAILURE_CODES.has(String(code ?? ""));
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
  pool, requestedTokenId = null, configuredTokenIds = [], agentAddress = null,
) {
  if (requestedTokenId !== null
    && (typeof requestedTokenId !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(requestedTokenId))) {
    throw new TypeError("invalid requested Punk token ID");
  }
  if (agentAddress !== null
    && (typeof agentAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(agentAddress))) {
    throw new TypeError("invalid automation V3 agent address");
  }
  const result = await pool.query(`
    WITH latest_saved_punks AS (
      SELECT DISTINCT ON (m.token_id) m.token_id, m.configured_by
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
    SELECT enrolled.token_id,
           COALESCE(enrollment.owner_snapshot, latest_saved_punks.configured_by) AS configured_by,
           COALESCE(enrollment.agent_address,
             '0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d') AS agent_address,
           COALESCE(enrollment.agent_lane, 1) AS agent_lane,
           NULL::jsonb AS economic_settings,
           NULL::jsonb AS risk_settings, NULL::jsonb AS artistic_preferences,
           TRUE AS automatic_profile
      FROM enrolled
      LEFT JOIN broker_automation_v3_enrollments enrollment
        ON enrollment.chain_id = $1
       AND enrollment.collection_address = $2
       AND enrollment.token_id = enrolled.token_id
      LEFT JOIN latest_saved_punks
        ON latest_saved_punks.token_id = enrolled.token_id
      LEFT JOIN broker_scouting_schedules schedule
        ON schedule.chain_id = $1
       AND schedule.collection_address = $2
       AND schedule.token_id = enrolled.token_id
     WHERE ($3::numeric IS NULL OR enrolled.token_id = $3::numeric)
       AND ($6::text IS NULL OR COALESCE(enrollment.agent_address,
         '0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d') = LOWER($6::text))
       AND (schedule.token_id IS NULL OR (schedule.enabled = TRUE
         AND NOW() >= schedule.start_at AND NOW() < schedule.end_at))
     ORDER BY enrolled.token_id
     LIMIT $4`, [4663, ROBINHOOD.canonicalCollection, requestedTokenId,
     ELIGIBLE_PROFILE_LIMIT, configuredTokenIds, agentAddress]);
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
        agent_address: agentAddress,
        agent_lane: null,
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

export function rarityPriorityBoostSeconds(rank) {
  if (!Number.isSafeInteger(rank) || rank < 1 || rank > 5_016) return 0;
  if (rank <= 51) return 1_200;
  if (rank <= 251) return 600;
  if (rank <= 753) return 300;
  if (rank <= 1_756) return 120;
  if (rank <= 3_010) return 60;
  return 0;
}

export async function fairlyOrderedAutomationV3Profiles(
  pool, profiles, requestedTokenId = null, report = console.error,
) {
  if (requestedTokenId !== null) return rotateAutomationV3Profiles(profiles);
  try {
    const tokenIds = profiles.map(({ token_id: tokenId }) => String(tokenId));
    // Owner snapshots are advisory scheduling keys only. Every selected Punk
    // still passes the existing live owner, authorization, policy, price, and
    // simulation gates before execution. Unknown owners receive a unique key
    // so incomplete metadata cannot make unrelated Punks share a queue lane.
    const ownerKeys = profiles.map((profile) => {
      const value = String(profile.configured_by ?? "").toLowerCase();
      return /^0x[0-9a-f]{40}$/.test(value) ? value : `punk:${profile.token_id}`;
    });
    const result = await pool.query(`
      WITH requested AS (
        SELECT *
          FROM UNNEST($1::numeric[], $2::text[]) WITH ORDINALITY
            AS input(punk_token_id, owner_key, roster_position)
      ), evidence_base AS (
        SELECT requested.punk_token_id, requested.owner_key,
               requested.roster_position, heartbeat.last_scheduled_scan,
               heartbeat.last_actual_scan,
               rarity.rarity_rank,
               heartbeat.last_scheduled_scan - MAKE_INTERVAL(secs => CASE
                 WHEN rarity.rarity_rank <= 51 THEN 1200
                 WHEN rarity.rarity_rank <= 251 THEN 600
                 WHEN rarity.rarity_rank <= 753 THEN 300
                 WHEN rarity.rarity_rank <= 1756 THEN 120
                 WHEN rarity.rarity_rank <= 3010 THEN 60
                 ELSE 0
               END) AS effective_last_scheduled_scan
          FROM requested
        LEFT JOIN broker_punk_agent_heartbeats heartbeat
          ON heartbeat.chain_id = 4663
         AND heartbeat.punk_token_id = requested.punk_token_id
        LEFT JOIN broker_punk_rarity_cache rarity
          ON rarity.chain_id = 4663
         AND rarity.collection_address = '${ROBINHOOD.canonicalCollection}'
         AND rarity.punk_token_id = requested.punk_token_id
      ), evidence AS (
        SELECT evidence_base.*,
               MAX(effective_last_scheduled_scan) OVER (
                 PARTITION BY owner_key
               ) AS owner_last_scheduled_scan,
               ROW_NUMBER() OVER (
                 PARTITION BY owner_key
                 ORDER BY effective_last_scheduled_scan ASC NULLS FIRST,
                          last_actual_scan ASC NULLS FIRST,
                          roster_position ASC
               ) AS owner_round
          FROM evidence_base
      )
      SELECT punk_token_id
        FROM evidence
       ORDER BY owner_round ASC,
                owner_last_scheduled_scan ASC NULLS FIRST,
                effective_last_scheduled_scan ASC NULLS FIRST,
                last_actual_scan ASC NULLS FIRST,
                roster_position ASC`, [tokenIds, ownerKeys]);
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

function discoveryStageError(code, cause) {
  const error = new Error(code, { cause });
  error.code = code;
  return error;
}

async function indexedActiveSeaDropCollections(database, nowSeconds) {
  try {
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
  } catch (error) {
    throw discoveryStageError("DISCOVERY_INDEX_READ_FAILED", error);
  }
}

async function discoveryRpcRead(
  primary, fallback, method, request, report = console.error,
) {
  try {
    return request === undefined
      ? await primary[method]() : await primary[method](request);
  } catch (primaryError) {
    if (!fallback || typeof fallback[method] !== "function" || fallback === primary) {
      throw discoveryStageError("DISCOVERY_RPC_UNAVAILABLE", primaryError);
    }
    try {
      const value = request === undefined
        ? await fallback[method]() : await fallback[method](request);
      report(JSON.stringify({
        event: "AUTOMATION_V3_DISCOVERY_RPC_FALLBACK",
        method: method === "getLogs" ? "LOGS" : "HEAD",
      }));
      return value;
    } catch (fallbackError) {
      throw discoveryStageError(
        "DISCOVERY_RPC_UNAVAILABLE",
        new AggregateError([primaryError, fallbackError], "both discovery providers failed"),
      );
    }
  }
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
  const report = dependencies.report ?? console.error;
  const fallbackClient = dependencies.fallbackClient;
  const nowSeconds = Math.floor((dependencies.nowMs ?? Date.now()) / 1_000);
  let head;
  try {
    head = await discoveryRpcRead(
      client, fallbackClient, "getBlockNumber", undefined, report,
    );
  } catch {
    report(JSON.stringify({
      event: "AUTOMATION_V3_DISCOVERY_INDEX_FALLBACK",
      reason: "HEAD_UNAVAILABLE",
    }));
    return indexedActiveSeaDropCollections(database, nowSeconds);
  }
  const confirmedBlock = head > confirmations ? head - confirmations : 0n;
  let checkpointResult;
  try {
    checkpointResult = await database.query(
      `SELECT indexed_through_block::text AS indexed_through_block
         FROM broker_seadrop_discovery_state
        WHERE chain_id = $1`,
      [4663],
    );
  } catch (error) {
    throw discoveryStageError("DISCOVERY_INDEX_READ_FAILED", error);
  }
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
  try {
    if (fromBlock <= toBlock) {
      for (let cursor = fromBlock; cursor <= toBlock; cursor += DISCOVERY_LOG_CHUNK_SIZE) {
        const chunkTo = cursor + DISCOVERY_LOG_CHUNK_SIZE - 1n < toBlock
          ? cursor + DISCOVERY_LOG_CHUNK_SIZE - 1n : toBlock;
        logs.push(...await discoveryRpcRead(client, fallbackClient, "getLogs", {
          address: getAddress(SEA_DROP), event: PUBLIC_DROP_UPDATED_EVENT,
          fromBlock: cursor, toBlock: chunkTo,
        }, report));
        if (chunkTo < toBlock) await pause();
      }
    }
  } catch {
    report(JSON.stringify({
      event: "AUTOMATION_V3_DISCOVERY_INDEX_FALLBACK",
      reason: "LOGS_UNAVAILABLE",
    }));
    return indexedActiveSeaDropCollections(database, nowSeconds);
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
  try {
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
  } catch (error) {
    throw discoveryStageError("DISCOVERY_INDEX_WRITE_FAILED", error);
  }
  return indexedActiveSeaDropCollections(database, nowSeconds);
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
  const ownerPaidPlan = dependencies.ownerPaidPlan === true;
  // Owner-paid planning is a read-only, user-initiated safety review. It does not
  // start the hosted scheduler and may remain available in a preview where the
  // autonomous worker is intentionally disabled.
  if (environment.BROKER_AUTOMATION_V3_ENABLED !== "true" && !ownerPaidPlan) {
    return { status: "DISABLED", submitted: 0 };
  }
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
  let submittedTokenId = null;
  let submittedAccount = null;
  let submittedCollection = null;
  let submittedTransactionHash = null;
  const budgetResult = () => ({
    status: "NO_ELIGIBLE_TARGETS", submitted: 0,
    diagnostics: { ...(currentDiagnostics ?? {}), scanBudgetExhausted: true },
  });
  try {
  if (ownerPaidPlan && dependencies.requestedTokenId == null) {
    throw new TypeError("owner-paid execution requires one exact requested Punk");
  }
  const configuredAgentAddress = getAddress(
    environment.BROKER_AUTOMATION_V3_AGENT_ADDRESS ?? AUTOMATION_V3_AGENT,
  ).toLowerCase();
  const key = environment.BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY;
  let signingAccount = null;
  if (dependencies.readOnly !== true && !ownerPaidPlan) {
    if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      const error = new TypeError("AGENT_SIGNER_UNAVAILABLE");
      error.code = "AGENT_SIGNER_UNAVAILABLE";
      throw error;
    }
    signingAccount = privateKeyToAccount(key);
    if (signingAccount.address.toLowerCase() !== configuredAgentAddress) {
      const error = new TypeError("AGENT_SIGNER_ADDRESS_MISMATCH");
      error.code = "AGENT_SIGNER_ADDRESS_MISMATCH";
      throw error;
    }
  }
  const { primary: primaryUrl, secondary: secondaryUrl } = resolveRobinhoodRpcPair(environment);
  const primary = dependencies.primary ?? readClient(primaryUrl, abortSignal);
  const secondary = dependencies.secondary ?? readClient(secondaryUrl, abortSignal);
  const discovery = dependencies.discovery ?? discoveryClient(primaryUrl, abortSignal);
  const discoveryFallback = dependencies.discoveryFallback
    ?? discoveryClient(secondaryUrl, abortSignal);
  const database = dependencies.database ?? getDatabase().pool;
  const requestedTokenId = dependencies.requestedTokenId ?? null;
  const configuredTokenIds = configuredAutomationV3PunkIds(environment);
  const eligibleProfiles = await workerStage(
    "PROFILE_DATABASE_READ_FAILED",
      () => eligibleAutomationV3Profiles(
        database, requestedTokenId, configuredTokenIds, configuredAgentAddress,
      ),
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
  const scatterTargets = configuredScatterTargets(environment);
  currentDiagnostics.configuredScatterTargets = scatterTargets.length;
  // A reviewed operator may temporarily constrain discovery to a small exact set.
  // This does not bypass any runtime, public-drop, dual-provider, policy, or simulation
  // gate below; it only prevents another eligible collection from consuming the Punk's
  // daily slot before a specifically selected launch.
  const directedCollections = configuredSeaDropCollections(environment);
  const priorityCollections = configuredPrioritySeaDropCollections(environment) ?? [];
  let discoveredCollections = [];
  if (directedCollections === null) {
    try {
      discoveredCollections = await workerStage(
        "DISCOVERY_SCAN_FAILED",
        () => incrementalSeaDropCollections(discovery, database, 20n, {
          fallbackClient: discoveryFallback,
          report: dependencies.report,
        }),
      );
    } catch (error) {
      if (scatterTargets.length === 0) throw error;
      dependencies.report?.(JSON.stringify({
        event: "SEADROP_DISCOVERY_DEFERRED_SCATTER_REMAINS_AVAILABLE",
        code: boundedWorkerCode(error?.code) ?? "DISCOVERY_SCAN_FAILED",
      }));
    }
  }
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
  let analyzedCandidates = [];
  try {
    analyzedCandidates = await workerStage(
      "CANDIDATE_PREFILTER_FAILED",
      () => activeZeroPriceSeaDropCollections(secondary, primary, collections),
    );
  } catch (error) {
    if (scatterTargets.length === 0) throw error;
    dependencies.report?.(JSON.stringify({
      event: "SEADROP_PREFILTER_DEFERRED_SCATTER_REMAINS_AVAILABLE",
      code: boundedWorkerCode(error?.code) ?? "CANDIDATE_PREFILTER_FAILED",
    }));
  }
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
  const routeCandidates = selectAutomationV3RouteCandidates(
    scatterTargets, candidates, Math.floor(startedAtMs / 300_000),
  );
  if (routeCandidates.length === 0) {
    const diagnostics = rejectionDiagnostics(profiles, collections, routeCandidates);
    diagnostics.totalEligibleProfiles = orderedProfiles.length;
    diagnostics.scheduledProfileBatch = profiles.length;
    diagnostics.analyzedCandidateBatch = 0;
    diagnostics.directedTargetCollections = directedCollections?.length ?? 0;
    diagnostics.priorityTargetCollections = priorityCollections.length;
    diagnostics.configuredScatterTargets = scatterTargets.length;
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
    () => confirmedAutomationV3GlobalState(
      () => (dependencies.readGlobalState ?? readAutomationV3GlobalState)(
        environment, { clients: [primary, secondary] },
      ),
      dependencies.globalGatePause,
    ),
  );
  const globalGateFailure = automationV3GlobalGateFailure(global);
  if (globalGateFailure) {
    currentDiagnostics.globalGate = Object.freeze({
      configured: global?.configured === true,
      workerEnabled: global?.worker?.enabled === true,
    });
    const error = new TypeError(globalGateFailure);
    error.code = globalGateFailure;
    throw error;
  }
  const diagnostics = rejectionDiagnostics(profiles, collections, routeCandidates);
  currentDiagnostics = diagnostics;
  diagnostics.totalEligibleProfiles = orderedProfiles.length;
  diagnostics.scheduledProfileBatch = profiles.length;
  diagnostics.analyzedCandidateBatch = routeCandidates.length;
  diagnostics.directedTargetCollections = directedCollections?.length ?? 0;
  diagnostics.priorityTargetCollections = priorityCollections.length;
  diagnostics.configuredScatterTargets = scatterTargets.length;
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
  const agent = getAddress(configuredAgentAddress);
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
    for (const routeCandidate of routeCandidates) {
      const { collection } = routeCandidate;
      const scatterTarget = routeCandidate.kind === "SCATTER" ? routeCandidate.target : null;
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
      const candidatePrefix = scatterTarget === null
        ? "canonical-live-seadrop" : "canonical-live-scatter";
      const reasoningPrefix = scatterTarget === null
        ? "reviewed-studio-active-zero-price" : "reviewed-scatter-public-zero-price";
      const candidate = {
        collection,
        opportunityId: keccak256(stringToHex(`${candidatePrefix}:${collection}`)),
        reasoningHash: keccak256(stringToHex(`${reasoningPrefix}:${collection}`)),
        contractRiskScore: 100, tasteMatch: 0,
        metadataSanitized: true, analysisComplete: true,
      };
      const commonScope = {
        account: accountAddress, agent, expectedOwner,
        nonce: BigInt(latestNonce).toString(),
        policyVersion: BigInt(field(latestPolicy, "version", 2)).toString(),
        createdAt: String(intentWindow.createdAt), expiresAt: String(intentWindow.expiresAt),
      };
      const scope = {
        ...commonScope, policyModule,
        adapter: manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.address,
        adapterCodeHash: manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.runtimeBytecodeHash,
      };
      let screen;
      try {
        if (scatterTarget !== null) {
          if (ownerPaidPlan) {
            const error = new TypeError("SCATTER_OWNER_PAID_UNSUPPORTED");
            error.code = "SCATTER_OWNER_PAID_UNSUPPORTED";
            throw error;
          }
          screen = await attestAutomatedScatterV3CandidateLive(
            scatterTarget,
            { ...commonScope, opportunityId: candidate.opportunityId,
              reasoningHash: candidate.reasoningHash },
            { primaryUrl, secondaryUrl },
            { confirmations: 20, maximumEvidenceAgeSeconds: 30 },
            {
              primary: scatterReadFacade(primary, primaryUrl),
              secondary: scatterReadFacade(secondary, secondaryUrl),
            },
          );
        } else {
          const attest = ownerPaidPlan
            ? attestOwnerPaidSeaDropV3CandidateLive : attestAutomatedSeaDropV3CandidateLive;
          screen = await attest(candidate, scope,
            { primaryUrl, secondaryUrl }, { confirmations: 20, maximumEvidenceAgeSeconds: 30 },
            { primary: readFacade(primary, primaryUrl), secondary: readFacade(secondary, secondaryUrl) });
        }
      } catch (error) {
        if (budgetExpired()) return budgetResult();
        recordLiveScreenRejection(diagnostics, error);
        continue;
      }
      const pinned = BigInt(screen.pinnedBlock.number);
      let first;
      let second;
      const route = scatterTarget === null ? {} : {
        adapter: scatterTarget.adapter,
        venue: scatterTarget.collection,
        selector: SCATTER_MINT_SELECTOR,
      };
      try {
        [first, second] = await Promise.all([
          accountState(primary, pinned, accountAddress, agent, route),
          accountState(secondary, pinned, accountAddress, agent, route),
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
          maxGasWeiPerRun: ownerPaidPlan ? (700000n * maxFee).toString() : first.balance.toString(),
          minAgentReserveWei: "10000000000000", intentTtlSeconds: 120,
          maxEvidenceAgeSeconds: 30,
          maxContractRiskScore: 100,
          minimumTasteMatch: 0,
          stopOnFailure: true },
      };
      let tx;
      let ownerExecution = null;
      try {
        if (scatterTarget !== null) {
          tx = buildAutomatedScatterV3Execution({
            target: scatterTarget,
            account: accountAddress,
            agent,
            expectedOwner,
            nonce: commonScope.nonce,
            policyVersion: commonScope.policyVersion,
            tokenId: screen.tokenId,
            createdAt: commonScope.createdAt,
            expiresAt: commonScope.expiresAt,
            opportunityId: candidate.opportunityId,
            reasoningHash: candidate.reasoningHash,
          });
          await Promise.all([
            primary.call({ account: agent, to: getAddress(tx.to), data: tx.data, value: 0n }),
            secondary.call({ account: agent, to: getAddress(tx.to), data: tx.data, value: 0n }),
          ]);
        } else if (ownerPaidPlan) {
          ownerExecution = buildOwnerPaidSeaDropV3Execution(
            profile, liveState(profile, first, screen, maxFee), { nowSeconds },
          );
          tx = ownerExecution.transaction;
          await primary.call({
            account: getAddress(expectedOwner), to: getAddress(tx.to), data: tx.data, value: 0n,
          });
        } else {
          const batch = buildAutomatedSeaDropV3ExecutionBatch(
            profile, liveState(profile, first, screen, maxFee), { nowSeconds },
          );
          [tx] = batch.transactions;
          await primary.call({ account: agent, to: getAddress(tx.to), data: tx.data, value: 0n });
        }
      } catch (error) {
        recordExecutionSimulationRejection(diagnostics, error);
        continue;
      }
      diagnostics.executionSimulationsPassed += 1;
      if (ownerPaidPlan) {
        recordProfileOutcome(
          diagnostics, tokenId, "READY", "OWNER_TRANSACTION_READY",
          accountAddress.toLowerCase(),
        );
        return {
          status: "OWNER_TRANSACTION_READY",
          submitted: 0,
          tokenId,
          account: accountAddress.toLowerCase(),
          collection,
          execution: ownerExecution,
          diagnostics,
        };
      }
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
      submittedTokenId = tokenId;
      submittedAccount = accountAddress.toLowerCase();
      submittedCollection = collection;
      submittedTransactionHash = hash;
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
        error.transactionHash = hash;
        error.tokenId = tokenId;
        error.account = accountAddress.toLowerCase();
        error.collection = collection;
        error.gasUsed = receipt.gasUsed?.toString?.() ?? null;
        error.effectiveGasPriceWei = receipt.effectiveGasPrice?.toString?.() ?? null;
        error.transactionGasCostWei = receipt.gasUsed != null
          && receipt.effectiveGasPrice != null
          ? (receipt.gasUsed * receipt.effectiveGasPrice).toString() : null;
        throw error;
      }
      recordProfileOutcome(
        diagnostics, tokenId, "MINTED", "MINT_CONFIRMED", accountAddress.toLowerCase(),
      );
      return { status: "MINT_CONFIRMED", submitted: 1, tokenId,
        account: accountAddress.toLowerCase(), collection, transactionHash: hash,
        gasUsed: receipt.gasUsed?.toString?.() ?? null,
        effectiveGasPriceWei: receipt.effectiveGasPrice?.toString?.() ?? null,
        transactionGasCostWei: receipt.gasUsed != null && receipt.effectiveGasPrice != null
          ? (receipt.gasUsed * receipt.effectiveGasPrice).toString() : null,
        diagnostics };
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
      // Once a transaction is submitted, any confirmation failure belongs only to that Punk.
      // The other Punks were merely waiting in the fair batch and must remain queued instead of
      // all being mislabeled as failed by one reverted transaction.
      const affectedTokenIds = workerFailureProfileTokenIds(
        currentDiagnostics, transactionSubmitted ? submittedTokenId : null,
      );
      recordWorkerFailureProfileOutcomes(currentDiagnostics, code, {
        affectedTokenIds, submittedTokenId, submittedAccount,
      });
      error.diagnostics = currentDiagnostics;
      if (submittedTransactionHash !== null) error.transactionHash = submittedTransactionHash;
      if (submittedTokenId !== null) error.tokenId = submittedTokenId;
      if (submittedAccount !== null) error.account = submittedAccount;
      if (submittedCollection !== null) error.collection = submittedCollection;
    }
    throw error;
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}

export function workerFailureProfileTokenIds(diagnostics, submittedTokenId = null) {
  const scheduled = Array.isArray(diagnostics?.scheduledTokenIds)
    ? diagnostics.scheduledTokenIds.map(String) : [];
  if (submittedTokenId === null) return scheduled;
  const selected = String(submittedTokenId);
  if (!scheduled.includes(selected)) {
    throw new TypeError("submitted Punk was not in the scheduled worker batch");
  }
  return [selected];
}

export function recordWorkerFailureProfileOutcomes(diagnostics, code, options = {}) {
  const affectedTokenIds = options.affectedTokenIds
    ?? workerFailureProfileTokenIds(diagnostics, options.submittedTokenId ?? null);
  const submittedTokenId = options.submittedTokenId ?? null;
  const submittedAccount = options.submittedAccount ?? null;
  const platformDelay = isAutomationV3PlatformDelay(code);
  for (const tokenId of affectedTokenIds) {
    recordProfileOutcome(
      diagnostics, tokenId,
      platformDelay ? "QUEUED" : "ERROR",
      platformDelay ? "WAITING_FOR_PLATFORM_RECOVERY" : code,
      tokenId === submittedTokenId ? submittedAccount : null,
    );
  }
  return diagnostics;
}
