import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { startPreview } from '../scripts/dev/skill-forge/preview-server.mjs';

test('local Forge: contract snapshots, guarded local training and responsive browser', { timeout: 120000 }, async t => {
  const preview = await startPreview();
  t.after(() => preview.close());
  await t.test('credits, learned/equipped distinction and real local events', async () => {
    const data = await (await fetch(`${preview.url}/api/forge?tokenId=1`)).json();
    assert.equal(data.chainId, 31337); assert.equal(data.canBurn, false); assert.equal(data.productionReadyCount, 0);
    assert.equal(data.forgeMinimumSupply, '1111');
    assert.equal(data.cap, 7);
    assert.equal(data.skills.length, 13);
    assert.equal(data.skills.filter(skill => skill.comingSoon).length, 8);
    assert.ok(data.skills.every(skill => skill.learnable === false));
    assert.ok(data.skills.filter(skill => skill.comingSoon).every(skill => skill.key === null && skill.tools.length === 0));
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
  await t.test('data routes reject mutation, arbitrary tokens, cross-origin and file access', async () => {
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
  await t.test('desktop/mobile, switching, details, warnings and error state', async browser => {
    const folder = await mkdtemp(join(tmpdir(), 'gogh-forge-browser-'));
    const profile = join(folder, 'profile');
    const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--disable-background-networking',
      '--disable-component-update', '--disable-default-apps', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let socket, chromeStderr = '';
    const documentRequests = [];
    chrome.stderr.on('data', chunk => { chromeStderr = (chromeStderr + chunk.toString()).slice(-4000); });
    browser.after(async () => {
      // Complete the CDP close handshake while its browser is still alive.
      // Pending commands and owned processes each have a bounded cleanup path.
      if (socket && socket.readyState !== WebSocket.CLOSED) await new Promise(resolve => {
        const timer = setTimeout(resolve, 2000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
        try { socket.close(); } catch { clearTimeout(timer); resolve(); }
      });
      const exited = () => chrome.exitCode !== null || chrome.signalCode !== null;
      const waitForExit = () => new Promise(resolve => {
        if (exited()) return resolve();
        const timer = setTimeout(resolve, 2000);
        chrome.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      if (!exited()) { chrome.kill('SIGTERM'); await waitForExit(); }
      if (!exited()) { chrome.kill('SIGKILL'); await waitForExit(); }
      chrome.stderr.destroy(); chrome.unref();
      assert.ok(exited(), 'Owned Chrome process did not exit');
      await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    });
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
      let output = '';
      chrome.on('error', error => { clearTimeout(timeout); reject(error); });
      chrome.once('exit', (code, signal) => { clearTimeout(timeout); reject(new Error(`Chrome exited before startup: ${code ?? signal}`)); });
      chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 5000);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection failed')); };
    });
    const pending = new Map(); let id = 0, pageSession; const errors = [];
    const rejectPending = reason => { for (const task of pending.values()) task.reject(new Error(reason)); pending.clear(); };
    socket.addEventListener('close', () => rejectPending('CDP connection closed'));
    socket.addEventListener('error', () => rejectPending('CDP connection failed'));
    browser.signal.addEventListener('abort', () => rejectPending('Browser test aborted'), { once: true });
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.sessionId && message.sessionId !== pageSession) return;
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.method === 'Fetch.requestPaused') {
        const { requestId, request, resourceType } = message.params;
        if (resourceType === 'Document') {
          documentRequests.push({ url: request.url, method: request.method });
          if (documentRequests.length > 4) documentRequests.shift();
        }
        const local = new URL(request.url).origin === preview.url;
        if (!local) errors.push(`Nonlocal browser request blocked: ${request.url}`);
        call(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(!local && { errorReason: 'BlockedByClient' }) })
          .catch(error => errors.push(error.message));
      }
      const task = pending.get(message.id);
      if (task) { pending.delete(message.id); message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result); }
    };
    const call = (method, params = {}, timeoutMs = 10000) => new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN || browser.signal.aborted) return reject(new Error('CDP connection unavailable'));
      const next = ++id;
      const timer = setTimeout(() => { pending.delete(next);
        reject(new Error(`CDP command timed out: ${method}; ${JSON.stringify(params).slice(0, 240)}`)); }, timeoutMs);
      pending.set(next, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
      try { socket.send(JSON.stringify({ id: next, method, params, ...(pageSession && { sessionId: pageSession }) })); }
      catch (error) { pending.get(next).reject(error); pending.delete(next); }
    });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async expression => {
      // Local simulation + journal + receipt reads can exceed five seconds while
      // the full suite runs. Match the shared browser harness's bounded deadline.
      for (let i = 0; i < 240; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
      const status = await evaluate("document.querySelector('#status')?.textContent");
      throw new Error(`DOM condition timed out: ${expression}; status: ${status}`);
    };
    // Create and attach through the owned browser connection. Its startup tab
    // and HTTP /json/new response can still be waiting on Chrome initialization.
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: pageSession } = await call('Target.attachToTarget', { targetId, flatten: true }));
    assert.equal(typeof pageSession, 'string');
    await call('Page.enable'); await call('Runtime.enable');
    // Initialize Network before Fetch interception on the fresh page session.
    await call('Network.enable');
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    // A missing CDP response must fail the responsible command rather than
    // silently consuming the entire 120-second parent deadline.
    await assert.rejects(call('Runtime.evaluate', { expression: 'new Promise(resolve => globalThis.finishTimeoutProbe = resolve)', awaitPromise: true }, 25), /CDP command timed out: Runtime.evaluate/);
    assert.equal(await evaluate('finishTimeoutProbe(); delete globalThis.finishTimeoutProbe; 1 + 1'), 2);
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    // Navigate normally and require the exact main-frame commit. Waiting on a
    // Page.navigate command acknowledgement intermittently stalls at startup
    // under the concurrent suite, before any of the product assertions run.
    const committed = new Promise((resolve, reject) => {
      let frameId, contextFrameId, settled = false;
      const finish = async (error, diagnose = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); socket.removeEventListener('message', onMessage);
        socket.removeEventListener('close', onClose); browser.signal.removeEventListener('abort', onAbort);
        if (diagnose) {
          // Preserve the failed deadline while inspecting the still-owned tab.
          // An unloaded document and a missed CDP event need different fixes.
          let document;
          try {
            const result = await call('Runtime.evaluate', { expression: '({url:location.href,readyState:document.readyState,profileVisible:document.querySelector("#profile")?.hidden === false})', returnByValue: true }, 1000);
            document = result.result?.value ?? { exception: result.exceptionDetails?.text };
          } catch (failure) { document = { error: failure.message }; }
          browser.diagnostic(`Navigation failure: ${JSON.stringify({ expectedUrl: preview.url, frameId, contextFrameId, documentRequests, document, errors: errors.slice(-4), chromeStderr })}`);
        }
        error ? reject(error) : resolve();
      };
      const onClose = () => finish(new Error('CDP connection closed during navigation'));
      const onAbort = () => finish(new Error('Browser test aborted during navigation'));
      const onMessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.sessionId !== pageSession) return;
        if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) {
          const { url, id } = message.params.frame;
          if (url !== `${preview.url}/`) return finish(new Error(`Unexpected browser navigation: ${url}`));
          frameId = id;
        }
        if (message.method === 'Runtime.executionContextCreated') {
          const { context } = message.params;
          if (context.origin === preview.url && context.auxData?.isDefault) contextFrameId = context.auxData.frameId;
        }
        if (frameId && frameId === contextFrameId) finish();
      };
      const timer = setTimeout(() => finish(new Error(`Browser navigation did not commit: ${preview.url}`), true), 24000);
      socket.addEventListener('message', onMessage); socket.addEventListener('close', onClose, { once: true });
      browser.signal.addEventListener('abort', onAbort, { once: true });
    });
    await Promise.all([committed, evaluate(`setTimeout(() => location.assign(${JSON.stringify(preview.url)}), 0); true`)]);
    await until("document.querySelector('#profile')?.hidden === false");
    assert.equal(await evaluate("document.querySelectorAll('.skill').length"), 13);
    assert.match(await evaluate("document.querySelector('.roster .eyebrow').textContent"), /SELECT YOUR PUNK/);
    assert.equal(await evaluate("document.querySelectorAll('.equipment-socket [aria-hidden=true]').length"), 7);
    await until("[...document.querySelectorAll('.skill-art')].every(img => img.complete && img.naturalWidth > 0)");
    assert.equal(await evaluate("document.querySelectorAll('.library-skill-art').length"), 13);
    assert.equal(await evaluate("document.querySelectorAll('.slot.locked button').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('.slot.empty [data-loadout-slot]').length"), 1);
    await evaluate("document.querySelector('[data-loadout-slot=\"0\"]').click()");
    assert.match(await evaluate("document.querySelector('#detail-title').textContent"), /LOCAL SLOT 1/);
    assert.match(await evaluate("document.querySelector('#detail-body').textContent"), /UNEQUIP · LOCAL/);
    await evaluate("document.querySelector('#close-detail').click()");
    assert.match(await evaluate("document.querySelector('#forge-floor').textContent"), /1,111 PUNKS · not deployed/);
    for (const [filter, count] of [['research', 5], ['discovery', 4], ['execution', 4], ['learned', 2], ['all', 13]]) {
      await evaluate(`document.querySelector('[data-filter="${filter}"]').click()`);
      assert.equal(await evaluate("document.querySelectorAll('.skill:not([hidden])').length"), count);
    }
    await evaluate("document.querySelector('[data-skill=\"2\"] button').click()");
    assert.equal(await evaluate("document.querySelectorAll('[data-mission]:disabled').length"), 2);
    await evaluate("document.querySelector('#close-detail').click()");
    await evaluate("document.querySelector('[data-skill=\"proposal:paid-mint-license\"] button').click()");
    assert.match(await evaluate("document.querySelector('#detail-body').textContent"), /Higher risk/);
    assert.match(await evaluate("document.querySelector('#detail-body').textContent"), /Unregistered roadmap candidate/);
    assert.equal(await evaluate("document.querySelector('#detail-action').disabled"), true);
    await evaluate("document.querySelector('#close-detail').click()");
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
    await evaluate("document.querySelector('[data-filter=\"learned\"]').click()");
    assert.equal(await evaluate("document.querySelectorAll('.skill:not([hidden])').length"), 0);
    await evaluate("document.querySelector('[data-filter=\"all\"]').click()");
    await evaluate("document.querySelector('#browse-sacrifice').click()");
    await until("document.querySelector('[data-candidate=\"1\"]') !== null");
    await evaluate("document.querySelector('[data-candidate=\"1\"] button').click()");
    assert.match(await evaluate("document.querySelector('#candidate-inventory').textContent"), /2 learned skills, 1 credits and 2 slots/);
    await evaluate("document.querySelector('#close-picker').click()");
    await evaluate("document.querySelector('[data-punk=\"7\"]').click()");
    await until("document.querySelector('#punk-label').textContent === 'LOCAL PUNK #7'");
    await evaluate("document.querySelector('[data-skill=\"2\"] button').click()");
    assert.equal(await evaluate("document.querySelectorAll('[data-mission]:enabled').length"), 2);
    assert.match(await evaluate("document.querySelector('.sniper-options').textContent"), /Equip Sniper before dispatching/);
    await evaluate("document.querySelector('[data-mission=\"floor-snipe\"]').click()");
    assert.match(await evaluate("document.querySelector('.sniper-prompt').textContent"), /Link review alone grants no purchase authority/);
    assert.match(await evaluate("document.querySelector('.sniper-prompt').textContent"), /\[budget\]/);
    await evaluate("document.querySelector('[data-mission=\"mint-link\"]').click()");
    assert.match(await evaluate("document.querySelector('.sniper-prompt').textContent"), /Paid mints require paid-mint permission/);
    assert.equal(await evaluate("document.querySelector('#detail-action').disabled"), true);
    await evaluate("document.querySelector('#close-detail').click()");
    await evaluate("document.querySelector('[data-punk=\"1\"]').click()");
    await until("document.querySelector('#punk-label').textContent === 'LOCAL PUNK #1'");
    assert.equal(await evaluate("document.querySelectorAll('.skill.learned').length"), 2);
    await until("[...document.querySelectorAll('.skill-art')].every(img => img.complete && img.naturalWidth > 0)");
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
    await evaluate("window.fetch = window.realFetch; document.querySelector('[data-punk=\"1\"]').click()");
    await until("document.querySelector('#profile').hidden === false");
    await evaluate("document.querySelector('[data-skill=\"2\"] button').click()");
    assert.equal(await evaluate("document.querySelector('#detail-action').disabled"), false);
    await evaluate("document.querySelector('#detail-action').click()");
    await until("document.querySelector('#status').textContent.includes('Confirmed learn')");
    assert.equal(await evaluate("document.querySelectorAll('.skill.learned').length"), 3);
    assert.equal(await evaluate("document.querySelector('#local-unlock').disabled"), true);
    await evaluate("document.querySelector('[data-loadout-slot=\"1\"]').click()");
    await evaluate("[...document.querySelectorAll('#detail-body button')].find(b=>b.textContent.includes('EQUIP SNIPER')).click()");
    await until("document.querySelector('#status').textContent.includes('Confirmed equip')");
    assert.match(await evaluate("document.querySelectorAll('.slot')[1].textContent"), /Sniper/);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.deepEqual(errors, []);
    const disconnected = assert.rejects(call('Runtime.evaluate', { expression: 'new Promise(() => {})', awaitPromise: true }), /CDP connection closed/);
    socket.close(); await disconnected;
    console.log(`Browser screenshots: ${folder}/forge-{desktop,mobile}.png`);
  });
});
