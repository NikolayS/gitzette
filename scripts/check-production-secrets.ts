export const expectedProductionSecrets: readonly string[] = Object.freeze([
  "ADMIN_USER_ID",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "RUNNER_SECRET",
  "SESSION_SECRET",
  "STATUS_TOKEN",
]);

export function assertProductionSecrets(document: unknown): void {
  if (!Array.isArray(document)
    || document.some(secret => secret === null
      || typeof secret !== "object"
      || Array.isArray(secret)
      || typeof (secret as { name?: unknown }).name !== "string")) {
    throw new Error("invalid Wrangler secret list");
  }

  const configured = document
    .map(secret => (secret as { name: string }).name)
    .sort();
  const configuredSet = new Set(configured);
  if (configuredSet.size !== configured.length) throw new Error("invalid Wrangler secret list");
  const missing = expectedProductionSecrets.filter(name => !configuredSet.has(name));
  const retired = configured.filter(name => !expectedProductionSecrets.includes(name));
  if (missing.length || retired.length) {
    throw new Error(
      `production Worker secret mismatch; missing=[${missing.join(", ")}], retired-or-unknown=[${retired.join(", ")}]`,
    );
  }
}

if (import.meta.main) {
  const secretListPath = process.argv[2];
  if (!secretListPath) throw new Error("Wrangler secret-list path is required");
  const rawSecretList = await Bun.file(secretListPath).text();
  let document: unknown;
  try {
    document = JSON.parse(rawSecretList);
  } catch {
    throw new Error("invalid Wrangler secret list");
  }
  assertProductionSecrets(document);
}
