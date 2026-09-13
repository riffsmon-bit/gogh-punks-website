import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {toFunctionSelector} from 'viem';
import artworkHandler from '../netlify/functions/broker-punk-artwork.mjs';
import {createOriginalPunkArtworkEnricher} from '../netlify/functions/_shared/original-punk-artwork.mjs';

// Evaluate the actual browser function bodies without a wallet, browser, or RPC.
// The override permits review from an isolated checkout while the parent owns UI.
const source = await readFile(process.env.DISPLAY_REVIEW_SOURCE_ROOT
  ? resolve(process.env.DISPLAY_REVIEW_SOURCE_ROOT, 'site/broker-v2.js')
  : new URL('../site/broker-v2.js', import.meta.url), 'utf8');
const ownerA = '0x' + '1'.repeat(40), ownerB = '0x' + '2'.repeat(40);
const collection = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
function body(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Source anchors exist: ${start}`);
  return source.slice(from, to);
}
const clean = body('function cleanImage(', 'function describeMatchBlocker(');
const gallery = body('function resetGallery()', 'function renderGallery()');
const load = body('async function loadProductionCollection(', 'async function hydrateSelected(');
const session = body('const sessionRequests = new Map();', 'async function activatePunkAgentMission(');
const art = body('const rosterArtworkCache = new Map();', 'async function fetchOwnedPunks(');
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; }
function context(extra = {}) {
  const sandbox = { URL, PREVIEW:false, CHAIN_ID:4663, COLLECTION:collection,
    location:{origin:'https://goghpunks.com'}, state:{wallet:{account:ownerA,chainId:4663},
      selected:{tokenId:'93'}, punks:[], gallery:[],galleryRequestId:0,galleryLoadingTokenId:null,galleryTokenId:null},
    renderGallery(){}, one(){return null;},all(){return [];},ensureV2Session:async()=>{},
    short:value=>value,ethFromWei:value=>value,dateLabel:value=>value,window:{},...extra};
  vm.createContext(sandbox);return sandbox;
}
const normalized = value => JSON.parse(JSON.stringify(value));
const holding = tokenId => ({tokenId,collection,standard:'ERC721',custodyType:'PUNK_AGENT_ACCOUNT',
  ownershipStatus:'LIVE_VERIFIED',mintCostWei:null,artwork:null,withdrawControlUrl:'/broker/v2/?tab=fund&tokenId=93#agent-recovery'});

test('old collection response cannot populate a different wallet even when the selected token matches', async()=>{
  const response=deferred();const c=context({jsonRequest:()=>response.promise});vm.runInContext(clean+gallery+load,c);
  const pending=c.loadProductionCollection(c.state.selected);await new Promise(setImmediate);
  c.state.wallet={account:ownerB,chainId:4663};c.resetGallery();c.state.gallery=[{title:'current owner data'}];
  response.resolve({holdings:[holding('1599')]});await pending;
  assert.deepEqual(normalized(c.state.gallery),[{title:'current owner data'}]);
  assert.equal(c.state.galleryTokenId,null);
});

test('same-token request generation keeps an older success or failure from replacing a newer response', async()=>{
  for(const failOld of [false,true]){
    const first=deferred(),second=deferred();let reads=0;
    const c=context({jsonRequest:()=>++reads===1?first.promise:second.promise});vm.runInContext(clean+gallery+load,c);
    const old=c.loadProductionCollection(c.state.selected);await new Promise(setImmediate);c.resetGallery();
    const current=c.loadProductionCollection(c.state.selected);await new Promise(setImmediate);
    second.resolve({holdings:[holding('1600')],inventoryComplete:false});await current;
    if(failOld)first.reject(Error('secret RPC response'));else first.resolve({holdings:[holding('1599')]});
    await old;assert.deepEqual(normalized(c.state.gallery.map(item=>item.tokenId)),['1600']);
    assert.equal(c.state.galleryStatus,'ready');assert.equal(c.state.galleryLoadingTokenId,null);
  }
});

test('wallet and chain switches reject pending authentication before a challenge or signature', async()=>{
  for(const change of [c=>{c.state.wallet.account=ownerB;},c=>{c.state.wallet.chainId=1;}]){
    const response=deferred();let reads=0,signatures=0;
    const c=context({jsonRequest:()=>{reads++;return response.promise;},window:{__GOGH_WALLET_PROVIDER__:{request:()=>{signatures++;}}}});
    vm.runInContext(session,c);const pending=c.ensureV2Session();change(c);response.resolve({walletAddress:ownerA});
    await assert.rejects(pending,/current owner/);assert.equal(reads,1);assert.equal(signatures,0);
  }
});

test('concurrent collection and fund session requests share one login signature and clear the pending slot', async()=>{
  const initial=deferred();let gets=0,prepares=0,completes=0,signatures=0;
  const c=context({jsonRequest:async(_url,options={})=>{
    if(!options.method){gets++;return gets===1?initial.promise:{walletAddress:ownerA};}
    const body=JSON.parse(options.body);
    if(body.action==='prepare'){prepares++;return {challenge:{message:'signed login fixture',challengeId:'fixture'}};}
    assert.equal(body.action,'complete');completes++;return {ok:true};
  },window:{__GOGH_WALLET_PROVIDER__:{request:async request=>{
    assert.equal(request.method,'personal_sign');assert.equal(request.params[1],ownerA);signatures++;return 'fixture signature';
  }}}});
  vm.runInContext(session,c);const a=c.ensureV2Session(),b=c.ensureV2Session();initial.resolve({});
  const values=await Promise.all([a,b]);assert.ok(values.every(value=>value.walletAddress===ownerA));
  assert.deepEqual({gets,prepares,completes,signatures},{gets:2,prepares:1,completes:1,signatures:1});
  await c.ensureV2Session();assert.equal(gets,3);assert.equal(signatures,1);
});

test('artwork completion after an account switch does not decorate the new roster or add owner candidates', async()=>{
  const response=deferred();const c=context({jsonRequest:()=>response.promise});vm.runInContext(clean+art,c);
  c.state.punks=[{tokenId:'93',image:null,ownershipVerified:true}];const pending=c.hydrateRosterArtwork();
  c.state.wallet.account=ownerB;c.state.punks=[{tokenId:'93',image:null,ownershipVerified:false}];
  response.resolve({chainId:4663,collection,artworks:[{tokenId:'93',artwork:{imageUrl:'https://i.seadn.io/93.png'}}]});await pending;
  assert.deepEqual(normalized(c.state.punks),[{tokenId:'93',image:null,ownershipVerified:false}]);
});

test('duplicate, foreign-token and foreign-chain artwork responses cannot change the roster', async()=>{
  for(const payload of [
    {chainId:4663,collection,artworks:[{tokenId:'94',artwork:{imageUrl:'https://i.seadn.io/a.png'}}]},
    {chainId:1,collection,artworks:[{tokenId:'93',artwork:{imageUrl:'https://i.seadn.io/a.png'}}]},
    {chainId:4663,collection,artworks:[{tokenId:'93',artwork:{}},{tokenId:'93',artwork:{}}]},
  ]){
    const c=context({jsonRequest:async()=>payload});vm.runInContext(clean+art,c);
    c.state.punks=[{tokenId:'93',image:null,ownershipVerified:true}];await c.hydrateRosterArtwork();
    assert.deepEqual(normalized(c.state.punks),[{tokenId:'93',image:null,ownershipVerified:true}]);
  }
});

test('image URL sanitizer rejects script, hostile origins, gateway traversal, and oversized inline images',()=>{
  const c=context();vm.runInContext(clean,c);
  for(const url of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>',
    'https://i.seadn.io.attacker.invalid/a','https://i.seadn.io@attacker.invalid/a',
    'https://ipfs.io/ipfs/not-a-cid','https://ipfs.io/ipfs/'+'b'.repeat(25)+'/../x',
    'data:image/svg+xml;base64,'+'A'.repeat(256000)])assert.equal(c.cleanImage(url,null),null,url.slice(0,70));
  assert.equal(c.cleanImage('https://i.seadn.io/a.png',null),'https://i.seadn.io/a.png');
});

test('public artwork response contains fixed display identity and no owner authority or cookies',async()=>{
  const enriched=createOriginalPunkArtworkEnricher({client:{getChainId:async()=>4663,readContract:async()=>
    'data:application/json,'+encodeURIComponent(JSON.stringify({name:'<img src=x onerror=alert(1)>',
      image:'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),
      owner:ownerB,ownershipVerified:true,withdrawControlUrl:'javascript:alert(1)'}))}});
  const response=await artworkHandler(new Request('https://example.invalid/api/broker/punk-artwork?tokenIds=5016'),{enrich:enriched});
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.collection,collection);
  assert.equal(response.headers.get('set-cookie'),null);assert.match(response.headers.get('cache-control'),/^public,/);
  assert.deepEqual(Object.keys(body).sort(),['artworks','chainId','collection','complete','ok']);
  assert.deepEqual(Object.keys(body.artworks[0]).sort(),['artwork','tokenId']);
  assert.equal(body.artworks[0].artwork.owner,undefined);assert.equal(body.artworks[0].artwork.ownershipVerified,undefined);
  assert.equal(body.artworks[0].artwork.withdrawControlUrl,undefined);
});

test('artwork accepts deployed maxSupply boundary 5016 and rejects 5017 before any metadata read',async()=>{
  let reads=0;
  const enrich=async values=>{reads++;return values;};
  const accepted=await artworkHandler(new Request('https://example.invalid/api/broker/punk-artwork?tokenIds=5016'),{enrich});
  const rejected=await artworkHandler(new Request('https://example.invalid/api/broker/punk-artwork?tokenIds=5017'),{enrich});
  assert.equal(accepted.status,200);assert.equal(rejected.status,400);assert.equal(reads,1);
  // MAX_SUPPLY() is a distinct deployed constant (10000), not the browser's
  // maxSupply() configured bound (5016); live evidence is in the review report.
  const ownershipSource=await readFile(process.env.DISPLAY_REVIEW_SOURCE_ROOT
    ?resolve(process.env.DISPLAY_REVIEW_SOURCE_ROOT,'site/broker-v2-ownership.js')
    :new URL('../site/broker-v2-ownership.js',import.meta.url),'utf8');
  const selector=ownershipSource.match(/const MAX_SUPPLY = "(0x[0-9a-f]{8})";/)?.[1];
  assert.equal(selector,toFunctionSelector('maxSupply()'));
  assert.notEqual(selector,toFunctionSelector('MAX_SUPPLY()'));
});

test('gallery renders malicious text as text and routes Agent custody only into explicit recovery review',()=>{
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.events={};this.attributes={};}
    append(...children){this.children.push(...children);}replaceChildren(){this.children=[];}
    setAttribute(key,value){this.attributes[key]=value;}addEventListener(key,fn){this.events[key]=fn;}
    set innerHTML(_value){throw Error('HTML injection sink');}
  }
  const grid=new Element('div');let opened=0,tab=null;const entry={...holding('1599'),title:'<img src=x onerror=alert(1)>',
    provenance:'<script>bad()</script>',detail:'fixture',image:'javascript:alert(1)',openSeaUrl:'javascript:alert(1)'};
  const c=context({document:{createElement:tag=>new Element(tag)},one:selector=>selector==='[data-gallery-grid]'?grid:null,
    set(){},activateTab:value=>{tab=value;},agentRecoveryControl:{openAsset:asset=>{assert.equal(asset,entry);opened++;}}});
  vm.runInContext(clean+body('function renderGallery()', 'function activityDetail('),c);
  c.state.galleryStatus='ready';c.state.gallery=[entry];c.renderGallery();assert.equal(opened,0);
  const card=grid.children[0],copy=card.children[1],actions=copy.children[3];
  assert.equal(copy.children[1].textContent,entry.title);assert.equal(card.children[0].src,'/assets/nft-placeholder.svg');
  assert.equal(actions.children.length,1);assert.equal(actions.children[0].tag,'button');
  actions.children[0].events.click();assert.equal(opened,1);assert.equal(tab,'fund');
});
