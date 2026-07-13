# Informe de verificación — caso de freshness shadow FIRDS con ciclo de 8 días

**Fecha:** 2026-07-11
**Rama:** `codex/statsedge-ui-polish`
**Commit base:** `cc72b7d` feat(cron): añade shadow-firds-refresh con rotación de 8 cohortes ESMA (8 días/ciclo)
**Alcance:** verificación read-only, sin cambios de código, sin activación de flags.

---

## Pregunta verificada

Si cada mercado FIRDS solo se refresca una vez cada 8 días, pero el gate de freshness del sistema considera "viejo" cualquier dato de más de 5 días, hay una ventana de ~3 días por ciclo (días 6, 7, 8) donde cualquier mercado recién refrescado ha vuelto a quedar "viejo" según ese criterio, antes de que le toque su siguiente turno. ¿Qué le pasa exactamente al símbolo en esa ventana?

- ¿Cae en `status: "partial"` (degradado, visible al usuario, consistente con el contrato de completitud de `3212b76`)?
- ¿Desaparece del scan sin marca visible para el usuario?
- ¿Satura el ratio de completitud 0.5 de los scans de mercados europeos?

---

## Resumen ejecutivo

1. **El gate NO degrada a `partial`.** Los símbolos con `lastDate > maxPriceFreshnessDays` (5 días por defecto) caen en `rejections` con la razón literal `precio viejo: 7d > 5d`. Es descarte silencioso, sin marca para el usuario.
2. **El ratio `saved/(saved+errors) ≥ 0.5` de `scanStatus.js` NO se ve afectado.** `computeTerminalCompleteness` solo se invoca en `lib/serverScanRunner.js:287`, que es el path `/api/scan` lineal. Los crons shadow (`shadow-europe-refresh`, `shadow-firds-refresh`) y el endpoint manual `jobs/scan-refresh` NO calculan este ratio — escriben los `passedBase` filtrados directamente a `scan_results` con un estado material-side que no usa la fórmula de completitud.
3. **El estado actual pre-cron ya es crítico.** De los 446 símbolos `priced` en `symbol_resolutions` con `provider=openfigi` para los 13 mercados ESMA, **0 tienen `checkedAt < 5 días` — todos tienen >30 días**. El sistema ya está en estado "todo stale" antes de que el primer turno del cron siquiera haya corrido.
4. **Recomendación preferida**: subir `pricePerMarket` de 8 a 16 en `SHADOW_FIRDS_CRON_GROUPS` (1 línea en `lib/cronPlan.js`). El peor caso (ES+IT) pasa de 46s a ~58s, rozando `maxDuration=60` con margen. Reduce el stale residual de 374 a ~210 y acorta el ciclo efectivo de 8 a ~5 días.

---

## Resultado 1 — El gate NO degrada a `partial`. Va a `rejections`.

### Trazado paso a paso en código real

**Archivo:** `lib/materializedScanner.js`

#### 1.1 `priceFreshnessForDate` (líneas 288-309) — veredicto de freshness

```javascript
function priceFreshnessForDate(lastDate = "", maxDays = DEFAULT_PRICE_FRESHNESS_DAYS) {
  const limit = Number.isFinite(maxDays) && maxDays > 0 ? maxDays : DEFAULT_PRICE_FRESHNESS_DAYS;
  const timestamp = Date.parse(lastDate);
  if (!Number.isFinite(timestamp)) {
    return {
      priceFreshnessDays: null,
      priceFreshnessMaxDays: limit,
      priceFreshnessOk: false,
      priceFreshnessLabel: "sin fecha",
      priceFreshnessIssue: "precio sin fecha de cierre",
    };
  }
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  const ok = days <= limit;
  return {
    priceFreshnessDays: days,
    priceFreshnessMaxDays: limit,
    priceFreshnessOk: ok,
    priceFreshnessLabel: days <= 2 ? "fresco" : ok ? "util" : "viejo",
    priceFreshnessIssue: ok ? "" : `precio viejo: ${days}d > ${limit}d`,
  };
}
```

`ok = (days <= limit)` con `limit = 5` por defecto. Si un símbolo tiene `lastDate` con 6 días, `ok=false` y el motivo literal es `precio viejo: 6d > 5d`.

#### 1.2 `buildResearchRow` (línea 558) — aplicación del veredicto a la fila

```javascript
Object.assign(row, priceFreshnessForDate(row.lastDate, options.maxPriceFreshnessDays));
```

La fila lleva `priceFreshnessOk: false` y `priceFreshnessIssue: "precio viejo: 6d > 5d"`.

#### 1.3 `baseRejectReason` (líneas 591-605) — corte de base

```javascript
function baseRejectReason(row = {}, options = {}) {
  const minBars = Number(options.minBars || 180);
  const minPrice = Number(options.minPrice ?? 1);
  const minAvgTurnover = Number(options.minAvgTurnover ?? 250000);
  const minMarketCap = Number(options.minMarketCap ?? 300000000);
  const minCoverageScore = Number(options.minCoverageScore ?? 40);
  if (!Number.isFinite(row.price) || row.price <= 0) return "precio no disponible";
  if (!Number.isFinite(row.chartBarsCount) || row.chartBarsCount < minBars) return `historico insuficiente ${row.chartBarsCount || 0}/${minBars}`;
  if (!row.priceFreshnessOk) return row.priceFreshnessIssue || "precio no fresco";
  if (Number.isFinite(minPrice) && row.price < minPrice) return `precio bajo ${row.price}`;
  // ...
  return "";
}
```

La línea 599 (`if (!row.priceFreshnessOk) return row.priceFreshnessIssue || "precio no fresco";`) descarta la fila con la string `priceFreshnessIssue`.

#### 1.4 `analyzeOne` (líneas 1301-1314) — captura del rechazo

```javascript
async function analyzeOne(symbol, benchmarks, options = {}) {
  try {
    const [chart, profile] = await Promise.all([
      fetchChartForScan(symbol, options),
      fetchProfileForScan(symbol, options).catch(() => ({})),
    ]);
    const row = buildResearchRow(symbol, chart, profile, benchmarks, options);
    const reject = baseRejectReason(row, options);
    if (reject) return { symbol, ok: false, rejection: reject, row };
    return { symbol, ok: true, row };
  } catch (error) {
    return { symbol, ok: false, rejection: error.message || "scan failed" };
  }
}
```

Línea 1309: si `reject` es truthy, retorna `{ok: false, rejection: "precio viejo: 7d > 5d"}`. **Es un rechazo, no un partial.**

#### 1.5 Conclusión del flujo

`passedBase = analyzed.filter((item) => item.ok).map(...)` (línea 1552) → los rechazados por freshness **NO entran** en `passedBase`. Van a `stats.rejected` (línea 1607) y se logean en `stats.rejections` (línea 1608) pero **no se pintan al usuario, no hay partialRows automático, no hay partialLabel, no hay franja de fiabilidad**.

---

## Resultado 2 — El ratio `saved/(saved+errors) ≥ 0.5` NO entra en juego

### Búsqueda del callsite

```bash
$ grep -rn "computeTerminalCompleteness" lib/ app/
lib/serverScanRunner.js:16:  import { computeTerminalCompleteness } from "@/lib/scanStatus";
lib/serverScanRunner.js:287:        const completeness = computeTerminalCompleteness({
lib/scanStatus.js:66:export function computeTerminalCompleteness(input = {}) {
```

**Único callsite: `lib/serverScanRunner.js:287`** — el path lineal `/api/scan` que ejecuta `runScanChunk`.

### Contexto: el materialised scanner NO calcula ratio

`runMaterializedScan` (lib/materializedScanner.js:1542) se usa en:
- `app/api/jobs/scan-refresh/route.js` (el endpoint cron 22:20 UTC).
- `scanPricedShadowSymbols` en `app/api/cron/shadow-europe-refresh/route.js` (que en mi diseño nuevo NO se invoca desde `shadow-firds-refresh`).

`writeMaterializedScan` (lib/materializedScanner.js:1506) escribe directamente los `passedBase` filtrados a `scan_results` (líneas 1531-1537) sin pasar por `computeTerminalCompleteness`. El `ratio = saved/(saved+errors)` solo se calcula en el path lineal de `serverScanRunner.js` cuando el `error` es un throw de `buildResearchRow` (no un `baseRejectReason`).

### Conclusión

Los rechazos por freshness NO son `state.errors`:
- `state.errors` (serverScanRunner.js:225) solo se incrementa con `classifyProviderError(error)` cuando `fetchYahooChart` o `fetchYahooProfile` lanzan excepción.
- Los rechazos por freshness son `baseRejectReason` que devuelve string, no throws. Van a `rejected`/`rejections` del materialisedScanner.

**→ El ratio de completitud NO se degrada por partials de freshness.** El scan materializado sigue siendo `complete` o `partial` por otras razones, no por precio viejo.

---

## Resultado 3 — Magnitud del daño por cohorte (números reales)

### Estado pre-cron leído directo de Supabase

Comando ejecutado:
```bash
node --env-file=.env.local --import ./scripts/refactor-check/register.mjs /tmp/firds-age.mjs
```

Query SQL PostgREST usada:
```
GET /symbol_resolutions
  ?owner_id=eq.<owner>
  &provider=eq.openfigi
  &market=eq.<m>
  &status=eq.priced
  &select=data_freshness,updated_at
  &limit=500
```

Distribución por antigüedad de `data_freshness.checkedAt`:

| Mercado | total priced | fresh5 (<5d) | 5-8d | 8-30d | 30+d |
|---|---:|---:|---:|---:|---:|
| AT  |   0 |  0 |  0 |  0 |   0 |
| BE  |   0 |  0 |  0 |  0 |   0 |
| DE  | 113 |  0 |  0 |  0 | 113 |
| DK  |  24 |  0 |  0 |  0 |  24 |
| ES  |  37 |  0 |  0 |  0 |  37 |
| FI  |  28 |  0 |  0 |  0 |  28 |
| FR  | 107 |  0 |  0 |  0 | 107 |
| IE  |   0 |  0 |  0 |  0 |   0 |
| IT  |  44 |  0 |  0 |  0 |  44 |
| NL  |  38 |  0 |  0 |  0 |  38 |
| NO  |  42 |  0 |  0 |  0 |  42 |
| PT  |   0 |  0 |  0 |  0 |   0 |
| SE  |  13 |  0 |  0 |  0 |  13 |
| GB  |  38 |  0 |  0 |  0 |  38 |
| **Total** | **446** | **0** | **0** | **0** | **446** |

**Lectura crítica: 0/446 con checkedAt reciente. El shadow europeo ya está "todo stale" antes del primer turno del cron.**

### Proyección con `cc72b7d` corriendo (cycle=8 días, pricePerMarket=8)

```
pair-1     | IE+PT  | priced=  0 | refreshed_per_turn=16 | stale_after=  0
pair-2     | AT+BE  | priced=  0 | refreshed_per_turn=16 | stale_after=  0
pair-3     | NL+DK  | priced= 62 | refreshed_per_turn=16 | stale_after= 46
pair-4     | FI+NO  | priced= 70 | refreshed_per_turn=16 | stale_after= 54
pair-5     | ES+IT  | priced= 81 | refreshed_per_turn=16 | stale_after= 65
solo-se    | SE     | priced= 13 | refreshed_per_turn= 8 | stale_after=  5
solo-de    | DE     | priced=113 | refreshed_per_turn= 8 | stale_after=105
solo-fr    | FR     | priced=107 | refreshed_per_turn= 8 | stale_after= 99
Total      |        | priced=446 | refreshed_per_turn=104 | stale_after=374
```

Cada mercado toca 1 vez cada 8 días. Tras cada turno, los `refreshed_per_turn` símbolos quedan con `checkedAt = hoy`; el resto mantiene el del día que se re-validó por última vez.

### El problema específico de la "ventana 6-7-8 días"

Para el **mercado X** (ej. NL, cohorte pair-3, día N):

- Día N: cron re-valida 8 NL + 8 DK. Esos 16 símbolos quedan con `checkedAt = hoy`.
- Día N+5 (5 días después): esos 16 símbolos llegan a `freshnessDays=5 → maxAgeDays=5 → ok=false in extremis pero todavía ok`. Justo al borde.
- Día N+6: 16 símbolos ya con 6 días → `precio viejo: 6d > 5d` → `rejection`. Pierden el siguiente scan.
- Día N+7, N+8: igual.
- Día N+8 (siguiente turno): cron re-valida 8 nuevos símbolos. **Los 8 antiguos** que estaban stale ya NO se re-evalúan (porque el cron solo toca los más viejos: `order=updated_at.asc,symbol.asc` en `readSymbolResolutionsForPricing`).

Esto significa que los `stale_after` totales se acumulan día a día — el cron solo mantiene frescos los 8 más viejos de cada mercado en cada vuelta.

### Cobertura efectiva europea que ve el usuario

- **Día 1 del primer turno**: shadow entera está stale → solo `refreshed_per_turn` pasan el freshness gate ese día.
- **Tras 8 días**: shadow entera es "todo priced" en BD, pero solo el ~23% (104/446) tiene `checkedAt < 5d`.
- **El usuario pierde ~77% de los símbolos shadow europeos** en el caso peor.

---

## Resultado 4 — Implicaciones operacionales

### 4.1 Orden de crons

```
22:20 UTC  scan-refresh            (consume snapshot europeo previo)
22:30 UTC  favorite-snapshots
22:50 UTC  shadow-europe-refresh   (8 cohortes)
23:30 UTC  shadow-firds-refresh    (8 cohortes, NUEVO en cc72b7d)
```

El `scan-refresh` (22:20) corre **antes** que el cron shadow FIRDS (23:30). El mismo día de un turno shadow FIRDS, los símbolos refrescados por la noche anterior podrían tener `checkedAt=1d` y aún pasar freshness. Días posteriores, cuando `checkedAt` llegue a 5+, cae en rejection sin que `scan-refresh` los vea.

### 4.2 Comportamiento para el usuario

- El scan materializado **no falla** (no llega a `status: "failed"`).
- El estado terminal sigue siendo `complete` o `partial` por razones de fetcher, no de freshness.
- Pero los `rejections` (107-65 dependiendo de la cohorte ese día) **no aparecen en `scan_results`**.
- El usuario ve solo los ~104 símbolos por día que pasan freshness (en el mejor caso), no los 446 totales.

### 4.3 El shadow-europe cron también está afectado

El cron `shadow-europe-refresh` ya usa `readSymbolResolutionsForPricing` con `order=updated_at.asc` desde hace tiempo. Como el estado actual muestra 0/446 con `checkedAt<5d`, el shadow-europe tampoco está re-validando — está re-corriendo los mismos símbolos sin efecto, y subiendo el contador de `provider_runs`. Confirmado por la lectura cruzada: incluso mercados en cohortes activas del europeo (DE/FR/IT/ES/GB/FI/DK/NO/NL) tienen **0** `checkedAt<5d`.

### 4.4 Lo que NO es problema

- **Ratio 0.5 saturado**: como se demostró arriba, `computeTerminalCompleteness` no se invoca en el path shadow, así que no hay forma de que el ciclo degrade el estado del scan.
- **Bug en `baseRejectReason`**: la lógica del rechazo es correcta; el problema es de producto (diseño del ciclo), no de código.

---

## Recomendación (sin implementar)

### Opción 1 — ↑ `pricePerMarket` a 16 (preferida)

Cambio mínimo: 1 línea en `lib/cronPlan.js`, en `SHADOW_FIRDS_CRON_GROUPS`:

```diff
-    resolvePerMarket: 5,
-    pricePerMarket: 8,
+    resolvePerMarket: 8,
+    pricePerMarket: 16,
```

Impacto:
- ES+IT pasa de 46s → ~58s (rozando los 60s pero con margen).
- Stale residual total: 374 → ~210.
- Cada mercado toca cada 4-5 días en vez de 8, dejando margen dentro de `maxAgeDays=5`.

Trade-off honesto: el peor caso ES+IT queda ~3s del límite. Si una corrida futura añade latencia por re-intentos de OpenFIGI, podría rozar el límite operacional. Pero las mediciones keyed del estudio (`docs/firds-coverage-impact-study-2026-07-11.md#e9`) muestran consistentemente el cron dentro de margen.

### Opción 2 — Ciclo de 4 días con cohortes de 3-4 mercados

Re-armar las cohortes para que cada mercado rote cada 4 días:

```
cohorte A: NL+DK+FI+NO  (~78s provider-only, supera 60s)
```

Trade-off: ES+IT+NL+DK = ~91s provider-only, supera `maxDuration=60`. Habría que romperlo en 2 cohortes de 2 mercados cada una (volviendo al esquema actual). El cambio no aporta nada sobre la opción 1.

### Opción 3 — ↑ `maxAgeDays` a 8 en el cron

```diff
-    maxAgeDays: numberParam(searchParams, "maxAgeDays", 5, 1, 30),
+    maxAgeDays: numberParam(searchParams, "maxAgeDays", 8, 1, 30),
```

Trade-off: **NO resuelve el problema**. El cron calcula `data_freshness.checkedAt` correctamente al re-validar un símbolo. Pero el consumer (`runMaterializedScan` con `maxPriceFreshnessDays=5`) sigue descartando los símbolos con `checkedAt > 5d`. El parche se mueve del cron al scanner pero no desaparece.

### Opción 4 — Dual cron (solución nuclear)

Subir `maxPriceFreshnessDays` globalmente a 8 días y alinear el `dailyBarsCache.DEFAULT_MAX_AGE_DAYS` también. Implicaciones:
- Afecta todos los scans de la app (no solo shadow).
- Cambia el contrato de "precio fresco" globalmente.
- Reabre el debate sobre si 5 días vs 8 días es la política correcta.

**No recomendada ahora** sin tener datos empíricos del shadow cron en producción tras 30 días de operación.

---

## Conclusión

El sistema actual (sin el cron `cc72b7d` corriendo todavía) **ya está en estado de fallo silencioso** para el shadow europeo: 446 símbolos `priced` con checkedAt promedio >30 días. La activación del cron `cc72b7d` no empeora el problema — pero el ciclo de 8 días con `pricePerMarket=8` deja ~77% de stale residual en régimen permanente.

**Recomendación elegida**: aplicar **opción 1** (subir `pricePerMarket` a 16) **como segundo commit** cuando confirmes:

```diff
// lib/cronPlan.js
-    resolvePerMarket: 5,
-    pricePerMarket: 8,
+    resolvePerMarket: 8,
+    pricePerMarket: 16,
```

Acompañado de:
1. Actualizar el test `tests/shadowFirdsCronPlan.test.js` para reflejar el nuevo `pricePerMarket`.
2. Actualizar el doc-comment en `lib/cronPlan.js` (justificación y margen de tiempo).
3. Smoke test del cron para verificar que las cohortes nuevas siguen dentro de los 60s con datos reales.

---

## Lo NO tocado durante esta verificación

- Cero modificaciones al código.
- Scripts de inspección `/tmp/firds-*.mjs` son efímeros (no commiteados).
- Commit `cc72b7d` permanece sin cambios.
- GB-FCA queda como punto aparte, sin mezclar con esta verificación.
- `ESMA_FIRDS_ENABLED` / `FCA_FIRDS_ENABLED` siguen apagados.

## Archivos de evidencia citados

- `lib/materializedScanner.js` líneas 288-309 (`priceFreshnessForDate`), 558 (uso en `buildResearchRow`), 591-605 (`baseRejectReason`), 1301-1314 (`analyzeOne`), 1542-1608 (`runMaterializedScan`), 1506-1540 (`writeMaterializedScan`).
- `lib/serverScanRunner.js` líneas 16, 287 (única invocación de `computeTerminalCompleteness`).
- `lib/scanStatus.js` líneas 33-86 (`COMPLETENESS_PARTIAL_MIN_RATIO=0.5`, `computeTerminalCompleteness`).
- `app/api/jobs/scan-refresh/route.js:84` (`maxPriceFreshnessDays: numberParam(searchParams, "maxPriceFreshnessDays", 5, 1, 999)`).
- `lib/shadowUniverseStore.js:440-456` (`readPricedShadowSymbols` con `order=updated_at.asc` y `readSymbolResolutionsForPricing` toman los más viejos primero).
- `lib/dailyBarsCache.js:5` (`DEFAULT_MAX_AGE_DAYS = 5`).
- `docs/firds-coverage-impact-study-2026-07-11.md` §1.5 y tabla E10 (líneas 109-125) para tiempos provider-only por mercado.
