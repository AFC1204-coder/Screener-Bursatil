# Ticket activo — MIGRATE-4 cerrado (commit)

**Estado:** Verify orquestador OK · smoke Mini upsert · **listo commit**  
**Spec:** `docs/tickets/MIGRATE-4-pg-writes-nocturno.md`  
**Evidencia:** `docs/evidence/migrate-4-pg-writes-nocturno-2026-09-05.md`

## Verify

- Tests adaptador: **22 passed**
- `./vfc` (suite + lint): OK (alcance docs/scripts esperado)
- Mini DB: `materialized:US:2026-09-05:…:migrate4-smoke` · **row_count=2**

## Pendiente ops (no bloquea commit código)

1. Rsync/deploy diff a Mini + `kickstart` Next  
2. `run-cron-scan-refresh.sh` real → mesa fresca en UI  
3. launchd `com.statsedge.cron-scan-refresh`

## Siguiente tras ops

CLEAN-4 opcional · historia/RPC pg si hace falta.
