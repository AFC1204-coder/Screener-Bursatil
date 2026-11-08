#!/bin/bash
# scripts/ops/backup-db.sh — volcado COMPLETO de la base statsedge del Mini, con
# verificación, suma de control, gancho de subida opcional y retención.
#
# Por qué existe: con Supabase pausado, la base del Mini es la única copia de los
# datos y no tenía ninguna copia programada (solo volcados manuales del 8-nov).
# Plan: research/operacion-diaria-2026-11/plan-backup-db.md
#
# Qué hace, en orden:
#   1. Bloqueo (una sola ejecución a la vez) y comprobación de espacio libre.
#   2. pg_dump -Fc (formato custom, comprimido) a un archivo .partial.
#   3. Verificación: pg_restore -l lo lee y pesa al menos STATSEDGE_BACKUP_MIN_BYTES.
#      Solo entonces se renombra a statsedge-YYYYMMDD-HHMMSS.dump (UTC) y se escribe
#      su .sha256. Un volcado a medias NUNCA queda con nombre definitivo.
#   4. Gancho de subida (STATSEDGE_BACKUP_UPLOAD_CMD "<archivo>", p. ej. rclone con
#      cifrado). Si falla, el resultado es degraded: la copia local sigue válida.
#   5. Retención (scripts/ops/db-backup-retention.mjs): 7 diarios + 4 semanales +
#      3 mensuales. Nunca borra el último.
#   6. Estado en logs/db-backup-status.json (ok | degraded | fail) y aviso por
#      notify.sh en degraded/fail.
#
# Salida: 0 ok o degraded · 1 fallo (sin copia nueva válida) · 3 ya había otra en marcha.
#
# Variables de prueba (no hacen falta en producción):
#   STATSEDGE_BACKUP_ROOT, STATSEDGE_BACKUP_DIR, STATSEDGE_BACKUP_DB,
#   STATSEDGE_BACKUP_DUMP_CMD "<destino>", STATSEDGE_BACKUP_VERIFY_CMD "<archivo>",
#   STATSEDGE_BACKUP_UPLOAD_CMD "<archivo>", STATSEDGE_BACKUP_MIN_BYTES,
#   STATSEDGE_BACKUP_MIN_FREE_GB, STATSEDGE_BACKUP_RETENTION_ARGS.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${STATSEDGE_BACKUP_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
DEST="${STATSEDGE_BACKUP_DIR:-$HOME/statsedge-backups/db-nightly}"
DB="${STATSEDGE_BACKUP_DB:-statsedge}"
MIN_BYTES="${STATSEDGE_BACKUP_MIN_BYTES:-52428800}"      # 50 MB: por debajo, algo va mal
MIN_FREE_GB="${STATSEDGE_BACKUP_MIN_FREE_GB:-5}"
DUMP_TIMEOUT="${STATSEDGE_BACKUP_DUMP_TIMEOUT:-3600}"
UPLOAD_TIMEOUT="${STATSEDGE_BACKUP_UPLOAD_TIMEOUT:-3600}"
RETENTION_ARGS="${STATSEDGE_BACKUP_RETENTION_ARGS:-}"
LOGS="$ROOT/logs"
STATUS="$LOGS/db-backup-status.json"
GLOG="$LOGS/db-backup.log"
mkdir -p "$LOGS" "$DEST" || { echo "no puedo crear $LOGS o $DEST" >&2; exit 1; }

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$GLOG"; }
with_timeout() { local secs="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$secs" "$@"; }
notify() {
  local level="$1" title="$2" body="$3"
  local sh="$SCRIPT_DIR/notify.sh"
  [ -x "$sh" ] && "$sh" --level "$level" "$title" "$body" >/dev/null 2>&1
  return 0
}

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
T0=$(date +%s)
RESULT="ok"; REASON=""; FILE=""; BYTES=0; UPLOAD_EXIT="skipped"; KEPT=0; REMOVED=0

write_status() {
  local finished secs
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; secs=$(( $(date +%s) - T0 ))
  printf '{"result":"%s","started":"%s","finished":"%s","seconds":%s,"file":"%s","bytes":%s,"uploadExit":"%s","kept":%s,"removed":%s,"reason":"%s"}\n' \
    "$RESULT" "$STARTED" "$finished" "$secs" "$(basename "${FILE:-}")" "$BYTES" "$UPLOAD_EXIT" "$KEPT" "$REMOVED" "$REASON" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

fail() {  # fail "motivo": sin copia nueva válida
  RESULT="fail"; REASON="$1"
  log "FALLO: $REASON"
  [ -n "${PART:-}" ] && rm -f "$PART"
  write_status
  notify error "Backup de la base falló" "$REASON. Revisa logs/db-backup.log en el Mini."
  exit 1
}

# 1. Bloqueo y espacio ------------------------------------------------------
LOCK="$DEST/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then
    log "bloqueo con más de 6 h: se considera huérfano y se retira"; rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 3
  else
    log "ya hay otra copia en marcha: no hago nada"; exit 3
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

log "inicio db=$DB dest=$DEST"
find "$DEST" -maxdepth 1 -name '*.partial' -mmin +1440 -delete 2>/dev/null   # restos de más de un día

FREE_KB=$(df -k "$DEST" | awk 'NR==2 {print $4}')
if [ -n "$FREE_KB" ] && [ $(( FREE_KB / 1048576 )) -lt "$MIN_FREE_GB" ]; then
  fail "poco espacio libre ($(( FREE_KB / 1048576 )) GiB < $MIN_FREE_GB GiB)"
fi

# 2. Volcado ----------------------------------------------------------------
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$DEST/statsedge-$STAMP.dump"
PART="$FILE.partial"
DUMP_CMD="${STATSEDGE_BACKUP_DUMP_CMD:-}"
if [ -n "$DUMP_CMD" ]; then
  with_timeout "$DUMP_TIMEOUT" "$DUMP_CMD" "$PART" >> "$GLOG" 2>&1; DUMP_EXIT=$?
else
  with_timeout "$DUMP_TIMEOUT" pg_dump -Fc -Z 6 -d "$DB" -f "$PART" >> "$GLOG" 2>&1; DUMP_EXIT=$?
fi
[ "$DUMP_EXIT" -eq 0 ] || fail "pg_dump terminó con exit=$DUMP_EXIT"

# 3. Verificación -----------------------------------------------------------
BYTES=$(stat -f %z "$PART" 2>/dev/null || echo 0)
[ "$BYTES" -ge "$MIN_BYTES" ] || fail "el volcado pesa $BYTES bytes (mínimo $MIN_BYTES): sospechoso"
VERIFY_CMD="${STATSEDGE_BACKUP_VERIFY_CMD:-}"
if [ -n "$VERIFY_CMD" ]; then
  "$VERIFY_CMD" "$PART" >> "$GLOG" 2>&1; VERIFY_EXIT=$?
else
  pg_restore -l "$PART" > /dev/null 2>> "$GLOG"; VERIFY_EXIT=$?
fi
[ "$VERIFY_EXIT" -eq 0 ] || fail "el volcado no se puede leer (verificación exit=$VERIFY_EXIT)"
mv "$PART" "$FILE" || fail "no pude renombrar el volcado"
PART=""
( cd "$DEST" && shasum -a 256 "$(basename "$FILE")" > "$(basename "$FILE").sha256" ) 2>> "$GLOG"
log "volcado listo: $(basename "$FILE") $BYTES bytes"

# 4. Subida opcional --------------------------------------------------------
UPLOAD_CMD="${STATSEDGE_BACKUP_UPLOAD_CMD:-}"
if [ -n "$UPLOAD_CMD" ]; then
  with_timeout "$UPLOAD_TIMEOUT" "$UPLOAD_CMD" "$FILE" >> "$GLOG" 2>&1; UPLOAD_EXIT=$?
  if [ "$UPLOAD_EXIT" -ne 0 ]; then
    RESULT="degraded"; REASON="la copia local está bien pero la subida falló (exit=$UPLOAD_EXIT)"
    log "AVISO: $REASON"
  else
    log "subida ok"
  fi
fi

# 5. Retención --------------------------------------------------------------
# shellcheck disable=SC2086
RET_JSON="$(node "$SCRIPT_DIR/db-backup-retention.mjs" --dir "$DEST" --apply $RETENTION_ARGS 2>> "$GLOG")"
if [ -n "$RET_JSON" ]; then
  KEPT="$(printf '%s' "$RET_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).keep.length)}catch{console.log(0)}})')"
  REMOVED="$(printf '%s' "$RET_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).removed.length)}catch{console.log(0)}})')"
  log "retención: conservados=$KEPT borrados=$REMOVED"
else
  log "AVISO: la retención no devolvió resultado (los volcados antiguos no se han podido depurar)"
  [ "$RESULT" = "ok" ] && { RESULT="degraded"; REASON="la retención falló: la carpeta puede crecer"; }
fi

# 6. Estado y aviso ---------------------------------------------------------
write_status
if [ "$RESULT" = "degraded" ]; then notify warn "Backup de la base con aviso" "$REASON."; fi
log "fin result=$RESULT"
exit 0
