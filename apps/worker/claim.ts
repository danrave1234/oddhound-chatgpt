import {transaction} from '@oddhound/db';import {releaseFunding} from '../../packages/db/budget';

export async function claimQueuedRun(id:string,workerId:string){return transaction(async c=>{
  const budget=(await c.query("SELECT kill_switch FROM public_budget WHERE id='public' FOR UPDATE")).rows[0];
  const row=(await c.query("SELECT * FROM runs WHERE id=$1 AND status='queued' FOR UPDATE",[id])).rows[0];if(!row)return null;
  if(!budget||budget.kill_switch){
    await releaseFunding(c,row.funding_account,Number(row.held_micros));
    await c.query("UPDATE runs SET status='blocked',stop_reason='runs_disabled',held_micros=0,quota_refunded=true,generation=generation+1,finished_at=now() WHERE id=$1",[id]);
    await c.query("INSERT INTO run_events(run_id,kind,message) VALUES($1,'run.blocked','The kill switch blocked this queued run before browser provisioning.')",[id]);return null;
  }
  return(await c.query("UPDATE runs SET status='provisioning',lease_owner=$2,lease_until=now()+interval '45 seconds',started_at=now(),expires_at=now()+interval '15 minutes' WHERE id=$1 RETURNING *",[id,workerId])).rows[0];
});}
