# Ticket activo — MIGRATE-5 cerrado

**Estado:** Verify OK · soft-delete smoke limit · **commit**  
**Evidencia:** `docs/evidence/migrate-5-nocturno-us-mini-2026-09-05.md`

## Hecho

- Wrapper + plist nocturno US 05:00 local
- Smoke `--limit=75` write OK en Mini (luego soft-deleted: no debe ser fuente diaria)
- launchd cargado · full documentado para 05:00 / manual

## Nota

No usar `--nocturno-real` con `--limit` en producción Mini sin borrar después.

## Siguiente

Corrida full US (manual o esperar 05:00) · opcional CLEAN-4 · desactivar GHA cuando Mini sea canónico.
