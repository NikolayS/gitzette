export const expectedProductionSecrets: readonly string[] = Object.freeze([
  "ADMIN_USER_ID",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "RUNNER_SECRET",
  "SESSION_SECRET",
  "STATUS_TOKEN",
]);

export function assertProductionSecrets(document: unknown): void {
  if (!Array.isArray(document)) {
    throw new Error("invalid Wrangler secret list: expected an array");
  }
  for (const [index, secret] of document.entries()) {
    if (secret === null
      || typeof secret !== "object"
      || Array.isArray(secret)
      || typeof (secret as { name?: unknown }).name !== "string") {
      throw new Error(`invalid Wrangler secret list: entry ${index} must contain a string name`);
    }
  }

  const configured = document
    .map(secret => (secret as { name: string }).name)
    .sort();
  const configuredSet = new Set(configured);
  if (configuredSet.size !== configured.length) {
    const duplicates = [...configuredSet].filter(name => configured.filter(value => value === name).length > 1);
    throw new Error(`invalid Wrangler secret list: duplicate secret name(s) [${duplicates.join(", ")}]`);
  }
  const missing = expectedProductionSecrets.filter(name => !configuredSet.has(name));
  const retired = configured.filter(name => !expectedProductionSecrets.includes(name));
  if (missing.length || retired.length) {
    throw new Error(
      `production Worker secret mismatch; missing=[${missing.join(", ")}], retired-or-unknown=[${retired.join(", ")}]`,
    );
  }
}

async function main(): Promise<void> {
  const secretListPath = process.argv[2];
  if (!secretListPath) throw new Error("Wrangler secret-list path is required");
  let rawSecretList: string;
  try {
    rawSecretList = await Bun.file(secretListPath).text();
  } catch (error) {
    throw new Error(`unable to read Wrangler secret list at ${secretListPath}`, { cause: error });
  }
  let document: unknown;
  try {
    document = JSON.parse(rawSecretList);
  } catch (error) {
    throw new Error("invalid Wrangler secret list: malformed JSON", { cause: error });
  }
  assertProductionSecrets(document);
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).replace(/\s+/g, " ").trim();
  const cause = error.cause === undefined ? "" : formatError(error.cause);
  return `${error.message}${cause ? ` (${cause})` : ""}`.replace(/\s+/g, " ").trim();
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(formatError(error));
    process.exitCode = 1;
  }
}
