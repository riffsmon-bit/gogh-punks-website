import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoghIntelligenceRuntime } from '../broker/src/v4/ai/runtime.mjs';
const configured = { GOGH_GROQ_MODEL:'openai/gpt-oss-20b', GROQ_API_KEY:'test-only-key',
  GOGH_GEMINI_MODEL:'test-gemini',GOGH_OPENAI_MODEL:'test-openai',GOGH_ANTHROPIC_MODEL:'test-claude',
  GOGH_XAI_MODEL:'test-grok',GOGH_BANKR_MODEL:'test-bankr',GOGH_AI_COST_MODE:'FREE_ONLY' };
test('free-only route excludes every paid provider even with configured model and explicit preference',async()=>{
 let calls=0;const runtime=createGoghIntelligenceRuntime({environment:configured,fetchImpl:async()=>{calls++;throw Error('Unexpected paid request');}});
 assert.deepEqual(runtime.registry.enabled().map(e=>e.provider),['GROQ']);
 for(const preference of ['OPENAI','ANTHROPIC','XAI','GEMINI','BANKR'])await assert.rejects(runtime.router.run('CHAT',{prompt:'hello'},{preference}),/unavailable/);
 assert.equal(calls,0);
});
test('Groq exhaustion performs one call and never spills into a paid model',async()=>{
 const requests=[];const runtime=createGoghIntelligenceRuntime({environment:configured,fetchImpl:async(url)=>{
 requests.push(url);return new Response('{}',{status:429});}});
 await assert.rejects(runtime.router.run('CHAT',{prompt:'hello'}),/limit/);
 assert.deepEqual(requests,['https://api.groq.com/openai/v1/chat/completions']);
});
test('off and invalid cost policies fail closed before provider network access',async()=>{
 const runtime=createGoghIntelligenceRuntime({environment:{...configured,GOGH_AI_COST_MODE:'OFF'}});
 assert.equal(runtime.registry.enabled().length,0);
 await assert.rejects(runtime.router.run('CHAT',{prompt:'hello'}),/unavailable/);
 assert.throws(()=>createGoghIntelligenceRuntime({environment:{...configured,GOGH_AI_COST_MODE:'cheap'}}),/cost mode/);
});
