# INT-1-intl-preset — Preset de filtro + mercados para fuera de US

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium**  
**Prioridad producto:** US sigue siendo la base con **Balanceado**. Fuera de US (HK / CA / Europa) Balanceado deja la tabla en **0 visibles** aunque el materializado cargue 15–24 filas.

## Objetivo

1. **Preset de filtro** usable en intl (no exige RS canónico US ni liquidez estilo NYSE).  
2. **Preset de mercados** «mis mercados» (HK + CA + Europa priority) que dispare la fusión ya existente.  
3. Al quedar solo fuera de US, **pasar al preset intl** (o equivalentes) para que haya filas visibles sin resetear a mano.

## Alcance

### Dentro

1. **Nuevo filter preset** en `lib/screenerFilterCatalog.js`, p. ej. clave `intl`, nombre tipo **«Intl / multi-mercado»**:
   - Partir de algo cercano a `broad` / `early`, no de `strict`.
   - **`minRsRating: 0`** (RS canónico solo existe en US).
   - Aflojar liquidez US-céntrica: `minAvgTurnover` / `minAvgVolume` / `minMarketCap` razonables para lotes HK/CA/EU (no los 1.5M$ de Balanceado si vacían el lote).
   - No exigir scores que falten en intl (`minSectorScore`, etc. en 0 o bajos).
   - `setupMode: "any"` o `"early"`; `requireStage2` opcional/false si sigue vaciando.
   - Visible en la UI de bases/presets junto a Balanceado / Exploratorio.

2. **Preset de mercados** en `marketPresetMarkets` + barra de chips:
   - Clave p. ej. `core-intl` / etiqueta **«Core intl»** = `["HK","CA", ...EUROPE_PRIORITY_MARKETS]` (filtrar seleccionables).
   - Al activarlo: `setMarketsAndInvalidate` → carga fusión (INT-1-merge).

3. **Criterio automático (mínimo útil):**
   - Si la selección de mercados **no incluye US** y el filter preset activo es `balanced` (u otro que deje 0 visibles de forma sistemática), aplicar `intl` al cargar el materializado (o justo al cambiar mercados).
   - Si la selección vuelve a **solo US** (o incluye US como nocturno), **no** forzar intl; Balanceado sigue siendo el default US.
   - Copy breve en status/aviso: p. ej. «Preset Intl aplicado (fuera de US)».

4. Tests: settings del preset `intl`; `marketPresetMarkets("core-intl")`; regla auto (sin US → intl; solo US → no pisa balanced).  
5. Sin commit ni push.

### Fuera

- Recalcular RS canónico intl.  
- Cambiar Balanceado US.  
- IL/CN/BR/MX.  
- Europa secondary / JP.

## Archivos probables

- `lib/screenerFilterCatalog.js`
- `lib/marketAvailability.js` (+ `lib/markets.js` para EUROPE_PRIORITY)
- `app/components/screener/ScreenerShell.jsx` (botón preset)
- `app/page.jsx` (auto-switch al cargar mercados)
- tests de catalog / marketAvailability / página si hay harness

## Verificación (orquestador)

1. Tests en verde.  
2. Browser Use:
   - Chip CA o GB con Balanceado previo → tras cambio, preset Intl y **>0 visibles** (o casi todos del lote si el criterio es exploratorio).  
   - Preset **Core intl** → fusión multi, sin banner «no coincide».  
   - Solo US / EE. UU. → sigue Balanceado + 3321.

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
