import assert from 'node:assert/strict';import {writeFile,mkdir} from 'node:fs/promises';import {getPool,openPool} from '@oddhound/db';import {browserObservation,type BrowserAction,type BrowserObservation} from '@oddhound/contracts';
const id=process.env.ODDHOUND_RUN_ID!,path=process.env.ODDHOUND_RUN_PATH!,scope=JSON.parse(process.env.ODDHOUND_SCOPE??'{}'),pool=getPool(),fixture=openPool(process.env.FIXTURE_DATABASE_URL!);
if(scope.authorization?.mode!=='mapped'||scope.origin!=='https://fixture-lab:3002')throw new Error('owned_mapped_canary_required');
const evidence:Record<string,unknown>={runId:id,profile:'owned-lab-v1',startedAt:new Date().toISOString(),scripted:true,modelInference:false,checks:[]},checks=evidence.checks as string[];
function check(name:string){checks.push(name);console.log('PASS '+name);}
async function rpc(method:string,data:unknown={}){const response=await fetch(`http://172.30.73.30:3001/${path}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});const value=await response.json();if(!response.ok)throw new Error(value.error);return value;}
let observation:BrowserObservation,sequence=0,passed=false,closed=false;
async function action(action:BrowserAction){await new Promise(r=>setTimeout(r,1050));observation=browserObservation.parse(await rpc('action',{action,key:'grants-'+(++sequence)}));return observation;}
const controlUrl=`${scope.origin}/_lab/controls?nonce=${id}&namespace=${scope.registrationPrefix}`;
async function submit(name:string){await action({name:'navigate',url:controlUrl});const button=observation.controls.find(c=>c.role==='button'&&c.name===name);assert(button,'Missing owned canary button: '+name);await action({name:'click',target:button.target});}
await pool.query("INSERT INTO runs(id,owner_id,goal,status,scope,held_micros,started_at,expires_at,lease_until) VALUES($1,'engineering-tests','Scripted owner grant canaries; no Meta inference','running',$2,0,now(),$3,$3)",[id,{...scope,kind:'demo',labOnly:true},scope.expiresAt]);
try{
  let ready:any;for(let i=0;i<30;i++){try{ready=await rpc('ready');break;}catch{await new Promise(r=>setTimeout(r,500));}}
  assert(ready?.sandbox?.enabled);evidence.sandbox=ready.sandbox;check('sandboxed_mapped_policy_ready');
  await assert.rejects(rpc('initialize',{credentials:[{reference:'not.approved',value:'synthetic-unselected-secret',actor:'primary'}]}),/credential_not_granted/);check('unselected_credential_is_refused_before_initialization');
  observation=browserObservation.parse(await rpc('initialize',{credentials:[]}));
  await assert.rejects(action({name:'switch_actor',actor:'secondary'}),/actor_not_granted/);check('ungranted_actor_is_refused');
  await action({name:'prepare_identity'});await assert.rejects(action({name:'prepare_identity'}),/registration_identity_limit/);check('owner_identity_cap_is_enforced');
  await submit('Allowed create');assert.match(observation.text,/reached the owned fixture/);check('approved_namespace_write_reaches_fixture');
  await submit('Foreign namespace');assert.match(observation.text,/policy refused/);check('foreign_namespace_write_is_refused');
  await submit('Unmapped operation');assert.match(observation.text,/policy refused/);check('unmapped_write_is_refused');
  await submit('Owned cancel');assert.match(observation.text,/reached the owned fixture/);check('approved_fixture_cancel_reaches_fixture');
  await submit('Foreign cancel');assert.match(observation.text,/policy refused/);check('foreign_fixture_cancel_is_refused');
  await submit('First registration');assert.match(observation.text,/reached the owned fixture/);await submit('Second registration');assert.match(observation.text,/policy refused/);check('registration_request_slot_is_reserved_before_forwarding');
  for(const name of ['Allowed API create','Foreign API namespace','Unapproved API method']){await submit(name);await new Promise(r=>setTimeout(r,1000));}
  closed=Boolean((await rpc('stop')).closed);assert(closed);await new Promise(r=>setTimeout(r,250));
  const arrivals=(await fixture.query('SELECT nonce,origin,path,method FROM fixture_policy_requests WHERE left(nonce,length($1))=$1 ORDER BY nonce',[id+'_'])).rows;
  evidence.arrivals=arrivals;assert.deepEqual(arrivals.map(r=>r.nonce.slice(id.length+1)),['api-foreign_preflight','api-good','api-good_preflight','cancel','create','register-one']);check('independent_sql_confirms_exact_allowed_arrivals_and_no_denied_nonce');
  passed=true;
}catch(error){evidence.error=String((error as Error).message).replaceAll(path,'[REDACTED]').slice(0,1000);console.error('Owner grant canary failed:',evidence.error);}
finally{
  if(!closed)try{closed=Boolean((await rpc('stop')).closed);}catch{}
  await fixture.query('DELETE FROM fixture_policy_requests WHERE left(nonce,length($1))=$1',[id+'_']);
  await pool.query("UPDATE runs SET status=$2,actions=$3,finished_at=CASE WHEN $2='finalizing' THEN NULL ELSE now() END,lease_until=NULL WHERE id=$1",[id,!closed?'finalizing':passed?'completed':'failed',sequence]);
  Object.assign(evidence,{passed,closed,finishedAt:new Date().toISOString(),claims:'Owned local mapped-policy component only. No deployed or complete SELF clearance; credential/application business semantics and broad staging grants need their remaining proofs.'});
  await mkdir('docs/evidence',{recursive:true});const record=JSON.stringify(evidence,null,2)+'\n';await writeFile(`docs/evidence/owner-grants-${id}.json`,record);await writeFile('docs/evidence/owner-grants-latest.json',record);await pool.end();await fixture.end();if(!passed)process.exitCode=1;
}
