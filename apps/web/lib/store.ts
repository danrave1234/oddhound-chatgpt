import { getPool, event, database, sites as sitesTable } from '@oddhound/db';
import {and,eq} from 'drizzle-orm';
import {runtimeConfigured,runtimeGate} from '../../worker/runtime';
import { type Site, type Run, type Workspace, type RunEvent, type Finding, type RunInput } from '@oddhound/contracts';
import { randomBytes } from 'node:crypto';
import { authConfigured, identity } from './auth';
import { canonicalOrigin, checkOwnership } from './ownership';
import {admitVerifiedRun,queuePositionProjection,stopOwnedRun} from '../../../packages/db/admission';
import {eventDataProjection} from '../../../packages/db/events';

const iso=(v:Date|string|null)=>v?new Date(v).toISOString():null;
const site=(r:Record<string,any>):Site=>({id:r.id,name:r.name,origin:r.origin,environment:r.environment,revision:r.revision,verifiedAt:iso(r.verified_at),createdAt:iso(r.created_at)!});
const run=(r:Record<string,any>):Run=>({id:r.id,siteId:r.site_id,siteName:r.site_name??r.scope.siteName??'Demo target',origin:r.origin??r.scope.origin,goal:r.goal,status:r.status,stopReason:r.stop_reason,createdAt:iso(r.created_at)!,startedAt:iso(r.started_at),finishedAt:iso(r.finished_at),actions:r.actions,turns:r.turns,spentMicros:Number(r.spent_micros),fundingAccount:r.funding_account,kind:r.scope.kind??'verified_site',execution:r.scope.assertionTask?'assertion':'exploration',...(r.status==='queued'&&Number(r.queue_position)>0?{queue:{position:Number(r.queue_position),expiresAt:iso(r.queue_expires_at)!}}:{})});
export async function workspace():Promise<Workspace>{
  const actor=await identity();const availability={database:false,github:authConfigured(),meta:Boolean(process.env.META_API_KEY),browser:runtimeConfigured(),publicLaunch:process.env.ODDHOUND_PUBLIC_LAUNCH_ENABLED==='1'};
  try{const pool=getPool();await pool.query('SELECT 1');availability.database=true;if(!actor)return{identity:null,sites:[],runs:[],remainingRuns:3,availability};
    const quota=actor.local?"scope->>'interactiveDemo'='true'":"funding_account='public'";
    const [sites,runs,count]=await Promise.all([pool.query('SELECT * FROM sites WHERE owner_id=$1 ORDER BY created_at DESC',[actor.id]),pool.query(`SELECT r.*,s.name site_name,s.origin,${queuePositionProjection} FROM runs r LEFT JOIN sites s ON s.id=r.site_id WHERE r.owner_id=$1 ORDER BY r.created_at DESC LIMIT 50`,[actor.id]),pool.query(`SELECT count(*) FROM runs WHERE owner_id=$1 AND ${quota} AND quota_refunded=false AND created_at >= ((now() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC')`,[actor.id])]);
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
  return run(await admitVerifiedRun(owner,input,s.revision,assertionTask));
}

export async function runDetail(owner:string,id:string){
  const pool=getPool(),r=(await pool.query(`SELECT r.*,s.name site_name,s.origin,${queuePositionProjection} FROM runs r LEFT JOIN sites s ON s.id=r.site_id WHERE r.id=$1 AND r.owner_id=$2`,[id,owner])).rows[0];if(!r)throw new Error('not_found');
  const [events,findings]=await Promise.all([
    pool.query(`SELECT id,run_id,kind,message,created_at,${eventDataProjection} data FROM run_events WHERE run_id=$1 ORDER BY id LIMIT 1000`,[id]),
    pool.query(`SELECT f.*,a.spec frozen_assertion,(SELECT jsonb_agg(x) FROM (SELECT status,purpose,assertion_hash,run_id,evidence,created_at FROM assertion_retests WHERE finding_id=f.id ORDER BY created_at DESC,id DESC LIMIT 20) x) assertion_attempts
      FROM findings f JOIN runs source ON source.id=f.run_id LEFT JOIN finding_assertions a ON a.finding_id=f.id WHERE (f.run_id=$1 OR f.id=$2::uuid) AND source.owner_id=$3 ORDER BY f.created_at`,[id,r.scope.assertionTask?.findingId??null,owner]),
  ]);
  return{run:{...run(r),...(r.scope.authorizationSnapshot?{approvedScope:{hash:r.scope.authorizationHash,grant:r.scope.authorizationSnapshot.grant,activeOrigins:[{origin:r.scope.origin,revision:r.scope.revision},...r.scope.authorizationSnapshot.apiOrigins]}}:{})},
    events:events.rows.map((e):RunEvent=>({id:Number(e.id),runId:e.run_id,kind:e.kind,message:e.message,data:e.data,createdAt:iso(e.created_at)!})),
    findings:findings.rows.map((f):Finding=>({id:f.id,runId:f.run_id,title:f.title,status:f.status,lifecycle:f.lifecycle,category:f.category,severity:f.severity,rule:f.rule,observed:f.observed,hypothesis:f.hypothesis,evidence:{...f.evidence,...(f.frozen_assertion?{approvedAssertion:f.frozen_assertion,reproductionAttempts:f.assertion_attempts??[]}:{})},assertionVersion:f.assertion_version,createdAt:iso(f.created_at)!})),
  };
}
export async function stopRun(owner:string,id:string){await stopOwnedRun(owner,id);await event(id,'run.stopped','Stop requested; new actions are fenced.');}
