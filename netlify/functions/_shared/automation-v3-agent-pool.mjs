import { getAddress } from "viem";

export const LEGACY_AUTOMATION_V3_AGENT =
  "0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d";
export const AUTOMATION_V3_AGENT_LANE_COUNT = 6;

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
    ? environment[addressName] || LEGACY_AUTOMATION_V3_AGENT
    : environment[addressName];
  const address = configuredAddress
    ? normalizedAddress(configuredAddress, `Automation V3 lane ${laneId} address`) : null;
  const poolEnabled = environment.BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED === "true";
  const enabled = laneId === 1
    ? environment.BROKER_AUTOMATION_V3_ENABLED === "true"
    : poolEnabled && environment[`BROKER_AUTOMATION_V3_AGENT_LANE_${laneId}_ENABLED`] === "true"
      && address !== null;
  return Object.freeze({
    laneId,
    address,
    keyName,
    privateKey: environment[keyName] ?? null,
    enabled,
    priority: laneId === AUTOMATION_V3_AGENT_LANE_COUNT,
  });
}

export function configuredAutomationV3AgentLanes(environment = process.env) {
  const lanes = [];
  const addresses = new Set();
  for (let laneId = 1; laneId <= AUTOMATION_V3_AGENT_LANE_COUNT; laneId += 1) {
    const lane = automationV3AgentLane(environment, laneId);
    if (!lane.enabled || !lane.address) continue;
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

export function assignedAutomationV3AgentLane(tokenIdValue, environment = process.env) {
  const tokenId = String(tokenIdValue);
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(tokenId)) {
    throw new TypeError("Choose a valid Gogh Punk ID");
  }
  const regular = configuredAutomationV3AgentLanes(environment)
    .filter((lane) => lane.priority !== true);
  const lanes = regular.length > 0 ? regular : configuredAutomationV3AgentLanes(environment);
  return lanes[Number(BigInt(tokenId) % BigInt(lanes.length))];
}

export function automationV3LaneEnvironment(environment = process.env, laneValue = 1) {
  const lane = automationV3AgentLane(environment, laneValue);
  if (!lane.enabled || !lane.address) throw new TypeError("Automation V3 lane is not enabled");
  return Object.freeze({
    ...environment,
    BROKER_AUTOMATION_V3_AGENT_ADDRESS: lane.address,
    BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY: lane.privateKey,
    BROKER_AUTOMATION_V3_ACTIVE_LANE: String(lane.laneId),
  });
}

export function automationV3LaneLockId(laneValue) {
  // Preserve the reviewed production worker's original lock ID for lane 1.
  // Additional lanes occupy the following IDs after the lease-table constraint
  // is expanded by the corresponding database migration.
  return 46_630_002 + laneNumber(laneValue);
}
