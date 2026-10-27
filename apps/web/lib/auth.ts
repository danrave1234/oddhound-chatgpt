import { betterAuth } from 'better-auth';
import { getPool } from '@oddhound/db';
import { headers } from 'next/headers';

function createAuth(){return betterAuth({database:getPool(),baseURL:process.env.ODDHOUND_APP_URL??'http://localhost:3000',secret:process.env.BETTER_AUTH_SECRET!,socialProviders:{github:{clientId:process.env.GITHUB_CLIENT_ID!,clientSecret:process.env.GITHUB_CLIENT_SECRET!,scope:['user:email']}},trustedOrigins:[process.env.ODDHOUND_APP_URL??'http://localhost:3000'],advanced:{useSecureCookies:process.env.NODE_ENV==='production'}});}
let instance:ReturnType<typeof createAuth>|undefined;
export function authConfigured(){return Boolean(process.env.GITHUB_CLIENT_ID&&process.env.GITHUB_CLIENT_SECRET&&process.env.BETTER_AUTH_SECRET);}
export function auth(){if(!authConfigured())return null;return instance??=createAuth();}
export async function identity(){
  const h=await headers();
  if(process.env.NODE_ENV!=='production'&&process.env.ODDHOUND_LOCAL_WORKSPACE==='1'&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h.get('host')??''))return{id:'local-developer',name:'Local workspace',local:true};
  const session=await auth()?.api.getSession({headers:h});return session?{id:session.user.id,name:session.user.name,local:false}:null;
}
export async function requireIdentity(){const actor=await identity();if(!actor)throw new Error('sign_in_required');return actor;}
