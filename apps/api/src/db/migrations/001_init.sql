CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  identifiers jsonb NOT NULL,
  schedule_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  trigger text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued',
  mode text NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  params jsonb NOT NULL DEFAULT '{}',
  versions jsonb NOT NULL DEFAULT '{}',
  steps jsonb NOT NULL DEFAULT '[]',
  request_log jsonb NOT NULL DEFAULT '[]',
  summary jsonb,
  conclusions jsonb,
  diff jsonb,
  ai_summary text,
  error text,
  UNIQUE (case_id, seq)
);

-- Pobrane źródła (dowody) z pełną proweniencją.
CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  url text NOT NULL,
  final_url text,
  source_id text NOT NULL,
  source_name text NOT NULL,
  category text NOT NULL,
  discovery text NOT NULL,
  discovered_via text,
  retrieved_at timestamptz NOT NULL,
  http_status integer,
  content_type text,
  content_sha256 text,
  bytes integer,
  adapter text,
  title text,
  raw text,
  identity jsonb,
  meta jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS artifacts_run ON artifacts(run_id);

CREATE TABLE IF NOT EXISTS findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  chain text NOT NULL,
  address text NOT NULL,
  status text NOT NULL,
  score integer NOT NULL,
  tier text NOT NULL,
  hits jsonb NOT NULL,
  occurrences jsonb NOT NULL,
  exclusion jsonb,
  label jsonb,
  address_info jsonb,
  validation text,
  format text
);
CREATE INDEX IF NOT EXISTS findings_run ON findings(run_id);
CREATE INDEX IF NOT EXISTS findings_address ON findings(lower(address));

CREATE TABLE IF NOT EXISTS chain_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  chain text NOT NULL,
  address text NOT NULL,
  provider text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  metrics jsonb NOT NULL,
  indicators jsonb NOT NULL,
  flows jsonb NOT NULL,
  cash_out_level text NOT NULL
);
CREATE INDEX IF NOT EXISTS chain_reports_run ON chain_reports(run_id);
