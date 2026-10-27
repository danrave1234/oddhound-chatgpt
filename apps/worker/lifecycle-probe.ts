import {randomBytes,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {getPool,event,transaction} from '@oddhound/db';
import {BrowserRuntime} from './runtime';

// Explicit, targetless deployed canary. This never calls the model, initializes
// a site or replaces normal admission. The separate production reaper owns
// cleanup after this process intentionally exits before saving a Machine row.
if(!process.argv.includes('--fly-lifecycle'))throw new Error('explicit_fly_lifecycle_flag_required');
if(process.env.FLY_APP_NAME!=='oddhound-chatgpt-worker'||process.env.ODDHOUND_BROWSER_APP!=='oddhound-chatgpt-browser')throw new Error('lifecycle_probe_app_refused');
const source=process.env.FLY_PRIVATE_IP??'';
if(isIP(source)!==6||!source.startsWith('fdaa:'))throw new Error('private_probe_controller_required');
const image=process.env.ODDHOUND_BROWSER_IMAGE??'';
if(!/^registry\.fly\.io\/oddhound-chatgpt-browser@sha256:[a-f0-9]{64}$/.test(image)||!process.env.FLY_API_TOKEN)throw new Error('pinned_probe_runtime_required');
const pool=getPool(),id=randomUUID(),expiresAt=new Date(Date.now()+90000),path=randomBytes(32).toString('hex');
const scope={origin:'https://oddhound-chatgpt-preview.vercel.app',writes:false,registration:false,expiresAt:expiresAt.toISOString(),apiOrigins:[],resourceOrigins:[],deniedPaths:[],authorization:{version:1,mode:'mapped',actors:[{id:'primary',label:'Targetless lifecycle canary',credentialReferences:[]}],capabilities:{authenticate:false,create:false,edit:false,cancel:false,boundary:true,repeat:true,unusualOrder:true},namespace:'lifecycle_probe',fixtureIds:[],maxAccounts:0,uiMethods:['GET','HEAD'],operations:[]}};
const timer=setTimeout(()=>process.exit(43),180000);
try{
  await transaction(async c=>{
    await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
    if((await c.query("SELECT 1 FROM runs WHERE status IN ('queued','provisioning','running','waiting_for_input','stopping','finalizing') LIMIT 1")).rowCount)throw new Error('probe_requires_idle_capacity');
    await c.query("INSERT INTO runs(id,owner_id,goal,status,scope,held_micros,quota_refunded,lease_owner,lease_until,expires_at) VALUES($1,'engineering-lifecycle-probe','Targetless controller-exit canary; no website testing','provisioning',$2,0,true,$3,now()+interval '75 seconds',$4)",[id,{...scope,kind:'demo',canaryOnly:true,siteName:'Runtime lifecycle probe'},process.env.FLY_MACHINE_ID,expiresAt]);
    await c.query("INSERT INTO browser_allocations(run_id,state,expires_at) VALUES($1,'sent',$2)",[id,expiresAt]);
  });
  await event(id,'runtime_probe.allocation_sent','The targetless canary reserved lifecycle state before one Machine create. No model budget or target action is involved.');
  const response=await fetch('https://api.machines.dev/v1/apps/oddhound-chatgpt-browser/machines',{method:'POST',headers:{authorization:`Bearer ${process.env.FLY_API_TOKEN}`,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(20000),body:JSON.stringify({name:`lifecycle-${id.slice(0,8)}`,region:'sin',config:{image,auto_destroy:true,restart:{policy:'no'},guest:{cpu_kind:'shared',cpus:1,memory_mb:2048},services:[],metadata:{oddhound_run_id:id,oddhound_expires_at:expiresAt.toISOString(),oddhound_canary:'controller-exit-v1'},env:{ODDHOUND_RUN_ID:id,ODDHOUND_RUN_PATH:path,ODDHOUND_SCOPE:JSON.stringify(scope),ODDHOUND_TRUSTED_WEB_IPS:source}}})});
  if(!response.ok)throw new Error(`probe_create_http_${response.status}`);
  const machine=await response.json();if(!machine.id||isIP(machine.private_ip)!==6||!machine.private_ip.startsWith('fdaa:'))throw new Error('invalid_probe_machine');
  const runtime=new BrowserRuntime(id,machine.private_ip,path,AbortSignal.timeout(65000));let ready:any;
  for(let attempt=0;attempt<45;attempt++){try{ready=await runtime.call('ready');break;}catch{if(Date.now()>expiresAt.getTime()-15000)break;await new Promise(r=>setTimeout(r,1000));}}
  if(!ready?.sandbox?.enabled||ready.sandbox.uid!==1101||ready.runId!==id)throw new Error('probe_browser_not_ready');
  await event(id,'runtime_probe.browser_ready','The fresh targetless browser reached sandboxed private readiness.',{image,policy:ready.policy,sandbox:ready.sandbox});
  await pool.query("UPDATE runs SET lease_until=now()+interval '3 seconds' WHERE id=$1",[id]);
  await event(id,'runtime_probe.controller_exit','The canary controller is exiting before browser_machines persistence. The independent reaper must recover it.');
  console.log(JSON.stringify({event:'lifecycle_probe.controller_exit',runId:id,expectedExitCode:42,modelInference:false,siteNavigation:false}));
  // Deliberately omit browser close, ID persistence and controller cleanup.
  process.exit(42);
}catch(error){
  const message=(error as Error).message,reason=/^[a-z0-9_]+$/.test(message)?message:'lifecycle_probe_failed';
  await pool.query("UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=$1",[id]).catch(()=>{});
  console.error(JSON.stringify({event:'lifecycle_probe.failed',runId:id,reason,modelInference:false}));process.exitCode=1;
}finally{clearTimeout(timer);await pool.end();}
