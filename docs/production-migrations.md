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

Execute these shell entry points as files; do not source or pipe them. Each must
live beside `require-wrangler.sh` and its declared TypeScript entrypoints, so
out-of-tree wrappers and missing siblings fail closed. Invocation is
cwd-independent, though the documented `bun run` commands remain preferred.

## Production authorization availability

Nik (immutable GitHub user ID `1345402`) is deliberately the only production
environment reviewer. Normal release tags must be pushed by `samo-agent`
(immutable ID `280144521`), never by Nik: `prevent_self_review` rejects a run
whose actor is also its approver. If Nik accidentally pushes a release tag,
delete that undeployed tag and recreate it at the same reviewed commit using
`samo-agent`; never disable self-review.

Loss of Nik's account stops releases by design. Recovery requires a reviewed
policy change that adds a named human's immutable ID to both
`config/production-environment.json` and the checked-in approval validator,
followed by the full exact-head CI and samorev gates and a live environment
policy audit. Nik is the only person authorized to select that temporary human
and apply the live reviewer change. Revert the temporary reviewer in the next
reviewed PR immediately after the blocked release, then rerun the live audit.
If Nik is unavailable, releases stop; there is no emergency bypass through
repository secrets or an Actions actor.

## Captured baseline provenance

`fixtures/production-baseline-2026-08-15.sql` is a canonical SQL reconstruction
of the pre-migration production `sqlite_master` captured on 2026-08-15, not a
byte-for-byte export. `scripts/production-baseline-from-json.ts` now defines a
strict, deterministic derivation from Wrangler's raw JSON envelope to the
complete fixture, including its provenance header. The historical raw envelope
was not retained, so this repository does not claim byte-for-byte evidence it
does not have. The protected drift gate re-reads live D1 immediately before the
first migration. The exact read-only capture and regeneration commands are:

```bash
query="SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END,name"
./node_modules/.bin/wrangler d1 execute gitzette-db --remote --command "$query" --json \
  >/tmp/production-baseline-2026-08-15.raw.json
bun scripts/production-baseline-from-json.ts \
  /tmp/production-baseline-2026-08-15.raw.json 2026-08-15 \
  >/tmp/production-baseline-2026-08-15.sql
diff -u fixtures/production-baseline-2026-08-15.sql \
  /tmp/production-baseline-2026-08-15.sql
```

The raw capture contains production schema only; do not commit account data or
credentials. `canonicalSchema` removes line and block comments outside quoted strings,
collapses whitespace around punctuation, strips `IF NOT EXISTS`, and removes
unnecessary quotes from the declared object name. Review the resulting diff;
never use this capture command to bless unexpected production drift.
`check-schema.sh` alone passes `--strict`: it preserves stored SQL comments and
identifier quoting while still normalizing horizontal layout around punctuation.
SQLite strips `IF NOT EXISTS` before recording `sqlite_master.sql`, so that token
cannot be compared by this gate. The production drift, applied-prefix,
complete-chain, and baseline gates deliberately use canonical mode so authored
DDL differences do not make equivalent live SQLite schemas fail deployment.

| Script | Pre-cutover database | Migrated database |
| --- | --- | --- |
| `check-production-baseline.sh` | Local/CI only: verifies the captured fixture matches `0000_base.sql`. | Same local/CI assertion; never contacts D1. |
| `check-production-drift.sh` | Compares live D1 with the captured baseline and must print `Production cutover gate OK: unmigrated live D1 matches the reviewed baseline`. | Validates that the ledger contains `0000_base.sql`, then prints `Production cutover gate skipped: D1 migration ledger already exists`. |
| `check-production-applied-schema.sh` | Must print `Applied-schema gate skipped: pre-cutover baseline gate owns the unmigrated database`. | Replays the exact ledger prefix locally and compares it with live D1 before mutation. |
| `check-production-schema.sh` | Runs after the first remote apply and compares live D1 with the complete chain. | Runs after every remote apply and compares live D1 with the complete chain. |

On the first successful `bun run db:migrate`, the operator must see `Production
username collision preflight OK: zero case-fold collisions`, the cutover gate OK
line, the applied-schema skipped line, Wrangler's successful migration
apply, and finally `Production schema OK: live D1 matches the complete reviewed
migration chain`. The collision query is read-only and runs before migration
0004; any row aborts before mutation. The migration also deterministically
aborts before its lowercase update if two historical user IDs collide, as
proved by `src/migrations.test.ts`. No live zero-row result is claimed in this
repository until the protected production credential runs this gate. Any
missing or different gate line is a failed cutover; stop before deployment.
