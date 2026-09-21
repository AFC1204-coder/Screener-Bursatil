# YIELD-EU-1 — cron/lote EU: secundarios en rotación medible

**Estado:** prep → programación cloud  
**Rama base:** `codex/statsedge-ui-polish` @ `79418f0`  
**Modelo:** Composer 2.5 (o Terra)  
**Slice:** B — yield cron EU (no truth UI; no activar FIRDS)

## Por qué

Slice A (EUROPA-COVERAGE-TRUTH-1 / #42) ya es honesto en copy. Falta profundidad: `SHADOW_EUROPE_CRON_GROUPS` rota UK/Nordics/West/South pero **no** incluye AT/BE/IE/PT (sí están en `SHADOW_FIRDS_CRON_GROUPS`, path distinto y dependiente de FIRDS). `SCAN_CRON_GROUPS` ya tiene `europe-{market}` para priority + secondary. Cerrar el hueco de shadow-europe thin sin encender `ESMA_FIRDS_ENABLED`.

## Alcance (closable)

1. Añadir cohorte(s) a `SHADOW_EUROPE_CRON_GROUPS` que cubran **AT, BE, IE, PT** (p. ej. `shadow-europe-thin` o pares light IE+PT / AT+BE). Caps conservadores alineados a lotes light existentes (`resolvePerMarket`/`pricePerMarket`/`scanPerMarket`/`scanLimit` del mismo orden que West/South; no re-descargar FIRDS inline).
2. Test focalizado en `lib/cronPlan.js` (o suite existente de cron): la unión de markets en `SHADOW_EUROPE_CRON_GROUPS` incluye AT/BE/IE/PT; no romper helpers `shadowEuropeCronGroupAt` / `expandedShadowEuropeCronGroups`.
3. Comentario breve en `cronPlan.js` documentando por qué thin entra en shadow-europe (yield mesa) vs FIRDS pairs (sembrado referencia).
4. `./vfc` o vitest del ticket en verde.

## No tocar

- Activar `ESMA_FIRDS_ENABLED` / `FCA_FIRDS_ENABLED` en env o docs de prod.
- Nocturno US, scoring, auth, Twelve Data / Hito 1B.
- Truth/P9 copy (slice A cerrado; aviso curated-fallback = ticket C).
- Correr cron contra prod/Mini como parte del ticket (orquestador mide después si aplica).

## Verify orquestador

- `git diff` real · tests · gate datos/ops: **no merge a polish sin OK dueño** si el diff toca rutas de cron que afecten corridas nocturnas (código de plan/caps OK; no disparar jobs).
