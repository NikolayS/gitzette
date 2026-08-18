-- GitHub usernames are case-insensitive. normalizeGitHubUsername now lowercases
-- every write and route lookup; this one-way backfill canonicalizes older rows.
-- Abort before mutation when two historical user ids would collide.
CREATE TABLE _github_username_normalization_guard (
  collision_count INTEGER NOT NULL CHECK (collision_count = 0)
);

INSERT INTO _github_username_normalization_guard (collision_count)
SELECT COUNT(*)
FROM (
  SELECT lower(username)
  FROM users
  GROUP BY lower(username)
  HAVING COUNT(*) > 1
);

UPDATE users SET username = lower(username) WHERE username <> lower(username);
-- Feedback usernames are labels, not unique identities, so duplicate labels are safe.
UPDATE article_feedback SET username = lower(username) WHERE username <> lower(username);

DROP TABLE _github_username_normalization_guard;
