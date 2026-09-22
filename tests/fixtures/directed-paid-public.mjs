import {keccak256,encodeAbiParameters,encodeEventTopics} from 'viem';
import base from '../../deployments/robinhood-directed-paid-mint.json' with {type:'json'};
import {publicPaidAccountCode,createPublicPaidCoordinator} from '../../broker/src/v4/directed-paid-public.mjs';
import {paidDigest} from '../../broker/src/v4/directed-paid-store.mjs';
export function publicPaidFixture(){
 const release=structuredClone(base);release.publicOwnerMint={...release.publicOwnerMint,status:'LIVE',enabled:true};
 const owner='0x'+'1'.repeat(40),recipient='0x'+'2'.repeat(40),tokenId='194',identity={owner,tokenId};const now=Date.now(),block={number:100n,hash:'0x'+'a'.repeat(64),timestamp:BigInt(Math.floor(now/1000))};const salt='0x'+'0'.repeat(64);
 const codes=new Map();for(const key of ['collection','agentRegistry','recipientImplementation','targetCollection']){const code='0x60'+String(codes.size+10);codes.set(release[key],code);release[key+'CodeHash']=keccak256(code);}codes.set(release.publicOwnerMint.seaDrop,'0x6019');release.publicOwnerMint.seaDropCodeHash=keccak256('0x6019');codes.set(recipient,publicPaidAccountCode(release,tokenId,salt));
 let row=null;const calls=[],mutations={owner,nonce:0,price:100000000000000n,state:0n,ended:false,activation:true,receipt:null,transaction:null};
 const client={getChainId:async()=>4663,getBlock:async()=>block,getBlockNumber:async()=>200n,getCode:async({address})=>address===recipient&&!mutations.activation?'0x':codes.get(address)??'0x',
  readContract:async({address,functionName,args})=>{switch(functionName){case 'ownerOf':return address===release.collection?mutations.owner:recipient;case 'account':return recipient;case 'accountSalt':return salt;case 'owner':return mutations.owner;case 'token':return [4663n,release.collection,BigInt(tokenId)];case 'state':return mutations.state;case 'getPublicDrop':return [mutations.price,0n,mutations.ended?1n:block.timestamp+10000n,5,1000,true];case 'getMintStats':return [0n,17n,100n];case 'getFeeRecipientIsAllowed':return true;default:throw Error(functionName);}},
  getTransactionCount:async()=>mutations.nonce,getBalance:async()=>10n**18n,getGasPrice:async()=>100n,estimateGas:async()=>150000n,call:async args=>{calls.push(args);return '0x';},getTransaction:async()=>mutations.transaction,getTransactionReceipt:async()=>mutations.receipt};
 const clients=[client,new Proxy(client,{})],store={current:async()=>row,get:async id=>row?.review.intentId===id?row:null,history:async()=>row&&['CONFIRMED','REVERTED'].includes(row.status)?[row]:[],save:async review=>{row={review,reviewHash:paidDigest(review),status:'PREPARED',revision:0,reportedHash:null,receipt:null};return structuredClone(row);},update:async(id,rev,status,reportedHash,receipt=null)=>{if(row?.review.intentId!==id||row.revision!==rev)throw Error('PAID_JOURNAL_CHANGED');row={...row,status,reportedHash,receipt,revision:rev+1};return structuredClone(row);}};
 const coordinator=createPublicPaidCoordinator({clients,release,identity,store,now:()=>now});
 const select={...identity,chainId:4663,preview:false};
 const envelope=record=>({ok:true,mode:'PUBLIC_OWNER_PAID_MINT',chainId:4663,...identity,record});
 function setReceipt(review,{status='success',to=recipient,duplicate=false}={}){const hash='0x'+'d'.repeat(64),t=review.transaction;mutations.transaction={hash,from:t.from,to:t.to,input:t.data,value:BigInt(t.value),chainId:4663,nonce:Number(BigInt(t.nonce)),gas:BigInt(t.gas),gasPrice:BigInt(t.gasPrice),blockHash:block.hash};
  const log={address:review.collection,blockHash:block.hash,blockNumber:block.number,transactionHash:hash,logIndex:0,removed:false,topics:encodeEventTopics({abi:[{type:'event',name:'Transfer',inputs:[{name:'from',type:'address',indexed:true},{name:'to',type:'address',indexed:true},{name:'tokenId',type:'uint256',indexed:true}]}],eventName:'Transfer',args:{from:'0x'+'0'.repeat(40),to,tokenId:18n}}),data:'0x'};
  mutations.receipt={transactionHash:hash,blockNumber:block.number,blockHash:block.hash,status,gasUsed:120000n,effectiveGasPrice:100n,logs:status==='success'?(duplicate?[log,log]:[log]):[]};return hash;
 }
 return {release,owner,recipient,identity,select,block,now,codes,mutations,calls,clients,store,coordinator,envelope,setReceipt};
}
