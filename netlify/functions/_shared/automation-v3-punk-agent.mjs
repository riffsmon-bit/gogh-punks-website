import { readAutomationV3PunkState } from "./autonomy-v3-live.mjs";
import {
  assignedAutomationV3AgentLane, regularAutomationV3AgentLanes,
} from "./automation-v3-agent-pool.mjs";
import { automationV3PunkAgentAssignment } from "./automation-v3-worker-state.mjs";

export async function resolveAutomationV3PunkAgent(
  tokenId, environment = process.env, options = {},
) {
  const lanes = regularAutomationV3AgentLanes(environment);
  const assignment = await (options.assignment ?? automationV3PunkAgentAssignment)(
    tokenId, { database: options.database },
  );
  let preferred;
  if (assignment) {
    preferred = lanes.find(({ laneId, address }) => laneId === assignment.lane
      && address === assignment.agent);
    if (!preferred) {
      const error = new TypeError(
        `Punk #${tokenId} is assigned to an unavailable automation lane`,
      );
      error.code = "PUNK_AGENT_LANE_UNAVAILABLE";
      throw error;
    }
  } else {
    preferred = assignedAutomationV3AgentLane(tokenId, environment);
  }
  const readPunk = options.readPunk ?? ((selectedTokenId, agentAddress) => (
    readAutomationV3PunkState(selectedTokenId, environment, { agentAddress })
  ));
  if (assignment) {
    const punk = await readPunk(tokenId, preferred.address);
    return Object.freeze({ punk, lane: preferred, assigned: true });
  }
  // Before lane assignments were persisted, every Punk authorized the legacy
  // signer. Probe the enabled regular lanes once so an existing on-chain
  // authorization is adopted instead of being silently reassigned. Once the
  // enrollment row is written, only that exact lane is ever read again.
  const candidates = [preferred, ...lanes].filter((value, index, values) => value
    && values.findIndex(({ address }) => address === value.address) === index);
  let first = null;
  for (const lane of candidates) {
    const punk = await readPunk(tokenId, lane.address);
    first ??= { punk, lane };
    if (punk?.active === true) return Object.freeze({ punk, lane, assigned: false });
  }
  return Object.freeze({ ...(first ?? { punk: null, lane: preferred }), assigned: false });
}
