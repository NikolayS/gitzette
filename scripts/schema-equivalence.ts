type SchemaRow = { type: string; name: string; sql: string | null };

function collapseSqlWhitespace(sql: string, stripComments: boolean): string {
  let result = "";
  let quote = "";
  let pendingSpace = false;
  let afterLineComment = false;
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
    if (afterLineComment && /\s/.test(char)) continue;
    afterLineComment = false;
    if (char === "-" && sql[index + 1] === "-") {
      const commentStart = index;
      index += 2;
      while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") index += 1;
      if (!stripComments) {
        if (pendingSpace && result && !/[,(]$/.test(result)) result += " ";
        result += `${sql.slice(commentStart, index).trimEnd()}\n`;
      }
      afterLineComment = !stripComments;
      pendingSpace = stripComments;
      continue;
    }
    if (char === "/" && sql[index + 1] === "*") {
      const commentStart = index;
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      if (index < sql.length) index += 1;
      if (!stripComments) {
        if (pendingSpace && result && !/[,(]$/.test(result)) result += " ";
        result += sql.slice(commentStart, index + 1);
      }
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
      result = !stripComments && result.endsWith("\n")
        ? result + char
        : result.trimEnd() + char;
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
  return collapseSqlWhitespace(sql, true)
    .replace(/^CREATE (TABLE|INDEX|TRIGGER|VIEW) IF NOT EXISTS/i, "CREATE $1")
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJson(path: string, label: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await Bun.file(path).text();
  } catch (error) {
    throw new Error(`could not read ${label} schema: ${formatError(error)}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid ${label} schema JSON: ${formatError(error)}`);
  }
}

async function main(args: string[]): Promise<void> {
  const strict = args.includes("--strict");
  const positionals = args.filter((argument) => argument !== "--strict");
  const unknownFlag = positionals.find((argument) => argument.startsWith("--"));
  if (unknownFlag) throw new Error(`unknown schema comparison mode: ${unknownFlag}`);
  const [expectedPath, actualPath, label = "schema mismatch", ...extra] = positionals;
  if (!expectedPath || !actualPath) {
    throw new Error(
      "usage: bun scripts/schema-equivalence.ts <expected-json> <actual-json> [label] [--strict]",
    );
  }
  if (extra.length > 0) throw new Error(`unexpected schema comparison argument: ${extra[0]}`);
  const expected = await readJson(expectedPath, "expected");
  const actual = await readJson(actualPath, "actual");
  const normalize = strict ? strictSchema : canonicalSchema;
  if (!schemasMatch(expected, actual, strict)) {
    console.error(label, {
      expected: normalize(expected),
      actual: normalize(actual),
    });
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
