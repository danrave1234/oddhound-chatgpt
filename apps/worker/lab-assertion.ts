import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {getPool,openPool} from '@oddhound/db';import {browserObservation} from '@oddhound/contracts';
import {assertionHash} from '@oddhound/checks';import {freezeAssertion,assertionDetail,abandonAssertionAttempt} from '../../packages/db/assertions';import {runVerification} from './verification';import {numericAssertion} from '../fixture/assertion';

const id=process.env.ODDHOUND_RUN_ID!,capability=process.env.ODDHOUND_RUN_PATH!,scope=JSON.parse(process.env.ODDHOUND_SCOPE??'{}'),retest=process.argv.includes('--retest');
if(process.env.FLY_APP_NAME||scope.origin!=='https://fixture-lab:3002'||!/^lab_[a-f0-9]{10}$/.test(scope.registrationPrefix)||!/^[a-f0-9]{64}$/.test(capability)||Date.parse(scope.expiresAt)<=Date.now())throw new Error('owned_lab_scope_required');
const pool=getPool(),fixture=openPool(process.env.FIXTURE_DATABASE_URL!),evidence:Record<string,any>={runId:id,startedAt:new Date().toISOString(),scripted:true,modelInference:false,profile:'owned-lab-v1',purpose:retest?'retest':'verification',checks:[]};
const pass=(name:string)=>{evidence.checks.push(name);console.log(`PASS ${name}`);};
async function rpc<T>(method:string,data:unknown={}):Promise<T>{const r=await fetch(`http://172.30.73.30:3001/${capability}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});const v=await r.json();if(!r.ok)throw new Error(v.error??'control_failed');return v;}
let admitted=false,closed=false,passed=false,findingId='';
try{
  let ready:any;for(let i=0;i<30;i++){try{ready=await rpc('ready');break;}catch{await new Promise(r=>setTimeout(r,500));}}assert(ready?.sandbox.enabled);assert.equal(ready.sandbox.uid,1101);evidence.sandbox=ready.sandbox;pass('actual_nonroot_sandbox');
  if(retest)findingId=JSON.parse(await readFile('data/fixed-assertion-lab.json','utf8')).findingId;
  else findingId=process.argv.find(a=>a.startsWith('--finding='))?.slice(10)??'';
  if(!findingId&&process.argv.includes('--synthetic-candidate')){
    const source=(await pool.query("INSERT INTO runs(owner_id,goal,status,scope,held_micros) VALUES('local-developer','Explicitly scripted assertion candidate','completed',$1,0) RETURNING id",[{kind:'demo',origin:scope.origin,labOnly:true}])).rows[0].id;
    findingId=(await pool.query("INSERT INTO findings(run_id,title,status,category,severity,rule,observed,assertion_version,evidence) VALUES($1,'Numeric-create assertion canary','candidate','needs_review','info',$2,'Synthetic engineering candidate','candidate',$3) RETURNING id",[source,numericAssertion(scope.origin).rule,{source:'scripted_canary'}])).rows[0].id;
  }
  assert(findingId,'Supply an existing candidate or the explicit synthetic-candidate flag');
  const source=(await pool.query('SELECT f.*,r.owner_id,r.turns FROM findings f JOIN runs r ON r.id=f.run_id WHERE f.id=$1',[findingId])).rows[0];assert(source&&source.owner_id==='local-developer');
  evidence.candidateSource=source.evidence.source==='meta_candidate'&&source.turns>0?'historical_real_meta':'scripted_canary';evidence.findingId=findingId;
  let detail=await assertionDetail('local-developer',findingId);if(!detail)detail=await freezeAssertion('local-developer',findingId,numericAssertion(scope.origin));
  assert(detail);const hash=detail.hash;assert.equal(assertionHash(detail.spec),hash);evidence.assertionHash=hash;
  if(!retest)await writeFile('data/fixed-assertion-lab.json',JSON.stringify({findingId,hash})+'\n');else assert.equal(JSON.parse(await readFile('data/fixed-assertion-lab.json','utf8')).hash,hash);pass('original_assertion_and_exact_recipe_unchanged');
  await pool.query("INSERT INTO runs(id,owner_id,goal,status,scope,held_micros,funding_account,started_at,expires_at,lease_until) VALUES($1,'local-developer','Replay an immutable numeric-record assertion','running',$2,0,'development',now(),$3,$3)",[id,{...scope,kind:'demo',labOnly:true,siteName:'Owned fixed-assertion check',assertionTask:{findingId,hash}},scope.expiresAt]);admitted=true;
  await pool.query("INSERT INTO assertion_retests(finding_id,assertion_version,assertion_hash,status,run_id,purpose) VALUES($1,$2,$2,'not_run',$3,$4)",[findingId,hash,id,retest?'retest':'verification']);if(source.status!=='verified')await pool.query("UPDATE findings SET status='verifying' WHERE id=$1",[findingId]);
  const browser={call:rpc,observe:async()=>browserObservation.parse(await rpc('observe')),execute:async(action:any,key:string)=>browserObservation.parse(await rpc('action',{action,key}))};
  await rpc('initialize',{credentials:[]});const fence=async()=>{const r=(await pool.query('SELECT status,generation,expires_at FROM runs WHERE id=$1',[id])).rows[0];if(r.status!=='running'||r.generation!==1||new Date(r.expires_at).getTime()<=Date.now())throw new Error('run_fenced');};
  const result=await runVerification({id,generation:1,namespace:scope.authorization.namespace,browser,signal:AbortSignal.timeout(180000),fence,sanitize:t=>t.replaceAll(capability,'[REDACTED]')});evidence.result=result;assert.equal(result.status,retest?'passed':'failed');pass(retest?'unchanged_assertion_passes_after_target_fix':'independent_template_reproduces_rule_violation');
  const rows=(await fixture.query('SELECT b.name,b.seats,b.status FROM fixture_bookings b JOIN fixture_accounts a ON a.id=b.account_id WHERE left(a.username,length($1))=$1 ORDER BY b.name',[scope.registrationPrefix+'_'])).rows;evidence.independentStore=rows;
  assert(rows.some(r=>r.name.endsWith('_control')&&r.seats===3));assert.equal(rows.some(r=>r.name.endsWith('_probe')&&r.seats===-1),!retest);pass('independent_sql_confirms_probe_and_valid_control');
  const f=(await pool.query('SELECT status,lifecycle FROM findings WHERE id=$1',[findingId])).rows[0];assert.equal(f.status,'verified');assert.equal(f.lifecycle,retest?'fixed':'open');evidence.finding=f;pass('finding_lifecycle_matches_saved_evidence');
  const calls=await pool.query('SELECT 1 FROM call_ledger WHERE run_id=$1',[id]);assert.equal(calls.rowCount,0);pass('no_model_inference_or_model_spend');
  assert.equal((await rpc<{closed:boolean}>('stop')).closed,true);closed=true;pass('browser_closure_acknowledged');passed=true;
}catch(error){evidence.error=String((error as Error).message).replaceAll(capability,'[REDACTED]').slice(0,1200);console.error('Fixed assertion check failed:',evidence.error);}
finally{
  if(!closed)try{closed=Boolean((await rpc<{closed:boolean}>('stop')).closed);}catch{}
  if(admitted){await abandonAssertionAttempt(id,'lab_ended_without_result');await pool.query('UPDATE runs SET status=$2,finished_at=now(),lease_until=NULL WHERE id=$1',[id,passed?'completed':'failed']);}
  const accounts=(await fixture.query('SELECT id FROM fixture_accounts WHERE left(username,length($1))=$1',[scope.registrationPrefix+'_'])).rows.map(a=>a.id);await fixture.query('DELETE FROM fixture_bookings WHERE account_id=ANY($1::uuid[])',[accounts]);await fixture.query('DELETE FROM fixture_sessions WHERE account_id=ANY($1::uuid[])',[accounts]);await fixture.query('DELETE FROM fixture_accounts WHERE id=ANY($1::uuid[])',[accounts]);
  Object.assign(evidence,{passed,closed,finishedAt:new Date().toISOString(),limits:'Scripted local independent verification and retest, not autonomous exploration or a Fly/public-site proof. The fixed target was changed between fresh browser runs.'});
  const record=JSON.stringify(evidence,null,2)+'\n';await writeFile(`docs/evidence/fixed-assertion-${id}.json`,record);await writeFile('docs/evidence/fixed-assertion-latest.json',record);console.log(record);await fixture.end();await pool.end();if(!passed)process.exitCode=1;
}
