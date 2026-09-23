import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSwarmPlan,swarmCommand,mountSwarm} from '../site/broker-swarm.js';
import {resolveV2PunkChat} from '../netlify/functions/broker-v2-chat.mjs';
import {defaultAskIntent} from '../broker/src/v4/collecting-intent.mjs';
const owner=`0x${'1'.repeat(40)}`,wallet=`0x${'2'.repeat(40)}`,target=`0x${'3'.repeat(40)}`,hash=`0x${'a'.repeat(64)}`;
const options={mode:'SEARCH',target:'',daily:'5',total:'5'};
const input={owner,chainId:4663,tokenIds:['93','94'],ownedTokenIds:['93','94'],options};
test('swarm accounts for aggregate limits and does not authorize or merge Punk funds',()=>{
 const plan=buildSwarmPlan(input);assert.equal(plan.dailyMaximum,10);assert.equal(plan.totalMaximum,10);
 assert.deepEqual(plan.rows.map(r=>r.status),['QUEUED','QUEUED']);assert.equal(plan.rows[0].intentHash,null);
});
test('keep-hunting swarm counts 100 per Punk, restores those limits, and leaves permissions queued',()=>{
 const plan=buildSwarmPlan({...input,options:{...options,duration:'KEEP_HUNTING'}});
 assert.equal(plan.options.total,'100');assert.equal(plan.dailyMaximum,10);assert.equal(plan.totalMaximum,200);
 assert.ok(plan.rows.every(r=>r.status==='QUEUED'&&r.intentHash===null));
 const restored=buildSwarmPlan({...plan,tokenIds:plan.rows.map(r=>r.tokenId),ownedTokenIds:input.ownedTokenIds});
 assert.equal(restored.command,plan.command);assert.equal(restored.totalMaximum,200);
 assert.throws(()=>buildSwarmPlan({...input,options:{...options,duration:'FOREVER'}}));
 assert.throws(()=>buildSwarmPlan({...input,options:{...options,duration:'FIXED',total:'100'}}));
});
for(const patch of [{chainId:1},{owner:null},{tokenIds:[]},{tokenIds:['93','93']},{tokenIds:['95']},{tokenIds:['0']},{tokenIds:Array.from({length:11},(_,i)=>String(i+1))},{options:{...options,total:'unlimited'}},{options:{...options,mode:'PAID'}},{options:{...options,mode:'DIRECTED',target:'https://bad.example'}}])test(`invalid swarm ${JSON.stringify(patch)}`,()=>assert.throws(()=>buildSwarmPlan({...input,...patch})));
for(const mode of ['SEARCH','DIRECTED'])test(`${mode} swarm compiles through real resolver with per-Punk limits and no AI`,async()=>{
 const now=new Date(),currentIntent={...defaultAskIntent({punkTokenId:'93',expectedOwner:owner,punkWallet:wallet},now),allowedContracts:[wallet],blockedContracts:[`0x${'4'.repeat(40)}`]};
 const result=await resolveV2PunkChat({ownerMessage:swarmCommand({...options,mode,target}),tokenId:'93',owner,authority:{punkWallet:wallet},currentIntent,now,router:{run:()=>{throw Error('No AI');}}});
 assert.equal(result.responseKind,'STRATEGY_DRAFT');assert.equal(result.draft.state,'PENDING_OWNER_CONFIRMATION');
 const x=result.draft.intent;assert.deepEqual(x.allowedContracts,mode==='SEARCH'?[]:[target]);assert.equal(x.dailyMintLimit,5);assert.equal(x.totalMintLimit,5);assert.equal(x.operatingMode,'AUTONOMOUS');assert.equal(x.mintMode,'FREE_ONLY');
 for(const key of ['minimumReserveWei','maxGasPerMintWei','blockedContracts','preferences','requireSimulation'])assert.deepEqual(x[key],currentIntent[key]);
});
class Node {
 constructor(tag,doc){this.localName=tag;this.ownerDocument=doc;this.children=[];this.listeners={};this.classList={add(){}};this.value='';}
 set textContent(v){this.text=v;this.children=[];}get textContent(){return(this.text??'')+this.children.map(x=>x.textContent).join('');}
 append(...xs){this.children.push(...xs);if(this.localName==='select'&&!this.value)this.value=xs[0].value;}
 replaceChildren(){this.children=[];this.text='';}setAttribute(){}addEventListener(k,f){this.listeners[k]=f;}
 click(){if(!this.disabled)this.listeners.click?.();}
}
const walk=n=>[n,...n.children.flatMap(walk)];
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));};
function fixture(){
 const doc={createElement:tag=>new Node(tag,doc)},root=new Node('section',doc),values=new Map();let context={owner,chainId:4663},punks=[{tokenId:'93'},{tokenId:'94'}],opens=0,failSave=false;
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{if(failSave)throw Error('No space');values.set(k,v);},removeItem:k=>values.delete(k)};
 const config={root,getContext:()=>context,getPunks:()=>punks,storage,openReview:async({tokenId})=>{opens++;return{intentHash:hash,intent:{punkTokenId:tokenId,expectedOwner:owner}};},openStatus:()=>{}};
 let panel=mountSwarm(config);
 const button=text=>walk(root).find(n=>n.localName==='button'&&n.textContent===text);
 function create(){for(const n of walk(root).filter(n=>n.localName==='input'&&n.type==='checkbox')){n.checked=true;n.listeners.change();}walk(root).find(n=>n.localName==='form').listeners.submit({preventDefault(){}});}
 return{root,values,config,create,button,get opens(){return opens;},get panel(){return panel;},failSave:()=>{failSave=true;},remount(){panel=mountSwarm(config);},switchOwner(){context={owner:wallet,chainId:4663};punks=[];panel.refresh();},removePunk(){punks=[{tokenId:'94'}];panel.refresh();}};
}
test('batch is passive, reviews one Punk at a time, and never starts the next after authorization',async()=>{
 const f=fixture();f.create();assert.equal(f.opens,0);f.button('REVIEW PUNK #93').click();await settle();assert.equal(f.opens,1);
 f.panel.authorization({tokenId:'93',intentHash:hash},'AUTHORIZING');assert.equal(f.button('REVIEW PUNK #94').disabled,true);
 f.panel.authorization({tokenId:'93',intentHash:hash},'AUTHORIZED');assert.equal(f.opens,1);assert.equal(f.button('REVIEW PUNK #94').disabled,false);
 f.button('REVIEW PUNK #94').click();await settle();assert.equal(f.opens,2);
});
test('reload turns pending authorization into status check and cannot replay it',async()=>{
 const f=fixture();f.create();f.button('REVIEW PUNK #93').click();await settle();f.panel.authorization({tokenId:'93',intentHash:hash},'AUTHORIZING');
 f.remount();assert.equal(f.button('REVIEW PUNK #93'),undefined);assert.equal(f.opens,1);assert.match(f.root.textContent,/Check status before continuing/);
});
test('wallet switch during draft preparation discards stale response and grants nothing',async()=>{
 const f=fixture();let done;f.config.openReview=()=>new Promise(r=>{done=r;});f.remount();f.create();f.button('REVIEW PUNK #93').click();await settle();f.switchOwner();done({intentHash:hash,intent:{punkTokenId:'93',expectedOwner:owner}});await settle();
 assert.equal(f.button('REVIEW PUNK #93'),undefined);assert.ok(!f.root.textContent.includes('Mission authorized'));
});
test('transferred Punk and failed progress storage cannot open a new review',async()=>{
 const f=fixture();f.create();f.removePunk();assert.equal(f.button('REVIEW PUNK #93').disabled,true);
 f.failSave();f.button('REVIEW PUNK #94').click();await settle();assert.equal(f.opens,0);
});
test('keep-hunting planner shows contract ceilings and aggregate limits before any Punk review',()=>{
 const f=fixture(),duration=walk(f.root).find(n=>n.name==='duration'),total=walk(f.root).find(n=>n.name==='total');
 duration.value='KEEP_HUNTING';duration.listeners.change();assert.equal(total.disabled,true);
 f.create();assert.equal(f.opens,0);assert.match(f.root.textContent,/200 total/);assert.match(f.root.textContent,/100 mints or 30 days/);assert.match(f.root.textContent,/renewal is never automatic/);
 f.remount();assert.equal(f.opens,0);assert.match(f.root.textContent,/200 total/);
});
test('a throwing browser sessionStorage getter disables only Swarm without crashing the Control Center',()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 const doc={createElement:tag=>new Node(tag,doc)},root=new Node('section',doc);let opened=0;
 try{
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw Error('SecurityError: storage access denied');}});
  let panel;assert.doesNotThrow(()=>{panel=mountSwarm({root,getContext:()=>({owner,chainId:4663}),getPunks:()=>[{tokenId:'93'}],openReview:()=>{opened++;},openStatus:()=>{}});});
  assert.match(root.textContent,/browser cannot save progress/);assert.match(root.textContent,/individual Punk controls/);
  assert.equal(walk(root).filter(n=>n.localName==='form').length,0);
  assert.doesNotThrow(()=>panel.refresh());assert.equal(opened,0);
 }finally{if(original)Object.defineProperty(globalThis,'sessionStorage',original);else delete globalThis.sessionStorage;}
});
