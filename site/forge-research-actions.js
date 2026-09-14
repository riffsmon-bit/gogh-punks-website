import { keccak256Hex } from './keccak256.js';
const word = value => BigInt(value).toString(16).padStart(64, '0');
export function forgeSkillKey(skillId, version) {
  if (!Number.isSafeInteger(skillId) || skillId < 1 || skillId > 0xffffffff
    || !Number.isSafeInteger(version) || version < 1 || version > 0xffff) throw Error('Invalid skill identity.');
  // Exact Solidity abi.encode("GOGH_SKILL", uint32 skillId, uint16 version).
  return keccak256Hex(`0x${word(96)}${word(skillId)}${word(version)}${word(10)}${'474f47485f534b494c4c'.padEnd(64, '0')}`);
}
const ACTIONS = new Map([
  [3, 1, 'inspect_contract'], [4, 1, 'rank_trait_sample'], [8, 1, 'get_market_listings'], [8, 2, 'get_market_listings'],
  [9, 1, 'rank_observed_listings'], [11, 1, 'research_collection'], [6, 1, 'classify_collection'],
  [7, 1, 'research_project'],
].map(([id, version, action]) => [forgeSkillKey(id, version), action]));
// A UI affordance only. The API still checks the exact released/learned/equipped
// package, current owner and continuity before and after executing the tool.
export const forgeResearchAction = key => ACTIONS.get(key) ?? null;
export const forgeResearchNeedsSample = action => ['rank_trait_sample', 'research_collection', 'classify_collection'].includes(action);
