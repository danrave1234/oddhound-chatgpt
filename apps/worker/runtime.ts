import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {getPool} from '@oddhound/db';
import {reserveBrowserCompute,settleBrowserCompute} from '../../packages/db/compute';
import {seal} from '../../packages/db/vault';
import type {Action} from '@oddhound/agent';
import type {Observation} from './engine';
import {browserObservation,browserScope} from '@oddhound/contracts';

type Machine={id:string;private_ip:string;state:string;config:{metadata?:Record<string,string>}};
async function fly(path:string,method='GET',body?:unknown){
  if(!process.env.FLY_API_TOKEN)throw new Error('fly_not_configured');
  const response=await fetch(`https://api.machines.dev/v1${path}`,{method,signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${process.env.FLY_API_TOKEN}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok&&response.status!==404)throw new Error(`fly_http_${response.status}`);
  if(response.status===404)return null;const raw=await response.text();if(raw.length>1024*1024)throw new Error('fly_response_too_large');return raw?JSON.parse(raw):null;
}
export function runtimeConfigured(){return Boolean(process.env.FLY_API_TOKEN&&process.env.ODDHOUND_BROWSER_APP&&process.env.ODDHOUND_BROWSER_IMAGE&&process.env.ODDHOUND_RUNTIME_GATE_FILE&&process.env.ODDHOUND_VAULT_KEY);}
export function cleanupConfigured(env:Record<string,string|undefined>=process.env){const value=env.ODDHOUND_BROWSER_APP??'';return Boolean(env.FLY_API_TOKEN&&/^[a-z][a-z0-9-]{2,62}$/.test(value)&&value!==env.FLY_APP_NAME);}
export function guestRunScope(scope:unknown,expiresAt:Date){if(!scope||typeof scope!=='object'||Array.isArray(scope))throw new Error('invalid_browser_scope');return browserScope.parse({...scope,expiresAt:expiresAt.toISOString()});}
export async function runtimeGate(){
  const image=process.env.ODDHOUND_BROWSER_IMAGE??'';if(!/^.+@sha256:[a-f0-9]{64}$/.test(image))throw new Error('browser_image_digest_required');
  const path=process.env.ODDHOUND_RUNTIME_GATE_FILE;if(!path)throw new Error('runtime_gate_not_configured');
  const gate=JSON.parse(await readFile(path,'utf8'));
  if(gate.image!==image||gate.profile!=='gateway-sandbox-v1'||!gate.evidence||!['sandbox','privateControl','egress','activeAllowedDenied','workerFrames','resourceLimits','freshLifecycle','orphanReaper'].every(k=>gate[k]===true))throw new Error('runtime_gate_incomplete');
  const until=new Date(gate.expiresAt).getTime();if(!Number.isFinite(until)||until<Date.now())throw new Error('runtime_gate_expired');
  return image;
}
function app(){const value=process.env.ODDHOUND_BROWSER_APP??'';if(!/^[a-z][a-z0-9-]{2,62}$/.test(value)||value===process.env.FLY_APP_NAME)throw new Error('separate_browser_app_required');return value;}
export function trustedControlSources(env:Record<string,string|undefined>=process.env){
  const sources=env.ODDHOUND_TRUSTED_WEB_IPS?.split(',')??(env.FLY_APP_NAME&&env.FLY_APP_NAME!==env.ODDHOUND_BROWSER_APP&&env.FLY_PRIVATE_IP?[env.FLY_PRIVATE_IP]:[]);
  if(!sources.length||sources.some(v=>isIP(v)!==6||!v.startsWith('fdaa:')))throw new Error('trusted_control_sources_required');return sources;
}
export class BrowserRuntime{
  constructor(readonly runId:string,private address:string,private path:string,private signal:AbortSignal){}
  async call<T>(method:string,data:unknown={},signal=this.signal):Promise<T>{
    if(!isIP(this.address)||!this.address.toLowerCase().startsWith('fdaa:'))throw new Error('invalid_private_control_address');
    let response:Response;try{response=await fetch(`http://[${this.address}]:3001/${this.path}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),redirect:'error'});}catch{throw new Error(signal.aborted?'run_fenced':'browser_connection_lost');}
    const reader=response.body?.getReader();if(!reader)throw new Error('browser_response_missing');let size=0;const chunks:Uint8Array[]=[];
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new Error('browser_response_limit');}chunks.push(value);}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!response.ok)throw new Error(typeof value.error==='string'&&/^[a-z0-9_]{1,80}$/.test(value.error)?value.error:'browser_control_failed');return value as T;
  }
  async observe(){return browserObservation.parse(await this.call<Observation>('observe'));}
  async execute(action:Exclude<Action,{name:'finish_run'}>,key:string){return browserObservation.parse(await this.call<Observation>('action',{action,key}));}
  requestStop(){return this.call<{closed:boolean}>('stop',{},AbortSignal.timeout(4500));}
}
export async function provision(runId:string,generation:number,scope:unknown,expiresAt:Date,signal:AbortSignal){
  const image=await runtimeGate(),browserApp=app(),path=randomBytes(32).toString('hex'),runScope=guestRunScope(scope,expiresAt);
  const sources=trustedControlSources();
  signal.throwIfAborted();
  const region=process.env.ODDHOUND_FLY_REGION??'sin';
  await reserveBrowserCompute(runId,generation,region,expiresAt);
  let machine:Machine;
  try{signal.throwIfAborted();machine=await fly(`/apps/${browserApp}/machines`,'POST',{name:`run-${runId.slice(0,8)}`,region,config:{image,auto_destroy:true,restart:{policy:'no'},guest:{cpu_kind:'shared',cpus:1,memory_mb:2048},metadata:{oddhound_run_id:runId,oddhound_expires_at:expiresAt.toISOString()},env:{ODDHOUND_RUN_ID:runId,ODDHOUND_RUN_PATH:path,ODDHOUND_EXPIRES_AT:expiresAt.toISOString(),ODDHOUND_TRUSTED_WEB_IPS:sources.join(','),ODDHOUND_SCOPE:JSON.stringify(runScope)},services:[]}});}catch(error){await getPool().query("UPDATE browser_allocations SET state='unknown' WHERE run_id=$1",[runId]);throw error;}
  if(!machine?.id||!machine.private_ip)throw new Error('invalid_machine_response');
  await getPool().query("INSERT INTO browser_machines(run_id,machine_id,app,image,private_ip,control_cipher,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,'provisioning',$7)",[runId,machine.id,browserApp,image,machine.private_ip,seal(path,runId),expiresAt]);
  await getPool().query("UPDATE browser_allocations SET state='known' WHERE run_id=$1",[runId]);
  const browser=new BrowserRuntime(runId,machine.private_ip,path,signal);let verdict:any;
  for(let attempt=0;attempt<30;attempt++){signal.throwIfAborted();try{verdict=await browser.call('ready');break;}catch{await new Promise(r=>setTimeout(r,1000));}}
  if(!verdict?.sandbox?.enabled||verdict.sandbox.uid===0||verdict.runId!==runId||verdict.policy!=='gateway-sandbox-v1')throw new Error('browser_policy_not_ready');
  await getPool().query("UPDATE browser_machines SET state='active',sandbox=$2 WHERE run_id=$1",[runId,verdict.sandbox]);return browser;
}
export async function destroy(runId:string){
  const row=(await getPool().query('SELECT * FROM browser_machines WHERE run_id=$1',[runId])).rows[0];if(row?.state==='terminated'){await settleBrowserCompute(runId);await getPool().query("UPDATE browser_allocations SET state='released' WHERE run_id=$1",[runId]);return true;}
  if(!row){const allocation=(await getPool().query('SELECT * FROM browser_allocations WHERE run_id=$1',[runId])).rows[0];if(!allocation)return !(await getPool().query("SELECT 1 FROM browser_compute_reservations WHERE run_id=$1 AND state='held'",[runId])).rowCount;
    // A timed-out create may still produce a Machine. Keep its slot through the bounded lifetime.
    try{const matches:Machine[]=(await fly(`/apps/${app()}/machines`)??[]).filter((m:Machine)=>m.config?.metadata?.oddhound_run_id===runId);for(const m of matches)await fly(`/apps/${app()}/machines/${m.id}?force=true`,'DELETE');if(new Date(allocation.expires_at).getTime()+60000>Date.now())return false;const remaining:Machine[]=await fly(`/apps/${app()}/machines`)??[];if(remaining.some(m=>m.config?.metadata?.oddhound_run_id===runId))return false;await settleBrowserCompute(runId);await getPool().query("UPDATE browser_allocations SET state='released' WHERE run_id=$1",[runId]);return true;}catch{return false;}}
  await getPool().query("UPDATE browser_machines SET state='terminating' WHERE run_id=$1",[runId]);
  try{await fly(`/apps/${row.app}/machines/${row.machine_id}?force=true`,'DELETE');const after=await fly(`/apps/${row.app}/machines/${row.machine_id}`);if(after&&after.state!=='destroyed')throw new Error('machine_deletion_unconfirmed');
    await getPool().query("UPDATE browser_machines SET state='terminated',deleted_at=now(),cleanup_error=NULL WHERE run_id=$1",[runId]);await settleBrowserCompute(runId);await getPool().query("UPDATE browser_allocations SET state='released' WHERE run_id=$1",[runId]);return true;
  }catch(error){await getPool().query('UPDATE browser_machines SET cleanup_error=$2 WHERE run_id=$1',[runId,(error as Error).message]);return false;}
}
export async function reapOrphans(){
  // Provider listing catches Machines created before a worker could persist their ID.
  const browserApp=app();const machines:Machine[]=await fly(`/apps/${browserApp}/machines`)??[];
  for(const machine of machines){const meta=machine.config?.metadata,runId=meta?.oddhound_run_id;if(!runId)continue;
    const deadline=Date.parse(meta.oddhound_expires_at);const row=(await getPool().query('SELECT status,lease_until FROM runs WHERE id=$1',[runId])).rows[0];
    if(!Number.isFinite(deadline)||deadline<Date.now()||!row||!['provisioning','running','waiting_for_input'].includes(row.status)||new Date(row.lease_until??0).getTime()<Date.now()){
      const tracked=(await getPool().query('SELECT 1 FROM browser_machines WHERE run_id=$1',[runId])).rowCount;
      if(tracked)await destroy(runId);else await fly(`/apps/${browserApp}/machines/${machine.id}?force=true`,'DELETE');
    }
  }
}
