import artifact from '../../deployments/robinhood-paid-training.json' with {type:'json'};
import { keccak256 } from 'viem';
import { PAID_ZERO } from '../../broker/src/v4/skill-forge/paid-training.mjs';
export function paidFixture() {
  const extension='0x1111111111111111111111111111111111111111';
  const codes={collection:'0x6001',registry:'0x6002',legacyProgression:'0x6003',extension:'0x6004'};
  const owner=artifact.treasury,tokenId='93',key=artifact.skills[0].key;
  const release={...structuredClone(artifact),status:'OWNER_CANARY',extension,extensionCodeHash:keccak256(codes.extension),allowedOwners:[owner],canonicalReadersReviewed:true,productionPaymentsAuthorized:true};
  for(const name of Object.keys(codes))release[name+'CodeHash']=keccak256(codes[name]);
  const state={owner,paused:false,activated:false,credits:0n,burn:1n,reviewNonce:0n,walletNonce:7,slots:1,claimed:0,burnApproved:false,
    level:0,available:true,equipped:[PAID_ZERO],logs:[],now:1800000000000,hash:'0x'+'ab'.repeat(32),stateHash:'0x'+'cc'.repeat(32),finalizedTime:1800000000n};
  const calls=[];
  const client={
    getChainId:async()=>4663,
    getBlock:async({blockTag,blockNumber}={})=>({number:blockNumber??100n,hash:state.hash,timestamp:blockTag==='finalized'?state.finalizedTime:BigInt(Math.floor(state.now/1000)),baseFeePerGas:1n}),
    getCode:async({address})=>{calls.push(['code',address]);return codes[Object.keys(codes).find(k=>release[k].toLowerCase()===address.toLowerCase())]??'0x';},
    readContract:async({functionName,address,args=[]})=>{
      calls.push([functionName,address]);
      const values={collection:release.collection,registry:release.registry,legacyProgression:release.legacyProgression,treasury:release.treasury,
        creditPriceWei:500000000000000n,ownerOf:state.owner,purchasesPaused:state.paused,activated:state.activated,purchasedCredits:state.credits,
        reviewNonce:state.reviewNonce,reviewStateHash:state.stateHash,unlockedSlots:state.slots,trainingCredits:state.burn,
        trainingSource:release.registry,getApproved:state.burnApproved?release.registry:'0x'+'00'.repeat(20),isApprovedForAll:false,
        claimedStartingSlots:state.claimed,equipped:state.equipped[args[1]],learnedLevel:state.level,available:state.available,allowedSkill:true,
        definition:{...release.skills[0],prerequisite:PAID_ZERO,riskTier:0,capabilities:8n,status:4,disabled:false,deprecated:false},
      };if(!Object.hasOwn(values,functionName))throw Error('unhandled '+functionName);return values[functionName];
    },
    getLogs:async()=>state.logs,
    getTransactionCount:async()=>state.walletNonce,
    estimateFeesPerGas:async()=>({maxFeePerGas:1000000n,maxPriorityFeePerGas:1n}),
    estimateGas:async()=>100000n,getBalance:async()=>1000000000000000000n,call:async()=>({data:'0x'}),
  };
  return {release,owner,tokenId,key,state,client,calls,identity:{owner,tokenId},now:()=>state.now,
    action:operation=>({operation,skillKey:['learn','equip'].includes(operation)?key:PAID_ZERO,slot:0})};
}
