import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {privateKeyToAccount} from 'viem/accounts';
import {verifyMessage} from 'viem';
import {parseSiweMessage} from 'viem/siwe';
import {handleV2Chat} from '../netlify/functions/broker-v2-chat.mjs';
import {handleV2Strategy} from '../netlify/functions/broker-v2-strategy.mjs';
import {defaultAskIntent,punkCollectingIntentHash} from '../broker/src/v4/collecting-intent.mjs';
import {ROBINHOOD} from '../broker/src/config.mjs';
import {PublicError} from '../netlify/functions/_shared/http.mjs';
// Public deterministic test key; all storage and signatures are disposable.
const wallet=privateKeyToAccount(`0x${'11'.repeat(32)}`),owner=wallet.address.toLowerCase();
const punkWallet=`0x${'2'.repeat(40)}`,agentWallet=`0x${'3'.repeat(40)}`;
const PREVIEW='https://deploy-preview-47.preview.goghpunks.xyz';
const PROMPT='Find me 5 free NFT mints on Robinhood Chain. Use Assist mode. I’m open to any art style. Verify mint availability, screen each contract, and estimate gas. Keep my existing gas cap and minimum reserve unchanged. Show me the best matches and the complete plan for review before minting anything.';
let db,pool,authority,savedIntent;
process.env.SITE_URL='https://goghpunks.xyz';
before(async()=>{
  db=new PGlite();
  for(const migration of ['20260817224000_create_art_broker_foundation.sql','20260906010000_create_art_broker_v2.sql'])
    await db.exec(await readFile(new URL(`../netlify/database/migrations/${migration}`,import.meta.url),'utf8'));
  pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('TRUNCATE broker_punks CASCADE; TRUNCATE broker_v2_auth_challenges, broker_v2_activity CASCADE;');
  authority={owner,punkWallet,blockNumber:'100',activated:true,nativeBalanceWei:'2000000000000000'};
  savedIntent={...defaultAskIntent({punkTokenId:'93',expectedOwner:owner,punkWallet:agentWallet}),
    operatingMode:'AUTONOMOUS',dailyMintLimit:1,totalMintLimit:1,
    maxGasPerMintWei:'700000000000000',minimumReserveWei:'1000000000000000'};
  await db.query(`INSERT INTO broker_punks (chain_id,collection_address,token_id,account_address,account_version,owner_snapshot)
    VALUES (4663,$1,93,$2,3,$3)`,[ROBINHOOD.canonicalCollection,punkWallet,owner]);
  await db.query(`INSERT INTO broker_v2_strategies (chain_id,collection_address,token_id,version,schema_name,intent_hash,intent,state,
    configured_by,ownership_block,owner_confirmation_hash,expires_at,activated_at)
    VALUES (4663,$1,93,1,'PUNK_COLLECTING_INTENT_V1',$2,$3,'ACTIVE',$4,100,$5,$6,NOW())`,
  [ROBINHOOD.canonicalCollection,punkCollectingIntentHash(savedIntent),JSON.stringify(savedIntent),owner,`0x${'a'.repeat(64)}`,savedIntent.expiration]);
});
function request(path,body,origin=PREVIEW){return new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});}
async function readAuthority(tokenId,{expectedOwner}){
  assert.equal(tokenId,'93');
  if(expectedOwner!==authority.owner)throw new PublicError(403,'NOT_CURRENT_OWNER','Owner changed.');
  return authority;
}
async function chat(message=PROMPT,origin=PREVIEW){
  return handleV2Chat(request('/api/v2/punks/93/chat',{message},origin),{pool,readAuthority,
    requireSession:async()=>({walletAddress:owner}),checkAuthority:async()=>{},
    createIntelligence:()=>({router:{run:async()=>{throw Error('No AI needed for this prompt');}}})});
}
async function strategy(body,origin=PREVIEW){return handleV2Strategy(request('/api/v2/punks/93/strategy',body,origin),{
  pool,readAuthority,requireSession:async()=>({walletAddress:owner}),
  verifySignature:async({walletAddress,message,signature})=>{
    if(!await verifyMessage({address:walletAddress,message,signature}))throw new PublicError(403,'INVALID_SIGNATURE','Wrong signature.');
  }});}
async function preparedDraft(message=PROMPT,origin=PREVIEW){
  const response=await chat(message,origin),body=await response.json();assert.equal(response.status,200,body.message);return body.draft;
}
for(const origin of ['https://goghpunks.xyz',PREVIEW,'https://deploy-preview-47--gogh-punks.netlify.app'])test(`five-free-mint prompt activates ASSIST with preserved gas/reserve on ${origin}`,async()=>{
  const draft=await preparedDraft(PROMPT,origin);
  assert.equal(draft.intent.operatingMode,'ASSIST');assert.equal(draft.intent.punkWallet,punkWallet);
  assert.equal(draft.intent.dailyMintLimit,5);assert.equal(draft.intent.totalMintLimit,5);
  assert.equal(draft.intent.maxGasPerMintWei,savedIntent.maxGasPerMintWei);
  assert.equal(draft.intent.minimumReserveWei,savedIntent.minimumReserveWei);
  assert.equal(draft.intent.requireSimulation,true);assert.equal(draft.intent.maxMintPriceWei,'0');
  assert.equal(draft.intentHash,punkCollectingIntentHash(draft.intent));
  assert.notEqual(draft.intentHash,punkCollectingIntentHash({...draft.intent,punkWallet:agentWallet}));
  const before=(await db.query('SELECT state,intent FROM broker_v2_strategies WHERE intent_hash=$1',[draft.intentHash])).rows[0];
  assert.equal(before.state,'PENDING_OWNER_CONFIRMATION');assert.equal(before.intent.punkWallet,punkWallet);
  const response=await strategy({action:'prepare_activation',intentHash:draft.intentHash},origin),prepared=await response.json();
  assert.equal(response.status,200,prepared.message);assert.equal(prepared.strategyActivated,false);
  const message=parseSiweMessage(prepared.challenge.message);
  assert.equal(message.domain,new URL(origin).host);assert.equal(message.uri,origin+'/broker/v2/');
  const signature=await wallet.signMessage({message:prepared.challenge.message});
  const result=await strategy({action:'complete_activation',challengeId:prepared.challenge.challengeId,signature},origin);
  const activated=await result.json();assert.equal(result.status,200,activated.message);
  assert.equal(activated.strategyActivated,true);assert.equal(activated.strategy.state,'ACTIVE');
  assert.deepEqual(activated.strategy.intent,draft.intent);
  const rows=(await db.query('SELECT state FROM broker_v2_strategies ORDER BY version')).rows;
  assert.deepEqual(rows.map(row=>row.state),['SUPERSEDED','ACTIVE']);
  const replay=await strategy({action:'complete_activation',challengeId:prepared.challenge.challengeId,signature},origin);
  assert.equal(replay.status,409);assert.equal((await replay.json()).code,'STRATEGY_CHALLENGE_EXPIRED');
});
test('a new strategy uses existing defaults when no gas amount is given',async()=>{
  await db.exec('DELETE FROM broker_v2_strategies');
  const draft=await preparedDraft('Find me 5 free mints. Use Assist mode.');
  const defaults=defaultAskIntent({punkTokenId:'93',expectedOwner:owner,punkWallet});
  assert.equal(draft.intent.maxGasPerMintWei,defaults.maxGasPerMintWei);
  assert.equal(draft.intent.minimumReserveWei,defaults.minimumReserveWei);
  assert.equal((await strategy({action:'prepare_activation',intentHash:draft.intentHash})).status,200);
});
test('ASK changes custody binding while an autonomous refinement keeps its Agent Account',async()=>{
  const ask=await preparedDraft('Ask me first. Keep every existing collecting rule.');
  assert.equal(ask.intent.operatingMode,'ASK');assert.equal(ask.intent.punkWallet,punkWallet);
  const refined=await preparedDraft('Prioritize pixel art.');
  assert.equal(refined.intent.operatingMode,'AUTONOMOUS');assert.equal(refined.intent.punkWallet,agentWallet);
  for(const draft of [ask,refined]){assert.equal(draft.intent.maxGasPerMintWei,savedIntent.maxGasPerMintWei);assert.equal(draft.intent.minimumReserveWei,savedIntent.minimumReserveWei);}
});
test('wrong-wallet and changed-owner drafts still cannot prepare activation',async()=>{
  const draft=await preparedDraft();
  await db.query("UPDATE broker_v2_strategies SET intent=jsonb_set(intent,'{punkWallet}',$1) WHERE intent_hash=$2",[JSON.stringify(agentWallet),draft.intentHash]);
  const wrongWallet=await strategy({action:'prepare_activation',intentHash:draft.intentHash});
  assert.equal(wrongWallet.status,409);assert.equal((await wrongWallet.json()).code,'OWNERSHIP_CHANGED');
  authority={...authority,owner:agentWallet};
  const transferred=await strategy({action:'prepare_activation',intentHash:draft.intentHash});
  assert.equal(transferred.status,403);assert.equal((await transferred.json()).code,'NOT_CURRENT_OWNER');
  assert.equal((await db.query('SELECT * FROM broker_v2_auth_challenges')).rows.length,0);
});
test('wrong host or a changed wallet at completion preserves the pending draft',async()=>{
  const draft=await preparedDraft();
  const prepared=await(await strategy({action:'prepare_activation',intentHash:draft.intentHash})).json();
  const body={action:'complete_activation',challengeId:prepared.challenge.challengeId,signature:await wallet.signMessage({message:prepared.challenge.message})};
  const wrongHost=await strategy(body,'https://deploy-preview-48.preview.goghpunks.xyz');
  assert.equal(wrongHost.status,403);assert.equal((await wrongHost.json()).code,'STRATEGY_ORIGIN_MISMATCH');
  authority={...authority,punkWallet:agentWallet};
  const changed=await strategy(body);assert.equal(changed.status,409);assert.equal((await changed.json()).code,'STRATEGY_ACTIVATION_BLOCKED');
  assert.equal((await db.query('SELECT state FROM broker_v2_strategies WHERE intent_hash=$1',[draft.intentHash])).rows[0].state,'PENDING_OWNER_CONFIRMATION');
  assert.equal((await db.query('SELECT used_at FROM broker_v2_auth_challenges WHERE challenge_id=$1',[prepared.challenge.challengeId])).rows[0].used_at,null);
});
