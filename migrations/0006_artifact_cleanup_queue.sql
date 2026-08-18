CREATE TABLE artifact_cleanup_jobs (
  job_id TEXT PRIMARY KEY REFERENCES generation_jobs(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT NOT NULL CHECK (length(last_error) BETWEEN 1 AND 500),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX artifact_cleanup_jobs_retry
  ON artifact_cleanup_jobs(updated_at, job_id);
