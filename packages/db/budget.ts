import { transaction, getPool } from './index';
import { limits } from '@oddhound/contracts';

// Lock order everywhere: global budget, then run, then individual ledger entry.
async function locked(c:any,id:string,generation:number){
  const budget=(await c.query("SELECT * FROM public_budget WHERE id='public' FOR UPDATE")).rows[0];
  const r=(await c.query('SELECT * FROM runs WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!r)throw new Error('not_found');
  if(r.generation!==generation||!['provisioning','running'].includes(r.status)||budget.kill_switch)throw new Error('run_fenced');
  if(!r.expires_at||new Date(r.expires_at).getTime()<=Date.now())throw new Error('run_expired');
  if(r.funding_account!=='public'){
    const fund=(await c.query('SELECT * FROM model_funds WHERE id=$1 FOR UPDATE',[r.funding_account])).rows[0];
    if(!fund||Number(fund.held_micros)<Number(r.held_micros))throw new Error('funding_account_inconsistent');
  }
  return r;
}
export async function reserveCall(id:string,generation:number,micros:number){
  if(!Number.isSafeInteger(micros)||micros<=0)throw new Error('invalid_price_bound');
  return transaction(async c=>{const r=await locked(c,id,generation);
    if(r.turns>=limits.turns||micros>Number(r.held_micros))throw new Error('model_budget_exhausted');
    const call=(await c.query("INSERT INTO call_ledger(run_id,generation,reserved_micros,state) VALUES($1,$2,$3,'reserved') RETURNING id",[id,generation,micros])).rows[0];
    await c.query('UPDATE runs SET turns=turns+1 WHERE id=$1',[id]);return call.id as string;
  });
}
export async function settleCall(id:string,callId:string,actual:number,usage:unknown){
  await transaction(async c=>{await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
    const run=(await c.query('SELECT funding_account FROM runs WHERE id=$1 FOR UPDATE',[id])).rows[0];
    const call=(await c.query('SELECT * FROM call_ledger WHERE id=$1 AND run_id=$2 FOR UPDATE',[callId,id])).rows[0];
    if(!call||call.state!=='reserved')throw new Error('call_not_reserved');
    if(!Number.isSafeInteger(actual)||actual<0||actual>Number(call.reserved_micros))throw new Error('provider_usage_exceeds_reservation');
    await c.query("UPDATE call_ledger SET state='settled',actual_micros=$2,usage=$3 WHERE id=$1",[callId,actual,usage]);
    await c.query('UPDATE runs SET spent_micros=spent_micros+$2,held_micros=held_micros-$2 WHERE id=$1',[id,actual]);
    if(run.funding_account==='public')await c.query("UPDATE public_budget SET held=held-$1,lifetime_spent=lifetime_spent+$1,day_spent=day_spent+$1 WHERE id='public'",[actual]);
    else await c.query('UPDATE model_funds SET held_micros=held_micros-$2,spent_micros=spent_micros+$2 WHERE id=$1',[run.funding_account,actual]);
  });
}
export async function unknownCall(id:string,callId:string){await transaction(async c=>{
  await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
  await c.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE',[id]);
  const result=await c.query("UPDATE call_ledger SET state='unknown' WHERE id=$1 AND run_id=$2 AND state='reserved'",[callId,id]);
  if(result.rowCount)await c.query('UPDATE runs SET unknown_usage=true WHERE id=$1',[id]);
});}
export async function releaseUnusedBudget(id:string){await transaction(async c=>{
  await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
  const r=(await c.query('SELECT * FROM runs WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!r)return;
  const q=await c.query("SELECT COALESCE(sum(reserved_micros),0) amount FROM call_ledger WHERE run_id=$1 AND state IN ('reserved','unknown')",[id]);
  const keep=Math.min(Number(r.held_micros),Number(q.rows[0].amount)),release=Number(r.held_micros)-keep;
  await c.query('UPDATE runs SET held_micros=$2,unknown_usage=$3 WHERE id=$1',[id,keep,keep>0]);
  await releaseFunding(c,r.funding_account,release);
});}
export async function releaseFunding(c:import('pg').PoolClient,account:string,micros:number){
  if(account==='public')await c.query("UPDATE public_budget SET held=held-$1 WHERE id='public'",[micros]);
  else await c.query('UPDATE model_funds SET held_micros=held_micros-$2 WHERE id=$1',[account,micros]);
}
export async function admitAction(id:string,generation:number,key:string,action:unknown=null){return transaction(async c=>{
  const r=await locked(c,id,generation);if(r.actions>=limits.actions)throw new Error('action_limit_reached');
  const recent=await c.query("SELECT 1 FROM action_ledger WHERE run_id=$1 AND created_at>now()-interval '1 second' LIMIT 1",[id]);
  if(recent.rowCount)throw new Error('action_rate_limited');
  // Intent is committed before a potentially mutating browser call. A duplicate is never replayed.
  await c.query("INSERT INTO action_ledger(run_id,generation,action_key,state,action) VALUES($1,$2,$3,'intent',$4)",[id,generation,key,action]);
  await c.query('UPDATE runs SET actions=actions+1 WHERE id=$1',[id]);
});}
export async function actionResult(id:string,key:string,result:unknown){await getPool().query("UPDATE action_ledger SET state='observed',result=$3 WHERE run_id=$1 AND action_key=$2 AND state='intent'",[id,key,result]);}
