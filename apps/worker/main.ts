import {Queue,Worker,createPostgresBackend} from 'bullmq';
import {randomUUID,createHash} from 'node:crypto';
import {getPool,event,transaction} from '@oddhound/db';
import {MetaAdapter} from '@oddhound/agent';
import {limits} from '@oddhound/contracts';
import {reserveCall,settleCall,unknownCall,releaseUnusedBudget,admitAction,actionResult} from '../../packages/db/budget';
import {scrub,unseal} from '../../packages/db/vault';
import {checkOwnership} from '../web/lib/ownership';
import {explore} from './engine';
import {provision,destroy,runtimeConfigured} from './runtime';

const connection=process.env.DATABASE_URL;if(!connection)throw new Error('database_not_configured');
const workerId=randomUUID(),pool=getPool(),queue=new Queue('oddhound-runs',{connection},createPostgresBackend);
async function processRun(id:string){
  const row=await transaction(async c=>{await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");return(await c.query("UPDATE runs SET status='provisioning',lease_owner=$2,lease_until=now()+interval '45 seconds',started_at=now(),expires_at=now()+interval '15 minutes' WHERE id=$1 AND status='queued' RETURNING *",[id,workerId])).rows[0];});
  if(!row)return;
  const controller=new AbortController(),signal=controller.signal,generation=row.generation;
  let reason:string|null=null,completed=false;
  const fence=async()=>{signal.throwIfAborted();const r=(await pool.query("SELECT r.status,r.generation,r.expires_at,b.kill_switch FROM runs r CROSS JOIN public_budget b WHERE r.id=$1 AND b.id='public'",[id])).rows[0];if(!r||r.generation!==generation||!['provisioning','running'].includes(r.status)||r.kill_switch)throw new Error('run_fenced');if(new Date(r.expires_at).getTime()<=Date.now())throw new Error('run_expired');};
  let heartbeatBusy=false;
  const timer=setInterval(()=>{if(heartbeatBusy)return;heartbeatBusy=true;void fence().then(()=>pool.query("UPDATE runs SET lease_until=now()+interval '45 seconds' WHERE id=$1 AND lease_owner=$2 AND generation=$3",[id,workerId,generation])).catch(e=>controller.abort(e)).finally(()=>{heartbeatBusy=false;});},1000);
  try{
    await event(id,'run.provisioning','Rechecking ownership and preparing a fresh browser Machine.');
    if(!process.env.META_API_KEY)throw new Error('meta_not_configured');if(!runtimeConfigured())throw new Error('browser_not_configured');
    const inputPrice=Number(process.env.META_INPUT_USD_PER_MILLION),outputPrice=Number(process.env.META_OUTPUT_USD_PER_MILLION);
    if(!(inputPrice>0&&outputPrice>0))throw new Error('model_prices_not_configured');
    const site=(await pool.query('SELECT * FROM sites WHERE id=$1 AND owner_id=$2',[row.site_id,row.owner_id])).rows[0];
    if(!site||site.revision!==row.scope.revision||!site.verification_method)throw new Error('site_verification_required');
    await checkOwnership(site.origin,site.verification_token,site.verification_method);await fence();
    const credentials=(await pool.query('SELECT reference,secret_cipher FROM credentials WHERE site_id=$1 AND owner_id=$2',[site.id,row.owner_id])).rows;
    const values=credentials.map(c=>({reference:c.reference,value:unseal(c.secret_cipher,`${row.owner_id}:${site.id}:${c.reference}`)}));
    const sanitize=(text:string)=>scrub(text,values.map(c=>c.value));
    const browser=await provision(id,{...row.scope,expiresAt:row.expires_at},new Date(row.expires_at),signal);
    await browser.call('initialize',{credentials:values});await fence();
    await pool.query("UPDATE runs SET status='running' WHERE id=$1 AND generation=$2",[id,generation]);await event(id,'run.running','Ownership rechecked. The isolated browser is exploring.');
    const observation=async()=>{await fence();return browser.observe();};
    await explore({origin:site.origin,goal:row.goal,rules:row.scope.rules,writes:row.scope.writes,registration:row.scope.registration,references:values.map(c=>c.reference)},{model:new MetaAdapter(process.env.META_API_KEY),signal,inputPrice,outputPrice,
      reserve:bound=>reserveCall(id,generation,bound),settle:(call,actual,usage)=>settleCall(id,call,actual,usage),unknown:call=>unknownCall(id,call),checkFence:fence,sanitize,
      observe:observation,
      execute:async(action,key)=>{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,1050);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});await admitAction(id,generation,key);await fence();const result=await browser.execute(action,key);const clean=JSON.parse(sanitize(JSON.stringify(result)));await actionResult(id,key,clean);await event(id,'browser.action',`Browser action observed: ${action.name}.`,{action:action.name,key,...clean});return clean;},
      record:(kind,message,data)=>event(id,kind,sanitize(message),data),
      findings:async candidates=>{for(const c of candidates){const version=createHash('sha256').update(c.rule).digest('hex');await pool.query("INSERT INTO findings(run_id,title,status,category,severity,rule,observed,evidence,assertion_version) VALUES($1,$2,'candidate','needs_review','info',$3,$4,$5,$6)",[id,c.title,c.rule,c.observation,{source:'meta_candidate',independentlyVerified:false},version]);}}
    });completed=true;
  }catch(error){const message=(error as Error)?.message??'';reason=signal.aborted?(signal.reason?.message??'run_fenced'):/^[a-z0-9_]+$/.test(message)?message:'execution_failed';await event(id,'run.execution_ended','Exploration ended.',{reason});}
  finally{
    clearInterval(timer);controller.abort(new Error('run_finalizing'));
    await pool.query("UPDATE runs SET status='finalizing',generation=generation+1 WHERE id=$1",[id]);
    const removed=await destroy(id);await releaseUnusedBudget(id);
    if(removed){const stopped=(await pool.query('SELECT stop_reason FROM runs WHERE id=$1',[id])).rows[0].stop_reason==='user_cancelled';const status=stopped?'stopped':completed?'completed':reason==='execution_failed'?'failed':'blocked';
      await pool.query('UPDATE runs SET status=$2,stop_reason=COALESCE(stop_reason,$3),finished_at=now(),lease_until=NULL WHERE id=$1',[id,status,reason]);await event(id,'run.finalized',`Run ${status}. Browser cleanup confirmed.`,{reason});
    }else{await pool.query("UPDATE runs SET stop_reason='machine_cleanup_unconfirmed',lease_until=NULL WHERE id=$1",[id]);await event(id,'browser.cleanup_pending','Machine deletion is unconfirmed. Capacity remains occupied.');}
  }
}
const worker=new Worker('oddhound-runs',async job=>processRun(job.data.runId),{connection,concurrency:1},createPostgresBackend);
worker.on('error',()=>console.error('Queue connection error; new execution waits for recovery.'));
worker.on('failed',()=>console.error('A run job failed. Its lease and independent reaper retain cleanup responsibility.'));
let dispatching=false;
async function dispatch(){if(dispatching)return;dispatching=true;try{
  await pool.query('INSERT INTO worker_heartbeats(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET last_seen=now()',[workerId]);
  const pending=await pool.query('SELECT run_id FROM run_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 20');
  for(const row of pending.rows){await queue.add('explore',{runId:row.run_id},{jobId:row.run_id,attempts:1,removeOnComplete:500,removeOnFail:500});await pool.query('UPDATE run_outbox SET delivered_at=now() WHERE run_id=$1',[row.run_id]);}
}catch{console.error('Outbox dispatch unavailable; admitted runs remain durably queued.');}finally{dispatching=false;}}
const interval=setInterval(()=>void dispatch(),1000);await dispatch();console.log('Oddhound PostgreSQL worker ready; no inference until a run is admitted.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{clearInterval(interval);void worker.close().then(()=>queue.close()).then(()=>pool.end()).then(()=>process.exit(0));});
