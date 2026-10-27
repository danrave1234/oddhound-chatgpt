import pg from 'pg';const pool=new pg.Pool({connectionString:process.env.FIXTURE_DATABASE_URL});
await pool.query(`CREATE TABLE IF NOT EXISTS fixture_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),username text UNIQUE NOT NULL,password_hash text NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS fixture_sessions(token_hash text PRIMARY KEY,account_id uuid REFERENCES fixture_accounts(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS fixture_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES fixture_accounts(id),name text NOT NULL,seats integer NOT NULL,status text NOT NULL DEFAULT 'confirmed',created_at timestamptz DEFAULT now());`);
console.log('Owned synthetic fixture tables ready');await pool.end();
