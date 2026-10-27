import {mkdir,writeFile} from 'node:fs/promises';import {getPool,openPool,event} from '@oddhound/db';
import {browserObservation,type BrowserAction,type BrowserObservation} from '@oddhound/contracts';import {MODEL} from '@oddhound/agent';
import {releaseUnusedBudget} from '../../packages/db/budget';import {scrub} from '../../packages/db/vault';
import {admitDevelopmentRun} from './development-funding';import {runExploration,type ExplorationBrowser} from './exploration';
import {demoGoal,demoRules} from '../fixture/demo-contract';

if(!process.argv.includes('--paid'))throw new Error('explicit_paid_lab_flag_required');
const id=process.env.ODDHOUND_RUN_ID!,capability=process.env.ODDHOUND_RUN_PATH!,scope=JSON.parse(process.env.ODDHOUND_SCOPE??'{}');
const interactive=process.argv.includes('--interactive');
if(process.env.FLY_APP_NAME||!['https://fixture-lab:3002','https://fixture-corrected-lab:3002'].includes(scope.origin)||!/^lab_[a-f0-9]{10}$/.test(scope.registrationPrefix)||!/^[a-f0-9]{64}$/.test(capability)||Date.parse(scope.expiresAt)-Date.now()>900000||Date.parse(scope.expiresAt)<=Date.now())throw new Error('owned_lab_scope_required');
if(!process.env.META_API_KEY)throw new Error('meta_not_configured');
const pool=getPool(),fixture=openPool(process.env.FIXTURE_DATABASE_URL!),controller=new AbortController(),signal=controller.signal,inputPrice=1.25,outputPrice=4.25,corrected=process.env.ODDHOUND_LAB_EXPECT_CORRECTED==='1';
const goal=demoGoal,rules=demoRules;
const evidence:Record<string,unknown>={runId:id,startedAt:new Date().toISOString(),provider:'Direct Meta',model:MODEL,profile:'owned-lab-v1',autonomous:true,scripted:false,seedKnowledgeProvided:false,paidCeilingUsd:2,fundingAccount:'development',inputUsdPerMillion:inputPrice,outputUsdPerMillion:outputPrice,pricingSource:'https://dev.meta.ai/models/muse-spark',imagesSent:false};
const sanitize=(value:string)=>scrub(value,[capability,...['META_API_KEY','FLY_API_TOKEN','DATABASE_URL','GITHUB_CLIENT_SECRET','BETTER_AUTH_SECRET','ODDHOUND_VAULT_KEY','VERCEL_OIDC_TOKEN'].map(k=>process.env[k]??'')]);
async function rpc<T>(method:string,data:unknown={}):Promise<T>{
  const response=await fetch(`http://172.30.73.30:3001/${capability}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.any([method==='stop'?AbortSignal.timeout(4500):signal,AbortSignal.timeout(20000)]),redirect:'error'});
  const reader=response.body?.getReader();if(!reader)throw new Error('browser_response_missing');let length=0;const chunks:Uint8Array[]=[];
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>2*1024*1024){await reader.cancel();throw new Error('browser_response_limit');}chunks.push(value);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!response.ok)throw new Error(value.error??'browser_control_failed');return value;
}
const browser:ExplorationBrowser={call:rpc,observe:async()=>browserObservation.parse(await rpc('observe')),execute:async(action,key)=>browserObservation.parse(await rpc('action',{action,key}))};
async function fence(){signal.throwIfAborted();const r=(await pool.query("SELECT r.status,r.generation,r.expires_at,b.kill_switch FROM runs r CROSS JOIN public_budget b WHERE r.id=$1 AND b.id='public'",[id])).rows[0];if(!r||r.generation!==1||!['running','provisioning'].includes(r.status)||r.kill_switch)throw new Error('run_fenced');if(new Date(r.expires_at).getTime()<=Date.now())throw new Error('run_expired');}
type Booking={id:string;seats:number;status:string};let previous=new Map<string,Booking>(),validCreate=false,edited=false,cancelled=false,invalidPersisted=false;
const storeChanges:{action:string;created:number[];updated:{from:number;to:number}[];cancelled:number}[]=[];
async function inspectStore(_value:BrowserObservation,action?:BrowserAction){
  const rows=(await fixture.query('SELECT b.id,b.seats,b.status FROM fixture_bookings b JOIN fixture_accounts a ON a.id=b.account_id WHERE left(a.username,length($1))=$1',[scope.registrationPrefix+'_'])).rows as Booking[];
  const created=rows.filter(r=>!previous.has(r.id)),updated=rows.filter(r=>previous.has(r.id)&&previous.get(r.id)!.seats!==r.seats),cancels=rows.filter(r=>r.status==='cancelled'&&previous.get(r.id)?.status==='confirmed');
  validCreate ||=created.some(r=>Number.isInteger(r.seats)&&r.seats>=1&&r.seats<=8);edited ||=updated.length>0;cancelled ||=cancels.length>0;invalidPersisted ||=rows.some(r=>!Number.isInteger(r.seats)||r.seats<1||r.seats>8);
  if(created.length||updated.length||cancels.length)storeChanges.push({action:action?.name??'observe',created:created.map(r=>r.seats),updated:updated.map(r=>({from:previous.get(r.id)!.seats,to:r.seats})),cancelled:cancels.length});
  previous=new Map(rows.map(r=>[r.id,r]));
}
let admitted=false,completed=false,closed=false,timer:ReturnType<typeof setInterval>|undefined;
try{
  let ready:any;for(let i=0;i<30;i++){try{ready=await rpc('ready');break;}catch{await new Promise(r=>setTimeout(r,500));}}
  if(ready?.policy!=='owned-lab-v1'||ready.runId!==id||!ready.sandbox?.enabled||ready.sandbox.uid!==1101)throw new Error('owned_sandbox_not_ready');evidence.sandbox=ready.sandbox;
  if(interactive){const row=(await pool.query("UPDATE runs SET status='running',lease_until=now()+interval '45 seconds' WHERE id=$1 AND owner_id='local-developer' AND status='provisioning' AND generation=1 AND scope->>'interactiveDemo'='true' AND scope->>'origin'=$2 AND scope->>'registrationPrefix'=$3 RETURNING id",[id,scope.origin,scope.registrationPrefix])).rows[0];if(!row)throw new Error('interactive_demo_not_admitted');}
  else await admitDevelopmentRun({id,goal,scope:{...scope,kind:'demo',labOnly:true,siteName:'Autonomous owned demo',rules},expiresAt:scope.expiresAt});admitted=true;
  let busy=false;timer=setInterval(()=>{if(busy)return;busy=true;void fence().then(()=>pool.query("UPDATE runs SET lease_until=now()+interval '45 seconds' WHERE id=$1 AND generation=1",[id])).catch(error=>controller.abort(error)).finally(()=>{busy=false;});},1000);
  await rpc('initialize',{credentials:[]});await event(id,'run.running','Real Meta exploration of the owned HTTPS fixture started; no click script or defect list was provided.');
  await runExploration({id,generation:1,scope:{origin:scope.origin,goal,rules,writes:true,registration:true,references:[],authority:scope.authorization},browser,signal,fence,sanitize,inputPrice,outputPrice,afterObservation:inspectStore});completed=true;
}catch(error){evidence.error=/^[a-z0-9_]+$/.test((error as Error).message)?(error as Error).message:'owned_exploration_failed';console.error('Autonomous owned run ended:',evidence.error);}
finally{
  if(timer)clearInterval(timer);controller.abort(new Error('run_finalizing'));try{closed=Boolean((await rpc<{closed:boolean}>('stop')).closed);}catch{}evidence.browserCloseAcknowledged=closed;
  if(admitted){
    const accounts=(await fixture.query('SELECT a.id,(SELECT count(*) FROM fixture_sessions s WHERE s.account_id=a.id) sessions FROM fixture_accounts a WHERE left(a.username,length($1))=$1',[scope.registrationPrefix+'_'])).rows;
    const checks={registered:accounts.length>0,returnedLogin:accounts.some(a=>Number(a.sessions)>1),validCreate,edited,cancelled,invalidPersisted};
    const modelCandidates=(await pool.query('SELECT title,rule,observed,status FROM findings WHERE run_id=$1',[id])).rows;
    const r=(await pool.query('SELECT spent_micros,actions,turns FROM runs WHERE id=$1',[id])).rows[0];
    const stopped=(await pool.query('SELECT stop_reason FROM runs WHERE id=$1',[id])).rows[0].stop_reason==='user_cancelled';
    await pool.query("UPDATE runs SET status=$2,stop_reason=COALESCE(stop_reason,$3),generation=generation+1,finished_at=CASE WHEN $2='finalizing' THEN NULL ELSE now() END,lease_until=CASE WHEN $2='finalizing' THEN now()+interval '45 seconds' ELSE NULL END WHERE id=$1",[id,interactive||!closed?'finalizing':stopped?'stopped':completed?'completed':'blocked',evidence.error??(!closed?'browser_close_unconfirmed':null)]);await releaseUnusedBudget(id);
    if(interactive)await event(id,'owned.controller_ended','The Meta controller finished; local browser removal is pending.',{completed,browserCloseAcknowledged:closed});
    const held=(await pool.query('SELECT held_micros,unknown_usage FROM runs WHERE id=$1',[id])).rows[0];
    Object.assign(evidence,{completed,checks,storeChanges,modelCandidates,actions:r.actions,turns:r.turns,spentMicros:Number(r.spent_micros),heldMicros:Number(held.held_micros),unknownUsage:held.unknown_usage,expectedControl:corrected?'corrected':'vulnerable',passed:completed&&closed&&checks.registered&&checks.returnedLogin&&checks.validCreate&&checks.edited&&checks.cancelled&&(corrected?!checks.invalidPersisted:checks.invalidPersisted)});
    const ids=accounts.map(a=>a.id);await fixture.query('DELETE FROM fixture_bookings WHERE account_id=ANY($1::uuid[])',[ids]);await fixture.query('DELETE FROM fixture_sessions WHERE account_id=ANY($1::uuid[])',[ids]);await fixture.query('DELETE FROM fixture_accounts WHERE id=ANY($1::uuid[])',[ids]);
    await event(id,'run.finalized',completed&&closed?'Owned autonomous exploration completed; local browser closure acknowledged.':'Owned exploration stopped with partial evidence.',{checks,browserCloseAcknowledged:closed});
  }
  Object.assign(evidence,{finishedAt:new Date().toISOString(),claims:'Real Meta-driven owned local workflow only. No Fly lifecycle, public-site or complete SELF clearance.'});
  await mkdir('docs/evidence',{recursive:true});const record=sanitize(JSON.stringify({...evidence,interactive},null,2))+'\n';await writeFile(`docs/evidence/meta-exploration-${id}.json`,record);await writeFile('docs/evidence/meta-exploration-latest.json',record);console.log(record);await fixture.end();await pool.end();if(interactive?!(completed&&closed):!evidence.passed)process.exitCode=1;
}
