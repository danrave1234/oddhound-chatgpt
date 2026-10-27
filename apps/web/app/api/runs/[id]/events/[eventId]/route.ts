import {z} from 'zod';
import {readEvent} from '../../../../../../../../packages/db/events';
import {requireIdentity} from '../../../../../../lib/auth';
import {failure} from '../../../../../../lib/http';
export async function GET(_request:Request,{params}:{params:Promise<{id:string;eventId:string}>}){
  try{const {id,eventId}=await params;z.uuid().parse(id);const number=z.coerce.number().int().positive().safe().parse(eventId);
    return Response.json(await readEvent((await requireIdentity()).id,id,number),{headers:{'cache-control':'private, no-store'}});
  }catch(error){return failure(error);}
}
