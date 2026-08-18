ALTER TABLE generation_jobs ADD COLUMN schedule_key TEXT;

-- Keep scheduled keys unique across every terminal state so trigger redelivery
-- is idempotent; manual jobs use NULL and are intentionally outside the index.
CREATE UNIQUE INDEX generation_jobs_scheduled_once
  ON generation_jobs(schedule_key)
  WHERE schedule_key IS NOT NULL;
