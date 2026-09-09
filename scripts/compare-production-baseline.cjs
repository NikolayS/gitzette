const fs = require("fs");
  const canonical = sql => String(sql)
    .replace(/CREATE (TABLE|INDEX|TRIGGER|VIEW) IF NOT EXISTS/gi, "CREATE $1")
    .replace(/^CREATE TABLE "([A-Za-z0-9_]+)"/i, "CREATE TABLE $1")
    .replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim();
  const read = path => JSON.parse(fs.readFileSync(path, "utf8"))[0].results
    .map(row => ({ type: row.type, name: row.name, sql: canonical(row.sql) }));
  const baseline = read(process.argv[2]);
  const production = read(process.argv[3]);
  if (JSON.stringify(baseline) !== JSON.stringify(production)) {
    console.error("0000_base.sql differs from committed production snapshot", { baseline, production });
    process.exit(1);
  }
