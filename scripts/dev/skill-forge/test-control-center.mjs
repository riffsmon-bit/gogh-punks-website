// Uses a separate, already-running headless Chrome; never touches the owner's wallet profile.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPreview } from './preview-server.mjs';
if (process.argv.length > 3 || process.argv[2] && process.argv[2] !== '--reviewed-only') throw Error('Unknown browser test mode');
const reviewed = process.argv[2] === '--reviewed-only';
const preview = await startPreview({ controlCenterTraining: true, reviewedTraining: reviewed });
const origin = preview.url;
const page = await (await fetch(`http://127.0.0.1:9227/json/new?${encodeURIComponent(origin + '/control-center?testPunk=1')}`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map(), errors = [];
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  const task = pending.get(m.id); if (task) { pending.delete(m.id); m.error ? task.reject(Error(JSON.stringify(m.error))) : task.resolve(m.result); } };
const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const until = async expression => { for (let i = 0; i < 240; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error(`DOM timeout: ${expression}`); };
const click = async text => {
  if (['CONFIRM LOCAL TRANSACTION', 'CANCEL'].includes(text)) await until("document.querySelector('dialog').open");
  return evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
};
try {
  await call('Runtime.enable'); await call('Page.enable');
  await until("document.querySelectorAll('.forge-socket').length===7");
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /1 CREDIT.*2 LEARNED.*1\/2 EQUIPPED/);
  // Recovery outages must preserve verified read-only state, never enable actions.
  await evaluate("window.recoveryTestFetch=window.fetch;window.recoveryTestPosts=[];window.fetch=(url,opts)=>{if(opts?.method==='POST')recoveryTestPosts.push(url);if(url==='/api/local-training/recover')return Promise.resolve(new Response('TRAINING_REVIEW_UNAVAILABLE',{status:409}));return recoveryTestFetch(url,opts)}");
  await click('REFRESH CONTRACT STATE');
  await until("document.querySelector('[role=status]').textContent.includes('transaction recovery unavailable')");
  assert.equal(await evaluate("document.querySelectorAll('.forge-socket').length"), 7);
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /1 CREDIT.*2 LEARNED.*1\/2 EQUIPPED/);
  assert.equal(await evaluate("[...document.querySelectorAll('.forge-socket button,.forge-socket select,.forge-library button,.forge-training-tools button')].every(b=>b.disabled)"), true);
  assert.equal(await evaluate("document.querySelector('.forge-training-history').children.length>0"), true);
  assert.deepEqual(await evaluate('recoveryTestPosts'), ['/api/local-training/recover']);
  await evaluate('window.fetch=window.recoveryTestFetch');
  await click('REFRESH CONTRACT STATE');
  await until("document.querySelector('[role=status]').textContent.includes('Confirmed local snapshot')");
  // Run real read-only research through the locally equipped fixture, not an ungated bench.
  await click('INSPECT CONTRACT · RUN');
  await until("document.querySelector('[role=status]').textContent.includes('Research completed')");
  assert.match(await evaluate("document.querySelector('.forge-training-result').textContent"), /NOT_A_SECURITY_CLEARANCE/);
  // Learning requires a separate explicit confirmation; Cancel performs no write.
  await preview.mineFixtureBlock(); // The visible snapshot is stale, as after idle time.
  await click('REVIEW LEARN · 1 CREDIT');
  await until("document.querySelector('dialog').open");
  assert.match(await evaluate("document.querySelector('dialog').textContent"), /ETH value: 0.*Estimated gas:.*Maximum test-network fee:/);
  assert.match(await evaluate("document.querySelector('dialog').textContent"), /Review expires:/);
  if (reviewed) assert.match(await evaluate("document.querySelector('dialog').textContent"), /ON-CHAIN EXPIRY/);
  await click('CANCEL');
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /1 CREDIT/);
  // A block can also race the fresh read. Retry preparation once; never confirm it.
  await evaluate("window.savedTrainingFetch=window.fetch;window.prepareCalls=0;window.fetch=(url,opts)=>{if(url==='/api/local-training/prepare'&&++prepareCalls===1)return Promise.resolve(new Response('STALE_REVIEW_STATE. Test-only race.',{status:409}));return savedTrainingFetch(url,opts)}");
  await click('REVIEW LEARN · 1 CREDIT'); await until("document.querySelector('dialog').open");
  assert.equal(await evaluate('prepareCalls'), 2);
  await click('CANCEL');
  await evaluate('window.fetch=window.savedTrainingFetch');
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /1 CREDIT/);
  await evaluate("window.prepareCalls=0;window.fetch=(url,opts)=>{if(url==='/api/local-training/prepare'){prepareCalls++;return Promise.resolve(new Response('STALE_REVIEW_STATE. Test-only repeated race.',{status:409}))}return savedTrainingFetch(url,opts)}");
  await click('REVIEW LEARN · 1 CREDIT');
  await until("document.querySelector('[role=status]').textContent.includes('Your loadout is refreshed')");
  assert.equal(await evaluate('prepareCalls'), 2);
  assert.equal(await evaluate("document.querySelectorAll('.forge-socket').length"), 7);
  assert.equal(await evaluate("document.querySelector('dialog').open"), false);
  await evaluate('window.fetch=window.savedTrainingFetch');
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /1 CREDIT/);
  preview.setReceiptVisibility(false);
  await click('REVIEW LEARN · 1 CREDIT'); await click('CONFIRM LOCAL TRANSACTION');
  await until("document.querySelector('[role=status]').textContent.includes('LOCAL TRANSACTION SUBMITTED')");
  const submittedHash = (await evaluate("document.querySelector('[role=status]').textContent")).match(/0x[0-9a-f]{64}/)[0];
  preview.reopenCoordinator();
  await call('Page.reload');
  await until("document.querySelector('[role=status]')?.textContent.includes('Recovered an unresolved')");
  assert.equal(await evaluate("[...document.querySelectorAll('.forge-socket button')].every(b=>b.disabled)"), true);
  preview.setReceiptVisibility(true);
  await click('RECHECK TRANSACTION RECEIPT');
  await until("document.querySelector('[role=status]').textContent.includes('LOCAL TRANSACTION CONFIRMED')");
  assert.ok((await evaluate("document.querySelector('[role=status]').textContent")).includes(submittedHash));
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /0 CREDIT.*3 LEARNED.*1\/2 EQUIPPED/);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='RECHECK TRANSACTION RECEIPT').hidden"), true);
  // Equip Rarity Eye in the empty second slot. Learning alone did not grant this tool.
  await evaluate("const s=document.querySelectorAll('.forge-socket select')[1];s.value=[...s.options].find(o=>o.textContent==='Rarity Eye').value;document.querySelectorAll('.forge-socket')[1].querySelector('button').click()");
  await click('CONFIRM LOCAL TRANSACTION');
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent==='RANK TRAIT SAMPLE · RUN'&&!b.disabled)");
  await click('RANK TRAIT SAMPLE · RUN');
  await until("document.querySelector('[role=status]').textContent.includes('Research completed')");
  assert.match(await evaluate("document.querySelector('.forge-training-result').textContent"), /SAMPLE_ONLY/);
  // Both current equipment and learned history must be visible on mobile.
  const folder = await mkdtemp(join(tmpdir(), 'gogh-training-control-'));
  for (const width of [1440, 390, 375]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `overflow at ${width}`);
    assert.equal(await evaluate("[...document.querySelectorAll('.forge-socket')].every(s=>s.scrollHeight<=s.clientHeight+1)"), true, `slot content overflow at ${width}`);
    const image = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(join(folder, `${width}.png`), Buffer.from(image.data, 'base64'));
  }
  await evaluate("[...document.querySelectorAll('.forge-socket')][1].querySelectorAll('button')[1].click()"); await click('CONFIRM LOCAL TRANSACTION');
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent==='RANK TRAIT SAMPLE · UNEQUIPPED / LOCKED'&&b.disabled)");
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /3 LEARNED.*1\/2 EQUIPPED/);
  // Owner/Punk selection invalidates an open review and clears the prior token's results.
  await click('UNEQUIP');
  await evaluate("document.querySelector('[data-punk=\"44\"]').click()");
  await until("document.querySelector('.forge-training-stats').textContent.includes('TEST PUNK #44')");
  assert.equal(await evaluate("document.querySelector('dialog').open"), false);
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /1 CREDIT.*0 LEARNED.*0\/1 EQUIPPED/);
  preview.loseNextSubmissionHash();
  await click('REVIEW LEARN · 1 CREDIT'); await click('CONFIRM LOCAL TRANSACTION');
  await until("document.querySelector('[role=status]').textContent.includes('SUBMISSION_UNKNOWN')");
  assert.equal(await evaluate("document.querySelector('.forge-training-recovery').hidden"), false);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'recovery controls fit mobile');
  const hashToRecover = await evaluate("fetch('/api/forge?tokenId=44').then(r=>r.json()).then(s=>s.history.find(e=>e.name==='SkillLearned').transactionHash)");
  await evaluate(`document.querySelector('.forge-training-recovery input').value=${JSON.stringify(hashToRecover)}`);
  await click('VERIFY EXISTING HASH · NO SEND');
  await until("document.querySelector('.forge-training-stats').textContent.includes('1 LEARNED')");
  assert.equal(await evaluate("document.querySelector('.forge-training-recovery').hidden"), true);
  assert.equal(await evaluate("fetch('/api/forge?tokenId=44').then(r=>r.json()).then(s=>s.history.filter(e=>e.name==='SkillLearned').length)"), 1);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='INSPECT CONTRACT · UNEQUIPPED / LOCKED').disabled"), true);
  await evaluate("const choose=document.querySelector('.forge-socket select');choose.selectedIndex=1;document.querySelector('.forge-socket button').click()");
  await click('CONFIRM LOCAL TRANSACTION');
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent==='INSPECT CONTRACT · RUN'&&!b.disabled)");
  await click('INSPECT CONTRACT · RUN');
  await until("document.querySelector('[role=status]').textContent.includes('Research completed')");
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /0 CREDIT.*1 LEARNED.*1\/1 EQUIPPED/);
  // Wallet/network identity changes matter even when the token ID stays the same.
  await evaluate(`(async()=>{
    const state=await (await fetch('/api/forge?tokenId=44')).json();
    window.trainingOwner=state.owner;
    window.trainingSelection={tokenId:44,owner:state.owner,chainId:31337,preview:true};
    window.trainingCalls=[];
    window.trainingRequest=async(url,opts)=>{trainingCalls.push(url);const r=await fetch(url,opts);if(!r.ok)throw Error(await r.text());return r.json();};
    const {createTrainingControl}=await import('/forge-training.js');
    const guarded=${reviewed ? "await import('/forge-reviewed-training.js')" : 'null'};
    window.identityControl=createTrainingControl({root:document.querySelector('[data-v2-panel=forge]'),
      getSelection:()=>trainingSelection,request:(...args)=>trainingRequest(...args),localOnly:true,
      ...(guarded?{validateReview:guarded.validateReviewedTrainingReview,validateSnapshot:guarded.validateReviewedTrainingSnapshot}:{})});
  })()`);
  await until("document.querySelector('.forge-training-stats').textContent.includes('TEST PUNK #44')");
  await click('UNEQUIP'); await until("document.querySelector('dialog').open");
  await evaluate("trainingSelection={...trainingSelection,owner:'0x'+'6'.repeat(40)};identityControl.selectionChanged()");
  await until("document.querySelector('[role=status]').textContent.includes('no longer controls')");
  assert.equal(await evaluate("document.querySelector('dialog').open"), false);
  assert.equal(await evaluate("trainingCalls.filter(p=>p.endsWith('/confirm')).length"), 0);
  assert.equal(await evaluate("document.querySelector('.forge-training-stats').textContent"), '');
  await evaluate("trainingSelection={...trainingSelection,owner:trainingOwner};identityControl.selectionChanged()");
  await until("document.querySelector('.forge-training-stats').textContent.includes('TEST PUNK #44')");
  await evaluate("window.liveRequest=trainingRequest;trainingRequest=(url,opts)=>url==='/api/local-tool'?new Promise(resolve=>window.releaseTrainingTool=resolve):liveRequest(url,opts)");
  await click('INSPECT CONTRACT · RUN');
  await until("typeof releaseTrainingTool==='function'");
  await evaluate("trainingSelection={...trainingSelection,chainId:4663};identityControl.selectionChanged();releaseTrainingTool({result:'OLD OWNER RESULT'})");
  await until("document.querySelector('[role=status]').textContent.includes('chain 31337')");
  assert.equal(await evaluate("document.querySelector('.forge-training-result').textContent"), '');
  assert.equal(await evaluate("document.querySelectorAll('.forge-socket').length"), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS shared V2 component: pending receipt + coordinator restart + browser reload without resend, lost-hash recovery, confirm/cancel, learn, equip, gated live research, unequip, token/owner/chain switch, stale response rejection, 1440/390/375px. Screenshots: ${folder}`);
} finally { ws.close(); await fetch(`http://127.0.0.1:9227/json/close/${page.id}`); await preview.close(); }
