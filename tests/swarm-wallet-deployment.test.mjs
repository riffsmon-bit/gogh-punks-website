import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { matchesCompiledSwarmRuntime, verifySwarmDependencies } from '../scripts/dev/skill-forge/swarm-wallet-deployment.mjs';

test('deployment runtime verification permits only compiler-designated immutable words', () => {
  const code = '0x6001' + '00'.repeat(32) + '6002';
  const artifact = { deployedBytecode: { object: code, immutableReferences: { 1:[{start:2,length:32}] } } };
  assert.equal(matchesCompiledSwarmRuntime(artifact, '0x6001' + 'ab'.repeat(32) + '6002'), true);
  assert.equal(matchesCompiledSwarmRuntime(artifact, '0x6003' + 'ab'.repeat(32) + '6002'), false);
  assert.equal(matchesCompiledSwarmRuntime(artifact, code+'00'), false);
  assert.equal(matchesCompiledSwarmRuntime(artifact, '0x'), false);
  for (const ref of [{start:-1,length:32},{start:2,length:33},{start:9,length:32},{start:1.5,length:32}]) {
    assert.equal(matchesCompiledSwarmRuntime({deployedBytecode:{object:code,immutableReferences:{1:[ref]}}},code),false);
  }
});

test('deployment dependency checks reject wrong chain before any state read', async () => {
  const client={ getChainId:async()=>1, getCode:()=>assert.fail('No wrong-chain read') };
  await assert.rejects(verifySwarmDependencies({client,release:{},blockNumber:1n}),/SWARM_SETUP_WRONG_CHAIN/);
});

test('changed account code or an arbitrary collection cannot pass deployment preparation', async () => {
  const code='0x60016001', release={registry:'registry',implementation:'implementation',collection:'collection',
    registryCodeHash:keccak256(code),implementationCodeHash:keccak256(code)};
  for (const altered of ['registry','implementation','collection']) {
    const reads=[];
    const client={getChainId:async()=>4663,getCode:async({address,blockNumber})=>{
      assert.equal(blockNumber,7n);reads.push(address);return address===altered?'0x60026002':code;
    }};
    await assert.rejects(verifySwarmDependencies({client,release,blockNumber:7n}),
      altered==='collection'?/SWARM_COLLECTION_CHANGED/:/SWARM_DEPENDENCY_CHANGED/);
    assert.equal(reads.at(-1),altered);
  }
});
