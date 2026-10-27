import {NextResponse} from 'next/server';import {z} from 'zod';import {getPool} from '@oddhound/db';import {runInput} from '@oddhound/contracts';
import {requireIdentity} from '../../../../../lib/auth';import {body,assertSameOrigin,failure} from '../../../../../lib/http';import {createRun} from '../../../../../lib/store';
import {startOwnedAssertion} from '../../../../../lib/owned-demo';import {runDetail} from '../../../../../lib/store';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
  assertSameOrigin(request);const owner=await requireIdentity(),{id}=await context.params,input=z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),acknowledgeReplayWrites:z.literal(true),correctedDemo:z.boolean().optional()}).strict().parse(await body(request));
  const r=(await getPool().query('SELECT r.* FROM findings f JOIN runs r ON r.id=f.run_id WHERE f.id=$1 AND r.owner_id=$2',[id,owner.id])).rows[0];if(!r)throw new Error('not_found');
  if(owner.local&&r.scope.interactiveDemo){const runId=await startOwnedAssertion(owner.id,id,input.hash,input.correctedDemo);return NextResponse.json({run:(await runDetail(owner.id,runId)).run},{status:201});}
  if(input.correctedDemo)throw new Error('owned_demo_required');
  if(!r.site_id||!r.scope.authorizationSnapshot)throw new Error('fresh_owner_authorization_required');
  const contract=runInput.parse({siteId:r.site_id,goal:'Replay the unchanged saved assertion and its valid control.',writes:r.scope.writes,registration:r.scope.registration,rules:r.scope.rules,authorization:r.scope.authorizationSnapshot.grant});
  return NextResponse.json({run:await createRun(owner.id,contract,{findingId:id,hash:input.hash})},{status:201});
}catch(error){return failure(error);}}
