# Fixed-scope historical catch-up

The original August revival archive is **184 editions**: completed ISO weeks
2026-W10 through W32 for NikolayS, torvalds, steipete, karpathy, DHH, mitchellh,
dcramer, and simonw. This does not expand each week or create missing accounts.

`ARCHIVE_BACKFILL_ENABLED=true` lets an authenticated idle pull-runner claim
request enqueue one missing archive edition. The next ordinary claim processes
it using the unchanged collection, model, image validation, lease, publication,
and failure paths. Normal jobs have priority over the archive namespace.

Existing published editions are kept, except seven explicitly audited legacy
pages with fewer than two pictures. Those are regenerated once through the same
validation path; successful new-pipeline publications are never replaced by the
backfill. A failed attempt preserves the previous edition. Runtime suppressions,
registry removals, absent profiles, and absent/wrong owner identity block work.
No prompt, target, model, credential, or file path can be supplied by a caller.

The normal rolling global generation limit remains 100. Archive reservations
stop ten slots below that limit, including outstanding queued reservations,
leaving space for the nine weekly profiles and interactive work. Archive jobs
still count in existing generation accounting; no public quota is raised or
removed. Only one new job is queued at a time, avoiding an archive queue that
ages out while waiting for budget. When the rolling budget becomes available,
idle claims automatically resume catch-up; no new release or manual enqueue is
needed. A normal generation burst can still consume the reserved slots.

Each target has a fixed UUID. After its normal maximum attempts, a terminally
failed archive job is not automatically re-created in an endless retry loop.
Investigate and recover such a job through the existing authenticated admin
workflow. Fully populated targets produce no further work. Set the flag false
to stop new archive enqueueing without stopping normal generation or scheduling.

## Verification

- `src/archive-backfill.test.ts` executes the actual enqueue SQL on the complete
  migration schema and tests exact scope, owner/suppression boundaries, existing
  publications, repair exceptions, terminal attempts, reservations, rolling-window
  resumption, and the authenticated Hono claim route's normal-job priority.
- The general Worker/D1/R2 E2E uses synthetic owner `1`, so explicitly disables
  this operator-only fixed-owner task while testing the unchanged publish path.
- After deployment, run the required site smoke test immediately and after every
  observed publication. Verify new public profile/week pages and their images.
- Archive completion means all 184 targets are publicly readable and the audited
  legacy repairs passed real generation; a configured flag is not completion.
  Record missing/failed targets separately. The backlog is larger than one
  rolling-week budget, so do not promise same-day full completion.

The insertion statement atomically permits only one outstanding archive job. Retryable failures reserve that slot until normal retry/expiry handling makes the job terminal; concurrent idle claims cannot accumulate an archive queue.
