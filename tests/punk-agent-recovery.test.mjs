import test from 'node:test';
import assert from 'node:assert/strict';
import {CODE} from './fixtures/punk-agent-runtime.mjs';
import {decodeFunctionData, keccak256} from 'viem';
import deployment from '../deployments/robinhood-punk-agent-account.json' with {type:'json'};
import {AGENT_RECOVERY_ABI, prepareAgentRecovery, encodeAgentRecoveryTransaction} from '../broker/src/agent-account/punk-agent-recovery.mjs';
import {AGENT_RECOVERY_PINS as P, normalizeAgentRecoveryIntent, agentRecoveryProxyRuntime,
  buildAgentRecoveryTransaction, validateAgentRecoveryReview, createAgentRecoveryController} from '../site/punk-agent-recovery.js';

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
  assert.equal(f.requests,0);const c=f.controller();await c.prepare(i);assert.equal((await c.submit({expectedReview:c.getState().review})).status,'SUBMITTED');assert.equal(f.requests,1);
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
  await assert.rejects(guarded.submit({expectedReview:guarded.getState().review}));assert.equal(f.requests,0);assert.equal(c.getState().status,'PREPARED');
});
test('lost wallet response survives reload, API/read failures and cannot resend',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());f.sendError=Error('transport');await assert.rejects(c.submit({expectedReview:c.getState().review}),{code:'AGENT_RECOVERY_WALLET_RESULT_UNKNOWN'});
  const reload=f.controller();assert.equal(reload.getState().status,'WALLET_REQUESTED');await assert.rejects(reload.submit({expectedReview:reload.getState().review}),{code:'AGENT_RECOVERY_PENDING_WALLET_REQUEST'});
  await assert.rejects(reload.prepare(intent()),{code:'AGENT_RECOVERY_PENDING_REVIEW'});await assert.rejects(reload.cancelReview(),{code:'AGENT_RECOVERY_PENDING_WALLET_REQUEST'});
  assert.equal((await reload.refresh()).status,'WALLET_REQUESTED');assert.equal(f.requests,1);f.confirm();f.receiptError=true;
  await assert.rejects(reload.recover(TXHASH));assert.equal(reload.getState().transactionHash,TXHASH);f.receiptError=false;
  assert.equal((await f.controller().refresh()).status,'CONFIRMED');assert.equal(f.requests,1);
});
test('concurrent same-Punk submits open the mock wallet only once',async()=>{
  const f=fixture(),a=f.controller(),b=f.controller();await a.prepare(intent());const results=await Promise.allSettled([a.submit({expectedReview:a.getState().review}),b.submit({expectedReview:b.getState().review})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.requests,1);
});
test('storage or Web Lock failure prevents wallet submission',async()=>{
  for(const fault of ['storage','lock']){const f=fixture(),c=f.controller();await c.prepare(intent());if(fault==='storage')f.storage.setItem=()=>{throw Error('full');};
    await assert.rejects((fault==='lock'?f.controller({locks:null}):c).submit({expectedReview:c.getState().review}));assert.equal(f.requests,0);}
});
test('definite wallet rejection frees review; expiration cannot submit',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());f.sendError=Object.assign(Error('reject'),{code:4001});assert.equal((await c.submit({expectedReview:c.getState().review})).status,'REJECTED');
  delete f.sendError;await c.prepare(intent());f.now+=90_000;await assert.rejects(c.submit({expectedReview:c.getState().review}));assert.equal(f.requests,1);
});
test('receipt mismatch retains pending hash without claiming withdrawal',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());await c.submit({expectedReview:c.getState().review});f.confirm();f.tx.to=OTHER;await assert.rejects(c.refresh(),{code:'AGENT_RECOVERY_RECEIPT_MISMATCH'});
  assert.equal(c.getState().status,'SUBMITTED');assert.equal(f.requests,1);
});
test('NFT success receipt without exact transfer event is not a confirmed recovery',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent('ERC721'));await c.submit({expectedReview:c.getState().review});f.confirm();
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
  await assert.rejects(guarded.submit({expectedReview:guarded.getState().review}),{code:'AGENT_RECOVERY_SESSION_CHANGED'});assert.equal(f.requests,0);
});
test('provider failure after wallet request retains saved hash and hides private details',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());await c.submit({expectedReview:c.getState().review});f.confirm();f.receiptError=true;
  await assert.rejects(c.refresh(),error=>error.code==='AGENT_RECOVERY_RPC_UNAVAILABLE'&&!error.message.includes('private'));
  assert.equal(c.getState().transactionHash,TXHASH);assert.equal(c.getState().status,'SUBMITTED');assert.equal(f.requests,1);
});
test('wrong recovery hash can be corrected without rebroadcasting the original request',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());f.sendError=Error('lost wallet response');await assert.rejects(c.submit({expectedReview:c.getState().review}));f.confirm();
  const wrong=`0x${'c'.repeat(64)}`;
  await assert.rejects(c.recover(wrong),{code:'AGENT_RECOVERY_RECEIPT_MISMATCH'});
  assert.equal(c.getState().status,'WALLET_REQUESTED');assert.equal(c.getState().transactionHash,null);
  assert.equal((await c.recover(TXHASH)).status,'CONFIRMED');assert.equal(f.requests,1);
});
test('missing or unavailable recovery candidate preserves original request and allows retry',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());f.sendError=Error('lost');await assert.rejects(c.submit({expectedReview:c.getState().review}));
  await assert.rejects(c.recover(TXHASH),{code:'AGENT_RECOVERY_TRANSACTION_NOT_FOUND'});
  assert.equal(c.getState().status,'WALLET_REQUESTED');assert.equal(c.getState().transactionHash,null);
  f.confirm();f.transactionReadError=true;await assert.rejects(c.recover(TXHASH),{code:'AGENT_RECOVERY_RPC_UNAVAILABLE'});
  assert.equal(c.getState().status,'WALLET_REQUESTED');assert.equal(c.getState().transactionHash,null);
  f.transactionReadError=false;assert.equal((await c.recover(TXHASH)).status,'CONFIRMED');assert.equal(f.requests,1);
});
test('two-tab replacement cannot turn an earlier displayed approval into a different withdrawal',async()=>{
  const f=fixture(),displayed=[];
  const a=f.controller({onChange:state=>displayed.push(state)}),b=f.controller();
  await a.prepare(intent());const expectedReview=displayed.at(-1).review;
  await b.cancelReview();await b.prepare({...intent(),amountWei:'900'});
  assert.equal(expectedReview.intent.amountWei,'100');const calls=f.calls.length;
  await assert.rejects(a.submit({expectedReview}),{code:'AGENT_RECOVERY_REVIEW_CHANGED'});
  assert.equal(f.calls.length,calls);assert.equal(f.requests,0);assert.equal(a.getState().review.intent.amountWei,'900');
});
test('missing displayed review is rejected before refresh, preflight or wallet request',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());const calls=f.calls.length;
  for(const options of [undefined,{}, {expectedReview:null}])await assert.rejects(c.submit(options),{code:'AGENT_RECOVERY_REVIEW_REQUIRED'});
  assert.equal(f.calls.length,calls);assert.equal(f.requests,0);assert.equal(c.getState().status,'PREPARED');
});
test('full review binding includes observed balances and accepts an exact normalized snapshot',async()=>{
  const f=fixture(),c=f.controller();await c.prepare(intent());const expectedReview=c.getState().review;
  const altered=structuredClone(expectedReview);altered.balances.ownerNativeWei='999999999999999999';
  await assert.rejects(c.submit({expectedReview:altered}),{code:'AGENT_RECOVERY_REVIEW_CHANGED'});assert.equal(f.requests,0);
  const reordered=Object.fromEntries(Object.entries(expectedReview).reverse());
  assert.equal((await c.submit({expectedReview:reordered})).status,'SUBMITTED');assert.equal(f.requests,1);
});
for(const status of ['CONFIRMED','REVERTED']){
  for(const [fault,change] of [
    ['missing receipt',s=>s.receipt=null],['missing hash',s=>s.transactionHash=null],
    ['different receipt hash',s=>s.receipt.transactionHash=`0x${'c'.repeat(64)}`],
    ['malformed block hash',s=>s.receipt.blockHash='0x'],['zero block hash',s=>s.receipt.blockHash=SALT],
    ['invalid block number',s=>s.receipt.blockNumber='-1'],['wrong receipt status',s=>s.receipt.status=s.status==='CONFIRMED'?'0x0':'0x1'],
    ['extra receipt field',s=>s.receipt.unchecked=true],
  ])test(`${status} restored journal rejects ${fault}`,async()=>{
    const f=fixture(),review=await f.prepare(intent());
    const state={schema:'GOGH_AGENT_RECOVERY_JOURNAL_V1',status,review,transactionHash:TXHASH,
      receipt:{transactionHash:TXHASH,blockNumber:'1000',blockHash:HASH,status:status==='CONFIRMED'?'0x1':'0x0'}};
    change(state);f.storage.setItem(`gogh:agent-recovery:4663:${OWNER}:93`,JSON.stringify(state));
    assert.throws(()=>f.controller().getState());assert.equal(f.requests,0);
  });
  test(`${status} coherent restored receipt remains cached evidence without a new request`,async()=>{
    const f=fixture(),review=await f.prepare(intent());
    const state={schema:'GOGH_AGENT_RECOVERY_JOURNAL_V1',status,review,transactionHash:TXHASH,
      receipt:{transactionHash:TXHASH,blockNumber:'1000',blockHash:HASH,status:status==='CONFIRMED'?'0x1':'0x0'}};
    f.storage.setItem(`gogh:agent-recovery:4663:${OWNER}:93`,JSON.stringify(state));const calls=f.calls.length;
    assert.deepEqual(f.controller().getState(),state);assert.equal(f.calls.length,calls);assert.equal(f.requests,0);
  });
}
