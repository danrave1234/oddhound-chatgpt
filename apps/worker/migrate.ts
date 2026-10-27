import {runMigrations} from 'bullmq';
import {getPool} from '@oddhound/db';
const pool=getPool();await runMigrations(pool);console.log('BullMQ PostgreSQL schema ready');await pool.end();
