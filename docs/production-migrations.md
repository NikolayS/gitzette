# Production migration runbook

Run production migrations only through `bun run db:migrate` or the protected
tag deployment. The command first checks the one-time pre-cutover baseline,
then proves live D1 matches a clean replay of every migration already recorded
in its ledger. Only then does it apply pending migrations and compare live D1
with the complete reviewed chain.

D1 cannot roll back an already-applied multi-statement migration atomically. If
the remote apply succeeds but the final schema assertion fails, do not deploy
the new Worker and do not edit the migration ledger. Preserve the command
output, compare the live schema with the clean local replay produced by
`scripts/check-production-schema.sh`, and repair live D1 with a new reviewed
forward migration. Then rerun `bun run db:migrate`; deploy only after both the
pre-apply and post-apply schema assertions pass.
