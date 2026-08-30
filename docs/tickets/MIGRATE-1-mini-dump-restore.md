# MIGRATE-1 — Postgres en Mini + dump/restore verificado

**Estado:** Listo para activar (no activo hasta OK dueño + fecha billing)  
**Rama:** `codex/statsedge-ui-polish` (o rama `migrate/mac-mini-postgres` si se prefiere no mezclar UI)  
**Modelo:** Composer 2.5  
**Plan:** `docs/plan-migrate-postgres-mac-mini-2026-08-30.md`

## Objetivo

Dejar en el **Mac Mini M4** una copia Postgres restaurable y verificada del proyecto Supabase `dzovggfbcoymjgikkbno`, **sin** cambiar aún la app ni cancelar Pro.

## Alcance

1. Instalar/arrancar Postgres 16 o 17 en el Mini (servicio al login).
2. Crear rol/DB `statsedge` (o nombre fijo documentado).
3. `pg_dump` desde host `db.dzovggfbcoymjgikkbno.supabase.co` (credencial real del dueño; no placeholder `.env`).
4. `pg_restore` / `psql` en local.
5. Verificación mínima (conteos, no inventar tablas):
   - `scans`, `scan_results`, `daily_bars` (orden de magnitud vs nube).
   - Una query de “último scan US” legible.
6. Documentar rutas del dump (path en disco Mini) y comando exacto de restore.
7. **Fuera:** cambios a `supabaseServer`, Vercel env, cancelar Pro, launchd.

## Criterios de aceptación

- Restore completa sin error bloqueante.
- Conteos locales ≈ nube (tolerancia documentada si hay delta de escritura durante dump).
- Dump guardado en disco del Mini (y opcional copia externa).
- Pro sigue activo; app sigue apuntando a nube.

## Dueño aporta

- Password / connection string de la DB Pro.
- Confirmación de que el Mini está accesible (SSH o sesión local) para la sesión de trabajo.

## Retorno programación

Plantilla estándar. Sin commit de secretos. Sin push de dumps.
