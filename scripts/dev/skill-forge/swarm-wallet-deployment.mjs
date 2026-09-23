import { readFile } from 'node:fs/promises';
import { keccak256 } from 'viem';
import { AGENT_RECOVERY_PINS } from '../../../site/punk-agent-recovery.js';
const root = new URL('../../../', import.meta.url), pins = AGENT_RECOVERY_PINS;
const valid = (ok, code) => { if (!ok) throw Error(code); };
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export const SWARM_SETUP_OWNER = '0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6';
export const SWARM_COLLECTION_CODE_HASH = '0x3222e4925f77909e6370e17fe071d2774d43e191f6bc72c3a97c97209c6e2e93';
async function artifact(name) {
  const result = JSON.parse(await readFile(new URL(`contracts/out/${name}.sol/${name}.json`, root)));
  valid(result.metadata.compiler.version === '0.8.34+commit.80d5c536' && result.metadata.settings.viaIR
    && result.metadata.settings.optimizer.runs === 500 && result.metadata.settings.evmVersion === 'cancun', 'SWARM_BUILD_UNVERIFIED');
  for (const [path, source] of Object.entries(result.metadata.sources)) {
    valid(!path.includes('..') && /^(contracts\/(src|test)\/|node_modules\/@openzeppelin\/contracts\/)/.test(path), 'SWARM_BUILD_PATH');
    valid(keccak256(await readFile(new URL(path, root))) === source.keccak256, 'SWARM_BUILD_STALE');
  }
  return result;
}
export async function loadSwarmDeployment() {
  const [factory, vault] = await Promise.all(['SwarmGasVaultFactory','SwarmGasVault'].map(artifact));
  return { factory, vault, release: { chainId:4663, collection:pins.collection, registry:pins.registry, implementation:pins.implementation,
    registryCodeHash:pins.registryHash, implementationCodeHash:pins.implementationHash },
    configuration:[4663n,pins.collection,pins.registry,pins.implementation] };
}
export async function verifySwarmDependencies({ client, release, blockNumber }) {
  valid(await client.getChainId() === 4663, 'SWARM_SETUP_WRONG_CHAIN');
  for (const key of ['registry','implementation']) valid(keccak256(await client.getCode({address:release[key],blockNumber}) ?? '0x') === release[`${key}CodeHash`], 'SWARM_DEPENDENCY_CHANGED');
  valid(keccak256(await client.getCode({address:release.collection,blockNumber}) ?? '0x') === SWARM_COLLECTION_CODE_HASH, 'SWARM_COLLECTION_CHANGED');
}
export function matchesCompiledSwarmRuntime(artifact, code) {
  if (!/^0x[0-9a-f]+$/i.test(code ?? '')) return false;
  const expected=Buffer.from(artifact.deployedBytecode.object.slice(2),'hex'), actual=Buffer.from(code.slice(2),'hex');
  if (expected.length !== actual.length) return false;
  for (const refs of Object.values(artifact.deployedBytecode.immutableReferences ?? {})) for (const {start,length} of refs) {
    if (!Number.isInteger(start) || length !== 32 || start < 0 || start+length > actual.length) return false;
    expected.fill(0,start,start+length);actual.fill(0,start,start+length);
  }
  return expected.equals(actual);
}
export async function verifySwarmDeployment({ client, factory, release, address, blockNumber }) {
  await verifySwarmDependencies({client,release,blockNumber});
  const code=await client.getCode({address,blockNumber}); valid(matchesCompiledSwarmRuntime(factory,code),'SWARM_FACTORY_RUNTIME_MISMATCH');
  const read=name=>client.readContract({address,abi:factory.abi,functionName:name,blockNumber});
  for (const key of ['collection','registry','implementation','registryCodeHash','implementationCodeHash']) valid(same(await read(key),release[key]),'SWARM_FACTORY_BINDING_MISMATCH');
  valid(await read('chainId')===4663n,'SWARM_FACTORY_CHAIN_MISMATCH');
  const registryAbi=[{type:'function',name:'accountSalt',stateMutability:'view',inputs:[],outputs:[{type:'bytes32'}]},
    {type:'function',name:'canonicalRegistry',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}];
  for (const key of ['accountSalt','canonicalRegistry']) valid(same(await read(key),await client.readContract({address:release.registry,abi:registryAbi,functionName:key,blockNumber})),'SWARM_FACTORY_REGISTRY_MISMATCH');
  return {address,runtimeCodeHash:keccak256(code)};
}
