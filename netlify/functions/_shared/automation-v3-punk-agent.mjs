import { readAutomationV3PunkState } from "./autonomy-v3-live.mjs";
import {
  assignedAutomationV3AgentLane, configuredAutomationV3AgentLanes,
} from "./automation-v3-agent-pool.mjs";
import { automationV3PunkAgentAssignment } from "./automation-v3-worker-state.mjs";

export async function resolveAutomationV3PunkAgent(
  tokenId, environment = process.env, options = {},
) {
  const lanes = configuredAutomationV3AgentLanes(environment);
  const assignment = await (options.assignment ?? automationV3PunkAgentAssignment)(
    tokenId, { database: options.database },
  ).catch(() => null);
  const preferred = assignment
    ? lanes.find(({ address }) => address === assignment.agent)
    : assignedAutomationV3AgentLane(tokenId, environment);
  const candidates = [preferred, ...lanes].filter((value, index, values) => value
    && values.findIndex(({ address }) => address === value.address) === index);
  const readPunk = options.readPunk ?? ((selectedTokenId, agentAddress) => (
    readAutomationV3PunkState(selectedTokenId, environment, { agentAddress })
  ));
  let first = null;
  for (const lane of candidates) {
    const punk = await readPunk(tokenId, lane.address);
    first ??= { punk, lane };
    if (punk?.active === true) return Object.freeze({ punk, lane, assigned: assignment !== null });
  }
  return Object.freeze({ ...(first ?? { punk: null, lane: preferred }), assigned: assignment !== null });
}
