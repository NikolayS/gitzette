// Executed by Bun, which supports the shared TypeScript schema normalizer.
try {
  const fs = require("fs");
  const { canonicalSchema } = require("./schema-equivalence.ts");
  const read = path => canonicalSchema(JSON.parse(fs.readFileSync(path, "utf8")));
  const expected = read(process.argv[2]);
  const actual = read(process.argv[3]);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    console.error("0000_base.sql differs from committed production snapshot", { expected, actual });
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof SyntaxError ? "invalid input document" : error.message);
  process.exit(1);
}
