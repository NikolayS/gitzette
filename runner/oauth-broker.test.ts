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

test('unfinished uploads and SIGTERM-resistant children cannot monopolize the socket', async () => {
  const dir=await mkdtemp(join(tmpdir(),'gz-bounded-'));
  const cli=join(dir,'fake-cli.js');
  await Bun.write(cli, `const a=process.argv; if(a[a.indexOf('--prompt')+1]==='hang') { process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); } else console.log(JSON.stringify({ok:true,outputs:[{text:'ready'}]}));`);
  const socket=join(dir,'socket');
  const server=await startBroker({socket,state:dir,config:join(import.meta.dir,'openclaw-broker.json'),work:dir,node:process.execPath,cli,bodyTimeoutMs:100,inferenceTimeoutMs:200});
  const {createConnection}=await import('node:net');
  const raw=createConnection(socket);
  try {
    await new Promise<void>((resolve,reject)=>{ raw.once('connect',resolve);raw.once('error',reject); });
    const rejected=new Promise<string>(resolve=>raw.once('data',b=>resolve(b.toString())));
    raw.write('POST /infer HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{');
    expect(await rejected).toContain('400');
    raw.destroy();
    const argv=['openclaw','infer','model','run','--prompt','hang'];
    await expect(brokerInference(socket,argv,5000)).rejects.toThrow();
    argv[5]='ready';
    expect(JSON.parse(await brokerInference(socket,argv,5000)).outputs[0].text).toBe('ready');
  } finally { raw.destroy();server.stop(true);await rm(dir,{recursive:true,force:true}); }
},10000);

test('owner database startup failures retain auth classification over the socket', async () => {
  const {checkOAuthOwner}=await import('./oauth-owner');
  const dir=await mkdtemp(join(tmpdir(),'gz-owner-socket-'));
  const socket=join(dir,'socket');
  const server=await startBroker({socket,state:dir,config:join(import.meta.dir,'openclaw-broker.json'),work:dir,node:process.execPath,cli:'unused',beforeRequest:()=>checkOAuthOwner(dir,'openai:owner')});
  try {
    let failure:unknown;
    try { await brokerInference(socket,['openclaw','infer','model','run','--prompt','hello'],5000); } catch(e) { failure=e; }
    expect(isOAuthAuthFailure(failure)).toBe(true);
  } finally { server.stop(true);await rm(dir,{recursive:true,force:true}); }
});

test('real socket transfers image bytes both ways and cleans up failed image calls', async () => {
  const dir=await mkdtemp(join(tmpdir(),'gz-image-socket-'));
  const cli=join(dir,'fake-cli.js');
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64');
  await Bun.write(cli, `const fs=require('fs'),path=require('path'),a=process.argv,p=a[a.indexOf('--prompt')+1];
    if(a.includes('generate')) {
      const out=a[a.indexOf('--output')+1];
      if(p!=='missing') fs.writeFileSync(out,p==='oversized'?Buffer.alloc(8*1024*1024+1):Buffer.from('${bytes.toString('base64')}','base64'));
      console.log(JSON.stringify({ok:true,ownerLocal:path.dirname(out)===process.cwd()&&path.basename(out)==='output.png'}));
    } else {
      const input=a[a.indexOf('--file')+1];
      if(p==='fail') process.exit(1);
      console.log(JSON.stringify({ok:true,hex:fs.readFileSync(input).toString('hex'),ownerLocal:path.dirname(input)===process.cwd()&&path.basename(input)==='input.webp'}));
    }`);
  const socket=join(dir,'socket');
  const server=await startBroker({socket,state:dir,config:join(import.meta.dir,'openclaw-broker.json'),work:dir,node:process.execPath,cli});
  const output=join(dir,'runner-output.png'),input=join(dir,'runner-input.webp');
  const gen=['openclaw','infer','image','generate','--prompt','good','--output',output];
  const review=['openclaw','infer','image','describe','--prompt','good','--file',input];
  const {readdir}=await import('node:fs/promises');
  try {
    expect(JSON.parse(await brokerInference(socket,gen,5000)).ownerLocal).toBe(true);
    expect(Buffer.from(await Bun.file(output).arrayBuffer()).equals(bytes)).toBe(true);
    await Bun.write(input,bytes);
    const verdict=JSON.parse(await brokerInference(socket,review,5000));
    expect(verdict.ownerLocal).toBe(true);expect(verdict.hex).toBe(bytes.toString('hex'));
    for(const kind of ['missing','oversized']) {
      gen[5]=kind;
      await expect(brokerInference(socket,gen,5000)).rejects.toThrow();
      expect(Buffer.from(await Bun.file(output).arrayBuffer()).equals(bytes)).toBe(true);
      expect((await readdir(dir)).filter(x=>x.startsWith('inference-'))).toEqual([]);
    }
    review[5]='fail';await expect(brokerInference(socket,review,5000)).rejects.toThrow();
    expect((await readdir(dir)).filter(x=>x.startsWith('inference-'))).toEqual([]);
  } finally { server.stop(true);await rm(dir,{recursive:true,force:true}); }
});
