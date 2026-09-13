# Restore the dispatch feature set

Acceptance reference: `https://gitzette.online/nikolays/2026-W15` at 1280px.

- W15-sized story column and populated 340px statistics sidebar.
- Weekly public commit totals; independently counted opened and merged PRs.
- Releases scoped to discovered public contribution repositories.
- Per-repository commit chart; current stars clearly dated, not historical stars.
- Activity-proportionate 2–8 stories; 2 illustrations for two stories, 3 otherwise.
- Text wraps around illustrations; compact source disclosures; phone stacking.

## Coordinated cutover

1. Finish local full-suite and real illustrated W36 canary; inspect desktop/phone.
2. Pass hosted CI and exact-commit independent review; use protected merge.
3. Pause `gitzette-runner.service` before approving the Worker deploy. Keep the
   inference broker and served editions running. Wait for its current job to
   finish if possible; do not cancel or replace a live generation job.
4. Deploy Worker. Migration 0008 queues one W36 repair if eligible, without
   modifying its existing published version, quotas, suppressions or schedules.
5. Immediately run `bash /tmp/gl-dispatch/dispatch/smoke-test.sh`.
6. Install this commit in an immutable runner release directory; update the
   installed service WorkingDirectory and generator version, then restart it.
   New runner must never publish the stats schema to the old Worker.
7. Verify the fixed W36 job passes through collection, illustration validation
   and atomic publication. Run the smoke test immediately after publication.
8. Verify fresh live desktop/phone views, source disclosures, 3 loaded images,
   real stats and descending edition-week homepage order.

This upgrades future editions and explicitly repairs W36. Already published
archive pages retain their existing evidence and pictures; this change does not
claim to reconstruct missing historical star snapshots or regenerate the entire
archive. Current stars are observation-time values. Partial collection is marked.
