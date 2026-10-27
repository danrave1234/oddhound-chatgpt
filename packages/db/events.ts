import {getPool} from './index';

// Polling and SSE carry timeline/frame metadata. Full observations remain saved
// and are fetched one at a time through the owner-bound detail endpoint.
export const eventDataProjection=`CASE WHEN kind IN ('browser.action','browser.observation') THEN
  jsonb_strip_nulls(jsonb_build_object('action',data->'action','key',data->'key','url',data->'url','title',data->'title',
    'actor',data->'actor','device',data->'device','artifactId',data->'artifactId','screenshotSuppressed',data->'screenshotSuppressed',
    'blocked',data->'blocked','detailsAvailable',true)) ELSE data END`;

export async function readEvent(owner:string,runId:string,eventId:number){
  const row=(await getPool().query(`SELECT e.id,e.run_id,e.kind,e.message,e.created_at,
    CASE WHEN octet_length(e.data::text)<=131072 THEN e.data ELSE NULL END data
    FROM run_events e JOIN runs r ON r.id=e.run_id WHERE e.id=$1 AND e.run_id=$2 AND r.owner_id=$3`,[eventId,runId,owner])).rows[0];
  if(!row)throw new Error('not_found');if(row.data===null)throw new Error('event_data_limit');
  return{id:Number(row.id),runId:row.run_id,kind:row.kind,message:row.message,data:row.data,createdAt:new Date(row.created_at).toISOString()};
}
