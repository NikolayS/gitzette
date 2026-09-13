import { test, expect } from 'bun:test';
import { validateOwnerMetadata } from './oauth-owner';
test('missing OAuth identity, API-key replacement, and wider store order fail closed', () => {
  const profile = 'openai:owner';
  const base = { profiles: { [profile]: { provider: 'openai', type: 'oauth' } } };
  expect(() => validateOwnerMetadata(base, profile)).not.toThrow();
  expect(() => validateOwnerMetadata({ profiles: {} }, profile)).toThrow();
  expect(() => validateOwnerMetadata({ profiles: { [profile]: { provider: 'openai', type: 'api_key' } } }, profile)).toThrow();
  expect(() => validateOwnerMetadata({ ...base, order: { openai: [profile, 'openai:other'] } }, profile)).toThrow();
});

import { checkOAuthOwner } from './oauth-owner';
import { isOAuthAuthFailure } from './auth-failure';
import { mkdtemp, mkdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('missing or unreadable canonical databases are terminal OAuth failures', async () => {
  const dir=await mkdtemp(join(tmpdir(),'gz-owner-'));
  try {
    let failure:unknown;
    try { checkOAuthOwner(dir,'openai:owner'); } catch(e) { failure=e; }
    expect(isOAuthAuthFailure(failure)).toBe(true);
    await mkdir(join(dir,'state'));
    await Bun.write(join(dir,'state/openclaw.sqlite'),'not a SQLite database');
    await chmod(join(dir,'state/openclaw.sqlite'),0);
    try { checkOAuthOwner(dir,'openai:owner'); } catch(e) { failure=e; }
    expect(isOAuthAuthFailure(failure)).toBe(true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
