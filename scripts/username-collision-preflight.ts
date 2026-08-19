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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(args: string[]): Promise<void> {
  const [jsonPath] = args;
  if (!jsonPath) {
    throw new Error("usage: bun scripts/username-collision-preflight.ts <wrangler-json>");
  }
  let raw: string;
  try {
    raw = await Bun.file(jsonPath).text();
  } catch (error) {
    throw new Error(`could not read username-collision response: ${formatError(error)}`);
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid username-collision JSON: ${formatError(error)}`);
  }
  assertNoUsernameCollisions(document);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
