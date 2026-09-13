import { test, expect } from 'bun:test';
import { credentialPlan } from './provision-runner-credentials';
const app = ['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','SESSION_SECRET'];
test('deployment preserves existing app secrets and only retires named legacy credentials', () => {
  expect(credentialPlan([...app,'OPENAI_API_KEY','STATUS_TOKEN','ADMIN_USER_ID'])).toEqual({put:['RUNNER_SECRET'],remove:['OPENAI_API_KEY']});
  expect(credentialPlan(app)).toEqual({put:['RUNNER_SECRET','STATUS_TOKEN','ADMIN_USER_ID'],remove:[]});
});
test('missing application credentials and unknown bindings stop provisioning before mutation', () => {
  expect(() => credentialPlan(['RUNNER_SECRET'])).toThrow('application bindings missing');
  expect(() => credentialPlan([...app,'OTHER_SECRET'])).toThrow('unreviewed');
});
test('deployment validates schema before credential mutation and retires only after deploy', async () => {
  const workflow=await Bun.file(new URL('../.github/workflows/deploy.yml',import.meta.url)).text();
  const check=workflow.indexOf('provision-runner-credentials.ts check');
  const schema=workflow.indexOf('bash scripts/check-production-schema.sh');
  const sync=workflow.indexOf('provision-runner-credentials.ts sync');
  const deploy=workflow.indexOf('run: ./node_modules/.bin/wrangler deploy');
  const retire=workflow.indexOf('provision-runner-credentials.ts retire');
  expect(check).toBeGreaterThan(0);
  expect(schema).toBeGreaterThan(check);
  expect(sync).toBeGreaterThan(schema);
  expect(deploy).toBeGreaterThan(sync);
  expect(retire).toBeGreaterThan(deploy);
  expect(workflow.indexOf('bash scripts/check-production-secrets.sh')).toBeGreaterThan(retire);
});
