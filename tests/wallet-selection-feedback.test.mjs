import assert from 'node:assert/strict';
import test from 'node:test';
import { setupReadOnlyWallet,setupReownWallet } from '../site/wallet.js';

for(const setup of [setupReadOnlyWallet,setupReownWallet])test(`${setup.name}: broker selection echoes terminate and real changes still publish`,async()=>{
  const listeners=new Map(),button={dataset:{},addEventListener(){},removeEventListener(){},setAttribute(){}};
  let events=0,feedback=null;
  const win={CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
    addEventListener(type,listener){listeners.set(type,listener);},removeEventListener(type){listeners.delete(type);},
    dispatchEvent(event){
      if(event.type==='gogh:wallet-state'){
        events++;
        // Reproduce the broker's notification on wallet-state. The cap makes a
        // broken implementation fail an assertion instead of recursing forever.
        if(feedback && events<20)listeners.get('gogh:punk-selected')?.({detail:feedback});
      }
      return true;
    }};
  const controller=await setup({windowObject:win,sessionFactory:()=>{throw Error('NO_AUTOMATIC_SESSION');},
    documentObject:{querySelectorAll:selector=>selector==='[data-wallet-connect]'?[button]:[]}});
  await controller.ready;
  feedback={owner:null,tokenId:null};let before=events;
  listeners.get('gogh:punk-selected')({detail:feedback});assert.equal(events,before);
  feedback={owner:`0x${'1'.repeat(40)}`,tokenId:'93'};
  listeners.get('gogh:punk-selected')({detail:feedback});assert.equal(events,before+1);
  assert.equal(win.__GOGH_WALLET_SNAPSHOT__.owner.tokenId,'93');
  before=events;feedback={owner:null,tokenId:null};
  listeners.get('gogh:punk-selected')({detail:feedback});assert.equal(events,before+1);
  assert.equal(win.__GOGH_WALLET_SNAPSHOT__.owner,null);controller.destroy();
});
