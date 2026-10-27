import {randomBytes} from 'node:crypto';import type {PoolClient} from 'pg';import {ACTIVE_STATUSES,credentialReference} from '@oddhound/contracts';
import {transaction} from './index';import {releaseFunding} from './budget';import {seal} from './vault';
async function fence(c:PoolClient,rows:any[],reason:string){for(const r of rows){
  if(r.status==='queued'){
    await releaseFunding(c,r.funding_account,Number(r.held_micros));await c.query("UPDATE runs SET status='blocked',stop_reason=$2,generation=generation+1,held_micros=0,finished_at=now(),quota_refunded=true WHERE id=$1",[r.id,reason]);
  }else await c.query("UPDATE runs SET status='stopping',stop_reason=$2,generation=generation+1 WHERE id=$1",[r.id,reason]);
  await c.query("INSERT INTO run_events(run_id,kind,message,data) VALUES($1,'authorization.revoked','Authorization changed; new run actions are fenced.',$2)",[r.id,{reason}]);
}}
export async function changeCredential(owner:string,siteId:string,reference:string,value?:string){
  credentialReference.parse(reference);if(value!==undefined&&(value.length<1||value.length>2000))throw new Error('invalid_credential');
  const cipher=value===undefined?undefined:seal(value,`${owner}:${siteId}:${reference}`);
  return transaction(async c=>{
    await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
    if(!(await c.query('SELECT id FROM sites WHERE id=$1 AND owner_id=$2 FOR SHARE',[siteId,owner])).rowCount)throw new Error('not_found');
    if(cipher===undefined)await c.query('DELETE FROM credentials WHERE site_id=$1 AND owner_id=$2 AND reference=$3',[siteId,owner,reference]);
    else await c.query('INSERT INTO credentials(site_id,owner_id,reference,secret_cipher) VALUES($1,$2,$3,$4) ON CONFLICT(site_id,reference) DO UPDATE SET secret_cipher=EXCLUDED.secret_cipher,revision=credentials.revision+1',[siteId,owner,reference,cipher]);
    const affected=await c.query("SELECT * FROM runs WHERE owner_id=$1 AND site_id=$2 AND status=ANY($3) AND (scope->'authorizationSnapshot'->'credentialBindings') @> $4::jsonb FOR UPDATE",[owner,siteId,ACTIVE_STATUSES,JSON.stringify([{reference}])]);
    await fence(c,affected.rows,cipher===undefined?'credential_revoked':'credential_rotated');return{affectedRuns:affected.rowCount};
  });
}
export async function revokeSiteProof(owner:string,siteId:string){return transaction(async c=>{
  await c.query("SELECT id FROM public_budget WHERE id='public' FOR UPDATE");
  if(!(await c.query('UPDATE sites SET revision=revision+1,verified_at=NULL,verification_method=NULL,verification_token=$3 WHERE id=$1 AND owner_id=$2 RETURNING id',[siteId,owner,randomBytes(32).toString('hex')])).rowCount)throw new Error('not_found');
  const affected=await c.query("SELECT * FROM runs WHERE owner_id=$1 AND status=ANY($2) AND (site_id=$3 OR scope->'apiOrigins' @> $4::jsonb) FOR UPDATE",[owner,ACTIVE_STATUSES,siteId,JSON.stringify([{siteId}])]);
  await fence(c,affected.rows,'site_verification_revoked');return{affectedRuns:affected.rowCount};
});}
