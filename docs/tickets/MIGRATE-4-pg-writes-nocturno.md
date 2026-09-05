# MIGRATE-4 — Writes pg + nocturno materializado en Mini

**Estado:** Activo tras MIGRATE-3  
**Depende:** MIGRATE-2 (GET) · MIGRATE-3 (Next+launchd)  
**Plan:** `docs/plan-migrate-postgres-mac-mini-2026-08-30.md`  
**Evidencia previa:** `docs/evidence/migrate-3-cutover-mini-2026-09-05.md`

## Problema

Con `STATSEDGE_DB_MODE=pg` solo hay lecturas. `writeMaterializedScan` / `scan-refresh` fallan con `PG_WRITE_UNSUPPORTED`. La mesa US se queda en **2026-09-03** y no hay nocturno local útil.

## Objetivo

Que el Mini **persista** scans materializados (y settings de cursor/rotación) vía `DATABASE_URL`, y que un cron launchd de `scan-refresh` deje una mesa fresca verificable.

## Alcance

1. Extender `lib/pgPostgrestAdapter.js` (+ cable en `supabaseServer`) para **POST / PATCH / DELETE** usados por:
   - `writeMaterializedScan` → `scans` (upsert `on_conflict=owner_id,local_id` + Prefer merge-duplicates) · `scan_results` DELETE+POST batches
   - `app_settings` upsert (cursor / rotation de scan-refresh)
   - Si sale barato en el mismo PR: `scan_symbol_history` POST (usado por historia nocturna)
2. Tests de contrato del adaptador (upsert, delete-by-filter, insert batch) sin tocar scoring.
3. Script/plist launchd `scan-refresh` (grupo US o el mínimo que ya exista) → `127.0.0.1:3000` + `CRON_SECRET`.
4. Smoke Mini: cron OK · nueva fila `materialized:US:…` (o mercado de prueba) con `row_count` > 0 · UI/túnel muestra fecha ≥ día del smoke.
5. Evidencia `docs/evidence/migrate-4-….md`.

## Fuera de alcance

- RPC PostgREST (`leaderboard_publishable_rows`, etc.) — ticket aparte si hace falta.
- CLEAN-4 CSS · SHELL · Twelve Data · auth multi-user · Vercel→Mini.
- Reescribir el motor de scan; solo el camino de persistencia pg.

## Criterios de aceptación

- `STATSEDGE_DB_MODE=pg`: `writeMaterializedScan` (o cron `scan-refresh`) **no** lanza `PG_WRITE_UNSUPPORTED`.
- Tras cron de prueba: scan materializado nuevo en Postgres local.
- PostgREST sin flag `pg` intacto (regresión cero).
- Tests del ticket + `./vfc` en archivos tocados.
- Smoke orquestador (API + Browser Use vía túnel si UI).

## Riesgos

- Prefer/`on_conflict` / columnas JSONB: mapear 1:1 a SQL (`INSERT … ON CONFLICT DO UPDATE`).
- Batches de 300 filas: statement_timeout local (ajustar o respetar WRITE_BATCH_ROWS).
- No inventar soporte RPC «fake»; fallar explícito si aún no hay.
