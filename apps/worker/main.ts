import {Queue,Worker,createPostgresBackend} from './queue';
import {randomUUID} from 'node:crypto';
import {getPool,event} from '@oddhound/db';
import {releaseUnusedBudget} from '../../packages/db/budget';
import {scrub,unseal} from '../../packages/db/vault';
import {checkOwnership} from '../web/lib/ownership';
import {assertAuthorizationCurrent} from '../../packages/db/run-authorization';
import {runExploration} from './exploration';
import {runVerification} from './verification';
import {abandonAssertionAttempt} from '../../packages/db/assertions';
import {provision,destroy,runtimeConfigured,type BrowserRuntime} from './runtime';
import {claimQueuedRun} from './claim';
import {runQueuedJob} from './queued-job';

const connection=process.env.DATABASE_URL;if(!connection)throw new Error('database_not_configured');
const workerId=randomUUID(),pool=getPool(),queue=new Queue('oddhound-runs',{connection},createPostgresBackend);
async function processRun(id:string){
  const row=await claimQueuedRun(id,workerId);
  if(!row)return;
  const controller=new AbortController(),signal=controller.signal,generation=row.generation;
  let reason:string|null=null,completed=false,activeBrowser:BrowserRuntime|undefined;
  const fence=async()=>{signal.throwIfAborted();const r=(await pool.query("SELECT r.status,r.generation,r.expires_at,b.kill_switch FROM runs r CROSS JOIN public_budget b WHERE r.id=$1 AND b.id='public'",[id])).rows[0];if(!r||r.generation!==generation||!['provisioning','running'].includes(r.status)||r.kill_switch)throw new Error('run_fenced');if(new Date(r.expires_at).getTime()<=Date.now())throw new Error('run_expired');};
  let heartbeatBusy=false;
  const timer=setInterval(()=>{if(heartbeatBusy)return;heartbeatBusy=true;void fence().then(()=>pool.query("UPDATE runs SET lease_until=now()+interval '45 seconds' WHERE id=$1 AND lease_owner=$2 AND generation=$3",[id,workerId,generation])).catch(e=>controller.abort(e)).finally(()=>{heartbeatBusy=false;});},1000);
  try{
    await event(id,'run.provisioning','Rechecking ownership and preparing a fresh browser Machine.');
    if(!row.scope.assertionTask&&!process.env.META_API_KEY)throw new Error('meta_not_configured');if(!runtimeConfigured())throw new Error('browser_not_configured');
    const inputPrice=Number(process.env.META_INPUT_USD_PER_MILLION),outputPrice=Number(process.env.META_OUTPUT_USD_PER_MILLION);
    if(!row.scope.assertionTask&&!(inputPrice>0&&outputPrice>0))throw new Error('model_prices_not_configured');
    const site=(await pool.query('SELECT * FROM sites WHERE id=$1 AND owner_id=$2',[row.site_id,row.owner_id])).rows[0];
    if(!site||site.revision!==row.scope.revision||!site.verification_method)throw new Error('site_verification_required');
    await checkOwnership(site.origin,site.verification_token,site.verification_method);await fence();
    const approved=row.scope.authorizationSnapshot;if(!approved||!row.scope.authorizationHash)throw new Error('owner_authorization_required');
    const activeSites=(await pool.query('SELECT * FROM sites WHERE id=ANY($1::uuid[]) AND owner_id=$2',[approved.apiOrigins.map((a:any)=>a.siteId).concat(site.id),row.owner_id])).rows;
    const credentials=(await pool.query('SELECT id,reference,revision,secret_cipher FROM credentials WHERE site_id=$1 AND owner_id=$2 AND id=ANY($3::uuid[])',[site.id,row.owner_id,approved.credentialBindings.map((c:any)=>c.id)])).rows;
    assertAuthorizationCurrent(approved,row.scope.authorizationHash,activeSites,credentials);
    for(const api of approved.apiOrigins){const active=activeSites.find((s:any)=>s.id===api.siteId);await checkOwnership(active.origin,active.verification_token,active.verification_method);await fence();}
    const values=approved.credentialBindings.map((binding:any)=>{const c=credentials.find((c:any)=>c.id===binding.id);return{reference:c.reference,actor:binding.actor,value:unseal(c.secret_cipher,`${row.owner_id}:${site.id}:${c.reference}`)};});
    const sanitize=(text:string)=>scrub(text,[...values.map((c:any)=>c.value),...activeSites.map((s:any)=>s.verification_token),...['META_API_KEY','FLY_API_TOKEN','BETTER_AUTH_SECRET','DATABASE_URL','ODDHOUND_VAULT_KEY','GITHUB_CLIENT_SECRET','VERCEL_OIDC_TOKEN'].map(k=>process.env[k]??'')]);
    const browser=await provision(id,generation,{...row.scope,expiresAt:row.expires_at},new Date(row.expires_at),signal);activeBrowser=browser;
    await browser.call('initialize',{credentials:values});await fence();
    await pool.query("UPDATE runs SET status='running' WHERE id=$1 AND generation=$2",[id,generation]);await event(id,'run.running',row.scope.assertionTask?'Ownership rechecked. The isolated browser is replaying the saved assertion.':'Ownership rechecked. The isolated browser is exploring.');
    if(row.scope.assertionTask)await runVerification({id,generation,namespace:approved.guest.namespace,browser,signal,fence,sanitize});
    else await runExploration({id,generation,scope:{origin:site.origin,goal:row.goal,rules:row.scope.rules,writes:row.scope.writes,registration:row.scope.registration,references:values.map((c:any)=>c.reference),authority:approved.guest},browser,signal,fence,sanitize,inputPrice,outputPrice});completed=true;
  }catch(error){const message=(error as Error)?.message??'';reason=signal.aborted?(signal.reason?.message??'run_fenced'):/^[a-z0-9_]+$/.test(message)?message:'execution_failed';await event(id,'run.execution_ended',row.scope.assertionTask?'Assertion execution ended.':'Exploration ended.',{reason});}
  finally{
    clearInterval(timer);controller.abort(new Error('run_finalizing'));if(row.scope.assertionTask)await abandonAssertionAttempt(id,reason??'run_finalizing');if(activeBrowser)try{await activeBrowser.requestStop();}catch{await event(id,'browser.close_unconfirmed','Browser close acknowledgement was not received; Machine destruction will be checked separately.');}
    await pool.query("UPDATE runs SET status='finalizing',generation=generation+1 WHERE id=$1",[id]);
    const removed=await destroy(id);await releaseUnusedBudget(id);
    if(removed){const stopped=(await pool.query('SELECT stop_reason FROM runs WHERE id=$1',[id])).rows[0].stop_reason==='user_cancelled';const status=stopped?'stopped':completed?'completed':reason==='execution_failed'?'failed':'blocked';
      await pool.query('UPDATE runs SET status=$2,stop_reason=COALESCE(stop_reason,$3),finished_at=now(),lease_until=NULL WHERE id=$1',[id,status,reason]);await event(id,'run.finalized',`Run ${status}. Browser cleanup confirmed.`,{reason});
    }else{await pool.query("UPDATE runs SET stop_reason='machine_cleanup_unconfirmed',lease_until=NULL WHERE id=$1",[id]);await event(id,'browser.cleanup_pending','Machine deletion is unconfirmed. Capacity remains occupied.');}
  }
}
const worker=new Worker('oddhound-runs',async(job,token)=>runQueuedJob(job,token,processRun),{connection,concurrency:1},createPostgresBackend);
worker.on('error',()=>console.error('Queue connection error; new execution waits for recovery.'));
worker.on('failed',()=>console.error('A run job failed. Its lease and independent reaper retain cleanup responsibility.'));
let dispatching=false;
async function dispatch(){if(dispatching)return;dispatching=true;try{
  await pool.query('INSERT INTO worker_heartbeats(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET last_seen=now()',[workerId]);
  const pending=await pool.query("SELECT o.run_id FROM run_outbox o JOIN runs r ON r.id=o.run_id WHERE o.delivered_at IS NULL AND r.status='queued' AND r.queue_expires_at>now() ORDER BY o.created_at,o.run_id LIMIT 20");
  for(const row of pending.rows){await queue.add('explore',{runId:row.run_id},{jobId:row.run_id,attempts:1,removeOnComplete:500,removeOnFail:500});await pool.query('UPDATE run_outbox SET delivered_at=now() WHERE run_id=$1',[row.run_id]);}
}catch{console.error('Outbox dispatch unavailable; admitted runs remain durably queued.');}finally{dispatching=false;}}
const interval=setInterval(()=>void dispatch(),1000);await dispatch();console.log('Oddhound PostgreSQL worker ready; no inference until a run is admitted.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{clearInterval(interval);void worker.close().then(()=>queue.close()).then(()=>pool.end()).then(()=>process.exit(0));});
