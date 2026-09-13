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
