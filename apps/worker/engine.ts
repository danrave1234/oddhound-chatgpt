import {MetaAdapter,estimatedMicros,parseAction,systemPrompt,type Message,type Action,type Usage} from '@oddhound/agent';
import {limits,type BrowserObservation} from '@oddhound/contracts';

export type Observation=BrowserObservation;
export type EngineScope={origin:string;goal:string;rules:string;writes:boolean;registration:boolean;references:string[]};
export type EngineDependencies={
  model:Pick<MetaAdapter,'complete'>; signal:AbortSignal;
  inputPrice:number;outputPrice:number;
  reserve:(micros:number)=>Promise<string>;settle:(id:string,actual:number,usage:Usage)=>Promise<void>;unknown:(id:string)=>Promise<void>;
  observe:()=>Promise<Observation>;execute:(action:Exclude<Action,{name:'finish_run'}>,key:string)=>Promise<Observation>;
  checkFence:()=>Promise<void>;sanitize:(text:string)=>string;
  record:(kind:string,message:string,data?:Record<string,unknown>)=>Promise<void>;
  findings:(candidates:{title:string;rule:string;observation:string}[])=>Promise<void>;
};
function boundedObservation(value:Observation,sanitize:(s:string)=>string){const text=JSON.stringify(value);if(Buffer.byteLength(text)>64000)throw new Error('observation_limit_exceeded');return sanitize(text).replaceAll('<','\\u003c').replaceAll('>','\\u003e');}
export async function explore(scope:EngineScope,d:EngineDependencies){
  const initial=await d.observe();
  const messages:Message[]=[{role:'system',content:systemPrompt(scope.origin,d.sanitize(scope.goal),d.sanitize(scope.rules))+`\nAUTHORIZED CAPABILITIES: ${JSON.stringify({writes:scope.writes,registration:scope.registration,credentialReferences:scope.references})}`},{role:'user',content:`Begin exploratory testing.\n<untrusted_observation>${boundedObservation(initial,d.sanitize)}</untrusted_observation>`}];
  let actions=0;
  for(let turn=0;turn<limits.turns;turn++){
    d.signal.throwIfAborted();await d.checkFence();
    if(turn>=limits.turns-5)messages.push({role:'user',content:`Trusted runtime budget: ${limits.turns-turn} model turns remain. Preserve partial evidence and finish with finish_run before the limit; do not claim untested coverage.`});
    const reserved=estimatedMicros(messages,d.inputPrice,d.outputPrice),id=await d.reserve(reserved);
    let reply:Awaited<ReturnType<MetaAdapter['complete']>>;
    try{reply=await d.model.complete(messages,d.signal);const actual=Math.ceil(reply.usage.prompt_tokens*d.inputPrice+reply.usage.completion_tokens*d.outputPrice);await d.settle(id,actual,reply.usage);}
    catch(error){await d.unknown(id);throw error;}
    // Replay the exact assistant response, including its original tool_calls.
    messages.push(reply.message);await d.record('model.reply','Meta returned a response.',{turn:turn+1,toolCalls:reply.calls.length});
    if(!reply.calls.length){messages.push({role:'user',content:'Choose an available tool. Finish with finish_run when exploration is complete.'});continue;}
    for(let i=0;i<reply.calls.length;i++){
      await d.checkFence();d.signal.throwIfAborted();const call=reply.calls[i];
      let result:string;
      try{
        const action=parseAction(call);
        if(action.name==='finish_run'){
          const candidates=action.candidates.map(c=>({title:d.sanitize(c.title),rule:d.sanitize(c.rule),observation:d.sanitize(c.observation)}));
          await d.findings(candidates);await d.record('exploration.finished',d.sanitize(action.summary),{candidates:candidates.length});return;
        }
        if(actions>=limits.actions)throw new Error('action_limit_reached');
        const observation=await d.execute(action,`${turn+1}-${i+1}`);actions++;
        result=`<untrusted_observation>${boundedObservation(observation,d.sanitize)}</untrusted_observation>`;
      }catch(error){const code=(error as Error).message;if(['run_fenced','run_expired','action_limit_reached','action_outcome_unknown','network_budget_exhausted','artifact_budget_exhausted','browser_control_failed','browser_connection_lost','browser_response_limit','invalid_screenshot','screenshot_digest_mismatch','artifact_integrity_failed'].includes(code))throw error;result=JSON.stringify({error:/^[a-z0-9_]+$/.test(code)?code:'action_failed'});}
      messages.push({role:'tool',tool_call_id:call.id,content:result});
    }
  }
  throw new Error('model_turn_limit_reached');
}
