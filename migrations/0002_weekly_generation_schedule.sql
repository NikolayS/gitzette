ALTER TABLE generation_jobs ADD COLUMN schedule_key TEXT;

DELETE FROM dispatches WHERE week_key = 'generating';

CREATE UNIQUE INDEX generation_jobs_scheduled_once
  ON generation_jobs(schedule_key);
