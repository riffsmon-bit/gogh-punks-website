import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesCompiledPaidRuntime, verifyPaidTrainingDeployment } from '../scripts/dev/skill-forge/paid-training-deployment.mjs';
test('deployment runtime verification rejects byte changes outside immutable slots and malformed references', () => {
  const artifact = { deployedBytecode: { object: `0x12${'00'.repeat(32)}34`, immutableReferences: { x: [{ start: 1, length: 32 }] } } };
  assert.equal(matchesCompiledPaidRuntime(artifact, `0x12${'ab'.repeat(32)}34`), true);
  assert.equal(matchesCompiledPaidRuntime(artifact, `0x13${'ab'.repeat(32)}34`), false);
  assert.equal(matchesCompiledPaidRuntime(artifact, '0x1234'), false);
  artifact.deployedBytecode.immutableReferences.x[0].length = 999;
  assert.equal(matchesCompiledPaidRuntime(artifact, `0x12${'ab'.repeat(32)}34`), false);
});
test('deployment verification requires exact dependencies, treasury, guardian, chain, paused purchases and price', async () => {
  const release = { priceWei: '500000000000000', skills: [{ key: 'skill' }] };
  for (const k of ['collection','registry','legacyProgression','treasury','collectionCodeHash','registryCodeHash','legacyProgressionCodeHash']) release[k] = k;
  const state = { ...release, owner:'guardian', deploymentChainId:4663n, purchasesPaused:true, creditPriceWei:500000000000000n, allowedSkill:true };
  const artifact = { abi:[], deployedBytecode:{ object:'0x1234', immutableReferences:{} } };
  const client = { getChainId:async()=>4663, getCode:async()=>'0x1234', readContract:async({functionName})=>state[functionName] };
  const args = { client, artifact, release, address:'extension', owner:'guardian', blockNumber:1n };
  assert.equal((await verifyPaidTrainingDeployment(args)).purchasesPaused, true);
  for (const [key,wrong] of [['treasury','other'],['owner','other'],['deploymentChainId',1n],['purchasesPaused',false],['creditPriceWei',1n],['allowedSkill',false]]) {
    const original=state[key]; state[key]=wrong; await assert.rejects(verifyPaidTrainingDeployment(args)); state[key]=original;
  }
});
