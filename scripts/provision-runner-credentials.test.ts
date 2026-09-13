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
