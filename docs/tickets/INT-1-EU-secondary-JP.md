# INT-1-EU-secondary-JP — Europa secondary + Japón curated-core

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium**  
**Prioridad producto:** tras priority EU (GB…ES) y preset Intl. Dueño pidió también **Europa secondary / JP**. IL/CN/BR/MX siguen aplazados.

## Problema

- **Europa secondary** (`DK`,`NO`,`FI`,`BE`,`PT`,`AT`,`IE`): cohort `europe-secondary` usa alias **`EU2`** con `perMarket: 3` → materializados pobres / mezclados (mismo anti-patrón que el antiguo `EU1`).
- Esos países **no** están en `CURATED_CORE_SCAN_MARKETS` → la cola puede irse al dump FIRDS en vez del curado.
- **JP:** ya tiene `asia-japan` (limit 24) y listas en `universes.js`, pero **no** está en curated-core → mismo riesgo de dump mid-list / filas no publicables bajo umbral.

## Objetivo

Mismo patrón que INT-1-CA-EU / KR-IN:

1. Selección **curated-core** para `EUROPE_SECONDARY_MARKETS` + **JP**.  
2. Cohorts cron de **un solo mercado** para secondary (sustituir `EU2`).  
3. Tras corrida (orquestador): chip DK/NO/…/JP carga ≥15 filas publicables cuando haya universo suficiente.

## Alcance

### Dentro

1. **`CURATED_CORE_SCAN_MARKETS`** (`lib/materializedScanner.js`): añadir `JP` + `EUROPE_SECONDARY_MARKETS` (`DK`,`NO`,`FI`,`BE`,`PT`,`AT`,`IE`).  
2. **Lookup** (`lib/materializedScanLookup.js`): mismos códigos en el set de umbral `MATERIALIZED_MIN_ROWS_CURATED_CORE` (15).  
3. **`SCAN_CRON_GROUPS`** (`lib/cronPlan.js`):
   - **Sustituir** `europe-secondary` (`markets: ["EU2"]`, perMarket 3) por cohorts dedicados, uno por país, p. ej. `europe-dk`, `europe-no`, … (`markets: ["DK"]` etc., limit/perMarket ≥24).  
   - Mantener `asia-japan` (JP, ≥24) sin mezclar con otros.  
4. **Universo corto:** si algún secondary (p. ej. `IE`) tiene `CURATED`+`EXTRA` &lt; ~24 líquidos, ampliar `EXTRA_UNIVERSES` lo mínimo para poder superar 15 publicables (mismo criterio que KR). No inventar tickers dudosos.  
5. Tests: plan sin `EU2` mezclado; curated-core JP/DK (u otro secondary) con offset alto → reset; lookup umbral.  
6. Sin commit ni push.

### Fuera

- US / HK / AU / KR / IN / CA / Europa priority (ya cableados).  
- IL, CN, BR, MX, TW (TW sigue no seleccionable / fallido).  
- Meter secondary en el chip **Core intl** (sigue = HK+CA+priority).  
- Corridas cron + smoke Browser Use (orquestador).  
- Recalcular percentiles en merge.

## Archivos probables

- `lib/cronPlan.js`
- `lib/materializedScanner.js`
- `lib/materializedScanLookup.js`
- `lib/markets.js` (import `EUROPE_SECONDARY_MARKETS`)
- `lib/universes.js` (solo si hace falta EXTRA)
- `tests/scanCronPlan.test.js`, `tests/scanCronUniverseSnapshot.test.js`, lookup tests

## Verificación (orquestador)

1. Tests en verde.  
2. Corridas: al menos `asia-japan` + 1–2 secondary (`europe-dk` / `europe-no`).  
3. Browser Use: chips JP y un secondary ≥15 (o aviso honesto si universo &lt;15); opcional fusión JP+HK.

## Plantilla de retorno

```
## Resumen
(1–4 bullets)

## Archivos
(lista real)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
