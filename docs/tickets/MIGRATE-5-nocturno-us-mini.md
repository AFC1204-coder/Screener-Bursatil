# MIGRATE-5 — Nocturno US en Mini (`scan-universe.mjs` + launchd)

**Estado:** Activo tras MIGRATE-4  
**Depende:** MIGRATE-4 writes pg · Mini Next/Postgres up  
**Evidencia previa:** `docs/evidence/migrate-4-pg-writes-nocturno-2026-09-05.md`

## Problema

La mesa US de uso diario sigue anclada a **2026-09-03**. El cron rotatorio ya escribe mercados (HK 2026-09-05), pero el **universo US completo** lo hace `scripts/scan-universe.mjs` (antes GHA), no `scan-refresh`.

## Objetivo

Correr el nocturno US en el Mac Mini contra Postgres local (`STATSEDGE_DB_MODE=pg`) y dejarlo en **launchd** (o cron documentado) una vez por noche.

## Alcance

1. Verificar que `scan-universe.mjs --write` funciona con `DATABASE_URL` local (mismo adaptador MIGRATE-4). Ajustes mínimos si hace falta (env, paths, Vitest loader ya documentado en cabecera).
2. Script wrapper launchd-friendly: `scripts/run-scan-universe-us.sh` (logs, exit code, sin `source .env.local` frágil).
3. Plist `com.statsedge.scan-universe-us` (horario alineado al GHA ~03:00 UTC o el que el dueño use en local).
4. Smoke Mini: corrida real o acotada (`--limit=N` si el ticket lo permite para smoke corto) → `materialized:US:YYYY-MM-DD…` con `row_count` del orden de miles; anotar en evidencia.
5. Evidencia `docs/evidence/migrate-5-….md` · documentar duración estimada / KeepAlive / no solapar con scan-refresh 22:20.

## Fuera

- RPC `scan_symbol_history` / leaderboards (gap consciente; historia puede fallar sin tumbar el write del scan).
- CLEAN-4 CSS · refresh-bars · RS crons · GHA cloud.
- Cambiar scoring / presets del nocturno.

## Criterios de aceptación

- Tras smoke: existe scan US del día (o del smoke) en Postgres Mini con población usable (~3k+ analizadas típicas, o `limit` documentado).
- launchd instalable con paths Mini; logs en `~/Statsedge-v0.1/logs/`.
- UI/túnel puede cargar mesa US con fecha ≥ smoke (orquestador Browser Use si posible).
- Sin secretos en repo.

## Riesgos

- Duración larga (Yahoo rate limits) — smoke con `--limit` primero, nocturno full en schedule.
- Vitest/JSX bootstrap en `--write` (ya resuelto en script; no romper).
- Memoria Mini durante ~5.6k símbolos — monitorizar en primera corrida full.
