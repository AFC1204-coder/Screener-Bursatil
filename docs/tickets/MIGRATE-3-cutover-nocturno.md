# MIGRATE-3 — Cutover Mini + nocturno + checklist Pro

**Estado:** Tras MIGRATE-2 smoke OK  
**Plan:** `docs/plan-migrate-postgres-mac-mini-2026-08-30.md`

## Objetivo

Operar StatsEdge **privado** en el Mac Mini (app + DB + crons) y dejar checklist para **cancelar o no renovar** Supabase Pro.

## Alcance

1. `.env.local` del Mini: `STATSEDGE_DB_MODE=pg`, `DATABASE_URL`, `CRON_SECRET`, providers.
2. Proceso Next persistente en Mini (`launchd` o pm2 / `npm start` post-build).
3. `launchd` agents para crons existentes (`scan-refresh` grupos, etc.) → `127.0.0.1:3000` + Bearer.
4. Smoke: mesa US, HK/chip intl si aplica, ficha, un cron manual.
5. Checklist escrita: backup dump fresco → cancelar Pro / bajar plan → no borrar proyecto hasta N días.
6. **Fuera:** Auth multi-usuario, Vercel apuntando al Mini, Twelve Data.

## Dueño (obligatorio ~45–90 min)

- Estar presente en cutover.
- Decidir cancelar renovación solo tras smoke OK.
- Confirmar Time Machine / copia del dump fuera del Mini.

## Criterios de aceptación

- Tras reinicio del Mini: Postgres up, Next up (o doc de arranque claro), un cron de prueba OK.
- App usable sin `SUPABASE_URL` en el camino activo.
- Checklist de cancelación firmada por dueño (mensaje en chat basta).
