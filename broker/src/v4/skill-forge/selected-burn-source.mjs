import { keccak256, stringToHex, parseAbi } from 'viem';
import history from '../../../../docs/review/2026-09-12/selected-launch/source-standard-asset-history.json' with {type:'json'};
import historyExtension from '../../../../docs/v2-hardening/forge-source-history-extension.json' with {type:'json'};
import core from '../../../../deployments/robinhood.json' with {type:'json'};
import v2 from '../../../../deployments/robinhood-automation-v2.json' with {type:'json'};
import v3 from '../../../../deployments/robinhood-automation-v3.json' with {type:'json'};
import agent from '../../../../deployments/robinhood-punk-agent-account.json' with {type:'json'};

export const SELECTED_BURN_OWNER='0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6';
export const SELECTED_SOURCE_WALLETS=Object.freeze([
  '0x0533a1172567e0e28a443f32db78fa990371f6be','0xa50ee88b8f1bfa8a08a7ecfe743930a5cf4dec96',
  '0xc735bbaaf79295a27cb66ac84bdc926a125602e2','0x56df53299941890500d44aba31dcb376b92e1b65']);
const registries=[core.contracts.GoghPunkAccountRegistry,v2.contracts.GoghPunkAccountRegistryV2,
  v3.contracts.GoghPunkAccountRegistryV3,agent.contracts.GoghPunkAgentAccountRegistry];
const EVENTS=[['Transfer(address,address,uint256)',2],['TransferSingle(address,address,address,uint256,uint256)',3],
  ['TransferBatch(address,address,address,uint256[],uint256[])',3],['ConsecutiveTransfer(uint256,uint256,address,address)',3]];
const ABI=parseAbi(['function account(uint256) view returns(address)','function balanceOf(address) view returns(uint256)']);
const valid=(v,code)=>{if(!v)throw Error(code);};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hex=n=>`0x${n.toString(16)}`;
export function validateSourceHistory(value=history) {
  valid(value.status==='NO_STANDARD_ASSET_RECEIPTS_FOUND' && value.chainId===4663 && value.sourceTokenId==='1753'
    && value.anchor.number==='61601377' && value.anchor.hash==='0xbea761516fbdc56a570395b04b414d138ac02b1937a3a8ecf455b238f30fa56a'
    && value.records.length===16 && value.positiveControl.count===1,'BURN_HISTORY_INVALID');
  for(const wallet of SELECTED_SOURCE_WALLETS)for(const [signature,recipientTopic] of EVENTS){
    const matches=value.records.filter(r=>r.wallet===wallet&&r.signature===signature&&r.recipientTopic===recipientTopic);
    valid(matches.length===1,'BURN_HISTORY_INVALID');let from=0n;
    for(const range of matches[0].ranges){valid(range.count===0&&BigInt(range.from)===from&&BigInt(range.to)>=from,'BURN_HISTORY_GAP');from=BigInt(range.to)+1n;}
    valid(from===BigInt(value.anchor.number)+1n,'BURN_HISTORY_GAP');
  }
  return value.anchor;
}
export function validateSourceHistoryExtension(value=historyExtension) {
  const baseline=validateSourceHistory();
  valid(keccak256(stringToHex(JSON.stringify(value)))==='0x3efa339f148cb5c5eb0b28cc004ebc636713548df7381317707fe23dae91dead'
    && value.schema==='GOGH_SELECTED_BURN_HISTORY_EXTENSION_V1'&&value.status==='NO_STANDARD_ASSET_RECEIPTS_FOUND'
    &&value.chainId===4663&&value.sourceTokenId==='1753'&&value.publicTransactions===0
    &&value.baseline.number===baseline.number&&value.baseline.hash===baseline.hash
    &&value.wallets.length===SELECTED_SOURCE_WALLETS.length&&SELECTED_SOURCE_WALLETS.every(a=>value.wallets.includes(a))
    &&value.positiveControl.count===1&&value.positiveControl.transactionHash===history.positiveControl.logs[0].transactionHash,
    'BURN_HISTORY_EXTENSION_INVALID');
  for(const [signature,index]of EVENTS){let from=BigInt(baseline.number)+1n;
    for(const range of value.ranges.filter(r=>r.signature===signature&&r.recipientTopic===index)){
      valid(range.count===0&&BigInt(range.from)===from&&BigInt(range.to)>=from&&BigInt(range.to)-from<2000n,'BURN_HISTORY_EXTENSION_GAP');
      from=BigInt(range.to)+1n;
    }
    valid(from===BigInt(value.anchor.number)+1n,'BURN_HISTORY_EXTENSION_GAP');
  }
  return value.anchor;
}
export async function scanSelectedSourceStandardTransfers(historyClient,fromBlock,toBlock) {
  const jobs=[];
  for(const [signature,index]of EVENTS){const topics=[keccak256(stringToHex(signature)),...Array(index-1).fill(null),
    SELECTED_SOURCE_WALLETS.map(address=>`0x${address.slice(2).padStart(64,'0')}`)];
    for(let from=fromBlock;from<=toBlock;from+=2000n){
      valid(jobs.length<1600,'BURN_HISTORY_REFRESH_REQUIRED');
      jobs.push({fromBlock:hex(from),toBlock:hex(from+1999n<toBlock?from+1999n:toBlock),topics});
    }
  }
  let next=0,error;
  await Promise.all(Array.from({length:Math.min(6,jobs.length)},async()=>{
    while(!error){const index=next++;if(index>=jobs.length)return;
      try{const logs=await historyClient.request({method:'eth_getLogs',params:[jobs[index]]});
        valid(Array.isArray(logs)&&logs.length===0,'BURN_SOURCE_TOKEN_RECEIPT_FOUND');
      }catch(e){error=e;}
    }
  }));
  if(error)throw error;
}
// Event history has an explicit standard-token scope. The owner separately reviews
// nonstandard assets and obligations; an empty balance is never called a full inventory.
export async function checkSelectedBurnSource({clients,checkObligations,now=Date.now}) {
  const baseline=validateSourceHistoryExtension();valid(clients.length===2&&clients[0]!==clients[1],'BURN_TWO_PROVIDERS_REQUIRED');
  const heads=await Promise.all(clients.map(c=>c.getBlock()));
  const head=heads.reduce((a,b)=>a.number<b.number?a:b);
  valid(head.number>=BigInt(baseline.number)&&Math.abs(now()/1000-Number(head.timestamp))<30,'BURN_SOURCE_CHECK_STALE');
  const observations=await Promise.all(clients.map(async c=>{
    const [chain,base,block]=await Promise.all([c.getChainId(),c.getBlock({blockNumber:BigInt(baseline.number)}),c.getBlock({blockNumber:head.number})]);
    valid(chain===4663&&same(base.hash,baseline.hash)&&same(block.hash,head.hash),'BURN_SOURCE_CHAIN_CHANGED');
    const wallets=await Promise.all(SELECTED_SOURCE_WALLETS.map(async(address,index)=>{
      const registry=registries[index],read=(at,functionName,args)=>c.readContract({address:at,abi:ABI,functionName,args,blockNumber:head.number});
      const [runtime,derived,code,native,weth,deposit,latest,pending]=await Promise.all([
        c.getCode({address:registry.address,blockNumber:head.number}),read(registry.address,'account',[1753n]),
        c.getCode({address,blockNumber:head.number}),c.getBalance({address,blockNumber:head.number}),
        read('0x0bd7d308f8e1639fab988df18a8011f41eacad73','balanceOf',[address]),read(agent.entryPoint,'balanceOf',[address]),
        c.getTransactionCount({address,blockTag:'latest'}),c.getTransactionCount({address,blockTag:'pending'})]);
      valid(keccak256(runtime??'0x')===registry.runtimeBytecodeHash&&same(derived,address),'BURN_SOURCE_WALLET_CHANGED');
      valid((!code||code==='0x')&&native===0n&&weth===0n&&deposit===0n&&latest===0&&pending===0,'BURN_SOURCE_ASSETS_OR_ACTIVITY');
      return {address,deployed:false,nativeWei:'0',wethWei:'0',entryPointDepositWei:'0',standardIncomingTransfers:0};
    }));
    valid(same((await c.getBlock({blockNumber:head.number})).hash,head.hash),'BURN_SOURCE_REORG');return wallets;
  }));
  valid(JSON.stringify(observations[0])===JSON.stringify(observations[1]),'BURN_SOURCE_PROVIDERS_DISAGREE');
  // The configured primary archive supplies standard-token logs; both clients
  // still verify the anchor and wallet state. Do not label this history as
  // independently indexed twice, or disclose a credential-bearing endpoint.
  const historyClient=clients[1];
  await scanSelectedSourceStandardTransfers(historyClient,BigInt(baseline.number)+1n,head.number);
  const control=history.positiveControl;
  const known=await historyClient.request({method:'eth_getLogs',params:[{address:control.logs[0].address,
    fromBlock:hex(BigInt(control.from)),toBlock:hex(BigInt(control.to)),topics:[control.logs[0].topics[0],null,control.logs[0].topics[2]]}]});
  valid(Array.isArray(known)&&known.length===1&&same(known[0].transactionHash,control.logs[0].transactionHash)
    &&same(known[0].blockHash,control.logs[0].blockHash),'BURN_HISTORY_POSITIVE_CONTROL_FAILED');
  for(const c of clients)valid(same((await c.getBlock({blockNumber:head.number})).hash,head.hash),'BURN_SOURCE_REORG');
  const obligations=await checkObligations();valid(obligations?.clear===true,'BURN_SOURCE_OBLIGATIONS_PENDING');
  valid(Math.abs(now()/1000-Number(head.timestamp))<30,'BURN_SOURCE_CHECK_STALE');
  return {schema:'GOGH_SELECTED_BURN_SOURCE_CHECK_V1',checkedAt:now(),anchor:{number:String(head.number),hash:head.hash},
    wallets:observations[0],obligations,coverage:'STANDARD_TRANSFER_HISTORY_AND_APPLICATION_RECORDS',
    historyProvider:'CONFIGURED_PRIMARY_RPC',chainStateProviders:2,positiveControlVerified:true,
    limitations:'Nonstandard assets and off-chain obligations require your review. Later deposits can become inaccessible.'};
}
