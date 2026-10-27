import {test} from 'node:test';import assert from 'node:assert/strict';import {poolConnectionString} from '../packages/db';
test('production and hosted Neon connections require full TLS verification while local development stays explicit',()=>{
  assert.equal(new URL(poolConnectionString('postgres://synthetic:example@db/test?sslmode=disable',true)).searchParams.get('sslmode'),'verify-full');
  assert.equal(new URL(poolConnectionString('postgres://synthetic:example@ep-test.neon.tech/test?sslmode=no-verify',false)).searchParams.get('sslmode'),'verify-full');
  assert.equal(new URL(poolConnectionString('postgres://synthetic:example@db/test?sslmode=disable',false)).searchParams.get('sslmode'),'disable');
  assert.throws(()=>poolConnectionString('https://owned.example/',true),/invalid_database_scheme/);
});
