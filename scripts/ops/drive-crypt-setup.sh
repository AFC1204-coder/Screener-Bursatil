#!/bin/bash
# scripts/ops/drive-crypt-setup.sh — crea el remoto CIFRADO «gdrive-crypt:» de rclone sobre
# gdrive-statsedge:statsedge-backups. SE EJECUTA EN EL MINI, POR EL USUARIO, EN SU TERMINAL:
#
#   ssh -t cristian@100.104.42.10 'bash ~/Statsedge-v0.1/scripts/ops/drive-crypt-setup.sh'
#
# Pide dos contraseñas (no se muestran ni se guardan en claro: rclone las guarda ofuscadas en
# ~/.config/rclone/rclone.conf). Si se pierden las dos, los backups de Drive NO se pueden
# recuperar. Guárdalas en tu gestor de contraseñas, FUERA del Mini.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
BASE="gdrive-statsedge:statsedge-backups"

command -v rclone >/dev/null || { echo "rclone no está instalado" >&2; exit 2; }
rclone listremotes 2>/dev/null | grep -qx "gdrive-statsedge:" || { echo "falta el remoto gdrive-statsedge: (autoriza Drive primero)" >&2; exit 2; }
if rclone listremotes 2>/dev/null | grep -qx "gdrive-crypt:"; then echo "gdrive-crypt: ya existe; no hago nada."; exit 0; fi

echo "Vas a elegir DOS contraseñas para cifrar los backups. Guárdalas fuera del Mini."
echo "Sin ellas no se pueden recuperar los volcados de Drive."
printf 'Contraseña 1 (mín. 16 caracteres, no se muestra): '; read -rs P1; echo
printf 'Repite la contraseña 1: '; read -rs P1B; echo
printf 'Contraseña 2 (distinta, mín. 16 caracteres): '; read -rs P2; echo
printf 'Repite la contraseña 2: '; read -rs P2B; echo
if [ "$P1" != "$P1B" ] || [ "$P2" != "$P2B" ]; then echo "no coinciden: no hago nada" >&2; exit 1; fi
if [ "${#P1}" -lt 16 ] || [ "${#P2}" -lt 16 ] || [ "$P1" = "$P2" ]; then echo "mínimo 16 caracteres y deben ser distintas: no hago nada" >&2; exit 1; fi

O1="$(printf '%s' "$P1" | rclone obscure -)"; O2="$(printf '%s' "$P2" | rclone obscure -)"
unset P1 P1B P2 P2B
# La salida de «config create» imprime la configuración: se descarta para no volcarla al terminal.
rclone config create gdrive-crypt crypt "remote=$BASE" filename_encryption=standard directory_name_encryption=true "password=$O1" "password2=$O2" >/dev/null 2>&1 || { echo "no pude crear gdrive-crypt:" >&2; exit 1; }
unset O1 O2

echo "Prueba de ida y vuelta (sube, lee, compara y borra un archivo pequeño)..."
T="$(mktemp)"; echo "prueba $(date -u +%FT%TZ)" > "$T"
rclone copyto "$T" gdrive-crypt:_prueba/prueba.txt >/dev/null 2>&1 || { echo "la subida de prueba falló" >&2; rm -f "$T"; exit 1; }
BACK="$(rclone cat gdrive-crypt:_prueba/prueba.txt 2>/dev/null)"
rclone purge gdrive-crypt:_prueba >/dev/null 2>&1
if [ "$BACK" = "$(cat "$T")" ]; then echo "OK: gdrive-crypt: funciona (cifra, descifra y borra)."; rm -f "$T"; exit 0; fi
echo "la prueba no coincide" >&2; rm -f "$T"; exit 1
