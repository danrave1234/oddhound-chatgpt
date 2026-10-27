import { z } from 'zod';
import { getPool } from '@oddhound/db';
import { requireIdentity } from '../../../../../lib/auth';
import { failure } from '../../../../../lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id}=await params;z.uuid().parse(id);const actor=await requireIdentity();const owned=await getPool().query('SELECT id FROM runs WHERE id=$1 AND owner_id=$2',[id,actor.id]);if(!owned.rowCount)throw new Error('not_found');
    let after=Number(request.headers.get('last-event-id')??new URL(request.url).searchParams.get('after')??0);if(!Number.isSafeInteger(after)||after<0)after=0;
    const encoder=new TextEncoder();let stopped=false;let timer:ReturnType<typeof setTimeout>|undefined;let cycles=0;
    const stream=new ReadableStream({async start(controller){const poll=async()=>{if(stopped)return;try{const result=await getPool().query('SELECT id,kind,message,data,created_at FROM run_events WHERE run_id=$1 AND id>$2 ORDER BY id LIMIT 100',[id,after]);for(const row of result.rows){after=Number(row.id);controller.enqueue(encoder.encode(`id: ${after}\ndata: ${JSON.stringify(row)}\n\n`));}controller.enqueue(encoder.encode(': heartbeat\n\n'));cycles++;if(cycles>=25){stopped=true;controller.close();return;}timer=setTimeout(()=>void poll(),1000);}catch{stopped=true;controller.error(new Error('event_connection_closed'));}};await poll();},cancel(){stopped=true;clearTimeout(timer);}});
    request.signal.addEventListener('abort',()=>{stopped=true;clearTimeout(timer);},{once:true});return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','x-accel-buffering':'no'}});
  }catch(e){return failure(e);}
}
