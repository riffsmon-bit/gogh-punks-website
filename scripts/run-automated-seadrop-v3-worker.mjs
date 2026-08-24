import { getDatabase } from "@netlify/database";
import {
  createPublicClient, createWalletClient, getAddress, http, keccak256, parseAbi,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import manifest from "../deployments/robinhood-automation-v3.json" with { type: "json" };
import coreManifest from "../deployments/robinhood.json" with { type: "json" };
import { ROBINHOOD } from "../broker/src/config.mjs";
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

const ACCOUNT_ABI = parseAbi([
  "function owner() view returns (address)",
  "function acquisitionNonce() view returns (uint256)",
]);
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

function httpsUrl(name, value) {
  const url = new URL(value ?? "");
  if (url.protocol !== "https:" || url.hash) throw new TypeError(`${name} must be HTTPS`);
  return url.href;
}

function readClient(url) {
  return createPublicClient({
    chain: CHAIN,
    transport: http(url, {
      batch: { batchSize: 20, wait: 5 }, retryCount: 2, retryDelay: 500, timeout: 10_000,
    }),
  });
}

const DISCOVERY_COLLECTION_LIMIT = 128;
const DIRECTED_COLLECTION_LIMIT = 8;
const DISCOVERY_BATCH_SIZE = 8;
const DISCOVERY_RUNTIME_BATCH_SIZE = 4;
const DISCOVERY_BATCH_DELAY_MS = 250;

function discoveryDelay() {
  return new Promise((resolve) => setTimeout(resolve, DISCOVERY_BATCH_DELAY_MS));
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
    recentSeaDropCollections: collections.length,
    onchainZeroPriceCandidates: candidates.length,
    missingActivatedAccounts: 0,
    liveScreenRejections: {},
    executionSimulationRejections: {},
    providerStateDisagreements: 0,
    executionSimulationsPassed: 0,
  };
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

async function eligibleProfiles(pool, requestedTokenId = null) {
  if (requestedTokenId !== null
    && (typeof requestedTokenId !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(requestedTokenId))) {
    throw new TypeError("invalid requested Punk token ID");
  }
  const result = await pool.query(`
    SELECT DISTINCT ON (m.token_id) m.token_id, m.configured_by, m.economic_settings,
           m.risk_settings, m.artistic_preferences
      FROM broker_art_mandates m
     WHERE m.chain_id = $1 AND m.collection_address = $2 AND m.mode = 'AUTONOMOUS'
       AND ($3::numeric IS NULL OR m.token_id = $3::numeric)
     ORDER BY m.token_id, m.version DESC
     LIMIT 32`, [4663, ROBINHOOD.canonicalCollection, requestedTokenId]);
  return result.rows;
}

async function recentSeaDropCollections(client, confirmations = 20n) {
  const head = await client.getBlockNumber();
  const toBlock = head - confirmations;
  const fromBlock = toBlock > 1_000_000n ? toBlock - 1_000_000n : 0n;
  const logs = await client.getLogs({ address: getAddress(SEA_DROP), event: PUBLIC_DROP_UPDATED_EVENT, fromBlock, toBlock });
  return [...new Set(logs.toReversed()
    .map((log) => getAddress(log.args.nftContract).toLowerCase()))]
    .slice(0, DISCOVERY_COLLECTION_LIMIT);
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

async function activeZeroPriceSeaDropCollections(client, runtimeClient, collections, confirmations = 20n) {
  if (collections.length === 0) return [];
  const head = await client.getBlockNumber();
  const blockNumber = head - confirmations;
  const block = await client.getBlock({ blockNumber });
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
      } catch (error) {
        return { status: "failure", error };
      }
    })));
    await discoveryDelay();
  }
  const active = selectActiveZeroPriceSeaDropCollections(collections, results, block.timestamp);
  const publicDropReadFailures = results.filter((entry) => entry.status === "failure").length;
  if (active.length === 0 && publicDropReadFailures > 0) {
    throw new TypeError(`SeaDrop discovery incomplete: ${publicDropReadFailures} public-drop reads failed`);
  }
  const codes = [];
  let codeReadFailures = 0;
  for (let offset = 0; offset < active.length; offset += DISCOVERY_RUNTIME_BATCH_SIZE) {
    const batch = active.slice(offset, offset + DISCOVERY_RUNTIME_BATCH_SIZE);
    codes.push(...await Promise.all(batch.map(async (collection) => {
      try {
        return (await runtimeClient.getCode({ address: collection, blockNumber })) ?? "0x";
      } catch {
        codeReadFailures += 1;
        return "0x";
      }
    })));
    await discoveryDelay();
  }
  const reviewed = selectReviewedStudioCollections(active, codes);
  if (reviewed.length === 0 && codeReadFailures > 0) {
    throw new TypeError(`SeaDrop discovery incomplete: ${codeReadFailures} runtime reads failed`);
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
  const key = environment.BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY;
  let signingAccount = null;
  if (dependencies.readOnly !== true) {
    if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new TypeError("agent signer is unavailable");
    }
    signingAccount = privateKeyToAccount(key);
    if (signingAccount.address.toLowerCase() !== AUTOMATION_V3_AGENT) {
      throw new TypeError("agent signer address mismatch");
    }
  }
  const primaryUrl = httpsUrl("ROBINHOOD_RPC_URL", environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL);
  const secondaryUrl = httpsUrl("ROBINHOOD_SECONDARY_RPC_URL", environment.ROBINHOOD_SECONDARY_RPC_URL);
  const primary = dependencies.primary ?? readClient(primaryUrl);
  const secondary = dependencies.secondary ?? readClient(secondaryUrl);
  const global = await readAutomationV3GlobalState(environment, { clients: [primary, secondary] });
  if (!global.configured || !global.worker.enabled) throw new TypeError("global V3 gate is closed");
  const database = dependencies.database ?? getDatabase().pool;
  const requestedTokenId = dependencies.requestedTokenId ?? null;
  const profiles = await eligibleProfiles(database, requestedTokenId);
  if (profiles.length === 0) return { status: "NO_AUTONOMOUS_MANDATES", submitted: 0 };
  // A reviewed operator may temporarily constrain discovery to a small exact set.
  // This does not bypass any runtime, public-drop, dual-provider, policy, or simulation
  // gate below; it only prevents another eligible collection from consuming the Punk's
  // daily slot before a specifically selected launch.
  const directedCollections = configuredSeaDropCollections(environment);
  const priorityCollections = configuredPrioritySeaDropCollections(environment) ?? [];
  const discoveredCollections = directedCollections === null
    ? await recentSeaDropCollections(primary) : [];
  const collections = directedCollections
    ?? mergePrioritySeaDropCollections(priorityCollections, discoveredCollections);
  // Use the archive provider for the indexed public-drop reads, then move the much
  // smaller active set to the canonical endpoint for runtime classification. This
  // avoids exhausting either provider's per-second allowance. Every selected target
  // is still independently re-read and simulated by both clients before submission.
  const candidates = await activeZeroPriceSeaDropCollections(secondary, primary, collections);
  if (candidates.length === 0) return {
    status: "NO_ANALYZED_ACTIVE_TARGETS", submitted: 0,
    diagnostics: { profiles: profiles.length, recentSeaDropCollections: collections.length,
      directedTargetCollections: directedCollections?.length ?? 0, onchainZeroPriceCandidates: 0 },
  };
  const diagnostics = rejectionDiagnostics(profiles, collections, candidates);
  diagnostics.directedTargetCollections = directedCollections?.length ?? 0;
  diagnostics.priorityTargetCollections = priorityCollections.length;
  diagnostics.prioritySlotReservations = 0;
  diagnostics.priorityStateReadFailures = 0;
  const registry = getAddress(manifest.contracts.GoghPunkAccountRegistryV3.address);
  const policyModule = getAddress(manifest.contracts.BrokerPolicyModuleV3.address);
  const agent = getAddress(AUTOMATION_V3_AGENT);
  for (const row of profiles) {
    const tokenId = String(row.token_id);
    const accountAddress = await primary.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "account", args: [BigInt(tokenId)] });
    if (((await primary.getCode({ address: accountAddress })) ?? "0x") === "0x") {
      diagnostics.missingActivatedAccounts += 1;
      continue;
    }
    const priorityState = await pendingPriorityCollections(
      primary, secondary, accountAddress, priorityCollections,
    );
    diagnostics.priorityStateReadFailures += priorityState.readFailures;
    for (const collection of candidates) {
      const latestNonce = await primary.readContract({ address: accountAddress, abi: ACCOUNT_ABI, functionName: "acquisitionNonce" });
      const latestPolicy = await primary.readContract({ address: policyModule, abi: POLICY_ABI, functionName: "policy", args: [accountAddress] });
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
        account: accountAddress, agent, expectedOwner: row.configured_by, policyModule,
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
        recordLiveScreenRejection(diagnostics, error);
        continue;
      }
      const pinned = BigInt(screen.pinnedBlock.number);
      const [first, second] = await Promise.all([
        accountState(primary, pinned, accountAddress, agent), accountState(secondary, pinned, accountAddress, agent),
      ]);
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
      const maxFee = (await primary.estimateFeesPerGas()).maxFeePerGas ?? 1n;
      const cap = Number(row.economic_settings.maxMintsPerDay);
      const profile = {
        schema: "GOGH_AUTOMATED_SEADROP_V3_PROFILE_V1", version: 1, chainId: 4663,
        punk: { tokenId, collection: ROBINHOOD.canonicalCollection, account: accountAddress, expectedOwner: row.configured_by }, agent,
        infrastructure: { adapter: manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.address,
          adapterCodeHash: manifest.contracts.AutomatedSeaDropStudioFreeMintAdapter.runtimeBytecodeHash,
          seaDrop: SEA_DROP, seaDropCodeHash: SEA_DROP_CODE_HASH, cloneImplementation: CLONE_IMPLEMENTATION,
          cloneImplementationCodeHash: CLONE_IMPLEMENTATION_CODE_HASH,
          cloneCollectionRuntimeCodeHash: CLONE_COLLECTION_RUNTIME_CODE_HASH,
          studioCollectionRuntimeCodeHash: STUDIO_COLLECTION_RUNTIME_CODE_HASH },
        limits: { maxMintsPerUtcDay: cap, maxMintsPerRun: 1, maxGasPerMint: 700000,
          maxGasWeiPerRun: first.balance.toString(), minAgentReserveWei: "10000000000000", intentTtlSeconds: 120,
          maxEvidenceAgeSeconds: 30, maxContractRiskScore: Number(row.risk_settings.maxContractRiskScore),
          minimumTasteMatch: Number(row.artistic_preferences.minimumTasteMatch), stopOnFailure: true },
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
        return {
          status: "READ_ONLY_ELIGIBLE",
          submitted: 0,
          tokenId,
          account: accountAddress.toLowerCase(),
          collection,
          diagnostics,
        };
      }
      const wallet = createWalletClient({ account: signingAccount, chain: CHAIN, transport: http(primaryUrl, { retryCount: 0, timeout: 10_000 }) });
      const hash = await wallet.sendTransaction({ account: signingAccount, to: getAddress(tx.to), data: tx.data, value: 0n });
      const receipt = await primary.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
      if (receipt.status !== "success") throw new TypeError("autonomous mint reverted");
      return { status: "MINT_CONFIRMED", submitted: 1, tokenId, account: accountAddress.toLowerCase(), collection, transactionHash: hash };
    }
  }
  return { status: "NO_ELIGIBLE_TARGETS", submitted: 0, diagnostics };
}
