#!/bin/bash
# Recuperación manual del nocturno US (Mac Mini). Ver research/ops-recuperacion-nocturno.md.
#
# Hace lo mismo que el guardián (scripts/ops/nightly-us-guard.sh) —refresh-bars
# --write --stale-days=1 y el scan con sus mismos reintentos— pero a demanda y
# con tres protecciones delante:
#   1. Comprobación previa: base de datos (host:puerto de DATABASE_URL, o el
#      túnel :15432) y salida a Yahoo. Si algo falla, no toca nada (exit 3).
#   2. Idempotente: si logs/nightly-us-status.json ya dice result=ok con fecha
#      de HOY (UTC), no repite (exit 0) salvo --force. Un cerrojo
#      (logs/nightly-recover.lock) y la búsqueda de un scan en marcha impiden
#      dos corridas a la vez (exit 4).
#   3. DRY por defecto: sin --run solo comprueba y dice qué ejecutaría. No
#      llama al guardián en DRY (el guardián en DRY reescribe el estado con
#      result=ok y falsearía el diagnóstico).
#
# Uso (en el Mini, en la raíz del repo):
#   scripts/ops/nightly-recover.sh            # DRY: comprueba y enseña el plan
#   scripts/ops/nightly-recover.sh --run      # recupera de verdad
#   scripts/ops/nightly-recover.sh --run --force   # aunque hoy ya conste ok
#
# Variables opcionales:
#   STATSEDGE_RECOVER_DB_HOSTPORT  host:puerto a comprobar (por defecto, el de
#                                  DATABASE_URL en .env.local / .env.nightly)
#   STATSEDGE_RECOVER_SKIP_NET=1   no comprobar la salida a Yahoo
#   STATSEDGE_GUARD_*              se pasan tal cual al guardián (intentos,
#                                  pausa, timeout de barras)
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="${STATSEDGE_GUARD_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" || exit 2
mkdir -p "$ROOT/logs"

RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done

RLOG="$ROOT/logs/nightly-recover.log"
STATUS="$ROOT/logs/nightly-us-status.json"
LOCK="$ROOT/logs/nightly-recover.lock"
GUARD="$ROOT/scripts/ops/nightly-us-guard.sh"
MODE=$([ "$RUN" = "1" ] && echo run || echo dry)

say() { echo "$*"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [$MODE] $*" >> "$RLOG"; }

# ---- 0. ¿Hace falta? ---------------------------------------------------------
TODAY="$(date -u +%Y-%m-%d)"
if [ -f "$STATUS" ]; then
  LAST="$(cat "$STATUS")"
  say "último estado: $LAST"
  if echo "$LAST" | grep -q '"result":"ok"' && echo "$LAST" | grep -q "\"finished\":\"$TODAY"; then
    if [ "$FORCE" != "1" ]; then
      say "el nocturno de hoy ya consta ok: nada que recuperar (usa --force para repetir)"
      exit 0
    fi
    say "--force: se repite aunque hoy conste ok"
  fi
else
  say "no hay $STATUS (el guardián no ha corrido nunca aquí)"
fi

# ---- 1. Comprobación previa -------------------------------------------------
db_hostport() {
  if [ -n "${STATSEDGE_RECOVER_DB_HOSTPORT:-}" ]; then echo "$STATSEDGE_RECOVER_DB_HOSTPORT"; return; fi
  local url=""
  for f in .env.nightly .env.local; do
    [ -f "$f" ] || continue
    url="$(grep -E '^DATABASE_URL=' "$f" | tail -1 | cut -d= -f2-)"
    [ -n "$url" ] && break
  done
  # Solo host:puerto; nunca se imprime la URL (lleva credenciales).
  echo "$url" | sed -E 's#^[a-z]+://([^@/]*@)?([^/:?]+)(:([0-9]+))?.*#\2:\4#' | sed -E 's#:$#:5432#'
}

PRE_OK=1
HP="$(db_hostport)"
if [ -z "$HP" ] || [ "$HP" = ":5432" ]; then
  say "preflight: no encuentro DATABASE_URL (modo pg); se comprueba el túnel 127.0.0.1:15432"
  HP="127.0.0.1:15432"
fi
DB_HOST="${HP%:*}"; DB_PORT="${HP##*:}"
if nc -z -G 3 "$DB_HOST" "$DB_PORT" >/dev/null 2>&1; then
  say "preflight: base de datos $DB_HOST:$DB_PORT responde"
else
  say "preflight: base de datos $DB_HOST:$DB_PORT NO responde (¿Postgres parado o túnel caído? node scripts/ops/mini-tunnel.mjs --start)"
  PRE_OK=0
fi
if [ "${STATSEDGE_RECOVER_SKIP_NET:-0}" != "1" ]; then
  if curl -fsS -m 10 -o /dev/null -A "Mozilla/5.0" "https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=5d&interval=1d"; then
    say "preflight: Yahoo responde"
  else
    say "preflight: Yahoo NO responde (sin red o bloqueo): refresh-bars no podría descargar"
    PRE_OK=0
  fi
fi
if pgrep -f "scripts/scan-universe.mjs|scripts/refresh-bars.mjs" >/dev/null 2>&1; then
  say "preflight: ya hay un scan o refresh-bars en marcha; espera a que termine"
  exit 4
fi
if [ "$PRE_OK" != "1" ]; then
  say "preflight FALLIDO: no se ejecuta nada"
  exit 3
fi

# ---- 2. Plan / ejecución ----------------------------------------------------
ATTEMPTS="${STATSEDGE_GUARD_SCAN_ATTEMPTS:-2}"
RETRY_SLEEP="${STATSEDGE_GUARD_RETRY_SLEEP:-120}"
BARS_TIMEOUT="${STATSEDGE_GUARD_BARS_TIMEOUT:-2400}"
say "plan: refresh-bars --write --stale-days=1 (2 intentos, timeout ${BARS_TIMEOUT}s) y scan US (${ATTEMPTS} intentos, pausa ${RETRY_SLEEP}s) vía $GUARD"

if [ "$RUN" != "1" ]; then
  say "DRY: no se ha ejecutado nada. Repite con --run para recuperar."
  exit 0
fi

if ! mkdir "$LOCK" 2>/dev/null; then
  say "otra recuperación tiene el cerrojo $LOCK; si no hay ninguna en marcha, bórralo a mano"
  exit 4
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

STARTED_S="$(date +%s)"
"$GUARD"
EXIT=$?
say "guardián exit=$EXIT en $(( $(date +%s) - STARTED_S ))s; estado: $(cat "$STATUS" 2>/dev/null)"
exit "$EXIT"
