import {getDatabase} from '@netlify/database';
import {createPublicClient,http,parseAbi} from 'viem';
import {getRpcUrl} from './_shared/config.mjs';
import {readOnchainNftDisplay} from '../../broker/src/metadata/onchain-nft-display.mjs';
import {OpenSeaPortfolioSource} from '../../broker/src/metadata/opensea-portfolio.mjs';
import {verifyCollectionHoldings} from './_shared/v2-collection-holdings.mjs';
import {COLLECTION_BUDGETS,withinCollectionBudget,discoverCollectionReceipts,receivedCollectionHints}
  from './_shared/v2-collection-discovery.mjs';
import deployment from '../../deployments/robinhood-punk-agent-account.json' with {type:'json'};
import {ROBINHOOD} from '../../broker/src/config.mjs';
import {NFT_DISPLAY_METADATA_SELECT,attachNftDisplayMetadata} from './_shared/broker-display-metadata.mjs';
import {json,PublicError} from './_shared/http.mjs';
import {v2Failure} from './_shared/v2-http.mjs';
import {readV2PunkAuthority} from './_shared/v2-ownership.mjs';
import {v2TokenIdFrom} from './_shared/v2-route.mjs';
import {requireV2Session} from './_shared/v2-session.mjs';
import {selectedPaidHistory} from './_shared/directed-paid-history.mjs';

const abi=parseAbi(['function ownerOf(uint256) view returns(address)',
  'function balanceOf(address,uint256) view returns(uint256)','function tokenURI(uint256) view returns(string)',
  'function uri(uint256) view returns(string)','function account(uint256) view returns(address)']);
const clientFactory=()=>createPublicClient({transport:http(getRpcUrl(),{timeout:1500,retryCount:0,batch:{batchSize:20,wait:5}})});

export async function handleV2Collection(request,{pool,client,sessionReader=requireV2Session,authorityReader=readV2PunkAuthority,
  paidHistoryReader=selectedPaidHistory,receiptDiscovery=discoverCollectionReceipts,portfolioReader,
  displayReader=readOnchainNftDisplay,environment=process.env,budgets=COLLECTION_BUDGETS}={}){
  if(request.method!=='GET')return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  const limits={...COLLECTION_BUDGETS,...budgets},deadline=Date.now()+limits.requestMs;
  const remaining=cap=>Math.max(0,Math.min(cap,deadline-Date.now()));
  try{
    pool??=getDatabase().pool;
    const tokenId=v2TokenIdFrom(request,'/collection');
    const mandatory=async(read,ms)=>{
      try{return await withinCollectionBudget(read,remaining(ms));}
      catch(error){if(error instanceof PublicError)throw error;
        throw new PublicError(503,'COLLECTION_AUTHORITY_UNAVAILABLE','Live collection authority could not be verified. Recheck the collection.');}
    };
    const session=await mandatory(()=>sessionReader(request,pool),limits.sessionMs);
    client??=clientFactory();
    const authority=await mandatory(()=>authorityReader(tokenId,{expectedOwner:session.walletAddress,client}),limits.authorityMs);
    const unavailable=new Set();
    const optional=async(label,read,ms=limits.discoveryMs)=>{
      try{return await withinCollectionBudget(read,remaining(ms));}
      catch{unavailable.add(label);return null;}
    };
    const acquisitionTask=optional('ACQUISITIONS',async()=>{
      const result=await pool.query(`SELECT acquisition.*, ${NFT_DISPLAY_METADATA_SELECT}
        FROM broker_acquisitions AS acquisition LEFT JOIN broker_nft_metadata AS nft_metadata
          ON nft_metadata.chain_id=acquisition.chain_id AND nft_metadata.collection_address=acquisition.nft_collection_address
          AND nft_metadata.token_id=acquisition.nft_token_id
        WHERE acquisition.chain_id=$1 AND acquisition.punk_collection_address=$2 AND acquisition.punk_token_id=$3::numeric
        ORDER BY acquisition.acquired_at DESC LIMIT 250`,[ROBINHOOD.chainId,ROBINHOOD.canonicalCollection,tokenId]);
      if(!Array.isArray(result?.rows))throw Error('COLLECTION_READ_UNAVAILABLE');
      return result.rows.slice(0,250).flatMap(raw=>{
        try{const row=attachNftDisplayMetadata(raw);return [{collection:row.nft_collection_address,tokenId:String(row.nft_token_id),
          standard:row.asset_standard??'ERC721',amount:String(row.asset_amount),acquiredAt:new Date(row.acquired_at).toISOString(),
          provenance:String(row.acquisition_mode).startsWith('V2')?'V2':'V1',acquisitionType:row.acquisition_mode,mintCostWei:String(row.price),
          custodyAccount:row.punk_account_address,transactionHash:row.transaction_hash,artwork:row.nftMetadata??null}];
        }catch{unavailable.add('ACQUISITIONS');return [];}
      });
    });
    const paidTask=optional('PAID_MINT_HISTORY',async()=>{
      const history=await paidHistoryReader(tokenId,session.walletAddress);
      if(history?.available!==true||!Array.isArray(history.candidates))throw Error('COLLECTION_READ_UNAVAILABLE');
      return history;
    });
    const agentTask=optional('AGENT_ACCOUNT',async()=>{
      if(deployment.status!=='DEPLOYED')return null;
      const account=await client.readContract({address:deployment.contracts.GoghPunkAgentAccountRegistry.address,
        abi,functionName:'account',args:[BigInt(tokenId)],blockNumber:BigInt(authority.blockNumber)});
      if(!/^0x[0-9a-f]{40}$/i.test(account)||/^0x0{40}$/i.test(account))throw Error('COLLECTION_READ_UNAVAILABLE');
      return account.toLowerCase();
    },limits.registryMs);
    const receiptTask=optional('WALLET_RECEIPTS',async()=>{
      const result=await receiptDiscovery({pool,client,tokenId,account:authority.punkWallet,
        budgetMs:Math.max(0,remaining(limits.discoveryMs)-50)});
      if(!Array.isArray(result?.candidates))throw Error('COLLECTION_READ_UNAVAILABLE');
      if(result.available!==true)unavailable.add('WALLET_RECEIPTS');return result.candidates.slice(0,64);
    });
    const portfolio=portfolioReader??(environment.OPENSEA_API_KEY?(account=>new OpenSeaPortfolioSource({
      apiKey:environment.OPENSEA_API_KEY,timeoutMs:2000}).accountNfts(account)):null);
    const indexed=async(account,label)=>account&&portfolio?optional(label,async()=>{
      const items=await portfolio(account);if(!Array.isArray(items))throw Error('COLLECTION_READ_UNAVAILABLE');
      return items.slice(0,64).map(item=>({...item,custodyAccount:account,provenance:'RECEIVED',acquisitionType:'RECEIVED',
        mintCostWei:null,acquiredAt:null,artwork:{name:item.name,imageUrl:item.imageUrl}}));
    }):[];
    // Both independent account indexes start as soon as their verified account is known.
    const walletIndexTask=indexed(authority.punkWallet,'WALLET_INDEX');
    const agentIndexTask=agentTask.then(account=>indexed(account,'AGENT_INDEX'));
    const [acquisitions,paidHistory,agentAccount,receipts,walletIndex,agentIndex]=await Promise.all([
      acquisitionTask,paidTask,agentTask,receiptTask,walletIndexTask,agentIndexTask]);
    const candidates=[...(paidHistory?.candidates.slice(0,250)??[]),...(acquisitions??[]),
      ...receivedCollectionHints(tokenId,authority.punkWallet),...(receipts??[]),...(walletIndex??[]),...(agentIndex??[])].map(item=>{
      const wallet=String(item.custodyAccount).toLowerCase()===authority.punkWallet.toLowerCase();
      return {...item,custodyType:wallet?'PUNK_WALLET':'PUNK_AGENT_ACCOUNT',withdrawControlUrl:wallet
        ?`/broker/punk/${tokenId}?tab=assets`:`/broker/v2/?tab=fund&tokenId=${tokenId}#agent-recovery`};
    });
    const inventory=await verifyCollectionHoldings({candidates,accounts:[authority.punkWallet,agentAccount],deadline,
      ownershipMs:remaining(limits.ownershipMs),ownerReadMs:limits.ownerReadMs,metadataMs:limits.metadataMs,displayReadMs:limits.displayReadMs,
      readOwner:item=>client.readContract({address:item.collection,abi,functionName:'ownerOf',args:[BigInt(item.tokenId)]}),
      readBalance:item=>client.readContract({address:item.collection,abi,functionName:'balanceOf',args:[item.custodyAccount,BigInt(item.tokenId)]}),
      readDisplay:async item=>displayReader(await client.readContract({address:item.collection,abi,
        functionName:item.standard==='ERC1155'?'uri':'tokenURI',args:[BigInt(item.tokenId)]}),{timeoutMs:1000}),
    });
    return json({ok:true,tokenId,punkWallet:authority.punkWallet,indexedAtAuthorityBlock:authority.blockNumber,...inventory,
      paidMintHistoryAvailable:paidHistory?.available===true,discoverySourcesUnavailable:[...unavailable].sort(),indexerIsCustodyAuthority:false});
  }catch(error){return v2Failure(error);}
}
export default request=>handleV2Collection(request);
export const config={path:'/api/v2/punks/:tokenId/collection',method:'GET',rateLimit:{
  action:'rate_limit',aggregateBy:['ip'],windowLimit:60,windowSize:60}};
