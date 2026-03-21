// One-time migration: move HTML from D1 to R2
// Run with: CLOUDFLARE_API_TOKEN=... bun scripts/migrate-to-r2.ts

const ACCOUNT_ID = "a3265e0d0db71fdece29365819452f00";
const DB_ID = "4a3624d7-7de8-46d5-91f5-7ee79856ccaa";
const BUCKET = "gitzette-dispatches";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN!;

async function d1Query(sql: string, params: any[] = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await res.json() as any;
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result[0].results;
}

async function r2Put(key: string, html: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "text/html; charset=utf-8",
      },
      body: html,
    }
  );
  if (!res.ok) throw new Error(`R2 PUT failed: ${res.status} ${await res.text()}`);
}

const rows = await d1Query(
  `SELECT u.username, d.week_key, d.html FROM dispatches d JOIN users u ON u.id=d.user_id WHERE d.html IS NOT NULL AND d.html != '...generating...' AND d.r2_key IS NULL`
);

console.log(`Migrating ${rows.length} rows...`);

for (const row of rows) {
  const r2Key = `dispatches/${row.username}/${row.week_key}.html`;
  console.log(`  ${row.username}/${row.week_key} → ${r2Key} (${row.html.length} bytes)`);
  await r2Put(r2Key, row.html);
  await d1Query(
    `UPDATE dispatches SET r2_key=? WHERE user_id=(SELECT id FROM users WHERE username=?) AND week_key=?`,
    [r2Key, row.username, row.week_key]
  );
  console.log(`  ✓ done`);
}

console.log("Migration complete.");
