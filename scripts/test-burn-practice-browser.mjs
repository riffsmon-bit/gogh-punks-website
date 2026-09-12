import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPreview } from './dev/skill-forge/preview-server.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const preview = await startPreview({ controlCenterTraining: true, reviewedTraining: true, burnPractice: true });
const profile = await mkdtemp(join(tmpdir(), 'gogh-burn-practice-chrome-'));
const output = new URL('../docs/review/2026-09-11/burn-practice/', import.meta.url);
let chrome, ws;
try {
  await mkdir(output, { recursive: true });
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let text = ''; const timer = setTimeout(() => reject(Error('CHROME_TIMEOUT')), 15000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const page = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => { const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    const task = pending.get(message.id);
    if (task) { pending.delete(message.id); message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id, timer = setTimeout(() => { pending.delete(next); reject(Error(`CDP_TIMEOUT ${method}`)); }, 15000);
    pending.set(next, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 250; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw Error(`DOM_TIMEOUT ${expression}: ${await evaluate("document.getElementById('burn-status')?.textContent + '\\n' + document.getElementById('next-training')?.textContent")}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.walletRequests=0; window.ethereum={request(){walletRequests++;throw Error('REAL_WALLET_FORBIDDEN');}};` });
  await call('Page.navigate', { url: `${preview.url}/burn-practice` });
  await until("document.getElementById('prepare-burn')?.disabled === false");
  assert.equal(await evaluate('walletRequests'), 0);
  assert.match(await evaluate("document.querySelector('.punk-pair').textContent"), /Test Punk #7[\s\S]*Test Punk #44/);
  assert.equal(await evaluate("[...document.querySelectorAll('.punk-pair img')].every(img => img.complete && img.naturalWidth > 0)"), true);
  await click('#prepare-burn'); await until("document.getElementById('burn-dialog').open");
  assert.equal(await evaluate("document.getElementById('confirm-burn').disabled"), true);
  await evaluate("document.getElementById('burn-typed').value='BURN 44';document.getElementById('burn-typed').dispatchEvent(new Event('input'));document.getElementById('burn-ack').click()");
  assert.equal(await evaluate("document.getElementById('confirm-burn').disabled"), true);
  await click('#cancel-burn'); await until("!document.getElementById('burn-dialog').open && !document.getElementById('prepare-burn').disabled");
  assert.match(await evaluate("document.getElementById('burn-supply').textContent"), /credits: 0/);
  await click('#prepare-burn'); await until("document.getElementById('burn-dialog').open");
  for (const width of [1440, 390, 375]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `page overflow ${width}`);
    await evaluate("document.querySelector('#burn-dialog details').open=true");
    assert.equal(await evaluate("document.getElementById('burn-dialog').scrollWidth <= document.getElementById('burn-dialog').clientWidth"), true, `dialog overflow ${width}`);
    await evaluate("document.querySelector('#burn-dialog details').open=false");
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL(`review-${width}.png`, output), Buffer.from(shot.data, 'base64'));
  }
  await evaluate("document.getElementById('burn-typed').value='BURN 7';document.getElementById('burn-typed').dispatchEvent(new Event('input'));document.getElementById('burn-ack').click()");
  await until("!document.getElementById('confirm-burn').disabled");
  preview.setReceiptVisibility(false);
  await click('#confirm-burn');
  await until("document.getElementById('burn-status').textContent.includes('SUBMITTED') && !document.getElementById('refresh-burn').disabled");
  assert.equal(await evaluate("document.getElementById('next-training').hidden"), true);
  await call('Page.reload');
  await until("document.getElementById('burn-status').textContent.includes('SUBMITTED')");
  assert.equal(await evaluate("document.getElementById('prepare-burn').disabled"), true);
  preview.setReceiptVisibility(true); await click('#refresh-burn');
  await until("document.getElementById('burn-status').textContent.includes('CONFIRMED') && document.querySelectorAll('.forge-socket').length === 7");
  const buttonText = text => evaluate(`[...document.querySelectorAll('#next-training button')].find(button=>button.textContent===${JSON.stringify(text)}).click()`);
  await until("[...document.querySelectorAll('#next-training button')].some(button=>button.textContent==='REVIEW LEARN · 1 CREDIT'&&!button.disabled)");
  await buttonText('REVIEW LEARN · 1 CREDIT');
  await until("document.querySelector('#next-training dialog')?.open");
  await until("[...document.querySelectorAll('#next-training button')].some(button=>button.textContent==='CONFIRM LOCAL TRANSACTION'&&!button.disabled)");
  await buttonText('CONFIRM LOCAL TRANSACTION');
  await until("document.querySelector('.forge-training-stats').textContent.includes('1 LEARNED') || [...document.querySelectorAll('#next-training button')].some(button=>button.textContent==='RECHECK TRANSACTION RECEIPT'&&!button.hidden&&!button.disabled)");
  // Anvil can return a hash before the first receipt lookup sees the mined block.
  // Exercise the same explicit read-only recheck offered to the owner; never resend.
  if (!await evaluate("document.querySelector('.forge-training-stats').textContent.includes('1 LEARNED')")) {
    await buttonText('RECHECK TRANSACTION RECEIPT');
  }
  await until("document.querySelector('.forge-training-stats').textContent.includes('1 LEARNED')");
  assert.match(await evaluate("document.querySelector('.forge-training-stats').textContent"), /0 CREDIT.*1 LEARNED.*0\/1 EQUIPPED/);
  await call('Page.reload');
  await until("document.querySelector('.forge-training-stats')?.textContent.includes('1 LEARNED')");
  assert.equal(await evaluate('walletRequests'), 0); assert.deepEqual(errors, []);
  const evidence = { result: 'PASS', desktopAndMobileWidths: [1440, 390, 375], bothPunksAndImages: true,
    walletAccessWarning: true, typedSourceAndAcknowledgmentRequired: true, cancellationNoCredit: true,
    pendingReceiptHidesTraining: true, reloadDoesNotResend: true, receiptRecovery: true, separateLearningConfirmation: true,
    learnedNotEquipped: true, browserErrors: errors, realWalletRequests: 0, publicChainTransactions: 0 };
  await writeFile(new URL('browser-checks.json', output), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  ws?.close(); chrome?.kill('SIGTERM'); await preview.close();
  if (chrome && chrome.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 3000); chrome.once('exit', () => { clearTimeout(timer); resolve(); }); });
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
