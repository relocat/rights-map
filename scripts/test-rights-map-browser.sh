#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
#
# Browser test for the Rights Map demo page: serves demo/index.html and the static tree on a free
# port with a strict Content-Security-Policy, runs the Playwright driver against it, and exits
# non-zero if any assertion fails. Groups that need the Relocat server are skipped and named.
# Usage: scripts/test-rights-map-browser.sh      (screenshots: set RM_SHOTS_DIR to keep them)
set -euo pipefail
readonly MIN_NODE_MAJOR=22
readonly HOST=127.0.0.1
readonly READY_ATTEMPTS=50
readonly READY_POLL_SECONDS=0.2
readonly DEMO_SHELL_PATH=demo/index.html
cd "$(dirname "$0")/.."

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < MIN_NODE_MAJOR )); then
  echo "test-rights-map-browser: Node ${MIN_NODE_MAJOR}+ required, found $(node --version)" >&2
  exit 2
fi
if [[ ! -d scripts/test-web-e2e/node_modules ]]; then
  npm ci --ignore-scripts --prefix scripts/test-web-e2e
fi

port="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();})')"
server_pid=""
# Path (not yet created) of the defaults fixture the driver writes and the test server serves.
defaults_fixture="$(mktemp -u --suffix=.json rights-map-defaults-XXXXXX --tmpdir)"

# Kill only the server this script started; drop the fixture.
cleanup() {
  rm -f "$defaults_fixture"
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

export RM_STATIC_SHELL=1
RM_DEFAULTS_FIXTURE="$defaults_fixture" RM_SHELL_FILE="$DEMO_SHELL_PATH" RM_PORT="$port" node tests/browser/rights_map/server.mjs &
server_pid=$!

for _ in $(seq "$READY_ATTEMPTS"); do
  if curl -sf -o /dev/null "http://${HOST}:${port}/map/"; then break; fi
  sleep "$READY_POLL_SECONDS"
done
curl -sf -o /dev/null "http://${HOST}:${port}/map/" || { echo "test-rights-map-browser: server did not start" >&2; exit 1; }

RM_DEFAULTS_FIXTURE="$defaults_fixture" RM_BASE_URL="http://${HOST}:${port}" node tests/browser/rights_map/drive.mjs
