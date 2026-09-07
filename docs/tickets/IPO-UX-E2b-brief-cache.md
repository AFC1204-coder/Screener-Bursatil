# IPO-UX-E2b — Invalidar brief cache tras ancla IPO

**Estado:** Cerrado · smoke ANDG +121,5% sin refresh 2026-09-07  
**Prioridad:** residual E2 (P1 menor)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Tipo:** un cambio mecánico — **no scoring · no UI · no nocturno**

## Problema

Tras IPO-UX-E2, el brief solo trae `ipoAnchor*` en builds frescos. Entradas de `company_brief_cache` con `BRIEF_CACHE_VERSION = 4` (previas) se sirven sin ancla → ficha muestra % desde `chartBars` (p.ej. ANDG +139% vs mesa +121%) hasta `refresh=1` o TTL.

## Alcance

1. Subir `BRIEF_CACHE_VERSION` en `app/api/company-brief/route.js` (**4 → 5**). La lectura ya descarta versión ≠ actual.
2. Si hay test que fije la versión, actualizarlo. Si no, un assert mínimo de que la constante es 5 o que hit exige `version === BRIEF_CACHE_VERSION`.
3. Opcional mínimo (mismo PR si cabe en &lt;10 líneas): en `scripts/backfill-ipo-anchor.mjs`, cambiar el `DEFAULT_LOCAL_ID` hardcodeado obsoleto por un comentario + exigir `--local-id=` **o** documentar en cabecera que el default es solo ejemplo — **no** añadir lógica de “último scan” salvo que sea trivial y testeada.
4. `./vfc` tocados. Sin commit/push.

## Fuera

- Hydration ScreenerShell (cola siguiente)  
- IPO-UX-F · proceso B/A · nocturno  
- Borrar filas de `app_settings` a mano  

## Criterios

1. `BRIEF_CACHE_VERSION === 5` (o el bump acordado).
2. Un brief cacheado v4 ya no cuenta como `hit` fresco.
3. Vitest/lint de lo tocado OK.
