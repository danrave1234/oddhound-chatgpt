import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getPool} from '@oddhound/db';
import {changeCredential} from '../../../../../../../packages/db/revocation';
import {requireIdentity} from '../../../../../lib/auth';
import {siteProof} from '../../../../../lib/store';
import {assertSameOrigin,body,failure} from '../../../../../lib/http';
type Context={params:Promise<{id:string}>};
async function owner(context:Context){const {id}=await context.params;z.uuid().parse(id);const actor=await requireIdentity();await siteProof(actor.id,id);return{id,actor};}
export async function GET(_r:Request,c:Context){try{const {id,actor}=await owner(c);const result=await getPool().query('SELECT id,reference,created_at FROM credentials WHERE site_id=$1 AND owner_id=$2 ORDER BY reference',[id,actor.id]);return NextResponse.json({credentials:result.rows},{headers:{'cache-control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(r:Request,c:Context){try{assertSameOrigin(r);const {id,actor}=await owner(c);const {reference,value}=z.object({reference:z.string().regex(/^[a-z0-9_.-]{1,80}$/),value:z.string().min(1).max(2000)}).parse(await body(r));await changeCredential(actor.id,id,reference,value);return NextResponse.json({saved:true},{status:201});}catch(e){return failure(e);}}
export async function DELETE(r:Request,c:Context){try{assertSameOrigin(r);const {id,actor}=await owner(c);const {reference}=z.object({reference:z.string().max(80)}).parse(await body(r));await changeCredential(actor.id,id,reference);return NextResponse.json({deleted:true});}catch(e){return failure(e);}}
