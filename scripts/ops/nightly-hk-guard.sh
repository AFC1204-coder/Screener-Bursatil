#!/bin/bash
# Guardián del escaneo diario de Hong Kong (solo valores líquidos) para el Mac
# Mini. Plan: research/operacion-diaria-2026-11/plan-hong-kong-liquidos.md
#
# HK cierra a las 16:00 HKT (09:00 CET en invierno, 10:00 CEST en verano): el
# job se lanza ~10:15 hora local. Pasos:
#   0. Lista líquida (scripts/ops/hk-liquid-universe.mjs): se regenera si falta
#      o tiene más de STATSEDGE_HK_LIST_MAX_AGE_DAYS (7). Si falla y hay una
#      lista anterior, se sigue con ella (degraded).
#   1. Barras (scripts/refresh-bars-hk.mjs --write). exit=2 (tope de filas) NO se
#      reintenta; otros errores, una vez más.
#   2. Frescura real (bars-freshness.mjs --market HK --list …).
#   3. Scan (scripts/scan-universe-hk.mjs --write), con reintento.
#   4. Estado en logs/nightly-hk-status.json: ok | degraded | fail, y aviso por
#      notify.sh en degraded/fail.
#
# Variables (todas opcionales): STATSEDGE_GUARD_ROOT, STATSEDGE_GUARD_RETRY_SLEEP,
# STATSEDGE_GUARD_SCAN_ATTEMPTS, STATSEDGE_GUARD_BARS_TIMEOUT, STATSEDGE_HK_FRESH_MIN_PCT (90),
# STATSEDGE_HK_LIST_MAX_AGE_DAYS, y para pruebas: STATSEDGE_HK_LIST_CMD,
# STATSEDGE_HK_BARS_CMD, STATSEDGE_HK_FRESH_CMD, STATSEDGE_HK_SCAN_CMD.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="${STATSEDGE_GUARD_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" || exit 2
mkdir -p "$ROOT/logs"

GLOG="$ROOT/logs/nightly-hk-guard.log"
STATUS="$ROOT/logs/nightly-hk-status.json"
LIST="$ROOT/logs/hk-liquid-universe.json"
BARS_TIMEOUT="${STATSEDGE_GUARD_BARS_TIMEOUT:-1800}"
ATTEMPTS="${STATSEDGE_GUARD_SCAN_ATTEMPTS:-2}"
RETRY_SLEEP="${STATSEDGE_GUARD_RETRY_SLEEP:-120}"
FRESH_MIN="${STATSEDGE_HK_FRESH_MIN_PCT:-90}"
LIST_MAX_AGE="${STATSEDGE_HK_LIST_MAX_AGE_DAYS:-7}"
NODE_RUN=(node --env-file=.env.local --loader ./scripts/loader.mjs)

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$GLOG"; }
with_timeout() { local secs="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$secs" "$@"; }

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "guard HK start"

# ---- 0. Lista líquida -------------------------------------------------------
LIST_EXIT="fresh"
NEED_LIST=1
if [ -f "$LIST" ] && [ -z "$(find "$LIST" -mtime +"$LIST_MAX_AGE" 2>/dev/null)" ]; then NEED_LIST=0; fi
if [ "$NEED_LIST" = "1" ]; then
  log "lista líquida: regenerando"
  if [ -n "${STATSEDGE_HK_LIST_CMD:-}" ]; then "$STATSEDGE_HK_LIST_CMD" >> "$GLOG" 2>&1
  else with_timeout 300 "${NODE_RUN[@]}" scripts/ops/hk-liquid-universe.mjs --out logs/hk-liquid-universe.json >> "$GLOG" 2>&1; fi
  LIST_EXIT=$?
  log "lista exit=$LIST_EXIT"
else
  log "lista líquida: vigente (menos de ${LIST_MAX_AGE} días)"
fi
if [ ! -f "$LIST" ]; then
  FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"result":"fail","started":"%s","finished":"%s","reason":"no hay lista líquida de HK"}\n' "$STARTED" "$FINISHED" > "$STATUS"
  log "guard HK fin result=fail (sin lista)"
  NOTIFY_SH="$(cd "$(dirname "$0")" && pwd)/notify.sh"
  [ -x "$NOTIFY_SH" ] && "$NOTIFY_SH" --level error "Escaneo HK falló" "No hay lista líquida de HK y no se pudo generar." >/dev/null 2>&1
  exit 1
fi

# ---- 1. Barras --------------------------------------------------------------
BARS_EXIT=1
for i in 1 2; do
  log "bars HK intento $i/2"
  if [ -n "${STATSEDGE_HK_BARS_CMD:-}" ]; then with_timeout "$BARS_TIMEOUT" "$STATSEDGE_HK_BARS_CMD" >> "$ROOT/logs/refresh-bars-hk.out.log" 2>> "$ROOT/logs/refresh-bars-hk.err.log"
  else with_timeout "$BARS_TIMEOUT" "${NODE_RUN[@]}" scripts/refresh-bars-hk.mjs --write >> "$ROOT/logs/refresh-bars-hk.out.log" 2>> "$ROOT/logs/refresh-bars-hk.err.log"; fi
  BARS_EXIT=$?
  log "bars HK exit=$BARS_EXIT"
  [ "$BARS_EXIT" = "0" ] && break
  if [ "$BARS_EXIT" = "2" ]; then log "bars HK: parada por tope (exit=2); no se reintenta"; break; fi
  sleep "$RETRY_SLEEP"
done

# ---- 2. Frescura ------------------------------------------------------------
if [ -n "${STATSEDGE_HK_FRESH_CMD:-}" ]; then FOUT="$("$STATSEDGE_HK_FRESH_CMD" 2>> "$GLOG")"
else FOUT="$(with_timeout 180 node --env-file=.env.local scripts/ops/bars-freshness.mjs --market HK --list "$LIST" --json --min-pct "$FRESH_MIN" 2>> "$GLOG")"; fi
FRESH_EXIT=$?
FRESH_JSON="null"
FLINE="$(printf '%s' "$FOUT" | tail -1)"
case "$FLINE" in "{"*"}") FRESH_JSON="$FLINE" ;; esac
log "frescura HK exit=$FRESH_EXIT $FRESH_JSON"

# ---- 3. Scan ----------------------------------------------------------------
SCAN_EXIT=1; USED=0; n=1
while [ "$n" -le "$ATTEMPTS" ]; do
  USED="$n"
  log "scan HK intento $n/$ATTEMPTS"
  if [ -n "${STATSEDGE_HK_SCAN_CMD:-}" ]; then "$STATSEDGE_HK_SCAN_CMD" >> "$ROOT/logs/scan-universe-hk.out.log" 2>&1
  else "${NODE_RUN[@]}" scripts/scan-universe-hk.mjs --write >> "$ROOT/logs/scan-universe-hk.out.log" 2>&1; fi
  SCAN_EXIT=$?
  log "scan HK exit=$SCAN_EXIT"
  [ "$SCAN_EXIT" = "0" ] && break
  n=$((n + 1))
  [ "$n" -le "$ATTEMPTS" ] && sleep "$RETRY_SLEEP"
done

# ---- 4. Estado y aviso ------------------------------------------------------
FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REASON=""
if [ "$SCAN_EXIT" != "0" ]; then RESULT="fail"; REASON="el scan HK falló tras $USED intento(s)"
elif [ "$BARS_EXIT" != "0" ]; then RESULT="degraded"; REASON="refresh-bars-hk terminó con exit=$BARS_EXIT"
elif [ "$FRESH_EXIT" = "2" ]; then RESULT="degraded"; REASON="no se pudo medir la frescura de HK (frescura exit=2)"
elif [ "$FRESH_EXIT" != "0" ]; then RESULT="degraded"; REASON="barras HK atrasadas respecto a la última sesión (frescura exit=$FRESH_EXIT)"
elif [ "$LIST_EXIT" != "fresh" ] && [ "$LIST_EXIT" != "0" ]; then RESULT="degraded"; REASON="no se pudo regenerar la lista líquida (exit=$LIST_EXIT); se usó la anterior"
else RESULT="ok"; fi
printf '{"result":"%s","started":"%s","finished":"%s","scanExit":%s,"scanAttempts":%s,"barsExit":"%s","freshExit":"%s","listExit":"%s","freshness":%s,"reason":"%s"}\n' \
  "$RESULT" "$STARTED" "$FINISHED" "$SCAN_EXIT" "$USED" "$BARS_EXIT" "$FRESH_EXIT" "$LIST_EXIT" "$FRESH_JSON" "$REASON" > "$STATUS"
log "guard HK fin result=$RESULT${REASON:+ ($REASON)}"

if [ "$RESULT" != "ok" ]; then
  if [ "$RESULT" = "fail" ]; then LEVEL="error"; TITLE="Escaneo HK falló"; else LEVEL="warn"; TITLE="Escaneo HK con datos incompletos"; fi
  NOTIFY_SH="$(cd "$(dirname "$0")" && pwd)/notify.sh"
  [ -x "$NOTIFY_SH" ] && "$NOTIFY_SH" --level "$LEVEL" "$TITLE" "$REASON. Estado: $FRESH_JSON" >/dev/null 2>&1
fi
exit "$SCAN_EXIT"
