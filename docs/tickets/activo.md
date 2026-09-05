# Ticket activo — MIGRATE-4 cerrado

**Estado:** Código `91671c4` · ops Mini OK (HK materializado **2026-09-05**, 82 filas)  
**Evidencia:** `docs/evidence/migrate-4-pg-writes-nocturno-2026-09-05.md`

## Hecho

- Writes pg (POST/DELETE/PATCH) + tests
- Deploy Mini + cron `scan-refresh` HK → `materialized:HK:2026-09-05:o0:l84`
- launchd plantilla scan-refresh

## Gaps

- RPC historia / leaderboards
- US full nocturno (`scan-universe.mjs`) aún no en launchd

## Siguiente

Opcional: CLEAN-4 · nocturno US CLI en Mini · push `91671c4` (+ evidencia ops si se comitea).
