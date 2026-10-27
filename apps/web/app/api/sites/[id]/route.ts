import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireIdentity } from '../../../../lib/auth';
import { siteProof,verifySite } from '../../../../lib/store';
import { body,assertSameOrigin,failure } from '../../../../lib/http';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Context){try{const {id}=await params;z.uuid().parse(id);return NextResponse.json(await siteProof((await requireIdentity()).id,id),{headers:{'cache-control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request,{params}:Context){try{assertSameOrigin(request);const {id}=await params;z.uuid().parse(id);const {method}=z.object({method:z.enum(['dns','file','meta'])}).parse(await body(request));return NextResponse.json(await verifySite((await requireIdentity()).id,id,method));}catch(e){return failure(e);}}

export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){try{assertSameOrigin(request);const actor=await requireIdentity();const {id}=await context.params;z.uuid().parse(id);const {revokeSiteProof}=await import('../../../../../../packages/db/revocation');return NextResponse.json({revoked:true,...await revokeSiteProof(actor.id,id)});}catch(error){return failure(error);}}
