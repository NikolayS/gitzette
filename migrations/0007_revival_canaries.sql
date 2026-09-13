-- Bounded, owner-authorized revival: five canonical historical cases plus
-- the owner's last complete week. This only queues jobs; the isolated runner
-- must collect real evidence, generate/review images, and pass publication checks.
-- No profiles, sessions, artifacts, quotas, or scheduler flags are changed.
-- Missing/suppressed profiles and existing live/published jobs are not overridden.
-- An empty new installation is valid and queues nothing; operators must verify
-- all six profile/week outcomes after production cutover, not infer success here.
WITH targets(id, username, week_key) AS (VALUES
  ('6bfa9658-5c82-430c-90ad-2688335d2b63','nikolays','2026-W36'),
  ('b52c7c0d-1e40-438e-902d-a91d91384e63','nikolays','2026-W32'),
  ('2877a4f5-c2d7-4688-8fdc-ab5d61d6606f','steipete','2026-W14'),
  ('85a7fe4e-4e3b-4dcc-9ba4-a50e6f9ed4f2','torvalds','2026-W16'),
  ('818ca963-0666-465d-ae1e-d930a813c5bf','karpathy','2026-W20'),
  ('5ece0481-557e-45dd-9c12-a9b12d3190a5','physshell','2026-W30')
)
INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status)
SELECT targets.id, users.id, owner.id, targets.week_key, 'queued'
FROM targets
JOIN users ON users.username = targets.username COLLATE NOCASE
JOIN users owner ON owner.id = '1345402' AND owner.username = 'nikolays' COLLATE NOCASE
WHERE NOT EXISTS (SELECT 1 FROM profile_suppressions ps WHERE ps.username = users.username COLLATE NOCASE)
AND NOT EXISTS (SELECT 1 FROM profile_suppressions ps WHERE ps.username = owner.username COLLATE NOCASE)
AND NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = targets.id
  OR (j.user_id = users.id AND j.week_key = targets.week_key
      AND j.status IN ('queued','collecting','writing','illustrating','validating','retryable_failed','published')));
