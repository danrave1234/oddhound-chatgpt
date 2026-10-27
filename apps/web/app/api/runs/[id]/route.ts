import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runDetail,stopRun } from '../../../../lib/store';
import { requireIdentity } from '../../../../lib/auth';
import { assertSameOrigin,failure } from '../../../../lib/http';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Context){try{const {id}=await params;z.uuid().parse(id);return NextResponse.json(await runDetail((await requireIdentity()).id,id),{headers:{'cache-control':'no-store'}});}catch(error){return failure(error);}}
export async function DELETE(request:Request,{params}:Context){try{assertSameOrigin(request);const {id}=await params;z.uuid().parse(id);await stopRun((await requireIdentity()).id,id);return NextResponse.json({stopped:true});}catch(error){return failure(error);}}
