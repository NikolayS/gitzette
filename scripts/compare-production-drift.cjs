try {
  const fs = require("fs");
  const canonical = sql => String(sql)
  .replace(/^CREATE TABLE "([A-Za-z0-9_]+)"/i, "CREATE TABLE $1")
  .replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim();
  const read = path => {
  const document = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!Array.isArray(document) || document.length !== 1 || !Array.isArray(document[0]?.results)) throw new Error("invalid input document");
  return document[0].results.map(row => ({ type: row.type, name: row.name, sql: canonical(row.sql) }));
  };
  const fixture = read(process.argv[2]);
  const production = read(process.argv[3]);
  if (JSON.stringify(fixture) !== JSON.stringify(production)) {
  console.error("production schema drifted from the reviewed baseline; aborting migration", { fixture, production });
  process.exit(1);
  }
} catch { console.error("invalid input document"); process.exit(1); }
