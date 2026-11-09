#!/bin/bash
# Guardián del nocturno US para el Mac Mini (launchd). NO sustituye a
# scripts/run-scan-universe-us.sh: lo envuelve y añade lo que faltaba.
#
#   1. Refresca las barras US (refresh-bars --write) antes de escanear. Nada
#      más las refresca a diario desde que Supabase está pausado, y el scan
#      solo calcula con las barras que ya existen. Un fallo aquí NO impide el
#      scan (se escanea con lo que haya) pero queda registrado.
#   2. Ejecuta el scan con reintento (por defecto 2 intentos, 2 min de pausa).
#      Antes un exit=1 por timeout se quedaba en silencio hasta el día siguiente.
#   3. Mide la frescura REAL de las barras tras el refresco
#      (scripts/ops/bars-freshness.mjs): qué % del universo US tiene la última
#      sesión asentada. El código de salida de refresh-bars no basta: con
#      exit=2 (parada por el tope de filas) el scan corría con barras viejas y
#      el estado salía «ok».
#   4. Deja logs/nightly-us-status.json con el resultado:
#        ok        scan bien y barras al día
#        degraded  scan bien, pero el refresco falló o el universo está atrasado
#        fail      el scan falló tras los reintentos
#      y avisa (notify.sh → ntfy si hay NOTIFY_URL; notificación de macOS y, si
#      se define STATSEDGE_GUARD_WEBHOOK_URL, un POST) en degraded y fail.
#
# refresh-bars con exit=2 (tope de filas) NO se reintenta: es determinista y
# reprocesaría el mismo bloque. Solo se reintenta ante otros errores.
#
# El usuario del producto ve el efecto en el screener: si los precios llevan
# 2+ sesiones sin actualizarse aparece «Precios del …» (lib/dataAge.js).
#
# Variables (todas opcionales):
#   STATSEDGE_GUARD_BARS_TIMEOUT   segundos máx. del refresco de barras (2400)
#   STATSEDGE_GUARD_SCAN_ATTEMPTS  intentos del scan (2)
#   STATSEDGE_GUARD_RETRY_SLEEP    pausa entre intentos, s (120)
#   STATSEDGE_GUARD_SKIP_BARS=1    no refrescar barras
#   STATSEDGE_GUARD_DRY=1          no ejecuta nada: solo registra qué haría
#   STATSEDGE_GUARD_SCAN_CMD       sustituye el comando del scan (pruebas)
#   STATSEDGE_GUARD_BARS_CMD       sustituye el refresco de barras (pruebas)
#   STATSEDGE_GUARD_FRESH_CMD      sustituye la medición de frescura (pruebas);
#                                  debe imprimir una línea JSON y salir 0/1
#   STATSEDGE_GUARD_FRESH_MIN_PCT  % mínimo del universo al día (90)
#   STATSEDGE_GUARD_SKIP_FRESH=1   no medir la frescura
#   STATSEDGE_GUARD_ROOT           raíz del repo/logs (pruebas)
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="${STATSEDGE_GUARD_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" || exit 2
mkdir -p "$ROOT/logs"

GLOG="$ROOT/logs/nightly-us-guard.log"
STATUS="$ROOT/logs/nightly-us-status.json"
BARS_TIMEOUT="${STATSEDGE_GUARD_BARS_TIMEOUT:-2400}"
ATTEMPTS="${STATSEDGE_GUARD_SCAN_ATTEMPTS:-2}"
RETRY_SLEEP="${STATSEDGE_GUARD_RETRY_SLEEP:-120}"
DRY="${STATSEDGE_GUARD_DRY:-0}"
SCAN_CMD="${STATSEDGE_GUARD_SCAN_CMD:-$ROOT/scripts/run-scan-universe-us.sh}"
BARS_CMD="${STATSEDGE_GUARD_BARS_CMD:-}"
FRESH_CMD="${STATSEDGE_GUARD_FRESH_CMD:-}"
FRESH_MIN="${STATSEDGE_GUARD_FRESH_MIN_PCT:-90}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$GLOG"; }

# timeout portable (macOS no trae `timeout`): alarm + exec.
with_timeout() {
  local secs="$1"; shift
  perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
}

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "guard start dry=$DRY attempts=$ATTEMPTS skip_bars=${STATSEDGE_GUARD_SKIP_BARS:-0}"

# ---- 1. Barras US -----------------------------------------------------------
BARS_EXIT="skipped"
if [ "${STATSEDGE_GUARD_SKIP_BARS:-0}" != "1" ]; then
  for i in 1 2; do
    log "bars intento $i/2 timeout=${BARS_TIMEOUT}s"
    if [ "$DRY" = "1" ]; then
      log "DRY: refresh-bars.mjs --write --stale-days=1"; BARS_EXIT=0; break
    fi
    if [ -n "$BARS_CMD" ]; then
      with_timeout "$BARS_TIMEOUT" "$BARS_CMD" \
        >> "$ROOT/logs/refresh-bars-us.out.log" 2>> "$ROOT/logs/refresh-bars-us.err.log"
    else
      with_timeout "$BARS_TIMEOUT" node --env-file=.env.local --loader ./scripts/loader.mjs \
        scripts/refresh-bars.mjs --write --stale-days=1 --max-filas=2500000 \
        >> "$ROOT/logs/refresh-bars-us.out.log" 2>> "$ROOT/logs/refresh-bars-us.err.log"
    fi
    BARS_EXIT=$?
    log "bars exit=$BARS_EXIT"
    [ "$BARS_EXIT" = "0" ] && break
    if [ "$BARS_EXIT" = "2" ]; then
      log "bars: parada por tope de filas (exit=2); no se reintenta, repetiría el mismo bloque"
      break
    fi
    sleep "$RETRY_SLEEP"
  done
fi

# ---- 1b. Frescura real de las barras ---------------------------------------
FRESH_JSON="null"
FRESH_EXIT="skipped"
if [ "$DRY" != "1" ] && [ "${STATSEDGE_GUARD_SKIP_FRESH:-0}" != "1" ]; then
  if [ -n "$FRESH_CMD" ]; then
    FOUT="$("$FRESH_CMD" 2>> "$GLOG")"
  else
    FOUT="$(with_timeout 180 node --env-file=.env.local scripts/ops/bars-freshness.mjs --json --min-pct "$FRESH_MIN" 2>> "$GLOG")"
  fi
  FRESH_EXIT=$?
  FLINE="$(printf '%s' "$FOUT" | tail -1)"
  case "$FLINE" in "{"*"}") FRESH_JSON="$FLINE" ;; esac
  log "frescura exit=$FRESH_EXIT $FRESH_JSON"
fi

# ---- 2. Scan con reintento --------------------------------------------------
SCAN_EXIT=1
USED=0
n=1
while [ "$n" -le "$ATTEMPTS" ]; do
  USED="$n"
  log "scan intento $n/$ATTEMPTS"
  if [ "$DRY" = "1" ]; then
    log "DRY: $SCAN_CMD"; SCAN_EXIT=0; break
  fi
  "$SCAN_CMD"
  SCAN_EXIT=$?
  log "scan exit=$SCAN_EXIT"
  [ "$SCAN_EXIT" = "0" ] && break
  n=$((n + 1))
  [ "$n" -le "$ATTEMPTS" ] && sleep "$RETRY_SLEEP"
done

# ---- 3. Estado y aviso ------------------------------------------------------
FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REASON=""
if [ "$SCAN_EXIT" != "0" ]; then
  RESULT="fail"
  REASON="el scan falló tras $USED intento(s)"
elif [ "$BARS_EXIT" != "0" ] && [ "$BARS_EXIT" != "skipped" ]; then
  RESULT="degraded"
  REASON="refresh-bars terminó con exit=$BARS_EXIT"
elif [ "$FRESH_EXIT" != "0" ] && [ "$FRESH_EXIT" != "skipped" ]; then
  RESULT="degraded"
  if [ "$FRESH_EXIT" = "2" ]; then
    REASON="no se pudo medir la frescura (frescura exit=2)"
  else
    REASON="barras atrasadas respecto a la última sesión (frescura exit=$FRESH_EXIT)"
  fi
else
  RESULT="ok"
fi
printf '{"result":"%s","started":"%s","finished":"%s","scanExit":%s,"scanAttempts":%s,"barsExit":"%s","freshExit":"%s","freshness":%s,"reason":"%s"}\n' \
  "$RESULT" "$STARTED" "$FINISHED" "$SCAN_EXIT" "$USED" "$BARS_EXIT" "$FRESH_EXIT" "$FRESH_JSON" "$REASON" > "$STATUS"
log "guard fin result=$RESULT${REASON:+ ($REASON)}"

if [ "$RESULT" != "ok" ] && [ "$DRY" != "1" ]; then
  if [ "$RESULT" = "fail" ]; then
    LEVEL="error"; TITLE="Nocturno US falló"
    MSG="El scan falló tras los reintentos. Revisa logs/nightly-us-guard.log"
  else
    LEVEL="warn"; TITLE="Nocturno US con datos incompletos"
    MSG="$REASON. El scan se calculó con barras viejas. Estado: $FRESH_JSON"
  fi
  NOTIFY_SH="$(cd "$(dirname "$0")" && pwd)/notify.sh"
  if [ -x "$NOTIFY_SH" ]; then
    "$NOTIFY_SH" --level "$LEVEL" "$TITLE" "$MSG" >/dev/null 2>&1 || true
  fi
  osascript -e "display notification \"$TITLE. Revisa logs/nightly-us-guard.log\" with title \"StatsEdge\"" >/dev/null 2>&1 || true
  if [ -n "${STATSEDGE_GUARD_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' --data @"$STATUS" "$STATSEDGE_GUARD_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
fi
exit "$SCAN_EXIT"
