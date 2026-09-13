import test from 'node:test';import assert from 'node:assert/strict';
import {encodeFunctionData,parseAbi} from 'viem';
import release from '../deployments/robinhood-forge-training.json' with {type:'json'};
import {SELECTED_BURN_OWNER,ENABLE_FORGE_CALL,validateSelectedBurnEnvelope,submitSelectedBurn} from '../site/forge-selected-burn-wallet.js';
import {SELECTED_FORGE_DISABLED_MASK} from '../broker/src/v4/skill-forge/selected-burn-coordinator.mjs';
const selected={owner:SELECTED_BURN_OWNER,tokenId:'93',chainId:4663,preview:false};
function fixture(){const review={intentId:'a'.repeat(64),action:'ENABLE_FORGE',state:{owner:SELECTED_BURN_OWNER,sourceTokenId:'1753',targetTokenId:'93'},expiresAt:Date.now()+600000,maximumNetworkFeeWei:'1000000',
  transaction:{from:SELECTED_BURN_OWNER,to:release.registry,data:ENABLE_FORGE_CALL,value:'0x0',chainId:'0x1237',type:'0x0',nonce:'0x0',gas:'0x186a0',gasPrice:'0xa'}};
  return {ok:true,mode:'SELECTED_OWNER_BURN',owner:SELECTED_BURN_OWNER,chainId:4663,sourceTokenId:'1753',targetTokenId:'93',record:{review,reviewHash:'b'.repeat(64),revision:0,status:'PREPARED',reportedHash:null}};}
test('selected enable calldata matches the contract ABI and permits only the rarity capability',()=>{
  assert.equal(ENABLE_FORGE_CALL,encodeFunctionData({abi:parseAbi(['function setEmergencyControls(bool,uint256)']),functionName:'setEmergencyControls',args:[false,SELECTED_FORGE_DISABLED_MASK]}));
  assert.equal(validateSelectedBurnEnvelope(fixture(),selected,release).ok,true);
});
test('selected wallet refuses changed target, calldata, owner, fee, extra authority and preview',()=>{
  for(const mutate of [e=>e.targetTokenId='44',e=>e.record.review.transaction.data='0x1234',e=>e.record.review.transaction.from=release.registry,
    e=>e.record.review.transaction.gasPrice='0x100000',e=>e.record.review.transaction.authorizationList=[]]){const e=fixture();mutate(e);assert.throws(()=>validateSelectedBurnEnvelope(e,selected,release));}
  assert.throws(()=>validateSelectedBurnEnvelope(fixture(),{...selected,preview:true},release));
});
test('claim persists before one wallet send and the returned hash persists before any recovery read',async()=>{
  const e=fixture(),events=[],hash='0x'+'c'.repeat(64);
  const provider={request:async({method})=>{if(method==='eth_chainId')return '0x1237';if(method==='eth_accounts')return [SELECTED_BURN_OWNER];events.push('wallet');return hash;}};
  const result=await submitSelectedBurn({envelope:e,selected,provider,release,isCurrent:()=>true,persistAttempt:async()=>events.push('attempt'),
    claim:async()=>{events.push('claim');return {...e,record:{...e.record,status:'WALLET_REQUESTED'},transaction:e.record.review.transaction};},
    persistHash:async()=>events.push('hash')});assert.equal(result,hash);assert.deepEqual(events,['attempt','claim','wallet','hash']);
});
test('lost claim response and account changes cannot trigger a wallet send',async()=>{
  for(const failure of ['claim','account']){let sends=0,reads=0;const e=fixture();
    await assert.rejects(submitSelectedBurn({envelope:e,selected,release,isCurrent:()=>true,persistAttempt:async()=>{},persistHash:async()=>{},
      provider:{request:async({method})=>method==='eth_chainId'?'0x1237':method==='eth_accounts'?[failure==='account'&&++reads>1?release.registry:SELECTED_BURN_OWNER]:(sends++,'0x'+'a'.repeat(64))},
      claim:async()=>{if(failure==='claim')throw Error('RESPONSE_LOST');return {...e,record:{...e.record,status:'WALLET_REQUESTED'},transaction:e.record.review.transaction};}}));assert.equal(sends,0);
  }
});
