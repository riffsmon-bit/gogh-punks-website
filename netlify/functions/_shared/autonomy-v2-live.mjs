import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";

import automationManifest from "../../../deployments/robinhood-automation-v2.json" with { type: "json" };
import coreManifest from "../../../deployments/robinhood.json" with { type: "json" };
import { ROBINHOOD } from "../../../broker/src/config.mjs";

export const AUTOMATION_V2_AGENT = "0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d";
export const SEA_DROP = "0x00005ea00ac477b1030ce78506496e8c2de24bf5";

const OWNER_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const REGISTRY_ABI = parseAbi(["function account(uint256 tokenId) view returns (address)"]);
const ADAPTER_ABI = parseAbi([
  "function globallyPaused() view returns (bool)",
  "function adapterRecord(address adapter) view returns ((uint8 kind,bool active,address venue,bytes32 adapterCodeHash,bytes32 venueCodeHash,bytes32 versionHash,bytes32 metadataHash))",
]);
const POLICY_ABI = parseAbi([
  "function globallyPaused() view returns (bool)",
  "function featureFlags() view returns ((bool scoutMode,bool approvalPurchases,bool autonomousPurchases,bool autonomousMints,bool unknownCollectionExecution,bool selling,bool autonomousSelling))",
]);
const AGENT_ABI = parseAbi([
  "function globallyPaused() view returns (bool)",
  "function globalAgent(address agent) view returns ((bool approved,uint64 validAfter,uint64 validUntil,bytes32 versionHash,bytes32 metadataHash))",
]);

function requiredHttps(name, value) {
  if (typeof value !== "string" || value.length > 2_048) throw new TypeError(`${name} is unavailable`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hash) throw new TypeError(`${name} must use HTTPS`);
  return url.href;
}

function client(url) {
  return createPublicClient({ transport: http(url, { retryCount: 1, timeout: 8_000 }) });
}

function tuple(value, key, index) {
  const selected = value?.[key] ?? value?.[index];
  if (selected === undefined) throw new TypeError(`RPC tuple is missing ${key}`);
  return selected;
}

function normalizeGlobal(values, nowSeconds) {
  const [adapterRecord, adapterPaused, flags, policyPaused, agentRecord, agentPaused,
    adapterCode, policyCode, registryCode] = values;
  const normalized = {
    adapter: {
      kind: Number(tuple(adapterRecord, "kind", 0)),
      active: tuple(adapterRecord, "active", 1),
      venue: getAddress(tuple(adapterRecord, "venue", 2)).toLowerCase(),
      adapterCodeHash: tuple(adapterRecord, "adapterCodeHash", 3).toLowerCase(),
      versionHash: tuple(adapterRecord, "versionHash", 5).toLowerCase(),
      metadataHash: tuple(adapterRecord, "metadataHash", 6).toLowerCase(),
      globallyPaused: adapterPaused,
    },
    features: {
      scoutMode: tuple(flags, "scoutMode", 0),
      approvalPurchases: tuple(flags, "approvalPurchases", 1),
      autonomousPurchases: tuple(flags, "autonomousPurchases", 2),
      autonomousMints: tuple(flags, "autonomousMints", 3),
      unknownCollectionExecution: tuple(flags, "unknownCollectionExecution", 4),
      selling: tuple(flags, "selling", 5),
      autonomousSelling: tuple(flags, "autonomousSelling", 6),
      globallyPaused: policyPaused,
    },
    agent: {
      address: AUTOMATION_V2_AGENT,
      approved: tuple(agentRecord, "approved", 0),
      validAfter: BigInt(tuple(agentRecord, "validAfter", 1)).toString(),
      validUntil: BigInt(tuple(agentRecord, "validUntil", 2)).toString(),
      versionHash: tuple(agentRecord, "versionHash", 3).toLowerCase(),
      metadataHash: tuple(agentRecord, "metadataHash", 4).toLowerCase(),
      globallyPaused: agentPaused,
    },
    runtime: {
      adapter: keccak256(adapterCode),
      policyModule: keccak256(policyCode),
      accountRegistry: keccak256(registryCode),
    },
  };
  const expected = {
    adapter: automationManifest.contracts.AutomatedSeaDropFreeMintAdapter.runtimeBytecodeHash,
    policyModule: automationManifest.contracts.BrokerPolicyModuleV2.runtimeBytecodeHash,
    accountRegistry: automationManifest.contracts.GoghPunkAccountRegistryV2.runtimeBytecodeHash,
  };
  normalized.configured = normalized.adapter.kind === 1 && normalized.adapter.active === true
    && normalized.adapter.venue === SEA_DROP && normalized.adapter.globallyPaused === false
    && normalized.adapter.adapterCodeHash === expected.adapter
    && normalized.features.scoutMode === true
    && normalized.features.approvalPurchases === false
    && normalized.features.autonomousPurchases === true
    && normalized.features.autonomousMints === true
    && normalized.features.unknownCollectionExecution === true
    && normalized.features.selling === false
    && normalized.features.autonomousSelling === false
    && normalized.features.globallyPaused === false
    && normalized.agent.approved === true && normalized.agent.globallyPaused === false
    && BigInt(normalized.agent.validAfter) <= BigInt(nowSeconds)
    && BigInt(normalized.agent.validUntil) > BigInt(nowSeconds + 7 * 86_400)
    && normalized.runtime.adapter === expected.adapter
    && normalized.runtime.policyModule === expected.policyModule
    && normalized.runtime.accountRegistry === expected.accountRegistry;
  return normalized;
}

async function readGlobal(clientValue) {
  const adapter = getAddress(automationManifest.contracts.AutomatedSeaDropFreeMintAdapter.address);
  const policy = getAddress(automationManifest.contracts.BrokerPolicyModuleV2.address);
  const registry = getAddress(automationManifest.contracts.GoghPunkAccountRegistryV2.address);
  const agentRegistry = getAddress(coreManifest.contracts.ArtAgentRegistry.address);
  const [adapterRecord, adapterPaused, flags, policyPaused, agentRecord, agentPaused,
    adapterCode, policyCode, registryCode] = await Promise.all([
    clientValue.readContract({ address: getAddress(coreManifest.contracts.ArtAdapterRegistry.address), abi: ADAPTER_ABI, functionName: "adapterRecord", args: [adapter] }),
    clientValue.readContract({ address: getAddress(coreManifest.contracts.ArtAdapterRegistry.address), abi: ADAPTER_ABI, functionName: "globallyPaused" }),
    clientValue.readContract({ address: policy, abi: POLICY_ABI, functionName: "featureFlags" }),
    clientValue.readContract({ address: policy, abi: POLICY_ABI, functionName: "globallyPaused" }),
    clientValue.readContract({ address: agentRegistry, abi: AGENT_ABI, functionName: "globalAgent", args: [getAddress(AUTOMATION_V2_AGENT)] }),
    clientValue.readContract({ address: agentRegistry, abi: AGENT_ABI, functionName: "globallyPaused" }),
    clientValue.getCode({ address: adapter }),
    clientValue.getCode({ address: policy }),
    clientValue.getCode({ address: registry }),
  ]);
  if (![adapterCode, policyCode, registryCode].every((value) => typeof value === "string" && value !== "0x")) {
    throw new TypeError("V2 runtime code is unavailable");
  }
  return [adapterRecord, adapterPaused, flags, policyPaused, agentRecord, agentPaused,
    adapterCode, policyCode, registryCode];
}

export async function readAutomationV2GlobalState(environment = process.env, options = {}) {
  const primaryUrl = requiredHttps("ROBINHOOD_RPC_URL", environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL);
  const secondaryUrl = requiredHttps("ROBINHOOD_SECONDARY_RPC_URL", environment.ROBINHOOD_SECONDARY_RPC_URL);
  if (new URL(primaryUrl).hostname === new URL(secondaryUrl).hostname) {
    throw new TypeError("V2 readiness requires two distinct RPC hosts");
  }
  const clients = options.clients ?? [client(primaryUrl), client(secondaryUrl)];
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const [primary, secondary] = await Promise.all(clients.map(readGlobal));
  const first = normalizeGlobal(primary, nowSeconds);
  const second = normalizeGlobal(secondary, nowSeconds);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new TypeError("V2 providers disagree");
  const workerRelease = environment.BROKER_AUTOMATION_V2_WORKER_RELEASE?.trim() ?? "";
  const workerEnabled = environment.BROKER_AUTOMATION_V2_ENABLED === "true"
    && /^[0-9a-f]{40}$/.test(workerRelease)
    && (environment.BROKER_AUTOMATION_V2_AGENT_ADDRESS ?? "").toLowerCase() === AUTOMATION_V2_AGENT;
  return Object.freeze({ ...first, worker: { enabled: workerEnabled, release: workerRelease || null } });
}

export async function buildLiveOwnerSetupInput(tokenIdValue, limits, environment = process.env) {
  if (typeof tokenIdValue !== "string" || !/^(0|[1-9][0-9]{0,3})$/.test(tokenIdValue)) {
    throw new TypeError("Choose a valid Gogh Punk ID");
  }
  const cap = Number(limits.maxMintsPerUtcDay);
  const days = Number(limits.authorizationDays);
  if (![1, 3, 5, 10].includes(cap) || ![7, 14, 30].includes(days)) {
    throw new TypeError("Choose a supported cap and authorization duration");
  }
  const primaryUrl = requiredHttps("ROBINHOOD_RPC_URL", environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL);
  const secondaryUrl = requiredHttps("ROBINHOOD_SECONDARY_RPC_URL", environment.ROBINHOOD_SECONDARY_RPC_URL);
  const clients = [client(primaryUrl), client(secondaryUrl)];
  const global = await readAutomationV2GlobalState(environment, { clients });
  if (!global.configured || !global.worker.enabled) throw new TypeError("V2 worker is not ready");
  const tokenId = BigInt(tokenIdValue);
  const registry = getAddress(automationManifest.contracts.GoghPunkAccountRegistryV2.address);
  const reads = await Promise.all(clients.map(async (rpc) => {
    const [owner, account] = await Promise.all([
      rpc.readContract({ address: getAddress(ROBINHOOD.canonicalCollection), abi: OWNER_ABI, functionName: "ownerOf", args: [tokenId] }),
      rpc.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "account", args: [tokenId] }),
    ]);
    const code = (await rpc.getCode({ address: account })) ?? "0x";
    return { owner: getAddress(owner).toLowerCase(), account: getAddress(account).toLowerCase(), accountCreated: code !== "0x" };
  }));
  if (JSON.stringify(reads[0]) !== JSON.stringify(reads[1])) throw new TypeError("V2 owner/account providers disagree");
  return {
    schema: "GOGH_AUTOMATED_SEADROP_OWNER_SETUP_INPUT_V1", version: 1, chainId: 4663,
    checkedAt: new Date().toISOString(),
    punk: { tokenId: tokenIdValue, collection: ROBINHOOD.canonicalCollection, expectedOwner: reads[0].owner, account: reads[0].account, accountCreated: reads[0].accountCreated },
    infrastructure: {
      accountRegistry: registry,
      policyModule: automationManifest.contracts.BrokerPolicyModuleV2.address,
      agentRegistry: coreManifest.contracts.ArtAgentRegistry.address,
      agent: AUTOMATION_V2_AGENT,
    },
    limits: { maxMintsPerUtcDay: cap, authorizationDays: days },
    globalAgent: { approved: true, validAfter: global.agent.validAfter, validUntil: global.agent.validUntil },
  };
}
