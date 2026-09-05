#!/bin/bash
# launchd-friendly: US nightly scan-universe.mjs --write (MIGRATE-5).
# Credenciales vía node --env-file=.env.local (no source frágil del .env).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/logs"

if [ ! -f "$ROOT/.env.local" ]; then
  echo "missing .env.local" >&2
  exit 1
fi

CONCURRENCY="${STATSEDGE_SCAN_UNIVERSE_CONCURRENCY:-4}"
EXTRA_ARGS=()

if [ -n "${STATSEDGE_SCAN_UNIVERSE_LIMIT:-}" ]; then
  EXTRA_ARGS+=(--limit="${STATSEDGE_SCAN_UNIVERSE_LIMIT}")
fi
if [ "${STATSEDGE_SCAN_UNIVERSE_NOCTURNO_REAL:-}" = "1" ]; then
  EXTRA_ARGS+=(--nocturno-real)
fi
if [ "${STATSEDGE_SCAN_UNIVERSE_SIN_RETENCION:-}" = "1" ]; then
  EXTRA_ARGS+=(--sin-retencion)
fi

LOG="$ROOT/logs/scan-universe-us.log"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) start concurrency=$CONCURRENCY extra=${EXTRA_ARGS[*]:-none}" >> "$LOG"

set +e
node --env-file=.env.local --loader ./scripts/loader.mjs \
  scripts/scan-universe.mjs \
  --write --concurrency="$CONCURRENCY" \
  "${EXTRA_ARGS[@]}" \
  >> "$ROOT/logs/scan-universe-us.out.log" 2>> "$ROOT/logs/scan-universe-us.err.log"
EXIT=$?
set -e

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$EXIT" >> "$LOG"
exit "$EXIT"
