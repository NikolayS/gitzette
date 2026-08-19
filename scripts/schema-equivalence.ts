type SchemaRow = { type: string; name: string; sql: string | null };

function collapseSqlWhitespace(sql: string, stripComments = true): string {
  let result = "";
  let quote = "";
  let pendingSpace = false;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    if (quote) {
      result += char;
      if (char === quote) {
        if (sql[index + 1] === quote) result += sql[++index];
        else quote = "";
      }
      continue;
    }
    if (stripComments && char === "-" && sql[index + 1] === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") index += 1;
      pendingSpace = true;
      continue;
    }
    if (stripComments && char === "/" && sql[index + 1] === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      if (index < sql.length) index += 1;
      pendingSpace = true;
      continue;
    }
    if (char === "'" || char === '"') {
      if (pendingSpace && result && !/[,(]$/.test(result)) result += " ";
      pendingSpace = false;
      quote = char;
      result += char;
    } else if (/\s/.test(char)) {
      pendingSpace = true;
    } else if (char === "(" || char === "," || char === ")") {
      result = result.trimEnd() + char;
      pendingSpace = false;
    } else {
      if (pendingSpace && result && !/[,(]$/.test(result)) result += " ";
      pendingSpace = false;
      result += char;
    }
  }
  return result.trim();
}

function canonicalSql(sql: string | null): string | null {
  if (sql === null) return null;
  return collapseSqlWhitespace(sql)
    .replace(/CREATE (TABLE|INDEX|TRIGGER|VIEW) IF NOT EXISTS/gi, "CREATE $1")
    .replace(/^CREATE (TABLE|INDEX|TRIGGER|VIEW) "([A-Za-z0-9_]+)"/i, "CREATE $1 $2")
    .trim();
}

export function canonicalSchema(document: unknown): SchemaRow[] {
  return mapSchema(document, canonicalSql);
}

function strictSql(sql: string | null): string | null {
  if (sql === null) return null;
  return collapseSqlWhitespace(sql, false);
}

export function strictSchema(document: unknown): SchemaRow[] {
  return mapSchema(document, strictSql);
}

function mapSchema(
  document: unknown,
  normalizeSql: (sql: string | null) => string | null,
): SchemaRow[] {
  if (!Array.isArray(document) || document.length !== 1 || !isRecord(document[0])) {
    throw new Error("invalid Wrangler schema result");
  }
  const envelope = document[0];
  if (("success" in envelope && envelope.success !== true)
    || "error" in envelope
    || !Array.isArray(envelope.results)) {
    throw new Error("invalid Wrangler schema result");
  }
  return envelope.results.map((row) => {
    if (!isRecord(row) || typeof row.type !== "string" || typeof row.name !== "string"
      || (row.sql !== null && typeof row.sql !== "string")) {
      throw new Error("invalid Wrangler schema row");
    }
    return { type: row.type, name: row.name, sql: normalizeSql(row.sql) };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function schemasMatch(left: unknown, right: unknown, strict = false): boolean {
  const normalize = strict ? strictSchema : canonicalSchema;
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

if (import.meta.main) {
  const [expectedPath, actualPath, label = "schema mismatch", mode] = process.argv.slice(2);
  if (!expectedPath || !actualPath) {
    throw new Error(
      "usage: bun scripts/schema-equivalence.ts <expected-json> <actual-json> [label] [--strict]",
    );
  }
  if (mode && mode !== "--strict") throw new Error(`unknown schema comparison mode: ${mode}`);
  const expected = JSON.parse(await Bun.file(expectedPath).text());
  const actual = JSON.parse(await Bun.file(actualPath).text());
  const strict = mode === "--strict";
  const normalize = strict ? strictSchema : canonicalSchema;
  if (!schemasMatch(expected, actual, strict)) {
    console.error(label, {
      expected: normalize(expected),
      actual: normalize(actual),
    });
    process.exit(1);
  }
}
