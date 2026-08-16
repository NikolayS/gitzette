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
