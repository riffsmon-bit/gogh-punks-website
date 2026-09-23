import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../site/broker-v2.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function activatePunkAgentMission('),source.indexOf('\nfunction showConfirmation('));
const owner=`0x${'1'.repeat(40)}`,to=`0x${'2'.repeat(40)}`,hash=`0x${'a'.repeat(64)}`;
function setup(){
 const selected={tokenId:'93'},state={selected,wallet:{account:owner,chainId:4663},agentAccounts:new Map()};
 const calls=[],f={state,calls,session:async()=>{},receipt:async()=>{},chain:'0x1237',accounts:[owner]};
 const ctx={state,CHAIN_ID:4663,ensureV2Session:()=>f.session(),loadAgentAccountStatus:async()=>({readiness:{setupAvailable:true}}),
 window:{__GOGH_WALLET_PROVIDER__:{request:async a=>{calls.push(a.method);if(a.method==='eth_chainId')return f.chain;if(a.method==='eth_accounts')return f.accounts;return hash;}}},
 jsonRequest:async path=>path.endsWith('/setup')?{sessionId:'s',setup:{artifactHash:hash,setupTransactions:[{from:owner,to,data:'0x1234',value:'0',purpose:'CREATE_ACCOUNT'},{from:owner,to,data:'0x5678',value:'0',purpose:'AUTHORIZE_SESSION'}]}}:{ok:true},
 waitForPunkWalletTransactionReceipt:()=>f.receipt(),hydrateSelected:async()=>{}};
 f.run=()=>vm.runInNewContext(`(${fn})`,ctx)({intent:{expectedOwner:owner,punkTokenId:'93'}},()=>{});return f;
}
test('mission setup submits only the selected owner’s reviewed transactions and reconciles them',async()=>{
 const f=setup();assert.deepEqual(await f.run(),{ok:true});assert.equal(f.calls.filter(x=>x==='eth_sendTransaction').length,2);
});
test('switching selection while session sign-in is pending prevents every setup wallet request',async()=>{
 const f=setup();f.session=async()=>{f.state.selected={tokenId:'94'};};await assert.rejects(f.run(),/Punk or wallet changed/);assert.equal(f.calls.length,0);
});
test('wallet account or chain changes stop before any setup signature',async()=>{
 for(const patch of [{chain:'0x1'},{accounts:[to]}]){const f=Object.assign(setup(),patch);await assert.rejects(f.run(),/Reconnect/);assert.equal(f.calls.includes('eth_sendTransaction'),false);}
});
test('selection change after account creation never signs the second Punk permission',async()=>{
 const f=setup();f.receipt=async()=>{f.state.selected={tokenId:'94'};};await assert.rejects(f.run(),/Punk or wallet changed/);assert.equal(f.calls.filter(x=>x==='eth_sendTransaction').length,1);
});
