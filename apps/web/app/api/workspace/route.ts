import { NextResponse } from 'next/server';
import { workspace } from '../../../lib/store';
export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json(await workspace(),{headers:{'cache-control':'no-store'}});}
