import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {getPool} from '../../packages/db';
import {reserveCall,settleCall,unknownCall,releaseUnusedBudget,admitAction} from '../../packages/db/budget';
if(!new URL(process.env.DATABASE_URL??'postgres://invalid').pathname.endsWith('_test'))throw new Error('Integration tests require a dedicated _test database');
const pool=getPool();after(()=>pool.end());
test('real SQL serializes competing reservations, fences writes, and retains uncertain cost',async()=>{
  await pool.query('TRUNCATE assertion_retests,artifacts,credentials,browser_machines,browser_allocations,findings,run_events,run_outbox,action_ledger,call_ledger,runs,sites CASCADE');
  await pool.query("UPDATE public_budget SET held=2000000,lifetime_spent=0,day_spent=0,kill_switch=false WHERE id='public'");
  const r=(await pool.query("INSERT INTO runs(owner_id,goal,scope,status,expires_at) VALUES('sql-test','Synthetic accounting test','{}','running',now()+interval '15 minutes') RETURNING id")).rows[0].id;
  const concurrent=await Promise.allSettled([reserveCall(r,1,100000),reserveCall(r,1,100000)]);assert.equal(concurrent.filter(v=>v.status==='fulfilled').length,1);
  const first=concurrent.find(v=>v.status==='fulfilled') as PromiseFulfilledResult<string>;await settleCall(r,first.value,50,{prompt_tokens:10,completion_tokens:20});
  let b=(await pool.query("SELECT held,lifetime_spent FROM public_budget WHERE id='public'")).rows[0];assert.equal(Number(b.held),1999950);assert.equal(Number(b.lifetime_spent),50);
  await admitAction(r,1,'action-one');await assert.rejects(admitAction(r,1,'action-two'),/action_rate_limited/);
  await pool.query('UPDATE runs SET generation=2 WHERE id=$1',[r]);await assert.rejects(reserveCall(r,1,10),/run_fenced/);await assert.rejects(admitAction(r,1,'stale'),/run_fenced/);
  const uncertain=await reserveCall(r,2,12345);await unknownCall(r,uncertain);await releaseUnusedBudget(r);
  b=(await pool.query("SELECT held,lifetime_spent FROM public_budget WHERE id='public'")).rows[0];assert.equal(Number(b.held),12345);assert.equal(Number(b.lifetime_spent),50);
  const run=(await pool.query('SELECT held_micros,unknown_usage FROM runs WHERE id=$1',[r])).rows[0];assert.equal(Number(run.held_micros),12345);assert.equal(run.unknown_usage,true);
  await pool.query("UPDATE public_budget SET kill_switch=true WHERE id='public'");await assert.rejects(admitAction(r,2,'disabled'),/run_fenced/);
});
