type SchemaRow = { type: string; name: string; sql: string | null };

function collapseSqlWhitespace(sql: string): string {
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
    if (char === "-" && sql[index + 1] === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") index += 1;
      pendingSpace = true;
      continue;
    }
    if (char === "/" && sql[index + 1] === "*") {
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
