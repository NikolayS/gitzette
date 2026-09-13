# Production revival — September 13, 2026

## Deployed foundation

- PR #69 merged the shared-owner OAuth runner and publication pipeline.
- PR #70 completed the legacy-binding cutover; release `v2026.09.13.2`
  deployed successfully in Actions run `34752396058`.
- PR #71 queued six bounded recovery editions; release `v2026.09.13.3`
  deployed successfully in Actions run `34752826590`.
- Both releases passed the mandatory immediate homepage smoke test.
- The production runner uses Astra and Sunburst through the canonical OpenClaw
  credential owner over the restricted local socket. No copied OAuth store or
  AI API key is used by the pull runner.

## Measured publications

- NikolayS / W36: published at 10:53:13 UTC; three articles, two images, both
  images HTTP 200. Desktop and 375px mobile inspected, no horizontal overflow.
- NikolayS / W32: published at 10:55:43 UTC; three articles, two images.
- steipete / W14: published at 10:58:00 UTC; three articles, two images,
  mobile rendering inspected. This replaces the previously empty legacy page.
- Torvalds / W16: published at 11:01:35 UTC after one retry; two articles,
  two images, both HTTP 200. Phone inspection found source-link overflow;
  the accompanying wrapping fix removes it in the browser preview.
- Karpathy / W20: published at 11:01:47 UTC as a deterministic quiet week
  based on an empty public collection, without invented images or stories.
- PhysShell / W30: published at 11:06:43 UTC after one retry; three articles,
  two images, both HTTP 200.
- Immediate homepage smoke passed after each publication above.

All six bounded production recovery cases are published and verified. The
failed attempts for Torvalds and PhysShell preserved existing content; their
normal retries succeeded. A successful deployment or queued job alone is not
publication proof.

## Weekly operations

The scheduler targets the nine existing retained profiles. Its primary trigger
is Monday 13:17 UTC; Monday 20:17 UTC is a deduplicated recovery pass. Hourly
cleanup at minute 07 expires stale work and retries staged-artifact cleanup.
The existing global and per-user limits are unchanged. Deployment checks all
nine profile records, database schema, binding names, and reviewed release state.

The production recovery checks have passed. Enable the already tested inference
and pull-runner systemd services at boot during weekly activation. If authentication or repeated
provider failures stop generation, existing published editions remain readable.

Archive completion is separate: the pre-revival public audit found 38 existing
highlighted editions ending at W16. Missing later historical editions are not
made complete merely by enabling weekly scheduling.
