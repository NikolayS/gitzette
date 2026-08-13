import { expect } from "bun:test";

const base = process.env.E2E_BASE_URL!;
const sessionHeaders = { cookie: "session=e2e-session", "content-type": "application/json" };
const runnerHeaders = { authorization: "Bearer e2e-runner-secret", "content-type": "application/json" };
const obsoleteWebps = false && {
  "image-1.webp": Uint8Array.from(atob("UklGRqwAAABXRUJQVlA4IKAAAADwEACdASoAAQABPpFIoU0lpCMiICgAsBIJaW7hdrEbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk4UAA/v+8EXxAAAAAAAAAAAAA"), (char) => char.charCodeAt(0)),
  "image-2.webp": Uint8Array.from(atob("UklGRqoAAABXRUJQVlA4IJ4AAADwEACdASoAAQABPpFIoU0lpCMiICgAsBIJaW7hdrEbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk4UAA/v+3TAAAAAAAAAAAAA=="), (char) => char.charCodeAt(0)),
};
const validatedWebps = {
  "image-1.webp": Uint8Array.from(atob("UklGRiIAAABXRUJQVlA4TBYAAAAv/8A/AAcQEf0PACjS//8U0f/U//4D"), (char) => char.charCodeAt(0)),
  "image-2.webp": Uint8Array.from(atob("UklGRiQAAABXRUJQVlA4TBgAAAAv/8A/AAfQ//73v/8BAEX6/58i+p/6338="), (char) => char.charCodeAt(0)),
};

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(base + path, init);
  const text = response.status === 204 ? "" : await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { throw new Error(`${init.method || "GET"} ${path} returned ${response.status}: ${text.slice(0, 500)}`); }
  return { response, body: body as any };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function manifest(weekKey: string, imageHashes: Record<string, string>) {
  return {
    generatorVersion: "e2e-1",
    model: "openai/gpt-5.6-sol",
    promptVersion: "e2e-editor-1",
    evidence: {
      state: "active",
      username: "octocat",
      weekKey,
      items: [{ id: "pr:1", type: "pull_request", title: "Parser fix", url: "https://github.com/octocat/widget/pull/1", repo: "octocat/widget" }],
    },
    edition: {
      headline: "A parser reaches the end",
      tagline: "Boundaries are now less theoretical.",
      closingNote: "The last byte has entered the chat.",
      stories: [
        { headline: "The final byte gets read", deck: "The edge case loses.", paragraphs: ["<script>hostile repository text</script> is rendered as text."], evidenceIds: ["pr:1"], tag: "FEATURE", illustrationKey: "image-1.webp" },
        { headline: "The boundary holds", deck: "The same fix has a second consequence.", paragraphs: ["A concrete, evidence-backed consequence."], evidenceIds: ["pr:1"], tag: "COMMUNITY", illustrationKey: "image-2.webp" },
      ],
    },
    images: [
      { key: "image-1.webp", contentType: "image/webp", sha256: imageHashes["image-1.webp"] },
      { key: "image-2.webp", contentType: "image/webp", sha256: imageHashes["image-2.webp"] },
    ],
  };
}

function quietManifest(weekKey: string) {
  return {
    generatorVersion: "e2e-1",
    model: "deterministic",
    promptVersion: "e2e-editor-1",
    evidence: { state: "quiet", username: "octocat", weekKey, items: [] },
    edition: { headline: "This model copy must be discarded", tagline: "Unsupported", closingNote: "Unsupported", stories: [] },
    images: [],
  };
}

async function upload(jobId: string, leaseToken: string, name: string) {
  return fetch(`${base}/runner/jobs/${jobId}/artifacts/${name}`, {
    method: "PUT",
    headers: { authorization: "Bearer e2e-runner-secret", "x-gitzette-lease": leaseToken, "content-type": "image/webp" },
    body: validatedWebps[name as keyof typeof validatedWebps],
  });
}

const hashes = Object.fromEntries(await Promise.all(Object.entries(validatedWebps).map(async ([name, bytes]) => [name, await sha256(bytes)])));

// Browser request -> durable queued job, including deduplication.
expect((await json("/generate", { method: "POST" })).response.status).toBe(401);
expect((await json("/generate", { method: "POST", headers: sessionHeaders, body: JSON.stringify({ weekKey: "banana" }) })).response.status).toBe(400);
const created = await json("/generate", { method: "POST", headers: sessionHeaders, body: JSON.stringify({ weekKey: "2026-W32" }) });
expect(created.response.status).toBe(202);
expect(created.body.job.status).toBe("queued");
const jobId = created.body.job.id as string;
expect((await json(`/generate/jobs/${jobId}`, { headers: { cookie: "session=intruder-session" } })).response.status).toBe(403);
const duplicate = await json("/generate", { method: "POST", headers: sessionHeaders, body: JSON.stringify({ weekKey: "2026-W32" }) });
expect(duplicate.body.deduplicated).toBe(true);
expect(duplicate.body.job.id).toBe(jobId);

// Runner API is private and claims with a time-bounded lease.
expect((await json("/runner/jobs/claim", { method: "POST" })).response.status).toBe(401);
const claim = await json("/runner/jobs/claim", { method: "POST", headers: runnerHeaders });
expect(claim.response.status).toBe(200);
expect(claim.body.job.id).toBe(jobId);
const lease = claim.body.job.leaseToken as string;
expect((await json(`/runner/jobs/${jobId}/stage`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ leaseToken: lease, stage: "illustrating" }) })).response.status).toBe(409);
expect((await json(`/runner/jobs/${jobId}/stage`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ leaseToken: lease, stage: "writing" }) })).response.status).toBe(200);
expect((await json(`/runner/jobs/${jobId}/stage`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ leaseToken: lease, stage: "illustrating" }) })).response.status).toBe(200);

// Invalid images and incomplete manifests cannot publish anything.
const fakeImage = await fetch(`${base}/runner/jobs/${jobId}/artifacts/image-1.webp`, {
  method: "PUT",
  headers: { authorization: "Bearer e2e-runner-secret", "x-gitzette-lease": lease, "content-type": "image/webp" },
  body: "not-webp",
});
expect(fakeImage.status).toBe(422);
expect((await upload(jobId, lease, "image-1.webp")).status).toBe(200);
expect((await upload(jobId, lease, "image-2.webp")).status).toBe(200);
const incomplete = manifest("2026-W32", hashes);
incomplete.images.pop();
incomplete.edition.stories.pop();
expect((await json(`/runner/jobs/${jobId}/publish`, { method: "POST", headers: runnerHeaders, body: JSON.stringify({ leaseToken: lease, manifest: incomplete }) })).response.status).toBe(409);
expect((await json(`/runner/jobs/${jobId}/stage`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ leaseToken: lease, stage: "validating" }) })).response.status).toBe(200);
const refused = await json(`/runner/jobs/${jobId}/publish`, { method: "POST", headers: runnerHeaders, body: JSON.stringify({ leaseToken: lease, manifest: incomplete }) });
expect(refused.response.status).toBe(422);
expect((await fetch(`${base}/octocat/2026-W32`)).status).toBe(404);

// A valid manifest atomically moves the public pointer.
const published = await json(`/runner/jobs/${jobId}/publish`, { method: "POST", headers: runnerHeaders, body: JSON.stringify({ leaseToken: lease, manifest: manifest("2026-W32", hashes) }) });
expect(published.response.status).toBe(200);
expect(published.body.status).toBe("published");
const page = await fetch(`${base}/octocat/2026-W32`);
const html = await page.text();
expect(page.status).toBe(200);
expect(html).toContain("The final byte gets read");
expect(html).toContain("&lt;script&gt;hostile repository text&lt;/script&gt;");
expect(html).not.toContain("<script>hostile repository text</script>");
expect((html.match(/<img /g) || []).length).toBe(2);
expect((await json(`/generate/jobs/${jobId}`, { headers: sessionHeaders })).body.job.status).toBe("published");
const browserStatus = await json("/generate/status", { headers: sessionHeaders });
expect(browserStatus.body.status).toBe("ready");
expect(browserStatus.body.stage).toBe("published");

// Quiet weeks are rendered from server-owned copy and need no model images.
const quiet = await json("/generate", { method: "POST", headers: sessionHeaders, body: JSON.stringify({ weekKey: "2026-W31" }) });
const quietId = quiet.body.job.id as string;
const quietClaim = await json("/runner/jobs/claim", { method: "POST", headers: runnerHeaders });
const quietLease = quietClaim.body.job.leaseToken as string;
for (const stage of ["writing", "illustrating", "validating"]) {
  expect((await json(`/runner/jobs/${quietId}/stage`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ leaseToken: quietLease, stage }) })).response.status).toBe(200);
}
expect((await json(`/runner/jobs/${quietId}/publish`, { method: "POST", headers: runnerHeaders, body: JSON.stringify({ leaseToken: quietLease, manifest: quietManifest("2026-W31") }) })).response.status).toBe(200);
const quietHtml = await (await fetch(`${base}/octocat/2026-W31`)).text();
expect(quietHtml).toContain("A Quiet Week for @octocat");
expect(quietHtml).not.toContain("This model copy must be discarded");
expect(quietHtml).not.toContain("<img ");

// A broken regeneration leaves the previously published edition untouched.
const regen = await json("/generate", { method: "POST", headers: sessionHeaders, body: JSON.stringify({ weekKey: "2026-W32" }) });
const regenId = regen.body.job.id as string;
expect(regenId).not.toBe(jobId);
const regenClaim = await json("/runner/jobs/claim", { method: "POST", headers: runnerHeaders });
const regenLease = regenClaim.body.job.leaseToken as string;
await json(`/runner/jobs/${regenId}/stage`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ leaseToken: regenLease, stage: "writing" }) });
await json(`/runner/jobs/${regenId}/stage`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ leaseToken: regenLease, stage: "illustrating" }) });
expect((await upload(regenId, regenLease, "image-1.webp")).status).toBe(200);
expect((await upload(regenId, regenLease, "image-2.webp")).status).toBe(200);
await json(`/runner/jobs/${regenId}/stage`, { method: "PATCH", headers: runnerHeaders, body: JSON.stringify({ leaseToken: regenLease, stage: "validating" }) });
const wrongHash = manifest("2026-W32", { ...hashes, "image-1.webp": "0".repeat(64) });
const broken = await json(`/runner/jobs/${regenId}/publish`, { method: "POST", headers: runnerHeaders, body: JSON.stringify({ leaseToken: regenLease, manifest: wrongHash }) });
expect(broken.response.status).toBe(422);
expect(await (await fetch(`${base}/octocat/2026-W32`)).text()).toContain("The final byte gets read");

// Retryable failure releases the lease and the same job can be reclaimed.
const failed = await json(`/runner/jobs/${regenId}/fail`, { method: "POST", headers: runnerHeaders, body: JSON.stringify({ leaseToken: regenLease, error: "OAuth temporarily exhausted", retryable: true }) });
expect(failed.body.status).toBe("retryable_failed");
const reclaimed = await json("/runner/jobs/claim", { method: "POST", headers: runnerHeaders });
expect(reclaimed.body.job.id).toBe(regenId);
expect(reclaimed.body.job.attempt).toBe(2);

// The public request budget is enforced even when callers vary week keys.
const limited = await json("/generate", { method: "POST", headers: sessionHeaders, body: JSON.stringify({ weekKey: "2026-W30" }) });
expect(limited.response.status).toBe(429);

console.log("E2E OK: queue, authz, quota, dedupe, lease/stages, artifacts, active+quiet invariants, atomic publish, XSS, retry");
