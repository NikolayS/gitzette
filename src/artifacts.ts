const MAX_DELETE_ROUNDS = 20;

export async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<void> {
  if (!prefix || !prefix.endsWith("/")) throw new Error("R2 cleanup prefix must be nonempty and delimiter-terminated");
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
  throw new Error(`R2 cleanup exceeded ${MAX_DELETE_ROUNDS} rounds for ${prefix}`);
}
