import {createPublicClient,http} from 'viem';
import release from '../../../deployments/robinhood-directed-paid-mint.json' with {type:'json'};
import {forgeTrainingRuntime} from './forge-training-runtime.mjs';
import {validatePaidRelease,paidAssert} from '../../../broker/src/v4/directed-paid-mint.mjs';
import {createPaidStore} from '../../../broker/src/v4/directed-paid-store.mjs';
import {createPaidCoordinator} from '../../../broker/src/v4/directed-paid-coordinator.mjs';
import {runDirectedPaidWorker} from '../../../broker/src/v4/directed-paid-worker.mjs';
import {directedPaidHistoryClients} from './directed-paid-history-runtime.mjs';
import {verifyPaidHistoryAccess} from '../../../broker/src/v4/directed-paid-archive.mjs';
export const currentPaidRelease=()=>validatePaidRelease(release);
export async function directedPaidRuntime(role,environment=process.env){
 const r=currentPaidRelease();
 const {pool}=await forgeTrainingRuntime(role,environment);
 const row=(await pool.query(`SELECT c.relrowsecurity AS rls,pg_has_role(current_user,c.relowner,'USAGE') AS owns,
  has_table_privilege(current_user,c.oid,'DELETE') AS deletes,
  has_table_privilege(current_user,'broker_selected_paid_events','INSERT,UPDATE,DELETE') AS audit_writes,
  has_column_privilege(current_user,'broker_selected_paid_executions','raw_transaction','SELECT') AS raw_read,
  has_column_privilege(current_user,'broker_selected_paid_executions','raw_transaction','INSERT') AS raw_write
  FROM pg_class c WHERE c.oid='broker_selected_paid_reviews'::regclass`)).rows[0];
 paidAssert(row?.rls===true&&row.owns===false&&row.deletes===false&&row.audit_writes===false
  &&row.raw_read===(role==='worker')&&row.raw_write===(role==='worker'),'PAID_DATABASE_ROLE_INVALID');
 const clients=['https://robinhood-rpc.publicnode.com','https://rpc.mainnet.chain.robinhood.com'].map(url=>createPublicClient({cacheTime:0,
  transport:http(url,{timeout:6000,retryCount:1,retryDelay:200,batch:{batchSize:20,wait:5}})}));
 let archives;const historyClients=()=>archives??=directedPaidHistoryClients(environment);
 const store=createPaidStore(pool),coordinator=createPaidCoordinator({clients,release:r,store,historyClients});
 return {release:r,clients,historyClients,store,coordinator};
}
// Called only while the existing worker owns the shared transaction lease.
export async function runConfiguredDirectedPaidWorker({environment,signer,assertLease}){
 paidAssert(typeof assertLease==='function','WORKER_LEASE_REQUIRED');
 const runtime=await directedPaidRuntime('worker',environment);
 paidAssert(environment.PUNK_AGENT_BUNDLER_MODE==='DIRECT_PRIVATE_RELAY','PAID_PRIVATE_RELAY_REQUIRED');
 const url=new URL(environment.PUNK_AGENT_DIRECT_RELAY_RPC_URL);
 paidAssert(url.protocol==='https:','PAID_PRIVATE_RELAY_REQUIRED');
 const relay=createPublicClient({cacheTime:0,transport:http(url.href,{timeout:12000,retryCount:0})});
 const result=await runDirectedPaidWorker({...runtime,relay,signer,assertLease,allowBroadcast:environment.PUNK_AGENT_DIRECTED_PAID_MINT_ENABLED==='true'});
 // Read-only service health remains visible even with an empty paid queue.
 // Failure does not stop unrelated free-mint work or refund recovery.
 if(result.status==='PAID_NO_MISSION'){
  try{const block=await runtime.clients[1].getBlock();
   await verifyPaidHistoryAccess(runtime.historyClients(),runtime.release,{number:String(block.number),hash:block.hash});
   result.paidReadiness='READY';
  }catch(error){result.paidReadiness='PAID_HISTORY_UNAVAILABLE';result.paidHistoryProviders=error.providerStatus??[];}
 }
 return result;
}
