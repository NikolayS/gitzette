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

