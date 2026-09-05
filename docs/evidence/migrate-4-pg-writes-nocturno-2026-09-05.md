# MIGRATE-4 — evidencia writes pg + nocturno (2026-09-05)

## Alcance

`STATSEDGE_DB_MODE=pg` + `DATABASE_URL` → **POST / DELETE / PATCH** vía `lib/pgPostgrestAdapter.js` detrás de `supabaseRequest`, cubriendo el camino de `writeMaterializedScan` y upserts de `app_settings` (cursor/rotación scan-refresh). Sin flag → PostgREST intacto.

## Cambios

| Pieza | Detalle |
|---|---|
| `lib/pgPostgrestAdapter.js` | `buildPostgrestInsertSql` (upsert merge/ignore + batch), `buildPostgrestDeleteSql`, `buildPostgrestPatchSql`; `pgRequest` soporta POST/DELETE/PATCH |
| `lib/supabaseServer.js` | Delega escrituras en modo `pg` (mismo pool que GET) |
| Tests | `tests/pgPostgrestAdapter.test.js`, `tests/pgAdapterSupabaseServer.test.js` |
| Cron Mini | `scripts/run-cron-scan-refresh.sh`, `scripts/com.statsedge.cron-scan-refresh.plist` |

### Operaciones soportadas (pg)

| Operación | Tabla | Uso |
|---|---|---|
| POST upsert | `scans` | `on_conflict=owner_id,local_id` + `resolution=merge-duplicates` |
| DELETE | `scan_results` | `scan_id=eq.<uuid>` antes de reinsertar |
| POST batch | `scan_results` | inserts en tandas (`return=minimal`) |
| POST upsert | `app_settings` | cursor / rotación scan-refresh |

### Fuera (consciente)

- RPC (`rpc/*`) → `PG_RPC_UNSUPPORTED` (p. ej. `writeScanSymbolHistory`, leaderboards)
- `scan_symbol_history` POST no añadido (depende de RPC previa)
- `provider_runs` POST/PATCH: soportado en adaptador pero cron lo envuelve en try/catch

## Tests (MacBook)

```bash
npm test -- tests/pgPostgrestAdapter.test.js tests/pgAdapterSupabaseServer.test.js
# 22 passed

./vfc lib/pgPostgrestAdapter.js lib/supabaseServer.js
# tests + lint OK
```

## Smoke Postgres Mini (túnel MacBook → Mini)

| Check | Resultado |
|---|---|
| Túnel | `ssh -N -L 15432:127.0.0.1:5432 cristian@192.168.0.116` |
| Adaptador directo | upsert `scans` + DELETE/POST `scan_results` + upsert `app_settings` **OK** |
| `local_id` | `materialized:US:2026-09-05:t103511:o0:l2:migrate4-smoke` |
| `row_count` (scans) | **2** |
| `result_rows` (scan_results) | **2** |
| `scan_id` | `81347a43-7b3c-4495-b927-ea8947a3f35c` |

## Smoke API (local Next con código MIGRATE-4)

| Check | Resultado |
|---|---|
| `GET /api/cron/scan-refresh?dryRun=1&group=asia-hongkong` | **200** · `ok=true` |
| Escritura real vía cron en Mini | Pendiente deploy del diff a `~/Statsedge-v0.1` + restart Next |

## Cron launchd (plantilla Mini)

| Pieza | Path en Mini |
|---|---|
| Plist | `~/Library/LaunchAgents/com.statsedge.cron-scan-refresh.plist` |
| Script (repo) | `scripts/run-cron-scan-refresh.sh` |
| Plantilla plist | `scripts/com.statsedge.cron-scan-refresh.plist` |
| Schedule sugerido | diario **22:20** local (10 min después de universe-refresh 22:05) |
| Endpoint | `http://127.0.0.1:3000/api/cron/scan-refresh` + Bearer/`x-cron-secret` = `CRON_SECRET` |
| Grupo manual opcional | `STATSEDGE_SCAN_GROUP=asia-hongkong` en el script |

Instalación en Mini (dueño/orquestador):

```bash
cp scripts/com.statsedge.cron-scan-refresh.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.statsedge.cron-scan-refresh.plist
```

## Próximo paso dueño

1. Desplegar diff a Mini y reiniciar Next (`launchctl kickstart -k gui/$(id -u)/com.statsedge.next`).
2. Correr `./scripts/run-cron-scan-refresh.sh` (o `group=asia-hongkong` acotado) y confirmar `savedScan.rows > 0`.
3. Verificar en UI/túnel que la fecha de mesa avanza respecto a **2026-09-03**.

## Gaps post-MIGRATE-4

- Historia nocturna (`scan_symbol_history`) sigue necesitando RPC pg o runner CLI.
- Leaderboards RPC → ticket aparte.
- US completo sigue en `scripts/scan-universe.mjs` (fuera del cron rotatorio).
