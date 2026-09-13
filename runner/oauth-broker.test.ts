import { test, expect } from "bun:test";
import { validateBrokerRequest, brokerArguments } from "./oauth-broker";
import { TEXT_MODEL } from "../src/models";

test("broker never accepts paths, alternate models, commands, or credentials", () => {
  const base = { operation: "write", prompt: "inert evidence" };
  for (const field of ["file", "model", "command", "config", "token", "url", "output"]) {
    expect(() => validateBrokerRequest({ ...base, [field]: "/etc/passwd" })).toThrow();
  }
  expect(() => validateBrokerRequest({ ...base, operation: "exec" })).toThrow();
  expect(() => validateBrokerRequest({ ...base, prompt: "x".repeat(100_000) })).toThrow();
  expect(() => validateBrokerRequest({ operation: "review", prompt: "review", image: "file:///etc/passwd" })).toThrow();
});
test("broker builds only fixed inference commands and owner-local paths", () => {
  const req = validateBrokerRequest({ operation: "review", prompt: "--model evil; $(id)", image: "aGVsbG8=" });
  const args = brokerArguments(req, "/private/generated");
  expect(args).toEqual(["infer", "image", "describe", "--json", "--model", TEXT_MODEL, "--file", "/private/generated/input.webp", "--prompt", req.prompt]);
});

import { startBroker, brokerInference, validateBrokerConfig } from "./oauth-broker";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOAuthAuthFailure } from "./auth-failure";

test("broker rejects a config permitting tools or API-key auth", async () => {
  const config = await Bun.file(join(import.meta.dir, "openclaw-broker.json")).json();
  expect(() => validateBrokerConfig(config)).not.toThrow();
  const withTools = structuredClone(config); withTools.tools.deny = [];
  expect(() => validateBrokerConfig(withTools)).toThrow();
  const withKey = structuredClone(config); withKey.auth.profiles['openai:nik@postgres.ai'].mode = 'api_key';
  expect(() => validateBrokerConfig(withKey)).toThrow();
});

test("real socket transports results, sanitizes auth errors, and removes temporary files", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gz-broker-'));
  const cli = join(dir, 'fake-cli.js');
  await Bun.write(cli, `(async () => { const a = process.argv; const prompt = a[a.indexOf('--prompt')+1];
    if (prompt === 'auth') { console.error('OAuth token expired PRIVATE_DIAGNOSTIC'); process.exit(1); }
    if (prompt === 'auth-stdout') { console.log(JSON.stringify({error:{code:'invalid_oauth',message:'OAuth token expired PRIVATE_DIAGNOSTIC'}})); process.exit(1); }
    if (prompt === 'slow') await new Promise(r => setTimeout(r, 12000));
    console.log(JSON.stringify({ok:true, outputs:[{text:prompt}]})); })();`);
  const server = await startBroker({ socket: join(dir, 'socket'), state: dir, config: join(import.meta.dir, 'openclaw-broker.json'), work: dir, node: process.execPath, cli });
  const argv = ['openclaw','infer','model','run','--prompt','hello'];
  try {
    expect(JSON.parse(await brokerInference(join(dir,'socket'), argv, 10000)).outputs[0].text).toBe('hello');
    argv[5] = 'slow';
    expect(JSON.parse(await brokerInference(join(dir,'socket'), argv, 20000)).outputs[0].text).toBe('slow');
    for (const scenario of ['auth', 'auth-stdout']) {
    argv[5] = scenario;
    let failure: unknown;
    try { await brokerInference(join(dir,'socket'), argv, 10000); } catch (e) { failure = e; }
    expect(isOAuthAuthFailure(failure)).toBe(true);
    expect(String(failure)).not.toContain('PRIVATE_DIAGNOSTIC');
    }
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(dir)).filter(x => x.startsWith('inference-'))).toEqual([]);
  } finally { server.stop(true); await rm(dir,{recursive:true,force:true}); }
}, 30000);
