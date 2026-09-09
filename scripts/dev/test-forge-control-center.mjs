// Local browser integration only. Uses an existing headless Chrome, never the owner's wallet profile.
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const origin = 'http://127.0.0.1:64340';
const page = await (await fetch(`http://127.0.0.1:9227/json/new?${encodeURIComponent(`${origin}/broker/v2/?preview=1&tab=forge`)}`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = ({ data }) => { const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  const task = pending.get(m.id); if (task) { pending.delete(m.id); m.error ? task.reject(Error(JSON.stringify(m.error))) : task.resolve(m.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const until = async expression => { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error(`DOM timeout: ${expression}`); };
try {
  await call('Runtime.enable'); await call('Page.enable');
  await until("document.querySelectorAll('.forge-skill').length === 13");
  assert.equal(await evaluate("document.querySelector('[data-v2-panel=forge]').hidden"), false);
  assert.equal(await evaluate("document.querySelector('[data-forge-connect]').disabled"), true);
  for (const width of [1440, 390, 375]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `overflow at ${width}`);
  }
  await evaluate(`(async()=>{
    const root=document.querySelector('[data-v2-panel=forge]');
    window.forgeSelection={owner:'0x'+'1'.repeat(40),tokenId:'93',chainId:4663,preview:false};
    window.forgeCalls=[];
    window.forgePayload=()=>({ok:true,tokenId:forgeSelection.tokenId,owner:forgeSelection.owner,chainId:4663,
      mode:'READ_ONLY_RESEARCH_LAB',walletAuthority:'NONE',canBurn:false,canLearn:false,canEquip:false,
      labAvailable:true,marketAvailable:true,observedAt:new Date().toISOString(),result:{codeBytes:12,blockNumber:'123'}});
    window.forgeRequest=async(path,opts)=>{forgeCalls.push({path,opts});return forgePayload();};
    const {createForgeControl}=await import('/broker-v2-forge.js');
    window.testForge=createForgeControl({root,getSelection:()=>forgeSelection,ensureSession:async()=>null,request:(...args)=>forgeRequest(...args)});
  })()`);
  await evaluate("document.querySelector('[data-forge-connect]').click()");
  await until("document.querySelector('[data-forge-status]').textContent.includes('OWNER VERIFIED')");
  assert.equal(await evaluate("document.querySelectorAll('.forge-skill button:not(:disabled)').length"), 3);
  await evaluate("document.querySelector('.forge-skill button').click()");
  await until("document.querySelector('[data-forge-report]').textContent.includes('12 bytes')");
  assert.equal(await evaluate("JSON.parse(forgeCalls.at(-1).opts.body).action"), 'inspect_contract');
  // Late responses must not cross selected-Punk or owner boundaries.
  await evaluate("window.oldPayload=forgePayload();window.forgeRequest=()=>new Promise(resolve=>window.releaseForge=resolve);document.querySelector('.forge-skill button').click()");
  await until("typeof releaseForge === 'function'");
  await evaluate("forgeSelection={...forgeSelection,tokenId:'94'};testForge.selectionChanged();releaseForge(oldPayload)");
  assert.equal(await evaluate("document.querySelector('[data-forge-report]').textContent"), '');
  assert.match(await evaluate("document.querySelector('[data-forge-punk]').textContent"), /94/);
  assert.equal(await evaluate("document.querySelectorAll('.forge-skill button:not(:disabled)').length"), 0);
  await evaluate("forgeRequest=async()=>{throw Error('Provider offline')};document.querySelector('[data-forge-connect]').click()");
  await until("document.querySelector('[data-forge-status]').textContent.includes('Provider offline')");
  const dir = await mkdtemp(join(tmpdir(), 'gogh-forge-v2-'));
  for (const width of [1440,390]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height:900, deviceScaleFactor:1,mobile:width<500 });
    await evaluate("document.querySelector('[data-v2-panel=forge]').scrollIntoView()");
    const shot=await call('Page.captureScreenshot',{format:'png'}); await writeFile(join(dir,`forge-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: Forge tab, 13 icons, 3 guarded tests, stale selection rejection, errors, 1440/390/375px. Screenshots: ${dir}`);
} finally { ws.close(); await fetch(`http://127.0.0.1:9227/json/close/${page.id}`); }
