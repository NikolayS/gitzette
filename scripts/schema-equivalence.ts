type SchemaRow = { type: string; name: string; sql: string | null };

function canonicalSql(sql: string | null): string {
  return String(sql)
    .replace(/CREATE (TABLE|INDEX|TRIGGER|VIEW) IF NOT EXISTS/gi, "CREATE $1")
    .replace(/^CREATE TABLE "([A-Za-z0-9_]+)"/i, "CREATE TABLE $1")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

export function canonicalSchema(document: unknown): SchemaRow[] {
  const rows = (document as any)?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("invalid Wrangler schema result");
  return rows.map((row: any) => {
    if (typeof row?.type !== "string" || typeof row?.name !== "string") {
      throw new Error("invalid Wrangler schema row");
    }
    return { type: row.type, name: row.name, sql: canonicalSql(row.sql) };
  });
}

export function schemasMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalSchema(left)) === JSON.stringify(canonicalSchema(right));
}

if (import.meta.main) {
  const [expectedPath, actualPath] = process.argv.slice(2);
  if (!expectedPath || !actualPath) {
    throw new Error("usage: bun scripts/schema-equivalence.ts <expected-json> <actual-json>");
  }
  const expected = JSON.parse(await Bun.file(expectedPath).text());
  const actual = JSON.parse(await Bun.file(actualPath).text());
  if (!schemasMatch(expected, actual)) {
    console.error("schema mismatch", {
      expected: canonicalSchema(expected),
      actual: canonicalSchema(actual),
    });
    process.exit(1);
  }
}
