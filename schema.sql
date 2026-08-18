-- Convenience schema for a fresh local database. Production changes are
-- applied from migrations/; keep this file equivalent to all migrations.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Runtime opt-out/takedown state, intentionally independent of users so a
-- future profile can be suppressed before its first OAuth or scheduler write.
CREATE TABLE profile_suppressions (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  suppressed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  week_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, week_key)
);

CREATE TABLE IF NOT EXISTS dispatches (
  user_id TEXT NOT NULL REFERENCES users(id),
  week_key TEXT NOT NULL,
  html TEXT NOT NULL DEFAULT "",
  generated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  r2_key TEXT,
  PRIMARY KEY(user_id, week_key)
);

CREATE TABLE IF NOT EXISTS spend (
  month_key TEXT PRIMARY KEY,
  usd_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS article_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  week_key TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating IN (-1, 1)),
  complaint TEXT,
  source TEXT NOT NULL DEFAULT 'human',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_feedback_rating
  ON article_feedback(rating, source);

CREATE TABLE IF NOT EXISTS generation_jobs (
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
  published_at INTEGER,
  schedule_key TEXT
);

CREATE INDEX IF NOT EXISTS generation_jobs_claim
  ON generation_jobs(status, lease_expires_at, created_at);

CREATE INDEX IF NOT EXISTS generation_jobs_expiry
  ON generation_jobs(status, created_at, lease_expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_one_live_job
  ON generation_jobs(user_id, week_key)
  WHERE status IN ('queued', 'collecting', 'writing', 'illustrating', 'validating', 'retryable_failed');

CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_scheduled_once
  ON generation_jobs(schedule_key)
  WHERE schedule_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS artifact_cleanup_jobs (
  job_id TEXT PRIMARY KEY REFERENCES generation_jobs(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT NOT NULL CHECK (length(last_error) BETWEEN 1 AND 500),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS artifact_cleanup_jobs_retry
  ON artifact_cleanup_jobs(updated_at, job_id);

CREATE TABLE IF NOT EXISTS edition_versions (
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
