import {fixedAssertion,recordSample,type AssertionDetail,type AssertionResult} from '@oddhound/contracts';
import {assertionHash,evaluateRecordEvidence} from '@oddhound/checks';
import {getPool,transaction} from './index';

export async function assertionDetail(owner:string,findingId:string):Promise<AssertionDetail|null>{
  const row=(await getPool().query('SELECT a.* FROM findings f JOIN runs r ON r.id=f.run_id LEFT JOIN finding_assertions a ON a.finding_id=f.id WHERE f.id=$1 AND r.owner_id=$2',[findingId,owner])).rows[0];
  if(!row)throw new Error('not_found');if(!row.spec)return null;
  const attempts=(await getPool().query('SELECT * FROM assertion_retests WHERE finding_id=$1 ORDER BY created_at,id',[findingId])).rows;
  return{hash:row.sha256,spec:fixedAssertion.parse(row.spec),approvedAt:row.created_at.toISOString(),attempts:attempts.map(a=>({id:a.id,runId:a.run_id,status:a.status,purpose:a.purpose,createdAt:a.created_at.toISOString(),evidence:a.evidence}))};
}
export async function freezeAssertion(owner:string,findingId:string,value:unknown){
  const spec=fixedAssertion.parse(value),hash=assertionHash(spec);
  await transaction(async c=>{
    const f=(await c.query('SELECT f.*,r.owner_id,r.scope,r.status run_status FROM findings f JOIN runs r ON r.id=f.run_id WHERE f.id=$1 AND r.owner_id=$2 FOR UPDATE OF f',[findingId,owner])).rows[0];if(!f)throw new Error('not_found');
    if(!['completed','stopped','failed','blocked'].includes(f.run_status))throw new Error('source_run_not_finalized');
    if(spec.origin!==f.scope.origin)throw new Error('assertion_origin_mismatch');
    if((await c.query('SELECT 1 FROM finding_assertions WHERE finding_id=$1',[findingId])).rowCount)throw new Error('assertion_already_frozen');
    if(f.status!=='candidate'&&f.status!=='inconclusive')throw new Error('finding_not_a_candidate');
    await c.query('UPDATE findings SET rule=$2,assertion_version=$3,evidence=evidence||$4::jsonb WHERE id=$1',[findingId,spec.rule,hash,{originalCandidateRule:f.rule,originalCandidateVersion:f.assertion_version,ruleSource:'owner_approved'}]);
    await c.query('INSERT INTO finding_assertions(finding_id,spec,sha256,version,approved_by) VALUES($1,$2,$3,1,$4)',[findingId,spec,hash,owner]);
    await c.query("INSERT INTO run_events(run_id,kind,message,data) VALUES($1,'assertion.frozen','The owner approved an immutable numeric-record assertion and its valid control.',$2)",[f.run_id,{findingId,hash,template:spec.template,ruleSource:'owner_approved'}]);
  });return assertionDetail(owner,findingId);
}
export async function loadAssertionTask(runId:string){
  const r=(await getPool().query('SELECT * FROM runs WHERE id=$1',[runId])).rows[0],task=r?.scope.assertionTask;if(!task)throw new Error('assertion_task_required');
  const a=(await getPool().query('SELECT a.*,p.owner_id,p.site_id FROM finding_assertions a JOIN findings f ON f.id=a.finding_id JOIN runs p ON p.id=f.run_id WHERE a.finding_id=$1',[task.findingId])).rows[0];
  if(!a||a.owner_id!==r.owner_id||a.site_id!==r.site_id||a.sha256!==task.hash||assertionHash(a.spec)!==task.hash||a.spec.origin!==r.scope.origin)throw new Error('assertion_integrity_failed');
  return{spec:fixedAssertion.parse(a.spec),hash:a.sha256};
}
export async function finishAssertionAttempt(runId:string,generation:number,result:AssertionResult){
  return transaction(async c=>{
    const budget=(await c.query("SELECT kill_switch FROM public_budget WHERE id='public' FOR UPDATE")).rows[0];
    const run=(await c.query('SELECT * FROM runs WHERE id=$1 FOR UPDATE',[runId])).rows[0];
    if(!run||run.generation!==generation||run.status!=='running'||budget.kill_switch||new Date(run.expires_at??0).getTime()<=Date.now())throw new Error('run_fenced');
    const a=(await c.query('SELECT * FROM assertion_retests WHERE run_id=$1 AND status=\'not_run\' FOR UPDATE',[runId])).rows[0];if(!a)throw new Error('assertion_attempt_not_pending');
    const f=(await c.query('SELECT f.*,source.owner_id source_owner,source.site_id source_site FROM findings f JOIN runs source ON source.id=f.run_id WHERE f.id=$1 FOR UPDATE OF f',[a.finding_id])).rows[0];
    if(!f||f.source_owner!==run.owner_id||f.source_site!==run.site_id||run.scope.assertionTask?.findingId!==f.id)throw new Error('assertion_tenant_or_task_mismatch');
    const frozen=(await c.query('SELECT * FROM finding_assertions WHERE finding_id=$1',[f.id])).rows[0];
    if(!frozen||assertionHash(frozen.spec)!==a.assertion_hash||run.scope.assertionTask?.hash!==a.assertion_hash)throw new Error('assertion_integrity_failed');
    if(['passed','failed'].includes(result.status)){
      const checked=evaluateRecordEvidence(fixedAssertion.parse(frozen.spec),recordSample.parse(result.control),recordSample.parse(result.probe),recordSample.parse(result.controlAfter));
      if(checked.status!==result.status||checked.reason!==result.reason)throw new Error('assertion_evidence_does_not_support_result');
    }
    const evidence={...result,assertionHash:a.assertion_hash,ruleSource:'owner_approved',oracle:'fresh_rendered_record',modelInference:false,scope:'Only the declared numeric form and rendered record were checked.'};
    await c.query('UPDATE assertion_retests SET status=$2,evidence=$3 WHERE id=$1',[a.id,result.status,evidence]);
    if(result.status==='failed')await c.query("UPDATE findings SET status='verified',category='verified_issue',lifecycle=$2,evidence=evidence||$3::jsonb WHERE id=$1",[f.id,f.lifecycle==='fixed'||f.lifecycle==='regressed'?'regressed':'open',{independentlyVerified:true,assertionHash:a.assertion_hash,latestAttemptId:a.id,verificationRunId:runId,oracle:'fresh_rendered_record'}]);
    else if(result.status==='passed'&&f.status==='verified')await c.query("UPDATE findings SET lifecycle='fixed',evidence=evidence||$2::jsonb WHERE id=$1",[f.id,{latestAttemptId:a.id,retestRunId:runId,assertionHash:a.assertion_hash}]);
    else if(f.status!=='verified')await c.query('UPDATE findings SET status=$2 WHERE id=$1',[f.id,result.status==='passed'?'dismissed':'inconclusive']);
    await c.query("INSERT INTO run_events(run_id,kind,message,data) VALUES($1,'assertion.finished','The saved assertion finished; its outcome and valid-control evidence are recorded.',$2)",[runId,{findingId:f.id,status:result.status,hash:a.assertion_hash,reason:result.reason}]);
    return evidence;
  });
}
export async function abandonAssertionAttempt(runId:string,reason:string){await transaction(async c=>{
  const a=(await c.query("UPDATE assertion_retests SET status='inconclusive',evidence=$2 WHERE run_id=$1 AND status='not_run' RETURNING finding_id",[runId,{reason,modelInference:false}])).rows[0];
  if(a)await c.query("UPDATE findings SET status='inconclusive' WHERE id=$1 AND status='verifying'",[a.finding_id]);
});}
