-- Emergency publication kill switch. This table deliberately does not reference
-- users so an operator can suppress a GitHub username before it is first seen.
CREATE TABLE profile_suppressions (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  suppressed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
