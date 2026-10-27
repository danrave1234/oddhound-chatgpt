import { getPool, transaction, event, database, sites as sitesTable } from '@oddhound/db';
import {and,eq} from 'drizzle-orm';
import {assertionHash} from '@oddhound/checks';
import {runtimeConfigured,runtimeGate} from '../../worker/runtime';
import { ACTIVE_STATUSES, limits, type Site, type Run, type Workspace, type RunEvent, type Finding, type RunInput } from '@oddhound/contracts';
import { randomBytes } from 'node:crypto';
import { authConfigured, identity } from './auth';
import { canonicalOrigin, checkOwnership } from './ownership';
import {releaseFunding} from '../../../packages/db/budget';
import {compileRunAuthorization} from '../../../packages/db/run-authorization';

const iso=(v:Date|string|null)=>v?new Date(v).toISOString():null;
const site=(r:Record<string,any>):Site=>({id:r.id,name:r.name,origin:r.origin,environment:r.environment,revision:r.revision,verifiedAt:iso(r.verified_at),createdAt:iso(r.created_at)!});
const run=(r:Record<string,any>):Run=>({id:r.id,siteId:r.site_id,siteName:r.site_name??r.scope.siteName??'Demo target',origin:r.origin??r.scope.origin,goal:r.goal,status:r.status,stopReason:r.stop_reason,createdAt:iso(r.created_at)!,startedAt:iso(r.started_at),finishedAt:iso(r.finished_at),actions:r.actions,turns:r.turns,spentMicros:Number(r.spent_micros),fundingAccount:r.funding_account,kind:r.scope.kind??'verified_site',execution:r.scope.assertionTask?'assertion':'exploration'});
export async function workspace():Promise<Workspace>{
  const actor=await identity();const availability={database:false,github:authConfigured(),meta:Boolean(process.env.META_API_KEY),browser:runtimeConfigured(),publicLaunch:process.env.ODDHOUND_PUBLIC_LAUNCH_ENABLED==='1'};
  try{const pool=getPool();await pool.query('SELECT 1');availability.database=true;if(!actor)return{identity:null,sites:[],runs:[],remainingRuns:3,availability};
    const [sites,runs,count]=await Promise.all([pool.query('SELECT * FROM sites WHERE owner_id=$1 ORDER BY created_at DESC',[actor.id]),pool.query('SELECT r.*,s.name site_name,s.origin FROM runs r LEFT JOIN sites s ON s.id=r.site_id WHERE r.owner_id=$1 ORDER BY r.created_at DESC LIMIT 50',[actor.id]),pool.query("SELECT count(*) FROM runs WHERE owner_id=$1 AND funding_account='public' AND quota_refunded=false AND created_at >= ((now() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC')",[actor.id])]);
    return{identity:actor,sites:sites.rows.map(site),runs:runs.rows.map(run),remainingRuns:Math.max(0,3-Number(count.rows[0].count)),availability};
  }catch{return{identity:actor,sites:[],runs:[],remainingRuns:3,availability};}
}
const fromSite=(r:typeof sitesTable.$inferSelect):Site=>({id:r.id,name:r.name,origin:r.origin,environment:r.environment as Site['environment'],revision:r.revision,verifiedAt:iso(r.verifiedAt),createdAt:iso(r.createdAt)!});
export async function addSite(owner:string,input:{name:string;origin:string;environment:'staging'|'production'}){const origin=canonicalOrigin(input.origin);const [row]=await database().insert(sitesTable).values({ownerId:owner,name:input.name,origin,environment:input.environment,token:randomBytes(32).toString('hex')}).returning();return fromSite(row);}
export async function siteProof(owner:string,id:string){const row=await database().query.sites.findFirst({where:and(eq(sitesTable.id,id),eq(sitesTable.ownerId,owner))});if(!row)throw new Error('not_found');return{site:fromSite(row),token:row.token};}
export async function verifySite(owner:string,id:string,method:'dns'|'file'|'meta'){const {site:s,token}=await siteProof(owner,id);const proof=await checkOwnership(s.origin,token,method);const result=await getPool().query('UPDATE sites SET verified_at=now(),verification_method=$4 WHERE id=$1 AND owner_id=$2 AND revision=$3',[id,owner,s.revision,method]);if(!result.rowCount)throw new Error('verification_revision_changed');return proof;}
export async function createRun(owner:string,input:RunInput,assertionTask?:{findingId:string;hash:string}){
  const {site:s}=await siteProof(owner,input.siteId);if(!s.verifiedAt)throw new Error('site_verification_required');
  if(!assertionTask&&!process.env.META_API_KEY)throw new Error('meta_not_configured');if(!runtimeConfigured())throw new Error('browser_not_configured');await runtimeGate();
  if(process.env.ODDHOUND_PUBLIC_LAUNCH_ENABLED!=='1')throw new Error('verified_site_execution_not_enabled');
  return transaction(async c=>{
    const budget=(await c.query("SELECT * FROM public_budget WHERE id='public' FOR UPDATE")).rows[0];if(budget.kill_switch)throw new Error('runs_disabled');
    const today=(await c.query("SELECT (now() AT TIME ZONE 'UTC')::date AS day")).rows[0].day;
    if(String(budget.day)!==String(today)){await c.query("UPDATE public_budget SET day=$1,day_spent=0 WHERE id='public'",[today]);budget.day_spent=0;}
    if(Number(budget.lifetime_spent)+Number(budget.held)+limits.runMicros>limits.publicLifetimeMicros||Number(budget.day_spent)+Number(budget.held)+limits.runMicros>limits.publicDailyMicros)throw new Error('public_budget_unavailable');
    const count=await c.query("SELECT count(*) FROM runs WHERE owner_id=$1 AND funding_account='public' AND quota_refunded=false AND created_at >= ((now() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC')",[owner]);if(Number(count.rows[0].count)>=3)throw new Error('daily_run_quota_reached');
    const active=await c.query('SELECT id FROM runs WHERE status=ANY($1)',[ACTIVE_STATUSES]);if(active.rowCount)throw new Error('browser_capacity_busy');
    const primary=(await c.query('SELECT * FROM sites WHERE id=$1 AND owner_id=$2 FOR SHARE',[s.id,owner])).rows[0];
    if(!primary||primary.revision!==s.revision)throw new Error('verification_revision_changed');
    const apiIds=input.authorization.apiSites.map(a=>a.siteId);
    const apis=(await c.query('SELECT * FROM sites WHERE id=ANY($1::uuid[]) AND owner_id=$2 ORDER BY id FOR SHARE',[apiIds,owner])).rows;
    const references=input.authorization.actors.flatMap(a=>a.credentialReferences);
    const credentials=(await c.query('SELECT id,reference,revision FROM credentials WHERE site_id=$1 AND owner_id=$2 AND reference=ANY($3::text[]) ORDER BY id FOR SHARE',[s.id,owner,references])).rows;
    const approved=compileRunAuthorization({site:primary,apis,credentials,authorization:input.authorization,writes:input.writes,registration:input.registration});
    if(assertionTask&&(!input.writes||!approved.snapshot.guest.capabilities.create))throw new Error('assertion_create_capability_required');
    if(assertionTask){const a=(await c.query('SELECT a.*,r.owner_id,r.site_id,r.scope source_scope FROM finding_assertions a JOIN findings f ON f.id=a.finding_id JOIN runs r ON r.id=f.run_id WHERE a.finding_id=$1 FOR UPDATE OF f',[assertionTask.findingId])).rows[0];if(!a||a.owner_id!==owner||a.site_id!==s.id)throw new Error('not_found');if(!/^[a-z0-9_-]{3,50}$/.test(approved.snapshot.guest.namespace))throw new Error('assertion_namespace_unsupported');if(a.source_scope.authorizationHash!==approved.hash)throw new Error('fresh_owner_authorization_required');if(a.sha256!==assertionTask.hash||assertionHash(a.spec)!==assertionTask.hash||a.spec.origin!==s.origin)throw new Error('assertion_integrity_failed');}
    const scope={kind:'verified_site',origin:s.origin,revision:s.revision,writes:input.writes,registration:input.registration,rules:input.rules,siteName:s.name,...(assertionTask?{assertionTask}:{}),
      authorizationSnapshot:approved.snapshot,authorizationHash:approved.hash,authorization:approved.snapshot.guest,apiOrigins:approved.snapshot.apiOrigins,
      resourceOrigins:approved.snapshot.resourceOrigins,deniedPaths:approved.snapshot.deniedPaths,registrationPrefix:input.authorization.registration?.prefix,registrationDomain:input.authorization.registration?.domain};
    const result=await c.query('INSERT INTO runs(owner_id,site_id,goal,scope) VALUES($1,$2,$3,$4) RETURNING *',[owner,s.id,input.goal,scope]);const r=result.rows[0];
    if(assertionTask){const f=(await c.query('SELECT status FROM findings WHERE id=$1',[assertionTask.findingId])).rows[0];await c.query("INSERT INTO assertion_retests(finding_id,assertion_version,assertion_hash,status,run_id,purpose) VALUES($1,$2,$2,'not_run',$3,$4)",[assertionTask.findingId,assertionTask.hash,r.id,f.status==='verified'?'retest':'verification']);if(f.status!=='verified')await c.query("UPDATE findings SET status='verifying' WHERE id=$1",[assertionTask.findingId]);}
    await c.query("UPDATE public_budget SET held=held+$1 WHERE id='public'",[limits.runMicros]);await c.query('INSERT INTO run_outbox(run_id) VALUES($1)',[r.id]);await c.query("INSERT INTO run_events(run_id,kind,message) VALUES($1,'run.queued','Run admitted; model budget reserved.')",[r.id]);return run(r);
  });
}
export async function runDetail(owner:string,id:string){
  const pool=getPool(),r=(await pool.query('SELECT r.*,s.name site_name,s.origin FROM runs r LEFT JOIN sites s ON s.id=r.site_id WHERE r.id=$1 AND r.owner_id=$2',[id,owner])).rows[0];if(!r)throw new Error('not_found');
  const [events,findings]=await Promise.all([
    pool.query('SELECT * FROM run_events WHERE run_id=$1 ORDER BY id LIMIT 1000',[id]),
    pool.query(`SELECT f.*,a.spec frozen_assertion,(SELECT jsonb_agg(x) FROM (SELECT status,purpose,assertion_hash,run_id,evidence,created_at FROM assertion_retests WHERE finding_id=f.id ORDER BY created_at DESC,id DESC LIMIT 20) x) assertion_attempts
      FROM findings f JOIN runs source ON source.id=f.run_id LEFT JOIN finding_assertions a ON a.finding_id=f.id WHERE (f.run_id=$1 OR f.id=$2::uuid) AND source.owner_id=$3 ORDER BY f.created_at`,[id,r.scope.assertionTask?.findingId??null,owner]),
  ]);
  return{run:{...run(r),...(r.scope.authorizationSnapshot?{approvedScope:{hash:r.scope.authorizationHash,grant:r.scope.authorizationSnapshot.grant,activeOrigins:[{origin:r.scope.origin,revision:r.scope.revision},...r.scope.authorizationSnapshot.apiOrigins]}}:{})},
    events:events.rows.map((e):RunEvent=>({id:Number(e.id),runId:e.run_id,kind:e.kind,message:e.message,data:e.data,createdAt:iso(e.created_at)!})),
    findings:findings.rows.map((f):Finding=>({id:f.id,runId:f.run_id,title:f.title,status:f.status,lifecycle:f.lifecycle,category:f.category,severity:f.severity,rule:f.rule,observed:f.observed,hypothesis:f.hypothesis,evidence:{...f.evidence,...(f.frozen_assertion?{approvedAssertion:f.frozen_assertion,reproductionAttempts:f.assertion_attempts??[]}:{})},assertionVersion:f.assertion_version,createdAt:iso(f.created_at)!})),
  };
}
export async function stopRun(owner:string,id:string){await transaction(async c=>{await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");const r=(await c.query('SELECT * FROM runs WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,owner])).rows[0];if(!r)throw new Error('not_found');if(!ACTIVE_STATUSES.includes(r.status))return;if(r.status==='queued'){await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");await releaseFunding(c,r.funding_account,Number(r.held_micros));await c.query("UPDATE runs SET status='stopped',held_micros=0,quota_refunded=true,stop_reason='user_cancelled',finished_at=now(),generation=generation+1 WHERE id=$1",[id]);}else{await c.query("UPDATE runs SET status='stopping',stop_reason='user_cancelled',generation=generation+1 WHERE id=$1",[id]);}});await event(id,'run.stopped','Stop requested; new actions are fenced.');}
