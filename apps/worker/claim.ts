import {transaction} from '@oddhound/db';import {releaseFunding} from '../../packages/db/budget';
import {expireQueuedInTransaction} from '../../packages/db/admission';

export class RunDeferredError extends Error{constructor(){super('browser_capacity_busy');}}

export async function claimQueuedRun(id:string,workerId:string){return transaction(async c=>{
  const budget=(await c.query("SELECT kill_switch FROM public_budget WHERE id='public' FOR UPDATE")).rows[0];
  await expireQueuedInTransaction(c,'worker');
  const row=(await c.query("SELECT * FROM runs WHERE id=$1 AND status='queued' FOR UPDATE",[id])).rows[0];if(!row)return null;
  if(!budget||budget.kill_switch){
    await releaseFunding(c,row.funding_account,Number(row.held_micros));
    await c.query("UPDATE runs SET status='blocked',stop_reason='runs_disabled',held_micros=0,quota_refunded=true,generation=generation+1,finished_at=now() WHERE id=$1",[id]);
    await c.query("INSERT INTO run_events(run_id,kind,message) VALUES($1,'run.blocked','The kill switch blocked this queued run before browser provisioning.')",[id]);return null;
  }
  // PostgreSQL is the capacity authority even with multiple Worker processes.
  // A deferred job stays in BullMQ; it has not claimed execution or spent quota.
  const occupied=await c.query("SELECT 1 FROM runs WHERE status IN ('provisioning','running','waiting_for_input','stopping','finalizing') UNION ALL SELECT 1 FROM browser_compute_reservations WHERE state='held' UNION ALL SELECT 1 FROM browser_machines WHERE state!='terminated' LIMIT 1");
  const first=(await c.query("SELECT id FROM runs WHERE status='queued' AND COALESCE(scope->>'labOnly','false')!='true' ORDER BY created_at,id LIMIT 1")).rows[0];
  if(occupied.rowCount||first?.id!==id)throw new RunDeferredError();
  return(await c.query("UPDATE runs SET status='provisioning',lease_owner=$2,lease_until=now()+interval '45 seconds',started_at=now(),expires_at=now()+interval '15 minutes' WHERE id=$1 RETURNING *",[id,workerId])).rows[0];
});}
