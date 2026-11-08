#!/bin/bash
# Aviso genérico de StatsEdge (Mac Mini). NO está conectado a nada todavía:
# lo llamará quien lo necesite (scripts/ops/daily-health.sh, a mano, etc.).
#
# Sin NOTIFY_URL solo escribe en el log. Con NOTIFY_URL hace un POST:
#   - ntfy  (URL con "ntfy" o NOTIFY_FORMAT=ntfy): cuerpo en texto plano y
#           cabeceras Title / Priority / Tags, como espera ntfy.sh o un ntfy propio.
#   - json  (cualquier otra URL, o NOTIFY_FORMAT=json): cuerpo JSON
#           {"source","level","title","message","host","ts"} para un webhook
#           genérico (n8n, Make, un relay a Telegram/Slack/Discord...).
# Un fallo del envío nunca hace fallar a quien llama: queda en el log y sale 0.
#
# Uso:
#   scripts/ops/notify.sh [--level info|warn|error] "Título" "Mensaje"
#   echo "mensaje largo" | scripts/ops/notify.sh --level warn "Título" -
#
# Variables (todas opcionales):
#   NOTIFY_URL        destino; vacío = solo log
#   NOTIFY_FORMAT     ntfy | json (si no, se deduce de la URL)
#   NOTIFY_TOKEN      si existe, se envía como "Authorization: Bearer …"
#                     (ntfy con control de acceso, webhooks con token)
#   NOTIFY_MIN_LEVEL  info | warn | error: por debajo, solo log (info)
#   NOTIFY_LOG        archivo de log (por defecto <repo>/logs/notify.log)
#   NOTIFY_DRY=1      no envía nada: registra qué enviaría
#
# Nunca escribe NOTIFY_URL ni NOTIFY_TOKEN en el log (pueden llevar secretos:
# un topic de ntfy es en la práctica una contraseña).
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="${STATSEDGE_GUARD_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
NLOG="${NOTIFY_LOG:-$ROOT/logs/notify.log}"
mkdir -p "$(dirname "$NLOG")"

LEVEL="info"
while [ $# -gt 0 ]; do
  case "$1" in
    --level) LEVEL="${2:-info}"; shift 2 ;;
    --level=*) LEVEL="${1#--level=}"; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) break ;;
  esac
done
TITLE="${1:-StatsEdge}"
MESSAGE="${2:-}"
if [ "$MESSAGE" = "-" ]; then MESSAGE="$(cat)"; fi

case "$LEVEL" in info|warn|error) ;; *) LEVEL="info" ;; esac
rank() { case "$1" in error) echo 3 ;; warn) echo 2 ;; *) echo 1 ;; esac; }

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [$LEVEL] $*" >> "$NLOG"; }

# Una sola línea en el log, recortada (el mensaje completo va al destino).
ONELINE="$(printf '%s' "$MESSAGE" | tr '\n' ' ' | cut -c1-400)"
log "$TITLE — $ONELINE"

URL="${NOTIFY_URL:-}"
if [ -z "$URL" ]; then
  log "sin NOTIFY_URL: solo log"
  exit 0
fi
MIN="${NOTIFY_MIN_LEVEL:-info}"
if [ "$(rank "$LEVEL")" -lt "$(rank "$MIN")" ]; then
  log "nivel $LEVEL < NOTIFY_MIN_LEVEL=$MIN: no se envía"
  exit 0
fi

FORMAT="${NOTIFY_FORMAT:-}"
if [ -z "$FORMAT" ]; then
  case "$URL" in *ntfy*) FORMAT="ntfy" ;; *) FORMAT="json" ;; esac
fi

AUTH=()
if [ -n "${NOTIFY_TOKEN:-}" ]; then AUTH=(-H "Authorization: Bearer ${NOTIFY_TOKEN}"); fi

if [ "${NOTIFY_DRY:-0}" = "1" ]; then
  log "DRY: enviaría formato=$FORMAT (destino no se registra)"
  exit 0
fi

HOST="$(hostname -s 2>/dev/null || echo mini)"
if [ "$FORMAT" = "ntfy" ]; then
  case "$LEVEL" in error) PRIO=5; TAGS="rotating_light" ;; warn) PRIO=4; TAGS="warning" ;; *) PRIO=3; TAGS="white_check_mark" ;; esac
  # Las cabeceras HTTP no admiten bien UTF-8: ntfy acepta el título en RFC 2047.
  TITLE_B64="=?UTF-8?B?$(printf '%s' "$TITLE" | base64 | tr -d '\n')?="
  CODE="$(printf '%s' "$MESSAGE" | curl -sS -m 15 -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: text/plain; charset=utf-8' \
    -H "Title: $TITLE_B64" -H "Priority: $PRIO" -H "Tags: $TAGS" \
    ${AUTH[@]+"${AUTH[@]}"} --data-binary @- "$URL" 2>>"$NLOG")"
else
  # JSON bien escapado sin depender de jq/python: node está siempre en el Mini.
  BODY="$(node -e 'const [s,l,t,m,h]=process.argv.slice(1);process.stdout.write(JSON.stringify({source:s,level:l,title:t,message:m,host:h,ts:new Date().toISOString()}))' \
    "statsedge" "$LEVEL" "$TITLE" "$MESSAGE" "$HOST" 2>>"$NLOG")"
  CODE="$(printf '%s' "$BODY" | curl -sS -m 15 -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' ${AUTH[@]+"${AUTH[@]}"} --data-binary @- "$URL" 2>>"$NLOG")"
fi

case "$CODE" in
  2??) log "enviado formato=$FORMAT http=$CODE" ;;
  *) log "ENVÍO FALLIDO formato=$FORMAT http=${CODE:-sin respuesta} (el aviso queda solo en este log)" ;;
esac
exit 0
