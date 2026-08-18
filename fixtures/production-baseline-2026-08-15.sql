-- Canonical SQL reconstruction of pre-migration production D1 sqlite_master,
-- captured 2026-08-15. It is not a byte-for-byte sqlite_master export. The
-- regeneration command and normalization rules are documented in
-- docs/production-migrations.md. This is a CI fixture only; Wrangler must never
-- apply it remotely.
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, avatar_url TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE generations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), week_key TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(user_id, week_key));
CREATE TABLE "dispatches" (user_id TEXT NOT NULL REFERENCES users(id), week_key TEXT NOT NULL, html TEXT NOT NULL DEFAULT "", generated_at INTEGER NOT NULL DEFAULT (unixepoch()), r2_key TEXT, PRIMARY KEY (user_id, week_key));
CREATE TABLE spend (month_key TEXT PRIMARY KEY, usd_cents INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()), expires_at INTEGER NOT NULL);
CREATE TABLE article_feedback (
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
CREATE INDEX idx_feedback_rating ON article_feedback(rating, source);
