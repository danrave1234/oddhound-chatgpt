import { NextResponse } from 'next/server';
import { runInput } from '@oddhound/contracts';
import { createRun } from '../../../lib/store';
import { requireIdentity } from '../../../lib/auth';
import { body,assertSameOrigin,failure } from '../../../lib/http';
export async function POST(request:Request){try{assertSameOrigin(request);const actor=await requireIdentity();const input=runInput.parse(await body(request));return NextResponse.json({run:await createRun(actor.id,input)},{status:201});}catch(error){return failure(error);}}
