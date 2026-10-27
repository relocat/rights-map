#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
#
# Run the browser-JS unit tests (rights map engine, store, geo pack) under node:test.
# Usage: scripts/test-web-js.sh [test-file ...]   (default: every tests/js/**/*.test.mjs)
set -euo pipefail
readonly MIN_NODE_MAJOR=22
cd "$(dirname "$0")/.."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < MIN_NODE_MAJOR )); then
  echo "test-web-js: Node ${MIN_NODE_MAJOR}+ required, found $(node --version)" >&2
  exit 2
fi
# The data validator's tests import ajv, whose package lives at tools/; install it once.
readonly VALIDATOR_TOOL_DIR=tools
if [[ ! -d "$VALIDATOR_TOOL_DIR/node_modules" ]]; then
  npm ci --ignore-scripts --prefix "$VALIDATOR_TOOL_DIR" --no-audit --no-fund > /dev/null
fi
if (( $# > 0 )); then
  exec node --test "$@"
fi
exec node --test 'tests/js/**/*.test.mjs'
