/** Reviewed deployment-only synchronization. Never print or pass secret values as argv. */
const existingAppBindings = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET"];
const retired = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "NEWSPAPERIFY_SECRET"];
export function credentialPlan(names: string[]) {
  if (new Set(names).size !== names.length) throw new Error("duplicate Worker binding names");
  const missingApp = existingAppBindings.filter(name => !names.includes(name));
  if (missingApp.length) throw new Error(`existing application bindings missing: ${missingApp.join(', ')}`);
  const allowed = [...existingAppBindings, ...retired, "ADMIN_USER_ID", "RUNNER_SECRET", "STATUS_TOKEN"];
  const unknown = names.filter(name => !allowed.includes(name));
  if (unknown.length) throw new Error(`unreviewed Worker bindings: ${unknown.join(', ')}`);
  return {
    put: ["RUNNER_SECRET", ...(!names.includes("STATUS_TOKEN") ? ["STATUS_TOKEN"] : []), ...(!names.includes("ADMIN_USER_ID") ? ["ADMIN_USER_ID"] : [])],
    remove: retired.filter(name => names.includes(name)),
  };
}

async function execute() {
  const phase = process.argv[2];
  if (!["check", "sync", "retire"].includes(phase)) throw new Error("explicit check/sync/retire phase required");
  const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
  const env: Record<string, string | undefined> = { ...process.env, CI: 'true' };
  delete env.GITZETTE_RUNNER_SECRET;
  delete env.GITZETTE_STATUS_TOKEN;
  const list = Bun.spawn([wrangler, 'secret', 'list', '--format', 'json'], { env, stdout: 'pipe', stderr: 'ignore' });
  const [raw, status] = await Promise.all([new Response(list.stdout).text(), list.exited]);
  if (status !== 0) throw new Error('unable to inspect Worker binding names');
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries) || entries.some(e => typeof e?.name !== 'string')) throw new Error('invalid binding metadata');
  const plan = credentialPlan(entries.map(e => e.name));
  const values: Record<string, string | undefined> = {
    RUNNER_SECRET: process.env.GITZETTE_RUNNER_SECRET,
    STATUS_TOKEN: process.env.GITZETTE_STATUS_TOKEN,
    ADMIN_USER_ID: '1345402', // NikolayS immutable GitHub owner ID
  };
  for (const name of plan.put) {
    if (!values[name] || (name !== 'ADMIN_USER_ID' && values[name]!.length < 32)) throw new Error(`missing deployment input for ${name}`);
  }
  if (phase === "check") { console.log("Worker credential inputs and binding names verified (read-only)"); return; }
  // Validate every input before mutation. The child receives only Cloudflare auth,
  // not runner/status secrets in its environment; values go to stdin directly.
  for (const name of phase === "sync" ? plan.put : []) {
    const child = Bun.spawn([wrangler, 'secret', 'put', name], { env, stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' });
    child.stdin.write(values[name]!);
    await child.stdin.end();
    if (await child.exited !== 0) throw new Error(`unable to set Worker binding ${name}`);
  }
  for (const name of phase === "retire" ? plan.remove : []) {
    const child = Bun.spawn([wrangler, 'secret', 'delete', name], { env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    if (await child.exited !== 0) throw new Error(`unable to retire Worker binding ${name}`);
  }
  console.log('Worker credential synchronization completed (values withheld)');
}
if (import.meta.main) execute().catch(error => { console.error(error instanceof SyntaxError ? 'invalid binding metadata' : error.message); process.exitCode = 1; });
