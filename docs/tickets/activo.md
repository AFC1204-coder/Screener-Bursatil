# Ticket activo — MIGRATE-1 (activar jueves 3 sep, sin falta)

**Estado:** PREP listo · **no ejecutar hasta OK dueño el 3 sep**  
**Plan:** `docs/plan-migrate-postgres-mac-mini-2026-08-30.md`  
**Spec:** `docs/tickets/MIGRATE-1-mini-dump-restore.md`  
**Rama sugerida:** `migrate/mac-mini-postgres` (worktree/rama aparte de UI)  
**Margen billing:** renovación Pro ~**5 sep** — Pro sigue activo; no cancelar

## Cerrado 2026-09-02 noche

- **MOBILE-FIRE-3** — fold densificado · `firstTop≈463` ≤520  
- **MOBILE-FIRE-2** `a7d14df` · **MOBILE-FIRE-1** `15843af`

**Orden acordado:** MIGRATE mañana → post-migrate **una** de: poda cáscara filtros **o** VCP-3-gates.

## Checklist dueño (antes del Agent)

- [ ] Mac Mini M4 encendido y accesible (sesión local o SSH)
- [ ] Postgres 16/17 instalable (o ya instalado)
- [ ] Connection string / password DB Pro a mano **en el Mini** (no pegar en chat)
- [ ] Sitio en disco Mini para dump + copia externa / Time Machine
- [ ] ~30–90 min activos + dump en background (puede 1–3 h)

## Prompt para Agent chat (copiar tal cual el 3 sep tras OK)

```
@docs/tickets/activo.md @docs/tickets/MIGRATE-1-mini-dump-restore.md @docs/plan-migrate-postgres-mac-mini-2026-08-30.md

Rama: migrate/mac-mini-postgres (crear desde codex/statsedge-ui-polish) o la que indique el orquestador
Modelo: Composer
Entorno: Mac Mini M4 (trabajo en esa máquina / SSH)

Alcance MIGRATE-1 SOLO:
1) Postgres 16 o 17 en Mini, servicio al login
2) Rol/DB statsedge documentado
3) pg_dump desde Supabase Pro (credenciales solo en Mini; NUNCA commit ni .env al repo)
4) pg_restore local
5) Conteos scans / scan_results / daily_bars vs nube + query último scan US
6) Documentar path del dump y comando restore en un md local o docs/tickets/MIGRATE-1-resultado.md SIN secretos

Fuera: supabaseServer, Vercel, cancelar Pro, launchd, MIGRATE-2/3.

Tests: N/A código app; evidencia = conteos + log restore.
Sin commit de dumps ni secretos. Sin push de binarios. Devuelve plantilla de retorno.
```

## Tras MIGRATE-1 OK

Orquestador activa MIGRATE-2, luego MIGRATE-3 (dueño presente ~45–90 min).
