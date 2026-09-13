-- One owner-authorized feature-restoration edition. Deployment must pause the
-- old runner until the stats-aware runner is installed. Existing live content
-- stays untouched until the normal runner validates and atomically publishes.
-- No quota, suppression, scheduler, identity, or artifact changes.
INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status)
SELECT 'restoration-nikolays-w36-20260913', id, id, '2026-W36', 'queued'
FROM users
WHERE id='1345402' AND username='nikolays' COLLATE NOCASE
AND NOT EXISTS (SELECT 1 FROM profile_suppressions WHERE username='nikolays' COLLATE NOCASE)
AND NOT EXISTS (SELECT 1 FROM generation_jobs WHERE id='restoration-nikolays-w36-20260913'
 OR (user_id='1345402' AND week_key='2026-W36'
 AND status IN ('queued','collecting','writing','illustrating','validating','retryable_failed')));
