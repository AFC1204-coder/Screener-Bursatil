#!/bin/bash
# .claude/hooks/verify-nightly.sh
# Stop hook: verifica de forma determinista antes de dejar parar la sesión.
set -euo pipefail

INPUT=$(cat)
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

MANIFEST=".claude/nightly-manifest.json"
TELEGRAM_URL="https://api.telegram.org/bot<TU_BOT_TOKEN>/sendMessage"
CHAT_ID="<TU_CHAT_ID>"

PROTECTED_FILES=(
  "app/api/chart/estimatedBars.js"
  "components/UniversalPriceChart.jsx"
)

notify() {
  curl -s -X POST "$TELEGRAM_URL" -d chat_id="$CHAT_ID" -d text="$1" > /dev/null || true
}

if [ ! -f "$MANIFEST" ]; then
  notify "StatsEdge nocturna: termino SIN escribir manifiesto. Revisar a mano."
  exit 0
fi

STATUS=$(jq -r '.status' "$MANIFEST")
EXPECTED=$(jq -r '.expected_output' "$MANIFEST")
TASK=$(jq -r '.task' "$MANIFEST")
BASE_SHA=$(jq -r '.base_sha' "$MANIFEST")

if [ "$STATUS" = "success" ] && [ ! -e "$EXPECTED" ]; then
  echo "El manifiesto dice 'success' pero $EXPECTED no existe en disco. Corrige antes de parar." >&2
  exit 2
fi

if [ "$BASE_SHA" != "null" ] && [ -n "$BASE_SHA" ]; then
  DIFF_FILES=$(git diff --name-only "$BASE_SHA" 2>/dev/null || true)
  for f in "${PROTECTED_FILES[@]}"; do
    if echo "$DIFF_FILES" | grep -qx "$f"; then
      notify "StatsEdge nocturna ($TASK): toco archivo protegido ($f). NO comitear."
      echo "Archivo protegido modificado: $f. Revierte ese cambio." >&2
      exit 2
    fi
  done

  SUSPICIOUS=$(git diff "$BASE_SHA" -- '*.test.*' '*.spec.*' 2>/dev/null | grep -E '^\+.*(\.skip\(|\.only\(|xit\(|xdescribe\()' || true)
  if [ -n "$SUSPICIOUS" ]; then
    notify "StatsEdge nocturna ($TASK): tests con patrones sospechosos. Revisar."
    echo "Tests debilitados o saltados detectados. Arregla la causa raiz real." >&2
    exit 2
  fi
fi

case "$STATUS" in
  success) notify "StatsEdge nocturna OK: $TASK. Verificado: $EXPECTED existe." ;;
  partial) notify "StatsEdge nocturna parcial: $TASK. Revisar worktree." ;;
  *) notify "StatsEdge nocturna en estado '$STATUS': $TASK. Revisar manifiesto." ;;
esac

exit 0
