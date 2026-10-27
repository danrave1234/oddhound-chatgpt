import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { randomBytes } from 'node:crypto';
import { getPool } from '@oddhound/db';
const pool=getPool();
const instance=betterAuth({database:pool,baseURL:process.env.ODDHOUND_APP_URL??'http://localhost:3000',secret:process.env.BETTER_AUTH_SECRET??randomBytes(32).toString('hex')});
const {runMigrations}=await getMigrations(instance.options);await runMigrations();
console.log('GitHub authentication schema ready');await pool.end();
