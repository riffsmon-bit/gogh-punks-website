import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { CODE as runtimeCode } from '../tests/fixtures/punk-agent-runtime.mjs';

// Actual non-preview Control Center, with only owner-read and HTTP dependencies
// mocked. No wallet bootstrap, public provider, signer or production API is used.
if (process.argv.length !== 3 || process.argv[2] !== '--mock-wallet-only') throw Error('Requires --mock-wallet-only');
const siteRoot = process.env.GOGH_UI_SITE_ROOT ? resolve(process.env.GOGH_UI_SITE_ROOT) : fileURLToPath(new URL('../site/', import.meta.url));
const output = process.env.GOGH_UI_OUTPUT_DIR || '/private/tmp/gogh-final-hardening-ux';
await mkdir(output, { recursive: true });
const sourceFiles = new Map(await Promise.all(['broker/v2/index.html', 'broker-v2.js', 'broker-v2.css', 'assets/nft-placeholder.svg', 'broker-v2-preferences.js', 'broker-v2-amounts.js', 'punk-agent-gas-recovery-panel.js', 'punk-agent-gas-funding.js', 'punk-agent-gas-funding-journal.js', 'broker-v2-forge.js', 'broker-v2-forge.css']
  .map(async path => [path, await readFile(resolve(siteRoot, path))])));
for(const path of (await readdir(siteRoot)).filter(name=>/\.(js|css)$/.test(name)))if(!sourceFiles.has(path))sourceFiles.set(path,await readFile(resolve(siteRoot,path)));
const sourceSha256 = Object.fromEntries([...sourceFiles].map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]));
// Optional local captures of canonical metadata artwork; no network download is
// performed by this harness. Without captures, existing repo images prove only
// distinct-image rendering, not the on-chain metadata identity of #235 or #241.
const artManifest = process.env.GOGH_COLLECTION_ARTWORK_FIXTURES
  ? JSON.parse(await readFile(process.env.GOGH_COLLECTION_ARTWORK_FIXTURES, 'utf8')) : null;
const imagePaths = artManifest?.images ?? {
  '235': { path: resolve(siteRoot, 'assets/collection/7.png'), source: 'repository display fixture' },
  '241': { path: resolve(siteRoot, 'assets/collection/13.png'), source: 'repository display fixture' },
  '1599': { path: resolve(siteRoot, 'assets/collection/38.png'), source: 'repository display fixture' },
};
const imageFixtures = new Map();
for (const tokenId of ['235', '241', '1599']) {
  const item = imagePaths[tokenId];
  assert.ok(item && typeof item.path === 'string', `Missing artwork fixture ${tokenId}`);
  assert.ok(['.png', '.webp', '.jpg', '.jpeg', '.svg'].includes(extname(item.path)), 'Unsupported artwork fixture');
  const bytes = await readFile(item.path);
  imageFixtures.set(`/__collection-art/${tokenId}`, { bytes, type: extname(item.path) === '.svg' ? 'image/svg+xml' : extname(item.path) === '.webp' ? 'image/webp' : /\.jpe?g$/.test(item.path) ? 'image/jpeg' : 'image/png',
    sha256: createHash('sha256').update(bytes).digest('hex'), source: item.source });
}
assert.notEqual(imageFixtures.get('/__collection-art/235').sha256, imageFixtures.get('/__collection-art/241').sha256, 'Owned artwork fixtures must differ');
const rosterArtwork = Object.fromEntries(['235', '241'].map(id => {
  const item = imageFixtures.get('/__collection-art/' + id);
  return [id, `data:${item.type};base64,${item.bytes.toString('base64')}`];
}));

const bridge = String.raw`
import { AGENT_RECOVERY_PINS as uxPins, agentRecoveryProxyRuntime as uxProxy } from './punk-agent-recovery.js';
const uxRuntimeCode=__RUNTIME_CODE_JSON__;
const uxOwnerA = '0x1111111111111111111111111111111111111111';
const uxOwnerB = '0x2222222222222222222222222222222222222222';
const uxTarget = '0xb73f1d1aee57410d537d87b656e98b9d3df5b213';
const uxOriginalFetch = window.fetch.bind(window), uxPlans = [], uxPending = new Map(), uxRequests = [];
const uxRosterArt = __ROSTER_ARTWORK_JSON__, uxArtworkPending = [];
let uxOwner = uxOwnerA, uxRequestSequence = 0, uxWalletCalls = 0, uxHoldArtwork = true;
const uxApiHistory=[],uxApiLog=[],uxRpcLog=[],uxChatPlans=[],uxLinkPlans=[],uxHeld=new Map(); let uxHeldId=0, uxProviderUnavailable=sessionStorage.getItem('ux-provider-unavailable')==='true'; let uxBalance='30000000000000000'; let uxWethFailure=false, uxWethHold=false; const uxWethPending=[]; let uxRosterIds=['93','235','241','4999'];
let uxRequireSession = false, uxSignatures = 0, uxSessionPreparations = 0, uxProfileFailure = false, uxProfileFailures = 0;
const uxAccount = tokenId => '0x' + String(tokenId).padStart(40, '0');
const uxHolding = (tokenId = '1599', name = 'pre-reveal') => ({
  chainId: 4663, tokenId, collection: uxTarget, standard: 'ERC721', amount: '1',
  artwork: tokenId === '1599' ? { name, imageUrl: '/__collection-art/1599' } : { name, imageUrl: null },
  ownershipStatus: 'LIVE_VERIFIED', custodyType: 'PUNK_AGENT_ACCOUNT', provenance: 'V2', acquisitionType: 'PAID_MINT',
  mintCostWei: tokenId === '1599' ? '100000000000000' : null, acquiredAt: '2026-09-13T16:00:00Z',
  withdrawControlUrl: '/broker/v2/?tab=fund&tokenId=93#agent-recovery',
});
const uxInventory = (tokenId, owner, kind = 'holding') => ({ ok: true, owner, tokenId, chainId: 4663,
  holdings: kind === 'empty' ? [] : [uxHolding(), uxHolding('1600', 'Artwork unavailable #1600')],
  ownershipChecksUnavailable: 0, paidMintHistoryAvailable: true,
  inventoryNote: 'Current custody verified by the controlled UI fixture. No live chain request was made.',
});
const uxResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
window.__GOGH_WALLET_PROVIDER__ = { request: async ({ method, params }) => {
  if (method === 'personal_sign' && uxRequireSession && params?.[0] === 'Loopback sign-in fixture' && params?.[1] === uxOwner) {
    uxSignatures++; return '0x' + 'b'.repeat(130); // In-memory mock only; never a wallet or key.
  }
  uxRpcLog.push({method,params});
  if(method==='eth_chainId')return '0x1237';
  if(method==='eth_accounts')return [uxOwner];
  if(method==='eth_getBalance')return params[0]===uxOwner?'0xde0b6b3a7640000':'0x'+BigInt(uxBalance).toString(16);
  if(method==='eth_getTransactionCount')return '0x7';
  if(method==='eth_getCode')return params[0]===uxPins.registry?uxRuntimeCode.registry:params[0]===uxPins.implementation?uxRuntimeCode.implementation:uxProxy(String(state.selected.tokenId),'0x'+'0'.repeat(64));
  if(method==='eth_estimateGas')return '0x10000';
  if(method==='eth_call'){
    const tx=params[0];
    if(tx.to===uxPins.registry&&tx.data==='0x6c74921e')return '0x'+'0'.repeat(64);
    if(tx.to===uxPins.registry)return '0x'+uxAccount(state.selected.tokenId).slice(2).padStart(64,'0');
    if(tx.data==='0x8da5cb5b'||tx.to===COLLECTION)return '0x'+uxOwner.slice(2).padStart(64,'0');
    if(tx.data==='0x')return '0x';
    if(tx.data.startsWith('0x70a08231')){if(uxWethFailure)throw Error('Balance service unavailable');if(uxWethHold)return new Promise(resolve=>uxWethPending.push(resolve));return '0x'+'0'.repeat(64);}
  }
  if(method==='eth_getTransactionByHash'){const saved=JSON.parse(localStorage.getItem('gogh:agent-gas-funding:4663:'+uxOwner+':'+state.selected.tokenId));return {...saved.transaction,hash:params[0],input:saved.transaction.data};}
  if(method==='eth_getTransactionReceipt')return {transactionHash:params[0],blockHash:'0x'+'a'.repeat(64),blockNumber:'0x100',status:'0x1'};
  if(method==='eth_getBlockByNumber')return {number:'0x100',hash:'0x'+'a'.repeat(64)};
  if(method==='eth_blockNumber')return '0x120';
  uxWalletCalls++; throw Error('UI fixture denies every write/provider method');
} };
window.fetch = async (resource, options) => {
  const url = new URL(typeof resource === 'string' ? resource : resource.url, location.origin);
  if (url.origin !== location.origin) throw Error('External fetch denied by collection UI fixture');
  if(url.pathname.startsWith('/api/')){const entry={path:url.pathname,method:options?.method??'GET',body:options?.body?JSON.parse(options.body):null,at:performance.now()};uxApiLog.push(entry);uxApiHistory.push(entry);}
  if(url.pathname==='/api/v2/providers')return uxResponse({ok:true,providers:uxProviderUnavailable?[]:[{provider:'GEMINI',health:{ok:true}},{provider:'OPENAI',health:{ok:true}},{provider:'ANTHROPIC',health:{ok:false}},{provider:'ARBITRARY',health:{ok:true}}]});
  const chatMatch=/^\/api\/v2\/punks\/(\d+)\/chat$/.exec(url.pathname);
  if(chatMatch){const plan=uxChatPlans.shift()??{kind:'success'},body=JSON.parse(options.body);if(plan.kind==='strategy')return uxResponse({ok:true,responseKind:'STRATEGY_DRAFT',reply:'Review these exact limits before they change.',draft:{version:1,state:'DRAFT',intent:{schema:'PUNK_COLLECTING_INTENT_V1',version:1,chainId:4663,punkTokenId:chatMatch[1],expectedOwner:uxOwner,punkWallet:uxAccount(chatMatch[1]),operatingMode:'ASSIST',mintMode:'PAID_UP_TO_LIMIT',maxMintPriceWei:'1',maxGasPerMintWei:'1',minimumReserveWei:'1',dailyMintLimit:1,totalMintLimit:1,maximumCollectionSupply:null,preferences:{prefer:['PIXEL_ART'],avoid:[]},requiresWebsite:false,requiresSocial:false,preferredSocialPlatforms:[],allowedContracts:[]}}}); if(plan.kind==='delay')return new Promise(resolve=>uxHeld.set(++uxHeldId,{resolve,kind:'chat',tokenId:chatMatch[1],owner:uxOwner,body}));if(plan.kind==='error'||uxProviderUnavailable)return uxResponse({ok:false,message:'The selected model is unavailable. Choose another in Settings or try again.'},503);return uxResponse({ok:true,responseKind:'CONVERSATION',draft:null,reply:plan.reply??'I can help compare pixel artwork and review your collecting rules.',providerAvailable:true,provider:{provider:body.providerPreference==='AUTO'?'GEMINI':body.providerPreference}});}
  if(url.pathname==='/api/v2/inspect-url'){const plan=uxLinkPlans.shift()??{kind:'success'};if(plan.kind==='delay')return new Promise(resolve=>uxHeld.set(++uxHeldId,{resolve,kind:'link',owner:uxOwner}));if(plan.kind==='error')return uxResponse({ok:false,message:'The project could not be checked.'},503);if(plan.kind==='contract')return uxResponse({ok:true,inspection:{link:{kind:'ROBINHOOD_CONTRACT',identity:uxTarget},status:'NEEDS_REVIEW',evidence:{chainId:4663,source:'ROBINHOOD_MAINNET_RPC',contract:uxTarget,anchor:{canonicalRechecked:true,blockNumber:'60000000',blockHash:'0x'+'a'.repeat(64)},contractInspection:{codeHash:'0x'+'b'.repeat(64),codeBytes:45,chainId:4663,contract:uxTarget,blockNumber:'60000000',blockHash:'0x'+'a'.repeat(64)},walletAuthority:'NONE',executionAuthorized:false,mint:{status:'OBSERVED',standard:'SEADROP_PUBLIC',priceWei:'1',publicWindow:'OPEN',walletLimit:'1',totalMinted:'1599',maxSupply:'2000'}}}});return uxResponse({ok:true,inspection:{link:{kind:'PROJECT_WEBSITE',url:JSON.parse(options.body).url},status:'NEEDS_REVIEW'}});}
  const forgeMatch=/^\/api\/v2\/punks\/(\d+)\/forge$/.exec(url.pathname);
  if(forgeMatch){const profile={status:'VERIFIED_READ_ONLY',verified:true,tokenId:forgeMatch[1],owner:uxOwner,collection:COLLECTION,registry:uxPins.registry,progression:uxPins.registry,blockHash:'0x'+'a'.repeat(64),blockNumber:'60000000',blockTime:Date.now(),trainingCredits:'0',unlockedSlots:3,claimedStartingSlots:3,slotCap:7,learnedSkills:[],equippedSkills:[],ownership:'ORIGINAL_NFT',walletAuthority:'NONE',canLearn:false,canEquip:false,canBurn:false,effectiveMcpTools:[]};return uxResponse({ok:true,tokenId:forgeMatch[1],owner:uxOwner,chainId:4663,mode:'READ_ONLY_RESEARCH_LAB',walletAuthority:'NONE',canBurn:false,canLearn:false,canEquip:false,labAvailable:true,marketAvailable:false,profile});}
  if (url.pathname === '/api/broker/owner-punks') {
    const owner = url.searchParams.get('owner');
    return uxResponse({ ok: true, owner, chainId: 4663, collection: COLLECTION,
      candidateTokenIds: uxRosterIds, candidatePunks: uxRosterIds.map(tokenId => ({ tokenId,
        artwork: null,
        agentSummary: { account: uxAccount(tokenId) } })) });
  }
  if (url.pathname === '/api/broker/punk-artwork') {
    const ids = url.searchParams.get('tokenIds').split(',');
    const payload = { ok: true, chainId: 4663, collection: COLLECTION,
      artworks: ids.map(tokenId => ({ tokenId, artwork: uxRosterArt[tokenId] ? { imageUrl: uxRosterArt[tokenId], name: 'Gogh Punk #' + tokenId } : null })) };
    if (uxHoldArtwork) return new Promise(resolve => uxArtworkPending.push(() => resolve(uxResponse(payload))));
    return uxResponse(payload);
  }
  if (url.pathname === '/api/v2/session') {
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.action === 'prepare') { uxSessionPreparations++; return uxResponse({ ok: true, challenge: { challengeId: 'loopback', message: 'Loopback sign-in fixture' } }); }
      if (body.action === 'complete' && body.signature === '0x' + 'b'.repeat(130)) { uxRequireSession = false; return uxResponse({ ok: true }); }
      throw Error('Unexpected session fixture action');
    }
    if (uxRequireSession) return uxResponse({ ok: false, code: 'V2_SESSION_REQUIRED' }, 401);
    return uxResponse({ ok: true, walletAddress: uxOwner });
  }
  const collectionMatch = /^\/api\/v2\/punks\/(\d+)\/collection$/.exec(url.pathname);
  if (collectionMatch) {
    const tokenId = collectionMatch[1], owner = uxOwner, plan = uxPlans.shift() ?? { kind: tokenId === '93' ? 'holding' : 'empty' };
    const record = { id: ++uxRequestSequence, tokenId, owner, plan: plan.kind, settled: false }; uxRequests.push(record);
    if (plan.kind === 'delay') return new Promise(resolve => uxPending.set(record.id, { record, resolve }));
    record.settled = true;
    if (plan.kind === 'error') return uxResponse({ ok: false, message: plan.message ?? 'Collection inventory temporarily unavailable.' }, 503);
    return uxResponse(uxInventory(tokenId, owner, plan.kind));
  }
  const profileMatch = /^\/api\/v2\/punks\/(\d+)$/.exec(url.pathname);
  if (profileMatch) {
    if (uxProfileFailure) { uxProfileFailure = false; uxProfileFailures++; return uxResponse({ ok: false, message: 'Profile statistics unavailable.' }, 503); }
    return uxResponse({ ok: true, profile: { tokenId: profileMatch[1], owner: uxOwner,
      punkWallet: uxAccount(profileMatch[1]), nativeBalanceWei: uxBalance, collectionCount: 9, strategy: null } });
  }
  if (/^\/api\/v2\/punks\/\d+\/agent-account$/.test(url.pathname)) {const tokenId=url.pathname.split('/')[4];return uxResponse({ok:true,tokenId,owner:uxOwner,runtime:{accountCreated:true,account:uxAccount(tokenId),owner:uxOwner,nativeBalance:'1000000000000000',entryPointDeposit:'0'},readiness:{ready:false,blockers:[]}});}
  if (/^\/api\/v2\/punks\/\d+\/activity$/.test(url.pathname)) return uxResponse({ ok: true, entries: [] });
  if (url.pathname.startsWith('/api/')) throw Error('Unexpected API request: ' + url.pathname);
  return uxOriginalFetch(resource, options);
};
window.__collectionUx = {
  ownerA: uxOwnerA, ownerB: uxOwnerB, requests: uxRequests,failWeth:value=>uxWethFailure=value,holdWeth:()=>uxWethHold=true,wethHeld:()=>uxWethPending.length,releaseWeth:()=>{uxWethHold=false;uxWethPending.splice(0).forEach(resolve=>resolve('0x'+'0'.repeat(64)));}, apiLog:uxApiLog,apiHistory:uxApiHistory,rpcLog:uxRpcLog,
  chatPlan:kind=>uxChatPlans.push({kind}),linkPlan:kind=>uxLinkPlans.push({kind}),held:()=>[...uxHeld].map(([id,v])=>({id,kind:v.kind})),
  settleHeld:(id,error=false,label='STALE')=>{const held=uxHeld.get(id);uxHeld.delete(id);held.resolve(error?uxResponse({ok:false,message:label},503):uxResponse(held.kind==='chat'?{ok:true,responseKind:'CONVERSATION',draft:null,reply:label,providerAvailable:true,provider:{provider:'GEMINI'}}:{ok:true,inspection:{link:{kind:label,url:'https://example.com'},status:'NEEDS_REVIEW'}}));},
  seedFunding:status=>{const saved={schema:'GOGH_AGENT_GAS_FUNDING_JOURNAL_V1',owner:uxOwner,tokenId:String(state.selected.tokenId),status,transaction:{chainId:'0x1237',nonce:'0x7',from:uxOwner,to:uxAccount(state.selected.tokenId),value:'0x1',data:'0x'},transactionHash:status==='SUBMITTED'?'0x'+'b'.repeat(64):null,receipt:null};localStorage.setItem('gogh:agent-gas-funding:4663:'+uxOwner+':'+state.selected.tokenId,JSON.stringify(saved));gasFundingRecovery.refresh();},
  clearFunding:()=>{localStorage.removeItem('gogh:agent-gas-funding:4663:'+uxOwner+':'+state.selected.tokenId);gasFundingRecovery.refresh();},
  providerUnavailable:value=>{uxProviderUnavailable=value;sessionStorage.setItem('ux-provider-unavailable',String(value));},
  balance:value=>{uxBalance=value;state.hydratedTokenId=null;},largeRoster:()=>{uxRosterIds=['93','235','241','4999',...Array.from({length:136},(_,n)=>String(1000+n))];},emptyRoster:()=>uxRosterIds=[],

  get walletCalls() { return uxWalletCalls; },
  get signatures() { return uxSignatures; }, get sessionPreparations() { return uxSessionPreparations; }, get profileFailures() { return uxProfileFailures; },
  requireSession: () => uxRequireSession = true,
  failNextProfile: () => { uxProfileFailure = true; state.hydratedTokenId = null; },
  queue: (kind, message) => uxPlans.push({ kind, message }),
  pending: () => [...uxPending.keys()],
  releaseArtwork: () => { uxHoldArtwork = false; uxArtworkPending.splice(0).forEach(resolve => resolve()); },
  settle: (id, kind = 'holding', label = null) => {
    const held = uxPending.get(id); if (!held) throw Error('Unknown delayed request'); uxPending.delete(id); held.record.settled = true;
    if (kind === 'error') held.resolve(uxResponse({ ok: false, message: label ?? 'STALE COLLECTION ERROR' }, 503));
    else { const payload = uxInventory(held.record.tokenId, held.record.owner, kind);
      if (label && payload.holdings.length) payload.holdings[0].artwork.name = label; held.resolve(uxResponse(payload)); }
  },
  connect: (owner,chainId=4663) => { uxOwner = owner; window.dispatchEvent(new CustomEvent('gogh:wallet-state', { detail: { account: owner, chainId, status: owner?'owner':'disconnected' } })); },
  selected: () => ({ tokenId: state.selected?.tokenId, owner: state.wallet?.account, verifiedRosterOwner: state.ownershipAccount }),
};
`.replace('__ROSTER_ARTWORK_JSON__', JSON.stringify(rosterArtwork)).replace('__RUNTIME_CODE_JSON__',JSON.stringify(runtimeCode));

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    const artwork = imageFixtures.get(path);
    if (artwork) { res.writeHead(200, { 'content-type': artwork.type }); res.end(artwork.bytes); return; }
    if (path === '/broker-v2-ownership.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('export async function verifyOwnedPunkIds(_provider,_collection,_owner,ids){return {tokenIds:[...ids]};}'); return;
    }
    if (path.startsWith('/api/')) throw Error('API request escaped the browser fixture');
    const relative = path === '/broker/v2/' ? 'broker/v2/index.html' : path.slice(1);
    const filename = resolve(siteRoot, relative);
    if (!filename.startsWith(resolve(siteRoot) + sep)) throw Error('Invalid site path');
    let bytes = sourceFiles.get(relative) ?? await readFile(filename);
    if (relative === 'broker/v2/index.html') bytes = bytes.toString().replace(/\s*<script src="\/wallet\.js[^>]*><\/script>/, '');
    if (relative === 'broker-v2.js') bytes = bytes.toString().replace(/\nsetup\(\);?\s*$/, '\n'+bridge+'\nsetup();');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(filename)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'content-security-policy': "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'" });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp('/private/tmp/gogh-collection-browser-');
const chrome = spawn(process.env.GOGH_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--no-proxy-server', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
const errors = [], externalRequests = [], screenshots = [], observations = [], findings = []; const scenarios=[];
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('CHROME_TIMEOUT')), 20000); chrome.once('error', reject);
    chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const page = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error('CDP_TIMEOUT ' + method)); }, 20000);
    pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params, allowed = request.url.startsWith(origin + '/') || request.url.startsWith('data:');
      if (!allowed) externalRequests.push(request.url);
      void call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(error => errors.push(error.message));
    }
    const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result); }
  };
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  const until = async expression => { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(`UI_TIMEOUT ${expression} ${JSON.stringify(errors)}`); };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const enter = async () => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 80));
  const shot = async (name, selector) => { if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start',behavior:'instant'})`);
    await pause(); const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = `${output}/${name}.png`; await writeFile(path, Buffer.from(result.data, 'base64')); screenshots.push(path); };
  const inspect = async (name, width) => {
    const result = await evaluate(`({innerWidth,scrollWidth:document.documentElement.scrollWidth,
      overflowElements:[...document.querySelectorAll('[data-selected-stage] *')].filter(e=>e.getClientRects().length&&(e.getBoundingClientRect().right>${width}||e.getBoundingClientRect().width>${width})).slice(0,30).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,80),width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,whiteSpace:getComputedStyle(e).whiteSpace})),
      cards:document.querySelectorAll('.gallery-item').length,
      count:document.querySelector('[data-gallery-count]').textContent,
      smallFieldText:[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select,textarea')].filter(e=>e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>({tag:e.tagName,name:e.name||e.id,fontSize:getComputedStyle(e).fontSize})),
      smallTargets:[...document.querySelectorAll('button,input:not([type=checkbox]):not([type=radio]),select,textarea')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,text:e.textContent.trim().slice(0,55)||e.getAttribute('name')||e.getAttribute('id'),height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})).filter(e=>e.height<40||e.width<24),
      unnamed:[...document.querySelectorAll('input,select,textarea')].filter(e=>e.getClientRects().length&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>e.outerHTML)})`);
    observations.push({ name, width, ...result }); if(result.innerWidth!==width)findings.push({severity:'P2',name,issue:'Mobile viewport expanded',width,innerWidth:result.innerWidth});
    if(result.scrollWidth>width)findings.push({severity:'P2',name,issue:'Page horizontal overflow',width,scrollWidth:result.scrollWidth}); if(width<600&&result.smallFieldText.length)findings.push({severity:'P2',name,issue:'Mobile field text below 16px',width,fields:result.smallFieldText}); if(result.smallTargets.length)findings.push({severity:'P2',name,issue:'Standalone controls below 40px target height',width,targets:result.smallTargets}); if(result.unnamed.length)findings.push({severity:'P2',name,issue:'Unnamed visible inputs',fields:result.unnamed});
  };
  const collectionText = () => evaluate('document.querySelector("[data-v2-panel=collection]").textContent');
  const pendingId = async () => { await until('window.__collectionUx.pending().length>0'); return evaluate('window.__collectionUx.pending().at(-1)'); };
  const settle = (id, kind, label = null) => evaluate(`window.__collectionUx.settle(${id},${JSON.stringify(kind)},${JSON.stringify(label)})`);
  const refresh = '[data-collection-refresh]';
  await call('Page.enable'); await call('Runtime.enable'); await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const initialStart=performance.now();
  await call('Page.navigate',{url:origin+'/broker/v2/?tokenId=93'});await until('Boolean(window.__collectionUx)');
  observations.push({name:'first-usable-disconnected-shell',elapsedMs:performance.now()-initialStart});await shot('landing-1440','.roster-stage');
  await evaluate('window.__collectionUx.connect(window.__collectionUx.ownerA);window.__collectionUx.releaseArtwork()');
  await until('document.querySelectorAll(".roster-slot").length===4&&document.querySelector("[data-selected-stage]").hidden===false');
  observations.push({name:'connected-roster-and-selected-shell',elapsedMs:performance.now()-initialStart});
  await until('document.querySelector("#provider-setting").options.length===3');
  assert.equal(await evaluate('document.querySelector("[data-broker-welcome]").hidden'),false);
  scenarios.push('welcome-needs-no-funding');
  for(const width of [1440,1280,768,430,375,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:width<600?850:1000,deviceScaleFactor:1,mobile:width<600});
    await inspect('welcome',width);await shot('welcome-'+width,'[data-broker-welcome]');
    for(const tab of ['talk','strategy','fund','collection','activity','forge','settings']){
      const before=performance.now();await click('[data-v2-tab='+tab+']');await pause();
      if(tab==='collection'&&width===1440){await until('document.querySelector("[data-collection-weth]").textContent!=="CHECKING…"');assert.match(await evaluate('document.querySelector("[data-collection-weth]").textContent'),/0\.0+ WETH/);scenarios.push('production-collection-loads-weth-balance');}
      observations.push({name:'panel-change',tab,width,elapsedMs:performance.now()-before});
      await inspect(tab,width);await shot(tab+'-'+width,'[data-v2-panel='+tab+']');
    }
  }
  await evaluate('window.__collectionUx.holdWeth()');await click('[data-v2-tab=fund]');await click('[data-v2-tab=collection]');await until('window.__collectionUx.wethHeld()>0');assert.equal(await evaluate('window.__collectionUx.wethHeld()'),1);await evaluate('window.__collectionUx.releaseWeth()');await until('document.querySelector("[data-collection-weth]").textContent.includes("WETH")');scenarios.push('fund-collection-balance-reads-coalesce');
  await evaluate('window.__collectionUx.failWeth(true)');await click('[data-collection-refresh]');await until('document.querySelector("[data-collection-weth]").textContent==="UNAVAILABLE"');assert.equal(await evaluate('document.querySelector("[data-collection-eth]").textContent'),'UNAVAILABLE');await shot('balance-unavailable-320','.collection-assets');
  await until('!document.querySelector("[data-collection-refresh]").disabled');await evaluate('window.__collectionUx.failWeth(false)');await click('[data-collection-refresh]');await until('document.querySelector("[data-collection-weth]").textContent.includes("WETH")');scenarios.push('weth-failure-and-explicit-refresh-recovery');
  await click('[data-v2-tab=settings]');
  await evaluate('document.querySelector("#provider-setting").value="OPENAI";document.querySelector("#provider-setting").dispatchEvent(new Event("change",{bubbles:true}))');
  await click('[data-welcome-dismiss]');
  assert.equal(await evaluate('document.querySelector("[data-broker-welcome]").hidden'),true);
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("gogh-v2-preferences:4663:"+window.__collectionUx.ownerA)).provider'),'OPENAI');
  const send=async message=>{await evaluate('document.querySelector("#punk-prompt").value='+JSON.stringify(message)+';document.querySelector("[data-chat-form]").requestSubmit()');};
  const chatText=()=>evaluate('document.querySelector("[data-conversation]").textContent');
  await click('[data-v2-tab=talk]');await send('Tell me a little about pixel art.');
  await until('!document.querySelector("[data-chat-form]").hasAttribute("aria-busy")');
  assert.equal(await evaluate('window.__collectionUx.apiLog.filter(r=>r.path.endsWith("/chat")).at(-1).body.providerPreference'),'OPENAI');
  assert.match(await chatText(),/compare pixel artwork/);scenarios.push('selected-provider-body-and-reply');
  await evaluate('window.__collectionUx.chatPlan("strategy")');await send('Build a paid pixel art strategy with a one wei price, gas cap and reserve.');await until('document.querySelector("[data-confirmation-dialog]").open');
  const review=await evaluate('Object.fromEntries([...document.querySelectorAll("[data-confirmation-grid]>div")].map(n=>[n.querySelector("span").textContent,n.querySelector("b").textContent]))');
  for(const key of ['MINT PRICE','MAX GAS','MINIMUM RESERVE'])if(!review[key]?.includes('0.000000000000000001'))findings.push({severity:'P1',name:'strategy-exact-limits',issue:'Nonzero approval limit is not displayed accurately',key,value:review[key]});
  await shot('strategy-confirmation-320','[data-confirmation-dialog]');await click('[data-edit-strategy]');await until('!document.querySelector("[data-confirmation-dialog]").open');scenarios.push('strategy-draft-exact-limits-edit-without-authority');
  const held=async kind=>{await until('window.__collectionUx.held().some(v=>v.kind==='+JSON.stringify(kind)+')');return evaluate('window.__collectionUx.held().find(v=>v.kind==='+JSON.stringify(kind)+').id');};
  for(const outcome of ['success','error']){
    await evaluate('window.__collectionUx.chatPlan("delay")');await send('Please explain painterly pixel styles.');const pending=await held('chat');
    await click('.roster-slot[data-token-id="235"]');await until('window.__collectionUx.selected().tokenId==="235"');
    await evaluate('window.__collectionUx.settleHeld('+pending+','+(outcome==='error')+',"OLD_CHAT_'+outcome+'")');await pause();
    assert.doesNotMatch(await chatText(),/OLD_CHAT_/);assert.equal(await evaluate('document.querySelector("[data-chat-form]").hasAttribute("aria-busy")'),false);
    await click('.roster-slot[data-token-id="93"]');await until('window.__collectionUx.selected().tokenId==="93"');
    scenarios.push('stale-chat-'+outcome+'-ignored');
  }
  for(const outcome of ['success','error']){
    await evaluate('window.__collectionUx.chatPlan("delay")');await send('Please discuss a landscape palette.');const pending=await held('chat');
    await evaluate('window.__collectionUx.connect(window.__collectionUx.ownerB)');await until('window.__collectionUx.selected().verifiedRosterOwner===window.__collectionUx.ownerB');
    await evaluate('window.__collectionUx.settleHeld('+pending+','+(outcome==='error')+',"OLD_OWNER_'+outcome+'")');await pause();assert.doesNotMatch(await chatText(),/OLD_OWNER_/);
    await evaluate('window.__collectionUx.connect(window.__collectionUx.ownerA)');await until('window.__collectionUx.selected().verifiedRosterOwner===window.__collectionUx.ownerA');scenarios.push('stale-owner-chat-'+outcome+'-ignored');
  }
  await evaluate('window.__collectionUx.chatPlan("error")');await send('Describe luminous blue palettes.');
  await until('!document.querySelector("[data-chat-form]").hasAttribute("aria-busy")');
  assert.equal(await evaluate('document.querySelector("#punk-prompt").value'),'Describe luminous blue palettes.');assert.match(await chatText(),/try again/i);scenarios.push('chat-error-preserves-retry-message');
  await click('[data-show-link]');
  const scan=async()=>evaluate('document.querySelector("#mint-link").value="https://example.com/project";document.querySelector("[data-link-form]").requestSubmit()');
  for(const outcome of ['success','error']){
    await evaluate('window.__collectionUx.linkPlan("delay")');await scan();const pending=await held('link');
    assert.equal(await evaluate('document.querySelector("[data-link-form]").getAttribute("aria-busy")'),'true');
    await click('.roster-slot[data-token-id="241"]');await until('window.__collectionUx.selected().tokenId==="241"');
    await evaluate('window.__collectionUx.settleHeld('+pending+','+(outcome==='error')+',"OLD_LINK_'+outcome+'")');await pause();
    assert.doesNotMatch(await evaluate('document.querySelector("[data-link-result]").textContent'),/OLD_LINK_/);assert.doesNotMatch(await chatText(),/OLD_LINK_/);
    await click('.roster-slot[data-token-id="93"]');await until('window.__collectionUx.selected().tokenId==="93"');scenarios.push('stale-link-'+outcome+'-ignored');
  }
  await scan();await until('!document.querySelector("[data-link-form]").hasAttribute("aria-busy")');assert.match(await evaluate('document.querySelector("[data-link-result]").textContent'),/NEEDS REVIEW/);scenarios.push('link-current-result-clear');await shot('link-result-320','[data-link-form]');
  await evaluate('window.__collectionUx.linkPlan("contract")');await scan();await until('document.querySelector(".link-findings")!==null');assert.match(await chatText(),/0\.000000000000000001 ETH/);assert.match(await chatText(),/Full review still needed/);assert.match(await chatText(),/Not run/);await inspect('link-contract-evidence',320);await shot('link-contract-evidence-320','.link-findings');scenarios.push('observed-link-card-exact-price-and-no-safety-pass');
  await click('[data-v2-tab=fund]');await evaluate('window.__collectionUx.apiLog.length=0;window.__collectionUx.rpcLog.length=0;document.querySelector("#agent-gas-source").value="OWNER";document.querySelector("#agent-gas-amount").value="0.0005";document.querySelector("[data-agent-gas-confirm]").checked=true;document.querySelector("[data-agent-gas-form]").requestSubmit()');
  await until('!document.querySelector("[data-agent-gas-form] button[type=submit]").disabled');
  assert.match(await evaluate('document.querySelector("[data-agent-gas-result]").textContent'),/SIMULATION PASSED/);
  const fundCalls=await evaluate('window.__collectionUx.apiLog');assert.equal(fundCalls.some(r=>r.path.endsWith('/fund')||r.path.includes('withdrawal-status')),false);scenarios.push('owner-gas-funding-review-skips-v3');
  assert.equal(await evaluate('window.__collectionUx.walletCalls'),0);
  await evaluate('window.__collectionUx.seedFunding("WALLET_REQUESTED")');
  assert.equal(await evaluate('document.querySelector("[data-funding-recover]").hidden'),false);await shot('funding-missing-result-320','[data-funding-recover]');
  await evaluate('document.querySelector("[data-funding-recover] input").value="0x"+"b".repeat(64);document.querySelector("[data-funding-recover]").requestSubmit()');
  await until('document.querySelector("[data-funding-state]").textContent.includes("confirmed")');scenarios.push('saved-funding-hash-recovery-without-broadcast');
  await evaluate('window.__collectionUx.seedFunding("SUBMITTED")');await click('[data-funding-recheck]');await until('document.querySelector("[data-funding-state]").textContent.includes("confirmed")');scenarios.push('saved-funding-recheck-without-broadcast');
  await inspect('saved-funding-recovery',320);
  await evaluate('window.__collectionUx.clearFunding()');
  await evaluate('window.__collectionUx.balance("1")');await click('[data-v2-tab=strategy]');await until('document.querySelector("[data-punk-balance]").textContent.includes("0.000000000000000001")');await click('[data-v2-tab=fund]');await inspect('one-wei-balance',320);await shot('one-wei-fund-320','.fund-layout');scenarios.push('one-wei-visible-without-rounding-to-zero');
  await click('[data-v2-tab=forge]');await click('[data-forge-connect]');await until('!document.querySelector("[data-forge-connect]").disabled');
  assert.match(await evaluate('document.querySelector("[data-forge-profile-summary]").textContent'),/0\/3 EQUIPPED/);scenarios.push('verified-forge-loadout-empty-slots');
  await shot('forge-verified-320','[data-forge-slots]');
  await evaluate('window.__collectionUx.connect(window.__collectionUx.ownerB)');await until('window.__collectionUx.selected().verifiedRosterOwner===window.__collectionUx.ownerB');
  assert.equal(await evaluate('document.querySelector("#provider-setting").value'),'AUTO');assert.equal(await evaluate('document.querySelector("[data-broker-welcome]").hidden'),false);scenarios.push('owner-preferences-isolated');
  await evaluate('window.__collectionUx.connect(window.__collectionUx.ownerA)');await until('window.__collectionUx.selected().verifiedRosterOwner===window.__collectionUx.ownerA');
  assert.equal(await evaluate('document.querySelector("#provider-setting").value'),'OPENAI');assert.equal(await evaluate('document.querySelector("[data-broker-welcome]").hidden'),true);scenarios.push('returning-owner-preferences-retained');
  assert.equal(await evaluate('window.__collectionUx.walletCalls'),0);const firstSessionApi=await evaluate('window.__collectionUx.apiHistory');
  await evaluate('window.__collectionUx.providerUnavailable(true)');
  await call('Page.reload',{ignoreCache:true});await until('Boolean(window.__collectionUx)');await evaluate('window.__collectionUx.connect(window.__collectionUx.ownerA);window.__collectionUx.releaseArtwork()');await until('window.__collectionUx.selected().verifiedRosterOwner===window.__collectionUx.ownerA');
  await click('[data-v2-tab=settings]');await until('document.querySelector("[data-provider-status]").textContent.includes("unavailable")');
  assert.equal(await evaluate('document.querySelector("#provider-setting").value'),'OPENAI');assert.equal(await evaluate('document.querySelector("#provider-setting").selectedOptions[0].disabled'),true);
  assert.equal(await evaluate('document.querySelector("[data-broker-welcome]").hidden'),true);await shot('saved-provider-unavailable-320','[data-v2-panel=settings]');
  await click('[data-v2-tab=talk]');await send('Please compare jewel tone pixel art.');await until('!document.querySelector("[data-chat-form]").hasAttribute("aria-busy")');assert.equal(await evaluate('window.__collectionUx.apiLog.filter(r=>r.path.endsWith("/chat")).at(-1).body.providerPreference'),'OPENAI');scenarios.push('saved-unavailable-provider-does-not-silently-switch');
  await evaluate('window.__collectionUx.largeRoster();window.__collectionUx.connect(window.__collectionUx.ownerB)');const largeStart=performance.now();await until('document.querySelectorAll(".roster-slot").length===140');observations.push({name:'140-punk-mocked-roster-shell',elapsedMs:performance.now()-largeStart});await inspect('large-roster',320);await shot('large-roster-320','.roster-stage');
  await evaluate('document.querySelector(".roster-slot[data-token-id=\\"93\\"]").focus()');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  assert.equal(await evaluate('document.activeElement.classList.contains("roster-slot")&&document.activeElement.dataset.tokenId!=="93"'),true);scenarios.push('many-punk-roster-keyboard-navigation');
  await evaluate('window.__collectionUx.emptyRoster();window.__collectionUx.connect(window.__collectionUx.ownerA)');await until('window.__collectionUx.selected().verifiedRosterOwner===window.__collectionUx.ownerA&&document.querySelectorAll(".roster-slot").length===0');assert.equal(await evaluate('document.querySelector("[data-selected-stage]").hidden'),true);await shot('no-owned-punks-320','.roster-stage');scenarios.push('empty-owner-roster-hides-previous-punk');
  assert.equal(await evaluate('window.__collectionUx.walletCalls'),0);assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
  const report={status:findings.some(f=>['P0','P1'].includes(f.severity))?'FAIL':findings.length?'NEEDS_POLISH':'PASS',siteRoot,sourceSha256,scope:'Actual candidate UI with mocked ownership, RPC, model and HTTP. No production wallet, AI latency or funding execution proof.',widths:[1440,1280,768,430,375,320],artworkFixtures:Object.fromEntries([...imageFixtures].map(([path,item])=>[path,{sha256:item.sha256,source:item.source}])),scenarios,findings,observations,screenshots,externalRequests,errors,realWalletCalls:0,publicTransactions:0,mockRpcCalls:await evaluate('window.__collectionUx.rpcLog'),apiRequests:[...firstSessionApi,...await evaluate('window.__collectionUx.apiHistory')]};
  await writeFile(output+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,scenarios,findings,output,screenshots:screenshots.length}));
  assert.equal(report.status,'PASS','Final UI review contains unresolved findings; inspect report.json');
} finally {
  await writeFile(`${output}/observations.json`, JSON.stringify({ errors, externalRequests, observations, screenshots }, null, 2) + '\n');
  ws?.close(); chrome.kill('SIGTERM');
  if (chrome.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 3000); chrome.once('exit', () => { clearTimeout(timer); resolve(); }); });
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }); await new Promise(resolve => server.close(resolve));
}
