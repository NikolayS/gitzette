-- gitzette D1 schema

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- github user id (string)
  username    TEXT NOT NULL UNIQUE,
  avatar_url  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- tracks weekly generation quota per user
CREATE TABLE IF NOT EXISTS generations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id),
  week_key      TEXT NOT NULL,           -- ISO week: "2026-W12"
  count         INTEGER NOT NULL DEFAULT 0,
  last_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, week_key)
);

-- stores the latest generated dispatch per user
CREATE TABLE IF NOT EXISTS dispatches (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  week_key    TEXT NOT NULL,
  html        TEXT NOT NULL,
  generated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- global monthly LLM spend tracker
CREATE TABLE IF NOT EXISTS spend (
  month_key   TEXT PRIMARY KEY,          -- "2026-03"
  usd_cents   INTEGER NOT NULL DEFAULT 0 -- track in cents to avoid float
);

-- sessions (simple token-based)
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER NOT NULL
);
