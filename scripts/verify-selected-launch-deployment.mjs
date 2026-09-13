import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http, getContractAddress, keccak256, pad, parseAbi, zeroAddress } from 'viem';
import { loadRegistryCanaryInputs } from '../broker/src/v4/skill-forge/registry-canary.mjs';
import { readSetupAnchor } from './dev/skill-forge/setup-read-client.mjs';

if(process.argv.length!==3 || process.argv[2]!=='--public-read-only')throw Error('Requires --public-read-only');
const root=new URL('../',import.meta.url);
const read=async path=>JSON.parse(await readFile(new URL(path,root)));
const setup=await(await fetch('http://127.0.0.1:64346/api/state')).json();
const records=setup.state.records.filter(record=>record.status==='INCLUDED');
assert.equal(records.length,4);assert.equal(new Set(records.map(r=>r.review.action)).size,4);
const deployment=records.find(record=>record.review.action==='DEPLOY_DIRECTED_PAID_MINT');
const factory=deployment.inclusion.contractAddress.toLowerCase();
const adapter=getContractAddress({from:factory,nonce:1n}).toLowerCase();
const factoryArtifact=await read('contracts/out/GoghPunkDirectedPaidMint.sol/GoghPunkDirectedPaidMintFactory.json');
const adapterArtifact=await read('contracts/out/AutomatedSeaDropStudioPaidMintAdapter.sol/AutomatedSeaDropStudioPaidMintAdapter.json');
const agentRelease=await read('deployments/robinhood-punk-agent-account.json');
const forgeRelease=await read('deployments/robinhood-forge-training.json');
const registry='0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844';
const registryHash=agentRelease.contracts.GoghPunkAgentAccountRegistry.runtimeBytecodeHash;
const seaDropHash='0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c';
const cloneImplementationHash='0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519';
const studioHash='0x69e7a7158f30acb817dc83a4e21af19a216c3a2ae57db423599ca82f321e3041';
const cloneRuntimeHash=keccak256('0x363d3d373d3d3d363d7309a26fc8fcef18192e267d7a6da9dfb4be81dd6a5af43d82803e903d91602b57fd5bf3');
const clients=['https://robinhood-rpc.publicnode.com','https://rpc.mainnet.chain.robinhood.com'].map(url=>createPublicClient({transport:http(url,{timeout:12000,retryCount:1}),cacheTime:0}));
const anchor=await readSetupAnchor(clients),verified=[];
function verifyRuntime(artifact,code,values) {
  let actual=code.slice(2),compiled=artifact.deployedBytecode.object.slice(2);
  assert.equal(actual.length,compiled.length);
  const found=[];
  for(const references of Object.values(artifact.deployedBytecode.immutableReferences)) {
    const locations=references.map(({start,length})=>{assert.equal(length,32);return actual.slice(start*2,(start+length)*2);});
    assert.equal(new Set(locations).size,1);found.push('0x'+locations[0]);
    for(const {start,length} of references) {
      actual=actual.slice(0,start*2)+'0'.repeat(length*2)+actual.slice((start+length)*2);
      compiled=compiled.slice(0,start*2)+'0'.repeat(length*2)+compiled.slice((start+length)*2);
    }
  }
  assert.deepEqual(found.sort(),values.map(value=>pad(value.toLowerCase())).sort());
  assert.equal(actual,compiled);return keccak256(code);
}
const inputs=await loadRegistryCanaryInputs(),rarity=inputs.pins.definitions.find(d=>d.slug==='rarity-eye');
for(const client of clients) {
  assert.equal(await client.getChainId(),4663);
  assert.equal((await client.getBlock({blockNumber:anchor.number})).hash,anchor.hash);
  for(const record of records) {
    const tx=await client.getTransaction({hash:record.transactionHash});
    const receipt=await client.getTransactionReceipt({hash:record.transactionHash});
    assert.equal(receipt.status,'success');assert.equal(receipt.blockHash,record.inclusion.blockHash);
    assert.equal((await client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);
    assert.equal(tx.input,record.review.transaction.data);assert.equal(tx.from.toLowerCase(),setup.config.owner.toLowerCase());
    assert.equal(tx.chainId,4663);assert.equal(tx.hash,record.transactionHash);
    assert.equal(tx.nonce,Number(BigInt(record.review.transaction.nonce)));assert.equal(tx.value,0n);
    assert.equal(tx.to?.toLowerCase()??null,record.review.transaction.to?.toLowerCase()??null);
  }
  const at=(address,abi,functionName,args=[])=>client.readContract({address,abi,functionName,args,blockNumber:anchor.number});
  assert.equal((await at(factory,factoryArtifact.abi,'agentRegistry')).toLowerCase(),registry);
  assert.equal(await at(factory,factoryArtifact.abi,'agentRegistryCodeHash'),registryHash);
  assert.equal((await at(factory,factoryArtifact.abi,'adapter')).toLowerCase(),adapter);
  assert.equal(await at(factory,factoryArtifact.abi,'vaults',[93n]),zeroAddress);
  const factoryHash=verifyRuntime(factoryArtifact,await client.getCode({address:factory,blockNumber:anchor.number}),[registry,registryHash,adapter]);
  const adapterHash=verifyRuntime(adapterArtifact,await client.getCode({address:adapter,blockNumber:anchor.number}),[seaDropHash,cloneImplementationHash,cloneRuntimeHash,studioHash]);
  for(const [name,expected] of Object.entries({expectedSeaDropCodeHash:seaDropHash,expectedCloneImplementationCodeHash:cloneImplementationHash,expectedCloneRuntimeCodeHash:cloneRuntimeHash,expectedStudioRuntimeCodeHash:studioHash}))assert.equal(await at(adapter,adapterArtifact.abi,name),expected);
  assert.equal(await at(adapter,adapterArtifact.abi,'isReviewedCollectionRuntime',['0xb73f1d1aee57410d537d87b656e98b9d3df5b213']),true);
  const ownerAbi=parseAbi(['function ownerOf(uint256) view returns(address)']);
  for(const id of [1753n,93n])assert.equal((await at(forgeRelease.collection,ownerAbi,'ownerOf',[id])).toLowerCase(),setup.config.owner.toLowerCase());
  assert.equal(keccak256(await client.getCode({address:forgeRelease.registry,blockNumber:anchor.number})),forgeRelease.registryCodeHash);
  const paused=await at(forgeRelease.registry,inputs.artifact.abi,'globallyDisabled');assert.equal(paused,true);
  const definition=await at(forgeRelease.registry,inputs.artifact.abi,'definition',[rarity.key]);
  assert.equal(definition.manifestHash,rarity.manifestHash);assert.equal(definition.instructionHash,rarity.instructionHash);
  assert.equal(definition.capabilities,8n);assert.equal(definition.skillId,4);assert.equal(definition.version,1);
  assert.equal(definition.status,4);assert.equal(definition.disabled,false);assert.equal(definition.deprecated,false);
  assert.equal(definition.reviewEvidenceHash,setup.config.reviewEvidenceHash);
  verified.push({factoryCodeHash:factoryHash,adapterCodeHash:adapterHash,paused});
}
assert.deepEqual(verified[0],verified[1]);
const evidence={schema:'GOGH_SELECTED_LAUNCH_DEPLOYMENT_V1',status:'VERIFIED_SETUP_INTEGRATION_PENDING',checkedAt:new Date().toISOString(),chainId:4663,
  owner:setup.config.owner.toLowerCase(),anchor:{number:String(anchor.number),hash:anchor.hash,timestamp:String(anchor.timestamp)},factory,adapter,...verified[0],
  factoryArtifact:'GoghPunkDirectedPaidMintFactory',adapterArtifact:'AutomatedSeaDropStudioPaidMintAdapter',compiledRuntimeAndImmutableBindingsVerified:true,
  registry,registryCodeHash:registryHash,rarityEye:{...rarity,packageCatalogStatus:rarity.status,status:'READY',registrationReceipts:records.slice(0,3).map(r=>r.inclusion)},
  deploymentReceipt:deployment.inclusion,sourceTokenId:'1753',targetTokenId:'93',bothOriginalPunksStillOwned:true,
  productionPaidMintAuthorized:false,productionBurnAuthorized:false,transactionsSentByVerifier:0};
await writeFile(new URL('docs/review/2026-09-12/selected-launch/deployed-contracts.json',root),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({status:evidence.status,factory,adapter,...verified[0],transactionsSentByVerifier:0}));
