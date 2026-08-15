-- Convenience schema for a fresh local database. Production changes are
-- applied from migrations/; keep this file equivalent to all migrations.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
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
  r2_key TEXT,
  generated_at INTEGER NOT NULL DEFAULT (unixepoch()),
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
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  published_at INTEGER
);

CREATE INDEX IF NOT EXISTS generation_jobs_claim
  ON generation_jobs(status, lease_expires_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_one_live_job
  ON generation_jobs(user_id, week_key)
  WHERE status IN ('queued', 'collecting', 'writing', 'illustrating', 'validating', 'retryable_failed');

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
