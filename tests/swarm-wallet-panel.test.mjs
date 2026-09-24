import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSwarmWallet } from '../site/swarm-wallet-panel.js';
const OWNER=`0x${'1'.repeat(40)}`, OTHER=`0x${'2'.repeat(40)}`, VAULT=`0x${'3'.repeat(40)}`, HASH=`0x${'a'.repeat(64)}`;
class Node {
  constructor(tag, doc) { this.tag=tag; this.ownerDocument=doc; this.children=[]; this.attrs={}; this.listeners={}; this.classList={add(){}}; this.value=''; this.checked=false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=nodes; }
  setAttribute(k,v) { this.attrs[k]=v; }
  addEventListener(k,f) { this.listeners[k]=f; }
  querySelectorAll(tag) { return walk(this).filter(n=>n.tag===tag); }
  scrollIntoView() {}
  click() { if(!this.disabled) this.listeners.click?.(); }
}
const walk=n=>[n,...n.children.flatMap(walk)];
const flush=async()=>{for(let i=0;i<4;i++) await new Promise(r=>setTimeout(r,0));};
function fixture({release={status:'LIVE'},saved=null}={}) {
  const doc={createElement:tag=>new Node(tag,doc)},root=new Node('section',doc),calls=[];
  let context={owner:OWNER,chainId:4663},punks=[{tokenId:'93'},{tokenId:'94'}],record=saved,resolvePrepare,provider={};
  const client={
    getSwarmWalletRecord:()=>record,
    readSwarmWallet:async()=>{calls.push('read');return{created:true,vault:VAULT,balanceWei:'3000000000000000'};},
    prepareSwarmWallet:async(_p,{owner,action})=>{calls.push(['prepare',action]); if(resolvePrepare)await resolvePrepare;
      return{owner,vault:VAULT,action,expiresAt:Date.now()+90000,maximumNetworkFeeWei:'1000',allocations:action.allocations?.map(a=>({...a,account:VAULT}))};},
    submitSwarmWallet:async(_p,review,{isCurrent})=>{assert.equal(isCurrent(),true);calls.push('wallet');record={status:'SUBMITTED',transactionHash:HASH,review};return record;},
    recoverSwarmWallet:async()=>{calls.push('recover');record={...record,status:'CONFIRMED'};return record;},
  };
  const panel=mountSwarmWallet({root,getContext:()=>context,getPunks:()=>punks,getProvider:()=>provider,release,client,storage:{},locks:{}});
  const node=name=>walk(root).find(n=>Object.hasOwn(n.attrs,'data-swarm-wallet-'+name));
  return{root,calls,node,panel,client,get record(){return record;},setPending(p){resolvePrepare=p;},
    replaceProvider(){provider={};panel.refresh();},
    wallet(c){context=c;panel.refresh();},roster(ids){punks=ids.map(tokenId=>({tokenId}));panel.refresh();},
    async click(name){node(name).click();await flush();},async ready(){await this.click('check');},
    select(id){const n=node('punks').querySelectorAll('input').find(n=>n.value===id);n.checked=true;n.listeners.change();},
    consent(){node('consent').checked=true;node('consent').listeners.change();}};
}
test('unreleased wallet is hidden and mount/passive refresh performs no provider operation',()=>{
  const off=fixture({release:null});assert.equal(off.root.hidden,true);assert.deepEqual(off.calls,[]);
  const f=fixture();f.panel.refresh();assert.deepEqual(f.calls,[]);assert.equal(f.node('review').hidden,true);
});
test('batch review splits exact budget, requires separate consent and one explicit wallet confirmation',async()=>{
  const f=fixture();await f.ready();f.select('93');f.select('94');f.node('batch-amount').value='0.003';await f.click('batch');
  const action=f.calls.find(c=>Array.isArray(c)&&c[0]==='prepare')[1];
  assert.deepEqual(action,{kind:'BATCH',allocations:[{tokenId:'93',amountWei:'1500000000000000'},{tokenId:'94',amountWei:'1500000000000000'}]});
  assert.equal(f.node('review').hidden,false);assert.equal(f.node('confirm').disabled,true);assert.equal(f.calls.includes('wallet'),false);
  f.consent();await f.click('confirm');assert.equal(f.calls.filter(c=>c==='wallet').length,1);assert.equal(f.node('review').hidden,true);assert.equal(f.node('recovery').hidden,false);
  await f.click('batch');await f.click('confirm');assert.equal(f.calls.filter(c=>c==='wallet').length,1);
  await f.click('recover');assert.equal(f.record.status,'CONFIRMED');assert.equal(f.calls.filter(c=>c==='wallet').length,1);
});
test('an unknown wallet result restored after reload is recovery-only',async()=>{
  const f=fixture({saved:{status:'WALLET_REQUESTED',transactionHash:null}});await f.ready();
  assert.equal(f.node('deposit').disabled,true);assert.equal(f.node('recovery').hidden,false);
  await f.click('deposit');assert.equal(f.calls.includes('wallet'),false);assert.equal(f.calls.some(c=>Array.isArray(c)),false);
});
test('passive refresh preserves chosen batch, but owner/roster/input change invalidates its review',async()=>{
  const f=fixture();await f.ready();f.select('93');f.node('batch-amount').value='0.001';const original=f.node('punks').children[1];
  f.panel.refresh();assert.equal(f.node('punks').children[1],original);assert.equal(f.node('batch-amount').value,'0.001');
  await f.click('batch');f.roster(['94']);assert.equal(f.node('review').hidden,true);assert.equal(f.node('confirm').disabled,true);
  f.node('deposit-amount').value='0.001';await f.click('deposit');f.node('deposit-amount').value='0.002';f.node('deposit-amount').listeners.input();assert.equal(f.node('review').hidden,true);
  await f.click('deposit');f.wallet({owner:OTHER,chainId:4663});assert.equal(f.node('review').hidden,true);assert.equal(f.node('deposit-amount').value,'');
  assert.equal(f.calls.includes('wallet'),false);
});
test('late preparation after a wallet switch cannot display another owner’s transaction',async()=>{
  const f=fixture();await f.ready();let finish;f.setPending(new Promise(r=>{finish=r;}));f.node('deposit-amount').value='0.001';f.node('deposit').click();await flush();
  f.wallet({owner:OTHER,chainId:4663});finish();await flush();assert.equal(f.node('review').hidden,true);assert.equal(f.calls.includes('wallet'),false);
});
test('replacing provider for the same account invalidates in-flight preparation',async()=>{
  const f=fixture();await f.ready();let finish;f.setPending(new Promise(r=>{finish=r;}));
  f.node('deposit-amount').value='0.001';f.node('deposit').click();await flush();
  f.replaceProvider();finish();await flush();assert.equal(f.node('review').hidden,true);assert.equal(f.calls.includes('wallet'),false);
});
test('unavailable account verification pauses funding while retaining owner withdrawals',async()=>{
  const f=fixture();f.client.readSwarmWallet=async()=>({created:true,vault:VAULT,balanceWei:'3000000000000000',dependenciesVerified:false});
  await f.ready();assert.equal(f.node('deposit').disabled,true);assert.equal(f.node('batch').disabled,true);assert.equal(f.node('withdraw').disabled,false);
  assert.match(f.node('info').textContent,/funding is paused/);
  f.node('withdraw-amount').value='0.003';await f.click('withdraw');assert.equal(f.node('review').hidden,false);
});
test('owner with no remaining Punks can still review unused Swarm ETH withdrawal',async()=>{
  const f=fixture();f.roster([]);await f.ready();
  assert.equal(f.root.hidden,false);assert.equal(f.node('withdraw').disabled,false);
  f.node('withdraw-amount').value='0.003';await f.click('withdraw');
  assert.equal(f.node('review').hidden,false);assert.equal(f.node('confirm').disabled,true);
  assert.deepEqual(f.calls.find(c=>Array.isArray(c)&&c[0]==='prepare')[1],{kind:'WITHDRAW',amountWei:'3000000000000000'});
  assert.equal(f.calls.includes('wallet'),false);
});
test('verified wallet cancellation explains non-delivery and restores owner actions',async()=>{
  const f=fixture({saved:{status:'SUBMITTED',transactionHash:HASH}});await f.ready();
  f.client.recoverSwarmWallet=async()=>({status:'CANCELLED',transactionHash:HASH});
  await f.click('recover');assert.match(f.node('status').textContent,/intended Swarm action did not execute/);
  assert.equal(f.node('recovery').hidden,true);assert.equal(f.node('withdraw').disabled,false);
});
test('recovery surfaces a higher owner-edited mined fee without sending again',async()=>{
  const f=fixture({saved:{status:'SUBMITTED',transactionHash:HASH}});await f.ready();
  f.client.recoverSwarmWallet=async()=>({status:'CONFIRMED',transactionHash:HASH,receipt:{feeExceeded:true,actualNetworkFeeWei:'6000000000000'}});
  await f.click('recover');assert.match(f.node('status').textContent,/above the original review.*0.000006 ETH.*no new transaction/);
  assert.equal(f.calls.includes('wallet'),false);assert.equal(f.node('withdraw').disabled,false);
});
