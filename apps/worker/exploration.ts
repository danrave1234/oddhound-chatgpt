import {createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {MetaAdapter,type Action} from '@oddhound/agent';import {getPool,event} from '@oddhound/db';import type {BrowserObservation} from '@oddhound/contracts';
import {reserveCall,settleCall,unknownCall,admitAction,actionResult} from '../../packages/db/budget';
import {saveObservation} from '../../packages/db/artifacts';import {explore,type EngineScope} from './engine';

export type ExplorationBrowser={call:<T>(method:string,data?:unknown)=>Promise<T>;observe:()=>Promise<BrowserObservation>;execute:(action:Exclude<Action,{name:'finish_run'}>,key:string)=>Promise<BrowserObservation>};
export async function runExploration(input:{id:string;generation:number;scope:EngineScope;browser:ExplorationBrowser;signal:AbortSignal;fence:()=>Promise<void>;sanitize:(text:string)=>string;inputPrice:number;outputPrice:number;afterObservation?:(value:BrowserObservation,action?:Action)=>Promise<void>}){
  const {id,generation,scope,browser,signal,fence,sanitize,inputPrice,outputPrice}=input;
  const save=async(raw:BrowserObservation,action?:Action)=>{
    const result=await saveObservation(id,raw),clean=JSON.parse(sanitize(JSON.stringify(result))) as BrowserObservation;
    await input.afterObservation?.(clean,action);return clean;
  };
  await explore(scope,{model:new MetaAdapter(process.env.META_API_KEY??''),signal,inputPrice,outputPrice,
    reserve:bound=>reserveCall(id,generation,bound),settle:async(call,actual,usage)=>{await settleCall(id,call,actual,usage);await event(id,'model.usage','Meta usage recorded.',{actualMicros:actual,...usage});},unknown:call=>unknownCall(id,call),
    checkFence:async()=>{await fence();await browser.call('ready');},sanitize,
    observe:async()=>{await fence();const value=await save(await browser.observe());await event(id,'browser.observation','Browser state captured.',value);return value;},
    execute:async(action,key)=>{
      await delay(1050,undefined,{signal});await admitAction(id,generation,key,JSON.parse(sanitize(JSON.stringify(action))));await fence();
      try{
        const clean=await save(await browser.execute(action,key),action);
        await actionResult(id,key,clean);await event(id,'browser.action',`Browser action observed: ${action.name}.`,{action:action.name,key,...clean});return clean;
      }catch(error){
        const code=(error as Error).message,refused=['stale_or_unknown_target','frame_action_refused','credential_reference_required','credential_scope_refused','registration_namespace_required','registration_identity_limit','action_rate_limited','tool_scope_refused','browser_busy','actor_not_granted','credential_not_granted'];
        if(refused.includes(code)){await actionResult(id,key,{refused:code});throw error;}
        await event(id,'action.outcome_unknown','The browser action outcome is uncertain. Exploration is fenced; the action will not be retried.',{key});throw new Error('action_outcome_unknown');
      }
    },
    record:(kind,message,data)=>event(id,kind,sanitize(message),data),
    findings:async candidates=>{for(const c of candidates){const version=createHash('sha256').update(c.rule).digest('hex');await getPool().query("INSERT INTO findings(run_id,title,status,category,severity,rule,observed,evidence,assertion_version) VALUES($1,$2,'candidate','needs_review','info',$3,$4,$5,$6)",[id,c.title,c.rule,c.observation,{source:'meta_candidate',independentlyVerified:false},version]);}}
  });
}
