// Uses a separate, already-running headless Chrome; never touches the owner's wallet profile.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPreview } from './preview-server.mjs';
const preview = await startPreview({ controlCenterTraining: true });
const origin = preview.url;
const page = await (await fetch(`http://127.0.0.1:9227/json/new?${encodeURIComponent(origin + '/control-center')}`, { method: 'PUT' })).json();
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
  // Run real read-only research through the locally equipped fixture, not an ungated bench.
  await click('INSPECT CONTRACT · RUN');
  await until("document.querySelector('[role=status]').textContent.includes('Research completed')");
  assert.match(await evaluate("document.querySelector('.forge-training-result').textContent"), /NOT_A_SECURITY_CLEARANCE/);
  // Learning requires a separate explicit confirmation; Cancel performs no write.
  await click('REVIEW LEARN · 1 CREDIT');
  await until("document.querySelector('dialog').open");
  assert.match(await evaluate("document.querySelector('dialog').textContent"), /ETH value: 0.*Estimated gas:.*Maximum test-network fee:/);
  assert.match(await evaluate("document.querySelector('dialog').textContent"), /Review expires:/);
  await click('CANCEL');
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /1 CREDIT/);
  await click('REVIEW LEARN · 1 CREDIT'); await click('CONFIRM LOCAL TRANSACTION');
  await until("document.querySelector('[role=status]').textContent.includes('LOCAL TRANSACTION CONFIRMED')");
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
  await click('REVIEW LEARN · 1 CREDIT'); await click('CONFIRM LOCAL TRANSACTION');
  await until("document.querySelector('.forge-training-stats').textContent.includes('1 LEARNED')");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='INSPECT CONTRACT · UNEQUIPPED / LOCKED').disabled"), true);
  await evaluate("const choose=document.querySelector('.forge-socket select');choose.selectedIndex=1;document.querySelector('.forge-socket button').click()");
  await click('CONFIRM LOCAL TRANSACTION');
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent==='INSPECT CONTRACT · RUN'&&!b.disabled)");
  await click('INSPECT CONTRACT · RUN');
  await until("document.querySelector('[role=status]').textContent.includes('Research completed')");
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /0 CREDIT.*1 LEARNED.*1\/1 EQUIPPED/);
  assert.deepEqual(errors, []);
  console.log(`PASS shared V2 component: confirm/cancel, learn, equip, gated live research, unequip, token switch, 1440/390/375px. Screenshots: ${folder}`);
} finally { ws.close(); await fetch(`http://127.0.0.1:9227/json/close/${page.id}`); await preview.close(); }
