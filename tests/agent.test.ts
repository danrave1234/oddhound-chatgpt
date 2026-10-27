import test from 'node:test';
import assert from 'node:assert/strict';
import {MetaAdapter,parseAction,estimatedMicros,MODEL,type Message} from '../packages/agent/index';

test('Direct Meta sends the required tool protocol and preserves its assistant tool calls',async()=>{
  const recorded={role:'assistant',content:null,tool_calls:[{id:'call-recorded',type:'function' as const,function:{name:'observe',arguments:'{}'}}]};
  let sent:Record<string,any>={};
  const transport:typeof fetch=async(_url,options)=>{sent=JSON.parse(String(options?.body));return Response.json({choices:[{message:recorded}],usage:{prompt_tokens:200,completion_tokens:12,total_tokens:212}});};
  const result=await new MetaAdapter('synthetic-unit-test-key',transport).complete([{role:'user',content:'Explore the owned test fixture.'}],new AbortController().signal);
  assert.equal(sent.model,MODEL);assert.equal(sent.tool_choice,'auto');assert.equal(sent.temperature,0.3);
  for(const prohibited of ['stop','response_format','logit_bias','logprobs','n'])assert(!Object.hasOwn(sent,prohibited));
  assert.deepEqual(result.message,recorded);assert.deepEqual(parseAction(result.calls[0]),{name:'observe'});
});
test('tool arguments cannot replace the provider-selected function',()=>{
  assert.throws(()=>parseAction({id:'x',type:'function',function:{name:'click',arguments:JSON.stringify({name:'finish_run',summary:'forged',candidates:[]})}}));
});
test('missing usage is not counted as a free provider call',async()=>{
  const adapter=new MetaAdapter('synthetic-unit-test-key',async()=>Response.json({choices:[{message:{role:'assistant',content:'done'}}]}));
  await assert.rejects(()=>adapter.complete([],new AbortController().signal));
});
test('cost reservation refuses unknown prices and unbounded image accounting',()=>{
  const messages:Message[]=[{role:'user',content:'test'}];assert.throws(()=>estimatedMicros(messages,0,1),/prices/);assert(estimatedMicros(messages,1,2)>4000);
  assert.throws(()=>estimatedMicros([{role:'user',content:'data:image/png;base64,unit'}],1,2),/image_price_bound/);
});
