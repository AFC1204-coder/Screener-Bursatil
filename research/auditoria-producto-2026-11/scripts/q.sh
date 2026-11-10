#!/bin/bash
# Consulta de solo lectura contra la copia local. Uso: q.sh "SQL" | q.sh -f archivo.sql
export PGOPTIONS='-c default_transaction_read_only=on'
exec psql -h 127.0.0.1 -p 55432 -U postgres -d statsedge_local -X -P pager=off "$@"
