#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "e2e.sh must be executed by path, not through stdin" >&2
  exit 1
fi
set -euo pipefail

# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"
gitzette_require_checked_in_caller \
  "e2e.sh" "${BASH_SOURCE[0]:-}" "$0" "e2e.ts"
gitzette_require_local

state_dir="$(mktemp -d)"
port=""
server_pid=""

stop_server() {
  if [[ -n "$server_pid" ]]; then
    kill -TERM -- -"$server_pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      if ! kill -0 -- -"$server_pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    if kill -0 -- -"$server_pid" 2>/dev/null; then
      kill -KILL -- -"$server_pid" 2>/dev/null || true
    fi
    wait "$server_pid" 2>/dev/null || true
    server_pid=""
  fi
}

cleanup() {
  stop_server
  rm -rf "$state_dir"
}
trap cleanup EXIT
trap 'trap - EXIT; cleanup; exit 130' INT
trap 'trap - EXIT; cleanup; exit 143' TERM

local_wrangler d1 migrations apply gitzette-db --local --persist-to "$state_dir" >/dev/null
local_wrangler d1 execute gitzette-db --local --persist-to "$state_dir" --command \
  "INSERT INTO users(id,username,avatar_url) VALUES('1','octocat',''),('2','NikolayS',''),('3','target-user',''),('4','DHH',''),('5','dcramer',''),('6','karpathy',''),('7','levkk',''),('8','mitchellh',''),('9','simonw',''),('10','steipete',''),('11','torvalds',''); INSERT INTO sessions(token,user_id,expires_at) VALUES('e2e-session','1',unixepoch()+3600),('intruder-session','2',unixepoch()+3600),('target-session','3',unixepoch()+3600); INSERT INTO dispatches(user_id,week_key) VALUES('1','generating');" >/dev/null

ready=false
for _attempt in $(seq 1 5); do
  # Ask the kernel for a free loopback port, then retry if another process wins
  # the small close-to-bind race before Wrangler starts.
  port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
  setsid "$wrangler_bin" dev --local --test-scheduled --port "$port" --persist-to "$state_dir" \
    --var RUNNER_SECRET:e2e-runner-secret \
    --var STATUS_TOKEN:e2e-status-token \
    --var SESSION_SECRET:e2e-session-secret \
    --var ADMIN_USER_ID:1 \
    --var ROLLING_7D_USER_GENERATION_LIMIT:2 \
    --var ROLLING_7D_GLOBAL_GENERATION_LIMIT:4 \
    --var MAX_QUEUE_AGE_SECONDS:20 \
    --var CLEANUP_SWEEP_ENABLED:true \
    --var WEEKLY_GENERATION_ENABLED:true \
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
    stop_server
  fi
done

if [[ "$ready" != true ]]; then
  cat "$state_dir/wrangler.log"
  exit 1
fi

E2E_BASE_URL="http://127.0.0.1:$port" bun "$gitzette_scripts_directory/e2e.ts"
