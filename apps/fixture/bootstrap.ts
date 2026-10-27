import {getPool} from '@oddhound/db';
if(process.env.ODDHOUND_LOCAL_WORKSPACE!=='1'||process.env.NODE_ENV==='production')throw new Error('Local development bootstrap only');
const pool=getPool();
if(!(await pool.query("SELECT 1 FROM pg_roles WHERE rolname='oddhound_fixture'")).rowCount)await pool.query("CREATE ROLE oddhound_fixture LOGIN PASSWORD 'local-fixture-only'");
if(!(await pool.query("SELECT 1 FROM pg_database WHERE datname='oddhound_fixture'")).rowCount)await pool.query('CREATE DATABASE oddhound_fixture OWNER oddhound_fixture');
console.log('Dedicated local fixture database ready; it does not use the application database role');await pool.end();
