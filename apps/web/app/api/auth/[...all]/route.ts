import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '../../../../lib/auth';
export async function GET(request:Request){const instance=auth();if(!instance)return Response.json({error:'github_not_configured'},{status:503});return toNextJsHandler(instance).GET(request);}
export async function POST(request:Request){const instance=auth();if(!instance)return Response.json({error:'github_not_configured'},{status:503});return toNextJsHandler(instance).POST(request);}
