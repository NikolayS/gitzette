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
