import test from 'node:test';import assert from 'node:assert/strict';
import {handleSelectedBurn} from '../netlify/functions/broker-v2-forge-selected-burn.mjs';
import {SELECTED_BURN_OWNER,validateSourceHistory} from '../broker/src/v4/skill-forge/selected-burn-source.mjs';
import history from '../docs/review/2026-09-12/selected-launch/source-standard-asset-history.json' with {type:'json'};
const request=(body,path='93')=>new Request(`https://goghpunks.xyz/api/v2/punks/${path}/forge/selected-burn`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const options={releaseReader:()=>({status:'OWNER_CANARY',allowedOwners:[SELECTED_BURN_OWNER]}),sessionPool:()=>({}),
  sessionReader:async()=>({walletAddress:SELECTED_BURN_OWNER}),originCheck:()=>{},runtimeFactory:async()=>({prepare:async action=>({action})})};
test('selected burn API requires the selected owner and token before any preparation',async()=>{
  assert.equal((await handleSelectedBurn(request({operation:'prepare',action:'BURN'}),options)).status,200);
  assert.equal((await handleSelectedBurn(request({operation:'prepare',action:'BURN'},'44'),options)).status,503);
  assert.equal((await handleSelectedBurn(request({operation:'prepare',action:'BURN'}),{...options,sessionReader:async()=>({walletAddress:'0x'+'1'.repeat(40)})})).status,403);
});
test('selected burn API rejects caller-supplied source and arbitrary calldata',async()=>{
  for(const field of ['sourceTokenId','transaction','data'])assert.equal((await handleSelectedBurn(request({operation:'prepare',action:'BURN',[field]:'1753'}),options)).status,409);
});
test('source baseline rejects incomplete ranges and missing event standards',()=>{
  assert.equal(validateSourceHistory().number,'61601377');
  const gap=structuredClone(history);gap.records[0].ranges[0].from='1';assert.throws(()=>validateSourceHistory(gap),/HISTORY_GAP/);
  const missing=structuredClone(history);missing.records.pop();assert.throws(()=>validateSourceHistory(missing),/HISTORY_INVALID/);
});
