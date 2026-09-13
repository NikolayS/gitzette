import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { OpenClawInferenceError } from './inference-error';

export function validateOwnerMetadata(store: any, profileId: string): void {
  const profile = store?.profiles?.[profileId];
  const order = store?.order?.openai;
  if (profile?.type !== 'oauth' || profile?.provider !== 'openai'
    || (order !== undefined && JSON.stringify(order) !== JSON.stringify([profileId]))) {
    throw new OpenClawInferenceError(401, '{"error":{"code":"invalid_oauth"}}');
  }
}
/** Inspect locally only. No credential material is returned or logged. */
export function checkOAuthOwner(state: string, profileId: string): void {
  let db: Database | undefined;
  try {
    db = new Database(join(state, 'state', 'openclaw.sqlite'), { readonly: true });
    const row = db.query("SELECT value_json FROM config_machine_state WHERE state_key = 'authProfiles.store'").get() as { value_json: string } | null;
    const ownership = db.query("SELECT value_json FROM config_machine_state WHERE state_key = 'auth.sharedStore'").get() as { value_json: string } | null;
    if (!ownership || JSON.parse(ownership.value_json)?.location !== 'state-db' || !row) throw new Error('unsupported OAuth owner');
    validateOwnerMetadata(JSON.parse(row.value_json), profileId);
  } catch {
    throw new OpenClawInferenceError(401, '{"error":{"code":"invalid_oauth"}}');
  } finally { db?.close(); }
}
