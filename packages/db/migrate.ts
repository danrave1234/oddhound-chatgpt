import { getPool } from './index';
const pool=getPool();
await pool.query(`
CREATE TABLE IF NOT EXISTS sites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id text NOT NULL,name text NOT NULL,origin text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('staging','production')),verification_token text NOT NULL,
 revision integer NOT NULL DEFAULT 1,verified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,origin));
CREATE TABLE IF NOT EXISTS runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id text NOT NULL,site_id uuid REFERENCES sites(id),
 goal text NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','provisioning','running','waiting_for_input','stopping','finalizing','completed','stopped','failed','blocked')),
 scope jsonb NOT NULL,actions integer NOT NULL DEFAULT 0,turns integer NOT NULL DEFAULT 0,
 spent_micros bigint NOT NULL DEFAULT 0 CHECK(spent_micros>=0),held_micros bigint NOT NULL DEFAULT 2000000 CHECK(held_micros>=0),
 unknown_usage boolean NOT NULL DEFAULT false,generation integer NOT NULL DEFAULT 1,stop_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,
 CHECK(spent_micros+held_micros<=2000000));
CREATE INDEX IF NOT EXISTS runs_owner_created ON runs(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS run_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,run_id uuid NOT NULL REFERENCES runs(id),kind text NOT NULL,message text NOT NULL,data jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS events_run_id ON run_events(run_id,id);
CREATE TABLE IF NOT EXISTS findings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES runs(id),title text NOT NULL,status text NOT NULL CHECK(status IN ('candidate','verifying','verified','inconclusive','dismissed')),lifecycle text CHECK(lifecycle IN ('open','fixed','regressed')),category text NOT NULL CHECK(category IN ('verified_issue','configuration_observation','needs_review','suggestion')),severity text NOT NULL,rule text NOT NULL,observed text NOT NULL,hypothesis text,evidence jsonb NOT NULL DEFAULT '{}',assertion_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public_budget(id text PRIMARY KEY CHECK(id='public'),kill_switch boolean NOT NULL DEFAULT false,lifetime_spent bigint NOT NULL DEFAULT 0,day_spent bigint NOT NULL DEFAULT 0,day date NOT NULL DEFAULT CURRENT_DATE,held bigint NOT NULL DEFAULT 0,CHECK(lifetime_spent+held<=50000000),CHECK(day_spent+held<=7000000));
INSERT INTO public_budget(id) VALUES('public') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS run_outbox(run_id uuid PRIMARY KEY REFERENCES runs(id),created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz);
CREATE TABLE IF NOT EXISTS action_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES runs(id),generation integer NOT NULL,action_key text NOT NULL,state text NOT NULL,result jsonb,created_at timestamptz DEFAULT now(),UNIQUE(run_id,action_key));
CREATE TABLE IF NOT EXISTS call_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES runs(id),reserved_micros bigint NOT NULL,state text NOT NULL,usage jsonb,created_at timestamptz DEFAULT now());
ALTER TABLE sites ADD COLUMN IF NOT EXISTS verification_method text CHECK(verification_method IN ('dns','file','meta'));
ALTER TABLE runs ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE call_ledger ADD COLUMN IF NOT EXISTS actual_micros bigint;
ALTER TABLE call_ledger ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_call ON call_ledger(run_id) WHERE state='reserved';
CREATE TABLE IF NOT EXISTS browser_machines(run_id uuid PRIMARY KEY REFERENCES runs(id),machine_id text UNIQUE NOT NULL,app text NOT NULL,image text NOT NULL,private_ip text NOT NULL,control_cipher text NOT NULL,state text NOT NULL CHECK(state IN ('provisioning','ready','active','terminating','terminated')),sandbox jsonb,expires_at timestamptz NOT NULL,deleted_at timestamptz,cleanup_error text);
CREATE TABLE IF NOT EXISTS credentials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES sites(id),owner_id text NOT NULL,reference text NOT NULL,secret_cipher text NOT NULL,created_at timestamptz DEFAULT now(),UNIQUE(site_id,reference));
CREATE TABLE IF NOT EXISTS artifacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES runs(id),media_type text NOT NULL,bytes integer NOT NULL,sha256 text NOT NULL,storage_key text NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS assertion_retests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),finding_id uuid NOT NULL REFERENCES findings(id),assertion_version text NOT NULL,assertion_hash text NOT NULL,status text NOT NULL CHECK(status IN ('not_run','passed','failed','blocked','inconclusive','skipped')),evidence jsonb NOT NULL DEFAULT '{}',created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS worker_heartbeats(id text PRIMARY KEY,last_seen timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS browser_allocations(run_id uuid PRIMARY KEY REFERENCES runs(id),state text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),cleanup_error text);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'ready' CHECK(state IN ('staged','ready'));
ALTER TABLE runs ADD COLUMN IF NOT EXISTS funding_account text NOT NULL DEFAULT 'public' CHECK(funding_account IN ('public','development','judge'));
ALTER TABLE action_ledger ADD COLUMN IF NOT EXISTS action jsonb;
CREATE TABLE IF NOT EXISTS model_funds(id text PRIMARY KEY CHECK(id IN ('development','judge')),limit_micros bigint NOT NULL CHECK(limit_micros>=0),spent_micros bigint NOT NULL DEFAULT 0 CHECK(spent_micros>=0),held_micros bigint NOT NULL DEFAULT 0 CHECK(held_micros>=0),CHECK(spent_micros+held_micros<=limit_micros),CHECK((id='development' AND limit_micros<=85000000) OR (id='judge' AND limit_micros<=15000000)));
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS quota_refunded boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION oddhound_freeze_run_contract() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
IF NEW.scope IS DISTINCT FROM OLD.scope OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.goal IS DISTINCT FROM OLD.goal THEN RAISE EXCEPTION 'run_contract_is_immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS freeze_run_contract ON runs;
CREATE TRIGGER freeze_run_contract BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION oddhound_freeze_run_contract();
`);
console.log('Oddhound application tables ready');await pool.end();
