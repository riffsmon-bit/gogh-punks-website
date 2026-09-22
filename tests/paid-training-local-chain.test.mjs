import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import net from 'node:net';
import {createPublicClient,createWalletClient,http,keccak256} from 'viem';
import artifact from '../deployments/robinhood-paid-training.json' with {type:'json'};
import {createPaidTrainingCoordinator,PAID_ABI,PAID_ZERO} from '../broker/src/v4/skill-forge/paid-training.mjs';
const compiled=async(file,name)=>JSON.parse(await readFile(new URL(`../contracts/out/${file}/${name}.json`,import.meta.url),'utf8'));
const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});

test('real local EVM: exact paid credit, canonical learning/equipment, recovery and transfer', {timeout:90000},async t=>{
  const rpcPort=await port();
  const child=spawn('anvil',['--host','127.0.0.1','--port',String(rpcPort),'--chain-id','4663','--base-fee','1','--gas-price','1','--silent'],{stdio:'ignore'});
  t.after(()=>child.kill('SIGTERM'));
  let spawnError;child.on('error',e=>spawnError=e);
  const transport=http(`http://127.0.0.1:${rpcPort}`,{retryCount:0,timeout:3000});
  const client=createPublicClient({transport,cacheTime:0});
  let connected=false;
  for(let i=0;i<40;i++){if(spawnError)throw spawnError;try{connected=await client.getChainId()===4663;}catch{}if(connected)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(connected,'private loopback Anvil started');
  assert.match(await client.request({method:'web3_clientVersion'}),/anvil/i);
  const [owner,bob]=await client.request({method:'eth_accounts'});
  const wallet=createWalletClient({transport,account:owner});
  const receipt=async hash=>{const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;};
  const deploy=async(a,args)=> (await receipt(await wallet.deployContract({abi:a.abi,bytecode:a.bytecode.object,args,chain:null}))).contractAddress.toLowerCase();
  const write=async(a,address,functionName,args)=>receipt(await wallet.writeContract({abi:a.abi,address,functionName,args,chain:null}));
  const nft=await compiled('GoghSkillForge.t.sol','SkillForgeMockPunks');
  // Canonical collection address is used ONLY on this isolated local chain.
  const localNft=await deploy(nft,[]),collection=artifact.collection;
  await client.request({method:'anvil_setCode',params:[collection,await client.getCode({address:localNft})]});
  await write(nft,collection,'mint',[owner,93n]);
  const registryArtifact=await compiled('GoghSkillRegistry.sol','GoghSkillRegistry');
  const registry=await deploy(registryArtifact,[owner]);
  const progressionArtifact=await compiled('GoghReviewedSkillProgression.sol','GoghReviewedSkillProgression');
  // The paid journey never calls the source; real sacrifice coexistence is tested by Foundry.
  const legacyProgression=await deploy(progressionArtifact,[collection,registry,registry,keccak256('0x1234'),keccak256('0x5678')]);
  const skill=artifact.skills[0];
  await write(registryArtifact,registry,'register',[4,1,skill.manifestHash,skill.instructionHash,PAID_ZERO,8n,0]);
  await write(registryArtifact,registry,'setStatus',[skill.key,3,PAID_ZERO]);
  await write(registryArtifact,registry,'setStatus',[skill.key,4,keccak256('0x99')]);
  const config={chainId:4663n,collection,registry,legacyProgression,treasury:artifact.treasury,guardian:owner,
    collectionCodeHash:keccak256(await client.getCode({address:collection})),registryCodeHash:keccak256(await client.getCode({address:registry})),
    legacyProgressionCodeHash:keccak256(await client.getCode({address:legacyProgression}))};
  const paidArtifact=await compiled('GoghPaidSkillTraining.sol','GoghPaidSkillTraining');
  const extension=await deploy(paidArtifact,[config,[skill.key]]);
  const release={...artifact,status:'OWNER_CANARY',registry,legacyProgression,extension,allowedOwners:[owner.toLowerCase()],
    collectionCodeHash:config.collectionCodeHash,registryCodeHash:config.registryCodeHash,legacyProgressionCodeHash:config.legacyProgressionCodeHash,
    extensionCodeHash:keccak256(await client.getCode({address:extension})),canonicalReadersReviewed:true,productionPaymentsAuthorized:true};
  // Local Anvil suggests a 1 gwei tip regardless of --gas-price; keep this
  // fixture inside the real release fee ceiling, with fees still checked on-chain.
  const reviewedClient={...client,estimateFeesPerGas:async()=>({maxFeePerGas:1000000n,maxPriorityFeePerGas:1n})};
  const coordinator=createPaidTrainingCoordinator({clients:[new Proxy(reviewedClient,{}),reviewedClient],release});
  const identity={owner:owner.toLowerCase(),tokenId:'93'};
  const action=operation=>({operation,skillKey:['learn','equip'].includes(operation)?skill.key:PAID_ZERO,slot:0});
  assert.equal((await coordinator.get(identity)).purchasesPaused,true);
  await assert.rejects(coordinator.prepare({...identity,action:action('buy')}),/PURCHASE_UNAVAILABLE/);
  await write(paidArtifact,extension,'setPurchasesPaused',[false]);
  const treasuryBefore=await client.getBalance({address:artifact.treasury});
  const reviews=[];
  for(const operation of ['buy','activate','learn','equip']){
    const {review}=await coordinator.prepare({...identity,action:action(operation)});
    await coordinator.verify(review);
    const hash=await client.request({method:'eth_sendTransaction',params:[review.transaction]});
    await receipt(hash);reviews.push(review);
    // Anvil uses a confirmation-depth finalized tag; advance only this local chain.
    await client.request({method:'anvil_mine',params:['0x40','0x0']});
    const result=await coordinator.recover({...identity,review,transactionHash:hash});
    assert.equal(result.status,'CONFIRMED_SUCCESS');
    assert.equal((await coordinator.recover({...identity,review,transactionHash:hash})).status,'CONFIRMED_SUCCESS');
  }
  assert.equal((await client.getBalance({address:artifact.treasury}))-treasuryBefore,500000000000000n);
  const state=await coordinator.get(identity);
  assert.equal(state.purchasedCredits,'0');assert.equal(state.burnCredits,'0');assert.equal(state.skills[0].level,1);assert.equal(state.equipped[0],skill.key);
  assert.equal(await client.readContract({address:extension,abi:PAID_ABI,functionName:'effectiveCapabilities',args:[93n]}),8n);
  await assert.rejects(coordinator.verify(reviews[0]));
  await write(nft,collection,'transferFrom',[owner,bob,93n]);
  await assert.rejects(coordinator.get(identity));
  // Inclusive transfer-log continuity intentionally rejects the transfer block.
  await client.request({method:'evm_mine',params:[]});
  const transferred=await coordinator.get({owner:bob.toLowerCase(),tokenId:'93'});
  assert.equal(transferred.skills[0].level,1);assert.equal(transferred.equipped[0],skill.key);
});
