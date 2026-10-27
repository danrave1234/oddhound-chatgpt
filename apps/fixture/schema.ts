import type {Pool} from 'pg';

export async function migrateFixture(pool:Pool){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '20s'");
    await client.query('SELECT pg_advisory_xact_lock(182411, 1)');
    await client.query(`CREATE TABLE IF NOT EXISTS fixture_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),username text UNIQUE NOT NULL,password_hash text NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS fixture_sessions(token_hash text PRIMARY KEY,account_id uuid REFERENCES fixture_accounts(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS fixture_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES fixture_accounts(id),name text NOT NULL,seats integer NOT NULL,status text NOT NULL DEFAULT 'confirmed',created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS fixture_policy_requests(nonce text PRIMARY KEY,origin text NOT NULL,path text NOT NULL,method text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
