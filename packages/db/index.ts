import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
const globals=globalThis as unknown as { oddhoundPool?:pg.Pool };
export function openPool(connectionString:string){return new pg.Pool({connectionString,max:10,connectionTimeoutMillis:2500,idleTimeoutMillis:20000});}
export function getPool(){if(!process.env.DATABASE_URL)throw new Error('database_not_configured');return globals.oddhoundPool??=openPool(process.env.DATABASE_URL);}
export function database(){return drizzle(getPool(),{schema});}
export async function transaction<T>(fn:(client:pg.PoolClient)=>Promise<T>){const c=await getPool().connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
export async function event(runId:string,kind:string,message:string,data:Record<string,unknown>={}){await getPool().query('INSERT INTO run_events(run_id,kind,message,data) VALUES($1,$2,$3,$4)',[runId,kind,message,data]);}
export * from './schema';
