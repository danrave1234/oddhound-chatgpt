import {test} from 'node:test';import assert from 'node:assert/strict';
import {observationMetadata} from '../packages/db/artifacts';

test('large valid browser metadata is refused even without a screenshot',()=>{
  const observation={url:'https://owned.example/',title:'Synthetic page',text:'x'.repeat(24000),controls:[]};
  assert.deepEqual(observationMetadata(observation),observation);
  const controls=Array.from({length:200},(_,i)=>({target:`c${i}`,role:'combobox',name:'Options',options:Array.from({length:40},()=> 'x'.repeat(100))}));
  assert.throws(()=>observationMetadata({...observation,controls}),/observation_metadata_limit/);
});
