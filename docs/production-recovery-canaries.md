# Bounded production recovery

After the shared-owner release is deployed and the isolated pull runner is ready,
reviewed migration `0007_revival_canaries.sql` requests only these six editions:

- nikolays / 2026-W36 — fresh public-only current example
- nikolays / 2026-W32
- steipete / 2026-W14
- torvalds / 2026-W16
- karpathy / 2026-W20 — previously confirmed quiet-week case
- physshell / 2026-W30

These are queued jobs, not fabricated editions or successful test results.
Existing user identities are required; no users or sessions are created.
Suppressed profiles, existing live jobs, and already published jobs are not
replaced. Fixed job IDs make migration replay idempotent. Normal global capacity,
leases, evidence collection, public-only filtering, image validation and atomic
publication remain in force. Weekly scheduling stays disabled.

Immediately after this deployment and after every content push, run the required
workspace smoke test: `bash /tmp/gl-dispatch/dispatch/smoke-test.sh`.
Then verify each target has a published job and a reachable edition. Inspect
active editions on mobile and desktop with at least two meaningful illustrations;
the quiet case must be supported by fresh empty public evidence, not collector
failure. Missing/suppressed identities and failed/aged-out jobs must be reported
explicitly. Do not infer success from a completed migration or from queue counts.

Enable cleanup and weekly scheduling only in a later reviewed deployment after
these outcomes pass and the retained-profile preflight confirms all nine users.
If deployment fails after enqueue, leave the runner off until the reviewed Worker
is healthy. Jobs may age out; recover through authenticated admin enqueue or a
new reviewed recovery migration, never by forging sessions, publication records,
or successful provider usage.
