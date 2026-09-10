import { decodeEventLog, keccak256, parseAbi, parseAbiItem, stringToHex } from 'viem';
import { readEpochOwnership } from '../v4/skill-forge/epoch-ownership.mjs';
import { normalizePunkAgentAccountDeployment, PUNK_AGENT_EPOCH_DEPLOYMENT_SCHEMA } from './punk-agent-account-manifest.mjs';

const BOUND = parseAbiItem('event SessionEpochBound(uint64 indexed generation,uint256 indexed epoch,uint256 securityGeneration)');
const abi = parseAbi(['function AUTHORITY_MODEL() view returns (bytes32)', 'function wrapper() view returns (address)',
  'function epochs() view returns (address)', 'function progression() view returns (address)',
  'function authorizedEpoch() view returns (uint256)', 'function authorizedSecurityGeneration() view returns (uint256)']);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const fail = code => { throw Object.assign(new Error(code), { code }); };

// Called only after the shared guard verifies canonical authorization receipt and session event.
export async function verifyEpochSessionOwnership({ client, deployment, mission, receipt, blockNumber }) {
  const manifest = normalizePunkAgentAccountDeployment(deployment);
  if (manifest.schema !== PUNK_AGENT_EPOCH_DEPLOYMENT_SCHEMA || manifest.status !== 'DEPLOYED') fail('OWNERSHIP_CONTINUITY_UNVERIFIED');
  const pins = manifest.epochAuthority;
  const read = functionName => client.readContract({ address: mission.account, abi, functionName, blockNumber });
  const [model, wrapper, epochs, progression, authorizedEpoch, security, code] = await Promise.all([
    read('AUTHORITY_MODEL'), read('wrapper'), read('epochs'), read('progression'), read('authorizedEpoch'), read('authorizedSecurityGeneration'),
    client.getCode({ address: pins.progression.address, blockNumber }),
  ]);
  if (model !== keccak256(stringToHex('GOGH_WRAPPED_EPOCH_V1')) || !same(wrapper, pins.wrapper.address)
    || !same(epochs, pins.epochs.address) || !same(progression, pins.progression.address)
    || keccak256(code ?? '0x') !== pins.progression.runtimeBytecodeHash) fail('OWNERSHIP_CONTINUITY_UNVERIFIED');
  const state = await readEpochOwnership({ client, blockNumber, chainId: manifest.chainId,
    collection: manifest.canonicalCollection, progression, tokenId: mission.tokenId,
    config: { wrapper, epochs, wrapperCodeHash: pins.wrapper.runtimeBytecodeHash, epochsCodeHash: pins.epochs.runtimeBytecodeHash } });
  const events = receipt.logs.flatMap(log => {
    if (!same(log.address, mission.account)) return [];
    try { return [decodeEventLog({ abi: [BOUND], data: log.data, topics: log.topics, strict: true })]; }
    catch { return []; }
  });
  if (events.length !== 1 || events[0].args.generation !== BigInt(mission.sessionGeneration)
    || events[0].args.epoch !== authorizedEpoch || events[0].args.securityGeneration !== security) fail('OWNERSHIP_CONTINUITY_UNVERIFIED');
  if (!same(state.owner, mission.owner)) fail('OWNER_CHANGED');
  if (!state.wrapped || state.executionPaused || BigInt(state.epoch) !== authorizedEpoch
    || BigInt(state.securityGeneration) !== security) fail('OWNERSHIP_CHANGED_SINCE_AUTHORIZATION');
  return state;
}
