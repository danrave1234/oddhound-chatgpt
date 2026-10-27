import {transaction} from '@oddhound/db';import {limits,ACTIVE_STATUSES} from '@oddhound/contracts';

export async function admitDevelopmentRun(input:{id:string;goal:string;scope:Record<string,unknown>;expiresAt:string}){
  if(process.env.NODE_ENV==='production'||process.env.ODDHOUND_LOCAL_WORKSPACE!=='1'||process.env.ODDHOUND_ENABLE_PAID_LAB!=='1')throw new Error('paid_local_lab_not_enabled');
  const allocation=Math.round(Number(process.env.ODDHOUND_DEVELOPMENT_MODEL_ALLOCATION_USD)*1e6);
  if(!Number.isSafeInteger(allocation)||allocation<limits.runMicros||allocation>85000000)throw new Error('development_allocation_not_configured');
  return transaction(async c=>{
    const control=(await c.query("SELECT * FROM public_budget WHERE id='public' FOR UPDATE")).rows[0];if(control.kill_switch)throw new Error('runs_disabled');
    if((await c.query('SELECT 1 FROM runs WHERE status=ANY($1) LIMIT 1',[ACTIVE_STATUSES])).rowCount)throw new Error('run_capacity_busy');
    await c.query("INSERT INTO model_funds(id,limit_micros) VALUES('development',$1) ON CONFLICT DO NOTHING",[allocation]);
    const fund=(await c.query("SELECT * FROM model_funds WHERE id='development' FOR UPDATE")).rows[0];
    if(Number(fund.limit_micros)!==allocation)throw new Error('development_allocation_changed');
    if(Number(fund.spent_micros)+Number(fund.held_micros)+limits.runMicros>allocation)throw new Error('development_funding_unavailable');
    await c.query("INSERT INTO runs(id,owner_id,goal,status,scope,held_micros,funding_account,started_at,expires_at,lease_until) VALUES($1,'local-developer',$2,'running',$3,$4,'development',now(),$5,now()+interval '45 seconds')",[input.id,input.goal,input.scope,limits.runMicros,input.expiresAt]);
    await c.query("UPDATE model_funds SET held_micros=held_micros+$1 WHERE id='development'",[limits.runMicros]);
  });
}
