-- Baseline snapshot verified read-only against production D1 on 2026-08-15.
-- These statements intentionally no-op on existing production tables; all new
-- durable-runner objects are created independently by 0001_generation_queue.sql.
-- scripts/check-schema.sh compares comments and identifier quoting inside
-- CREATE bodies verbatim; keep annotations like this above each statement.
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
