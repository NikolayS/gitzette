export function weeklyGenerationEnabled(toml: string): boolean {
  const config = Bun.TOML.parse(toml) as { vars?: { WEEKLY_GENERATION_ENABLED?: unknown } };
  const value = config.vars?.WEEKLY_GENERATION_ENABLED;
  if (value !== "true" && value !== "false") {
    throw new Error("invalid WEEKLY_GENERATION_ENABLED");
  }
  return value === "true";
}

if (import.meta.main) {
  const [configPath] = process.argv.slice(2);
  if (!configPath) throw new Error("usage: bun scripts/weekly-generation-flag.ts <wrangler.toml>");
  process.stdout.write(String(weeklyGenerationEnabled(await Bun.file(configPath).text())));
}
