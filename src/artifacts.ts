import { isUuid } from "./identifiers";

const MAX_DELETE_ROUNDS = 20;

export async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<void> {
  const match = /^staging\/([^/]+)\/(?:([^/]+)\/)?$/.exec(prefix);
  if (!match || !isUuid(match[1]) || (match[2] !== undefined && !isUuid(match[2]))) {
    throw new Error("R2 cleanup prefix must identify one staging job or lease");
  }
  let previousPage = "";
  for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
    const page = await bucket.list({ prefix, limit: 1000 });
    if (page.objects.length === 0) return;
    const keys = page.objects.map((object) => object.key);
    const signature = JSON.stringify(keys);
    if (signature === previousPage) throw new Error(`R2 cleanup made no progress for ${prefix}`);
    await bucket.delete(keys);
    previousPage = signature;
  }
  // Exhaustion is a hard failure: callers must never mistake partial cleanup
  // for success or silently leave staged content behind.
  throw new Error(`R2 cleanup exceeded ${MAX_DELETE_ROUNDS} rounds for ${prefix}`);
}
