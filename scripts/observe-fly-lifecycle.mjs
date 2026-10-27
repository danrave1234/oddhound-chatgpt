// Read-only manual observer. Start before the explicit targetless Fly canary.
import {parseEnv} from 'node:util';import {readFile,writeFile} from 'node:fs/promises';import {createRequire} from 'node:module';
const pg=createRequire(new URL('../packages/db/package.json',import.meta.url))('pg'),hosted=parseEnv(await readFile('.env.hosted','utf8'));
const url=new URL(hosted.DATABASE_URL_UNPOOLED);url.searchParams.set('sslmode','verify-full');
const pool=new pg.Pool({connectionString:url.toString(),max:1});let controller=process.argv[2];if(controller!=='next'&&!/^[a-f0-9]{14}$/.test(controller??''))throw new Error('controller_id_required');
const token=(await readFile('data/fly-worker-controller-token.txt','utf8')).trim(),started=Date.now();
let run,deletedBeforeGuestExpiry=false,capacityHeldAfterDeletion=false,machineId,readyEvidence,exitRecorded=false;
async function machines(){const r=await fetch('https://api.machines.dev/v1/apps/oddhound-chatgpt-browser/machines',{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`provider_inventory_${r.status}`);return r.json();}
try{
  while(Date.now()-started<360000){
    if(controller==='next'){run=(await pool.query("SELECT * FROM runs WHERE owner_id='engineering-lifecycle-probe' AND scope->>'canaryOnly'='true' AND created_at>=$1 ORDER BY created_at DESC LIMIT 1",[new Date(started)])).rows[0];if(run)controller=run.lease_owner;}
    else run=(await pool.query("SELECT * FROM runs WHERE lease_owner=$1 AND scope->>'canaryOnly'='true' ORDER BY created_at DESC LIMIT 1",[controller])).rows[0];
    if(run){
      const guests=(await machines()).filter(m=>m.config?.metadata?.oddhound_run_id===run.id);if(guests.length)machineId=guests[0].id;
      readyEvidence=(await pool.query("SELECT data FROM run_events WHERE run_id=$1 AND kind='runtime_probe.browser_ready'",[run.id])).rows[0]?.data;
      const exit=(await pool.query("SELECT 1 FROM run_events WHERE run_id=$1 AND kind='runtime_probe.controller_exit'",[run.id])).rowCount;
      if(exit)exitRecorded=true;
      if(exit&&readyEvidence&&guests.length===0&&Date.now()<new Date(run.expires_at).getTime()){deletedBeforeGuestExpiry=true;capacityHeldAfterDeletion=['provisioning','running','stopping','finalizing'].includes(run.status);}
      if(['completed','blocked','failed','stopped'].includes(run.status))break;
    }
    await new Promise(r=>setTimeout(r,4000));
  }
  const machinesRemaining=run?(await machines()).filter(m=>m.config?.metadata?.oddhound_run_id===run.id).length:-1;
  const machineRows=run?Number((await pool.query('SELECT count(*) FROM browser_machines WHERE run_id=$1',[run.id])).rows[0].count):-1;
  const reaped=run?Boolean((await pool.query("SELECT 1 FROM run_events WHERE run_id=$1 AND kind='run.reaped'",[run.id])).rowCount):false;
  const result={createdAt:new Date().toISOString(),controllerMachineId:controller,runId:run?.id,browserMachineId:machineId,sandbox:readyEvidence?.sandbox,image:readyEvidence?.image,modelInference:false,siteNavigation:false,controllerExitMarkerRecorded:exitRecorded,machineRowsPersisted:machineRows,deletedBeforeGuestExpiry,capacityHeldAfterDeletion,finalStatus:run?.status,stopReason:run?.stop_reason,reaperFinalizationRecorded:reaped,machinesRemaining,actions:run?.actions,turns:run?.turns,passed:Boolean(run&&readyEvidence?.sandbox?.enabled&&machineRows===0&&deletedBeforeGuestExpiry&&capacityHeldAfterDeletion&&reaped&&run.status==='blocked'&&machinesRemaining===0&&run.actions===0&&run.turns===0),claims:'Real targetless deployed controller exit before browser_machines persistence; independent production reaper and bounded unknown-allocation hold. No target initialization, model call, full runtime or public-release claim.'};
  if(run?.finished_at){const a=(await pool.query('SELECT expires_at,state FROM browser_allocations WHERE run_id=$1',[run.id])).rows[0];result.expectedHoldUntil=new Date(new Date(a.expires_at).getTime()+60000).toISOString();result.finalizedAt=new Date(run.finished_at).toISOString();result.releasedAfterUnknownWindow=new Date(run.finished_at).getTime()>=new Date(a.expires_at).getTime()+60000;result.allocationReleased=a.state==='released';result.passed=result.passed&&result.releasedAfterUnknownWindow&&result.allocationReleased;}
  await writeFile('docs/evidence/fly-lifecycle-latest.json',JSON.stringify(result,null,2)+'\n');if(run)await writeFile(`docs/evidence/fly-lifecycle-${run.id}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}finally{await pool.end();}
