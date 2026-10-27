import pg from 'pg';import {migrateFixture} from './schema';
const pool=new pg.Pool({connectionString:process.env.FIXTURE_DATABASE_URL});
try{await migrateFixture(pool);console.log('Owned synthetic fixture tables ready');}
finally{await pool.end();}
