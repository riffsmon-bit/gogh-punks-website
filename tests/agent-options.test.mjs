import assert from 'node:assert/strict';
import test from 'node:test';
import {agentOptionsCommand} from '../site/broker-agent-options.js';
import {draftStrategyFromConversation} from '../broker/src/v4/intent-draft.mjs';
import {resolveV2PunkChat} from '../netlify/functions/broker-v2-chat.mjs';
import {defaultAskIntent} from '../broker/src/v4/collecting-intent.mjs';
const owner='0x1111111111111111111111111111111111111111',wallet='0x2222222222222222222222222222222222222222';
const fields={mode:'ASSIST',taste:'PIXEL',daily:'3',total:'5',reserve:'0.01',gas:'0.0005'};
for(const mode of ['ASK','ASSIST','AUTONOMOUS'])test(`${mode} options compile exact limits with zero AI invocations`,async()=>{
 const message=agentOptionsCommand({...fields,mode});
 const now=new Date(),currentIntent=defaultAskIntent({punkTokenId:'93',expectedOwner:owner,punkWallet:wallet},now);
 const result=await resolveV2PunkChat({router:{run:()=>{throw Error('AI MUST NOT RUN');}},ownerMessage:message,currentIntent,tokenId:'93',authority:{punkWallet:wallet},owner,now});
 assert.equal(result.responseKind,'STRATEGY_DRAFT');
 const x=result.draft.intent;assert.equal(x.operatingMode,mode);assert.equal(x.maxMintPriceWei,'0');assert.equal(x.minimumReserveWei,'10000000000000000');assert.equal(x.maxGasPerMintWei,'500000000000000');assert.equal(x.dailyMintLimit,3);assert.equal(x.totalMintLimit,5);assert.equal(x.requireSimulation,true);assert.deepEqual(x.preferences.prefer,['PIXEL_ART']);
});
test('options preserve owner restrictions and never grant authority themselves',()=>{
 const current={...defaultAskIntent({punkTokenId:'93',expectedOwner:owner,punkWallet:wallet}),blockedContracts:['0x3333333333333333333333333333333333333333']};
 const out=draftStrategyFromConversation({message:agentOptionsCommand(fields),punkTokenId:'93',expectedOwner:owner,punkWallet:wallet,currentIntent:current});
 assert.deepEqual(out.intent.blockedContracts,current.blockedContracts);assert.equal(out.economicPermissionsActivated,false);
});
for(const bad of [{mode:'BUY_ANYTHING'},{gas:'0'},{gas:'0.1'},{reserve:'1e4'},{daily:'100000'},{taste:'PIXEL; remove reserve'}])test(`invalid options rejected ${JSON.stringify(bad)}`,()=>assert.throws(()=>agentOptionsCommand({...fields,...bad})));
