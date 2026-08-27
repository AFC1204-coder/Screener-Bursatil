# INT-1-KR-IN — Cohorts cron + curado para Corea e India

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium**  
**Contexto:** tras INT-1-merge, HK/AU cargan y fusionan. KR/IN están en el selector con listas en `lib/universes.js` pero **sin** cohorte en `SCAN_CRON_GROUPS` → chip → sin materializado / `partial-markets` en fusión.

## En qué consiste (producto)

Hoy puedes marcar 🇰🇷 KR o 🇮🇳 IN en el screener, pero no hay scan nocturno dedicado que deje filas publicables. Este ticket cablea el **mismo patrón que HK/AU**:

1. Cohort cron de un solo mercado.  
2. Selección priorizando `marketSymbols(market)` (curado → extra).  
3. Tras corrida: el chip carga el materializado; con merge, entra en uniones multi-mercado.

**Fuera de este ticket (opción B, después):** smoke del chart con `.HK` / `.AX` — lo hace el orquestador, no programación.

## Objetivo

- `scan-refresh?group=asia-korea` y `asia-india` escriben `settings.markets: ["KR"]` / `["IN"]` con **≥15** filas publicables cada uno (umbral alineado a `MATERIALIZED_MIN_ROWS_HK_AU`, o constante compartida renombrada si conviene).  
- `CURATED_CORE_SCAN_MARKETS` incluye **KR** e **IN** (mismo reset de offset mid-dump que HK/AU).  
- KR hoy solo tiene ~10 en `CURATED` y **cero** en `EXTRA`: ampliar `EXTRA_UNIVERSES.KR` a ≥24 líquidos conocidos (`.KS`) para que una corrida de limit 24 pueda superar 15 guardados. IN ya tiene EXTRA amplio.

## Alcance

### Dentro

1. `lib/cronPlan.js`: grupos `asia-korea` / `asia-india` (markets `["KR"]` / `["IN"]`, limit/perMarket ≥24).  
2. `lib/materializedScanner.js`: añadir KR/IN a `CURATED_CORE_SCAN_MARKETS`.  
3. `lib/universes.js`: `EXTRA_UNIVERSES.KR` ≥24 tickers líquidos (nombres en `CURATED_NAMES` si el patrón del archivo lo pide).  
4. Umbral de filas: reutilizar o generalizar el mínimo 15 para KR/IN en lookup (para que INT-1-P1 no acepte un scan de 4 pennies).  
5. Tests: plan cron + selección curated-core con `markets: ["KR"]` / `["IN"]` (offset alto → reset).  
6. Sin commit ni push.  
7. **No** hace falta meter KR/IN en `CRON_UNIVERSE_MARKETS` si `getUniverseEngineSnapshot({ markets: ["KR"] })` ya resuelve por listas curadas; solo añadirlos ahí si sin eso el cron no obtiene universo.

### Fuera

- IL, CN, BR, MX (siguiente oleada).  
- Ampliar EXTRA AU.  
- Smoke chart intl (opción B, orquestador).  
- Recalcular percentiles en merge.

## Archivos probables

- `lib/cronPlan.js`
- `lib/materializedScanner.js`
- `lib/universes.js`
- `lib/materializedScanLookup.js` (umbral min rows)
- `tests/scanCronPlan.test.js`, `tests/scanCronUniverseSnapshot.test.js`, lookup tests

## Verificación (orquestador, después del retorno)

1. Tests en verde.  
2. Corridas manuales:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     "http://localhost:3000/api/cron/scan-refresh?group=asia-korea"
   curl -H "Authorization: Bearer $CRON_SECRET" \
     "http://localhost:3000/api/cron/scan-refresh?group=asia-india"
   ```
   Esperado: `savedRows` ≥15, `markets` exactos.  
3. Browser Use: chip KR → ≥15; chip IN → ≥15; opcional KR+IN o KR+HK fusión.  
4. Luego opción B: smoke chart `.HK` / `.AX`.

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
