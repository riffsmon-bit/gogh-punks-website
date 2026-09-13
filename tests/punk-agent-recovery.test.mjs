import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {decodeFunctionData, keccak256} from 'viem';
import deployment from '../deployments/robinhood-punk-agent-account.json' with {type:'json'};
import {AGENT_RECOVERY_ABI, prepareAgentRecovery, encodeAgentRecoveryTransaction} from '../broker/src/agent-account/punk-agent-recovery.mjs';
import {AGENT_RECOVERY_PINS as P, normalizeAgentRecoveryIntent, agentRecoveryProxyRuntime,
  buildAgentRecoveryTransaction, validateAgentRecoveryReview, createAgentRecoveryController} from '../site/punk-agent-recovery.js';
// Public Robinhood chain 4663 runtime bytes captured read-only September 13 2026.
// Tests verify hashes against the deployed manifest; no network is used.
const COMPRESSED_RUNTIME = {"implementation":"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","registry":"eJyVlFFoHFUUhvfuTHbVh5JuZqaWjbotEYu1LRo3QULKVqMUC3V2aOaG3Jo5hxuxltiqtRQ0kntnN00RpXdml1qwSpUYqMUHfZBiAiKlSn3TgkJBWKN5U7BaFSOxMptksyEbY+dpmHPu+f/7nXMGhICcA3pHs4mxFPXEHPOyUGlVkpP39/QbGH+D2oK3HYxtMjA+TAXf9u3nfQbGB6jg++Fq2sB4mgqOz108YCD5lQo+9GJ4p4HkAhX86J7OYQPJW1RwMRv/00AiqeCv7ru0w0Cynwpemvz7cQPJdir4xKFz/QbGPqaCTx560jCQtFDBv/zwIdPA2I+U/979Hq/GI48PYqxCvQ7QNpJU9AoZyOUPP5X/rDwmH0vNnKwcaDlG+6TzG6tlQ6Y+HUkc9CzqR10GBAicTWuQywdWdKRhcdBXDR2p/LW1a92zP3fs2zDygzhzJTZz44M/atlVLSTDSF7owPg1l5VLoQox8bDLqvINS2Kqc3UnZNXQSGyNp87VMhrx5oiGdsJlXaYJubz6D/V5Wsuk5j4a2v7Fre7mY1t2PXH9/EsDVwe/6rJW05onH2nV8YmHNT71obqDushqGJ+mkFE354FfuvfNK1BJew7o3hyDs6quaHaxlrSkFn1S0JZV0JNVMNggVswqlym4S2wMiCWJks1P31h4/PUbUOulkHNcxvfufvn5ecldoDvQ5s0xJSETaFXZ/IrCLoNcvrplUElLZ82LLRawQPeJs2bboc0nDqY6occnTsNxhUGfOFCUJFCBAxkJ43LFOvXPKmmifpB6Aeo7qa2iCYbAhkw3ZNajzilDvU8WUGt3mSQKtWdcplxmd6O+t3rDbs/f2a3mWK2DqI8VMHHdZZZo1zBxH0X9dKE6AGGhCxNbaIQl+l/cHBZpgV74X1wKC1wKq3IpRFx8UlCOCiFThHHprSRzrVScJ1PGRJIye9FI8ZRVWjJVFsc1bPqF2l0mNn1HQWCqsxZuKH+qPDL1SetrE7tHHzj/Lsrbtancjm/CC3dPj9/x9UzvT2Onz1wsQy5fKjqQKRLHglzURh3AJ864ywr8RLp1cmH258dwVPGtA8MtS98c6PHmGCY2BeW6Ti41MvSwqddltu0yvu7tCQ+m057TXnc0DFS4eAmx9koGlhEWzBImLlNm+yYmpiizpYmJMmV2tOAua4giqEG1DNPDxOsuw1SnYQa2h4lRl63ZbMMMo9RXogXO5fn955pPwvdp6fjVHYpmvk02VO6f9QKJyaHIX/JR6vPL98x8ugyqCha9+ZaJyf7qbqxMw+TxIGwIWXmY3Ob+887gkcND/JHYLZtjt/0LPByCbg=="};
const CODE=Object.fromEntries(Object.entries(COMPRESSED_RUNTIME).map(([role,data])=>[role,`0x${inflateSync(Buffer.from(data,'base64')).toString('hex')}`]));
const address=d=>`0x${d.repeat(40)}`, OWNER=address('1'), OTHER=address('2'), ACCOUNT=address('3'), NFT=address('4');
const ZERO=address('0'), HASH=`0x${'a'.repeat(64)}`, TXHASH=`0x${'b'.repeat(64)}`, SALT=`0x${'0'.repeat(64)}`;
const word=v=>BigInt(v).toString(16).padStart(64,'0'), addrWord=v=>`0x${v.slice(2).padStart(64,'0')}`;
const amount=100n, TIME=1789308000000, EMPTY=`0x${word(32)}${word(0)}`;
const intent=(action='NATIVE')=>({schema:'GOGH_AGENT_RECOVERY_INTENT_V1',tokenId:'93',action,
  amountWei:action==='ERC721'?'1':amount.toString(),assetContract:action.startsWith('ERC')?NFT:null,assetTokenId:action.startsWith('ERC')?'7':null});
function fixture(){
  const f={now:TIME,owner:OWNER,connected:OWNER,chain:4663,native:1000n,deposit:1000n,assetOwner:ACCOUNT,
    assetUnits:200n,ownerNative:10n**18n,active:false,reserve:50n,nonce:7,gasPrice:1000n,estimate:50_000n,
    calls:[],code:{...CODE},assetCode:'0x60006000',canonical:true,requests:0};
  f.session=()=>({sessionKey:ZERO,authorizingOwner:OWNER,adapter:ZERO,venue:ZERO,adapterCodeHash:SALT,
    targetCollection:ZERO,validAfter:0n,validUntil:0n,maxMintsPerDay:0n,remainingMints:0n,mintsToday:0n,
    day:0n,generation:1n,maxGasCostWei:0n,minimumNativeReserveWei:f.reserve});
  f.getCode=a=>a.toLowerCase()===P.implementation?f.code.implementation:a.toLowerCase()===P.registry?f.code.registry:
    a.toLowerCase()===ACCOUNT?agentRecoveryProxyRuntime('93',SALT):a.toLowerCase()===NFT?f.assetCode:'0x6000';
  f.client={getChainId:async()=>f.chain,
    getBlock:async({blockNumber})=>({number:blockNumber??1000n,hash:f.canonical||blockNumber===undefined?HASH:SALT,timestamp:BigInt(TIME/1000)}),
    getCode:async({address})=>f.getCode(address),getBalance:async({address})=>address.toLowerCase()===ACCOUNT?f.native:f.ownerNative,
    getTransactionCount:async()=>f.nonce,getGasPrice:async()=>f.gasPrice,
    call:async query=>{f.calls.push(query);return {data:query.data.startsWith('0xb94668c0')?undefined:EMPTY};},estimateGas:async()=>f.estimate,
    readContract:async({functionName,address})=>{
      const values={account:ACCOUNT,accountSalt:SALT,owner:f.owner,ownerOf:address.toLowerCase()===NFT?f.assetOwner:f.owner,
        entryPoint:deployment.entryPoint,adapterRegistry:deployment.reusedContracts.ArtAdapterRegistry,
        acquisitionNonce:0n,sessionGeneration:1n,entryPointDeposit:f.deposit,autonomousSession:f.session(),
        isAutonomousSessionActive:f.active,supportsInterface:true,balanceOf:f.assetUnits};
      if(!Object.hasOwn(values,functionName))throw Error(`Unexpected function ${functionName}`);return values[functionName];
    }};
  f.prepare=i=>prepareAgentRecovery({client:f.client,intent:i,owner:OWNER,now:()=>f.now});
  const map=new Map();f.storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  let tail=Promise.resolve();f.locks={request:(_key,_options,fn)=>{const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;}};
  f.provider={request:async({method,params=[]})=>{
    f.calls.push({method,params});
    if(method==='eth_sendTransaction'){f.requests++;f.sent=params[0];if(f.sendError)throw f.sendError;return TXHASH;}
    if(method==='eth_chainId')return `0x${f.chain.toString(16)}`;
    if(method==='eth_accounts')return [f.connected];if(method==='eth_getCode')return f.getCode(params[0]);
    if(method==='eth_getBalance')return `0x${(params[0]===ACCOUNT?f.native:f.ownerNative).toString(16)}`;
    if(method==='eth_getTransactionCount')return `0x${f.nonce.toString(16)}`;
    if(method==='eth_gasPrice')return `0x${f.gasPrice.toString(16)}`;
    if(method==='eth_estimateGas')return `0x${f.estimate.toString(16)}`;
    if(method==='eth_call'){
      const {to,data}=params[0];
      if(data==='0x8da5cb5b'||to===P.collection)return addrWord(f.owner);
      if(to===P.registry)return data==='0x6c74921e'?SALT:addrWord(ACCOUNT);
      if(data==='0xfd5e81c7')return `0x${word(f.deposit)}`;
      if(data==='0xb89d7299')return `0x${word(f.active?1:0)}`;
      if(data==='0x6753ffde')return `0x${'0'.repeat(64*14)}${word(f.reserve)}`;
      if(to===NFT){if(data.startsWith('0x6352211e'))return addrWord(f.assetOwner);
        if(data.startsWith('0x00fdd58e'))return `0x${word(f.assetUnits)}`;
        if(data.startsWith('0x01ffc9a7'))return `0x${word(1)}`;}
      return data.startsWith('0xb94668c0')?'0x':EMPTY;
    }
    if(method==='eth_getTransactionByHash'){if(f.transactionReadError)throw Error('unavailable');return f.tx??null;}
    if(method==='eth_getTransactionReceipt'){if(f.receiptError)throw Error('private provider details');return f.receipt??null;}
    if(method==='eth_blockNumber')return '0x400';if(method==='eth_getBlockByNumber')return {number:'0x3e8',hash:HASH};
    throw Error(`Unexpected offline method ${method}`);
  }};
  f.fetch=async(_url,options)=>{if(f.apiError)throw Error('offline');
    const review=await f.prepare(JSON.parse(options.body).intent);f.alterReview?.(review);return {ok:true,json:async()=>({ok:true,review})};};
  f.controller=options=>createAgentRecoveryController({provider:f.provider,fetchFunction:f.fetch,storage:f.storage,
    owner:OWNER,tokenId:'93',isCurrent:()=>true,locks:f.locks,now:()=>f.now,...options});
  f.confirm=(action='NATIVE')=>{
    f.tx={...f.sent,input:f.sent.data,hash:TXHASH};let logs=[];
    if(action==='ERC721')logs=[{address:NFT,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',addrWord(ACCOUNT),addrWord(OWNER),`0x${word(7)}`],data:'0x'}];
    if(action==='ERC1155')logs=[{address:NFT,topics:['0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',addrWord(ACCOUNT),addrWord(ACCOUNT),addrWord(OWNER)],data:`0x${word(7)}${word(amount)}`}];
    f.receipt={transactionHash:TXHASH,blockNumber:'0x3e8',blockHash:HASH,status:'0x1',logs};};
  return f;
}
test('offline runtime fixtures match exact reviewed registry and Agent implementation',()=>{
  assert.equal(keccak256(CODE.implementation),deployment.contracts.GoghPunkAgentAccount.runtimeBytecodeHash);
  assert.equal(keccak256(CODE.registry),deployment.contracts.GoghPunkAgentAccountRegistry.runtimeBytecodeHash);
});
for(const action of ['NATIVE','ENTRY_POINT','ERC721','ERC1155'])test(`${action}: independent encoding, fresh verification and one owner mock transaction`,async()=>{
  const f=fixture(),i=intent(action),review=await f.prepare(i);
  assert.deepEqual(buildAgentRecoveryTransaction(i,OWNER,ACCOUNT),encodeAgentRecoveryTransaction(i,OWNER,ACCOUNT));
  const decoded=decodeFunctionData({abi:AGENT_RECOVERY_ABI,data:review.transaction.data});
  if(action==='ENTRY_POINT'){assert.equal(decoded.functionName,'withdrawEntryPointDeposit');assert.equal(decoded.args[0],amount);}
  else {assert.equal(decoded.functionName,'execute');assert.equal(decoded.args[0].toLowerCase(),action==='NATIVE'?OWNER:NFT);assert.equal(decoded.args[3],0);}
  assert.equal(f.requests,0);const c=f.controller();await c.prepare(i);assert.equal((await c.submit()).status,'SUBMITTED');assert.equal(f.requests,1);
  f.confirm(action);assert.equal((await c.refresh()).status,'CONFIRMED');assert.equal(f.requests,1);
});
for(const [name,mutate] of [['destination',i=>i.destination=OTHER],['calldata',i=>i.data='0x'],['action',i=>i.action='ARBITRARY'],
  ['token ID',i=>i.tokenId='093'],['zero amount',i=>i.amountWei='0'],['exponent',i=>i.amountWei='1e9'],['native asset',i=>i.assetContract=NFT]])
  test(`reject malformed typed intent: ${name}`,()=>{const i=intent();mutate(i);assert.throws(()=>normalizeAgentRecoveryIntent(i));});
test('controlling collection and ERC721 quantity above one are rejected',()=>{
  const i=intent('ERC721');i.assetContract=P.collection;assert.throws(()=>normalizeAgentRecoveryIntent(i));i.assetContract=NFT;i.amountWei='2';assert.throws(()=>normalizeAgentRecoveryIntent(i));
});
for(const [name,change,action] of [
  ['wrong owner',f=>f.owner=OTHER],['wrong chain',f=>f.chain=1],['wrong registry',f=>f.code.registry='0x6000'],['wrong implementation',f=>f.code.implementation='0x6000'],
  ['insufficient native',f=>f.native=1n],['active reserve',f=>{f.active=true;f.reserve=950n;}],['active EntryPoint',f=>f.active=true,'ENTRY_POINT'],
  ['insufficient deposit',f=>f.deposit=1n,'ENTRY_POINT'],['NFT moved',f=>f.assetOwner=OTHER,'ERC721'],['ERC1155 insufficient',f=>f.assetUnits=1n,'ERC1155'],
  ['fee too high',f=>f.gasPrice=10n**12n],['owner gas unavailable',f=>f.ownerNative=0n],['stale block',f=>f.now+=40_000],['reorg',f=>f.canonical=false],
])test(`server fails closed: ${name}`,async()=>{const f=fixture();change(f);await assert.rejects(f.prepare(intent(action)));assert.equal(f.requests,0);});
test('browser never trusts server calldata or fee fields',async()=>{
  const f=fixture();f.alterReview=r=>r.transaction.data='0xdeadbeef';await assert.rejects(f.controller().prepare(intent()));assert.equal(f.requests,0);
  const review=await fixture().prepare(intent());review.transaction.gasPrice='0x'+(10n**18n).toString(16);assert.throws(()=>validateAgentRecoveryReview(review));
});
for(const fault of ['owner','chain','code','balance','asset','reserve','simulation','nonce'])test(`wallet rejects ${fault} drift after API recheck`,async()=>{
  const f=fixture(),i=intent(fault==='asset'?'ERC721':'NATIVE'),c=f.controller();await c.prepare(i);
  const guarded=f.controller({fetchFunction:async(...args)=>{const response=await f.fetch(...args);
    if(fault==='owner')f.owner=OTHER;if(fault==='chain')f.chain=1;if(fault==='code')f.code.registry='0x6000';if(fault==='balance')f.native=0n;
    if(fault==='asset')f.assetOwner=OTHER;if(fault==='reserve')f.active=true;if(fault==='nonce')f.nonce++;
    if(fault==='simulation'){const request=f.provider.request;f.provider.request=q=>q.method==='eth_estimateGas'?'0x0':request(q);}return response;}});
  await assert.rejects(guarded.submit());assert.equal(f.requests,0);assert.equal(c.getState().status,'PREPARED');
});
test('lost wallet response survives reload, API/read failures and cannot resend',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());f.sendError=Error('transport');await assert.rejects(c.submit(),{code:'AGENT_RECOVERY_WALLET_RESULT_UNKNOWN'});
  const reload=f.controller();assert.equal(reload.getState().status,'WALLET_REQUESTED');await assert.rejects(reload.submit(),{code:'AGENT_RECOVERY_PENDING_WALLET_REQUEST'});
  await assert.rejects(reload.prepare(intent()),{code:'AGENT_RECOVERY_PENDING_REVIEW'});await assert.rejects(reload.cancelReview(),{code:'AGENT_RECOVERY_PENDING_WALLET_REQUEST'});
  assert.equal((await reload.refresh()).status,'WALLET_REQUESTED');assert.equal(f.requests,1);f.confirm();f.receiptError=true;
  await assert.rejects(reload.recover(TXHASH));assert.equal(reload.getState().transactionHash,TXHASH);f.receiptError=false;
  assert.equal((await f.controller().refresh()).status,'CONFIRMED');assert.equal(f.requests,1);
});
test('concurrent same-Punk submits open the mock wallet only once',async()=>{
  const f=fixture(),a=f.controller(),b=f.controller();await a.prepare(intent());const results=await Promise.allSettled([a.submit(),b.submit()]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.requests,1);
});
test('storage or Web Lock failure prevents wallet submission',async()=>{
  for(const fault of ['storage','lock']){const f=fixture(),c=f.controller();await c.prepare(intent());if(fault==='storage')f.storage.setItem=()=>{throw Error('full');};
    await assert.rejects((fault==='lock'?f.controller({locks:null}):c).submit());assert.equal(f.requests,0);}
});
test('definite wallet rejection frees review; expiration cannot submit',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());f.sendError=Object.assign(Error('reject'),{code:4001});assert.equal((await c.submit()).status,'REJECTED');
  delete f.sendError;await c.prepare(intent());f.now+=90_000;await assert.rejects(c.submit());assert.equal(f.requests,1);
});
test('receipt mismatch retains pending hash without claiming withdrawal',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());await c.submit();f.confirm();f.tx.to=OTHER;await assert.rejects(c.refresh(),{code:'AGENT_RECOVERY_RECEIPT_MISMATCH'});
  assert.equal(c.getState().status,'SUBMITTED');assert.equal(f.requests,1);
});
test('NFT success receipt without exact transfer event is not a confirmed recovery',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent('ERC721'));await c.submit();f.confirm();
  await assert.rejects(c.refresh(),{code:'AGENT_RECOVERY_ASSET_RECEIPT_MISMATCH'});assert.equal(c.getState().status,'SUBMITTED');assert.equal(f.requests,1);
});
test('transfer keeps the Agent account, rejects old owner and prepares recovery for the new owner',async()=>{
  const f=fixture(),before=await f.prepare(intent());f.owner=OTHER;
  await assert.rejects(f.prepare(intent()),{code:'OWNER_CHANGED'});
  const after=await prepareAgentRecovery({client:f.client,intent:intent(),owner:OTHER,now:()=>f.now});
  assert.equal(after.account,before.account);assert.equal(after.owner,OTHER);assert.equal(after.transaction.from,OTHER);
  assert.equal(decodeFunctionData({abi:AGENT_RECOVERY_ABI,data:after.transaction.data}).args[0].toLowerCase(),OTHER);
});
test('active native reserve changes are independently checked at the wallet boundary',async()=>{
  const f=fixture();f.active=true;const c=f.controller();await c.prepare(intent());
  const guarded=f.controller({fetchFunction:async(...args)=>{const response=await f.fetch(...args);f.reserve++;return response;}});
  await assert.rejects(guarded.submit(),{code:'AGENT_RECOVERY_SESSION_CHANGED'});assert.equal(f.requests,0);
});
test('provider failure after wallet request retains saved hash and hides private details',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());await c.submit();f.confirm();f.receiptError=true;
  await assert.rejects(c.refresh(),error=>error.code==='AGENT_RECOVERY_RPC_UNAVAILABLE'&&!error.message.includes('private'));
  assert.equal(c.getState().transactionHash,TXHASH);assert.equal(c.getState().status,'SUBMITTED');assert.equal(f.requests,1);
});
test('wrong recovery hash can be corrected without rebroadcasting the original request',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());f.sendError=Error('lost wallet response');await assert.rejects(c.submit());f.confirm();
  const wrong=`0x${'c'.repeat(64)}`;
  await assert.rejects(c.recover(wrong),{code:'AGENT_RECOVERY_RECEIPT_MISMATCH'});
  assert.equal(c.getState().status,'WALLET_REQUESTED');assert.equal(c.getState().transactionHash,null);
  assert.equal((await c.recover(TXHASH)).status,'CONFIRMED');assert.equal(f.requests,1);
});
test('missing or unavailable recovery candidate preserves original request and allows retry',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());f.sendError=Error('lost');await assert.rejects(c.submit());
  await assert.rejects(c.recover(TXHASH),{code:'AGENT_RECOVERY_TRANSACTION_NOT_FOUND'});
  assert.equal(c.getState().status,'WALLET_REQUESTED');assert.equal(c.getState().transactionHash,null);
  f.confirm();f.transactionReadError=true;await assert.rejects(c.recover(TXHASH),{code:'AGENT_RECOVERY_RPC_UNAVAILABLE'});
  assert.equal(c.getState().status,'WALLET_REQUESTED');assert.equal(c.getState().transactionHash,null);
  f.transactionReadError=false;assert.equal((await c.recover(TXHASH)).status,'CONFIRMED');assert.equal(f.requests,1);
});
