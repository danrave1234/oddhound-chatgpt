import { NextResponse } from 'next/server';
import { siteInput } from '@oddhound/contracts';
import { addSite } from '../../../lib/store';
import { requireIdentity } from '../../../lib/auth';
import { body,assertSameOrigin,failure } from '../../../lib/http';
export async function POST(request:Request){try{assertSameOrigin(request);const actor=await requireIdentity();const input=siteInput.parse(await body(request));return NextResponse.json({site:await addSite(actor.id,input)},{status:201});}catch(error){return failure(error);}}
