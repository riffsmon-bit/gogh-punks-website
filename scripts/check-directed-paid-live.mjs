import {writeFile} from 'node:fs/promises';
import {createPublicClient,http} from 'viem';
import release from '../deployments/robinhood-directed-paid-mint.json' with {type:'json'};
import {readPaidState} from '../broker/src/v4/directed-paid-mint.mjs';
import {createPaidCoordinator} from '../broker/src/v4/directed-paid-coordinator.mjs';
if(process.argv.length!==3||process.argv[2]!=='--public-read-only')throw Error('Requires --public-read-only');
const start=Date.now(),clients=['https://robinhood-rpc.publicnode.com','https://rpc.mainnet.chain.robinhood.com'].map(url=>createPublicClient({cacheTime:0,
 transport:http(url,{timeout:8000,retryCount:1,retryDelay:200,batch:{batchSize:20,wait:5}})}));
const state=await readPaidState(clients,release);
// This diagnostic store returns the review in memory only. It has no database
// connection and cannot reserve authority or enqueue a production worker job.
const coordinator=createPaidCoordinator({clients,release,store:{current:async()=>null,save:async review=>({review})}});
const {record}=await coordinator.prepare({action:'AUTHORIZE',maximumPriceWei:null});
const result={status:'PASS',checkedAt:new Date().toISOString(),scope:'PUBLIC_READS_AND_ETH_CALL_ONLY',anchor:state.anchor,
 owner:state.owner,vault:release.vault,vaultDeployed:state.deployed,missionStatus:state.missionStatus,refundWei:state.refundWei,
 priceWei:record.review.priceWei,quotedWorkerFeeWei:record.review.executionFeeWei,maximumOwnerNetworkFeeWei:record.review.maximumNetworkFeeWei,
 authorizationSimulatedByProviders:2,elapsedMs:Date.now()-start,productionJournalWrites:0,publicTransactions:0};
await writeFile(new URL('../docs/review/2026-09-12/selected-launch/paid-live-read.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
