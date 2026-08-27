# INT-1-HK-select — Preferir universo curado en cohorts HK/AU

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium**  
**Origen:** corrida manual 2026-08-27 `asia-hongkong`  
**Evidencia:** `materialized:HK:2026-08-27:o130:l24` — 24 seleccionados del HKEX (~2760), **4 guardados**, 20 rechazos (precio &lt;1 HKD, turnover bajo, hist. corto). Cursor en offset **130** (zona de penny stocks). Umbral INT-1-P1 = 15 → chip HK sigue sin cargar.

## Problema

Los cohorts `asia-hongkong` / `oceania-australia` ya escriben `settings.markets` correctos, pero la **selección** usa el snapshot HKEX/ASX completo + cursor rotativo. Eso no produce ≥15 filas líquidas por corrida de 60s.

En repo ya existen listas líquidas: `marketSymbols("HK")` / `marketSymbols("AU")` = `CURATED` + `EXTRA` (+ expanded) en `lib/universes.js` (~80 HK, decenas AU).

## Objetivo

Una corrida de `scan-refresh?group=asia-hongkong` (y AU) debe poder guardar **≥15 filas** publicables eligiendo primero el núcleo curado, no el offset mid-HKEX.

## Alcance

### Dentro

1. **Selección curada para cohorts de un mercado (HK/AU)** — elige la mínima que funcione:
   - **Preferida:** en `resolveSymbols` / `selectUniverseRows` (o flag desde cron), si `markets` es exactamente `["HK"]` o `["AU"]`, anteponer / usar `marketSymbols(market)` como cola de selección (orden curado→extra), **ignorando el cursor mid-list del HKEX** para esa cola (o reset lógico del offset cuando la fuente es curated-core).
   - **Alternativa aceptable:** en `app/api/cron/scan-refresh/route.js`, para `asia-hongkong` / `oceania-australia`, pasar `symbols: marketSymbols("HK"|"AU").slice(0, limit)` (vía import de `lib/universes.js`) y dejar el camino `explicit` de `resolveSymbols`.
2. **No** bajar `minPrice` / `minAvgTurnover` globales (afectaría US y la calidad del screener).
3. **No** marcar HK/AU `selectable: false`.
4. Tests: con markets `["HK"]`, la selección prioriza símbolos de `marketSymbols("HK")` (o el camino explicit); no depende del offset 130 del snapshot completo.
5. Sin commit ni push.

### Fuera

- Re-escanear todo HKEX en una noche.
- Cambiar umbral `MATERIALIZED_MIN_ROWS_HK_AU` (15).
- TW / fusión multi-mercado.

## Archivos probables

- `lib/materializedScanner.js` (`resolveSymbols` / `selectUniverseRows`)
- `app/api/cron/scan-refresh/route.js`
- `lib/universes.js` (solo import `marketSymbols` si hace falta)
- tests (`materializedScanner` selection / cron plan)

## Verificación (orquestador)

1. Tests en verde.
2. Corrida manual:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     "http://localhost:3000/api/cron/scan-refresh?group=asia-hongkong"
   ```
   Esperado: `savedRows` / `rowCount` **≥15**, `markets: ["HK"]`.
3. Browser Use: chip/preset solo HK → tabla con ≥15 filas (INT-1-P1).

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
