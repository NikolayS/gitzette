(async () => {

  const document = JSON.parse(await Bun.file(process.argv[2]).text());
  if (!Array.isArray(document) || document.length !== 1) {
    throw new Error("invalid production username-collision preflight response");
  }
  const envelope = document[0];
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)
    || Object.hasOwn(envelope, "error") || !Array.isArray(envelope.results)) {
    throw new Error("invalid production username-collision preflight response");
  }
  if (envelope.results.length !== 0) {
    throw new Error("production contains case-folding GitHub username collisions; aborting migration");
  }

})().catch(error => { console.error(error instanceof SyntaxError ? "invalid input document" : error.message); process.exit(1); });
