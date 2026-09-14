import { randomUUID } from 'node:crypto';
import { encodeFunctionData,parseAbi } from 'viem';
import { manifestHash } from '../../broker/src/v4/skill-forge/capability-resolver.mjs';
export const ADMIN=`0x${'1'.repeat(40)}`,REGISTRY='0xc2a1bd47fbc0fe33e53c85f130be53591c898e83',KEY=`0x${'a'.repeat(64)}`,TX=`0x${'b'.repeat(64)}`;
export function skillAdminFixture() {
  const evidenceHash=`0x${'e'.repeat(64)}`,blockHash=`0x${'c'.repeat(64)}`;
  const skill={key:KEY,name:'Social Scout',skillId:7,version:1,manifestHash:`0x${'d'.repeat(64)}`,
    instructionHash:`0x${'f'.repeat(64)}`,evidenceHash,capabilities:'128',action:'REGISTER',registeredStatus:null,available:false};
  const data=encodeFunctionData({abi:parseAbi(['function register(uint32,uint16,bytes32,bytes32,bytes32,uint256,uint8)']),functionName:'register',
    args:[7,1,skill.manifestHash,skill.instructionHash,`0x${'0'.repeat(64)}`,128n,0]});
  skill.nextCalldata=data;
  const preparation={schema:'GOGH_READ_ONLY_SKILL_RELEASE_PREPARATION_V1',key:KEY,name:skill.name,action:'REGISTER',
    reviewEvidenceHash:evidenceHash,manifestHash:skill.manifestHash,instructionHash:skill.instructionHash,
    chainId:4663,anchor:{number:'99',hash:blockHash,timestamp:String(Math.floor(Date.now()/1000))},expiresAt:Date.now()+60000,
    maximumNetworkFeeWei:'10000000',transaction:{from:ADMIN,to:REGISTRY,data,value:'0x0',chainId:'0x1237',nonce:'0x7',gas:'0x186a0',gasPrice:'0x64'},
    walletConfirmationRequired:true,publicTransactions:0,serverReleaseActivated:false};
  let row=null;const log=[];
  const store={
    async get(owner,id){return row&&row.administrator===owner&&(!id?['PREPARED','WALLET_REQUESTED','SUBMITTED'].includes(row.status):row.id===id)?structuredClone(row):null;},
    async prepare(owner,requestKey,value,hash){if(row&&['PREPARED','WALLET_REQUESTED','SUBMITTED'].includes(row.status))return structuredClone(row);
      row={id:randomUUID(),administrator:owner,registry:REGISTRY,key:KEY,action:value.action,requestKey,preparation:structuredClone(value),reviewHash:hash,status:'PREPARED',revision:0,transactionHash:null,receipt:null};log.push('prepare');return structuredClone(row);},
    async update(owner,id,revision,from,to,patch={}){if(!row||row.administrator!==owner||row.id!==id||row.revision!==revision||!from.includes(row.status))throw Error('SKILL_ADMIN_REVIEW_CONFLICT');
      row={...row,status:to,revision:revision+1,...patch};log.push(to);return structuredClone(row);},
  };
  const state={administrator:ADMIN,chainId:4663,registry:REGISTRY,skills:[skill]};
  const review={inspect:async()=>structuredClone(state),prepareNext:async()=>structuredClone(preparation)};
  const observed={hash:TX,from:ADMIN,to:REGISTRY,input:data,value:0n,chainId:4663,nonce:7,gas:100000n,gasPrice:100n,blockNumber:100n,blockHash};
  const receipt={transactionHash:TX,from:ADMIN,to:REGISTRY,blockNumber:100n,blockHash,status:'success'};
  const clients=[0,1].map(()=>({getChainId:async()=>4663,getTransaction:async()=>structuredClone(observed),
    getTransactionReceipt:async()=>structuredClone(receipt),getBlock:async()=>({number:100n,hash:blockHash}),getBlockNumber:async()=>111n}));
  return {store,review,state,skill,preparation,clients,observed,receipt,log,get row(){return row;},set row(value){row=value;},
    prepared:()=>({record:row,transaction:preparation.transaction}),hash:()=>manifestHash(preparation)};
}
