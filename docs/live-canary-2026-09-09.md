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
