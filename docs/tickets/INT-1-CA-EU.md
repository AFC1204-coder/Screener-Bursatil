# INT-1-CA-EU — Curado primero en Canadá y Europa priority

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium**  
**Prioridad producto (dueño):** base = **US** (ya resuelto). Luego **HK** (hecho), **CA**, **Europa**. KR/IN/IL/CN/BR/MX **no** son foco.

## Problema

- **CA:** ya tiene cohort `north-america-canada`, pero **no** está en `CURATED_CORE_SCAN_MARKETS` → puede seleccionar dump TSX en vez de `marketSymbols("CA")` (~130 líquidos).
- **Europa:** `europe-priority` usa alias `EU1` (GB,DE,FR,NL,CH,SE,IT,ES) con `perMarket: 3` → materializados de **3–7 filas** por país (INT-0). El chip de un solo país no llega al umbral útil; la fusión multi-UE tampoco.

## Objetivo

Mismo patrón que HK/AU:

1. Selección **curated-core** para CA y para cada mercado de `EUROPE_PRIORITY_MARKETS`.  
2. Cohorts cron de **un solo mercado** (no mezclar 8 países a 3 símbolos).  
3. Tras corrida: chip CA / GB / DE / … carga ≥15 filas publicables.

## Alcance

### Dentro

1. **`CURATED_CORE_SCAN_MARKETS`:** añadir `CA` + `EUROPE_PRIORITY_MARKETS` (`GB`,`DE`,`FR`,`NL`,`CH`,`SE`,`IT`,`ES`).  
2. **Lookup:** incluir esos códigos en el set de umbral `MATERIALIZED_MIN_ROWS_CURATED_CORE` (15).  
3. **`SCAN_CRON_GROUPS`:**
   - Mantener `north-america-canada` (CA, limit/perMarket ≥24).  
   - **Sustituir** el grupo multi `europe-priority` (`markets: ["EU1"]`, perMarket 3) por cohorts dedicados, uno por país priority, p. ej. `europe-gb`, `europe-de`, … (limit/perMarket ≥24, `markets: ["GB"]` etc.).  
   - `europe-secondary` (DK…): **fuera** de este ticket (menos relevante).  
4. Tests: plan sin `EU1` mezclado en priority; curated-core CA/GB con offset alto → reset; lookup umbral.  
5. Sin commit ni push.

### Fuera

- US / HK / AU / KR / IN (ya cableados).  
- IL, CN, BR, MX, TW.  
- Ampliar EXTRA AU.  
- Recalcular percentiles en merge.  
- Corridas manuales + smoke (orquestador).

## Archivos probables

- `lib/cronPlan.js`
- `lib/materializedScanner.js`
- `lib/materializedScanLookup.js`
- `lib/markets.js` (solo import `EUROPE_PRIORITY_MARKETS` si conviene)
- `tests/scanCronPlan.test.js`, `tests/scanCronUniverseSnapshot.test.js`, lookup tests

## Verificación (orquestador)

1. Tests en verde.  
2. Corridas: `north-america-canada`, `europe-gb` (y al menos un DE/FR).  
3. Browser Use: chips CA, GB (o DE) ≥15; opcional CA+HK fusión.

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
