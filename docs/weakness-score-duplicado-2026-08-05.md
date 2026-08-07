# weaknessScore duplicado — análisis y arreglo, 2026-08-05

BASE_SHA: `1c3be53`. Cambios limitados a `lib/stockRows.js` y
`tests/stockRowsWeaknessScore.test.js`. `lib/scoringEngine.js` no se tocó.

## PARTE A — Por qué existían dos implementaciones

### A.1 Las dos implementaciones, literales

Canónica, `lib/scoringEngine.js:86-132`:

```js
export function scoreWeakness(r = {}) {
  let s = 0;
  const reasons = [];
  // Cadena de fallback unificada con lib/screenerFilters.js (metric(row, "rsPrimary")):
  // rsGlobalPct ?? rsRating ?? rsCountryPct ?? rsSectorPct ?? 50.
  // Antes este punto usaba rsPrimaryScore(r) que solo cubría rsGlobalPct ?? rsRating,
  // cayendo a 50 cuando ambos faltaban incluso si rsCountryPct/rsSectorPct estaban
  // presentes. Esa divergencia hacía que scoreWeakness devolviera scores distintos
  // según qué consumidor lo invocara (researchRow/screenerPipeline vía scoring.js vs
  // materializedScanner vía screenerFilters.js). Ver test `scoreWeakness · cadena de
  // fallback RS unificada con screenerFilters.js`.
  const rs = firstFinite(r.rsGlobalPct, r.rsRating, r.rsCountryPct, r.rsSectorPct) ?? 50;
  if (rs < 30) { s += 18; reasons.push("RS muy bajo"); }
  else if (rs < 45) { s += 13; reasons.push("RS bajo"); }
  else if (rs < 55) s += 6;
  if (Number.isFinite(r.price) && Number.isFinite(r.sma50) && r.price < r.sma50) { s += 12; reasons.push("bajo SMA50"); }
  if (Number.isFinite(r.price) && Number.isFinite(r.sma200) && r.price < r.sma200) { s += 18; reasons.push("bajo SMA200"); }
  if (Number.isFinite(r.sma200Slope) && r.sma200Slope < 0) { s += 12; reasons.push("SMA200 cae"); }
  if (Number.isFinite(r.sma50) && Number.isFinite(r.sma200) && r.sma50 < r.sma200) s += 7;
  if (Number.isFinite(r.perf3m) && r.perf3m < 0) { s += 8; reasons.push("3M negativo"); }
  if (Number.isFinite(r.perf6m) && r.perf6m < 0) s += 8;
  if (Number.isFinite(r.perf12m) && r.perf12m < 0) s += 8;
  if (Number.isFinite(r.distance52w)) {
    if (r.distance52w < -45) { s += 12; reasons.push("muy lejos de máximos"); }
    else if (r.distance52w < -30) { s += 8; reasons.push("lejos de máximos"); }
    else if (r.distance52w < -20) s += 4;
  }
  if (Number.isFinite(r.distance20d) && r.distance20d < -12) s += 5;
  if (Number.isFinite(r.maxDrawdown63d)) {
    if (r.maxDrawdown63d > 40) { s += 10; reasons.push("drawdown alto"); }
    else if (r.maxDrawdown63d > 28) s += 7;
  }
  if (Number.isFinite(r.upDownVolRatio)) {
    if (r.upDownVolRatio < .7) { s += 9; reasons.push("volumen vendedor"); }
    else if (r.upDownVolRatio < .9) s += 5;
  }
  if (r.upVolume === false && Number.isFinite(r.relativeVolume) && r.relativeVolume >= 1.15) { s += 7; reasons.push("caída con volumen"); }
  if (Number.isFinite(r.riskScore) && r.riskScore < 35) s += 7;
  if (Number.isFinite(r.extSma50) && r.extSma50 < -12) s += 5;
  if (Number.isFinite(r.speculationRiskScore) && r.speculationRiskScore >= 70) s += 4;
  const weaknessScore = Math.max(0, Math.min(100, s));
  return {
    weaknessScore,
    weaknessLabel: weaknessScore >= 78 ? "Deterioro severo" : weaknessScore >= 65 ? "Deterioro alto" : weaknessScore >= 50 ? "Deterioro visible" : weaknessScore >= 35 ? "Debilidad mixta" : "Sin deterioro claro",
    weaknessReasons: reasons.length ? reasons.slice(0, 4) : ["Sin evidencia fuerte"],
  };
}
```

Paralela (antes del arreglo de esta tarea), `lib/stockRows.js:252-269` en `HEAD` (`1c3be53`):

```js
export function weaknessScore(row = {}) {
  const direct = finiteOrNull(snapshotValue(row, "weaknessScore"));
  if (Number.isFinite(direct)) return direct;

  let score = 0;
  const rs = rowRsPrimary(row) ?? 50;
  const distance52w = finiteOrNull(snapshotValue(row, "distance52w"));
  const perf3m = finiteOrNull(snapshotValue(row, "perf3m"));
  const extSma50 = finiteOrNull(snapshotValue(row, "extSma50"));
  const riskScore = finiteOrNull(snapshotValue(row, "riskScore")) ?? 50;

  if (rs < 45) score += 16;
  if (Number.isFinite(distance52w) && distance52w < -30) score += 14;
  if (Number.isFinite(perf3m) && perf3m < 0) score += 12;
  if (Number.isFinite(extSma50) && extSma50 < -8) score += 10;
  if (riskScore < 35) score += 10;
  return clamp(score);
}
```

### A.2 Tabla de factores

| Factor | Canónica (`scoringEngine.js`) | Paralela (`stockRows.js`, antes del fix) |
|---|:---:|:---:|
| RS (global/rating/country/sector, fallback 50) | Sí (3 tramos: <30, <45, <55) | Sí (1 tramo: <45) |
| `price < sma50` | Sí | No |
| `price < sma200` | Sí | No |
| `sma200Slope < 0` | Sí | No |
| `sma50 < sma200` | Sí | No |
| `perf3m < 0` | Sí | No — usaba `perf3m` distinto: como término aparte, no en la paralela |
| `perf6m < 0` | Sí | No |
| `perf12m < 0` | Sí | No |
| `distance52w` (3 tramos) | Sí | No — la paralela solo tenía `distance52w < -30` (1 tramo, mismo umbral pero peso distinto: 8 vs 14) |
| `distance20d < -12` | Sí | No |
| `maxDrawdown63d` (2 tramos) | Sí | No |
| `upDownVolRatio` (2 tramos) | Sí | No |
| `upVolume === false` + `relativeVolume >= 1.15` (firma de volumen) | Sí | No |
| `riskScore < 35` (fallback 50) | Sí | Sí, mismo umbral y peso (7 vs 10 — **peso distinto**) |
| `extSma50 < -12` | Sí | Sí, pero con umbral distinto (`< -8`) y peso distinto (5 vs 10) |
| `speculationRiskScore >= 70` | Sí | No |
| `weaknessLabel` / `weaknessReasons` | Sí | No — la paralela solo devolvía el número |

Nota: `distance52w` y `extSma50` **sí** estaban en ambas, pero con umbrales y pesos distintos — no eran el mismo cálculo con nombre distinto, eran fórmulas distintas para el mismo factor. La paralela cubría 3 de los 15 componentes lógicos de la canónica (RS, `distance52w`, `riskScore`) más `extSma50`, y en los cuatro casos con parámetros diferentes.

### A.3 ¿Es la paralela anterior? ¿Se escribió por falta de datos?

`git log --follow` de `lib/stockRows.js` muestra que el archivo (y su `weaknessScore`
propio) nació completo en el commit `fbe8c035` («Separate RS universe and
benchmark metrics», 20 mayo 2026):

```
$ git log --oneline --follow -- lib/stockRows.js | tail -1
fbe8c03 Separate RS universe and benchmark metrics
```

`git show fbe8c03:lib/stockRows.js` confirma que el `weaknessScore` de 5
factores ya estaba ahí desde el primer commit del archivo, con la misma forma
que en `HEAD` (solo cambió `snapshotValue(...)` sin `finiteOrNull` en el
original — irrelevante para la lógica). No es una versión "recortada" de una
paralela más completa que se fue simplificando; nació ya así.

`lib/scoringEngine.js` es muchísimo más reciente: nació en el commit
`7cbbbf2` («checkpoint: save all pending scoring engine + cron backstop work
before infra sync»), que aparece **después** de `fbe8c03` en el historial de
`lib/stockRows.js` (`git log --oneline --follow -- lib/stockRows.js`):

```
7cbbbf2 checkpoint: save all pending scoring engine + cron backstop work before infra sync
b2551c9 checkpoint: stabilize statsedge phase 1
1f28b25 Harden VCP reliability and screener filters
13b7f98 Fix QA issues and discovery review fallback
70b3d84 Polish StatsEdge methodology UX and data coherence
1971c76 Stabilize StageRadar workflows
fbe8c03 Separate RS universe and benchmark metrics
```

Es decir: `stockRows.weaknessScore` es **anterior** a la existencia de
`scoringEngine.scoreWeakness` como motor consolidado. No hay ningún commit
mensaje ni comentario en el código que documente por qué se escribió una
fórmula reducida en `stockRows.js` en lugar de usar la que ya existía antes de
la consolidación (`lib/scoring.js`, según el comentario de cabecera de
`scoringEngine.js:24-28`, que dice que la canónica «vive en este engine y se
re-exporta desde `lib/scoring.js`»). No se encontró justificación escrita —
ni commit message, ni comentario — para la fórmula reducida de `stockRows.js`.

### A.4 Por qué `stockRows` no usaba la canónica

No es un problema de datos de entrada ni de ciclo de imports — es evidencia
de que **nadie las unificó**, hasta ahora. Verificación concreta:

- **No hay ciclo de imports.** `lib/scoringEngine.js` importa de
  `@/lib/indicators`, `@/lib/methodologyDisplay`, `@/lib/relativeStrength` y
  `@/lib/trendStructure` (`scoringEngine.js:62-65`). Ninguno de esos cuatro
  módulos importa `@/lib/stockRows` (verificado con
  `grep -ln "stockRows" lib/indicators.js lib/methodologyDisplay.js lib/trendStructure.js lib/relativeStrength.js`
  → sin resultados). Importar `scoreWeakness` desde `stockRows.js` no crea
  ciclo.
- **Los datos de entrada sí estaban disponibles.** Los 15 campos que lee
  `scoreWeakness` (`price`, `sma50`, `sma200`, `sma200Slope`, `perf3m`,
  `perf6m`, `perf12m`, `distance52w`, `distance20d`, `maxDrawdown63d`,
  `upDownVolRatio`, `upVolume`, `relativeVolume`, `riskScore`, `extSma50`,
  `speculationRiskScore`, más los 4 de RS) están **casi todos** ya en
  `FAVORITE_SNAPSHOT_FIELDS` (`lib/stockRows.js:7-170` en `HEAD`), la lista
  que `stockRows.js` usa para copiar valores del row hacia el snapshot de un
  favorito. Si el campo se copia desde el row hacia el snapshot es porque el
  row ya lo trae. La única excepción es `upVolume`: no está en
  `FAVORITE_SNAPSHOT_FIELDS`, pero sí existe como campo persistido en la fila
  de scan viva, escrito en `lib/researchRow.js:263` y
  `lib/materializedScanner.js:554,1506`
  (`upVolume: calcBars[1] ? calcBars[0].close >= calcBars[1].close : null`).
  Solo falta en el snapshot reducido de un favorito, no en la fila de scan.

  Conclusión: la causa no fue falta de datos de entrada ni un ciclo de
  dependencias. Fue simplemente que la fórmula reducida se escribió en
  `stockRows.js` antes de que existiera la canónica, y cuando la
  consolidación en `scoringEngine.js` llegó, nadie volvió a `stockRows.js`
  para hacer que usara la nueva fuente única.

## PARTE B — Quién consumía la versión de `stockRows`

### B.1 Consumidores directos de `stockRows.weaknessScore`

```
$ grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
  -E "from \"@/lib/stockRows\"|from '@/lib/stockRows'" app lib
app/page.jsx:68:import { createFavoriteFromRow } from "@/lib/stockRows";
app/research-desk/page.jsx:21:import { createFavoriteFromRow, metricValue, rowTheme, shortBusiness } from "@/lib/stockRows";
app/market-health/page.jsx:13:import { metricValue, rowRsBenchmark, rowRsPrimary, rowRsUniverse, rowTheme, weaknessScore } from "@/lib/stockRows";
app/sectors/page.jsx:17:import { favoriteToRow, metricValue, normalizeStockRows, rowCountry, shortBusiness, weaknessScore } from "@/lib/stockRows";
app/lists/page.jsx:17:import { favoriteToRow, isLongOpportunityRow, metricValue, normalizeStockRows, shortBusiness, sortByMetric, uniqueRows, weaknessScore } from "@/lib/stockRows";
app/review/page.jsx:25:import { createFavoriteFromRow } from "@/lib/stockRows";
lib/grouping.js:3:import { metricValue, rowRsPrimary, rowRsUniverse, weaknessScore } from "@/lib/stockRows";
lib/leaderboards.js:7:import { isLongOpportunityRow } from "@/lib/stockRows";
lib/discoveryAudit.js:2:import { normalizeStockRows, rowCountry } from "@/lib/stockRows";
lib/listRationale.js:3:import { longOpportunityIssue, metricValue, monthsSince, snapshotValue, weaknessScore } from "@/lib/stockRows";
```

Pantallas y superficies afectadas, y si el usuario ve el número:

| Consumidor | Pantalla/endpoint | ¿El usuario ve `weaknessScore`? |
|---|---|---|
| `app/market-health/page.jsx` | `/market-health` | Sí, directo (`weaknessScore(row)` para clasificar/mostrar salud de mercado por fila) |
| `app/sectors/page.jsx` | `/sectors` | Sí, directo (agrupación y orden por debilidad sectorial) |
| `app/lists/page.jsx` | `/lists` | Sí, directo, y también indirecto vía `isLongOpportunityRow`/`sortByMetric` |
| `lib/grouping.js` | Agrupamiento usado por market-health/sectors (no es una página propia) | Indirecto — determina qué fila entra en cada grupo/bucket, afecta lo que el usuario ve agregado |
| `lib/leaderboards.js` | Usado por `/lists` y superficies de "oportunidades largas" vía `isLongOpportunityRow` → `longOpportunityIssue` → `weaknessScore` (`lib/stockRows.js:271-276`) | Indirecto — decide qué símbolos se muestran como "oportunidad", no solo un número visible |
| `lib/listRationale.js` | Explicación textual de por qué una fila entra/sale de una lista | Sí, si el texto generado cita el motivo de debilidad |
| `app/page.jsx`, `app/research-desk/page.jsx`, `app/review/page.jsx` | Screener principal, mesa de research, revisión | Solo indirecto vía `createFavoriteFromRow`/`favoriteToRow`, que llaman a `normalizeStockRow` → `weaknessScore` cuando el favorito no trae el valor canónico ya persistido |

### B.2 Cuándo el valor canónico persistido gana y `stockRows` no recalcula

`lib/stockRows.js:252-255` (antes y después del fix; esta parte no cambió):

```js
export function weaknessScore(row = {}) {
  const direct = finiteOrNull(snapshotValue(row, "weaknessScore"));
  if (Number.isFinite(direct)) return direct;
  ...
```

`snapshotValue(row, key)` (`lib/stockRows.js:194-196`) es `row[key] ?? row.snapshot?.[key]`.
Si el `row` (fila de scan en vivo o favorito reconstruido) ya trae
`weaknessScore` como número finito — sea en el propio row o en
`row.snapshot` — esa rama corta el cálculo y **nunca** se ejecuta la fórmula
de `stockRows.js`. El riesgo real estaba (y solo aplicaba) a filas sin ese
campo persistido, algo que la Parte B.3 mide.

### B.3 Cobertura real en `scan_results`

Consulta acotada por fecha (evita el timeout documentado por no filtrar
`created_at`), vía `mcp__supabase-readonly__supabase_query`:

```
table: scan_results
select: symbol
filter: created_at=gte.2026-07-30&metrics->weaknessScore=is.null
limit: 200
→ []  (0 filas)

table: scan_results
select: symbol
filter: created_at=gte.2026-07-30
limit: 200
→ 200 filas (tope del límite, sin nulos)
```

Y para una ventana más corta (2026-08-06 en adelante):

```
filter: created_at=gte.2026-08-06&metrics->weaknessScore=is.null → []  (0 filas)
filter: created_at=gte.2026-08-06                                 → 8 filas, ninguna nula
```

**Conclusión de datos reales:** en las ventanas consultadas (últimos ~8 días
de scans), `metrics->weaknessScore` está persistido en el 100% de las filas
muestreadas (0 nulos sobre 200 y sobre 8). Esto no prueba cobertura histórica
completa desde el origen del proyecto, pero sí que en la operación reciente
la rama de recálculo de `stockRows.js` casi nunca se ejecuta con datos
"en vivo" del cron — el riesgo real se concentraba en filas de favoritos
reconstruidas (`favoriteToRow`) capturadas antes de que `weaknessScore` se
añadiera a `FAVORITE_SNAPSHOT_FIELDS`, o en cualquier fila que por la razón
que sea llegue sin ese campo.

## PARTE C — El arreglo

### C.1 Diagnóstico

Los datos de entrada de la canónica **sí** están disponibles en el punto
donde `stockRows.weaknessScore` se invoca (Parte A.4). No hace falta un
rediseño mayor. Se unificó: `lib/stockRows.js` ahora importa
`scoreWeakness` desde `lib/scoringEngine.js` y arma el objeto de entrada
resolviendo cada campo con `snapshotValue` (para soportar tanto filas en
vivo como snapshots de favoritos) y `finiteOrNull` (para blindar contra
strings numéricos, igual que ya hacía la fórmula anterior).

`upVolume` es un booleano puro en la canónica (`r.upVolume === false`,
`scoringEngine.js:122`), así que se preserva sin pasar por `finiteOrNull`
(que lo habría corrompido: `Number(false) === 0`, y `Number.isFinite(0)`
es `true`, lo que habría hecho que un `upVolume` ausente se comportara como
`upVolume === 0`, un valor que la canónica nunca produce ni espera).

### C.2 Diff aplicado

Ver diff completo en el informe final de este documento (sección "git diff").
Resumen: `weaknessScore(row)` en `lib/stockRows.js` sigue devolviendo el
valor persistido si existe (sin cambios en esa rama); si no existe, ahora
delega en `scoreWeakness` de `lib/scoringEngine.js` en vez de reimplementar
5 de los 15 factores con umbrales propios. Se eliminó el import de `clamp`
(`lib/formatters`), que solo se usaba en la fórmula reemplazada.

### C.3 Prioridad del valor canónico persistido

No cambió: la rama `if (Number.isFinite(direct)) return direct;`
(`lib/stockRows.js:284-286` tras el fix) sigue siendo la primera instrucción
de la función y sigue teniendo prioridad absoluta sobre cualquier cálculo,
tanto antes como después de este cambio.

## PARTE D — Verificación

### D.1 `npm test` completo (después del fix, incluye el test nuevo)

```
> test
> vitest run


 RUN  v4.1.8 /Users/alejandrofrutos1204/Documents/Codex/2026-05-13/estoy-desarrollando-un-screener-investment-research/Statsedge-v0.1

(node:1695) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  96 passed (96)
      Tests  1296 passed | 8 skipped (1304)
   Start at  16:58:57
   Duration  14.54s (transform 7.02s, setup 0ms, import 17.35s, tests 24.39s, environment 17ms)
```

### D.2 Test nuevo

`tests/stockRowsWeaknessScore.test.js` — 4 casos:

1. Reproduce el caso documentado en `docs/contrato-senales-2026-08-04.md`
   (`rsGlobalPct=20`, sin otros campos): antes la canónica daba 18 y la
   paralela 16; ahora ambas dan 18 porque `stockRows.weaknessScore` delega
   en `scoreWeakness`.
2. Una fila técnica completa (SMAs, perf 3/6/12m, drawdown, firma de
   volumen, riesgo especulativo) — antes esos factores no existían en la
   paralela; ahora `stockRows.weaknessScore(row) === scoreWeakness(row).weaknessScore`
   para cualquier combinación de esos campos.
3. Resolución idéntica pasando los campos directos en el row o envueltos en
   `row.snapshot` (cubre el caso `favoriteToRow`).
4. El valor persistido (`row.weaknessScore`) sigue teniendo prioridad y no
   se recalcula — no se rompió la Parte C.3.

### D.3 Pantallas cuyo comportamiento visible puede cambiar

El cambio **sí** es observable en pantalla, únicamente para filas sin
`weaknessScore` persistido (Parte B.3: hoy es un caso raro en filas de scan
en vivo, pero ocurre en favoritos capturados antes de que el snapshot
incluyera ese campo, y en cualquier fila incompleta). En esos casos el
número que se mostraba cambia porque ahora usa 15 factores en vez de 5:

- `/market-health` — clasificación/valor de debilidad por fila.
- `/sectors` — agrupación y orden por debilidad sectorial.
- `/lists` — valor mostrado, orden por debilidad, y qué filas se consideran
  "oportunidad larga" (`isLongOpportunityRow` vía `lib/leaderboards.js` y
  `longOpportunityIssue` en `lib/stockRows.js`).
- Cualquier pantalla que consuma `lib/grouping.js` o `lib/listRationale.js`
  (rationale textual de por qué una fila entra/sale de una lista).
- Favoritos capturados desde el screener principal (`app/page.jsx`),
  `research-desk` o `review` cuando el snapshot no trae `weaknessScore`
  directo: el valor derivado (no el persistido) cambia.

No cambia nada para filas que ya traen `weaknessScore` persistido (la
mayoría, según B.3): la rama de prioridad no se tocó.

## git diff

```diff
diff --git a/lib/stockRows.js b/lib/stockRows.js
index ed33277..7ddaf57 100644
--- a/lib/stockRows.js
+++ b/lib/stockRows.js
@@ -1,6 +1,6 @@
-import { clamp } from "@/lib/formatters";
 import { businessThemeKey } from "@/lib/businessTheme";
 import { compactMethodologySnapshot } from "@/lib/methodologyEngine";
+import { scoreWeakness } from "@/lib/scoringEngine";
 import { countryCode } from "@/lib/symbols";
 import { dailyLeaderTrendIssue, dailyLongBiasIssue } from "@/lib/trendStructure";
 
@@ -249,23 +249,45 @@ export function rowRsGlobal(row = {}) {
   return rowRsUniverse(row);
 }
 
+// Campos leídos por lib/scoringEngine.js:scoreWeakness (la canónica). Se
+// resuelven vía snapshotValue porque `row` puede ser una fila de scan en vivo
+// (campos directos) o una fila reconstruida desde un favorito (campos bajo
+// row.snapshot). `upVolume` es booleano y se preserva tal cual: scoreWeakness
+// lo compara con `=== true`/`=== false`, no con Number.isFinite.
+const WEAKNESS_NUMERIC_INPUT_FIELDS = [
+  "rsGlobalPct",
+  "rsRating",
+  "rsCountryPct",
+  "rsSectorPct",
+  "price",
+  "sma50",
+  "sma200",
+  "sma200Slope",
+  "perf3m",
+  "perf6m",
+  "perf12m",
+  "distance52w",
+  "distance20d",
+  "maxDrawdown63d",
+  "upDownVolRatio",
+  "relativeVolume",
+  "riskScore",
+  "extSma50",
+  "speculationRiskScore",
+];
+
+function weaknessScoreInput(row) {
+  const input = Object.fromEntries(WEAKNESS_NUMERIC_INPUT_FIELDS.map((key) => [key, finiteOrNull(snapshotValue(row, key))]));
+  const upVolume = snapshotValue(row, "upVolume");
+  input.upVolume = upVolume === true || upVolume === false ? upVolume : null;
+  return input;
+}
+
 export function weaknessScore(row = {}) {
   const direct = finiteOrNull(snapshotValue(row, "weaknessScore"));
   if (Number.isFinite(direct)) return direct;
 
-  let score = 0;
-  const rs = rowRsPrimary(row) ?? 50;
-  const distance52w = finiteOrNull(snapshotValue(row, "distance52w"));
-  const perf3m = finiteOrNull(snapshotValue(row, "perf3m"));
-  const extSma50 = finiteOrNull(snapshotValue(row, "extSma50"));
-  const riskScore = finiteOrNull(snapshotValue(row, "riskScore")) ?? 50;
-
-  if (rs < 45) score += 16;
-  if (Number.isFinite(distance52w) && distance52w < -30) score += 14;
-  if (Number.isFinite(perf3m) && perf3m < 0) score += 12;
-  if (Number.isFinite(extSma50) && extSma50 < -8) score += 10;
-  if (riskScore < 35) score += 10;
-  return clamp(score);
+  return scoreWeakness(weaknessScoreInput(row)).weaknessScore;
 }
 
 export function longOpportunityIssue(row = {}, { requireTrendTemplate = false } = {}) {
```

(`tests/stockRowsWeaknessScore.test.js` es un archivo nuevo; ver su
contenido completo en el repo, no se reproduce aquí por brevedad.)

## CONFIANZA

### Verificado leyendo código e historial

- Las dos implementaciones citadas literalmente coinciden con
  `docs/contrato-senales-2026-08-04.md` (documento previo ya verificado en
  esa tarea).
- La tabla de factores A.2 se construyó comparando línea a línea ambos
  cuerpos de función en `HEAD` (`1c3be53`).
- `git log --follow` confirma que `lib/stockRows.js` (y su `weaknessScore`
  de 5 factores) nació en `fbe8c03`, anterior a `lib/scoringEngine.js`
  (`7cbbbf2`) en el historial del propio archivo. No hay commit message ni
  comentario que justifique la fórmula reducida.
- No hay ciclo de imports entre `scoringEngine.js` y `stockRows.js`:
  verificado listando los imports de `scoringEngine.js` y comprobando que
  ninguno de esos cuatro módulos importa `stockRows`.
- Todos los campos que necesita `scoreWeakness` ya estaban disponibles en
  el punto de uso de `stockRows.js` — 18 de 19 vía `FAVORITE_SNAPSHOT_FIELDS`,
  y `upVolume` vía el campo persistido en la fila de scan
  (`researchRow.js:263`, `materializedScanner.js:554,1506`), aunque no
  formaba parte del snapshot reducido de favoritos.
- Consumidores directos e indirectos de `stockRows.weaknessScore` listados
  por grep exhaustivo sobre `app` y `lib`.
- La rama de prioridad del valor persistido (`stockRows.js:252-255` en
  `HEAD`) no cambió con este fix.

### Verificado ejecutando

- `npm test` completo antes y después del cambio: 95→96 archivos de test
  (se añadió uno), 1292→1296 tests, todos en verde, 8 skipped en ambos
  casos (no relacionados con este cambio).
- El test nuevo reproduce numéricamente el caso documentado
  (`rsGlobalPct=20` → 18, no 16) y una fila técnica completa, confirmando
  igualdad exacta entre `stockRows.weaknessScore` y
  `scoringEngine.scoreWeakness(...).weaknessScore` tras el fix.
- Consulta real a `scan_results` vía `mcp__supabase-readonly__supabase_query`
  (solo lectura, acotada por `created_at`): 0 filas con
  `metrics->weaknessScore` nulo sobre 200 filas de los últimos ~8 días, y
  0 sobre 8 filas de las últimas ~24h.

### Inferido o no verificado en este checkout

- No se midió la cobertura histórica completa de `weaknessScore` persistido
  desde el origen del proyecto — solo las ventanas de fecha consultadas
  (`>= 2026-07-30` y `>= 2026-08-06`), acotadas para evitar el timeout
  documentado de `scan_results` sin filtro de fecha.
- No se verificó en runtime (navegador) el efecto visual en `/market-health`,
  `/sectors` o `/lists`; el impacto se documenta por trazabilidad de código
  (imports y llamadas), no por captura de pantalla. La mayoría de filas en
  producción reciente ya trae `weaknessScore` persistido, así que el cambio
  visible en pantalla, si lo hay hoy mismo, se concentra en favoritos
  antiguos sin ese campo en el snapshot — no se identificó ni inspeccionó
  ningún favorito real en esa condición.
- No se tocaron ni investigaron en profundidad los otros dos duplicados
  mencionados en el contexto (`dataCoverageForRow`, `rsQualityScore`) por
  estar fuera de alcance explícito de esta tarea.
- No se ejecutó ningún test end-to-end (`npm run test:e2e` u otro) ni se
  escribió en Supabase ni se ejecutó el cron, conforme a las restricciones.
