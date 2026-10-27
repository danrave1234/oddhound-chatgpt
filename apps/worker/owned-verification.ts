import {getPool,openPool,event} from '@oddhound/db';import {browserObservation} from '@oddhound/contracts';import {runVerification} from './verification';import {abandonAssertionAttempt} from '../../packages/db/assertions';
const id=process.env.ODDHOUND_RUN_ID!,path=process.env.ODDHOUND_RUN_PATH!,scope=JSON.parse(process.env.ODDHOUND_SCOPE??'{}'),pool=getPool(),fixture=openPool(process.env.FIXTURE_DATABASE_URL!);
if(process.env.FLY_APP_NAME||scope.origin!=='https://fixture-lab:3002'||!/^[a-f0-9]{64}$/.test(path)||!/^lab_[a-f0-9]{10}$/.test(scope.registrationPrefix))throw new Error('owned_demo_scope_required');
const controller=new AbortController(),signal=controller.signal;
async function rpc<T>(method:string,data:unknown={}):Promise<T>{
  const response=await fetch(`http://172.30.73.30:3001/${path}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.any([method==='stop'?AbortSignal.timeout(4500):signal,AbortSignal.timeout(20000)])});
  const reader=response.body?.getReader();if(!reader)throw new Error('browser_response_missing');let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new Error('browser_response_limit');}chunks.push(value);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!response.ok)throw new Error(value.error??'browser_control_failed');return value;
}
async function fence(){signal.throwIfAborted();const row=(await pool.query("SELECT r.status,r.generation,r.expires_at,b.kill_switch FROM runs r CROSS JOIN public_budget b WHERE r.id=$1 AND b.id='public'",[id])).rows[0];if(!row||row.generation!==1||!['provisioning','running'].includes(row.status)||row.kill_switch)throw new Error('run_fenced');if(new Date(row.expires_at).getTime()<=Date.now())throw new Error('run_expired');}
let completed=false,closed=false,busy=false,reason:string|null=null;
const timer=setInterval(()=>{if(busy)return;busy=true;void fence().then(()=>pool.query("UPDATE runs SET lease_until=now()+interval '45 seconds' WHERE id=$1 AND generation=1",[id])).catch(e=>controller.abort(e)).finally(()=>{busy=false;});},1000);
try{
  let ready:any;for(let attempt=0;attempt<30;attempt++){try{ready=await rpc('ready');break;}catch{await new Promise(r=>setTimeout(r,500));}}
  if(ready?.runId!==id||!ready.sandbox.enabled||ready.sandbox.uid!==1101)throw new Error('owned_sandbox_not_ready');await fence();
  await pool.query("UPDATE runs SET status='running' WHERE id=$1 AND status='provisioning' AND generation=1",[id]);await event(id,'browser.ready','Fresh owned-demo browser ready for unchanged assertion replay.',{profile:'owned-lab-v1',sandbox:ready.sandbox});await rpc('initialize',{credentials:[]});
  await runVerification({id,generation:1,namespace:scope.authorization.namespace,browser:{call:rpc,observe:async()=>browserObservation.parse(await rpc('observe')),execute:async(action,key)=>browserObservation.parse(await rpc('action',{action,key}))},signal,fence,sanitize:t=>t.replaceAll(path,'[REDACTED]')});completed=true;
}catch(error){reason=/^[a-z0-9_]+$/.test((error as Error).message)?(error as Error).message:'owned_verification_failed';}
finally{
  clearInterval(timer);controller.abort(new Error('run_finalizing'));try{closed=Boolean((await rpc<{closed:boolean}>('stop')).closed);}catch{}
  await abandonAssertionAttempt(id,reason??'verification_ended');
  await pool.query("UPDATE runs SET status='finalizing',generation=generation+1,lease_until=now()+interval '45 seconds',stop_reason=COALESCE(stop_reason,$2) WHERE id=$1",[id,reason]);
  await event(id,'owned.controller_ended','The saved assertion controller finished; guest removal is pending.',{completed,browserCloseAcknowledged:closed});
  const accounts=(await fixture.query('SELECT id FROM fixture_accounts WHERE left(username,length($1))=$1',[scope.registrationPrefix+'_'])).rows.map(a=>a.id);await fixture.query('DELETE FROM fixture_bookings WHERE account_id=ANY($1::uuid[])',[accounts]);await fixture.query('DELETE FROM fixture_sessions WHERE account_id=ANY($1::uuid[])',[accounts]);await fixture.query('DELETE FROM fixture_accounts WHERE id=ANY($1::uuid[])',[accounts]);
  await fixture.end();await pool.end();if(!completed||!closed)process.exitCode=1;
}
