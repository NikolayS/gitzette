export function cutoverState(document: unknown): "cutover" | "migrated" {
  const total = (document as any)?.[0]?.results?.[0]?.total;
  if (total === 0) return "cutover";
  if (typeof total === "number" && total > 0) return "migrated";
  throw new Error("invalid D1 migration-ledger query result");
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: bun scripts/cutover-state.ts <wrangler-json>");
  const document = JSON.parse(await Bun.file(path).text());
  process.stdout.write(cutoverState(document));
}
