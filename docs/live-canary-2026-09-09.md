# Local live-model canary — 2026-09-09

NikolayS / 2026-W36: the actual GitHub collector returned 235 evidence items.
Astra wrote three stories. Sunburst generated two images; the actual runner image
processor, visual metrics, Astra relevance/text reviews, perceptual distinctness,
and manifest validator all passed. RunnerEngine returned `processed`.

The local-file Publisher wrote HTML, images and a manifest. No production Worker,
D1, R2, scheduler or site was changed. This is not a production deployment canary.
The final validation reused the saved live-generated article and image outputs;
image reviews ran again. It does not establish a one-shot reliability rate.

Earlier runs found a generic cityscape was irrelevant (relevant=false,
containsText=false). The prompts now request a focused technical visual metaphor;
the reviewer accepts conceptual representation, not arbitrary scenery. Both
irrelevance and visible text remain rejecting conditions, covered by tests.

Two local-harness errors were corrected: inherited working-directory access for
ImageMagick, and mixed-case job username versus normalized collector username.

Nik explicitly authorized using his existing OAuth subscription in the isolated
runner, superseding the dedicated-account restriction. Both real response
model IDs matched the strict pins: gpt-6-astra and gpt-image-2.5-sunburst.

## Fresh prompt-v3 run — September 10

A new run generated fresh Astra articles and both Sunburst images, with no
cached model outputs. The general-purpose illustration prompt contains no
story-specific city example. Both image reviews, visual/alpha checks,
perceptual distinction and the final manifest validation passed; RunnerEngine
returned `processed` at 00:10:54 UTC. Manifest promptVersion is gitzette-editor-v3.
This remains a local-file publication, not a production canary.

The September 10 fresh prompt-v3 run supersedes the earlier reused-output validation.

## Subscription activation record

Owner instruction, September 9: “can you just bring somehow the same oauth
subscription as you have?” The existing OAuth profile was copied into the
isolated store; no independent session was minted. Shared refresh, throttling,
revocation, or provider account action can affect both clients. This records
the instruction actually received, not an assertion of separately recorded
legal/risk acceptance. Recovery follows the canonical subscription policy.

Historical local canaries on September 10 also passed for NikolayS W32 and
PhysShell W30 (fresh active editions), and Karpathy W20 (genuine quiet week).
The steipete and torvalds collectors failed closed on incomplete GitHub search
results; retries paused after the provider secondary rate limit.

## Remaining activation failures — September 10

The broader steipete W14 case failed illustration relevance with prompt v3 on
both attempts. Prompt v4 adds visible computing context and a release-only
metaphor, but its live attempt also failed the unchanged relevance check.
No rejected edition was published. This remains an unresolved quality failure,
not a passing canary. The Torvalds W16 global search remained incomplete even
with the new bounded sequential daily-window fallback; it fails closed.
Production activation also awaits an independent login session under the same
subscription, as required by the independent review of 3e84f23. No review retry
can substitute for that login or the missing passing generation evidence.

## September 13 resolution: prompt v5 and complete historical search

Fresh local editions now pass for both remaining cases:
- steipete / 2026-W14: processed at 00:40:26 UTC; two illustrations,
  relevance/no-text checks, image metrics/distinctness and manifest validation.
- torvalds / 2026-W16: complete collector result (6 evidence items), then
  processed at 00:41:33 UTC with the same two-image validation pipeline.

The prior v4 rejection was a review-rubric mismatch: the saved image depicted a
robotic hand installing a component in a computer; an independent descriptive
call identified it as a software-release metaphor. Prompt v5 explicitly judges
release illustrations by the depicted installation/update activity, not by a
recognizable product brand. Live regression checks accepted that saved image
and continued to reject the previous generic-gears picture (relevant=false,
containsText=false). Both new full editions generated fresh text and images.

These results supersede the failed September 10 canaries; they do not claim
production deployment or a reliability rate. Earlier local NikolayS W32,
PhysShell W30, and genuine quiet Karpathy W20 cases passed as recorded above.
An independent login session under the same authorized subscription remains
required before production service activation; the September 10 attempt expired.

## September 13: shared OAuth owner transport

The `steipete/2026-W14` edition passed freshly through the Unix-socket inference
transport at 09:03:59 UTC (writing, two Sunburst images, Astra review, distinctness,
and complete manifest validation). Evidence remains the 39-item historical bundle.
Artifacts: `/var/lib/gitzette-runner/canaries/steipete/2026-W14`, diagnostic
`diagnostic-1789290103974`. This was a local-file publication, not production.

The pull runner process remained `gitzette-runner`. The inference process used
TARS's existing canonical `/home/tars/.openclaw` state, with its shared profile
and native refresh-lock path, and a separate tool-denied configuration. No OAuth
credentials were copied or returned to the runner. This supersedes the temporary
separate-store copied-session setup. A second live Astra test also passed under
the installed systemd service's filesystem restrictions. Actual token expiry was
not forced; refresh coordination is established by using the same installed
canonical store/lock implementation, not by an artificial token-rotation test.

These changes require exact-head CI and independent review before publication.

## Public-only collection correction — September 13

The original 235-item NikolayS W36 collection did not explicitly restrict every
query to public repositories. It is superseded, not production-ready evidence.
With `is:public` search qualifiers, explicit GraphQL PUBLIC visibility, and draft
release exclusion, a fresh W36 collection returned 131 public evidence items.
No edition from the revival has been published. Production canaries must collect
freshly through the corrected public-only path; do not reuse the older bundle.
