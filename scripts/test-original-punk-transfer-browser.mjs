// Full V2 page, isolated headless Chrome, local fixture RPC only. No wallet profile or keys.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { decodeFunctionData, encodeAbiParameters, keccak256, parseAbi, toFunctionSelector } from 'viem';
import { lockedOriginalForgeProfile } from '../broker/src/v4/skill-forge/original-punk-profile.mjs';
import { resolveV2PunkChat } from '../netlify/functions/broker-v2-chat.mjs';
import { validateTrainingRelease, trainingDeploymentBinding } from '../broker/src/v4/skill-forge/training-release.mjs';
import { durableTrainingTransaction, serializeDurableTrainingReview, trainingDigest } from '../broker/src/v4/skill-forge/durable-training-review.mjs';
import { durableReviewFixture, fixtureHash } from '../tests/fixtures/durable-training-review.mjs';
import trainingArtifact from '../deployments/robinhood-forge-training.json' with {type:'json'};
if(process.argv.length!==3 || process.argv[2]!=='--local-only') throw Error('Requires --local-only');
const ALICE=`0x${'1'.repeat(40)}`, BOB=`0x${'2'.repeat(40)}`;
const COLLECTION='0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
const root=resolve(fileURLToPath(new URL('../site/',import.meta.url)));
const ownership=new Map([['93',ALICE],['119',BOB]]);
const aggregate=parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns((bool success,bytes returnData)[])']);
const word=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
let walletWrites=0;
let connectedOwner=ALICE, forgeMode='locked', releaseForge=null, sessionReads=0;
let chatDraft=null, chatRequests=0;
const skillHash=keccak256(encodeAbiParameters([{type:'uint32'},{type:'uint16'}],[3,1]));
const server=createServer(async(req,res)=>{
  const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/fixture-training-panel') {res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/broker-v2.css"><link rel="stylesheet" href="/broker-v2-forge.css"></head><body><main style="max-width:1100px;margin:auto;padding:16px"><p>DISPOSABLE BROWSER FIXTURE · NO REAL WALLET</p><section class="forge-locked" data-forge-training id="training-fixture"></section></main></body></html>');}
    if(url.pathname==='/fixture-rpc' && req.method==='POST') {
      let body=''; for await(const chunk of req) body+=chunk;
      const {method,params}=JSON.parse(body);
      if(method==='eth_blockNumber') return json('0xabc');
      if(method==='eth_chainId') return json('0x1237');
      if(method==='eth_getBalance') return json('0x0');
      if(method==='eth_call') {
        const call=params[0], data=call.data;
        if(call.to.toLowerCase()===COLLECTION && data.startsWith('0x70a08231')) {
          const owner=`0x${data.slice(-40)}`.toLowerCase();
          return json(word([...ownership.values()].filter(v=>v===owner).length));
        }
        if(data.startsWith('0x82ad56cb')) {
          const {args:[calls]}=decodeFunctionData({abi:aggregate,data});
          const values=calls.map(call=>{
            const id=String(BigInt(`0x${call.callData.slice(-64)}`));
            const owner=ownership.get(id)??BOB;
            return {success:true,returnData:`0x${owner.slice(2).padStart(64,'0')}`};
          });
          return json(encodeAbiParameters([{type:'tuple[]',components:[{name:'success',type:'bool'},{name:'returnData',type:'bytes'}]}],[values]));
        }
        return json(word(0));
      }
      walletWrites++; res.statusCode=400; return json({error:'NO_WALLET_WRITES_ALLOWED'});
    }
    if(url.pathname==='/api/broker/owner-punks') return json({ok:true,owner:url.searchParams.get('owner'),
      chainId:4663,collection:COLLECTION,candidateTokenIds:['93','119'],
      candidatePunks:[{tokenId:'93'},{tokenId:'119'}]});
    if(url.pathname==='/api/v2/session' && req.method==='GET') {sessionReads++; return json({ok:true,walletAddress:connectedOwner});}
    if(/^\/api\/v2\/punks\/\d+\/agent-account$/.test(url.pathname)) return json({ok:true,
      runtime:{account:`0x${'3'.repeat(40)}`,accountCreated:true,nativeBalance:'0',entryPointDeposit:'0',sessionActive:false},
      readiness:{setupAvailable:true,automaticExecutionReady:false,blockers:['AGENT_GAS_UNFUNDED']},mission:null,skills:[]});
    if(/^\/api\/v2\/punks\/\d+\/chat$/.test(url.pathname) && req.method==='POST') {
      let body='';for await(const chunk of req)body+=chunk;
      const input=JSON.parse(body);chatRequests++;
      const resolved=await resolveV2PunkChat({router:{},ownerMessage:input.message,currentIntent:null,
        tokenId:url.pathname.split('/')[4],owner:connectedOwner,
        authority:{punkWallet:`0x${'4'.repeat(40)}`,nativeBalanceWei:'2000000000000000',activated:true}});
      chatDraft=resolved.draft;
      return json({ok:true,...resolved,economicPermissionsActivated:false});
    }
    if(/^\/api\/v2\/punks\/\d+\/forge$/.test(url.pathname)) {
      const tokenId=url.pathname.split('/')[4], owner=connectedOwner;
      if(forgeMode==='error') {res.statusCode=503; return json({ok:false,message:'Fixture verification unavailable.'});}
      const profile=forgeMode==='locked' ? lockedOriginalForgeProfile() : {
        status:'VERIFIED_READ_ONLY',verified:true,ownership:'ORIGINAL_NFT',tokenId,owner,
        collection:COLLECTION,registry:`0x${'3'.repeat(40)}`,progression:`0x${'4'.repeat(40)}`,
        trainingCredits:'1',unlockedSlots:2,claimedStartingSlots:2,slotCap:7,
        learnedSkills:[{key:skillHash,skillId:3,version:1,level:1,name:'Contract Detective',slug:'contract-detective',
          packageVerified:true,status:'READY',available:true,disabled:false,deprecated:false,manifestHash:skillHash,instructionHash:skillHash}],
        equippedSkills:[{slot:0,key:skillHash,level:1}],blockNumber:'100',blockHash:skillHash,blockTime:Date.now(),
        canLearn:false,canEquip:false,canBurn:false,effectiveMcpTools:[],walletAuthority:'NONE',
      };
      if(forgeMode==='wrong-token') profile.tokenId='812';
      if(forgeMode==='delayed') await new Promise(r=>{releaseForge=r;});
      return json({ok:true,tokenId,owner,chainId:4663,mode:'READ_ONLY_RESEARCH_LAB',walletAuthority:'NONE',
        canLearn:false,canEquip:false,canBurn:false,labAvailable:true,marketAvailable:false,profile,
        ...(req.method==='POST'?{action:'inspect_contract',observedAt:new Date().toISOString(),result:{codeBytes:18470,blockNumber:'100'}}:{})});
    }
    if(url.pathname.startsWith('/api/')) { res.statusCode=503; return json({ok:false,code:'LOCAL_READ_FIXTURE_ONLY'}); }
    // Do not load wallet SDKs or connect to external providers in this test.
    if(url.pathname==='/wallet.js') {res.setHeader('Content-Type','text/javascript');return res.end('export {};');}
    const path=resolve(root,`.${url.pathname.endsWith('/')?`${url.pathname}index.html`:url.pathname}`);
    if(!path.startsWith(`${root}/`)) {res.statusCode=403;return res.end();}
    const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'}[extname(path)];
    if(type) res.setHeader('Content-Type',type);
    res.end(await readFile(path));
  } catch {res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
let chrome,ws,chromeProfile;
try {
  const profile=await mkdtemp(join(tmpdir(),'gogh-original-sale-chrome-'));
  chromeProfile=profile;
  chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run',
    '--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{
    let output=''; const timeout=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),15000);
    chrome.once('error',error=>{clearTimeout(timeout);reject(error);});
    chrome.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if(match){clearTimeout(timeout);resolve(match[1]);}});
  });
  const host=new URL(endpoint).host;
  const page=await(await fetch(`http://${host}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  ws.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);
    const task=pending.get(msg.id);if(task){pending.delete(msg.id);msg.error?task.reject(Error(JSON.stringify(msg.error))):task.resolve(msg.result);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error(`DOM_TIMEOUT ${expression}`);};
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.testClock=0; const realNow=Date.now.bind(Date); Date.now=()=>realNow()+testClock;
    window.__GOGH_WALLET_PROVIDER__={request:async args=>{
      const r=await fetch('/fixture-rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
      if(!r.ok)throw Error('LOCAL_RPC_ONLY');return r.json();}};
  `});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${url}/broker/v2/`});
  await until("document.querySelector('[data-punk-roster]') && document.readyState === 'complete'");
  await evaluate(`window.dispatchEvent(new CustomEvent('gogh:wallet-state',{detail:{account:'${ALICE}',chainId:4663,status:'owner'}}))`);
  await until("document.querySelector('[data-punk-token]').textContent === '93' && !document.querySelector('[data-selected-stage]').hidden");
  const output=await mkdtemp(join(tmpdir(),'gogh-original-sale-review-'));
  const sendChat=async message=>{
    await evaluate(`document.querySelector('[data-v2-tab=talk]').click();document.querySelector('#punk-prompt').value=${JSON.stringify(message)};document.querySelector('[data-chat-form]').requestSubmit();`);
    await until("!document.querySelector('[data-chat-form]').hasAttribute('aria-busy')");
  };
  await sendChat('Autonomously find and mint one free NFT. Max one mint per day and one mint total. Max 0.0005 ETH gas per mint. Keep 0.001 ETH reserve.');
  await until("!document.querySelector('[data-resume-chat-mission]').hidden && !document.querySelector('[data-talk-gas-host]').hidden");
  assert.equal(chatRequests,1);
  assert.equal(chatDraft.intent.operatingMode,'AUTONOMOUS');
  assert.equal(chatDraft.intent.dailyMintLimit,1);assert.equal(chatDraft.intent.totalMintLimit,1);
  assert.equal(chatDraft.intent.maxGasPerMintWei,'500000000000000');
  assert.equal(chatDraft.intent.minimumReserveWei,'1000000000000000');
  assert.equal(await evaluate("document.querySelector('[data-confirmation-dialog]').open"),false,'empty gas preserves draft and opens funding first');
  for(const [message,amount,source] of [
    ['Move 0.0005 ETH from my Punk Wallet to agent gas','0.0005','PUNK'],
    ['Add 0.001 ETH from my connected wallet for gas','0.001','OWNER'],
  ]) {
    await sendChat(message);
    assert.equal(await evaluate("document.querySelector('#agent-gas-amount').value"),amount);
    assert.equal(await evaluate("document.querySelector('#agent-gas-source').value"),source);
    assert.equal(await evaluate("document.querySelectorAll('#agent-gas-amount').length"),1,'Talk uses the existing funding form');
    assert.equal(await evaluate("document.querySelector('[data-agent-gas-confirm]').checked"),false);
    assert.equal(await evaluate("document.querySelector('[data-talk-gas-host]').contains(document.querySelector('[data-agent-gas-panel]'))"),true);
  }
  assert.equal(chatRequests,1,'gas input does not reparse or activate the saved mint mission');
  for(const [name,width,height,mobile] of [['desktop',1440,1000,false],['mobile',390,844,true]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await evaluate("document.querySelector('[data-agent-gas-form]').scrollIntoView({block:'center',behavior:'instant'});");
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await writeFile(join(output,`chat-gas-${name}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await evaluate("document.querySelector('[data-resume-chat-mission]').click();");
  await until("document.querySelector('[data-confirmation-dialog]').open");
  const missionReview=await evaluate("[...document.querySelectorAll('[data-confirmation-grid]>div')].map(row=>[row.querySelector('span').textContent,row.querySelector('b').textContent])");
  assert.deepEqual(Object.fromEntries(missionReview)['MAX GAS'],'0.0005 ETH');
  assert.deepEqual(Object.fromEntries(missionReview)['MINIMUM RESERVE'],'0.0010 ETH');
  assert.equal(Object.fromEntries(missionReview)['TOTAL LIMIT'],'1');
  assert.equal(Object.fromEntries(missionReview)['MODE'],'AUTONOMOUS');
  assert.equal(Object.fromEntries(missionReview)['STATUS'],'PENDING OWNER CONFIRMATION');
  await writeFile(join(output,'chat-mission-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.querySelector('[data-confirmation-dialog]').close();");
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate("document.querySelectorAll('[data-epoch-control]').length"),0);
  await evaluate("document.querySelector('[data-confirmation-dialog]').showModal();document.querySelector('[data-conversation]').textContent='STALE SOLD PUNK REVIEW';document.querySelector('[data-agent-gas-confirm]').checked=true;");
  ownership.set('93',BOB); ownership.set('119',ALICE);
  // Same connected wallet; no reconnect, claim or NFT registration.
  await evaluate("window.testClock+=30000; window.dispatchEvent(new Event('focus'));");
  await until("document.querySelector('[data-punk-token]').textContent === '119'");
  assert.equal(await evaluate("document.querySelector('[data-confirmation-dialog]').open"),false);
  assert.equal(await evaluate("document.querySelector('[data-agent-gas-confirm]').checked"),false);
  assert.equal(await evaluate("document.querySelector('[data-conversation]').textContent.includes('STALE SOLD PUNK')"),false);
  assert.match(await evaluate("document.querySelector('[data-ownership-sync]').textContent"),/automatically/);
  // Buyer connects and receives the original Punk without a receipt or setup action.
  connectedOwner=BOB;
  await evaluate(`window.dispatchEvent(new CustomEvent('gogh:wallet-state',{detail:{account:'${BOB}',chainId:4663,status:'owner'}}))`);
  await until("document.querySelector('[data-punk-token]').textContent === '93'");
  await evaluate("window.lastPunk='93';window.addEventListener('gogh:punk-selected',event=>{window.lastPunk=event.detail.tokenId;});");
  ownership.set('93',ALICE);
  await evaluate("window.testClock+=30000; window.dispatchEvent(new Event('focus'));");
  await until("document.querySelector('[data-selected-stage]').hidden && window.lastPunk === null");
  ownership.set('93',BOB);
  await evaluate("window.testClock+=30000; window.dispatchEvent(new Event('focus'));");
  await until("!document.querySelector('[data-selected-stage]').hidden && window.lastPunk === '93'");
  await evaluate("window.testClock=0;document.querySelector('[data-v2-tab=forge]').click();document.querySelector('[data-forge-connect]').click();");
  await until("document.querySelector('[data-forge-status]').textContent.includes('OWNER VERIFIED')");
  assert.equal(await evaluate("document.querySelectorAll('.forge-socket-unknown').length"),7);
  assert.match(await evaluate("document.querySelector('[data-forge-profile-summary]').textContent"),/unknown—not zero/);
  await evaluate("document.querySelector('.forge-skill button').click();");
  await until("document.querySelector('[data-forge-report]').textContent.includes('Test completed—not a learned skill')");
  assert.equal(await evaluate("document.querySelectorAll('.forge-socket-equipped').length"),0);
  forgeMode='verified';
  await evaluate("document.querySelector('[data-forge-connect]').click();");
  await until("document.querySelectorAll('.forge-socket-equipped').length===1");
  assert.equal(await evaluate("document.querySelectorAll('.forge-socket-empty').length"),1);
  assert.equal(await evaluate("document.querySelectorAll('.forge-socket-locked').length"),5);
  assert.equal(await evaluate("[...document.querySelectorAll('.forge-locked button')].every(b=>b.disabled)"),true);
  for(const mode of ['wrong-token','error']) {
    forgeMode=mode; await evaluate("document.querySelector('[data-forge-connect]').click();");
    await until("document.querySelector('[data-forge-status]').textContent.includes('No training or wallet change')");
    assert.equal(await evaluate("document.querySelectorAll('.forge-socket-equipped').length"),0,mode);
    assert.equal(await evaluate("document.querySelectorAll('.forge-socket-unknown').length"),7,mode);
  }
  forgeMode='verified'; await evaluate("document.querySelector('[data-forge-connect]').click();");
  await until("document.querySelectorAll('.forge-socket-equipped').length===1");
  const sessionsBeforeRefresh=sessionReads; forgeMode='error';
  await evaluate("window.testClock+=31000;window.dispatchEvent(new Event('focus'));");
  await until("document.querySelectorAll('.forge-socket-unknown').length===7");
  assert.equal(sessionReads,sessionsBeforeRefresh,'automatic refresh does not request wallet sign-in');
  await evaluate("window.testClock=0;");
  forgeMode='delayed'; await evaluate("document.querySelector('[data-forge-connect]').click();");
  for(let i=0;i<100&&!releaseForge;i++) await new Promise(r=>setTimeout(r,50));
  assert.ok(releaseForge,'delayed profile request reached server');
  connectedOwner=ALICE;
  await evaluate(`window.dispatchEvent(new CustomEvent('gogh:wallet-state',{detail:{account:'${ALICE}',chainId:4663,status:'owner'}}))`);
  await until("document.querySelector('[data-punk-token]').textContent === '119'");
  releaseForge(); releaseForge=null;
  await new Promise(r=>setTimeout(r,250));
  assert.equal(await evaluate("document.querySelectorAll('.forge-socket-equipped').length"),0,'old-owner delayed response withheld');
  forgeMode='verified'; await evaluate("document.querySelector('[data-forge-connect]').click();");
  await until("document.querySelectorAll('.forge-socket-equipped').length===1");
  assert.match(await evaluate("document.querySelector('[data-forge-punk]').textContent"),/119/);
  for(const [name,width,height,mobile] of [['desktop',1440,1000,false],['mobile',390,844,true]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`${name} overflow`);
    await evaluate("document.querySelector('[data-forge-profile-summary]').scrollIntoView({block:'center',behavior:'instant'});");
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(output,`${name}.png`),Buffer.from(shot.data,'base64'));
  }
  // Enabled canary UI tested in a separate fixture document, with the real panel
  // and wallet adapter but a simulated EIP-1193 provider. No real wallet SDK loads.
  await call('Page.navigate',{url:`${url}/fixture-training-panel`});
  await until("document.readyState==='complete' && document.querySelector('#training-fixture')");
  const code='0x60016000',runtimeHash=keccak256(code);
  const trainingRelease=validateTrainingRelease({...trainingArtifact,status:'OWNER_CANARY',productionTrainingAuthorized:true,
    registry:`0x${'3'.repeat(40)}`,progression:`0x${'4'.repeat(40)}`,trainingSource:`0x${'5'.repeat(40)}`,
    collectionCodeHash:runtimeHash,registryCodeHash:runtimeHash,progressionCodeHash:runtimeHash,trainingSourceCodeHash:runtimeHash,
    allowedOwners:[ALICE],skills:[{key:skillHash,name:'Contract Detective',manifestHash:fixtureHash('b'),instructionHash:fixtureHash('c')}]});
  const trainingBinding=trainingDeploymentBinding(trainingRelease);
  const reviews=['learn','equip'].map((operation,index)=>{const review=durableReviewFixture({...trainingBinding,owner:ALICE,tokenId:'93',
    action:{operation,skillKey:skillHash,slot:0,startingSlots:0,rarityProof:[]}});
    review.guard.nonce=String(2+index);review.guard.stateHash=fixtureHash(index?'e':'d');review.transaction.nonce=String(8+index);
    return {record:{intentId:`${index?'22222222-2222-4222-8222':'11111111-1111-4111-8111'}-111111111111`,revision:0,status:'PREPARED',review,
      reviewHash:trainingDigest(serializeDurableTrainingReview(review)),expiresAt:new Date(Number(review.guard.deadline)*1000).toISOString(),transactionHash:null},
      transaction:durableTrainingTransaction(review)};});
  await evaluate(`(async()=>{
    const {createDurableTrainingPanel}=await import('/forge-durable-training-panel.js');
    const release=${JSON.stringify(trainingRelease)},binding=${JSON.stringify(trainingBinding)},reviews=${JSON.stringify(reviews)};
    const owner='${ALICE}',skillKey='${skillHash}',zero='0x'+'0'.repeat(64),word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
    let envelope=null,phase=0,walletRequests=0,rejectNext=false,control,equipped=false,researchCalls=0;
    const root=document.querySelector('#training-fixture'),selected={owner,tokenId:'93',chainId:4663,preview:false};
    const payload=()=>({ok:true,mode:'OWNER_CANARY',...selected,canBurn:false,held:Boolean(envelope&&!['SETTLED_SUCCESS','REVIEW_EXPIRED','CANCELLED'].includes(envelope.record.status)),
      record:envelope?.record??null,release:{...binding,registry:release.registry,progressionCodeHash:release.progressionCodeHash,snapshotHash:release.snapshotHash},
      state:{owner,tokenId:'93',credits:phase?'0':'1',nonce:String(2+phase+(equipped?1:0)),stateHash:equipped?'${fixtureHash('f')}':phase?reviews[1].record.review.guard.stateHash:reviews[0].record.review.guard.stateHash,
        anchor:reviews[0].record.review.anchor,slots:1,claimed:1,equipped:[equipped?skillKey:zero],skills:release.skills.map(skill=>({...skill,level:phase,available:true}))}});
    const request=async(_url,options)=>{
      if(!options?.body)return structuredClone(payload());
      const body=JSON.parse(options.body);
      if(_url.endsWith('/forge/skill')){if(!equipped||body.skillKey!==skillKey||body.action!=='inspect_contract')throw Error('Fixture skill not equipped');
        researchCalls++;return {ok:true,mode:'EQUIPPED_RESEARCH',owner,tokenId:'93',chainId:4663,skillKey,action:body.action,
          result:{fixtureEvidence:true},observedAt:new Date().toISOString(),walletAuthority:'NONE',canBurn:false};}
      if(body.operation==='prepare'){if(!envelope||['SETTLED_SUCCESS','REVIEW_EXPIRED','CANCELLED'].includes(envelope.record.status))envelope=structuredClone(reviews[phase]);return structuredClone(envelope);}
      if(body.operation==='claim'){if(envelope.record.status!=='PREPARED')return {claimed:false,...structuredClone(envelope)};
        envelope.record.status='WALLET_REQUESTED';envelope.record.revision++;return {claimed:true,...structuredClone(envelope)};}
      if(body.operation==='recover'){envelope.record.transactionHash=body.transactionHash;envelope.record.status='INCLUDED_SUCCESS';envelope.record.revision++;phase=1;return {record:structuredClone(envelope.record)};}
      if(body.operation==='cancel'){envelope.record.status='CANCELLED';return {record:structuredClone(envelope.record)};}
      throw Error('Unexpected fixture operation');
    };
    const provider={request:async({method,params=[]})=>{
      if(method==='eth_chainId')return '0x1237';if(method==='eth_accounts')return [owner];
      if(method==='eth_getTransactionCount')return '0x'+(8+phase).toString(16);
      if(method==='eth_getCode')return '${code}';if(method==='eth_getLogs')return [];
      if(method==='eth_getBalance')return '0xde0b6b3a7640000';if(method==='eth_estimateGas')return '0x186a0';
      if(method==='eth_getBlockByNumber')return {number:params[0]==='0x65'?'0x65':'0x66',hash:params[0]==='0x65'?reviews[0].record.review.anchor.hash:'${fixtureHash('f')}',timestamp:'0x'+BigInt(reviews[0].record.review.anchor.timestamp).toString(16)};
      if(method==='eth_call'){if(params[0].data.startsWith('0x6352211e'))return '0x'+owner.slice(2).padStart(64,'0');
        if(params[0].data.startsWith('${toFunctionSelector('trainingReviewNonce(uint256)')}'))return word(2+phase);
        if(params[0].data.startsWith('${toFunctionSelector('trainingReviewStateHash(uint256)')}'))return payload().state.stateHash;return '0x';}
      if(method==='eth_sendTransaction'){walletRequests++;if(rejectNext)throw Object.assign(Error('Fixture wallet rejected'),{code:4001});
        if(params[0].data!==envelope.transaction.data||params[0].value!=='0x0')throw Error('Fixture transaction mismatch');return '${fixtureHash('a')}';}
      throw Error('Unexpected wallet method '+method);
    }};
    const mount=()=>{control?.destroy();root.replaceChildren();control=createDurableTrainingPanel({root,getSelection:()=>selected,
      ensureSession:async()=>{},request,release,binding,getProvider:()=>provider});};
    window.trainingFixture={mount,get sends(){return walletRequests;},get researchCalls(){return researchCalls;},
      setEquipped(value){equipped=value;},settle(){envelope.record.status='SETTLED_SUCCESS';},reject(){rejectNext=true;}};
    mount();
  })()`);
  const clickTraining=label=>evaluate(`[...document.querySelectorAll('#training-fixture button')].find(button=>button.textContent===${JSON.stringify(label)}).click()`);
  await clickTraining('RECHECK TRAINING');
  await until("[...document.querySelectorAll('#training-fixture button')].some(b=>b.textContent==='REVIEW LEARN · 1 CREDIT'&&!b.disabled)");
  assert.equal(await evaluate('trainingFixture.sends'),0);
  await clickTraining('REVIEW LEARN · 1 CREDIT');
  await until("[...document.querySelectorAll('#training-fixture button')].some(b=>b.textContent==='CONFIRM IN WALLET'&&!b.disabled)");
  for(const [name,width,height,mobile] of [['desktop',1440,1000,false],['mobile',390,844,true]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await evaluate("document.querySelector('#training-fixture details').open=true;");
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`training ${name} details overflow`);
    await evaluate("document.querySelector('#training-fixture details').open=false;");
    await writeFile(join(output,`training-review-${name}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await clickTraining('CONFIRM IN WALLET');
  await until("document.querySelector('#training-fixture').textContent.includes('Training confirmed.')");
  assert.equal(await evaluate('trainingFixture.sends'),1);
  await evaluate('trainingFixture.mount()');await clickTraining('RECHECK TRAINING');
  await until("document.querySelector('#training-fixture').textContent.includes('Training confirmed.')");
  assert.equal(await evaluate('trainingFixture.sends'),1,'remount recovers the stored intent without resending');
  await evaluate('trainingFixture.settle()');await clickTraining('RECHECK TRAINING');
  await until("[...document.querySelectorAll('#training-fixture button')].some(b=>b.textContent==='REVIEW EQUIP'&&!b.disabled)");
  await clickTraining('REVIEW EQUIP');await until("[...document.querySelectorAll('#training-fixture button')].some(b=>b.textContent==='CONFIRM IN WALLET'&&!b.disabled)");
  await evaluate('trainingFixture.reject()');await clickTraining('CONFIRM IN WALLET');
  await until("document.querySelector('#training-fixture').textContent.includes('Fixture wallet rejected')");
  await evaluate('trainingFixture.mount()');await clickTraining('RECHECK TRAINING');
  await until("document.querySelector('#training-fixture').textContent.includes('Confirmation was reserved.')");
  assert.equal(await evaluate('trainingFixture.sends'),2,'rejected wallet request is not repeated on remount');
  assert.equal(await evaluate("[...document.querySelectorAll('#training-fixture button')].some(b=>b.textContent==='CONFIRM IN WALLET')"),false);
  await evaluate('trainingFixture.settle()'); // Leave no pending fixture localStorage.
  await clickTraining('RECHECK TRAINING');
  await until("document.querySelector('#training-fixture').textContent.includes('Training settled.')");
  assert.equal(await evaluate("document.querySelector('#training-fixture').textContent.includes('RUN EQUIPPED RESEARCH')"),false,'learned alone does not offer research');
  await evaluate('trainingFixture.setEquipped(true)');await clickTraining('RECHECK TRAINING');
  await until("[...document.querySelectorAll('#training-fixture button')].some(b=>b.textContent==='RUN EQUIPPED RESEARCH'&&!b.disabled)");
  await clickTraining('RUN EQUIPPED RESEARCH');
  await until("document.querySelector('#training-fixture').textContent.includes('View equipped research result')");
  assert.equal(await evaluate('trainingFixture.researchCalls'),1);assert.equal(await evaluate('trainingFixture.sends'),2);
  await evaluate('trainingFixture.setEquipped(false)');await clickTraining('RECHECK TRAINING');
  await until("document.querySelector('#training-fixture').textContent.includes('Training settled.') && [...document.querySelectorAll('#training-fixture button')].some(b=>b.textContent==='RECHECK TRAINING'&&!b.disabled)");
  assert.equal(await evaluate("document.querySelector('#training-fixture').textContent.includes('RUN EQUIPPED RESEARCH')"),false);
  assert.equal(await evaluate("document.querySelector('#training-fixture').textContent.includes('View equipped research result')"),false,'loadout change clears stale research');
  assert.equal(walletWrites,0); assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',sameWalletPurchaseAndSale:true,staleReviewClosed:true,
    fullProductionChatParserUsed:true,chatMintGasReserveInputsPreserved:true,emptyGasRetainsMission:true,
    gasSourceAndAmountFilledInTalk:true,savedMissionReviewResumes:true,
    enabledTrainingPanelReviewAndRecovery:true,trainingComponentRemountDoesNotResend:true,simulatedTrainingWalletRequests:2,
    learnedAloneDoesNotEnableResearch:true,equippedResearchRequiresExplicitClick:true,unequippingClearsResearchResult:true,
    buyerSeesOriginalPunk:true,wrappedReceiptUI:false,forgeMounted:true,forgeUnknownNotZero:true,
    forgeProfileAndFailureRecovery:true,staleForgeResponseWithheld:true,forgeAutoRefreshWithoutSignIn:true,productionTrainingLocked:true,
    desktopAndMobile:true,walletWrites,browserExceptions:errors.length,screenshots:output},null,2));
} finally {
  releaseForge?.();
  ws?.close();chrome?.kill('SIGTERM');await new Promise(r=>server.close(r));
  if(chrome && chrome.exitCode===null)await new Promise(resolve=>{
    const timeout=setTimeout(resolve,5000);chrome.once('exit',()=>{clearTimeout(timeout);resolve();});
  });
  if(chromeProfile && (!chrome || chrome.exitCode!==null || chrome.signalCode))await rm(chromeProfile,{recursive:true,force:true,maxRetries:3});
}
