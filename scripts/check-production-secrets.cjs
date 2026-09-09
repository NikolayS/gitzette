(async () => {

  const secrets = JSON.parse(await Bun.file(process.argv[2]).text());
  if (!Array.isArray(secrets)) throw new Error("invalid Wrangler secret list");
  const configured = secrets.map(secret => secret.name).sort();
  const expected = ["ADMIN_USER_ID", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "RUNNER_SECRET", "SESSION_SECRET", "STATUS_TOKEN"].sort();
  const missing = expected.filter(name => !configured.includes(name));
  const retired = configured.filter(name => !expected.includes(name));
  if (missing.length || retired.length) {
    throw new Error(`production Worker secret mismatch; missing=[${missing.join(", ")}], retired-or-unknown=[${retired.join(", ")}]`);
  }

})().catch(() => { console.error("invalid input document"); process.exit(1); });
