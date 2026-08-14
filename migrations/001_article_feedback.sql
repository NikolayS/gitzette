CREATE TABLE IF NOT EXISTS article_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  week_key TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating IN (-1, 1)),
  complaint TEXT,
  source TEXT NOT NULL DEFAULT 'human',  -- 'human' | 'model'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON article_feedback(rating, source);
