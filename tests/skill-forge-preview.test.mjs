import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { startPreview } from '../scripts/dev/skill-forge/preview-server.mjs';

test('local Forge: contract snapshots, read-only HTTP and responsive browser', { timeout: 120000 }, async t => {
  const preview = await startPreview();
  t.after(() => preview.close());
  await t.test('credits, learned/equipped distinction and real local events', async () => {
    const data = await (await fetch(`${preview.url}/api/forge?tokenId=1`)).json();
    assert.equal(data.chainId, 31337); assert.equal(data.canBurn, false); assert.equal(data.productionReadyCount, 0);
    assert.equal(data.credits, '1'); assert.equal(data.learned.length, 2); assert.equal(data.slots, 2);
    assert.equal(data.equipped.filter(key => !/^0x0+$/.test(key)).length, 1);
    assert.equal(data.history.filter(event => event.name === 'TrainingCreditEarned').length, 4);
    assert.ok(data.history.every(event => /^0x[0-9a-f]{64}$/.test(event.transactionHash)));
    assert.deepEqual(data.candidates.map(candidate => candidate.tokenId), [44, 7]);
    assert.ok(data.candidates.every(candidate => candidate.canBurn === false && candidate.inventory === 'UNKNOWN' && candidate.owner === data.owner));
    const other = await (await fetch(`${preview.url}/api/forge?tokenId=44`)).json();
    assert.equal(other.learned.length, 0); assert.equal(other.history.length, 0); assert.equal(other.credits, '0');
    assert.deepEqual(other.candidates.map(candidate => candidate.tokenId), [1, 7]);
    assert.equal(other.candidates[0].learnedCount, '2');
  });
  await t.test('no mutation, arbitrary token, cross-origin or file access', async () => {
    assert.equal((await fetch(`${preview.url}/api/forge?tokenId=1`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${preview.url}/api/forge?tokenId=93`)).status, 400);
    assert.equal((await fetch(preview.url, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const forgedHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(preview.url, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(forgedHostStatus, 403);
    assert.equal((await fetch(`${preview.url}/contracts/out/GoghSkillProgression.sol/GoghSkillProgression.json`)).status, 404);
    const page = await fetch(preview.url);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
  });
  await t.test('desktop/mobile, switching, details, warnings and error state', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'gogh-forge-browser-'));
    const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${folder}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    t.after(() => chrome.kill('SIGTERM'));
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
      let output = '';
      chrome.on('error', error => { clearTimeout(timeout); reject(error); });
      chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    const host = new URL(endpoint).host;
    const pages = await (await fetch(`http://${host}/json/list`)).json();
    const socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    t.after(() => socket.close());
    const pending = new Map(); let id = 0; const errors = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      const task = pending.get(message.id);
      if (task) { pending.delete(message.id); message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result); }
    };
    const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw new Error(`DOM condition timed out: ${expression}`);
    };
    await call('Page.enable'); await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: preview.url });
    await until("document.querySelector('#profile')?.hidden === false");
    assert.equal(await evaluate("document.querySelectorAll('.skill').length"), 5);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await evaluate("document.querySelector('#browse-sacrifice').click()");
    await until("document.querySelectorAll('.sacrifice-card').length === 2");
    assert.match(await evaluate("document.querySelector('#training-target').textContent"), /PUNK #1/);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-candidate]')].map(n=>n.dataset.candidate)"), ['44', '7']);
    assert.match(await evaluate("document.querySelector('.sacrifice-card').textContent"), /Unknown/);
    await evaluate("document.querySelector('.sacrifice-card button').click()");
    assert.equal(await evaluate("document.querySelector('#candidate-review').hidden"), false);
    assert.match(await evaluate("document.querySelector('#candidate-title').textContent"), /#44 → TRAIN #1/);
    assert.equal(await evaluate("document.querySelector('#candidate-review>button').disabled"), true);
    await evaluate("document.querySelector('#close-picker').click()");
    await evaluate("document.querySelector('.skill button').click()");
    assert.equal(await evaluate("document.querySelector('#detail').open"), true);
    assert.match(await evaluate("document.querySelector('#detail-body').textContent"), /No signing or spending authority/);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until("!document.querySelector('#detail').open");
    await evaluate("document.querySelector('[data-punk=\"44\"]').click()");
    await until("document.querySelector('#punk-label').textContent === 'LOCAL PUNK #44'");
    assert.match(await evaluate("document.querySelector('#history').textContent"), /No training events/);
    await evaluate("document.querySelector('#browse-sacrifice').click()");
    await until("document.querySelector('[data-candidate=\"1\"]') !== null");
    await evaluate("document.querySelector('[data-candidate=\"1\"] button').click()");
    assert.match(await evaluate("document.querySelector('#candidate-inventory').textContent"), /2 learned skills, 1 credits and 2 slots/);
    await evaluate("document.querySelector('#close-picker').click()");
    await evaluate("document.querySelector('[data-punk=\"1\"]').click()");
    await until("document.querySelector('#punk-label').textContent === 'LOCAL PUNK #1'");
    assert.equal(await evaluate("document.querySelectorAll('.skill.learned').length"), 2);
    const desktop = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(join(folder, 'forge-desktop.png'), Buffer.from(desktop.data, 'base64'));
    for (const width of [390, 375]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `overflow at ${width}`);
      assert.equal(await evaluate("[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)"), true);
      await evaluate("document.querySelector('#browse-sacrifice').click()");
      await until("document.querySelectorAll('.sacrifice-card').length === 2");
      assert.equal(await evaluate("document.querySelector('#sacrifice-picker').scrollWidth <= document.querySelector('#sacrifice-picker').clientWidth"), true);
      await evaluate("document.querySelector('.sacrifice-card button').click()");
      assert.equal(await evaluate("document.querySelector('#sacrifice-picker').scrollWidth <= document.querySelector('#sacrifice-picker').clientWidth"), true);
      const picker = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(folder, `forge-sacrifice-${width}.png`), Buffer.from(picker.data, 'base64'));
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await until("!document.querySelector('#sacrifice-picker').open");
    }
    const mobile = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(join(folder, 'forge-mobile.png'), Buffer.from(mobile.data, 'base64'));
    await evaluate("document.querySelector('#review-burn').click()");
    assert.equal(await evaluate("document.querySelector('#detail').open"), true);
    assert.match(await evaluate("document.querySelector('#detail-body').textContent"), /Unknown inventory is blocked/);
    assert.equal(await evaluate("document.querySelector('#detail-action').disabled"), true);
    assert.equal(await evaluate("document.querySelector('#detail').scrollWidth <= document.querySelector('#detail').clientWidth"), true);
    await evaluate("document.querySelector('#close-detail').click(); window.realFetch = window.fetch; window.stalePicker = new Promise(resolve => window.finishStalePicker = resolve); window.fetch = () => window.stalePicker; document.querySelector('#browse-sacrifice').click(); document.querySelector('#close-picker').click(); window.fetch = window.realFetch; document.querySelector('#browse-sacrifice').click()");
    await until("document.querySelectorAll('.sacrifice-card').length === 2");
    await evaluate("window.finishStalePicker({ok:true,json:async()=>({localOnly:true,chainId:31337,tokenId:1,canBurn:false,candidates:[]})}); new Promise(resolve=>setTimeout(resolve,50))");
    assert.equal(await evaluate("document.querySelectorAll('.sacrifice-card').length"), 2);
    await evaluate("document.querySelector('.sacrifice-card button').click(); document.querySelector('#leave-review').click()");
    assert.equal(await evaluate("document.querySelector('#sacrifice-picker').open"), false);
    await evaluate("window.fetch = async () => { throw new Error('offline fixture') }; document.querySelector('#browse-sacrifice').click()");
    await until("document.querySelector('#picker-status').textContent.includes('unavailable')");
    assert.equal(await evaluate("document.querySelectorAll('.sacrifice-card').length"), 0);
    await evaluate("document.querySelector('#close-picker').click(); document.querySelector('[data-punk=\"7\"]').click()");
    await until("document.querySelector('#status').textContent.includes('unavailable')");
    assert.equal(await evaluate("document.querySelector('#profile').hidden"), true);
    assert.deepEqual(errors, []);
    console.log(`Browser screenshots: ${folder}/forge-{desktop,mobile}.png`);
  });
});
