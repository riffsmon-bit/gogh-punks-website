import test from 'node:test';
import assert from 'node:assert/strict';
import {readBrokerPreferences,saveBrokerPreferences,availableProviderPreferences} from '../site/broker-v2-preferences.js';
import {displayEth,displayEthBudget} from '../site/broker-v2-amounts.js';
const owner={owner:'0x'+'11'.repeat(20),chainId:4663};
function store(){const m=new Map();return{getItem:key=>m.get(key)??null,setItem:(key,value)=>m.set(key,value)}}
test('inference preferences are owner and chain scoped and cannot store execution data',()=>{
 const storage=store();saveBrokerPreferences(owner,{provider:'ANTHROPIC',welcomed:true,spend:'ALL'},storage);
 assert.deepEqual(readBrokerPreferences(owner,storage),{provider:'ANTHROPIC',welcomed:true});
 assert.equal(readBrokerPreferences({...owner,owner:'0x'+'22'.repeat(20)},storage).provider,'AUTO');
 assert.equal(readBrokerPreferences({...owner,chainId:1},storage).provider,'AUTO');
 assert.equal(saveBrokerPreferences({...owner,chainId:1},{provider:'XAI'},storage),false);
});
test('blocked or corrupt optional preference storage does not block exploration',()=>{
 const storage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
 assert.deepEqual(readBrokerPreferences(owner,storage),{provider:'AUTO',welcomed:false});
 assert.equal(saveBrokerPreferences(owner,{provider:'XAI'},storage),false);
 assert.equal(readBrokerPreferences(owner,{getItem:()=>'{invalid'}).provider,'AUTO');
});
test('provider metadata only exposes known configured choices, deduplicated',()=>{
 assert.deepEqual(availableProviderPreferences({ok:true,providers:[
 {provider:'OPENAI',health:{ok:true}},{provider:'OPENAI',health:{ok:true}},
 {provider:'XAI',health:{ok:false}},{provider:'EVIL',health:{ok:true}}]}),['AUTO','OPENAI']);
 assert.deepEqual(availableProviderPreferences({ok:false,providers:[{provider:'XAI',health:{ok:true}}]}),['AUTO']);
});
test('small balances and differences remain exact rather than appearing empty',()=>{
 assert.equal(displayEth('1'),'0.000000000000000001');
 assert.equal(displayEth('250925000000000'),'0.000250925');
 assert.equal(displayEthBudget('0.000250925','0.000250924999999999'),'0.000000000000000001');
 assert.equal(displayEthBudget('0.0001','0.0002'),'0.0000');
 assert.equal(displayEthBudget('1.000000000000000001','0.1'),'0.900000000000000001');
});
test('unknown or malformed money is unavailable, never a zero balance',()=>{
 for(const input of [undefined,null,1,'-1','1.2','NaN','01'])assert.equal(displayEth(input),'—');
 assert.equal(displayEthBudget('—','0'),'—');
});
