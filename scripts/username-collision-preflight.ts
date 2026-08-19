function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertNoUsernameCollisions(document: unknown): void {
  if (!Array.isArray(document) || document.length !== 1 || !isRecord(document[0])) {
    throw new Error("invalid production username-collision preflight response");
  }
  const envelope = document[0];
  if (("success" in envelope && envelope.success !== true)
    || "error" in envelope
    || !Array.isArray(envelope.results)) {
    throw new Error("invalid production username-collision preflight response");
  }
  if (envelope.results.length !== 0) {
    throw new Error("production contains case-folding GitHub username collisions; aborting migration");
  }
}

if (import.meta.main) {
  const [jsonPath] = process.argv.slice(2);
  if (!jsonPath) {
    throw new Error("usage: bun scripts/username-collision-preflight.ts <wrangler-json>");
  }
  const document: unknown = JSON.parse(await Bun.file(jsonPath).text());
  assertNoUsernameCollisions(document);
}
