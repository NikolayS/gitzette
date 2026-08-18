-- The committed 2026-08-15 production capture is schema-only and therefore
-- contains no data-row count. A fresh read-only production query on 2026-08-18
-- found exactly one legacy `generating` sentinel, with no HTML and no R2 key.
-- This migration expects zero afterward and refuses to delete a backed object.
DELETE FROM dispatches
WHERE week_key = 'generating'
  AND r2_key IS NULL
  AND html = '';
