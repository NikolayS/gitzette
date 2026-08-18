# Production migration runbook

Run existing production migrations only through `bun run db:migrate` or the
protected tag deployment. The command first checks the one-time pre-cutover
baseline, then proves live D1 matches a clean replay of every migration already
recorded in its ledger. Only then does it apply pending migrations and compare
live D1 with the complete reviewed chain.

## Failed post-apply assertion

D1 rolls back the migration file that reports an apply error; previously
successful migration files remain applied. Wrangler also captures a backup
before applying migrations. Do not edit the migration ledger or retry by hand.
Preserve the failed command output, fix the unapplied migration in review, and
rerun the protected command. See Cloudflare's
[`d1 migrations apply` contract](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply).

If the remote apply succeeds but the final schema assertion fails, do not deploy
the new Worker. A maintainer authorized for the protected production environment
must preserve the command output, compare live D1 with the clean local replay produced by
`scripts/check-production-schema.sh`, and repair live D1 with a new reviewed
forward migration. Then rerun `bun run db:migrate`; deploy only after both the
pre-apply and post-apply schema assertions pass.

## Brand-new production database

`cutover-state.ts` classifies any database without a `d1_migrations` table as
`cutover`, including a truly empty D1 database. The normal `db:migrate` path then
requires the captured pre-cutover production schema, so it intentionally rejects
an empty replacement database.

For a newly created, never-used production D1 database, run
`bun run db:bootstrap` instead. It proves there are zero application tables,
applies the complete reviewed migration chain remotely, and runs the same final
schema-equivalence assertion as `db:migrate`. It fails closed on any non-empty
database; never use it to bypass the captured-baseline gate on an existing D1.

## Script entry points

Operators invoke only `bun run db:migrate`. Its internal gates are
`check-production-drift.sh` for the one-time captured baseline,
`check-production-applied-schema.sh` for the already-applied ledger prefix, and
`check-production-schema.sh` for the complete post-apply chain.
`check-production-baseline.sh` and `check-schema.sh` are local/CI assertions for
the committed fixture and migration chain; they do not inspect or mutate live
D1. All production schema checks are read-only. Only Wrangler's migration apply
step mutates production.

## Captured baseline provenance

`fixtures/production-baseline-2026-08-15.sql` is a canonical SQL reconstruction
of the pre-migration production `sqlite_master` captured on 2026-08-15, not a
byte-for-byte export. The exact read-only capture and canonicalization command
for its SQL body is below. Run it from the repository root and preserve the
fixture's provenance header when replacing the reviewed SQL body:

```bash
query="SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END,name"
./node_modules/.bin/wrangler d1 execute gitzette-db --remote --command "$query" --json \
  | bun -e 'const { canonicalSchema } = await import("./scripts/schema-equivalence.ts"); const rows = canonicalSchema(JSON.parse(await Bun.stdin.text())); console.log(rows.flatMap((row) => row.sql === null ? [] : [row.sql + ";"]).join("\n"));' \
  >/tmp/production-baseline-2026-08-15.sql
```

`canonicalSchema` removes line and block comments outside quoted strings,
collapses whitespace around punctuation, strips `IF NOT EXISTS`, and removes
unnecessary quotes from the declared object name. Review the resulting diff;
never use this capture command to bless unexpected production drift.

| Script | Pre-cutover database | Migrated database |
| --- | --- | --- |
| `check-production-baseline.sh` | Local/CI only: verifies the captured fixture matches `0000_base.sql`. | Same local/CI assertion; never contacts D1. |
| `check-production-drift.sh` | Compares live D1 with the captured baseline and must print `Production cutover gate OK: unmigrated live D1 matches the reviewed baseline`. | Validates that the ledger contains `0000_base.sql`, then prints `Production cutover gate skipped: D1 migration ledger already exists`. |
| `check-production-applied-schema.sh` | Must print `Applied-schema gate skipped: pre-cutover baseline gate owns the unmigrated database`. | Replays the exact ledger prefix locally and compares it with live D1 before mutation. |
| `check-production-schema.sh` | Runs after the first remote apply and compares live D1 with the complete chain. | Runs after every remote apply and compares live D1 with the complete chain. |

On the first successful `bun run db:migrate`, the operator must see the cutover
gate OK line, the applied-schema skipped line, Wrangler's successful migration
apply, and finally `Production schema OK: live D1 matches the complete reviewed
migration chain`. Any missing or different gate line is a failed cutover; stop
before deployment.
