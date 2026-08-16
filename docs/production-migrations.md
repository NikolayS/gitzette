# Production migration runbook

Run production migrations only through `bun run db:migrate` or the protected
tag deployment. The command first checks the one-time pre-cutover baseline,
then proves live D1 matches a clean replay of every migration already recorded
in its ledger. Only then does it apply pending migrations and compare live D1
with the complete reviewed chain.

## Failed post-apply assertion

D1 cannot roll back an already-applied multi-statement migration atomically. If
the remote apply succeeds but the final schema assertion fails, do not deploy
the new Worker and do not edit the migration ledger. A maintainer authorized for
the protected production environment must preserve the command output, compare
live D1 with the clean local replay produced by
`scripts/check-production-schema.sh`, and repair live D1 with a new reviewed
forward migration. Then rerun `bun run db:migrate`; deploy only after both the
pre-apply and post-apply schema assertions pass.

## Script entry points

Operators invoke only `bun run db:migrate`. Its internal gates are
`check-production-drift.sh` for the one-time captured baseline,
`check-production-applied-schema.sh` for the already-applied ledger prefix, and
`check-production-schema.sh` for the complete post-apply chain.
`check-production-baseline.sh` and `check-schema.sh` are local/CI assertions for
the committed fixture and migration chain; they do not inspect or mutate live
D1. All production schema checks are read-only. Only Wrangler's migration apply
step mutates production.

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
