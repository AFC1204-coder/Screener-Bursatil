#!/bin/bash
# Despliegue del servidor web de StatsEdge en el Mac Mini. Se ejecuta en el
# PORTÁTIL, desde la raíz del repo. Ver research/operacion-diaria-2026-11/runbook.md §4.
#
#   1. Comprobación previa (en el Mini, por SSH): directorio destino, node/npm,
#      archivo de entorno del web, que no haya un scan/refresh-bars en marcha
#      y que no estemos en la ventana del nocturno (04:45–08:00 hora del Mini).
#   2. rsync del código SIN --delete: nunca borra archivos del Mini. Lo que
#      sobrescribe queda copiado en .deploy-backup/<fecha>/ (--backup).
#      No viajan .git, node_modules, .next, .env*, logs/, research/, output/...
#   3. npm ci SOLO si cambió package-lock.json (o falta node_modules). Ojo:
#      npm ci rehace node_modules entero; por eso se salta si no hace falta.
#   4. npm run build. Antes clona .next en .next.prev (APFS, segundos); si el
#      build falla, restaura .next.prev y el servicio sigue con el build previo.
#   5. Recarga: launchctl kickstart -k gui/<uid>/com.statsedge.web (si el
#      servicio no está instalado, dice cómo instalarlo y no hace nada más).
#   6. Humo: espera hasta 60 s a que /api/auth/session responda 200.
#
# DRY por defecto: comprueba, enseña qué archivos cambiarían (rsync -n) y el
# plan. Con --run lo ejecuta. Idempotente: repetirlo sin cambios no reinstala
# dependencias, y el rsync no copia nada; el build y la recarga sí se repiten.
# Cerrojo: logs/deploy-mini.lock en el Mini (mkdir atómico) y en el portátil.
#
# Uso:
#   scripts/ops/deploy-mini.sh                 # DRY
#   scripts/ops/deploy-mini.sh --run           # despliega
#   scripts/ops/deploy-mini.sh --run --skip-build    # solo código (scripts ops)
#   opciones: --skip-reload  --force-npm-ci  --force-window
#
# Variables:
#   STATSEDGE_MINI_SSH_HOST   (192.168.100.107)   STATSEDGE_MINI_SSH_USER (cristian)
#   STATSEDGE_MINI_DEST       (/Users/cristian/Statsedge-v0.1)
#   STATSEDGE_MINI_ENV_FILE   (/Users/cristian/.config/statsedge/web.env)
#   STATSEDGE_DEPLOY_LOCAL=1  pruebas: «Mini» = esta máquina, DEST = ruta local
#   STATSEDGE_DEPLOY_LOG_DIR  log y cerrojo del portátil (<repo>/logs)
#   STATSEDGE_DEPLOY_MIN_FREE_GB  espacio mínimo libre en el Mini (3)
#
# Códigos de salida: 0 ok · 2 uso/entorno · 3 preflight · 4 cerrojo/ocupado ·
# 5 build fallido (restaurado) · 6 el servicio no responde tras recargar.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$SRC" || exit 2

RUN=0; SKIP_BUILD=0; SKIP_RELOAD=0; FORCE_CI=0; FORCE_WINDOW=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --skip-reload) SKIP_RELOAD=1 ;;
    --force-npm-ci) FORCE_CI=1 ;;
    --force-window) FORCE_WINDOW=1 ;;
    -h|--help) sed -n '2,41p' "$0"; exit 0 ;;
    *) echo "argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done

HOST="${STATSEDGE_MINI_SSH_HOST:-192.168.100.107}"
USER_="${STATSEDGE_MINI_SSH_USER:-cristian}"
DEST="${STATSEDGE_MINI_DEST:-/Users/cristian/Statsedge-v0.1}"
ENV_FILE="${STATSEDGE_MINI_ENV_FILE:-/Users/cristian/.config/statsedge/web.env}"
LOCAL="${STATSEDGE_DEPLOY_LOCAL:-0}"
LABEL="com.statsedge.web"
MODE=$([ "$RUN" = "1" ] && echo run || echo dry)
STAMP="$(date +%Y%m%d-%H%M%S)"

LOGDIR="${STATSEDGE_DEPLOY_LOG_DIR:-$SRC/logs}"
mkdir -p "$LOGDIR"
DLOG="$LOGDIR/deploy-mini.log"
say() { echo "$*"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [$MODE] $*" >> "$DLOG"; }

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=15)
remote() {   # remote "<script bash>"  (stdin libre)
  if [ "$LOCAL" = "1" ]; then bash -c "$1"; else ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "bash -c $(printf '%q' "$1")"; fi
}
TARGET=$([ "$LOCAL" = "1" ] && echo "$DEST/" || echo "$USER_@$HOST:$DEST/")

# ---- Cerrojo local -----------------------------------------------------------------
LLOCK="$LOGDIR/deploy-mini.lock"
if [ "$RUN" = "1" ]; then
  if ! mkdir "$LLOCK" 2>/dev/null; then say "otro despliegue tiene el cerrojo local $LLOCK; si no hay ninguno en marcha, bórralo"; exit 4; fi
  trap 'rmdir "$LLOCK" 2>/dev/null' EXIT
fi

GIT_REV="$(git rev-parse --short HEAD 2>/dev/null || echo sin-git)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
GIT_DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
say "origen $SRC · rama $GIT_BRANCH @ $GIT_REV · $GIT_DIRTY archivos sin comitear (se despliega el árbol tal cual)"
say "destino $([ "$LOCAL" = "1" ] && echo "LOCAL $DEST" || echo "$USER_@$HOST:$DEST")"

# ---- 1. Preflight -----------------------------------------------------------------------
if [ "$LOCAL" != "1" ]; then
  if ! ssh "${SSH_OPTS[@]}" "$USER_@$HOST" true 2>>"$DLOG"; then
    say "preflight: no hay SSH a $USER_@$HOST (¿Mini apagado, otra red, IP cambiada? STATSEDGE_MINI_SSH_HOST=<ip>)"
    exit 3
  fi
fi
PRE="$(remote "
  export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
  [ -d '$DEST' ] && echo dest=ok || echo dest=missing
  echo node=\$(node -v 2>/dev/null || echo none) npm=\$(npm -v 2>/dev/null || echo none)
  [ -f '$ENV_FILE' ] && echo env=ok || echo env=missing
  pgrep -f 'scripts/scan-universe.mjs|scripts/refresh-bars.mjs|nightly-us-guard.sh' >/dev/null && echo busy=yes || echo busy=no
  echo hhmm=\$(date +%H%M)
  launchctl print gui/\$(id -u)/$LABEL >/dev/null 2>&1 && echo svc=loaded || echo svc=absent
  [ -f '$DEST/.next/BUILD_ID' ] && echo build=\$(cat '$DEST/.next/BUILD_ID') || echo build=none
  [ -d '$DEST/logs/deploy-mini.lock' ] && echo rlock=held || echo rlock=free
  df -g '$DEST' 2>/dev/null | awk 'NR==2{print \"freeGB=\" \$4}'
" 2>>"$DLOG")"
say "preflight: $(echo "$PRE" | tr '\n' ' ')"
val() { echo "$PRE" | sed -n "s/^$1=//p" | head -1; }

PRE_OK=1
[ "$(val dest)" = "ok" ] || { say "preflight: no existe $DEST en el Mini"; PRE_OK=0; }
case "$(echo "$PRE" | grep -o 'node=[^ ]*')" in node=v2[0-9]*) ;; *) say "preflight: node ausente o < 20 en el Mini"; PRE_OK=0 ;; esac
[ "$(val env)" = "ok" ] || { say "preflight: falta $ENV_FILE (plantilla scripts/ops/launchd/web.env.example)"; [ "$SKIP_RELOAD" = "1" ] || PRE_OK=0; }
if [ "$(val busy)" = "yes" ]; then say "preflight: hay un scan / refresh-bars / guardián en marcha; despliega cuando termine"; exit 4; fi
if [ "$(val rlock)" = "held" ]; then say "preflight: el Mini tiene el cerrojo $DEST/logs/deploy-mini.lock (otro despliegue o uno que murió: bórralo a mano)"; exit 4; fi
HHMM="$(val hhmm)"; HHMM=$((10#${HHMM:-1200}))
if [ "$HHMM" -ge 445 ] && [ "$HHMM" -lt 800 ] && [ "$FORCE_WINDOW" != "1" ]; then
  say "preflight: son las $(val hhmm) en el Mini, ventana del nocturno (04:45–08:00). Usa --force-window si estás seguro"; exit 4
fi
FREE="$(val freeGB)"; MINFREE="${STATSEDGE_DEPLOY_MIN_FREE_GB:-3}"
if [ -n "$FREE" ] && [ "$FREE" -lt "$MINFREE" ]; then say "preflight: solo ${FREE} GB libres en el Mini (el build y .next.prev necesitan ~1 GB)"; PRE_OK=0; fi
if [ "$PRE_OK" != "1" ]; then say "preflight FALLIDO: no se toca nada"; exit 3; fi

# ---- 2. rsync -----------------------------------------------------------------------------
EXCLUDES=(
  --exclude=.git/ --exclude=node_modules/ --exclude=.next/ --exclude=.next.prev/
  --exclude='.env*' --exclude=logs/ --exclude=research/ --exclude=output/
  --exclude=.worktrees/ --exclude=.playwright-mcp/ --exclude=.playwright-cli/
  --exclude=.vercel/ --exclude=.zcode/ --exclude=.claude/ --exclude=.cursor/
  --exclude=.mcp.json --exclude=.deploy-backup/ --exclude=.deploy-state/
  --exclude=.DS_Store --exclude='/*.png' --exclude=tmp/ --exclude=temp/
  --exclude=exports/ --exclude=backups/ --exclude=supabase/.temp/
)
RSYNC=(rsync -az --itemize-changes --backup "--backup-dir=.deploy-backup/$STAMP" "${EXCLUDES[@]}")
[ "$LOCAL" = "1" ] || RSYNC+=(-e "ssh ${SSH_OPTS[*]}")

CHANGES="$("${RSYNC[@]}" -n "$SRC/" "$TARGET" 2>>"$DLOG")" || { say "rsync -n falló (ver $DLOG)"; exit 3; }
NCH="$(echo "$CHANGES" | grep -c '^[<>c]f' || true)"
LOCK_CHANGED="$(echo "$CHANGES" | grep -cE '^[<>c]f.* package(-lock)?\.json$' || true)"
say "rsync: $NCH archivos nuevos o distintos$([ "$LOCK_CHANGED" != "0" ] && echo ' (incluye package.json / package-lock.json)')"
echo "$CHANGES" | grep -E '^[<>c]f' | head -40 | sed 's/^/    /'
[ "$NCH" -gt 40 ] && echo "    … y $((NCH - 40)) más"

if [ "$RUN" != "1" ]; then
  say "plan: rsync (sin borrar; sobrescritos a .deploy-backup/$STAMP) → npm ci $([ "$FORCE_CI" = "1" ] && echo forzado || echo 'si cambió package-lock') → $([ "$SKIP_BUILD" = "1" ] && echo 'sin build' || echo 'build con .next.prev de respaldo') → $([ "$SKIP_RELOAD" = "1" ] && echo 'sin recarga' || echo "kickstart $LABEL ($(val svc))") → humo"
  say "DRY: no se ha tocado nada. Repite con --run para desplegar."
  exit 0
fi

"${RSYNC[@]}" "$SRC/" "$TARGET" >> "$DLOG" 2>&1 || { say "rsync falló (ver $DLOG); el Mini puede tener una copia a medias del código, repite el despliegue"; exit 3; }
say "rsync hecho ($NCH archivos)"

# ---- 3–6. En el Mini ------------------------------------------------------------------------
INFO="{\"rev\":\"$GIT_REV\",\"branch\":\"$GIT_BRANCH\",\"dirty\":$GIT_DIRTY,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"from\":\"$(hostname -s)\"}"
remote "
  set -uo pipefail
  export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
  cd '$DEST' || exit 2
  mkdir -p logs .deploy-state
  RLOG=logs/deploy-mini.log
  r() { echo \"  [mini] \$*\"; echo \"\$(date -u +%Y-%m-%dT%H:%M:%SZ) \$*\" >> \$RLOG; }
  mkdir logs/deploy-mini.lock 2>/dev/null || { r 'cerrojo ocupado'; exit 4; }
  trap 'rmdir logs/deploy-mini.lock 2>/dev/null' EXIT
  r 'inicio $STAMP rev=$GIT_REV'

  SHA=\$(shasum -a 256 package-lock.json | cut -c1-64)
  if [ '$FORCE_CI' = 1 ] || [ ! -d node_modules ] || [ \"\$(cat .deploy-state/package-lock.sha 2>/dev/null)\" != \"\$SHA\" ]; then
    r 'npm ci (cambió package-lock o falta node_modules)'
    npm ci --no-audit --no-fund >> logs/deploy-npm.log 2>&1 || { r 'npm ci FALLÓ: ver logs/deploy-npm.log (node_modules puede estar incompleto: repite el despliegue antes de las 04:45)'; exit 3; }
    echo \"\$SHA\" > .deploy-state/package-lock.sha
  else
    r 'dependencias sin cambios: no se ejecuta npm ci'
  fi

  if [ '$SKIP_BUILD' != 1 ]; then
    if [ -d .next ]; then rm -rf .next.prev; cp -Rc .next .next.prev 2>/dev/null || cp -R .next .next.prev; fi
    S=\$(date +%s)
    if NEXT_TELEMETRY_DISABLED=1 npm run build > logs/deploy-build.log 2>&1; then
      r \"build ok en \$(( \$(date +%s) - S ))s, BUILD_ID=\$(cat .next/BUILD_ID)\"
    else
      r 'build FALLÓ: ver logs/deploy-build.log; se restaura el build anterior'
      if [ -d .next.prev ]; then rm -rf .next && mv .next.prev .next; fi
      launchctl kickstart -k gui/\$(id -u)/$LABEL >/dev/null 2>&1 || true
      exit 5
    fi
  fi
  echo '$INFO' > .deploy-state/last-deploy.json

  if [ '$SKIP_RELOAD' = 1 ]; then r 'sin recarga (--skip-reload)'; exit 0; fi
  if ! launchctl print gui/\$(id -u)/$LABEL >/dev/null 2>&1; then
    r 'el servicio $LABEL no está instalado: cp scripts/ops/launchd/$LABEL.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/$LABEL.plist'
    exit 0
  fi
  launchctl kickstart -k gui/\$(id -u)/$LABEL && r 'servicio recargado'
  PORT=\$(sed -n 's/^STATSEDGE_WEB_PORT=//p' '$ENV_FILE' | tail -1); PORT=\${PORT:-3000}
  for i in \$(seq 1 30); do
    CODE=\$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:\$PORT/api/auth/session)
    [ \"\$CODE\" = 200 ] && { r \"humo ok: :\$PORT responde 200 tras \$((i*2))s\"; exit 0; }
    sleep 2
  done
  r \"humo FALLIDO: :\$PORT no responde (http=\$CODE). tail logs/web.err.log logs/web-start.log\"
  exit 6
"
EXIT=$?
say "fin exit=$EXIT"
exit "$EXIT"
