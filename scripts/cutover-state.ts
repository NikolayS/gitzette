export function cutoverState(document: unknown, ledgerDocument: unknown): "cutover" | "migrated" {
  const total = (document as any)?.[0]?.results?.[0]?.total;
  if (total === 0) return "cutover";
  if (typeof total !== "number" || total < 1) throw new Error("invalid D1 migration-ledger query result");
  const rows = (ledgerDocument as any)?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("D1 migration ledger contents are required");
  if (!rows.some((row: any) => row?.name === "0000_base.sql")) {
    throw new Error("D1 migration ledger exists without 0000_base.sql");
  }
  return "migrated";
}

if (import.meta.main) {
  const [path, ledgerPath] = process.argv.slice(2);
  if (!path) throw new Error("usage: bun scripts/cutover-state.ts <table-json> [ledger-json]");
  const document = JSON.parse(await Bun.file(path).text());
  const ledger = ledgerPath ? JSON.parse(await Bun.file(ledgerPath).text()) : undefined;
  process.stdout.write(cutoverState(document, ledger));
}
