# MIGRATE-1 — evidencia MacBook (2026-09-03)

## Preparación MacBook (orquestador)

| Check | Estado |
|---|---|
| `postgresql@17` instalado (`/opt/homebrew/opt/postgresql@17/bin/pg_dump`) | OK |
| Directorio `~/statsedge-backups/` | OK |
| Script dump | `~/statsedge-backups/migrate-1-dump.sh` |
| TCP pooler IPv4 `aws-1-eu-central-1.pooler.supabase.com:5432` | OK (tenant correcto) |
| TCP pooler `aws-0-eu-central-1` | **Mal** → `tenant/user postgres.dzovggfbcoymjgikkbno not found` |
| TCP direct `db.dzovggfbcoymjgikkbno.supabase.co` | **Sin IPv4** (solo AAAA; MacBook sin IPv6 útil) |
| `pg_dump` v16 | Insuficiente (servidor PG **17.6**) |

## Baseline nube (pre-dump)

| Tabla | Filas |
|---|---|
| `scans` | 98 |
| `scan_results` | 58 729 |
| `daily_bars` | 4 285 447 |

Último scan US (verificación post-restore):

```sql
SELECT id, local_id, name, row_count, created_at
FROM scans
WHERE deleted_at IS NULL
  AND settings->>'markets' = '["US"]'
ORDER BY created_at DESC
LIMIT 1;
```

## Dump desde MacBook

```bash
export PGPASSWORD='…'   # Supabase Dashboard → Settings → Database
bash ~/statsedge-backups/migrate-1-dump.sh
```

| Campo | Valor |
|---|---|
| Archivo | `~/statsedge-backups/statsedge-2026-09-03.dump` |
| Tamaño | **704 MB** |
| Inicio | 2026-09-03T20:25:35+02:00 |
| Fin | 2026-09-03T21:00:13+02:00 |
| Host | `aws-1-eu-central-1.pooler.supabase.com:5432` |
| User | `postgres.dzovggfbcoymjgikkbno` |
| Formato | `-Fc` (`pg_dump` 17) |

- [x] Password DB en shell (`PGPASSWORD`)
- [x] `pg_dump` completado + `ls -lh` coherente

## Copia al Mini (gate 3 — ahora)

```bash
# Sustituir MINI_USER y MINI_HOST (IP LAN o hostname .local)
mkdir -p ~/statsedge-backups
scp ~/statsedge-backups/statsedge-2026-09-03.dump MINI_USER@MINI_HOST:~/statsedge-backups/
```

## Restore en Mini (gate 4–6)

**Prereqs:** Postgres 17 (`brew install postgresql@17`), servicio arrancado.

```bash
# En el Mini — superuser local suele ser tu usuario macOS (no "postgres")
PG17="/opt/homebrew/opt/postgresql@17/bin"
DUMP=~/statsedge-backups/statsedge-2026-09-03.dump
DB=statsedge

# 1) Rol + DB (ajusta password local; no es la de Supabase)
"$PG17"/psql -d postgres -c "CREATE ROLE statsedge LOGIN PASSWORD 'CAMBIAR_LOCAL';" 2>/dev/null || true
"$PG17"/createdb -O statsedge "$DB" 2>/dev/null || true

# 2) Restore (puede salir exit 1 por objetos auth/storage — revisar log)
"$PG17"/pg_restore -d "$DB" --no-owner --no-acl -j 4 "$DUMP" \
  2>&1 | tee ~/statsedge-backups/statsedge-2026-09-03.restore.log

# 3) Conteos (aceptación MIGRATE-1)
"$PG17"/psql -d "$DB" -c "
SELECT 'scans' t, count(*) FROM scans
UNION ALL SELECT 'scan_results', count(*) FROM scan_results
UNION ALL SELECT 'daily_bars', count(*) FROM daily_bars;
"

# 4) Último scan US
"$PG17"/psql -d "$DB" -c "
SELECT id, local_id, name, row_count, created_at
FROM scans
WHERE deleted_at IS NULL AND settings->>'markets' = '[\"US\"]'
ORDER BY created_at DESC LIMIT 1;
"
```

Tolerancia: ±escrituras durante dump. Objetivo ≈ `98` / `58729` / `4285447`.

## Mini — restore (2026-09-04)

| Campo | Valor |
|---|---|
| Host | `Christians-Mac-mini` · usuario `cristian` |
| Postgres | 17.11 (Homebrew) aarch64 |
| DB | `statsedge` · rol `statsedge` |
| Dump path | `~/statsedge-backups/statsedge-2026-09-03.dump` |
| Copia | `scp` desde MacBook · 704 MB · ~1:25 |

### Conteos post-restore

| Tabla | Nube (pre-dump) | Mini |
|---|---|---|
| `scans` | 98 | **98** |
| `scan_results` | 58 729 | **58 729** |
| `daily_bars` | 4 285 447 | **4 285 447** |

**Match exacto** — gate restore OK.

Último scan US (post-restore):

| id | local_id | name | row_count | created_at |
|---|---|---|---|---|
| `8a119087-e40a-4d0f-87ad-6615267d2641` | `materialized:US:2026-09-03:t080211:o0:l5605` | Materialized scan US 2026-09-03 | 3315 | 2026-09-03 10:02:11+02 |

Comando restore usado:

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_restore -d statsedge --no-owner --no-acl -j 4 \
  ~/statsedge-backups/statsedge-2026-09-03.dump > ~/statsedge-backups/restore.log 2>&1
```

`DATABASE_URL` local (MIGRATE-2):  
`postgresql://statsedge:statsedge_local_2026@127.0.0.1:5432/statsedge`

## Pendiente

- [x] `scp` al Mini
- [x] Postgres 17 + restore en Mini
- [x] Conteos documentados
- [x] Último scan US
