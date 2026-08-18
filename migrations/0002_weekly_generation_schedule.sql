ALTER TABLE generation_jobs ADD COLUMN schedule_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_scheduled_once
  ON generation_jobs(schedule_key)
  WHERE schedule_key IS NOT NULL;
