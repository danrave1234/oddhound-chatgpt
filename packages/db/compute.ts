import {transaction} from './index';
import {limits} from '@oddhound/contracts';

export type ComputeConfiguration={enabled:boolean;region:string;hourlyMicros:number;overheadMicros:number;cleanupSeconds:number;limitMicros:number;rateSource:string;rateExpiresAt:Date};
const integer=(value:number)=>Number.isSafeInteger(value)&&value>0;

// Operator-only configuration. Changing environment variables never resets spent
// or held balances. No default money, price or regional quote is invented.
export async function configureBrowserCompute(input:ComputeConfiguration){
  if(!/^[a-z]{3}$/.test(input.region)||![input.hourlyMicros,input.overheadMicros,input.limitMicros].every(integer)||input.hourlyMicros>1_000_000_000||!Number.isInteger(input.cleanupSeconds)||input.cleanupSeconds<60||input.cleanupSeconds>600)throw new Error('invalid_compute_configuration');
  const source=new URL(input.rateSource);if(source.protocol!=='https:'||source.username||source.password||input.rateSource.length>2048||!Number.isFinite(input.rateExpiresAt.getTime())||input.rateExpiresAt.getTime()<=Date.now()||input.rateExpiresAt.getTime()>Date.now()+7*86400000)throw new Error('invalid_compute_rate_record');
  await transaction(async c=>{
    await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
    const current=(await c.query("SELECT * FROM browser_compute_budget WHERE id='browser' FOR UPDATE")).rows[0];
    if(current){
      if(Number(current.spent_micros)+Number(current.held_micros)>input.limitMicros)throw new Error('compute_allocation_below_committed');
      if(Number(current.held_micros)>0&&(current.region!==input.region||Number(current.hourly_micros)!==input.hourlyMicros||Number(current.overhead_micros)!==input.overheadMicros||current.cleanup_seconds!==input.cleanupSeconds))throw new Error('compute_rate_change_with_live_reservations');
    }
    await c.query(`INSERT INTO browser_compute_budget(id,enabled,region,hourly_micros,overhead_micros,cleanup_seconds,limit_micros,rate_source,rate_expires_at)
      VALUES('browser',$1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,region=excluded.region,hourly_micros=excluded.hourly_micros,overhead_micros=excluded.overhead_micros,cleanup_seconds=excluded.cleanup_seconds,limit_micros=excluded.limit_micros,rate_source=excluded.rate_source,rate_expires_at=excluded.rate_expires_at,updated_at=now()`,
    [input.enabled,input.region,input.hourlyMicros,input.overheadMicros,input.cleanupSeconds,input.limitMicros,input.rateSource,input.rateExpiresAt]);
  });
}

// One attempt per run is deliberate. An uncertain attempt is never retried or
// replaced. Lock order agrees with model accounting: public budget, run, compute.
export async function reserveBrowserCompute(runId:string,generation:number,region:string,expiresAt:Date){return transaction(async c=>{
  const admission=(await c.query("SELECT kill_switch FROM public_budget WHERE id='public' FOR UPDATE")).rows[0];
  const run=(await c.query('SELECT *,clock_timestamp() clock FROM runs WHERE id=$1 FOR UPDATE',[runId])).rows[0];
  if(!run||run.generation!==generation||run.status!=='provisioning'||admission?.kill_switch!==false||!run.lease_until||new Date(run.lease_until).getTime()<=new Date(run.clock).getTime())throw new Error('run_fenced');
  const now=new Date(run.clock).getTime(),remaining=new Date(run.expires_at??0).getTime()-now;
  if(remaining<=0||remaining>limits.durationMs||expiresAt.getTime()!==new Date(run.expires_at).getTime())throw new Error('invalid_compute_lifetime');
  const budget=(await c.query("SELECT * FROM browser_compute_budget WHERE id='browser' FOR UPDATE")).rows[0];
  if(!budget?.enabled||budget.region!==region||new Date(budget.rate_expires_at).getTime()<=now)throw new Error('compute_budget_not_configured');
  if((await c.query('SELECT 1 FROM browser_allocations WHERE run_id=$1',[runId])).rowCount)throw new Error('browser_already_allocated');
  if((await c.query("SELECT 1 FROM browser_compute_reservations WHERE state='held' LIMIT 1")).rowCount)throw new Error('browser_capacity_busy');
  if((await c.query("SELECT 1 FROM browser_allocations a JOIN runs r ON r.id=a.run_id WHERE a.run_id!=$1 AND r.status IN ('provisioning','running','waiting_for_input','stopping','finalizing') LIMIT 1",[runId])).rowCount)throw new Error('browser_capacity_busy');
  const seconds=Math.ceil(remaining/1000)+budget.cleanup_seconds;
  const micros=Math.ceil(Number(budget.hourly_micros)*seconds/3600)+Number(budget.overhead_micros);
  if(!integer(micros)||Number(budget.spent_micros)+Number(budget.held_micros)+micros>Number(budget.limit_micros))throw new Error('compute_budget_exhausted');
  const profile={version:1,region,cpuKind:'shared',cpus:1,memoryMb:2048,hourlyMicros:Number(budget.hourly_micros),overheadMicros:Number(budget.overhead_micros),cleanupSeconds:budget.cleanup_seconds,seconds,rateSource:budget.rate_source,rateExpiresAt:new Date(budget.rate_expires_at).toISOString()};
  await c.query("INSERT INTO browser_compute_reservations(run_id,generation,state,reserved_micros,profile,cleanup_deadline) VALUES($1,$2,'held',$3,$4,$5)",[runId,generation,micros,profile,new Date(expiresAt.getTime()+budget.cleanup_seconds*1000)]);
  await c.query("INSERT INTO browser_allocations(run_id,state,expires_at) VALUES($1,'sent',$2)",[runId,expiresAt]);
  await c.query("UPDATE browser_compute_budget SET held_micros=held_micros+$1 WHERE id='browser'",[micros]);
  return micros;
});}

// Called only after runtime.ts confirms provider absence (and, for unknown
// creates, the entire late-create window). Charge the whole reserved bound:
// this is conservative internal accounting, never a claim about the Fly bill.
// Billing reconciliation may later recover headroom; cleanup never needs an
// enabled budget, a current rate quote, a runtime gate or the model key.
export async function settleBrowserCompute(runId:string){await transaction(async c=>{
  await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
  await c.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE',[runId]);
  await c.query("SELECT id FROM browser_compute_budget WHERE id='browser' FOR UPDATE");
  const reservation=(await c.query('SELECT * FROM browser_compute_reservations WHERE run_id=$1 FOR UPDATE',[runId])).rows[0];
  if(!reservation||reservation.state==='charged')return;
  await c.query("UPDATE browser_compute_budget SET held_micros=held_micros-$1,spent_micros=spent_micros+$1 WHERE id='browser'",[reservation.reserved_micros]);
  await c.query("UPDATE browser_compute_reservations SET state='charged',charged_micros=reserved_micros,settled_at=now() WHERE run_id=$1",[runId]);
});}

export async function fenceOverdueBrowserCompute(){return transaction(async c=>{
  await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
  const disabled=await c.query("UPDATE browser_compute_budget SET enabled=false,updated_at=now() WHERE id='browser' AND enabled=true AND EXISTS(SELECT 1 FROM browser_compute_reservations WHERE state='held' AND cleanup_deadline<now()) RETURNING id");
  if(!disabled.rowCount)return 0;
  const events=await c.query(`INSERT INTO run_events(run_id,kind,message)
    SELECT run_id,'browser.compute_cleanup_overdue','Browser cleanup exceeded its reserved window. New provisioning is disabled; compute remains held until provider absence is confirmed.'
    FROM browser_compute_reservations WHERE state='held' AND cleanup_deadline<now()`);
  return events.rowCount??0;
});}
