# Ticket activo — MIGRATE-3

**Estado:** STORAGE-1 cerrado · **MIGRATE-3 activo**  
**Último cerrado:** STORAGE-1 — smoke mesa US 3315 sin banner cuota  
**También en rama:** UX-SHELL A→D aterrizado · MIGRATE-1+2 hechos  
**Spec:** `docs/tickets/MIGRATE-3-cutover-nocturno.md`  
**Plan:** `docs/plan-migrate-postgres-mac-mini-2026-08-30.md`  
**Evidencia previa:** `docs/evidence/migrate-1-macbook-2026-09-03.md` · `docs/evidence/migrate-2-pg-adapter-2026-09-04.md` · `docs/evidence/storage-1-local-snapshot-2026-09-05.md`

## Mini (conocido)

- Host: `Christians-Mac-mini` · user `cristian`
- Postgres 17 · DB/rol `statsedge`
- `DATABASE_URL`: `postgresql://statsedge:statsedge_local_2026@127.0.0.1:5432/statsedge`

## Objetivo

App + DB + nocturno en Mini; checklist para no renovar/cancelar Supabase Pro **solo tras smoke OK**.

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/MIGRATE-3-cutover-nocturno.md
@docs/plan-migrate-postgres-mac-mini-2026-08-30.md
@docs/evidence/migrate-1-macbook-2026-09-03.md

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
Trabajo en el Mac Mini (SSH cristian@Christians-Mac-mini o IP LAN). Dueño presente.

MIGRATE-3 SOLO — cutover privado Mini. Sin SHELL, sin UI polish, sin cancelar Pro todavía.

Alcance:
1. .env.local en Mini: STATSEDGE_DB_MODE=pg, DATABASE_URL local, CRON_SECRET, providers necesarios. Sin secretos en el repo.
2. Build + proceso Next persistente (launchd preferido; documentar plist path + boot).
3. launchd (o equivalente) para al menos un cron de prueba → 127.0.0.1:3000 + Bearer CRON_SECRET (scan-refresh o el nocturno que ya exista en GHA/docs).
4. Smoke: mesa US, ficha AAPL, un cron manual OK; anotar si app corre sin SUPABASE_URL en el camino activo.
5. Escribir checklist cancelación Pro en docs/evidence/migrate-3-…md (backup dump fresco → no renovar → no borrar proyecto N días). NO cancelar Pro en este ticket.

Fuera: Vercel→Mini, auth multi-user, Twelve Data, SHELL.

Devuelve plantilla de retorno + paths de plists/scripts. Sin commit ni push desde el Mini si el working tree del MacBook es otro; orquestador comitea en polish.
```

## Dueño (obligatorio)

- Presente en cutover (~45–90 min).
- Confirmar Time Machine / copia del dump fuera del Mini.
- Decidir cancelar renovación **solo** tras smoke OK (mensaje en chat).

## Post-MIGRATE-3

CLEAN-4 CSS residual (opcional) · smoke ⋯/Diagnóstico.
