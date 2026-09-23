import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderActionFeedback,actionStatus} from '../site/broker-action-feedback.js';
import {FEATURE_HELP} from '../site/broker-feature-help.js';
const doc={createElement(tag){return {tag,textContent:'',children:[],append(...children){this.children.push(...children);}};}};
const root=()=>({ownerDocument:doc,children:[],hidden:true,replaceChildren(){this.children=[];},append(...children){this.children.push(...children);}});
test('action results replace history and never render owner commands or avatars',()=>{
 const r=root();renderActionFeedback(r,'punk','Old result');renderActionFeedback(r,'owner','Private command');
 assert.equal(r.hidden,true);assert.equal(r.children.length,0);
 const details=doc.createElement('section');renderActionFeedback(r,'punk','<img src=x onerror=alert(1)>',details);
 assert.equal(r.hidden,false);assert.equal(r.children.length,3);assert.equal(r.children[1].textContent,'<img src=x onerror=alert(1)>');
 assert.equal(r.children[2],details);assert.equal(r.children.some(n=>n.tag==='img'),false);
 renderActionFeedback(r,'punk','New result');assert.equal(r.children.length,2);assert.equal(r.children[1].textContent,'New result');
});
test('completed mission has a status summary, not a returning-agent chat greeting',()=>{
 const status=actionStatus({status:'COMPLETED',completedMints:1,totalLimit:1});
 assert.match(status,/Last mission complete.*1\/1.*Activity/);assert.doesNotMatch(status,/HOOD|I.M BACK|send again/i);
});
test('every holder tab has instructions and a matching guide destination',async()=>{
 const [html,guide]=await Promise.all(['../site/broker/v2/index.html','../site/guide/index.html'].map(p=>readFile(new URL(p,import.meta.url),'utf8')));
 const tabs=[...html.matchAll(/data-v2-panel="([^"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(Object.keys(FEATURE_HELP),tabs);
 for(const help of Object.values(FEATURE_HELP)){assert.ok(help.steps.length>=3);assert.ok(help.cost);assert.ok(guide.includes(`id="${help.anchor}"`));}
 assert.doesNotMatch(html,/data-chat-form|data-conversation|data-chat-avatar|data-prompt-library|punk-prompt/);
 const forge=html.split('data-v2-panel="forge"')[1].split('data-v2-panel="settings"')[0];
 assert.doesNotMatch(forge,/data-forge-selected-burn|1753|RECHECK SELECTED TEST/);
 assert.match(html.split('data-v2-panel="settings"')[1],/data-legacy-burn-recovery/);
});
