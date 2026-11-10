#!/usr/bin/env bash
# Controlled deploy + sandbox validation of hardened V1 acceptance gates on Mini.
# Does NOT enqueue/run/resume. Does NOT touch product or v1.py.
set -euo pipefail

MINI_HOST="${MINI_HOST:-cristian@192.168.0.116}"
REMOTE_ROOT="${REMOTE_ROOT:-/Users/cristian/Documents/StatsEdgeV1}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
CTRL="$ROOT/controls"
FIX="$ROOT/validation-fixtures"
LOG="$ROOT/logs"
mkdir -p "$LOG"

ssh_mini() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$MINI_HOST" "$@"
}

echo "== preflight =="
ssh_mini "hostname; test -d '$REMOTE_ROOT'; python3 '$REMOTE_ROOT/v1.py' status" | tee "$LOG/preflight-status.txt"

echo "== before hashes =="
ssh_mini "cd '$REMOTE_ROOT' && shasum -a 256 v1.py accept-date.mjs accept-cache.mjs contracts/date-001.json contracts/cache-001.json 2>/dev/null; shasum -a 256 source/lib/formatters.js source/lib/serverCache.js 2>/dev/null || true" | tee "$LOG/before-hashes.txt"

echo "== deploy controls only =="
scp -o BatchMode=yes -o ConnectTimeout=10 \
  "$CTRL/accept-date.mjs" "$CTRL/accept-cache.mjs" \
  "$MINI_HOST:$REMOTE_ROOT/"
scp -o BatchMode=yes -o ConnectTimeout=10 \
  "$CTRL/contracts/date-001.json" "$CTRL/contracts/cache-001.json" \
  "$MINI_HOST:$REMOTE_ROOT/contracts/"

# Validation fixtures in a NON-control path (not used by executor)
ssh_mini "mkdir -p '$REMOTE_ROOT/validation-fixtures/date' '$REMOTE_ROOT/validation-fixtures/cache'"
scp -o BatchMode=yes -o ConnectTimeout=10 \
  "$FIX/date/"*.js "$MINI_HOST:$REMOTE_ROOT/validation-fixtures/date/"
scp -o BatchMode=yes -o ConnectTimeout=10 \
  "$FIX/cache/"*.js "$MINI_HOST:$REMOTE_ROOT/validation-fixtures/cache/"

echo "== after hashes =="
ssh_mini "cd '$REMOTE_ROOT' && shasum -a 256 v1.py accept-date.mjs accept-cache.mjs contracts/date-001.json contracts/cache-001.json source/lib/formatters.js source/lib/serverCache.js 2>/dev/null" | tee "$LOG/after-hashes.txt"

echo "== DATE validation =="
ssh_mini "cd '$REMOTE_ROOT' && \
node accept-date.mjs validation-fixtures/date/baseline-formatters.js; echo DATE_A_BASELINE_EXIT:\$?; \
node accept-date.mjs validation-fixtures/date/wrong-formatters.js; echo DATE_B_WRONG_EXIT:\$?; \
node accept-date.mjs validation-fixtures/date/right-formatters.js; echo DATE_C_RIGHT_EXIT:\$?; \
node accept-date.mjs validation-fixtures/date/preservation-break-formatters.js; echo DATE_D_PRESERVATION_EXIT:\$?" \
  | tee "$LOG/date-validation.txt"

echo "== CACHE validation =="
ssh_mini "cd '$REMOTE_ROOT' && \
node accept-cache.mjs validation-fixtures/cache/baseline-serverCache.js; echo CACHE_A_BASELINE_EXIT:\$?; \
node accept-cache.mjs validation-fixtures/cache/wrong-serverCache.js; echo CACHE_B_WRONG_EXIT:\$?; \
node accept-cache.mjs validation-fixtures/cache/right-serverCache.js; echo CACHE_C_RIGHT_EXIT:\$?; \
node accept-cache.mjs validation-fixtures/cache/preservation-break-serverCache.js; echo CACHE_D_PRESERVATION_EXIT:\$?" \
  | tee "$LOG/cache-validation.txt"

echo "== post status (must remain paused; no new tasks) =="
ssh_mini "python3 '$REMOTE_ROOT/v1.py' status" | tee "$LOG/post-status.txt"

echo "DONE — review logs under $LOG; do not enqueue/run."
