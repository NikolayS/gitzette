#!/usr/bin/env bash
set -euo pipefail

state_dir="$(mktemp -d)"
# Do not use OpenClaw's 18789/18790 gateway ports. Pick a high, per-run port
# so parallel CI jobs and local services cannot turn this into a false E2E.
port=$((38000 + RANDOM % 20000))
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -r "$state_dir"
}
trap cleanup EXIT

bunx wrangler d1 migrations apply gitzette-db --local --persist-to "$state_dir" >/dev/null
bunx wrangler d1 execute gitzette-db --local --persist-to "$state_dir" --command \
  "INSERT INTO users(id,username,avatar_url) VALUES('1','octocat',''),('2','intruder',''); INSERT INTO sessions(token,user_id,expires_at) VALUES('e2e-session','1',unixepoch()+3600),('intruder-session','2',unixepoch()+3600);" >/dev/null

bunx wrangler dev --local --port "$port" --persist-to "$state_dir" \
  --var RUNNER_SECRET:e2e-runner-secret \
  --var SESSION_SECRET:e2e-session-secret \
  --show-interactive-dev-session=false >"$state_dir/wrangler.log" 2>&1 &
server_pid=$!

ready=false
for _ in $(seq 1 60); do
  if curl --silent --fail "http://127.0.0.1:$port/" | rg -q "gitzette"; then
    ready=true
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$state_dir/wrangler.log"
    exit 1
  fi
  sleep 0.25
done

if [[ "$ready" != true ]]; then
  cat "$state_dir/wrangler.log"
  exit 1
fi

E2E_BASE_URL="http://127.0.0.1:$port" bun scripts/e2e.ts
