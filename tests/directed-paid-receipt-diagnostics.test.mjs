import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPaidTransaction} from '../broker/src/v4/directed-paid-mint.mjs';
import workerHandler from '../netlify/functions/broker-punk-agent-worker.mjs';

const hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64),otherHash='0x'+'c'.repeat(64);
const from='0x'+'1'.repeat(40),to='0x'+'2'.repeat(40),otherAddress='0x'+'3'.repeat(40);
function fixture(){
 const expected={from,to,data:'0xfe0d94c10000000000000000000000000000000000000000000000000000000000000002',
  value:'0x0',nonce:'0x2',gas:'0x4b23d',gasPrice:'0xa610b20'};
 const observations=[0,1].map(()=>({
  tx:{hash,from,to,input:expected.data,value:0n,chainId:4663,nonce:2,gas:307773n,gasPrice:174132000n,
   type:'legacy',v:9361n,blockHash},
  receipt:{transactionHash:hash,blockNumber:100n,blockHash,status:'success',gasUsed:245404n,effectiveGasPrice:84292000n,logs:[]},
  block:{number:100n,hash:blockHash,timestamp:1000n},head:112n,headReads:0,
 }));
 const clients=observations.map(o=>({getTransaction:async()=>o.tx,getTransactionReceipt:async()=>o.receipt,
  getBlock:async()=>o.block,getBlockNumber:async()=>{o.headReads++;return o.head;}}));
 return {expected,observations,clients,verify:()=>verifyPaidTransaction(clients,expected,hash)};
}

for(const status of ['success','reverted'])test(`matching ${status} receipt retains existing confirmation result`,async()=>{
 const f=fixture();for(const o of f.observations)o.receipt.status=status;
 const result=await f.verify();assert.equal(result.receipt.status,status);assert.equal(result.block.hash,blockHash);
});

const mismatches=[
 ['TX_HASH',o=>o.tx.hash=otherHash],
 ['RECEIPT_HASH',o=>o.receipt.transactionHash=otherHash],
 ['TX_FROM',o=>o.tx.from=otherAddress],
 ['TX_TO',o=>o.tx.to=otherAddress],
 ['TX_DATA',o=>o.tx.input='0x1234'],
 ['TX_VALUE',o=>o.tx.value=1n],
 ['TX_CHAIN',o=>o.tx.chainId=1],
 ['TX_NONCE',o=>o.tx.nonce=3],
 ['TX_GAS',o=>o.tx.gas=307774n],
 ['TX_GAS_PRICE',o=>o.tx.gasPrice=174132001n],
 ['TX_AUTHORIZATION_LIST',o=>o.tx.authorizationList=[{}]],
 ['TX_BLOCK_HASH',o=>o.tx.blockHash=otherHash],
 ['RECEIPT_BLOCK_HASH',o=>o.receipt.blockHash=otherHash],
 ['RECEIPT_GAS_USED',o=>o.receipt.gasUsed=307774n],
 ['RECEIPT_GAS_PRICE',o=>o.receipt.effectiveGasPrice=174132001n],
 ['RECEIPT_STATUS',o=>o.receipt.status='unknown'],
];
for(const providerIndex of [0,1])for(const [field,mutate]of mismatches)test(`${field} on provider ${providerIndex} still rejects and identifies only its fixed check`,async()=>{
 const f=fixture();mutate(f.observations[providerIndex]);
 await assert.rejects(f.verify(),error=>{
  assert.equal(error.code,'PAID_RECEIPT_MISMATCH');assert.equal(error.message,'PAID_RECEIPT_MISMATCH');
  assert.equal(error.paidReceiptProviderIndex,providerIndex);assert.deepEqual(error.paidReceiptMismatchFields,[field]);
  assert.deepEqual(Object.keys(error).sort(),['code','paidReceiptMismatchFields','paidReceiptProviderIndex']);return true;
 });
 assert.equal(f.observations[providerIndex].headReads,0);
});

test('missing chain ID remains rejected without a signature-derived fallback',async()=>{
 const f=fixture();delete f.observations[0].tx.chainId;
 await assert.rejects(f.verify(),error=>error.code==='PAID_RECEIPT_MISMATCH'&&error.paidReceiptMismatchFields[0]==='TX_CHAIN');
});
test('diagnostics preserve first-failure short-circuiting instead of evaluating later fields',async()=>{
 const f=fixture();for(const o of f.observations)o.tx.from=otherAddress;
 let reads=0;Object.defineProperty(f.expected,'value',{get(){reads++;throw Error('must not be read');}});
 await assert.rejects(f.verify(),error=>error.code==='PAID_RECEIPT_MISMATCH'&&error.paidReceiptMismatchFields[0]==='TX_FROM');
 assert.equal(reads,0);
});
test('pending confirmations and provider disagreement retain their separate error codes',async()=>{
 for(const code of ['PAID_CONFIRMATIONS_PENDING','PAID_PROVIDERS_DISAGREE']){
  const f=fixture();if(code==='PAID_CONFIRMATIONS_PENDING')f.observations[0].head=111n;else f.observations[1].block.timestamp=1001n;
  await assert.rejects(f.verify(),error=>{assert.equal(error.code,code);assert.equal(error.paidReceiptMismatchFields,undefined);return true;});
 }
});

async function logged(run){
 const lines=[],response=await workerHandler(null,{run,report:line=>lines.push(line)});
 assert.equal(response.status,503);assert.equal(lines.length,1);
 return {line:lines[0],log:JSON.parse(lines[0]),body:await response.json()};
}
test('worker logs fixed receipt diagnostics but keeps them out of its response',async()=>{
 const f=fixture();f.observations[1].tx.to=otherAddress;
 const result=await logged(f.verify);
 assert.deepEqual(result.log,{event:'PUNK_AGENT_WORKER_FAILED',code:'PAID_RECEIPT_MISMATCH',
  paidReceiptMismatch:{providerIndex:1,fields:['TX_TO']}});
 assert.deepEqual(result.body,{ok:false,code:'PAID_RECEIPT_MISMATCH'});
 for(const value of [hash,blockHash,otherAddress,f.expected.data])assert.equal(result.line.includes(value),false);
});
test('unknown labels, raw values, diagnostic toJSON and error messages cannot enter worker logs',async()=>{
 const secret='https://provider.invalid/SECRET_DIAGNOSTIC_CANARY';let serialized=0;
 const fields=['TX_TO',secret,'TX_TO','transaction='+hash];fields.toJSON=()=>{serialized++;return secret;};
 const error=Object.assign(Error(secret),{code:'PAID_RECEIPT_MISMATCH',paidReceiptProviderIndex:0,
  paidReceiptMismatchFields:fields,transactionHash:hash,cause:{message:secret},toJSON(){serialized++;return secret;}});
 const result=await logged(async()=>{throw error;});
 assert.deepEqual(result.log,{event:'PUNK_AGENT_WORKER_FAILED',code:'PAID_RECEIPT_MISMATCH',paidReceiptMismatch:{providerIndex:0,fields:['TX_TO']}});
 assert.equal(result.line.includes(secret),false);assert.equal(result.line.includes(hash),false);assert.equal(serialized,0);
 assert.deepEqual(result.body,{ok:false,code:'PAID_RECEIPT_MISMATCH'});
});
test('invalid provider IDs, oversized lists and unrelated error diagnostics are omitted',async()=>{
 for(const changes of [{paidReceiptProviderIndex:'0'},{paidReceiptProviderIndex:2},{paidReceiptProviderIndex:'https://provider.invalid/private'},
  {paidReceiptMismatchFields:new Array(17).fill('TX_TO')},{paidReceiptMismatchFields:['unknown']},{code:'PAID_HISTORY_UNAVAILABLE'}]){
  const error=Object.assign(Error('private details'),{code:'PAID_RECEIPT_MISMATCH',paidReceiptProviderIndex:0,paidReceiptMismatchFields:['TX_TO']},changes);
  const result=await logged(async()=>{throw error;});
  assert.deepEqual(result.log,{event:'PUNK_AGENT_WORKER_FAILED',code:error.code});
 }
});
test('hostile diagnostic accessors and proxies neither run getters nor break safe error reporting',async()=>{
 let reads=0;
 const getter=()=>{reads++;throw Error('private getter details');};
 const errors=[];
 for(const key of ['paidReceiptProviderIndex','paidReceiptMismatchFields']){
  const e={code:'PAID_RECEIPT_MISMATCH',paidReceiptProviderIndex:0,paidReceiptMismatchFields:['TX_TO']};
  Object.defineProperty(e,key,{get:getter});errors.push(e);
 }
 const fields=new Array(1);Object.defineProperty(fields,'0',{get:getter});
 errors.push({code:'PAID_RECEIPT_MISMATCH',paidReceiptProviderIndex:0,paidReceiptMismatchFields:fields});
 errors.push({code:'PAID_RECEIPT_MISMATCH',paidReceiptProviderIndex:0,
  paidReceiptMismatchFields:new Proxy([],{getOwnPropertyDescriptor(){throw Error('private proxy details');}})});
 for(const error of errors){const result=await logged(async()=>{throw error;});
  assert.deepEqual(result.log,{event:'PUNK_AGENT_WORKER_FAILED',code:'PAID_RECEIPT_MISMATCH'});}
 assert.equal(reads,0);
});
