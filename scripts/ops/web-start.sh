#!/bin/bash
# Arranque de `next start` en producción para el Mac Mini. Lo lanza launchd
# (scripts/ops/launchd/com.statsedge.web.plist); también vale a mano para
# probar. NO construye: si falta el build sale con error y launchd reintenta
# con su pausa (ThrottleInterval), sin bucles rápidos.
#
#   1. Carga el archivo de entorno FUERA del repo (por defecto
#      ~/.config/statsedge/web.env, permisos 600). Plantilla sin secretos en
#      scripts/ops/launchd/web.env.example. Las variables exportadas aquí
#      mandan sobre .env.local (Next no pisa variables ya definidas), así que
#      el servidor web no depende de lo que tenga .env.local para los jobs.
#   2. Comprueba lo imprescindible (token, secreto de sesión, base, build).
#   3. Rota logs/web.out.log y web.err.log si pasan de 50 MB (en cada
#      arranque; launchd no rota nada).
#   4. exec de next start: launchd ve el PID real y lo reinicia si muere.
#
# Variables (en el archivo de entorno):
#   STATSEDGE_WEB_PORT   puerto (3000)
#   STATSEDGE_WEB_HOST   interfaz: 127.0.0.1 (por defecto: solo el propio Mini
#                        y Tailscale serve) o 0.0.0.0 (toda la LAN)
#   STATSEDGE_ACCESS_TOKEN, STATSEDGE_SESSION_SECRET  obligatorias en producción
#   STATSEDGE_DB_MODE=pg, DATABASE_URL                base Postgres del Mini
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="${STATSEDGE_GUARD_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" || exit 2
mkdir -p "$ROOT/logs"
WLOG="$ROOT/logs/web-start.log"
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$WLOG" >&2; }

ENV_FILE="${STATSEDGE_WEB_ENV_FILE:-$HOME/.config/statsedge/web.env}"
if [ ! -f "$ENV_FILE" ]; then
  say "falta $ENV_FILE (copia scripts/ops/launchd/web.env.example y rellénalo; chmod 600)"
  exit 78   # EX_CONFIG
fi
PERM="$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || echo '?')"
case "$PERM" in 600|400) ;; *) say "aviso: $ENV_FILE tiene permisos $PERM; lo correcto es 600" ;; esac

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1
PORT="${STATSEDGE_WEB_PORT:-3000}"
HOST="${STATSEDGE_WEB_HOST:-127.0.0.1}"

MISSING=""
for v in STATSEDGE_ACCESS_TOKEN STATSEDGE_SESSION_SECRET DATABASE_URL; do
  [ -n "${!v:-}" ] || MISSING="$MISSING $v"
done
if [ "${STATSEDGE_DB_MODE:-}" != "pg" ]; then MISSING="$MISSING STATSEDGE_DB_MODE=pg"; fi
if [ -n "$MISSING" ]; then
  say "faltan variables en $ENV_FILE:$MISSING (sin ellas la app arranca bloqueada o contra Supabase)"
  exit 78
fi
if [ ! -f "$ROOT/.next/BUILD_ID" ]; then
  say "no hay build de producción (.next/BUILD_ID): ejecuta scripts/ops/deploy-mini.sh --run o npm run build"
  exit 78
fi

for f in web.out.log web.err.log; do
  p="$ROOT/logs/$f"
  if [ -f "$p" ] && [ "$(stat -f '%z' "$p")" -gt 52428800 ]; then
    mv -f "$p" "$p.1" && say "rotado $f (>50 MB) a $f.1"
  fi
done

say "next start host=$HOST port=$PORT build=$(cat "$ROOT/.next/BUILD_ID") node=$(node -v)"
# La salida de Next va a archivos que abre este script (no launchd), para que
# la rotación de arriba funcione: launchd mantiene abiertos los suyos.
exec "$ROOT/node_modules/.bin/next" start -p "$PORT" -H "$HOST" \
  >> "$ROOT/logs/web.out.log" 2>> "$ROOT/logs/web.err.log"
