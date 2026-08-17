CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  requested_by TEXT NOT NULL REFERENCES users(id),
  week_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'collecting', 'writing', 'illustrating', 'validating',
    'published', 'retryable_failed', 'permanent_failed'
  )),
  attempt INTEGER NOT NULL DEFAULT 0,
  capacity_started_at INTEGER,
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_error TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  token_source TEXT NOT NULL DEFAULT 'none' CHECK (token_source IN ('none', 'estimated', 'provider')),
  image_count INTEGER NOT NULL DEFAULT 0,
  wall_time_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  published_at INTEGER
);

CREATE INDEX generation_jobs_claim
  ON generation_jobs(status, lease_expires_at, created_at);

CREATE UNIQUE INDEX generation_jobs_one_live_job
  ON generation_jobs(user_id, week_key)
  WHERE status IN ('queued', 'collecting', 'writing', 'illustrating', 'validating', 'retryable_failed');

CREATE TABLE edition_versions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES generation_jobs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  week_key TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  edition_json TEXT NOT NULL,
  image_count INTEGER NOT NULL,
  generator_version TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
