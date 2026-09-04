# MIGRATE-2 — Adaptador `pg` (ruta B)

**Estado:** Cerrado 2026-09-04 (verify orquestador · smoke dueño MacBook)  
**Depende:** restore verificado en Mini (MIGRATE-1)  
**Plan:** `docs/plan-migrate-postgres-mac-mini-2026-08-30.md`  
**Evidencia:** `docs/evidence/migrate-2-pg-adapter-2026-09-04.md`

## Objetivo

Que StatsEdge en el Mini lea/escriba el Postgres local vía **`DATABASE_URL`**, sin depender de PostgREST/`SUPABASE_URL` para el camino privado.

## Alcance (propuesta)

1. Extender `lib/supabaseServer.js` (o módulo hermano) con modo:
   - `STATSEDGE_DB_MODE=pg` + `DATABASE_URL` → cliente `pg`
   - modo legado PostgREST si no está el flag (no romper Vercel/nube mientras dura el solape)
2. Mapear operaciones usadas: `supabaseRequest` / `supabaseRequestAll` / RPC si aplica.
3. Tests de contrato del adaptador (mock o integration efímera local).
4. `.env.local.example` documentando vars (sin secretos).
5. **Fuera:** cutover definitivo, launchd, cancelar Pro, rewrite de rutas API.

## Criterios de aceptación

- Con `STATSEDGE_DB_MODE=pg` y DB local: screener carga mesa US; ficha `/stock/AAPL` lee barras.
- Sin el flag: camino PostgREST intacto (regresión cero en nube).
- Tests del ticket + `./vfc` en archivos tocados.
- Smoke Browser Use (orquestador) en Mini o máquina que apunte al Mini DB.

## Riesgos

- Queries PostgREST (`or=`, `select=`) no 1:1 con SQL — inventariar usos reales, no asumir cobertura total el día 1.
- Si el inventario es grande: fase 2a = solo lecturas críticas del screener; resto después. Orquestador decide tras grep.
