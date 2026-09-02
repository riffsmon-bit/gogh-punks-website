import { getAddress } from "viem";

export const LEGACY_AUTOMATION_V3_AGENT =
  "0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d";
export const AUTOMATION_V3_AGENT_LANE_COUNT = 6;

// Lane workers expose the selected signer through the legacy generic variables because the
// reviewed execution path consumes those names. Keep the canonical lane-one binding separately
// so a later pool read cannot mistake the selected lane for lane one and reject the pool as a
// duplicate. A private Symbol keeps this snapshot process-local and out of serialized diagnostics.
const CANONICAL_LANE_ONE = Symbol("automation-v3-canonical-lane-one");

function laneNumber(value) {
  const laneId = Number(value);
  if (!Number.isInteger(laneId) || laneId < 1 || laneId > AUTOMATION_V3_AGENT_LANE_COUNT) {
    throw new TypeError("Automation V3 lane must be 1 through 6");
  }
  return laneId;
}

function normalizedAddress(value, name) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  return getAddress(value).toLowerCase();
}

export function automationV3AgentLane(environment = process.env, laneValue = 1) {
  const laneId = laneNumber(laneValue);
  const suffix = laneId === 1 ? "" : `_LANE_${laneId}`;
  const addressName = `BROKER_AUTOMATION_V3_AGENT${suffix}_ADDRESS`;
  const keyName = `BROKER_AUTOMATION_V3_AGENT${suffix}_PRIVATE_KEY`;
  const configuredAddress = laneId === 1
    ? environment[CANONICAL_LANE_ONE]?.address
      ?? environment[addressName] ?? LEGACY_AUTOMATION_V3_AGENT
    : environment[addressName];
  const address = configuredAddress
    ? normalizedAddress(configuredAddress, `Automation V3 lane ${laneId} address`) : null;
  const poolEnabled = environment.BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED === "true";
  const requestedEnabled = laneId === 1
    ? environment.BROKER_AUTOMATION_V3_ENABLED === "true"
    : poolEnabled && environment[`BROKER_AUTOMATION_V3_AGENT_LANE_${laneId}_ENABLED`] === "true";
  if (requestedEnabled && address === null) {
    throw new TypeError(`Automation V3 lane ${laneId} address is required`);
  }
  const privateKey = laneId === 1
    ? environment[CANONICAL_LANE_ONE]?.privateKey ?? environment[keyName] ?? null
    : environment[keyName] ?? null;
  return Object.freeze({
    laneId,
    address,
    keyName,
    privateKey,
    signerConfigured: typeof privateKey === "string" && /^0x[0-9a-fA-F]{64}$/.test(privateKey),
    enabled: requestedEnabled,
    priority: laneId === AUTOMATION_V3_AGENT_LANE_COUNT,
  });
}

export function regularAutomationV3AgentLanes(environment = process.env, options = {}) {
  const lanes = configuredAutomationV3AgentLanes(environment, options)
    .filter((lane) => lane.priority !== true);
  if (lanes.length === 0) {
    throw new TypeError("No regular automation V3 signer lane is enabled");
  }
  return Object.freeze(lanes);
}

export function configuredAutomationV3AgentLanes(environment = process.env, options = {}) {
  const lanes = [];
  const addresses = new Set();
  for (let laneId = 1; laneId <= AUTOMATION_V3_AGENT_LANE_COUNT; laneId += 1) {
    const lane = automationV3AgentLane(environment, laneId);
    if (!lane.enabled || !lane.address) continue;
    if (options.requirePrivateKeys === true && lane.signerConfigured !== true) {
      throw new TypeError(`Automation V3 lane ${laneId} private key is invalid`);
    }
    if (addresses.has(lane.address)) {
      throw new TypeError("Every enabled automation lane must use a distinct signer");
    }
    addresses.add(lane.address);
    lanes.push(lane);
  }
  if (lanes.length === 0) throw new TypeError("No automation V3 signer lane is enabled");
  return Object.freeze(lanes);
}

// Safe for public status surfaces. Signer key names and private key material are
// deliberately omitted; the explorer links let holders independently inspect
// the native-gas lane that processed their Punk.
export function publicAutomationV3AgentLanes(environment = process.env) {
  return Object.freeze(configuredAutomationV3AgentLanes(environment).map((lane) =>
    Object.freeze({
      laneId: lane.laneId,
      address: lane.address,
      priority: lane.priority === true,
      explorerUrl: `https://robinhoodchain.blockscout.com/address/${lane.address}`,
    })));
}

export function assignedAutomationV3AgentLane(
  tokenIdValue, environment = process.env, options = {},
) {
  const tokenId = String(tokenIdValue);
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(tokenId)) {
    throw new TypeError("Choose a valid Gogh Punk ID");
  }
  const lanes = regularAutomationV3AgentLanes(environment, options);
  return lanes[Number(BigInt(tokenId) % BigInt(lanes.length))];
}

export function automationV3LaneEnvironment(environment = process.env, laneValue = 1) {
  const selectedLaneId = laneNumber(laneValue);
  const canonicalLaneOne = automationV3AgentLane(environment, 1);
  const lane = configuredAutomationV3AgentLanes(environment, { requirePrivateKeys: true })
    .find(({ laneId }) => laneId === selectedLaneId);
  if (!lane) throw new TypeError("Automation V3 lane is not enabled");
  return Object.freeze({
    ...environment,
    [CANONICAL_LANE_ONE]: Object.freeze({
      address: canonicalLaneOne.address,
      privateKey: canonicalLaneOne.privateKey,
    }),
    BROKER_AUTOMATION_V3_AGENT_ADDRESS: lane.address,
    BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY: lane.privateKey,
    BROKER_AUTOMATION_V3_ACTIVE_LANE: String(lane.laneId),
  });
}

function release(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

// Public, non-secret diagnostics for worker readiness. Only public addresses, booleans, counts,
// lane identifiers, release SHAs, and bounded reason enums leave this boundary.
export function automationV3WorkerBindingDiagnostics(environment = process.env, options = {}) {
  const expectedRelease = release(environment.BROKER_AUTOMATION_V3_WORKER_RELEASE);
  const actualRelease = release(environment.COMMIT_REF);
  const actualReleaseRequired = environment.CONTEXT === "production";
  const activeLaneValue = environment.BROKER_AUTOMATION_V3_ACTIVE_LANE ?? "1";
  const activeLaneId = Number(activeLaneValue);
  const activeLaneValid = Number.isInteger(activeLaneId)
    && activeLaneId >= 1 && activeLaneId <= AUTOMATION_V3_AGENT_LANE_COUNT;
  const activeAgentValue = environment.BROKER_AUTOMATION_V3_AGENT_ADDRESS;
  let activeAgent = null;
  try {
    activeAgent = normalizedAddress(activeAgentValue, "Automation V3 active agent");
  } catch {
    activeAgent = null;
  }
  const poolVariablePresent = typeof environment.BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED
    === "string";
  const poolEnabled = environment.BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED === "true";
  let poolParseSucceeded = false;
  let poolParseError = null;
  let lanes = [];
  try {
    lanes = configuredAutomationV3AgentLanes(environment);
    poolParseSucceeded = true;
  } catch (error) {
    poolParseError = error instanceof TypeError ? "INVALID_CONFIGURATION" : "UNKNOWN_ERROR";
  }
  let selectedLane = null;
  if (activeLaneValid) {
    try {
      selectedLane = automationV3AgentLane(environment, activeLaneId);
    } catch {
      selectedLane = null;
    }
  }
  const activeAgentFound = activeAgent !== null
    && lanes.some(({ address }) => address === activeAgent);
  const selectedLaneEnabled = selectedLane?.enabled === true;
  const selectedLaneMatchesAgent = selectedLane?.address === activeAgent;
  const requiredPublicConfigurationPresent = options.requiredPublicConfigurationPresent !== false;
  let reason = "READY";
  if (expectedRelease === null) reason = "EXPECTED_RELEASE_INVALID";
  else if (actualReleaseRequired && actualRelease === null) reason = "ACTUAL_RELEASE_INVALID";
  else if (actualRelease !== null && actualRelease !== expectedRelease) reason = "RELEASE_MISMATCH";
  else if (!activeLaneValid) reason = "ACTIVE_LANE_INVALID";
  else if (!poolVariablePresent || !poolEnabled) reason = "AGENT_POOL_DISABLED";
  else if (!poolParseSucceeded) reason = "AGENT_POOL_PARSE_FAILED";
  else if (lanes.length === 0) reason = "AGENT_POOL_EMPTY";
  else if (selectedLane === null) reason = "ACTIVE_LANE_NOT_FOUND";
  else if (!selectedLaneEnabled) reason = "ACTIVE_LANE_DISABLED";
  else if (activeAgent === null) reason = "ACTIVE_AGENT_MISSING";
  else if (!activeAgentFound) reason = "ACTIVE_AGENT_NOT_IN_POOL";
  else if (!selectedLaneMatchesAgent) reason = "ACTIVE_AGENT_LANE_MISMATCH";
  else if (!requiredPublicConfigurationPresent) reason = "PUBLIC_CONFIGURATION_MISSING";
  return Object.freeze({
    enabled: reason === "READY",
    reason,
    expectedRelease,
    actualRelease,
    releaseMatches: actualRelease === null ? null : actualRelease === expectedRelease,
    activeLaneId: activeLaneValid ? activeLaneId : null,
    laneConfigurationFound: selectedLane?.address != null,
    poolVariablePresent,
    poolEnabled,
    poolParseSucceeded,
    poolParseError,
    poolSize: lanes.length,
    poolNonEmpty: lanes.length > 0,
    activeAgentPresent: activeAgent !== null,
    activeAgent,
    activeAgentFound,
    selectedLaneEnabled,
    selectedLaneMatchesAgent,
    requiredPublicConfigurationPresent,
  });
}

export function automationV3LaneLockId(laneValue) {
  // Preserve the reviewed production worker's original lock ID for lane 1.
  // Additional lanes occupy the following IDs after the lease-table constraint
  // is expanded by the corresponding database migration.
  return 46_630_002 + laneNumber(laneValue);
}
