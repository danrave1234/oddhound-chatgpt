import type {PoolClient} from 'pg';
import {ACTIVE_STATUSES,limits,runInput,type RunInput} from '@oddhound/contracts';
import {assertionHash} from '@oddhound/checks';
import {transaction} from './index';
import {releaseFunding} from './budget';
import {canonicalGrantOrigin,compileRunAuthorization} from './run-authorization';

// These helpers run with the public-budget row already locked. No network,
// browser creation, model call or caller-selected funding class is available.
export async function expireQueuedInTransaction(c:PoolClient,source:'admission'|'worker'|'reaper'|'maintenance'='admission'){
  const expired=await c.query("SELECT * FROM runs WHERE status='queued' AND queue_expires_at<=clock_timestamp() AND COALESCE(scope->>'labOnly','false')!='true' ORDER BY created_at,id FOR UPDATE");
  for(const r of expired.rows){
    await releaseFunding(c,r.funding_account,Number(r.held_micros));
    await c.query("UPDATE runs SET status='blocked',stop_reason='queue_expired',held_micros=0,quota_refunded=true,generation=generation+1,finished_at=now() WHERE id=$1",[r.id]);
    await c.query("INSERT INTO run_events(run_id,kind,message,data) VALUES($1,'run.blocked','The queue deadline expired before provisioning. Unused funding and quota were returned.',$2)",[r.id,{source}]);
  }
  return expired.rowCount??0;
}
export async function expireQueuedRuns(source:'reaper'|'maintenance'='maintenance'){return transaction(async c=>{await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");return expireQueuedInTransaction(c,source);});}

export async function stopOwnedRun(owner:string,id:string){await transaction(async c=>{
  await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
  const r=(await c.query('SELECT * FROM runs WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,owner])).rows[0];
  if(!r)throw new Error('not_found');if(!ACTIVE_STATUSES.includes(r.status))return;
  if(r.status==='queued'){
    await releaseFunding(c,r.funding_account,Number(r.held_micros));
    await c.query("UPDATE runs SET status='stopped',held_micros=0,quota_refunded=true,stop_reason='user_cancelled',finished_at=now(),generation=generation+1 WHERE id=$1",[id]);
  }else await c.query("UPDATE runs SET status='stopping',stop_reason='user_cancelled',generation=generation+1 WHERE id=$1",[id]);
});}

export async function checkPendingAdmission(c:PoolClient,owner:string){
  if((await c.query("SELECT 1 FROM runs WHERE owner_id=$1 AND status='queued' LIMIT 1",[owner])).rowCount)throw new Error('pending_run_already_exists');
  const pending=Number((await c.query("SELECT count(*) FROM runs WHERE status='queued'")).rows[0].count);
  if(pending>=limits.pendingRuns)throw new Error('queue_capacity_reached');
}
export async function lockRunOrigins(c:PoolClient,id:string,origins:string[]){
  const canonical=[...new Set(origins.map(canonicalGrantOrigin))].sort();
  if(!canonical.length)throw new Error('active_origin_required');
  if((await c.query('SELECT 1 FROM active_origin_locks WHERE origin=ANY($1::text[]) LIMIT 1',[canonical])).rowCount)throw new Error('active_origin_busy');
  await c.query('INSERT INTO active_origin_locks(origin,run_id) SELECT origin,$2 FROM unnest($1::text[]) origin ORDER BY origin COLLATE "C"',[canonical,id]);
}

// Numeric rank only; another tenant's identity, target and goal are never read
// into the HTTP response. Local fixture runs keep their separate host profile.
export const queuePositionProjection=`CASE WHEN r.status='queued' AND COALESCE(r.scope->>'labOnly','false')!='true' THEN
 (SELECT count(*) FROM runs q WHERE q.status='queued' AND q.queue_expires_at>now() AND COALESCE(q.scope->>'labOnly','false')!='true' AND (q.created_at,q.id)<=(r.created_at,r.id)) END queue_position`;

export async function admitVerifiedRun(owner:string,raw:RunInput,expectedRevision:number,assertionTask?:{findingId:string;hash:string}){
  const input=runInput.parse(raw),reservation=assertionTask?0:limits.runMicros;
  return transaction(async c=>{
    await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
    await expireQueuedInTransaction(c);
    const budget=(await c.query("SELECT *,day=(clock_timestamp() AT TIME ZONE 'UTC')::date current_day FROM public_budget WHERE id='public'")).rows[0];
    if(!budget||budget.kill_switch)throw new Error('runs_disabled');
    if(!budget.current_day){await c.query("UPDATE public_budget SET day=(clock_timestamp() AT TIME ZONE 'UTC')::date,day_spent=0 WHERE id='public'");budget.day_spent=0;}
    if(Number(budget.lifetime_spent)+Number(budget.held)+reservation>limits.publicLifetimeMicros||Number(budget.day_spent)+Number(budget.held)+reservation>limits.publicDailyMicros)throw new Error('public_budget_unavailable');
    const count=await c.query("SELECT count(*) FROM runs WHERE owner_id=$1 AND funding_account='public' AND quota_refunded=false AND created_at >= ((clock_timestamp() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC')",[owner]);
    if(Number(count.rows[0].count)>=limits.runsPerDay)throw new Error('daily_run_quota_reached');
    await checkPendingAdmission(c,owner);
    const primary=(await c.query('SELECT * FROM sites WHERE id=$1 AND owner_id=$2 FOR SHARE',[input.siteId,owner])).rows[0];
    if(!primary||!primary.verified_at||!primary.verification_method)throw new Error('site_verification_required');
    if(primary.revision!==expectedRevision)throw new Error('verification_revision_changed');
    const apis=(await c.query('SELECT * FROM sites WHERE id=ANY($1::uuid[]) AND owner_id=$2 ORDER BY id FOR SHARE',[input.authorization.apiSites.map(a=>a.siteId),owner])).rows;
    const credentials=(await c.query('SELECT id,reference,revision FROM credentials WHERE site_id=$1 AND owner_id=$2 AND reference=ANY($3::text[]) ORDER BY id FOR SHARE',[primary.id,owner,input.authorization.actors.flatMap(a=>a.credentialReferences)])).rows;
    const approved=compileRunAuthorization({site:primary,apis,credentials,authorization:input.authorization,writes:input.writes,registration:input.registration});
    if(assertionTask&&(!input.writes||!approved.snapshot.guest.capabilities.create))throw new Error('assertion_create_capability_required');
    if(assertionTask){const a=(await c.query('SELECT a.*,r.owner_id,r.site_id,r.scope source_scope FROM finding_assertions a JOIN findings f ON f.id=a.finding_id JOIN runs r ON r.id=f.run_id WHERE a.finding_id=$1 FOR UPDATE OF f',[assertionTask.findingId])).rows[0];if(!a||a.owner_id!==owner||a.site_id!==primary.id)throw new Error('not_found');if(!/^[a-z0-9_-]{3,50}$/.test(approved.snapshot.guest.namespace))throw new Error('assertion_namespace_unsupported');if(a.source_scope.authorizationHash!==approved.hash)throw new Error('fresh_owner_authorization_required');if(a.sha256!==assertionTask.hash||assertionHash(a.spec)!==assertionTask.hash||a.spec.origin!==primary.origin)throw new Error('assertion_integrity_failed');}
    const scope={kind:'verified_site',origin:primary.origin,revision:primary.revision,writes:input.writes,registration:input.registration,rules:input.rules,siteName:primary.name,...(assertionTask?{assertionTask}:{}),authorizationSnapshot:approved.snapshot,authorizationHash:approved.hash,authorization:approved.snapshot.guest,apiOrigins:approved.snapshot.apiOrigins,resourceOrigins:approved.snapshot.resourceOrigins,deniedPaths:approved.snapshot.deniedPaths,registrationPrefix:input.authorization.registration?.prefix,registrationDomain:input.authorization.registration?.domain};
    const r=(await c.query('INSERT INTO runs(owner_id,site_id,goal,scope,held_micros) VALUES($1,$2,$3,$4,$5) RETURNING *',[owner,primary.id,input.goal,scope,reservation])).rows[0];
    await lockRunOrigins(c,r.id,[primary.origin,...approved.snapshot.apiOrigins.map(a=>a.origin)]);
    if(assertionTask){const f=(await c.query('SELECT status FROM findings WHERE id=$1',[assertionTask.findingId])).rows[0];await c.query("INSERT INTO assertion_retests(finding_id,assertion_version,assertion_hash,status,run_id,purpose) VALUES($1,$2,$2,'not_run',$3,$4)",[assertionTask.findingId,assertionTask.hash,r.id,f.status==='verified'?'retest':'verification']);if(f.status!=='verified')await c.query("UPDATE findings SET status='verifying' WHERE id=$1",[assertionTask.findingId]);}
    await c.query("UPDATE public_budget SET held=held+$1 WHERE id='public'",[reservation]);
    await c.query('INSERT INTO run_outbox(run_id) VALUES($1)',[r.id]);
    await c.query("INSERT INTO run_events(run_id,kind,message,data) VALUES($1,'run.queued','Run queued; approved origins locked and model allowance reserved.',$2)",[r.id,{modelReservationMicros:reservation,queueExpiresAt:r.queue_expires_at}]);
    r.queue_position=Number((await c.query("SELECT count(*) FROM runs WHERE status='queued' AND COALESCE(scope->>'labOnly','false')!='true'")).rows[0].count);
    return r;
  });
}
