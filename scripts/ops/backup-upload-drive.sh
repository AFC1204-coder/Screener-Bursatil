#!/bin/bash
# scripts/ops/backup-upload-drive.sh <volcado> — sube un volcado a Google Drive CIFRADO
# con rclone y poda las copias antiguas de Drive con la misma política que en local.
# Es el gancho STATSEDGE_BACKUP_UPLOAD_CMD de scripts/ops/backup-db.sh.
#
#   - Solo sube al remoto CIFRADO (rclone crypt, por defecto «gdrive-crypt:»). Si no existe
#     NO sube nada en claro: sale con 2 (ejecuta scripts/ops/drive-crypt-setup.sh).
#   - Tras subir comprueba que el tamaño descifrado en Drive coincide con el local.
#   - Poda con scripts/ops/db-backup-retention.mjs --stdin (nunca borra el último).
#
# Salida: 0 ok · 2 uso/remoto sin configurar · 3 la subida falló · 4 el tamaño no coincide.
# Variables de prueba: STATSEDGE_RCLONE, STATSEDGE_DRIVE_REMOTE, STATSEDGE_DRIVE_RETENTION_ARGS.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RCLONE="${STATSEDGE_RCLONE:-rclone}"
REMOTE="${STATSEDGE_DRIVE_REMOTE:-gdrive-crypt:}"
RET_ARGS="${STATSEDGE_DRIVE_RETENTION_ARGS:-}"
FILE="${1:-}"

[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "uso: backup-upload-drive.sh <volcado>" >&2; exit 2; }
case "$REMOTE" in *:*) ;; *) echo "STATSEDGE_DRIVE_REMOTE debe acabar en ':'" >&2; exit 2;; esac
NAME="$(basename "$FILE")"

if ! "$RCLONE" listremotes 2>/dev/null | grep -qx "${REMOTE%%:*}:"; then
  echo "no existe el remoto cifrado ${REMOTE%%:*}: no subo nada en claro (ejecuta scripts/ops/drive-crypt-setup.sh)" >&2
  exit 2
fi

echo "subiendo $NAME a ${REMOTE}"
"$RCLONE" copyto "$FILE" "${REMOTE}${NAME}" --transfers 1 --retries 3 || { echo "la subida falló" >&2; exit 3; }

LOCAL_SIZE="$(stat -f %z "$FILE" 2>/dev/null || echo 0)"
REMOTE_SIZE="$("$RCLONE" lsl "${REMOTE}${NAME}" 2>/dev/null | awk 'NR==1 {print $1}')"
if [ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]; then
  echo "tamaño distinto tras subir (local=$LOCAL_SIZE drive=${REMOTE_SIZE:-?}): no podo nada" >&2
  exit 4
fi
echo "subida verificada ($LOCAL_SIZE bytes)"

# Poda: solo si la lista y el plan son válidos; si algo falla, no se borra nada.
LIST="$("$RCLONE" lsf "$REMOTE" --files-only 2>/dev/null)" || { echo "no pude listar Drive: no podo" >&2; exit 0; }
# shellcheck disable=SC2086
PLAN="$(printf '%s\n' "$LIST" | node "$SCRIPT_DIR/db-backup-retention.mjs" --stdin $RET_ARGS 2>/dev/null)" || { echo "plan de poda inválido: no podo" >&2; exit 0; }
REMOVE="$(printf '%s' "$PLAN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const n of JSON.parse(s).remove)console.log(n)}catch{process.exit(1)}})')" || { echo "plan de poda ilegible: no podo" >&2; exit 0; }
COUNT=0
while IFS= read -r n; do
  [ -n "$n" ] && [ "$n" != "$NAME" ] || continue
  if "$RCLONE" deletefile "${REMOTE}${n}"; then COUNT=$((COUNT + 1)); echo "borrado de Drive: $n"; else echo "AVISO: no pude borrar $n" >&2; fi
done <<EOF
$REMOVE
EOF
echo "poda de Drive: $COUNT borrados"
exit 0
