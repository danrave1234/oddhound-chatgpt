import {setTimeout as delay} from 'node:timers/promises';
import {event} from '@oddhound/db';import {recordSample,type BrowserObservation} from '@oddhound/contracts';import {checkFixedAssertion} from '@oddhound/checks';
import {loadAssertionTask,finishAssertionAttempt} from '../../packages/db/assertions';
import {admitAction,actionResult} from '../../packages/db/budget';import {saveObservation} from '../../packages/db/artifacts';
import type {ExplorationBrowser} from './exploration';

export async function runVerification(input:{id:string;generation:number;namespace:string;browser:ExplorationBrowser;signal:AbortSignal;fence:()=>Promise<void>;sanitize:(text:string)=>string}){
  const {id,generation,browser,signal,fence,sanitize}=input,{spec,hash}=await loadAssertionTask(id);
  const save=async(raw:BrowserObservation)=>{const clean=JSON.parse(JSON.stringify(raw,(_k,v)=>typeof v==='string'?sanitize(v):v));return saveObservation(id,clean);};
  const result=await checkFixedAssertion(spec,{namespace:`${input.namespace}_${id.slice(0,8)}`,fence,
    browser:{observe:async()=>save(await browser.observe()),execute:async(action,key)=>{
      await delay(1050,undefined,{signal});await admitAction(id,generation,key,action);await fence();
      try{const observation=await save(await browser.execute(action,key));await actionResult(id,key,observation);await event(id,'browser.action',`Fixed assertion action observed: ${action.name}.`,{action:action.name,key,...observation});return observation;}
      catch(error){await event(id,'assertion.action_uncertain','Replay stopped without retrying an uncertain action.',{key});throw error;}
    },inspect:async request=>recordSample.parse(await browser.call('inspect_record',request))},
    record:async(phase,sample)=>{await event(id,'assertion.sample','A fresh rendered-record sample was captured.',{phase,...sample});}});
  await fence();await finishAssertionAttempt(id,generation,result);return{...result,hash};
}
