import { readdirSync } from "node:fs";

export function appliedMigrationNames(committedNames: string[], ledgerDocument: unknown): string[] {
  const rows = (ledgerDocument as any)?.[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("D1 migration ledger is empty or invalid");

  const committed = [...committedNames].filter((name) => /^\d+_[A-Za-z0-9_-]+\.sql$/.test(name)).sort();
  const applied = rows.map((row: any) => row?.name);
  if (applied.some((name: unknown) => typeof name !== "string") || new Set(applied).size !== applied.length) {
    throw new Error("D1 migration ledger contains invalid or duplicate names");
  }
  for (const [index, name] of applied.entries()) {
    if (committed[index] !== name) {
      throw new Error(`D1 migration ledger is not a prefix of the reviewed chain at ${String(name)}`);
    }
  }
  return applied;
}

if (import.meta.main) {
  const [migrationDirectory, ledgerPath] = process.argv.slice(2);
  if (!migrationDirectory || !ledgerPath) {
    throw new Error("usage: bun scripts/applied-migrations.ts <migration-directory> <ledger-json>");
  }
  const ledger = JSON.parse(await Bun.file(ledgerPath).text());
  process.stdout.write(JSON.stringify(appliedMigrationNames(readdirSync(migrationDirectory), ledger)));
}
