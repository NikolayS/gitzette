export function cutoverState(document: unknown, ledgerDocument: unknown): "cutover" | "migrated" {
  const migrationRows = d1Rows(document, "migration-ledger query");
  if (migrationRows.length !== 1 || !isRecord(migrationRows[0])) {
    throw new Error("invalid D1 migration-ledger query result");
  }
  const total = migrationRows[0].total;
  if (total === 0) return "cutover";
  if (typeof total !== "number" || !Number.isInteger(total) || total < 1) {
    throw new Error("invalid D1 migration-ledger query result");
  }
  const rows = d1Rows(ledgerDocument, "migration ledger contents");
  if (!rows.some((row) => isRecord(row) && row.name === "0000_base.sql")) {
    throw new Error("D1 migration ledger exists without 0000_base.sql");
  }
  return "migrated";
}

function d1Rows(document: unknown, label: string): unknown[] {
  if (!Array.isArray(document) || document.length !== 1 || !isRecord(document[0])) {
    throw new Error(`invalid D1 ${label} envelope`);
  }
  const envelope = document[0];
  if (("success" in envelope && envelope.success !== true)
    || "error" in envelope
    || !Array.isArray(envelope.results)) {
    throw new Error(`invalid D1 ${label} envelope`);
  }
  return envelope.results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (import.meta.main) {
  const [path, ledgerPath] = process.argv.slice(2);
  if (!path) throw new Error("usage: bun scripts/cutover-state.ts <table-json> [ledger-json]");
  const document = JSON.parse(await Bun.file(path).text());
  const ledger = ledgerPath ? JSON.parse(await Bun.file(ledgerPath).text()) : undefined;
  process.stdout.write(cutoverState(document, ledger));
}
