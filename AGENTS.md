
## UI Audit Process

For visual UX/UI audits, always use real screenshots — not static code analysis.

### How to run an audit

1. Take screenshots first (requires Chrome):
   ```
   bash /tmp/gitzette-screenshot-audit.sh
   ```
   Captures: homepage, profile, dispatch, smart-404 at 375px and 1280px.

2. Pass screenshots to the audit agent as image attachments or describe findings from the images.

3. File issues with specific pixel-level observations (e.g. "gap between chips row and CTA is 0px on mobile, needs 28px").

### Why screenshots matter
Code-only audits miss spacing collapses, rendering quirks, and visual hierarchy issues that only show up in the rendered page. A margin on the wrong element looks fine in CSS but broken in a browser.

