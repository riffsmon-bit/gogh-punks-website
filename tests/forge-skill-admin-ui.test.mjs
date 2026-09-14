import test from 'node:test';import assert from 'node:assert/strict';
import{createForgeSkillAdminPanel,validateSkillAdminWalletReview}from'../site/forge-skill-admin-panel.js';
import{createSkillAdminCoordinator}from'../broker/src/v4/skill-forge/skill-admin-coordinator.mjs';
import{skillAdminFixture,ADMIN,KEY,TX}from'./fixtures/skill-admin.mjs';
class Element{constructor(tag,doc){this.localName=tag;this.ownerDocument=doc;this.childNodes=[];this.listeners={};this.attributes={};}
set textContent(value){this.text=String(value);this.childNodes=[];}get textContent(){return(this.text??'')+this.childNodes.map(n=>n.textContent).join('');}
append(...nodes){this.childNodes.push(...nodes);}replaceChildren(...nodes){this.text='';this.childNodes=nodes;}setAttribute(k,v){this.attributes[k]=v;}
addEventListener(k,v){this.listeners[k]=v;}click(){if(!this.disabled)this.listeners.click?.();}}
const walk=node=>[node,...node.childNodes.flatMap(walk)];
const settled=async(predicate)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('UI did not settle');};
function setup(t){const f=skillAdminFixture(),coordinator=createSkillAdminCoordinator(f),values=new Map(),requests=[];let sends=0,signIns=0,loseClaim=false,failStorage=false,holdSession=null;
  let selected={owner:ADMIN,chainId:4663,preview:false},walletOwner=ADMIN;
  const document={createElement:tag=>new Element(tag,document)},root=new Element('section',document);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(failStorage)throw Error('Storage unavailable');values.set(key,value);},removeItem:key=>values.delete(key)};
  const request=async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;requests.push(body?.operation??'get');
    if(!body){const id=new URL(path,'https://goghpunks.xyz').searchParams.get('id');return{ok:true,...await coordinator.get({administrator:selected.owner,...(id?{id}:{})})};}
    if(body.operation==='claim')assert.ok([...values.values()].some(value=>JSON.parse(value).attempted));
    const{operation,...input}=body;const result=await coordinator[operation]({administrator:selected.owner,...input});
    if(operation==='claim'&&loseClaim){loseClaim=false;throw Error('Claim acknowledgement lost');}return{ok:true,...result};};
  const options={root,getSelection:()=>selected,ensureSession:async()=>{signIns++;if(holdSession)await holdSession;},request,storage,
    getProvider:()=>({request:async({method,params})=>{if(method==='eth_accounts')return[walletOwner];if(method==='eth_chainId')return'0x1237';
      assert.equal(method,'eth_sendTransaction');assert.equal(f.row.status,'WALLET_REQUESTED');assert.equal(params[0].data,f.preparation.transaction.data);sends++;f.skill.registeredStatus=0;return TX;}})};
  let panel=createForgeSkillAdminPanel(options);t.after(()=>panel.destroy());
  return{f,root,values,requests,panel,text:()=>root.textContent,button:label=>walk(root).find(n=>n.localName==='button'&&n.textContent===label),
    sends:()=>sends,signIns:()=>signIns,loseClaim:()=>{loseClaim=true;},failStorage:()=>{failStorage=true;},holdSession:value=>{holdSession=value;},
    select:owner=>{selected={...selected,owner};panel.update();},wallet:owner=>{walletOwner=owner;},
    remount(){panel.destroy();panel=createForgeSkillAdminPanel(options);this.panel=panel;return panel;}};
}
const review=async f=>{f.button('RECHECK SKILL RELEASES').click();await settled(()=>!!f.button('REVIEW NEXT REGISTRY STEP'));f.button('REVIEW NEXT REGISTRY STEP').click();await settled(()=>!!f.button('CONFIRM REGISTRY STEP IN WALLET'));};
test('mount is idle, explicit review is clear, wallet request is single and confirmed result follows real reconciliation',async t=>{
  const f=setup(t);assert.equal(f.requests.length,0);assert.equal(f.sends(),0);assert.equal(f.signIns(),0);await review(f);
  assert.match(f.text(),/Social Scout/);assert.match(f.text(),/Maximum network fee/);assert.match(f.text(),/No ETH is sent/);
  f.button('CONFIRM REGISTRY STEP IN WALLET').click();await settled(()=>f.f.row?.status==='CONFIRMED');await settled(()=>f.text().includes('Registry step confirmed'));
  assert.equal(f.sends(),1);f.remount();await f.panel.refresh();assert.equal(f.sends(),1);
});
test('lost claim acknowledgement persists uncertainty and reload never requests wallet again',async t=>{
  const f=setup(t);await review(f);f.loseClaim();f.button('CONFIRM REGISTRY STEP IN WALLET').click();await settled(()=>f.text().includes('acknowledgement lost'));
  assert.equal(f.sends(),0);assert.equal(f.f.row.status,'WALLET_REQUESTED');f.remount();await f.panel.refresh();
  assert.ok(f.button('RECOVER ORIGINAL TRANSACTION'));assert.equal(f.sends(),0);assert.equal(f.requests.filter(v=>v==='claim').length,1);
});
test('storage failure blocks prepare and any wallet request',async t=>{const f=setup(t);f.button('RECHECK SKILL RELEASES').click();await settled(()=>f.button('REVIEW NEXT REGISTRY STEP'));
  f.failStorage();f.button('REVIEW NEXT REGISTRY STEP').click();await settled(()=>f.text().includes('Storage unavailable'));assert.equal(f.sends(),0);assert.equal(f.requests.includes('prepare'),false);});
test('wallet mismatch blocks claim and account round trip during sign-in blocks stale action',async t=>{
  const f=setup(t);await review(f);f.wallet(`0x${'2'.repeat(40)}`);f.button('CONFIRM REGISTRY STEP IN WALLET').click();await settled(()=>f.text().includes('Wallet selection changed'));
  assert.equal(f.requests.includes('claim'),false);assert.equal(f.sends(),0);
  let release;f.holdSession(new Promise(r=>{release=r;}));f.wallet(ADMIN);f.button('CONFIRM REGISTRY STEP IN WALLET').click();
  f.select(`0x${'2'.repeat(40)}`);f.select(ADMIN);release();await new Promise(r=>setTimeout(r,15));assert.equal(f.sends(),0);assert.equal(f.requests.includes('claim'),false);
});
test('browser independently rejects recipient, data, value and fee changes',()=>{
  const f=skillAdminFixture(),record={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',administrator:ADMIN,registry:f.state.registry,key:KEY,action:'REGISTER',status:'PREPARED',preparation:f.preparation};
  assert.deepEqual(validateSkillAdminWalletReview(record,f.state,ADMIN),f.preparation.transaction);
  for(const patch of[{to:`0x${'2'.repeat(40)}`},{value:'0x1'},{data:'0x'},{gasPrice:'0xffffffffffffffff'},{chainId:'0x1'}]){
    const changed=structuredClone(record);Object.assign(changed.preparation.transaction,patch);assert.throws(()=>validateSkillAdminWalletReview(changed,f.state,ADMIN));
  }
});
test('non-administrator read cannot reveal another saved wallet review',async t=>{const f=setup(t);await review(f);f.select(`0x${'2'.repeat(40)}`);await f.panel.refresh();
  assert.equal(f.text().includes('Social Scout'),false);assert.equal(f.sends(),0);});
