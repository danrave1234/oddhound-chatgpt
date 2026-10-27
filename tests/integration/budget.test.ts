import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {getPool} from '../../packages/db';
import {reserveCall,settleCall,unknownCall,releaseUnusedBudget,admitAction} from '../../packages/db/budget';
import {changeCredential,revokeSiteProof} from '../../packages/db/revocation';import {randomBytes} from 'node:crypto';
import {freezeAssertion,assertionDetail,loadAssertionTask,finishAssertionAttempt,abandonAssertionAttempt} from '../../packages/db/assertions';import {assertionHash,evaluateRecordEvidence} from '@oddhound/checks';import {numericAssertion} from '../../apps/fixture/assertion';
import {startOwnedDemo,claimOwnedDemo,finishOwnedDemo,localDemoEnabled} from '../../apps/web/lib/owned-demo';
import {saveObservation,readArtifact} from '../../packages/db/artifacts';import {createHash} from 'node:crypto';
import {eventDataProjection,readEvent} from '../../packages/db/events';
import {claimQueuedRun} from '../../apps/worker/claim';
import {configureBrowserCompute,reserveBrowserCompute,settleBrowserCompute,fenceOverdueBrowserCompute,type ComputeConfiguration} from '../../packages/db/compute';
import {destroy} from '../../apps/worker/runtime';
if(!new URL(process.env.DATABASE_URL??'postgres://invalid').pathname.endsWith('_test'))throw new Error('Integration tests require a dedicated _test database');
const pool=getPool();after(()=>pool.end());

const computeQuote=():ComputeConfiguration=>({enabled:true,region:'sin',hourlyMicros:3600,overheadMicros:17,cleanupSeconds:120,limitMicros:100000,rateSource:'https://example.invalid/synthetic-rate',rateExpiresAt:new Date(Date.now()+3600000)});
const computeRun=async()=>{const row=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,held_micros,lease_until,expires_at) VALUES('compute-test','Synthetic compute reservation','{}','provisioning',0,now()+interval '45 seconds',now()+interval '60 seconds') RETURNING id,expires_at")).rows[0];return{id:row.id as string,expiresAt:new Date(row.expires_at)};};

test('SQL reserves regional browser compute once under races and never resets charged or uncertain funds',async()=>{
  await pool.query("UPDATE public_budget SET kill_switch=false WHERE id='public'");
  await pool.query('DELETE FROM browser_compute_reservations');await pool.query('DELETE FROM browser_compute_budget');
  await configureBrowserCompute(computeQuote());
  const first=await computeRun(),second=await computeRun();
  try{
    const attempts=await Promise.allSettled([reserveBrowserCompute(first.id,1,'sin',first.expiresAt),reserveBrowserCompute(second.id,1,'sin',second.expiresAt)]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.filter(r=>r.status==='rejected'&&r.reason.message==='browser_capacity_busy').length,1);
    const winner=attempts[0].status==='fulfilled'?first:second,loser=winner===first?second:first;
    const held=Number((await pool.query("SELECT held_micros FROM browser_compute_budget WHERE id='browser'")).rows[0].held_micros);assert(held>137&&held<=197);
    await assert.rejects(reserveBrowserCompute(winner.id,1,'sin',winner.expiresAt),/browser_already_allocated/);
    await assert.rejects(configureBrowserCompute({...computeQuote(),hourlyMicros:7200}),/compute_rate_change_with_live_reservations/);
    await assert.rejects(configureBrowserCompute({...computeQuote(),limitMicros:held-1}),/compute_allocation_below_committed/);
    await configureBrowserCompute({...computeQuote(),enabled:false});
    await settleBrowserCompute(winner.id);await settleBrowserCompute(winner.id);
    const balance=(await pool.query("SELECT held_micros,spent_micros FROM browser_compute_budget WHERE id='browser'")).rows[0];assert.equal(Number(balance.held_micros),0);assert.equal(Number(balance.spent_micros),held);
    await pool.query("UPDATE runs SET status='blocked' WHERE id=$1",[winner.id]);
    await configureBrowserCompute({...computeQuote(),limitMicros:held});await assert.rejects(reserveBrowserCompute(loser.id,1,'sin',loser.expiresAt),/compute_budget_exhausted/);
    assert.equal(Number((await pool.query("SELECT spent_micros FROM browser_compute_budget WHERE id='browser'")).rows[0].spent_micros),held);
    assert.equal((await pool.query('SELECT 1 FROM browser_allocations WHERE run_id=$1',[loser.id])).rowCount,0);
  }finally{
    await pool.query('DELETE FROM browser_compute_reservations');await pool.query('DELETE FROM browser_compute_budget');await pool.query("UPDATE runs SET status='blocked' WHERE id=ANY($1::uuid[])",[[first.id,second.id]]);
  }
});

test('unknown create keeps compute held through cleanup failure and the late-create window; confirmed deletion settles once',async()=>{
  const saved={FLY_API_TOKEN:process.env.FLY_API_TOKEN,ODDHOUND_BROWSER_APP:process.env.ODDHOUND_BROWSER_APP,FLY_APP_NAME:process.env.FLY_APP_NAME},originalFetch=globalThis.fetch;
  let calls=0,providerFails=true;
  globalThis.fetch=(async()=>{calls++;return providerFails?new Response('{}',{status:503}):new Response('[]',{status:200});}) as typeof fetch;
  process.env.FLY_API_TOKEN='synthetic-no-network-token';process.env.ODDHOUND_BROWSER_APP='synthetic-browser';process.env.FLY_APP_NAME='synthetic-worker';
  await configureBrowserCompute(computeQuote());const run=await computeRun();
  try{
    await assert.rejects(reserveBrowserCompute(run.id,2,'sin',run.expiresAt),/run_fenced/);
    await assert.rejects(reserveBrowserCompute(run.id,1,'iad',run.expiresAt),/compute_budget_not_configured/);
    await pool.query("UPDATE public_budget SET kill_switch=true WHERE id='public'");await assert.rejects(reserveBrowserCompute(run.id,1,'sin',run.expiresAt),/run_fenced/);await pool.query("UPDATE public_budget SET kill_switch=false WHERE id='public'");
    await pool.query("UPDATE browser_compute_budget SET rate_expires_at=now()-interval '1 second' WHERE id='browser'");await assert.rejects(reserveBrowserCompute(run.id,1,'sin',run.expiresAt),/compute_budget_not_configured/);await configureBrowserCompute(computeQuote());
    const held=await reserveBrowserCompute(run.id,1,'sin',run.expiresAt);await pool.query("UPDATE browser_allocations SET state='unknown' WHERE run_id=$1",[run.id]);
    assert.equal(await destroy(run.id),false);providerFails=false;assert.equal(await destroy(run.id),false);
    let balance=(await pool.query("SELECT held_micros,spent_micros FROM browser_compute_budget WHERE id='browser'")).rows[0];assert.equal(Number(balance.held_micros),held);assert.equal(Number(balance.spent_micros),0);
    // Synthetic time advancement and recorded provider responses, not a Fly probe.
    await pool.query("UPDATE browser_allocations SET expires_at=now()-interval '61 seconds' WHERE run_id=$1",[run.id]);
    await pool.query("UPDATE browser_compute_reservations SET cleanup_deadline=now()-interval '1 second' WHERE run_id=$1",[run.id]);
    assert.equal(await fenceOverdueBrowserCompute(),1);assert.equal(await fenceOverdueBrowserCompute(),0);assert.equal((await pool.query("SELECT enabled FROM browser_compute_budget WHERE id='browser'")).rows[0].enabled,false);
    assert.equal((await pool.query("SELECT 1 FROM run_events WHERE run_id=$1 AND kind='browser.compute_cleanup_overdue'",[run.id])).rowCount,1);
    await pool.query("UPDATE browser_compute_budget SET rate_expires_at=now()-interval '1 second' WHERE id='browser'");await pool.query("UPDATE public_budget SET kill_switch=true WHERE id='public'");
    assert.equal(await destroy(run.id),true);assert.equal(await destroy(run.id),true);assert(calls>=5);
    balance=(await pool.query("SELECT held_micros,spent_micros FROM browser_compute_budget WHERE id='browser'")).rows[0];assert.equal(Number(balance.held_micros),0);assert.equal(Number(balance.spent_micros),held);
    assert.equal((await pool.query('SELECT state FROM browser_compute_reservations WHERE run_id=$1',[run.id])).rows[0].state,'charged');
  }finally{
    globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await pool.query('DELETE FROM browser_compute_reservations');await pool.query('DELETE FROM browser_compute_budget');await pool.query("UPDATE runs SET status='blocked' WHERE id=$1",[run.id]);await pool.query("UPDATE public_budget SET kill_switch=false WHERE id='public'");
  }
});

test('the production queue claim honors the kill switch, refunds unstarted work and claims only once',async()=>{
  await pool.query("UPDATE public_budget SET held=2000000,kill_switch=true WHERE id='public'");
  const id=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status) VALUES('claim-owner','Synthetic killed claim','{}','queued') RETURNING id")).rows[0].id;
  assert.equal(await claimQueuedRun(id,'worker-a'),null);const blocked=(await pool.query('SELECT status,held_micros,quota_refunded,generation FROM runs WHERE id=$1',[id])).rows[0];assert.equal(blocked.status,'blocked');assert.equal(Number(blocked.held_micros),0);assert.equal(blocked.quota_refunded,true);assert.equal(blocked.generation,2);assert.equal((await pool.query("SELECT held FROM public_budget WHERE id='public'")).rows[0].held,'0');
  await pool.query("UPDATE public_budget SET kill_switch=false WHERE id='public'");const next=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,held_micros) VALUES('claim-owner','Synthetic competing claim','{}','queued',0) RETURNING id")).rows[0].id;
  const claims=await Promise.all([claimQueuedRun(next,'worker-a'),claimQueuedRun(next,'worker-b')]);assert.equal(claims.filter(Boolean).length,1);assert.equal((claims.find(Boolean) as any).status,'provisioning');await pool.query("UPDATE runs SET status='blocked' WHERE id=$1",[next]);
});

test('timeline queries bound repeated page data while preserving owner-only original observations',async()=>{
  const run=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,held_micros) VALUES('event-owner','Synthetic event bound','{}','completed',0) RETURNING id")).rows[0].id;
  const data={url:'https://owned.example/',title:'Synthetic state',text:'x'.repeat(24000),controls:Array.from({length:100},(_,i)=>({target:`c${i}`,role:'button',name:'Synthetic control'})),artifactId:'00000000-0000-4000-8000-000000000001'};
  await pool.query("INSERT INTO run_events(run_id,kind,message,data) SELECT $1,'browser.action','Synthetic saved event',$2 FROM generate_series(1,250)",[run,data]);
  const summaries=(await pool.query(`SELECT id,${eventDataProjection} data FROM run_events WHERE run_id=$1 ORDER BY id`,[run])).rows;
  assert.equal(summaries.length,250);assert(Buffer.byteLength(JSON.stringify(summaries))<100000);assert.equal(summaries[0].data.artifactId,data.artifactId);assert.equal(summaries[0].data.detailsAvailable,true);assert(!('controls' in summaries[0].data));
  const id=Number(summaries[0].id);assert.deepEqual((await readEvent('event-owner',run,id)).data,data);await assert.rejects(readEvent('foreign-owner',run,id),/not_found/);
  await pool.query("UPDATE run_events SET data=jsonb_build_object('legacy','x'::text||repeat('x',131072)) WHERE id=$1",[id]);await assert.rejects(readEvent('event-owner',run,id),/event_data_limit/);
});

test('private PostgreSQL screenshots survive separate reads and enforce ownership, integrity and atomic byte limits',async()=>{
  const saved={NODE_ENV:process.env.NODE_ENV,ODDHOUND_ARTIFACT_STORAGE:process.env.ODDHOUND_ARTIFACT_STORAGE};
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2e8AAAAASUVORK5CYII=','base64'),sha256=createHash('sha256').update(bytes).digest('hex');
  const raw={url:'https://owned.example/',title:'Synthetic PNG',text:'Synthetic metadata',controls:[],screenshot:{mediaType:'image/png',base64:bytes.toString('base64'),sha256}};
  try{
    (process.env as Record<string,string|undefined>).NODE_ENV='production';process.env.ODDHOUND_ARTIFACT_STORAGE='postgres';
    const run=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,held_micros) VALUES('artifact-owner','Synthetic artifact check','{}','completed',0) RETURNING id")).rows[0].id;
    const value=await saveObservation(run,raw);assert(!value.screenshot);assert(value.artifactId);assert.deepEqual(await readArtifact('artifact-owner',value.artifactId),bytes);await assert.rejects(readArtifact('other-owner',value.artifactId),/not_found/);
    await pool.query('UPDATE artifact_content SET content=$2 WHERE artifact_id=$1',[value.artifactId,Buffer.concat([bytes,Buffer.from('tamper')])]);await assert.rejects(readArtifact('artifact-owner',value.artifactId),/artifact_integrity_failed/);
    process.env.ODDHOUND_ARTIFACT_STORAGE='filesystem';await assert.rejects(saveObservation(run,raw),/durable_artifact_storage_required/);process.env.ODDHOUND_ARTIFACT_STORAGE='postgres';
    await pool.query('UPDATE artifacts SET bytes=$2 WHERE id=$1',[value.artifactId,100*1024*1024-bytes.length]);
    const competing=await Promise.allSettled([saveObservation(run,raw),saveObservation(run,raw)]);assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(competing.filter(r=>r.status==='rejected'&&/artifact_budget_exhausted/.test(r.reason.message)).length,1);
    await pool.query('DELETE FROM artifacts WHERE run_id=$1',[run]);assert.equal((await pool.query('SELECT 1 FROM artifact_content WHERE artifact_id=$1',[value.artifactId])).rowCount,0);
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('owned-demo admission requires a live local runner, atomically reserves funds and never replays a lost claim',async()=>{
  const saved={NODE_ENV:process.env.NODE_ENV,ODDHOUND_LOCAL_WORKSPACE:process.env.ODDHOUND_LOCAL_WORKSPACE,ODDHOUND_ENABLE_PAID_LAB:process.env.ODDHOUND_ENABLE_PAID_LAB,ODDHOUND_DEVELOPMENT_MODEL_ALLOCATION_USD:process.env.ODDHOUND_DEVELOPMENT_MODEL_ALLOCATION_USD,META_API_KEY:process.env.META_API_KEY};
  try{
    (process.env as Record<string,string|undefined>).NODE_ENV='production';process.env.ODDHOUND_LOCAL_WORKSPACE='1';process.env.ODDHOUND_ENABLE_PAID_LAB='1';assert.equal(localDemoEnabled(),false);await assert.rejects(claimOwnedDemo(),/owned_demo_not_enabled/);
    (process.env as Record<string,string|undefined>).NODE_ENV='development';process.env.ODDHOUND_DEVELOPMENT_MODEL_ALLOCATION_USD='5';process.env.META_API_KEY='synthetic-no-inference-test-transport';
    await pool.query('TRUNCATE assertion_retests,artifacts,credentials,browser_machines,browser_allocations,findings,run_events,run_outbox,action_ledger,call_ledger,runs,sites CASCADE');await pool.query("DELETE FROM worker_heartbeats WHERE id='owned-demo-host'");await pool.query("UPDATE public_budget SET held=0,kill_switch=false WHERE id='public'");await pool.query("DELETE FROM model_funds WHERE id='development'");
    await assert.rejects(startOwnedDemo(),/owned_demo_runner_offline/);assert.equal(await claimOwnedDemo(),null);
    const competing=await Promise.allSettled([startOwnedDemo(),startOwnedDemo()]);assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);const id=(competing.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<string>).value;
    assert.equal(Number((await pool.query("SELECT held_micros FROM model_funds WHERE id='development'")).rows[0].held_micros),2000000);
    await pool.query("UPDATE public_budget SET kill_switch=true WHERE id='public'");assert.equal(await claimOwnedDemo(),null);assert.equal((await pool.query('SELECT status FROM runs WHERE id=$1',[id])).rows[0].status,'queued');await pool.query("UPDATE public_budget SET kill_switch=false WHERE id='public'");
    const job=await claimOwnedDemo();assert.equal(job!.id,id);assert.equal(job!.kind,'explore');assert.equal(await claimOwnedDemo(),null);assert(!JSON.stringify(job).includes('RUN_PATH'));
    await pool.query("UPDATE runs SET status='stopping',stop_reason='user_cancelled',generation=generation+1 WHERE id=$1",[id]);const cleanup=await claimOwnedDemo();assert.equal(cleanup!.kind,'cleanup');await finishOwnedDemo(id,1);
    assert.equal((await pool.query('SELECT status FROM runs WHERE id=$1',[id])).rows[0].status,'stopped');assert.equal(Number((await pool.query("SELECT held_micros FROM model_funds WHERE id='development'")).rows[0].held_micros),0);assert.equal((await pool.query('SELECT 1 FROM call_ledger WHERE run_id=$1',[id])).rowCount,0);
    const failed=await startOwnedDemo();await claimOwnedDemo();await finishOwnedDemo(failed,1);assert.equal((await pool.query('SELECT quota_refunded FROM runs WHERE id=$1',[failed])).rows[0].quota_refunded,true);
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('SQL freezes owner assertions, isolates tenants and preserves failed/passed/blocked regression history',async()=>{
  await pool.query("UPDATE public_budget SET kill_switch=false WHERE id='public'");
  const source=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,held_micros) VALUES('assertion-owner','Synthetic assertion test',$1,'completed',0) RETURNING id",[{origin:'https://owned.example'}])).rows[0].id;
  const f=(await pool.query("INSERT INTO findings(run_id,title,status,category,severity,rule,observed,assertion_version) VALUES($1,'Numeric boundary','candidate','needs_review','info','Model proposal','Synthetic candidate','candidate') RETURNING id",[source])).rows[0].id;
  const spec=numericAssertion(),hash=assertionHash(spec);await assert.rejects(freezeAssertion('other-owner',f,spec),/not_found/);await freezeAssertion('assertion-owner',f,spec);
  assert.equal((await pool.query('SELECT evidence FROM findings WHERE id=$1',[f])).rows[0].evidence.originalCandidateRule,'Model proposal');
  await assert.rejects(freezeAssertion('assertion-owner',f,spec),/assertion_already_frozen/);await assert.rejects(assertionDetail('other-owner',f),/not_found/);
  await assert.rejects(pool.query('UPDATE finding_assertions SET spec=$2 WHERE finding_id=$1',[f,{...spec,probe:-2}]),/assertion_is_immutable/);await assert.rejects(pool.query("UPDATE findings SET rule='Weakened' WHERE id=$1",[f]),/finding_assertion_is_immutable/);
  const makeRun=async(hashValue=hash)=>{const r=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,held_micros,expires_at) VALUES('assertion-owner','Replay unchanged assertion',$1,'running',0,now()+interval '15 minutes') RETURNING id",[{origin:spec.origin,assertionTask:{findingId:f,hash:hashValue}}])).rows[0].id;await pool.query("INSERT INTO assertion_retests(finding_id,assertion_version,assertion_hash,status,run_id,purpose) VALUES($1,$2,$2,'not_run',$3,'retest')",[f,hash,r]);return r;};
  const sample=(value:number|null)=>({guardObserved:true,recordCount:value===null?0:1,value,text:value===null?'':`${value} seats`,url:spec.origin+'/'}),failure=evaluateRecordEvidence(spec,sample(3),sample(-1),sample(3)),success=evaluateRecordEvidence(spec,sample(3),sample(null),sample(3));
  const initial=await makeRun();assert.equal((await loadAssertionTask(initial)).hash,hash);await assert.rejects(finishAssertionAttempt(initial,1,{status:'passed',reason:'invented'}));await finishAssertionAttempt(initial,1,failure);assert.equal((await pool.query('SELECT lifecycle FROM findings WHERE id=$1',[f])).rows[0].lifecycle,'open');await assert.rejects(finishAssertionAttempt(initial,1,success),/assertion_attempt_not_pending/);
  const retest=await makeRun();await finishAssertionAttempt(retest,1,success);assert.equal((await pool.query('SELECT lifecycle FROM findings WHERE id=$1',[f])).rows[0].lifecycle,'fixed');
  const blocked=await makeRun();await finishAssertionAttempt(blocked,1,{status:'blocked',reason:'assertion_locator_missing'});assert.equal((await pool.query('SELECT lifecycle FROM findings WHERE id=$1',[f])).rows[0].lifecycle,'fixed');
  const regressed=await makeRun();await finishAssertionAttempt(regressed,1,failure);assert.equal((await pool.query('SELECT lifecycle FROM findings WHERE id=$1',[f])).rows[0].lifecycle,'regressed');
  const fenced=await makeRun();await pool.query('UPDATE runs SET generation=2 WHERE id=$1',[fenced]);await assert.rejects(finishAssertionAttempt(fenced,1,success),/run_fenced/);await abandonAssertionAttempt(fenced,'run_fenced');assert.equal((await pool.query('SELECT lifecycle FROM findings WHERE id=$1',[f])).rows[0].lifecycle,'regressed');
  const altered=await makeRun('a'.repeat(64));await assert.rejects(loadAssertionTask(altered),/assertion_integrity_failed/);
  await assert.rejects(pool.query("UPDATE assertion_retests SET status='passed' WHERE run_id=$1",[initial]),/assertion_attempt_is_immutable/);
  const tenantMismatch=await makeRun();await pool.query("UPDATE runs SET owner_id='other-owner' WHERE id=$1",[tenantMismatch]).then(()=>assert.fail('Run owner mutation must be refused'),e=>assert.match(e.message,/run_contract_is_immutable/));
  const foreign=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,held_micros,expires_at) VALUES('other-owner','Foreign assertion attempt',$1,'running',0,now()+interval '15 minutes') RETURNING id",[{origin:spec.origin,assertionTask:{findingId:f,hash}}])).rows[0].id;
  await pool.query("INSERT INTO assertion_retests(finding_id,assertion_version,assertion_hash,status,run_id,purpose) VALUES($1,$2,$2,'not_run',$3,'verification')",[f,hash,foreign]);await assert.rejects(finishAssertionAttempt(foreign,1,success),/assertion_tenant_or_task_mismatch/);await assert.rejects(loadAssertionTask(foreign),/assertion_integrity_failed/);
  const detail=await assertionDetail('assertion-owner',f);assert.equal(detail!.hash,hash);assert.deepEqual(detail!.attempts.map(a=>a.status).sort(),['failed','failed','passed','blocked','inconclusive','not_run','not_run','not_run'].sort());
});
test('real SQL serializes competing reservations, fences writes, and retains uncertain cost',async()=>{
  await pool.query('TRUNCATE assertion_retests,artifacts,credentials,browser_machines,browser_allocations,findings,run_events,run_outbox,action_ledger,call_ledger,runs,sites CASCADE');
  await pool.query("UPDATE public_budget SET held=2000000,lifetime_spent=0,day_spent=0,kill_switch=false WHERE id='public'");
  const r=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,expires_at) VALUES('sql-test','Synthetic accounting test','{}','running',now()+interval '15 minutes') RETURNING id")).rows[0].id;
  const concurrent=await Promise.allSettled([reserveCall(r,1,100000),reserveCall(r,1,100000)]);assert.equal(concurrent.filter(v=>v.status==='fulfilled').length,1);
  const first=concurrent.find(v=>v.status==='fulfilled') as PromiseFulfilledResult<string>;await settleCall(r,first.value,50,{prompt_tokens:10,completion_tokens:20});
  let b=(await pool.query("SELECT held,lifetime_spent FROM public_budget WHERE id='public'")).rows[0];assert.equal(Number(b.held),1999950);assert.equal(Number(b.lifetime_spent),50);
  await admitAction(r,1,'action-one');await assert.rejects(admitAction(r,1,'action-two'),/action_rate_limited/);
  await pool.query('UPDATE runs SET generation=2 WHERE id=$1',[r]);await assert.rejects(reserveCall(r,1,10),/run_fenced/);await assert.rejects(admitAction(r,1,'stale'),/run_fenced/);
  const uncertain=await reserveCall(r,2,12345);await unknownCall(r,uncertain);await releaseUnusedBudget(r);
  b=(await pool.query("SELECT held,lifetime_spent FROM public_budget WHERE id='public'")).rows[0];assert.equal(Number(b.held),12345);assert.equal(Number(b.lifetime_spent),50);
  const run=(await pool.query('SELECT held_micros,unknown_usage FROM runs WHERE id=$1',[r])).rows[0];assert.equal(Number(run.held_micros),12345);assert.equal(run.unknown_usage,true);
  await pool.query("UPDATE public_budget SET kill_switch=true WHERE id='public'");await assert.rejects(admitAction(r,2,'disabled'),/run_fenced/);
});

test('SQL freezes run authority; credential rotation fences only selected grants and refunds queued reservations',async()=>{
  await pool.query('TRUNCATE assertion_retests,artifacts,credentials,browser_machines,browser_allocations,findings,run_events,run_outbox,action_ledger,call_ledger,runs,sites CASCADE');
  process.env.ODDHOUND_VAULT_KEY=randomBytes(32).toString('base64');
  await pool.query("UPDATE public_budget SET held=2000000,kill_switch=false WHERE id='public'");
  const site=(await pool.query("INSERT INTO sites(owner_id,name,origin,environment,verification_token,verified_at,verification_method) VALUES('grant-owner','Grant test','https://grant.example','staging','synthetic-proof',now(),'file') RETURNING id")).rows[0];
  await changeCredential('grant-owner',site.id,'test.password','disposable-integration-credential');
  const credential=(await pool.query('SELECT id,reference,revision FROM credentials WHERE site_id=$1',[site.id])).rows[0];
  const r=(await pool.query("INSERT INTO runs(owner_id,site_id,goal,scope,status) VALUES('grant-owner',$1,'Authorization integration',$2,'queued') RETURNING id",[site.id,{authorizationSnapshot:{credentialBindings:[credential]}}])).rows[0].id;
  await assert.rejects(pool.query("UPDATE runs SET scope='{}' WHERE id=$1",[r]),/run_contract_is_immutable/);await assert.rejects(pool.query("UPDATE runs SET owner_id='other-owner' WHERE id=$1",[r]),/run_contract_is_immutable/);
  await changeCredential('grant-owner',site.id,'unused.password','another-disposable-credential');assert.equal((await pool.query('SELECT status FROM runs WHERE id=$1',[r])).rows[0].status,'queued');
  await assert.rejects(changeCredential('other-owner',site.id,'test.password','foreign-owner-change'),/not_found/);
  await changeCredential('grant-owner',site.id,'test.password','rotated-disposable-credential');
  const stopped=(await pool.query('SELECT status,held_micros,generation,quota_refunded FROM runs WHERE id=$1',[r])).rows[0];assert.equal(stopped.status,'blocked');assert.equal(Number(stopped.held_micros),0);assert.equal(stopped.generation,2);assert.equal(stopped.quota_refunded,true);
  assert.equal((await pool.query('SELECT revision FROM credentials WHERE id=$1',[credential.id])).rows[0].revision,2);
  const active=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,held_micros) VALUES('grant-owner','API revocation integration',$1,'running',0) RETURNING id",[{apiOrigins:[{siteId:site.id}]}])).rows[0].id;
  await revokeSiteProof('grant-owner',site.id);assert.equal((await pool.query('SELECT status FROM runs WHERE id=$1',[active])).rows[0].status,'stopping');assert.equal((await pool.query('SELECT verified_at FROM sites WHERE id=$1',[site.id])).rows[0].verified_at,null);
});

test('development usage and unknown reservations never debit the public or judging allocation',async()=>{
  await pool.query("UPDATE public_budget SET kill_switch=false WHERE id='public'");
  await pool.query("INSERT INTO model_funds(id,limit_micros,held_micros) VALUES('development',2000000,2000000) ON CONFLICT(id) DO UPDATE SET limit_micros=2000000,spent_micros=0,held_micros=2000000");
  await pool.query("INSERT INTO model_funds(id,limit_micros) VALUES('judge',15000000) ON CONFLICT DO NOTHING");
  const publicBefore=(await pool.query("SELECT held,lifetime_spent,day_spent FROM public_budget WHERE id='public'")).rows[0],judgeBefore=(await pool.query("SELECT * FROM model_funds WHERE id='judge'")).rows[0];
  const run=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,funding_account,expires_at) VALUES('sql-test','Development funding isolation','{}','running','development',now()+interval '15 minutes') RETURNING id")).rows[0].id;
  const call=await reserveCall(run,1,100000);await settleCall(run,call,800,{prompt_tokens:100,completion_tokens:50});
  const unknown=await reserveCall(run,1,20000);await unknownCall(run,unknown);await releaseUnusedBudget(run);
  const development=(await pool.query("SELECT * FROM model_funds WHERE id='development'")).rows[0];assert.equal(Number(development.spent_micros),800);assert.equal(Number(development.held_micros),20000);
  assert.deepEqual((await pool.query("SELECT held,lifetime_spent,day_spent FROM public_budget WHERE id='public'")).rows[0],publicBefore);
  assert.deepEqual((await pool.query("SELECT * FROM model_funds WHERE id='judge'")).rows[0],judgeBefore);
  await pool.query("UPDATE public_budget SET kill_switch=true WHERE id='public'");await assert.rejects(reserveCall(run,1,1000),/run_fenced/);
});
