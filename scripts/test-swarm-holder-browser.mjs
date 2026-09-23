import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const args=process.argv.slice(2);
assert.equal(args.length,5,'Requires --unauthenticated-read-only --ready-commit <full SHA> and --preview-url <trusted URL> or --production-url https://goghpunks.xyz/broker/v2/');
assert.equal(args[0],'--unauthenticated-read-only');assert.equal(args[1],'--ready-commit');
assert.match(args[2],/^[0-9a-f]{40}$/);
assert.ok(['--preview-url','--production-url','--local-url'].includes(args[3]));
const preview=new URL(args[4]);
if(args[3]==='--local-url'){assert.equal(preview.protocol,'http:');assert.equal(preview.hostname,'127.0.0.1');}else{assert.equal(preview.protocol,'https:');assert.equal(preview.port,'');}assert.equal(preview.username,'');assert.equal(preview.password,'');
assert.equal(preview.search,'');assert.equal(preview.hash,'');assert.ok(['/','/broker/v2/'].includes(preview.pathname));
if(args[3]==='--production-url')assert.equal(args[4],'https://goghpunks.xyz/');
else if(args[3]!=='--local-url') assert.match(preview.hostname,/^deploy-preview-[1-9][0-9]*(?:\.preview\.goghpunks\.xyz|--gogh-punks\.netlify\.app)$/);
const commit=args[2],origin=preview.origin,url=`${origin}/${args[3]==='--local-url'?'?preview=1':''}`;
const repo=resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(execFileSync('git',['rev-parse',`${commit}^{commit}`],{cwd:repo,encoding:'utf8'}).trim(),commit);
const output=await mkdtemp('/private/tmp/gogh-preview-browser-evidence-');
const profile=await mkdtemp('/private/tmp/gogh-preview-browser-profile-');
const result={status:'RUNNING',commit,url,production:args[3]==='--production-url',output,startedAt:new Date().toISOString(),viewports:[],screenshots:[],
  exceptions:[],consoleErrors:[],logErrors:[],responses:[],failedRequests:[],blockedRequests:[],staticHashes:[]};
const safeUrl=value=>{try{const u=new URL(value);return `${u.origin}${u.pathname}`;}catch{return String(value).slice(0,200);}};
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-default-apps',
  '--disable-sync','--no-proxy-server','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
  `--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
const chromeExited=new Promise(resolve=>chrome.once('exit',resolve));
let ws;
try{
  const endpoint=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error('CHROME_START_TIMEOUT')),20000);
    chrome.once('error',error=>{clearTimeout(timer);reject(error);});chrome.stderr.on('data',chunk=>{
      buffer+=chunk;const match=buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});
  const target=await(await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map(),requests=new Map();
  const call=(method,params={})=>new Promise((resolve,reject)=>{const number=++id,timer=setTimeout(()=>{pending.delete(number);reject(Error(`CDP_TIMEOUT_${method}`));},20000);
    pending.set(number,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id:number,method,params}));});
  ws.onmessage=({data})=>{const message=JSON.parse(data),p=message.params;
    if(message.method==='Runtime.exceptionThrown')result.exceptions.push(p.exceptionDetails.exception?.description??p.exceptionDetails.text);
    if(message.method==='Runtime.consoleAPICalled'&&['error','assert'].includes(p.type))result.consoleErrors.push(p.args.map(a=>a.value??a.description??'').join(' ').slice(0,2000));
    if(message.method==='Log.entryAdded'&&p.entry.level==='error')result.logErrors.push({source:p.entry.source,text:p.entry.text,url:safeUrl(p.entry.url??'')});
    if(message.method==='Network.requestWillBeSent')requests.set(p.requestId,{method:p.request.method,url:safeUrl(p.request.url)});
    if(message.method==='Network.responseReceived')result.responses.push({url:safeUrl(p.response.url),status:p.response.status,type:p.type,mimeType:p.response.mimeType});
    if(message.method==='Network.loadingFailed')result.failedRequests.push({...requests.get(p.requestId),error:p.errorText,blockedReason:p.blockedReason});
    if(message.method==='Fetch.requestPaused'){
      const request=p.request,u=new URL(request.url),method=request.method;
      if(args[3]==='--local-url'&&u.pathname==='/broker-v2.js'){
        void readFile(`${repo}/site/broker-v2.js`,'utf8').then(source=>{
          const fixture=source.replace('const PREVIEW =','let PREVIEW =')+`\nwindow.__connectedHolderFixture=()=>{PREVIEW=false;loadAgentAccountStatus=async()=>null;hydrateSelected=async()=>{};ensureV2Session=async()=>{};jsonRequest=async(path,options)=>{if(path.endsWith('/chat')){window.__startRequest=JSON.parse(options.body);return{responseKind:'STRATEGY_DRAFT',draft:{intentHash:'0x'+'a'.repeat(64),intent:{...state.selected.strategy.intent,operatingMode:'AUTONOMOUS',totalMintLimit:window.__startRequest.message.includes('Keep hunting for up to 100')?100:5,expiration:new Date(Date.now()+(window.__startRequest.message.includes('Keep hunting for up to 100')?30:1)*86400000).toISOString(),allowedContracts:window.__startRequest.message.includes('Clear my collection target.')?[]:state.selected.strategy.intent.allowedContracts}}};}throw Error('Local connected fixture: no remote reads');};state.wallet={account:'0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6',chainId:4663,status:'owner'};state.punks=[{...previewPunks[0],tokenId:'93'},{...previewPunks[1],tokenId:'1135'}];state.selected=state.punks[0];state.selected.strategy={intent:{expectedOwner:'0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6',punkTokenId:'93',allowedContracts:['0xb73f1d1aee57410d537d87b656e98b9d3df5b213'],operatingMode:'ASK',dailyMintLimit:5,totalMintLimit:5,mintMode:'FREE_ONLY',maxGasPerMintWei:'500000000000000',minimumReserveWei:'10000000000000000',preferences:{prefer:['PIXEL'],avoid:[]},preferredSocialPlatforms:[]}};state.agentAccounts.set('93',{ok:true,owner:state.wallet.account,tokenId:'93',chainId:4663,receivedAt:Date.now(),runtime:{sessionActive:false},worker:{enabled:true},readiness:{setupAvailable:true},mission:{sessionId:'completed-93',status:'COMPLETED',completedMints:1,totalLimit:1,dailyLimit:1,opportunitiesChecked:4,checks:1,lastCheckedAt:'2026-09-12T23:53:01Z'}});window.__badgeFixture=()=>{const a=state.agentAccounts.get('93');a.receivedAt=Date.now();a.mission.sessionId='badge-check-'+Date.now();a.mission.status='COMPLETED';a.runtime.sessionActive=false;missionNotifications.observe({owner:state.wallet.account,tokenId:'93',account:a});};window.__refreshAgentFixture=()=>{state.agentAccounts.get('93').runtime.entryPointDeposit='10000000000000000';renderAgentAccount();};window.__activationFixture=(kind)=>{const a=state.agentAccounts.get('93');a.receivedAt=Date.now();a.runtime={accountCreated:kind!=='setup',account:'0x'+'2'.repeat(40),owner:state.wallet.account,sessionActive:false,nativeBalance:kind==='funded'?'20000000000000000':'0',entryPointDeposit:'0'};a.readiness={setupAvailable:true,blockers:[]};state.localStrategy=null;renderActivationGuide();};window.__gasFixture=(created)=>{const a=state.agentAccounts.get('93');a.runtime.accountCreated=created;a.runtime.account='0x'+'2'.repeat(40);a.runtime.nativeBalance='0';a.runtime.entryPointDeposit='0';renderAgentGasFunding(a);};window.__missionFixtureState=(kind)=>{const a=state.agentAccounts.get('93');a.receivedAt=Date.now();a.runtime={accountCreated:true,owner:state.wallet.account,account:'0x'+'2'.repeat(40),sessionActive:kind!=='complete',nativeBalance:'20000000000000000',entryPointDeposit:'0',session:{minimumNativeReserveWei:'10000000000000000'}};a.readiness.blockers=[];a.readiness.automaticExecutionReady=true;a.worker.enabled=kind!=='paused';a.mission=kind==='complete'?{status:'COMPLETED',completedMints:1,totalLimit:1,dailyLimit:1}:{account:a.runtime.account,intent:{expectedOwner:state.wallet.account,punkTokenId:'93',minimumReserveWei:'10000000000000000'},status:'ACTIVE',completedMints:0,totalLimit:5,dailyLimit:5,validAfter:new Date(Date.now()-60000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),lastCheckedAt:new Date(Date.now()-(kind==='stale'?240000:10000)).toISOString()};renderMissionMonitor();};renderRoster();renderSelected();publicPaidControl.selectionChanged();holderBurnInspectionControl.refresh();};`;
          return call('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(fixture).toString('base64')});
        }).catch(error=>result.exceptions.push(error.message));return;
      }
      const apiAllowed=u.pathname==='/api/v2/providers'||u.pathname==='/api/v2/session';
      const allowed=(['GET','HEAD'].includes(method)||(args[3]==='--local-url'&&u.pathname.startsWith('/api/local-art-broker-v2/')))&&u.origin===origin&&!u.pathname.startsWith('/.netlify/functions/')
        &&(!u.pathname.startsWith('/api/')||apiAllowed||args[3]==='--local-url');
      if(!allowed)result.blockedRequests.push({method,url:safeUrl(request.url),reason:'READ_ONLY_BROWSER_BOUNDARY'});
      void call(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:p.requestId,...(allowed?{}:{errorReason:'BlockedByClient'})})
        .catch(error=>result.exceptions.push(error.message));
    }
    const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);message.error?waiter.reject(Error(message.error.message)):waiter.resolve(message.result);}
  };
  const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description??value.exceptionDetails.text);return value.result.value;};
  const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(`UI_TIMEOUT:${expression}`);};
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Log.enable');
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.addEventListener('gogh:owner-snapshot',e=>e.stopImmediatePropagation(),true);window.addEventListener('gogh:wallet-state',e=>e.stopImmediatePropagation(),true);`});
  await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  result.browser=(await call('Browser.getVersion')).product;
  for(const [width,height]of [[1440,1000],[375,900],[320,900]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await call('Page.navigate',{url});
    await until(`document.readyState==='complete'&&document.querySelector('[data-forge-skill-admin] h3')&&document.querySelector('[data-persistent-watch] [role=status]')`);
    await new Promise(resolve=>setTimeout(resolve,1500));
    if(args[3]==='--local-url') {
      await evaluate(`document.querySelector('[data-v2-tab="talk"]').click()`);
      await evaluate(`document.querySelector('[data-agent-options] form').requestSubmit()`);
      await until(`document.querySelector('[data-confirmation-dialog]').open`);
      const review=await evaluate(`({text:document.querySelector('[data-confirmation-dialog]').textContent, chat:!!document.querySelector('[data-conversation]')})`);
      assert.equal(review.chat,false);assert.match(review.text,/REVIEW YOUR PUNK/);
      await evaluate(`document.querySelector('[data-edit-strategy]').click()`);
      assert.equal(await evaluate(`document.querySelector('[data-confirmation-dialog]').open`),false);
      await evaluate(`document.querySelector('[data-show-link]').click()`);
      assert.equal(await evaluate(`document.querySelector('[data-link-form]').hidden`),false);
      result.optionsReviewPassed=true;
      await evaluate(`window.__connectedHolderFixture()`);
      for (const [kind,label] of [['complete','NOT LOOKING FOR MINTS'],['active','LOOKING FOR MINTS'],['paused','WORKER PAUSED'],['stale','CHECK OVERDUE']]) {
        await evaluate(`window.__missionFixtureState('${kind}')`);
        assert.equal(await evaluate(`document.querySelector('[data-current-mission-status]').textContent`),label);
        assert.equal(await evaluate(`document.querySelector('[data-hero-status]').textContent`),label);
      }
      await evaluate(`window.__missionFixtureState('complete')`);
      assert.equal(await evaluate(`document.querySelector('[data-start-free-mission]').hidden`),false);
      assert.match(await evaluate(`document.querySelector('[data-current-mission-detail]').textContent`),/5 per day, 5 total/);
      await evaluate(`document.querySelector('[data-start-free-mission]').click()`);
      await until(`document.querySelector('[data-confirmation-dialog]').open`);
      assert.match(await evaluate(`document.querySelector('[data-confirmation-grid]').textContent`),/DAILY LIMIT5TOTAL LIMIT5/);
      assert.equal(await evaluate(`document.querySelector('[data-activate-strategy]').textContent`),'AUTHORIZE MISSION');
      await evaluate(`document.querySelector('[data-confirmation-dialog]').close()`);
      result.startMissionReviewPassed=true;
      assert.equal(await evaluate(`document.querySelector('[data-new-free-search]').hidden`),false);
      await evaluate(`document.querySelector('[data-new-free-search]').click()`);
      await until(`document.querySelector('[data-confirmation-dialog]').open`);
      const newReview=await evaluate(`document.querySelector('[data-confirmation-grid]').textContent`);
      assert.match(newReview,/DAILY LIMIT5TOTAL LIMIT5/);assert.match(newReview,/SUPPORTED COLLECTIONS MATCHING YOUR RULES/);assert.ok(!newReview.includes('0xb73f'));
      await evaluate(`document.querySelector('[data-confirmation-dialog]').close()`);result.clearTargetReviewPassed=true;
      await evaluate(`document.querySelector('[data-open-swarm]').click();for(const n of document.querySelectorAll('[data-swarm-panel] input[type=checkbox]')){n.checked=true;n.dispatchEvent(new Event('change'));}for(const n of document.querySelectorAll('[data-swarm-panel] select')){if(['daily','total'].includes(n.name))n.value='5';}document.querySelector('[data-swarm-panel] [name=fundingBudgetEth]').value='0.003';document.querySelector('[data-swarm-panel] form').requestSubmit()`);
      assert.match(await evaluate(`document.querySelector('[data-swarm-panel]').textContent`),/Combined maximum: 10 per day, 10 total/);
      assert.match(await evaluate(`document.querySelector('[data-swarm-panel]').textContent`),/0.0015 ETH/);
      await evaluate(`[...document.querySelectorAll('[data-swarm-panel] button')].find(n=>n.textContent==='REVIEW FUNDING #93').click()`);
      await until(`document.querySelector('[data-v2-tab=fund]').getAttribute('aria-selected')==='true'`);
      assert.equal(await evaluate(`document.querySelector('#agent-gas-source').value`),'OWNER');
      assert.equal(await evaluate(`document.querySelector('#agent-gas-amount').value`),'0.0015');
      assert.equal(await evaluate(`document.querySelector('#agent-gas-amount').disabled`),true);
      assert.equal(await evaluate(`document.querySelector('[data-agent-gas-confirm]').checked`),false);
      assert.equal(await evaluate(`document.querySelector('[data-agent-gas-form] button[type=submit]').textContent`),'REVIEW & SIMULATE');
      await evaluate(`document.querySelector('[data-swarm-funding-back]').click()`);result.swarmFundingAllocationPassed=true;
      for (const [kind,label] of [['setup','AGENT NOT ACTIVATED'],['gas','NEEDS AGENT GAS'],['funded','AUTHORIZE A MISSION']]) {
        await evaluate(`window.__activationFixture('${kind}')`);
        assert.equal(await evaluate(`document.querySelector('[data-activation-label]').textContent`),label);
      }
      await evaluate(`document.querySelector('[data-activation-guide] details').open=true`);
      const activationShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});const activationFile='activation-'+width+'.png';await writeFile(join(output,activationFile),Buffer.from(activationShot.data,'base64'));result.screenshots.push(activationFile);
      await evaluate(`document.querySelector('[data-activation-guide] details').open=false`);result.activationStepsPassed=true;

      await evaluate(`[...document.querySelectorAll('[data-swarm-panel] button')].find(n=>n.textContent==='REVIEW PUNK #93').click()`);
      await until(`document.querySelector('[data-confirmation-dialog]').open`);
      assert.match(await evaluate(`document.querySelector('[data-confirmation-grid]').textContent`),/SUPPORTED COLLECTIONS MATCHING YOUR RULES/);
      await evaluate(`document.querySelector('[data-confirmation-dialog]').close()`);
      assert.match(await evaluate(`document.querySelector('[data-swarm-panel]').textContent`),/Other Punks are still waiting/);result.swarmReviewPassed=true;
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
      const swarmShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});const swarmFile='swarm-'+width+'.png';await writeFile(join(output,swarmFile),Buffer.from(swarmShot.data,'base64'));result.screenshots.push(swarmFile);
      await evaluate(`window.__gasFixture(false)`);assert.equal(await evaluate(`document.querySelector('[data-agent-gas-setup]').hidden`),false);assert.equal(await evaluate(`document.querySelector('[data-agent-gas-form] button[type=submit]').disabled`),true);
      await evaluate(`window.__gasFixture(true)`);assert.equal(await evaluate(`document.querySelector('[data-agent-gas-setup]').hidden`),true);assert.equal(await evaluate(`document.querySelector('[data-agent-gas-form] button[type=submit]').disabled`),false);result.fundingSetupPassed=true;

      await evaluate(`[...document.querySelectorAll('[data-swarm-panel] button')].find(n=>n.textContent==='CLOSE BATCH PLANNER').click();document.querySelector('[data-swarm-details]').open=false`);

      await evaluate(`window.__refreshAgentFixture();const f=document.querySelector('[data-agent-options] form');f.elements.mode.value='AUTONOMOUS';f.elements.duration.value='KEEP_HUNTING';f.elements.duration.dispatchEvent(new Event('change'));f.requestSubmit()`);
      await until(`document.querySelector('[data-confirmation-dialog]').open`);
      assert.match(await evaluate(`document.querySelector('[data-confirmation-grid]').textContent`),/TOTAL LIMIT100/);
      assert.match(await evaluate(`document.querySelector('[data-confirmation-grid]').textContent`),/PERMISSION EXPIRES/);
      assert.equal(await evaluate(`document.querySelector('[data-agent-options] [name=total]').disabled`),true);
      await evaluate(`document.querySelector('[data-confirmation-dialog]').close();window.__badgeFixture()`);
      assert.equal(await evaluate(`document.querySelector('[data-activity-mission-badge]').hidden`),false);
      assert.equal(await evaluate(`document.querySelector('[data-roster-mission-badge="93"]').hidden`),false);
      assert.match(await evaluate(`document.querySelector('[data-mission-update-list]').textContent`),/Mission completed/);
      await evaluate(`document.querySelector('[data-mission-updates]').open=true`);
      const badgeShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});const badgeFile='badges-'+width+'.png';await writeFile(join(output,badgeFile),Buffer.from(badgeShot.data,'base64'));result.screenshots.push(badgeFile);
      await evaluate(`document.querySelector('[data-v2-tab=activity]').click()`);
      assert.equal(await evaluate(`document.querySelector('[data-activity-mission-badge]').hidden`),true);
      await evaluate(`document.querySelector('[data-mission-updates]').open=false;document.querySelector('[data-v2-tab=talk]').click()`);
      result.keepHuntingReviewPassed=true;result.missionBadgesPassed=true;
      await until(`!document.querySelector('[data-public-paid-panel]').hidden`);
      const connected=await evaluate(`(()=>{const mint=document.querySelector('[data-public-paid-panel]');return {mint:mint.textContent,blankCollection:mint.querySelector('input').value==='',oldBurnInForge:!!document.querySelector('[data-v2-panel=forge] [data-forge-selected-burn]'),legacyClosed:!document.querySelector('[data-legacy-burn-recovery]').open,legacyText:document.querySelector('[data-forge-selected-burn]').textContent,chat:!!document.querySelector('[data-conversation]'),help:document.querySelectorAll('[data-feature-help]').length}})()`);
      assert.match(connected.mint,/DIRECT A PAID MINT.*93/);assert.match(connected.mint,/How to direct a mint/);assert.match(connected.mint,/0.001 ETH/);
      assert.ok(connected.blankCollection&&connected.legacyClosed);assert.equal(connected.oldBurnInForge,false);assert.equal(connected.chat,false);assert.equal(connected.help,7);
      assert.doesNotMatch(connected.legacyText,/RECHECK SELECTED TEST|CONFIRM IN WALLET|REVIEW BURN/);
      result.connectedOwnerFixture=connected;

    }
    const states=[];
    for(const tab of ['talk','collection','forge','fund','settings']){
      await evaluate(`document.querySelector('[data-v2-tab="${tab}"]').click()`);
      if(tab==='settings')await evaluate(`document.querySelector('.forge-admin-settings').open=true`);
      await new Promise(resolve=>setTimeout(resolve,150));
      const state=await evaluate(`(()=>{const visible=el=>!!el&&el.getClientRects().length>0&&!el.hidden;
        const panel=document.querySelector('[data-v2-panel="${tab}"]'),admin=document.querySelector('[data-forge-skill-admin]'),watch=document.querySelector('[data-persistent-watch]');
        return{tab:'${tab}',selected:!panel.hidden,panelVisible:visible(panel),selectedStageVisible:visible(document.querySelector('[data-selected-stage]')),
          netlifyDrawerPresent:!!document.querySelector('[data-netlify-deploy-id],script[src="/.netlify/scripts/cdp"]'),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
          wallet:document.querySelector('[data-wallet-state]').textContent,providerPresent:!!window.__GOGH_WALLET_PROVIDER__,
          optionsMounted:!!document.querySelector('[data-agent-options] form'), chatRemoved:!document.querySelector('[data-chat-form], [data-conversation], [data-chat-avatar]'), helpCount:document.querySelectorAll('[data-feature-help]').length, forgeHasOldBurn:!!document.querySelector('[data-v2-panel=forge] [data-forge-selected-burn]'), providerPickerRemoved:!document.querySelector('#provider-setting'),adminText:admin.textContent,adminControls:[...admin.querySelectorAll('button')].map(b=>({text:b.textContent,disabled:b.disabled})),
          watchText:watch.textContent,watchVisible:visible(watch),watchButtons:[...watch.querySelectorAll('button')].filter(visible).map(b=>({text:b.textContent,disabled:b.disabled})),
          overflowing:[...panel.querySelectorAll('*')].filter(visible).filter(el=>{const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;}).map(el=>({tag:el.tagName,class:el.className,text:el.textContent.slice(0,100)})).slice(0,15)};})()`);
      states.push(state);
      await evaluate(`document.querySelector('${tab==='talk'?'[data-current-mission]':`[data-v2-panel="${tab}"]`}').scrollIntoView({block:'start'})`);
      const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      const file=`${tab}-${width}.png`;await writeFile(join(output,file),Buffer.from(screenshot.data,'base64'));result.screenshots.push(file);
    }
    result.viewports.push({width,height,states});
  }
  for(const path of ['/broker/v2/index.html','/broker-v2.js','/broker-mission-status.js','/forge-skill-admin-panel.js','/broker-persistent-watch-mount.js','/broker-persistent-watch.js','/broker-v2.css','/broker-persistent-watch.css','/broker-agent-options.js','/directed-paid-public-panel.js','/erc20-withdraw-panel.js','/forge-holder-inspection-panel.js','/guide/index.html','/broker-action-feedback.js','/broker-mission-status.js','/forge-paid-release.js','/forge-paid-panel.js','/forge-paid-wallet.js','/broker-swarm.js','/broker-swarm-funding.js','/broker-activation-status.js','/broker-mission-notifications.js','/broker-feature-help.js','/forge-selected-burn-panel.js','/forge-holder-inspection-panel.js']){
    const requested=path==='/broker/v2/index.html'?'/':path;
    const response=await fetch(`${origin}${requested}`,{redirect:'error',headers:{'cache-control':'no-cache'}});
    let bytes=Buffer.from(await response.arrayBuffer());if(args[3]==='--preview-url'&&path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace(/<div data-netlify-deploy-id="[a-f0-9]{24}" data-netlify-site-id="9f495fcf-b694-4b06-bdf5-7cd63bfe220e" data-vcs="github" style="position:fixed">\s*<script async src="\/\.netlify\/scripts\/cdp"><\/script>\s*<\/div>\n/,''));const expected=args[3]==='--local-url'?await readFile(`${repo}/site${path}`):execFileSync('git',['show',`${commit}:site${path}`],{cwd:repo});
    const sha=value=>createHash('sha256').update(value).digest('hex');
    result.staticHashes.push({path,status:response.status,matches:bytes.equals(expected),servedSha256:sha(bytes),expectedSha256:sha(expected)});
  }
  result.finishedAt=new Date().toISOString();
  result.status=result.exceptions.length||result.staticHashes.some(file=>!file.matches||file.status!==200)
    ||result.viewports.some(v=>v.states.some(s=>!s.selected||!s.optionsMounted||!s.chatRemoved||s.helpCount!==7||s.forgeHasOldBurn||!s.providerPickerRemoved||s.scrollWidth>s.width||s.overflowing.length||(args[3]!=='--local-url'&&s.providerPresent)||s.adminControls.some(b=>!b.disabled&&b.text!=='RECHECK SKILL RELEASES')))?'FINDINGS':'PASS';
}catch(error){result.status='FAILED';result.error=error.stack;}
finally{await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));ws?.close();chrome.kill('SIGTERM');
  await Promise.race([chromeExited,new Promise(resolve=>setTimeout(resolve,5000))]);
  try{await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:500});}catch(error){result.cleanupError=error.code;}
  await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,output,commit,error:result.error,
    exceptions:result.exceptions.length,consoleErrors:result.consoleErrors.length,logErrors:result.logErrors.length,blockedRequests:result.blockedRequests.length,
    failedRequests:result.failedRequests.length,screenshots:result.screenshots.length,staticHashes:result.staticHashes},null,2));}
