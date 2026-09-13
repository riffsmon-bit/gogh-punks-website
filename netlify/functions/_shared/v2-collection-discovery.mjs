import {decodeEventLog,parseAbi} from 'viem';

export const COLLECTION_BUDGETS=Object.freeze({requestMs:18000,sessionMs:3000,authorityMs:6000,
  discoveryMs:3500,registryMs:1500,ownershipMs:4000,ownerReadMs:1200,metadataMs:1000,displayReadMs:750});

// A timeout never supplies an empty successful result or permits a late result
// to mutate the response. Already-started read-only requests may finish later.
export function withinCollectionBudget(read,timeoutMs){
  if(timeoutMs<=0)return Promise.reject(Error('COLLECTION_READ_UNAVAILABLE'));
  let timer;
  return Promise.race([Promise.resolve().then(read),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('COLLECTION_READ_UNAVAILABLE')),timeoutMs);
  })]).finally(()=>clearTimeout(timer));
}

const transferAbi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const zero='0x0000000000000000000000000000000000000000';
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value);

// Retain the existing received-asset discovery hint without invoking a
// withdrawal capability gate. Every hint still requires live custody below.
export function receivedCollectionHints(tokenId,account){
  return tokenId==='93'?[{collection:'0x505a22ffed8d37ebe580ffd98d2cdb0021189146',tokenId:'882',
    standard:'ERC721',custodyAccount:account,provenance:'RECEIVED',acquisitionType:'RECEIVED',artwork:null}]:[];
}

export async function discoverCollectionReceipts({pool,client,tokenId,account,budgetMs=3000}){
  const deadline=Date.now()+budgetMs;
  const result=await withinCollectionBudget(()=>pool.query(`SELECT account_address,collection_address,transaction_hash,completed_at
    FROM broker_automation_v3_worker_runs
    WHERE status='MINT_CONFIRMED' AND punk_token_id=$1::numeric AND account_address=$2
    ORDER BY completed_at DESC LIMIT 64`,[tokenId,account]),Math.min(1500,budgetMs));
  const rows=Array.isArray(result?.rows)?result.rows.slice(0,64):null;
  if(!rows)throw Error('COLLECTION_READ_UNAVAILABLE');
  const candidates=[];let cursor=0,unavailable=0;
  await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{
    while(cursor<rows.length){
      if(Date.now()>=deadline)break;
      const row=rows[cursor++];
      try{
        if(!address(row.collection_address)||String(row.account_address).toLowerCase()!==account.toLowerCase()
          ||!/^0x[0-9a-f]{64}$/i.test(row.transaction_hash))throw Error('COLLECTION_READ_UNAVAILABLE');
        const receipt=await withinCollectionBudget(()=>client.getTransactionReceipt({hash:row.transaction_hash}),Math.min(1200,deadline-Date.now()));
        if(receipt?.status!=='success'||receipt.transactionHash?.toLowerCase()!==row.transaction_hash.toLowerCase()
          ||!Array.isArray(receipt.logs)||receipt.logs.length>4096)throw Error('COLLECTION_READ_UNAVAILABLE');
        const matches=receipt.logs.flatMap(log=>{
          if(log.address?.toLowerCase()!==row.collection_address.toLowerCase())return [];
          try{const event=decodeEventLog({abi:transferAbi,data:log.data,topics:log.topics,strict:true});
            return event.args.from.toLowerCase()===zero&&event.args.to.toLowerCase()===account.toLowerCase()?[event.args.tokenId]:[];
          }catch{return [];}
        });
        if(matches.length!==1)throw Error('COLLECTION_READ_UNAVAILABLE');
        candidates.push({collection:row.collection_address.toLowerCase(),tokenId:String(matches[0]),standard:'ERC721',
          custodyAccount:account,amount:'1',transactionHash:row.transaction_hash,acquiredAt:new Date(row.completed_at).toISOString(),
          provenance:'ART_BROKER',acquisitionType:'ART_BROKER',mintCostWei:null,artwork:null});
      }catch{unavailable++;}
    }
  }));
  return {candidates,available:unavailable===0&&cursor===rows.length};
}
