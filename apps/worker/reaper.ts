import {getPool,event} from '@oddhound/db';
import {releaseUnusedBudget} from '../../packages/db/budget';
import {destroy,reapOrphans,cleanupConfigured} from './runtime';
import {abandonAssertionAttempt} from '../../packages/db/assertions';
import {fenceOverdueBrowserCompute} from '../../packages/db/compute';
const pool=getPool();let busy=false;
async function sweep(){if(busy)return;busy=true;try{
  if(await fenceOverdueBrowserCompute())console.error('Browser cleanup exceeded its compute window. New provisioning is disabled; cleanup continues.');
  if(cleanupConfigured())await reapOrphans();
  const ended=await pool.query("SELECT a.run_id FROM assertion_retests a JOIN runs r ON r.id=a.run_id WHERE a.status='not_run' AND r.status IN ('completed','stopped','failed','blocked')");for(const a of ended.rows)await abandonAssertionAttempt(a.run_id,'run_ended_without_assertion_result');
  const stale=await pool.query("SELECT id FROM runs WHERE status IN ('provisioning','running','waiting_for_input','stopping','finalizing') AND COALESCE(scope->>'labOnly','false')!='true' AND (expires_at<now() OR lease_until<now() OR lease_until IS NULL)");
  for(const r of stale.rows){await pool.query("UPDATE runs SET status='finalizing',generation=generation+1 WHERE id=$1",[r.id]);if(await destroy(r.id)){await releaseUnusedBudget(r.id);await pool.query("UPDATE runs SET status='blocked',stop_reason=COALESCE(stop_reason,'worker_lease_lost'),finished_at=now(),lease_until=NULL WHERE id=$1",[r.id]);await event(r.id,'run.reaped','Stale execution fenced and browser deletion confirmed. No action was retried.');}}
}catch{console.error('Independent cleanup unavailable. New provisioning must remain closed.');}finally{busy=false;}}
await sweep();const timer=setInterval(()=>void sweep(),10000);console.log('Independent orphan reaper ready.');for(const s of ['SIGINT','SIGTERM'] as const)process.once(s,()=>{clearInterval(timer);void pool.end().then(()=>process.exit(0));});
