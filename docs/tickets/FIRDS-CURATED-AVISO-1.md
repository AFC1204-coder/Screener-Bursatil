# FIRDS-CURATED-AVISO-1 — aviso cuando Europa cae a curated-fallback

**Estado:** prep → programación cloud  
**Rama base:** `codex/statsedge-ui-polish` @ `79418f0`  
**Modelo:** Composer 2.5 (o Terra)  
**Slice:** C — honestidad FIRDS off / curated-fallback (no ops FIRDS on)

## Por qué

Backlog INT-0: «Europa puede degradar a listas curadas si flags off → población parcial **sin aviso**». Slice A tipifica secundarios ausentes en mesa; este ticket cierra el caso **universo = curated-fallback** (o ESMA/FCA FIRDS off) cuando la selección es Europa / mercados FIRDS.

## Alcance (closable)

1. Detectar de forma estable (flags env y/o `snapshot.cache.status === "curated-fallback"` / señales ya en `lib/universeEngine.js`, `lib/coveragePlan.js`, `lib/providerRuntimeStatus.js`) cuando Europa (o mercados ESMA/FCA en selección) opera sin FIRDS activo.
2. Extender truth line y/o notice P9 existente (`lib/screenerTruthLine.js`, `lib/marketAvailability.js`, notices) con copy de producto: población curada / parcial — **sin** jerga de flags ni pedir al usuario que active FIRDS.
3. Reusar helpers; no inventar % de cobertura si no hay dato cableado.
4. Tests focalizados (marketAvailability / truth line / coverage). `./vfc` o vitest del ticket en verde.

## No tocar

- Activar o documentar como «on» `ESMA_FIRDS_ENABLED` / `FCA_FIRDS_ENABLED`.
- Cron EU / shadow-europe / shadow-firds (cola B).
- Scoring, nocturno prod, auth, Twelve Data.

## Verify orquestador

- Diff + tests; smoke Browser preset Europa si hay sesión (:3300) — copy de aviso curated visible o, si flags on en env local, skip smoke con nota.
