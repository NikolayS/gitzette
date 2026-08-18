import { canonicalSchema } from "./schema-equivalence";

export function productionBaselineFixture(document: unknown, capturedAt: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedAt)) throw new Error("capture date must be YYYY-MM-DD");
  const statements = canonicalSchema(document)
    .flatMap((row) => row.sql === null ? [] : [`${row.sql};`])
    .join("\n");
  return `-- Canonical SQL reconstruction of pre-migration production D1 sqlite_master,
-- captured ${capturedAt}. Mechanical derivation from Wrangler JSON is defined by
-- scripts/production-baseline-from-json.ts. It is not a byte-for-byte export.
-- This is a CI fixture only; Wrangler must never apply it remotely.
${statements}\n`;
}

if (import.meta.main) {
  const [rawJsonPath, capturedAt] = process.argv.slice(2);
  if (!rawJsonPath || !capturedAt) {
    throw new Error("usage: bun scripts/production-baseline-from-json.ts <raw-json> <YYYY-MM-DD>");
  }
  const document: unknown = JSON.parse(await Bun.file(rawJsonPath).text());
  process.stdout.write(productionBaselineFixture(document, capturedAt));
}
