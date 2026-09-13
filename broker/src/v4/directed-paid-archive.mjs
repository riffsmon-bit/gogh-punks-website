import {keccak256} from 'viem';
import {PAID_ABI,paidAssert,paidJson,paidRead,paidSame} from './directed-paid-mint.mjs';

// Check the history methods the worker will need BEFORE reserving a wallet
// request. A successful latest-state read does not establish archive access.
export async function verifyPaidHistoryAccess(clients,release,anchor) {
 const to=BigInt(anchor.number);
 return verifyPaidHistoryRange(clients,release,anchor,to>20000n?to-20000n:0n);
}

export async function verifyPaidHistoryRange(clients,release,anchor,from) {
 let providerStatus=[];
 try {
  paidAssert(clients.length===2&&clients[0]!==clients[1],'PAID_HISTORY_UNAVAILABLE');
  const to=BigInt(anchor.number);
  paidAssert(from>=0n&&from<=to,'PAID_HISTORY_UNAVAILABLE');
  const observed=await Promise.allSettled(clients.map(async(c,index)=>{
   const status={provider:index===0?'PRIMARY':'SECONDARY',status:'CHECKING',stage:'CHAIN'};providerStatus.push(status);
   try {
   paidAssert(await c.getChainId()===4663,'PAID_HISTORY_UNAVAILABLE');
   status.stage='ARCHIVE';
   const block=await c.getBlock({blockNumber:from});
   const [code,owner,logs]=await Promise.all([
    c.getCode({address:release.collection,blockNumber:from}),
    paidRead(c,release.collection,'ownerOf',[93n],from),
    c.getLogs({address:release.collection,event:PAID_ABI.find(e=>e.type==='event'&&e.name==='Transfer'),
     args:{tokenId:93n},fromBlock:from,toBlock:to,strict:true}),
   ]);
   paidAssert(keccak256(code??'0x')===release.collectionCodeHash&&/^0x[0-9a-f]{40}$/i.test(owner)
    &&paidSame((await c.getBlock({blockNumber:to})).hash,anchor.hash),'PAID_HISTORY_UNAVAILABLE');
   status.status='READY';
   return {hash:block.hash,owner:owner.toLowerCase(),logs};
   }catch(error){status.status='UNAVAILABLE';
    for(let e=error,n=0;e&&n<8;e=e.cause,n++){
     if(Number.isInteger(e.status))status.httpStatus=e.status;
     if(Number.isInteger(e.code))status.rpcCode=e.code;
    }throw error;
   }
  }));
  paidAssert(observed.every(r=>r.status==='fulfilled'),'PAID_HISTORY_UNAVAILABLE');
  const results=observed.map(r=>r.value);
  paidAssert(paidJson(results[0])===paidJson(results[1]),'PAID_HISTORY_UNAVAILABLE');
  return {status:'READY',verifiedProviders:2};
 }catch {throw Object.assign(Error('PAID_HISTORY_UNAVAILABLE'),{code:'PAID_HISTORY_UNAVAILABLE',providerStatus});}
}

// Provider errors may contain authenticated URLs. Only this stable code leaves
// the historical read boundary; deterministic policy failures keep their code.
export async function paidHistoryRead(read) {
 try{return await read();}catch(error){
  if(/^PAID_[A-Z_]+$/.test(error?.code??''))throw error;
  throw Object.assign(Error('PAID_HISTORY_UNAVAILABLE'),{code:'PAID_HISTORY_UNAVAILABLE'});
 }
}

export async function paidReceiptState(clients,receipt,read) {
 return paidHistoryRead(async()=>{
  paidAssert(clients.length===2&&clients[0]!==clients[1],'PAID_HISTORY_UNAVAILABLE');
  for(const c of clients){
   const canonical=async()=>paidAssert(await c.getChainId()===4663&&
    paidSame((await c.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash),'PAID_PROVIDERS_DISAGREE');
   await canonical();await read(c);await canonical();
  }
 });
}
