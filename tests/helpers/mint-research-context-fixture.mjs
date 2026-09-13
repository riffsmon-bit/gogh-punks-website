import { gunzipSync } from 'node:zlib';
import { keccak256 } from 'viem';
import { CODE } from '../fixtures/punk-agent-runtime.mjs';
import compressed from '../fixtures/fixed-source-link-runtimes.json' with { type: 'json' };
import adapter from '../fixtures/mint-hunter-adapter-runtime.json' with { type: 'json' };
import deployment from '../../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import paid from '../../deployments/robinhood-directed-paid-mint.json' with { type: 'json' };
import { AGENT_RECOVERY_PINS as P, agentRecoveryProxyRuntime } from '../../site/punk-agent-recovery.js';
import { defaultAskIntent, punkCollectingIntentHash } from '../../broker/src/v4/collecting-intent.mjs';
import { normalizeV2Opportunity } from '../../broker/src/v4/opportunity.mjs';
import { V2_SEADROP, V2_SEADROP_ADAPTER, V2_SEADROP_ADAPTER_CODE_HASH } from '../../broker/src/v4/discovery/seadrop-ingestor.mjs';
export const OWNER = paid.owner, WALLET = paid.recipient, COLLECTION = paid.targetCollection, GOGH = paid.collection;
export const HASH = `0x${'a'.repeat(64)}`, ZERO = `0x${'0'.repeat(40)}`, SALT = `0x${'0'.repeat(64)}`;
const contractCode = Object.fromEntries(Object.entries(compressed).map(([name,data]) => [name, `0x${gunzipSync(Buffer.from(data,'base64')).toString('hex')}`]));
const adapterCode = `0x${gunzipSync(Buffer.from(adapter.gzipBase64,'base64')).toString('hex')}`;
export function mintResearchFixture() {
  const time = new Date(Math.floor(Date.now()/1000)*1000);
  const f = { time, owner: OWNER, chain: 4663, code: { ...CODE }, logs: [], calls: [], sql: [],
    blockHash: HASH, nativeBalance: 1_000_000n, scopeComplete: true,
    usageRow: { daily_mints:'0', total_mints:'0', opportunity_mints:'0', incomplete:false } };
  const intent = { ...defaultAskIntent({punkTokenId:'93',expectedOwner:OWNER,punkWallet:WALLET},time),
    operatingMode:'ASSIST',maxGasPerMintWei:'100000',minimumReserveWei:'1000',dailyMintLimit:3,totalMintLimit:10 };
  f.strategy = {version:'1',intent_hash:punkCollectingIntentHash(intent,time),intent,state:'ACTIVE',configured_by:OWNER,
    ownership_block:'99',owner_confirmation_hash:HASH,activated_at:new Date(+time-60_000),expires_at:new Date(+time+3_600_000)};
  f.opportunity = normalizeV2Opportunity({schema:'GOGH_NORMALIZED_OPPORTUNITY_V2',version:2,opportunityId:'seadrop:fixture:public',
    chainId:4663,collectionContract:COLLECTION,mintContract:V2_SEADROP,adapter:V2_SEADROP_ADAPTER,
    mintStage:'PUBLIC',mintMethod:'mintPublic(address,address,address,uint256)',priceWei:'0',estimatedGasCostWei:'500',supply:2222,
    walletLimit:2,startTime:null,endTime:null,website:'https://example.com',socialUrls:{x:null,discord:null,farcaster:null},
    sourceUrls:[`https://robinhoodchain.blockscout.com/address/${COLLECTION}`],artStyles:[],imageReference:null,collectionName:'Fixture',
    contractCodeHash:keccak256(contractCode.peppies),adapterCodeHash:V2_SEADROP_ADAPTER_CODE_HASH,screeningStatus:'PASSED',simulationStatus:'PENDING',
    riskLevel:'LOW',riskScore:5,expectedNftReceiver:null,unexpectedApprovals:false,unexpectedTransfers:false,createdAt:time,updatedAt:time},time);
  f.source = {opportunity_id:f.opportunity.opportunityId,collection_contract:COLLECTION,normalized:f.opportunity,screening_status:'PASSED',expires_at:null};
  f.client = {getChainId:async()=>f.chain, getBlockNumber:async()=>100n,
    getBlock:async({blockNumber}={})=>({number:blockNumber??100n,hash:f.blockHash,timestamp:BigInt(+time/1000)}),
    getLogs:async query=>{f.calls.push(['logs',query]);return f.logs;},
    getBalance:async query=>{f.calls.push(['balance',query]);return f.nativeBalance;},
    getCode:async query=>{f.calls.push(['code',query]);const a=query.address.toLowerCase();
      return a===P.implementation?f.code.implementation:a===P.registry?f.code.registry:a===WALLET?(f.proxy??agentRecoveryProxyRuntime('93',SALT)):
        a===V2_SEADROP?contractCode.seaDrop:a===V2_SEADROP_ADAPTER?adapterCode:a===COLLECTION?contractCode.peppies:'0x6000';},
    readContract:async query=>{f.calls.push(['read',query]);const name=query.functionName;
      const session={sessionKey:ZERO,authorizingOwner:f.owner,adapter:ZERO,venue:ZERO,adapterCodeHash:SALT,targetCollection:ZERO,
        validAfter:0n,validUntil:0n,maxMintsPerDay:0n,remainingMints:0n,mintsToday:0n,day:0n,generation:1n,maxGasCostWei:0n,minimumNativeReserveWei:0n};
      const values={account:WALLET,accountSalt:SALT,owner:f.owner,ownerOf:f.owner,entryPoint:deployment.entryPoint,
        adapterRegistry:deployment.reusedContracts.ArtAdapterRegistry,acquisitionNonce:0n,sessionGeneration:1n,entryPointDeposit:0n,
        autonomousSession:session,isAutonomousSessionActive:false,getPublicDrop:[0n,0n,BigInt(+time/1000)+3600n,2n,0n,false],
        getMintStats:[0n,10n,2222n]};
      if(!Object.hasOwn(values,name))throw Error(`Unexpected fixture read ${name}`);return values[name];},
    call:async query=>{f.calls.push(['call',query]);return {data:'0x'};},estimateGas:async()=>50_000n,getGasPrice:async()=>1n};
  f.pool={query:async(sql,params=[])=>{f.sql.push([sql,params]);
    if(sql.includes('row_security_active'))return {rows:[{tables:params[0].length,complete:f.scopeComplete}]};
    if(sql.includes('WITH attempts AS'))return {rows:[f.usageRow]};
    if(sql.includes('FROM broker_v2_strategies'))return {rows:f.strategy?[f.strategy]:[]};
    if(sql.includes('FROM broker_v2_opportunities'))return {rows:f.source?[f.source]:[]};
    throw Error('Unexpected fixture query');}};
  f.contextOptions={pool:f.pool,client:f.client,now:()=>time,selectedPaidUsageReader:async()=>[]};
  f.identity={tokenId:'93',owner:OWNER,opportunityId:f.opportunity.opportunityId};
  return f;
}
