import test from 'node:test';import assert from 'node:assert/strict';import {keccak256} from 'viem';
import {verifyPaidHistoryAccess,paidReceiptState} from '../broker/src/v4/directed-paid-archive.mjs';
import {directedPaidHistoryClients} from '../netlify/functions/_shared/directed-paid-history-runtime.mjs';
import {paidReviewStatus} from '../site/directed-paid-status.js';

const hash='0x'+'a'.repeat(64),owner='0x'+'1'.repeat(40);
const release={collection:owner,collectionCodeHash:keccak256('0x6000')};
const anchor={number:'40000',hash};
function client(){return {getChainId:async()=>4663,getBlock:async()=>({hash}),getCode:async()=> '0x6000',readContract:async()=>owner,getLogs:async()=>[]};}
test('history readiness exercises old storage and the full ownership window on both providers',async()=>{
 const calls=[];const clients=[client(),client()];
 for(const [i,c]of clients.entries())for(const method of ['getCode','readContract','getLogs']){
  const run=c[method];c[method]=async args=>{calls.push({i,method,args});return run(args);};
 }
 assert.deepEqual(await verifyPaidHistoryAccess(clients,release,anchor),{status:'READY',verifiedProviders:2});
 for(const i of [0,1]){
  assert.equal(calls.find(v=>v.i===i&&v.method==='readContract').args.blockNumber,20000n);
  const {args}=calls.find(v=>v.i===i&&v.method==='getLogs');assert.equal(args.fromBlock,20000n);assert.equal(args.toBlock,40000n);
 }
});
test('an archive denial, wrong chain, inconsistent logs or wrong pinned code blocks readiness without leaking credentials',async()=>{
 for(const mutation of [
  c=>c.getCode=async()=>{throw Error('https://provider.example/private-secret-token');},
  c=>c.getLogs=async()=>{throw Object.assign(Error('Archive requests require a personal token'),{status:403});},
  c=>c.getChainId=async()=>1,c=>c.getLogs=async()=>[{transactionHash:hash}],c=>c.getCode=async()=> '0x6001',
 ]){const clients=[client(),client()];mutation(clients[1]);await assert.rejects(verifyPaidHistoryAccess(clients,release,anchor),e=>{
  assert.equal(e.code,'PAID_HISTORY_UNAVAILABLE');assert.equal(e.message,'PAID_HISTORY_UNAVAILABLE');assert.equal(e.cause,undefined);return true;
 });}
});
test('archival receipt storage is bound to the canonical receipt block before and after the read',async()=>{
 const clients=[client(),client()],receipt={blockNumber:20000n,blockHash:hash};let reads=0;
 await paidReceiptState(clients,receipt,async()=>reads++);assert.equal(reads,2);
 let checks=0;clients[1].getBlock=async()=>({hash:++checks===1?hash:'0x'+'b'.repeat(64)});
 await assert.rejects(paidReceiptState(clients,receipt,async()=>{}),{code:'PAID_PROVIDERS_DISAGREE'});
});
test('archive RPC configuration uses private settings independently of the public automation override',()=>{
 const c=directedPaidHistoryClients({ROBINHOOD_RPC_URL:'https://first.example/key',ROBINHOOD_SECONDARY_RPC_URL:'https://second.example/key',ROBINHOOD_AUTOMATION_SECONDARY_RPC_URL:'https://ignored.example'});
 assert.equal(new URL(c[0].transport.url).hostname,'first.example');assert.equal(new URL(c[1].transport.url).hostname,'second.example');
 const explicit=directedPaidHistoryClients({ROBINHOOD_ARCHIVE_RPC_URL:'https://archive-one.example/key',ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL:'https://archive-two.example/key'});
 assert.equal(new URL(explicit[0].transport.url).hostname,'archive-one.example');
 assert.throws(()=>directedPaidHistoryClients({ROBINHOOD_RPC_URL:'https://same.example/a',ROBINHOOD_SECONDARY_RPC_URL:'https://same.example/b'}),{code:'PAID_HISTORY_UNAVAILABLE'});
});
test('expired paid budgets and quotes never appear to be actively minting; an existing signature stays pending',()=>{
 const e={record:{status:'CONFIRMED',review:{intentId:'a',action:'AUTHORIZE',deadline:'100',expiresAt:50000}}};
 assert.match(paidReviewStatus(e,90000),/Waiting for the worker/);
 assert.match(paidReviewStatus(e,100001),/Mission deadline passed/);
 e.execution={intent_id:'a',status:'SIGNED'};assert.match(paidReviewStatus(e,100001),/awaiting verification/);
 e.execution.status='STOPPED';assert.match(paidReviewStatus(e,100001),/stopped before submission/);
 e.execution.status='COMPLETED';assert.match(paidReviewStatus(e,100001),/Mint complete/);
 e.execution.intent_id='older';assert.match(paidReviewStatus(e,100001),/Mission deadline passed/);
 e.record.status='PREPARED';assert.match(paidReviewStatus(e,100001),/quote expired/);
 e.record.status='WALLET_REQUESTED';assert.match(paidReviewStatus(e,100001),/original transaction/);
});
