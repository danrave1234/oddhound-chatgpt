import {createHash} from 'node:crypto';
import {fixedAssertion,recordSample,type FixedAssertion,type RecordSample,type BrowserAction,type BrowserObservation,type AssertionResult} from '@oddhound/contracts';

export function assertionHash(value:unknown){return createHash('sha256').update(JSON.stringify(fixedAssertion.parse(value))).digest('hex');}
export function evaluateRecordEvidence(a:FixedAssertion,control:RecordSample,probe:RecordSample,controlAfter:RecordSample):AssertionResult{
  const controlValid=(s:RecordSample)=>s.guardObserved&&s.recordCount===1&&s.value===a.control;
  const validUrl=(s:RecordSample)=>{try{const url=new URL(s.url);return url.origin===a.origin&&url.pathname===a.readPath;}catch{return false;}};
  if(![control,probe,controlAfter].every(validUrl))return{status:'inconclusive',reason:'assertion_evidence_origin_mismatch',control,probe,controlAfter};
  if(!controlValid(control)||!controlValid(controlAfter))return{status:'inconclusive',reason:'valid_control_not_preserved',control,probe,controlAfter};
  if(!probe.guardObserved||probe.recordCount>1||probe.recordCount===1&&probe.value===null)return{status:'inconclusive',reason:'record_evidence_ambiguous',control,probe,controlAfter};
  const violates=probe.recordCount===1&&(probe.value!<a.bounds.min||probe.value!>a.bounds.max||a.bounds.integer&&!Number.isInteger(probe.value));
  return{status:violates?'failed':'passed',reason:violates?'rendered_record_contradicts_rule':'probe_satisfies_rule_with_valid_control',control,probe,controlAfter};
}
type Browser={observe:()=>Promise<BrowserObservation>;execute:(action:Exclude<BrowserAction,{name:'finish_run'}>,key:string)=>Promise<BrowserObservation>;inspect:(request:unknown)=>Promise<RecordSample>};
export async function checkFixedAssertion(value:unknown,d:{browser:Browser;namespace:string;fence:()=>Promise<void>;record?:(phase:string,sample:RecordSample)=>Promise<void>}):Promise<AssertionResult>{
  const a=fixedAssertion.parse(value);if(!/^[a-z0-9_-]{3,100}$/.test(d.namespace))throw new Error('invalid_assertion_binding');
  let observation:BrowserObservation,sequence=0;
  const perform=async(action:Exclude<BrowserAction,{name:'finish_run'}>)=>{await d.fence();observation=await d.browser.execute(action,`assertion-${++sequence}`);if(observation.blocked)throw new Error('assertion_action_refused');};
  const resolve=(locator:{role:string;name:string})=>{const matches=observation.controls.filter(c=>c.role===locator.role&&c.name===locator.name);if(matches.length!==1)throw new Error(matches.length?'assertion_locator_ambiguous':'assertion_locator_missing');return matches[0].target;};
  const navigate=async(path:string)=>perform({name:'navigate',url:a.origin+path});
  const inspect=async(label:string,phase:string)=>{await d.fence();const sample=recordSample.parse(await d.browser.inspect({...a.record,heading:a.heading,anchor:`${d.namespace}_${label}`}));await d.record?.(phase,sample);return sample;};
  const controlValid=(s:RecordSample)=>s.guardObserved&&s.recordCount===1&&s.value===a.control;
  const create=async(label:string,n:number)=>{await navigate(a.formPath);await perform({name:'fill',target:resolve(a.form.nameField),value:`${d.namespace}_${label}`});await perform({name:'fill',target:resolve(a.form.numberField),value:String(n)});await perform({name:'click',target:resolve(a.form.submit)});await navigate(a.readPath);};
  try{
    await d.fence();observation=await d.browser.observe();if(new URL(observation.url).origin!==a.origin||observation.actor!=='primary'||observation.device!=='desktop')throw new Error('assertion_context_mismatch');
    for(const step of a.setup){if(step.name==='navigate')await navigate(step.path);else if(step.name==='prepare_identity')await perform(step);else await perform({...step,target:resolve(step.target)});}
    await create('control',a.control);const control=await inspect('control','control');
    if(!controlValid(control))return{status:'inconclusive',reason:'valid_control_not_established',control};
    await create('probe',a.probe);const probe=await inspect('probe','probe'),controlAfter=await inspect('control','control_after');
    return evaluateRecordEvidence(a,control,probe,controlAfter);
  }catch(error){const code=(error as Error).message;return{status:['assertion_locator_missing','assertion_locator_ambiguous','assertion_context_mismatch','registration_identity_limit','credential_scope_refused','tool_scope_refused','assertion_action_refused'].includes(code)?'blocked':'inconclusive',reason:/^[a-z0-9_]{1,80}$/.test(code)?code:'assertion_execution_uncertain'};}
}
