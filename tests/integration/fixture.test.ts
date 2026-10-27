import {test} from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import pg from 'pg';
import {migrateFixture} from '../../apps/fixture/schema';

test('two fixture servers can migrate a fresh schema concurrently without losing state',async()=>{
  const connectionString=process.env.DATABASE_URL;
  if(!connectionString||!new URL(connectionString).pathname.endsWith('_test'))throw new Error('Dedicated _test database required');
  const schema=`fixture_migration_${randomBytes(8).toString('hex')}`,admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`,max:2});
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);
    await Promise.all([migrateFixture(pool),migrateFixture(pool)]);
    const account=(await pool.query("INSERT INTO fixture_accounts(username,password_hash) VALUES('synthetic','test-only-hash') RETURNING id")).rows[0];
    await migrateFixture(pool);
    assert.equal((await pool.query('SELECT id FROM fixture_accounts')).rows[0].id,account.id);
    assert.equal((await admin.query('SELECT count(*) FROM information_schema.tables WHERE table_schema=$1',[schema])).rows[0].count,'4');
  }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
