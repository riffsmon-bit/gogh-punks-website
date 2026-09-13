import { createPublicClient, http } from 'viem';
import { forgeTrainingRuntime } from './forge-training-runtime.mjs';
import { createSelectedBurnStore } from '../../../broker/src/v4/skill-forge/selected-burn-store.mjs';
import { createSelectedBurnCoordinator } from '../../../broker/src/v4/skill-forge/selected-burn-coordinator.mjs';
import { checkSelectedBurnSource,SELECTED_BURN_OWNER,SELECTED_SOURCE_WALLETS } from '../../../broker/src/v4/skill-forge/selected-burn-source.mjs';
import burnRelease from '../../../deployments/robinhood-selected-burn.json' with {type:'json'};

const CHECKS={broker_v2_agent_sessions:'punk_token_id',broker_v2_execution_attempts:'punk_token_id',broker_v2_strategies:'token_id',
  broker_paid_mint_jobs:'punk_token_id',broker_v4_execution_attempts:'punk_token_id',broker_v4_punk_policy_proposals:'punk_token_id',
  broker_automation_v3_enrollments:'token_id',broker_directed_mint_intents:'punk_token_id',broker_forge_training_intents:'punk_token_id',
  broker_scouting_schedules:'token_id',broker_canary_execution_reviews:'punk_token_id'};
export async function selectedBurnRuntime(applicationPool) {
  const {release,pool}=await forgeTrainingRuntime('request');
  if(burnRelease.status!=='OWNER_CANARY'||burnRelease.productionBurnAuthorized!==true||burnRelease.chainId!==4663
    ||burnRelease.owner!==SELECTED_BURN_OWNER||burnRelease.sourceTokenId!=='1753'||burnRelease.targetTokenId!=='93'
    ||['collection','registry','progression'].some(role=>burnRelease[role]!==release[role])
    ||burnRelease.burnSource!==release.trainingSource)throw Error('SELECTED_BURN_NOT_RELEASED');
  // Verify the narrow burn journal role as well as the training runtime's role.
  const role=(await pool.query(`SELECT c.relrowsecurity AS rls,
    pg_has_role(current_user,c.relowner,'USAGE') AS owns,
    has_table_privilege(current_user,c.oid,'DELETE') AS deletes,
    has_table_privilege(current_user,'broker_selected_burn_events','INSERT,UPDATE,DELETE') AS writes_audit
    FROM pg_class c WHERE c.oid='broker_selected_burn_reviews'::regclass`)).rows[0];
  if(!role||role.rls!==true||role.owns!==false||role.deletes!==false||role.writes_audit!==false)throw Error('BURN_DATABASE_ROLE_INVALID');
  const clients=['https://robinhood-rpc.publicnode.com','https://rpc.mainnet.chain.robinhood.com'].map(url=>
    createPublicClient({cacheTime:0,transport:http(url,{batch:{batchSize:20,wait:5},timeout:6000,retryCount:1,retryDelay:200})}));
  const checkObligations=async()=>{
    const counts={};
    const rows=await Promise.all(Object.entries(CHECKS).map(async([table,column])=>[table,
      Number((await applicationPool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column}=1753`)).rows[0].n)]));
    for(const [table,n]of rows)counts[table]=n;
    for(const table of ['broker_agent_authorizations','broker_proposals'])counts[table]=Number((await applicationPool.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE lower(account_address)=ANY($1::text[])`,[SELECTED_SOURCE_WALLETS])).rows[0].n);
    const legacy=(await pool.query('SELECT broker_selected_burn_obligations() AS counts')).rows[0].counts;
    if(!legacy||Object.keys(legacy).length!==12)throw Error('BURN_LEGACY_CHECK_UNAVAILABLE');
    return {clear:[...Object.values(counts),...Object.values(legacy)].every(n=>n===0),application:counts,legacy};
  };
  const store=createSelectedBurnStore(pool,SELECTED_BURN_OWNER,'1753');
  return createSelectedBurnCoordinator({clients,release,store,checkSource:()=>checkSelectedBurnSource({clients,checkObligations})});
}
