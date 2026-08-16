#!/usr/bin/env bash
set -euo pipefail

state_dir="$(mktemp -d)"
port=""
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill -- -"$server_pid" 2>/dev/null || kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    server_pid=""
  fi
  rm -rf "$state_dir"
}
trap cleanup EXIT
trap 'trap - EXIT; cleanup; exit 130' INT
trap 'trap - EXIT; cleanup; exit 143' TERM

bunx wrangler d1 migrations apply gitzette-db --local --persist-to "$state_dir" >/dev/null
bunx wrangler d1 execute gitzette-db --local --persist-to "$state_dir" --command \
  "INSERT INTO users(id,username,avatar_url) VALUES('1','octocat',''),('2','intruder',''); INSERT INTO sessions(token,user_id,expires_at) VALUES('e2e-session','1',unixepoch()+3600),('intruder-session','2',unixepoch()+3600);" >/dev/null

ready=false
for attempt in $(seq 1 5); do
  # Ask the kernel for a free loopback port, then retry if another process wins
  # the small close-to-bind race before Wrangler starts.
  port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
  setsid bunx wrangler dev --local --port "$port" --persist-to "$state_dir" \
    --var RUNNER_SECRET:e2e-runner-secret \
    --var SESSION_SECRET:e2e-session-secret \
    --var ROLLING_7D_USER_GENERATION_LIMIT:10 \
    --var ROLLING_7D_GLOBAL_GENERATION_LIMIT:5 \
    --var MAX_QUEUE_AGE_SECONDS:2 \
    --var RUNNER_LEASE_SECONDS:2 \
    --show-interactive-dev-session=false >"$state_dir/wrangler.log" 2>&1 &
  server_pid=$!

  for _ in $(seq 1 60); do
    response="$(curl --silent --fail "http://127.0.0.1:$port/" || true)"
    if [[ "$response" == *gitzette* ]]; then
      ready=true
      break 2
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      wait "$server_pid" 2>/dev/null || true
      server_pid=""
      break
    fi
    sleep 0.25
  done

  if [[ -n "$server_pid" ]]; then
    kill -- -"$server_pid" 2>/dev/null || kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    server_pid=""
  fi
done

if [[ "$ready" != true ]]; then
  cat "$state_dir/wrangler.log"
  exit 1
fi

E2E_BASE_URL="http://127.0.0.1:$port" bun scripts/e2e.ts
