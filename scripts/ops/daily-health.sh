#!/bin/bash
# Rutina de salud de la mañana (Mac Mini): nocturno → salud → aviso.
# SIN INSTALAR. Plist: scripts/ops/launchd/com.statsedge.daily-health.plist
# (L–V 08:15 hora del Mini, después del peor caso del guardián de las 05:00).
# Solo lee: no escribe en la base ni relanza el nocturno.
#
#   1. Nocturno: logs/nightly-us-status.json debe decir result=ok y terminar
#      HOY (UTC). Si no → error (con el comando de recuperación en el aviso).
#   2. Datos: scripts/ops/data-health-check.mjs --json sobre una ventana corta
#      (HEALTH_WINDOW_DAYS, 10 por defecto) para no avisar cada día de la
#      deuda histórica. Exit 1 → warn con los contadores; exit 2 → error.
#   3. Web: GET http://127.0.0.1:$STATSEDGE_WEB_PORT/api/auth/session → 200.
#   4. Escribe logs/daily-health-status.json y llama a scripts/ops/notify.sh
#      (sin NOTIFY_URL, solo log). Con todo bien, aviso «info» solo si
#      HEALTH_NOTIFY_OK=1.
#
# Variables (en ~/.config/statsedge/web.env o en el entorno):
#   STATSEDGE_HEALTH_DATABASE_URL   obligatoria en el Mini (ver web.env.example)
#   HEALTH_WINDOW_DAYS              ventana de a3/a4/a6 (10)
#   HEALTH_MAX_A3 / _A4 / _A6       umbrales (0 / 0 / 0)
#   HEALTH_MAX_A11                  umbral de parpadeo de etapa; "off" = solo
#                                   informar (por defecto off: hoy hay deuda
#                                   conocida, ver runbook §5)
#   HEALTH_SKIP_WEB=1               no comprobar el servidor web
#   HEALTH_NOTIFY_OK=1              avisar también cuando todo va bien
#   STATSEDGE_GUARD_ROOT            raíz del repo/logs (pruebas)
#
# Códigos de salida: 0 ok · 1 avisos (warn) · 2 algún error.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="${STATSEDGE_GUARD_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
SCRIPTS="${STATSEDGE_SCRIPTS_ROOT:-$(cd "$(dirname "$0")" && pwd)}"
cd "$ROOT" || exit 2
mkdir -p "$ROOT/logs"

ENV_FILE="${STATSEDGE_WEB_ENV_FILE:-$HOME/.config/statsedge/web.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

HLOG="$ROOT/logs/daily-health.log"
OUT="$ROOT/logs/daily-health-status.json"
NIGHTLY="$ROOT/logs/nightly-us-status.json"
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$HLOG"; }

LEVEL="ok"        # ok < warn < error
bump() { case "$1" in error) LEVEL="error" ;; warn) [ "$LEVEL" = "ok" ] && LEVEL="warn" ;; esac; }
LINES=()
add() { LINES+=("$1"); log "$1"; }

log "inicio"

# ---- 1. Nocturno --------------------------------------------------------------
TODAY="$(date -u +%Y-%m-%d)"
NIGHTLY_STATE="missing"
if [ -f "$NIGHTLY" ]; then
  NJ="$(cat "$NIGHTLY")"
  if echo "$NJ" | grep -q '"result":"ok"' && echo "$NJ" | grep -q "\"finished\":\"$TODAY"; then
    NIGHTLY_STATE="ok"
    add "Nocturno US: ok ($(echo "$NJ" | sed -E 's/.*"finished":"([^"]+)".*/\1/'), barras exit=$(echo "$NJ" | sed -E 's/.*"barsExit":"([^"]*)".*/\1/'))"
    if ! echo "$NJ" | grep -q '"barsExit":"0"'; then
      bump warn; add "  ojo: el refresco de barras no terminó bien; el scan usó barras viejas"
    fi
  elif echo "$NJ" | grep -q '"result":"degraded"' && echo "$NJ" | grep -q "\"finished\":\"$TODAY"; then
    NIGHTLY_STATE="degraded"
    bump warn
    add "Nocturno US: DEGRADADO hoy (el scan corrió con barras incompletas) → $NJ"
    add "  completar barras: ver research/operacion-diaria-2026-11/plan-barras-2026-11-08.md (Fase B)"
  else
    NIGHTLY_STATE="fail"
    bump error
    add "Nocturno US: NO ok hoy → $NJ"
    add "  recuperar: scripts/ops/nightly-recover.sh (DRY) y luego --run"
  fi
else
  bump error
  add "Nocturno US: no existe logs/nightly-us-status.json (¿corrió el guardián?)"
fi

# ---- 2. Salud de datos ----------------------------------------------------------
WINDOW="${HEALTH_WINDOW_DAYS:-10}"
SINCE="$(date -v-"${WINDOW}"d +%Y-%m-%d)"
MAX_A11="${HEALTH_MAX_A11:-off}"
[ "$MAX_A11" = "off" ] && MAX_A11=1000000000
HJSON="$ROOT/logs/daily-health-check.json"
HEALTH_EXIT="skipped"
if [ -z "${STATSEDGE_HEALTH_DATABASE_URL:-}" ]; then
  bump warn
  add "Salud de datos: sin STATSEDGE_HEALTH_DATABASE_URL; no se ejecuta (en el Mini no hay :55432)"
else
  node "$SCRIPTS/data-health-check.mjs" --json --sample 3 --since "$SINCE" \
    --max-a3 "${HEALTH_MAX_A3:-0}" --max-a4 "${HEALTH_MAX_A4:-0}" \
    --max-a6 "${HEALTH_MAX_A6:-0}" --max-a11 "$MAX_A11" \
    > "$HJSON" 2>> "$HLOG"
  HEALTH_EXIT=$?
  SUMMARY="$(node -e '
    try {
      const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const r = d.resultados || {};
      const parts = Object.keys(r).map((k) => `${k}=${r[k].count}`);
      process.stdout.write(`${parts.join(" ")} · fallan: ${(d.fallan || []).join(",") || "ninguna"} · desde ${d.desde}`);
    } catch (e) { process.stdout.write("salida no legible"); }' "$HJSON" 2>/dev/null)"
  case "$HEALTH_EXIT" in
    0) add "Salud de datos: ok ($SUMMARY)" ;;
    1) bump warn; add "Salud de datos: supera umbral ($SUMMARY). Detalle: node scripts/ops/data-health-check.mjs --since $SINCE" ;;
    *) bump error; add "Salud de datos: error de ejecución (exit $HEALTH_EXIT); ver logs/daily-health.log" ;;
  esac
fi

# ---- 3. Servidor web -------------------------------------------------------------
WEB_STATE="skipped"
if [ "${HEALTH_SKIP_WEB:-0}" != "1" ]; then
  PORT="${STATSEDGE_WEB_PORT:-3000}"
  CODE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/auth/session")"
  if [ "$CODE" = "200" ]; then
    WEB_STATE="ok"; add "Web: responde en :$PORT"
  else
    WEB_STATE="down"; bump error
    add "Web: NO responde en :$PORT (http=${CODE:-000}) → launchctl kickstart -k gui/\$(id -u)/com.statsedge.web; tail logs/web.err.log"
  fi
fi

# ---- 4. Estado y aviso -----------------------------------------------------------
MSG="$(printf '%s\n' "${LINES[@]}")"
node -e '
  const [out, level, nightly, health, web, msg] = process.argv.slice(1);
  require("fs").writeFileSync(out, JSON.stringify({ level, at: new Date().toISOString(), nightly, healthExit: health, web, lines: msg.split("\n") }) + "\n");
' "$OUT" "$LEVEL" "$NIGHTLY_STATE" "$HEALTH_EXIT" "$WEB_STATE" "$MSG"
log "fin level=$LEVEL"

case "$LEVEL" in
  error) "$SCRIPTS/notify.sh" --level error "StatsEdge: algo falló esta noche" "$MSG"; exit 2 ;;
  warn)  "$SCRIPTS/notify.sh" --level warn "StatsEdge: avisos de la mañana" "$MSG"; exit 1 ;;
  *)     if [ "${HEALTH_NOTIFY_OK:-0}" = "1" ]; then "$SCRIPTS/notify.sh" --level info "StatsEdge: todo bien" "$MSG"; fi; exit 0 ;;
esac
