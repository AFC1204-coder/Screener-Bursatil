# Duplicados restantes — `dataCoverageForRow` y `rsQualityScore`

Fecha: 2026-08-07. BASE_SHA: `1bf8e40`. Rama: `codex/statsedge-ui-polish`.

Método: el mismo que `docs/weakness-score-duplicado-2026-08-05.md` y el commit
`765e0b0` — citar ambas implementaciones, comprobar antigüedad por git, probar
las dos hipótesis de impedimento (ciclo de imports, datos ausentes), y solo
unificar si ninguna aplica.

---

# 1. `dataCoverageForRow`

## PARTE A — Por qué existían dos

### A.1 Las dos implementaciones, literales (antes de esta tarea)

Interactivo, `lib/researchRow.js:77-165` en `HEAD` (`1bf8e40`):
```js
function dataCoverageForRow(row = {}, profile = {}) {
  const gm = profile.growthMetrics || row.growthMetrics || {};
  const freshness = row.priceFreshnessOk === undefined ? priceFreshnessForDate(row.lastDate) : {
    priceFreshnessDays: row.priceFreshnessDays ?? null,
    priceFreshnessMaxDays: row.priceFreshnessMaxDays ?? DEFAULT_PRICE_FRESHNESS_DAYS,
    priceFreshnessOk: row.priceFreshnessOk === true,
    priceFreshnessLabel: row.priceFreshnessLabel || (row.priceFreshnessOk ? "fresco" : "viejo"),
    priceFreshnessIssue: row.priceFreshnessIssue || "",
  };
  const technicalCoverageScore = coveragePct([ /* 33 campos */ ]);
  const profileCoverageScore = coveragePct([ /* 10 campos */ ]);
  const fundamentalCoverageScore = coveragePct([
    [gm.revenueGrowth, "revenueGrowth"],
    [gm.earningsGrowth, "earningsGrowth"],
    [gm.grossMargin, "grossMargin"],
    [gm.operatingMargin, "operatingMargin"],
    [gm.profitMargin, "profitMargin"],
    [gm.ebitdaMargin, "ebitdaMargin"],
    [gm.roe, "roe"],
    [gm.roa, "roa"],
    [gm.debtToEquity, "debtToEquity"],
    [gm.currentRatio, "currentRatio"],
    [gm.institutionalOwnership, "institutionalOwnership"],
    [gm.insiderOwnership, "insiderOwnership"],
    [gm.shortPercentOfFloat, "shortPercentOfFloat"],
  ]);
  const stalePenalty = freshness.priceFreshnessOk ? 0 : 18;
  const dataCoverageScore = Math.max(0, Math.round(technicalCoverageScore * .68 + profileCoverageScore * .22 + fundamentalCoverageScore * .1 - stalePenalty));
  const issues = [];
  if (!freshness.priceFreshnessOk) issues.push(freshness.priceFreshnessIssue || "precio no fresco");
  if (technicalCoverageScore < 70) issues.push("técnico parcial");
  if (profileCoverageScore < 55) issues.push("perfil parcial");
  if (fundamentalCoverageScore < 35) issues.push("fundamental parcial");
  return { ...freshness, dataCoverageScore, technicalCoverageScore, profileCoverageScore, fundamentalCoverageScore, dataCoverageLabel: /*...*/, dataCoverageIssues: issues };
}
```

Cron, `lib/materializedScanner.js:321-408` en `HEAD` — **byte-a-byte idéntico**,
salvo dos líneas:
```js
  const fundamentalCoverageScore = coveragePct([
    [gm.revenueGrowth, "revenueGrowth"],
    [gm.earningsGrowth, "earningsGrowth"],
    [gm.grossMargin, "grossMargin"],
    [gm.operatingMargin, "operatingMargin"],
    [gm.profitMargin, "profitMargin"],
    // ← sin [gm.ebitdaMargin, "ebitdaMargin"]
    [gm.roe, "roe"],
    ...
  ]);
  ...
  if (technicalCoverageScore < 70) issues.push("tecnico parcial"); // sin tilde
```
También eran copias byte-a-byte los helpers `coveragePct` (`researchRow.js:49-53`
/ `materializedScanner.js:292-296`) y `priceFreshnessForDate`
(`researchRow.js:55-76` / `materializedScanner.js:298-319`).

### A.2 Diferencias concretas — tabla

| Elemento | Interactivo (`researchRow.js`) | Cron (`materializedScanner.js`) |
|---|---|---|
| `coveragePct` | idéntico | idéntico |
| `priceFreshnessForDate` | idéntico | idéntico |
| Lista de `technicalCoverageScore` (33 campos) | idéntica | idéntica |
| Lista de `profileCoverageScore` (10 campos) | idéntica | idéntica |
| Lista de `fundamentalCoverageScore` | **13 campos**, incluye `ebitdaMargin` | **12 campos**, sin `ebitdaMargin` |
| Fórmula de `dataCoverageScore` | `technical*.68 + profile*.22 + fundamental*.1 - stalePenalty` | idéntica |
| Texto de issue "técnico parcial" | con tilde | sin tilde (cosmético, no afecta al score) |

Único efecto numérico real: `fundamentalCoverageScore` (y por tanto
`dataCoverageScore`, con peso .1) puede diferir cuando `ebitdaMargin` está
ausente — el interactivo lo cuenta como un campo más "no útil" (denominador
13), el cron ni lo mira (denominador 12). Con todos los campos presentes, el
resultado coincide igual (13/13 = 12/12 = 100 tras redondeo) — la divergencia
solo aparece con datos parciales (ver B.6 para el caso exacto).

### A.3 ¿Cuál nació antes?

```
$ git log --oneline --follow -S "function dataCoverageForRow" -- lib/researchRow.js | tail -1
43ef9f8 Server-side scan chain, cancellation, favorite snapshots cron y refactor de libs   (2026-06-12)

$ git log --oneline --follow -S "function dataCoverageForRow" -- lib/materializedScanner.js | tail -1
fbe8c03 Separate RS universe and benchmark metrics   (2026-05-20)

$ git log --oneline --follow -S "ebitdaMargin" -- lib/researchRow.js
7cbbbf2 checkpoint: save all pending scoring engine + cron backstop work before infra sync   (2026-07-06)
43ef9f8 Server-side scan chain, ...   (2026-06-12)
```
Orden real: el cron (`materializedScanner.js`) tiene la función **desde el
20 de mayo**. `researchRow.js` no existía todavía — se creó tres semanas
después (`43ef9f8`, 12 de junio), casi con toda seguridad copiando la función
del cron tal como estaba entonces (mismo cuerpo, mismos helpers). El campo
`ebitdaMargin` se añadió a la copia de `researchRow.js` más tarde
(`7cbbbf2`, 6 de julio) — la misma fecha en la que se creó
`lib/dataCoverageShared.js` — y nunca se retro-portó al cron.

### A.4 ¿Impedimento real?

**Ciclo de imports: no.** Ambos archivos ya importaban `usefulValue` desde
`@/lib/dataCoverageShared` antes de esta tarea
(`lib/researchRow.js:5`, `lib/materializedScanner.js:3`) — el módulo
compartido ya era una dependencia común de ambos, así que añadirle más
funciones no introduce ninguna arista nueva de import.

**Datos de entrada ausentes en el punto donde se invoca: no.** `ebitdaMargin`
viaja dentro de `growthMetrics`, poblado por el mismo proveedor
(`lib/yahoo.js:1054,1118,1143`) para los dos caminos:
- Interactivo: `lib/serverScanRunner.js:11` importa `fetchYahooProfile` desde
  `@/lib/marketData`.
- Cron: `lib/materializedScanner.js:51` importa `fetchYahooProfile`
  directamente desde `@/lib/yahoo`.

`lib/marketData.js:54-61` (`fetchYahooProfile`) es una fachada de solo caché
— llama a `rawFetchYahooProfile` (el mismo `lib/yahoo.js`) sin tocar ni
filtrar ningún campo:
```js
export async function fetchYahooProfile(symbol, options = {}) {
  const s = normalizeSymbol(symbol);
  if (options.refresh === true) {
    const value = await rawFetchYahooProfile(s);
    marketCache.set(`profile:${s}`, value, TTL.PROFILE);
    return value;
  }
  return marketCache.cached(`profile:${s}`, TTL.PROFILE, () => rawFetchYahooProfile(s));
}
```
Confirmado: `profile.growthMetrics.ebitdaMargin` está disponible para el cron
exactamente igual que para el interactivo. La ausencia en la lista del cron
no es una limitación de datos — es una lista que no se actualizó cuando se
actualizó la otra.

### A.5 El comentario de `lib/dataCoverageShared.js` — cita y evaluación

Cita literal, tal como estaba antes de esta tarea:
```
// NOT in this module (kept local per call site):
//   - coveragePct: each call site wraps it slightly differently
//     (researchRow.js + materializedScanner.js use pairs [value, field]; the older
//     scoreCoverage in company-brief/route.js uses flat values only). Since the
//     pair-aware implementation is shared identically by both researchRow and
//     materializedScanner, we export it here too — but the legacy flat-only
//     scoreCoverage in company-brief/route.js keeps its local helper to avoid
//     breaking its caller contract.
//   - dataCoverageForRow: each call site has its own field list (researchRow.js
//     includes ebitdaMargin, materializedScanner.js does not). The wrapper is
//     identical, but the lists differ, so it stays local.
```
**Evaluación: la razón no es válida como justificación de diseño — es una
nota de precaución, no un argumento.** El comentario **documenta el hecho**
de la divergencia (correctamente: la localizó con precisión, campo por
campo) pero **no argumenta por qué debería seguir así**. No dice "el cron no
tiene ebitdaMargin disponible" (falso, A.4), ni "el cron mide cobertura
fundamental con un criterio distinto a propósito" (no hay ningún otro indicio
de esa intención en el código o en mensajes de commit). Es exactamente el
mismo patrón que `weaknessScore`: alguien construyendo un módulo compartido
(`7cbbbf2`, la misma fecha en que se añadió `ebitdaMargin` al interactivo)
notó la diferencia, la anotó con cautela para no cambiar comportamiento de
forma incidental dentro de un commit con otro objetivo (extraer
`ZERO_LEGIT_FIELDS`/`usefulValue`), y nunca volvió a resolverla.

---

## PARTE B — Quién consume cada una

### B.6 Cuándo el valor canónico persistido gana y la paralela no se ejecuta

**No aplica de la forma en que aplicaba a `weaknessScore`.** `dataCoverageForRow`
no tiene una rama "si `row.dataCoverageScore` ya es finito, devuélvelo sin
recalcular" — se ejecuta siempre, una vez por fila, tanto en
`researchRow.js:308` (`buildResearchRow`) como en
`materializedScanner.js:488` (su propio `buildResearchRow` interno). Aquí no
hay "canónica vs. fallback condicional": son dos ejecuciones **incondicionales**
del mismo cálculo en dos pipelines distintos — el defecto real (A.2) no es
"a veces se salta el cálculo correcto", es "el cálculo en sí difiere entre
pipelines". Por eso la Parte C no es "que la paralela delegue si falta el
valor" sino "que las dos dejen de ser copias y pasen a ser una".

Consumidores de `dataCoverageScore`/`technicalCoverageScore`/
`fundamentalCoverageScore` (ya inventariados en
`docs/contrato-senales-2026-08-04.md:83-84`, verificado que siguen vigentes):

| Consumidor | Qué hace | ¿Usuario lo ve? |
|---|---|---|
| Gate de rechazo del cron, `lib/materializedScanner.js` (`baseRejectReason`, cita: `if (Number.isFinite(minCoverageScore) && (row.dataCoverageScore || 0) < minCoverageScore) return \`cobertura baja ${row.dataCoverageScore || 0}\`;`) | Si `dataCoverageScore < 40` (default), el símbolo se descarta del scan del cron por completo | Indirecto — decide qué símbolos aparecen en el screener materializado |
| `lib/screenerFilterCatalog.js:579` (`minFundamentalCoverageScore`) y presets (`early`, `ipo`, etc.) | Filtro de usuario/preset sobre `fundamentalCoverageScore` | Sí, si el usuario ajusta el filtro |
| `lib/decisionAudit.js:181-182,414-415` | Auditoría de decisión por fila (por qué se aceptó/rechazó) | Sí, en la ficha de decisión |
| `lib/screenerDataHealth.js:196-197` | Salud de datos agregada | Sí, widget de salud |
| `lib/screenerExplainability.js:350-351` | Explicación textual de la fila | Sí |
| `lib/scanDecisionProjection.js:26,144` | Persistencia (`metrics.dataCoverageScore`, etc.) | No directo — es lo que las demás leen |

### B.8 Datos reales — cobertura de persistencia

Consulta exacta:
```
table=scan_results
select=symbol,created_at,metrics->>dataCoverageScore,metrics->>fundamentalCoverageScore,metrics->>rsQualityScore
filter=created_at=gte.2026-08-01T00:00:00Z
order=created_at.desc, limit=200
```
**200 filas devueltas (tope del límite), 0 con `dataCoverageScore` nulo.**
`fundamentalCoverageScore` toma valores 100/92/83/77/75 — todos múltiplos de
1/12 (92≈11/12, 83≈10/12, 75=9/12) o 1/13 con redondeo cercano, consistente
con que estas 200 filas son mayoritariamente cron (denominador 12, la lista
sin `ebitdaMargin`, antes de este fix). No pude distinguir con certeza,
mirando solo el número redondeado, cuántas de esas filas habrían dado un
valor distinto con la lista de 13 campos — la distinción exacta exigiría
`raw.growthMetrics.ebitdaMargin` fila por fila, fuera del alcance de esta
consulta acotada.

---

## PARTE C — El arreglo

**Sin impedimento → unificado.** Las tres funciones (`coveragePct`,
`priceFreshnessForDate`, `dataCoverageForRow`) se movieron a
`lib/dataCoverageShared.js` como fuente única, con la lista de 13 campos
(la del interactivo, más completa) para `fundamentalCoverageScore`. Ambos
archivos ahora importan en vez de definir localmente:

- `lib/researchRow.js`: las tres funciones se eliminaron; se añadió
  `coveragePct, dataCoverageForRow, priceFreshnessForDate` al import ya
  existente de `@/lib/dataCoverageShared`. El `export { ... }` final del
  archivo sigue re-exportando los mismos nombres (JS permite re-exportar un
  binding importado igual que uno local) — nada cambia para quien importaba
  `dataCoverageForRow`/`priceFreshnessForDate`/`coveragePct` desde
  `@/lib/researchRow` (confirmado: `app/page.jsx:29` y varios tests).
- `lib/materializedScanner.js`: mismo cambio. Se eliminó también la constante
  local `DEFAULT_PRICE_FRESHNESS_DAYS = 5`, sustituida por el import de
  `@/lib/screenerFilterCatalog` (mismo valor, `5`, que ya usaba
  `researchRow.js`) — una tercera duplicación pequeña que quedó resuelta
  como efecto colateral necesario (la función compartida necesita ese default
  en un solo sitio). Se añadió `dataCoverageForRow` al objeto `_forTest` ya
  existente (`lib/materializedScanner.js`, patrón ya usado para
  `buildResearchRow`/`sectorize`/`baseRejectReason`) para poder probarlo
  directamente.
- `lib/dataCoverageShared.js`: cabecera actualizada — ya no dice "kept local
  per call site"; documenta la unificación, las fechas de A.3 y por qué
  `ebitdaMargin` nunca fue una limitación de datos (A.4).

No hubo que decidir entre "la interactiva delega en la cron" o al revés en
el sentido de `weaknessScore` — aquí no hay motor vs. fórmula reducida, son
dos copias de la misma fórmula; la unificación es literal: una sola función,
dos importadores.

---

# 2. `rsQualityScore`

## PARTE A — Por qué existían dos (tres, en realidad)

### A.1 Las implementaciones, literales

Canónica, `lib/relativeStrength.js:243-289`:
```js
export function scoreRsQuality(row = {}) {
  const rs = rsPrimaryValue(row);
  if (!Number.isFinite(rs)) return null;
  let stability = 72;
  if (Number.isFinite(row.volatility63d)) { /* 5 tramos */ }
  if (Number.isFinite(row.maxDrawdown63d)) { /* 4 tramos */ }
  if (Number.isFinite(row.maxDailyMove20dPct)) { /* 4 tramos */ }
  if (Number.isFinite(row.range63dPct)) { /* 2 tramos */ }
  if (Number.isFinite(row.highsSpreadPct)) { /* 2 tramos */ }
  if (Number.isFinite(row.extSma50) && row.extSma50 > 28) stability -= 8;
  const rsQualityScore = clamp(rs * .62 + clamp(stability) * .28 + (Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45) * .1);
  const speculationRiskScore = clamp(
    Math.max(0, (Number.isFinite(row.volatility63d) ? row.volatility63d : 35) - 35) * .62 +
    Math.max(0, Number.isFinite(row.maxDrawdown63d) ? row.maxDrawdown63d : 12) * .85 +
    Math.max(0, (Number.isFinite(row.maxDailyMove20dPct) ? row.maxDailyMove20dPct : 8) - 10) * 1.35 +
    Math.max(0, (Number.isFinite(row.range63dPct) ? row.range63dPct : 45) - 80) * .22 +
    Math.max(0, (Number.isFinite(row.extSma50) ? row.extSma50 : 0) - 18) * .85 -
    (Number.isFinite(row.liquidityScore) ? row.liquidityScore : 45) * .12
  );
  return { rsQualityScore, rsStabilityScore: clamp(stability), speculationRiskScore, rsQualityLabel: /* ... */ };
}
```
`rsPrimaryValue(row) = firstFinite(row.rsGlobalPct, row.rsRating)`
(`lib/relativeStrength.js:95-97`). Necesita 8 términos:
`rsGlobalPct`/`rsRating`, `volatility63d`, `maxDrawdown63d`,
`maxDailyMove20dPct`, `range63dPct`, `highsSpreadPct`, `extSma50`,
`riskRewardScore`, `liquidityScore`.

`app/api/company-brief/route.js` tiene **dos** paralelas, no una:

**(1) `relativeStrengthFromBars`** (`route.js:276-348`, cálculo desde
`bars`/`benchmarkBars` puros, sin acceso a `scan_results`):
```js
const volatility63d = annualizedVolatility(bars, 63);
const maxDrawdown63d = maxDrawdown(bars, 63);
let stability = 72;
if (Number.isFinite(volatility63d)) { /* mismos 5 tramos que la canónica */ }
if (Number.isFinite(maxDrawdown63d)) { /* mismos 4 tramos */ }
const rsQualityScore = Number.isFinite(rating) ? clamp(rating * .68 + clamp(stability) * .32) : null;
const speculationRiskScore = clamp(Math.max(0, (Number.isFinite(volatility63d) ? volatility63d : 35) - 35) * .62 + Math.max(0, Number.isFinite(maxDrawdown63d) ? maxDrawdown63d : 12) * .85);
```

**(2) `mergeUniverseRelativeStrength`** (`route.js:858-899`, cuando SÍ hay
un snapshot de `scan_results` para el símbolo):
```js
const rating = universe.rsGlobalPct;
const rsQualityScore = clamp(rating * .68 + clamp(benchmarkStrength.rsStabilityScore ?? 72) * .32);
```

### A.2 Diferencias — tabla

| Elemento | Canónica (`relativeStrength.js`) | `relativeStrengthFromBars` | `mergeUniverseRelativeStrength` (antes del fix) |
|---|---|---|---|
| Fuente del "rating" | `rsGlobalPct ?? rsRating` | `rating` local (RS Benchmark desde bars) | `universe.rsGlobalPct` (percentil real del universo) |
| Peso rating/estabilidad | **.62 / .28** + riskReward .10 | **.68 / .32**, sin riskReward | **.68 / .32**, sin riskReward |
| Términos de estabilidad | volatility63d, maxDrawdown63d, maxDailyMove20dPct, range63dPct, highsSpreadPct, extSma50 (6) | volatility63d, maxDrawdown63d (2) | ninguno propio — reutiliza `benchmarkStrength.rsStabilityScore` (ya solo 2 términos, heredado de (1)) |
| `riskRewardScore` | Sí, .10 | No | No |
| `speculationRiskScore` | 5 términos + `liquidityScore` | 2 términos | 2 términos (heredado de (1), sin cálculo propio) |
| Resultado con los mismos rating/volatility/drawdown | referencia | **diferente** (menos términos, pesos distintos) | **diferente** (antes del fix) |

**Confirmado, dos formas**: por lectura literal de las fórmulas (pesos
`.62/.28/.10` vs `.68/.32`, término `riskRewardScore` presente en una y
ausente en las otras dos) y, para `mergeUniverseRelativeStrength`,
ejecutando ambas rutas sobre los mismos datos en el test nuevo (Parte D) —
`result.rsQualityScore` (antes del fix) y `scoreRsQuality(...).rsQualityScore`
no coincidían.

### A.3 ¿Cuál nació antes?

```
$ git log --oneline --follow -S "rsQualityScore" -- app/api/company-brief/route.js | tail -1
bae2d11 Initial StatsEdge checkpoint   (2026-05-16)

$ git log --oneline --follow -S "scoreRsQuality" -- lib/relativeStrength.js | tail -1
fbe8c03 Separate RS universe and benchmark metrics   (2026-05-20)
```
`company-brief`'s `rsQualityScore` **es el más antiguo del proyecto**: nació
en el primer commit (`bae2d11`, 16 de mayo), **cuatro días antes** de que
existiera la canónica (`fbe8c03`, 20 de mayo). Mismo patrón que
`weaknessScore` en `stockRows.js`: deuda histórica, no una divergencia
tomada después de que la canónica ya existiera.

### A.4 ¿Impedimento real? — Aquí SÍ, para una de las dos rutas

**Ciclo de imports: no, en ninguna de las dos.**
`app/api/company-brief/route.js` ya importaba `scoreRsBenchmarkModel` desde
`@/lib/relativeStrength` antes de esta tarea (`route.js:11`) — el módulo
canónico ya era una dependencia directa del archivo. Añadir `scoreRsQuality`
al mismo import no crea ningún ciclo (verificado: `lib/relativeStrength.js`
no importa nada de `app/api/company-brief/route.js`).

**Datos de entrada ausentes en el punto donde se invoca: depende de la ruta.**

- **`mergeUniverseRelativeStrength`: NO hay impedimento real.**
  `readUniverseRsSnapshot` (`route.js:817-829`, sin cambios en su consulta)
  ya trae `raw` y `metrics` **completos** de `scan_results`:
  ```sql
  select=created_at,scan_id,symbol,company_name,country,sector,industry,theme,
         total_score,weinstein_score,minervini_score,risk_score,rs_rating,
         metrics,raw
  ```
  Los 6 campos que faltaban (`riskRewardScore`, `liquidityScore`,
  `maxDailyMove20dPct`, `range63dPct`, `highsSpreadPct`, `extSma50`) **ya
  estaban en la respuesta de esa consulta**, dentro de `row.raw`/`row.metrics`
  — la función curada `readUniverseRsSnapshot` simplemente no los
  proyectaba al objeto de salida. Cero coste de red adicional para
  incluirlos.
- **`relativeStrengthFromBars`: SÍ hay impedimento real.** Esta función solo
  recibe `bars`/`benchmarkBars` (velas OHLC) — se usa quando NO existe un
  snapshot de `scan_results` para el símbolo (nunca escaneado). No tiene
  acceso a `riskRewardScore` (ni a `liquidityScore`), y ese campo **no es un
  dato simple** — es en sí mismo otra señal canónica completa
  (`SIGNAL_REGISTRY.riskRewardScore`, `lib/scoringEngine.js:234-269`) con sus
  propios inputs (`returnToVol3m`, `returnToDrawdown3m`, además de
  `volatility63d`, `maxDrawdown63d`, `maxDailyMove20dPct`, `range63dPct`,
  `perf3m`) que este archivo no calcula en ningún punto. `maxDailyMove20dPct`/
  `range63dPct` sí son técnicamente derivables de `bars` con las funciones
  puras `lib/indicators.js:86,89` (`maxDailyMovePct`, `priceRangePct`, ya
  existentes e importables) — pero `riskRewardScore` exigiría importar y
  ejecutar una segunda señal completa, no solo pasar un dato que falta.
  **Esto es el impedimento**: delegar aquí en la canónica no es "conectar un
  cable que falta", es "construir una pieza que no existe en este archivo".

### A.5 Consumidores y cuándo gana el valor "canónico" (Parte B)

`mergeUniverseRelativeStrength` ya tenía, antes de esta tarea, una prioridad
de facto: solo se ejecuta si `universe` existe y `universe.rsGlobalPct` es
finito (`route.js:860`, sin cambios):
```js
if (!universe || !Number.isFinite(universe.rsGlobalPct)) {
  return { ...benchmarkStrength, rating: null, ratingSource: "universe-missing", ... };
}
```
Cuando no hay `universe`, cae en `relativeStrengthFromBars` puro — el camino
que queda sin unificar (A.4). Es el mismo patrón conceptual que
"valor persistido gana, si no existe se recalcula" de `weaknessScore`, pero
aquí la señal de "existe" es `rsGlobalPct` del último scan, no un campo
`rsQualityScore` propio.

Consumidores (`grep` sobre `app`):
| Consumidor | Pantalla/endpoint | ¿Usuario lo ve? |
|---|---|---|
| `app/stock/[symbol]/StockClient.jsx:563,2010-2012` | `/stock/[symbol]` — ficha individual | Sí, directo: métrica "RS quality" con label/tono visual |
| `app/review/page.jsx:293` | `/review` | Sí, directo, como campo de la fila |

### B.8 Datos reales — cobertura de `rsQualityScore` en `scan_results`

Misma consulta que en la Parte 1 (B.8): de las 200 filas del
2026-08-01 en adelante, `rsQualityScore` es finito en ~90 y `null` en ~110
— corresponde a la cobertura de `rsGlobalPct`/percentil de universo en ese
momento (mismo mecanismo documentado en la sesión de trabajo anterior sobre
`scanPercentileFinalization`), no a un fallo de esta ruta. Este dato mide la
señal PERSISTIDA por el motor de scan (`scan_finalize_inputs`/percentiles),
no lo que calcula `company-brief` — se incluye porque el enunciado lo pide,
pero no cambia el diagnóstico de la Parte A (ver "LO QUE NO HE VERIFICADO").

---

## PARTE C — El arreglo

**`mergeUniverseRelativeStrength`: sin impedimento → unificado.**
`readUniverseRsSnapshot` ahora proyecta también `riskRewardScore`,
`liquidityScore`, `maxDailyMove20dPct`, `range63dPct`, `highsSpreadPct`,
`extSma50` desde `row.raw`/`row.metrics` (mismo patrón `firstFinite` que ya
usaba para los demás campos). `mergeUniverseRelativeStrength` ahora
construye una fila con `rsGlobalPct: universe.rsGlobalPct`, `rsRating:
benchmarkRating`, `volatility63d`/`maxDrawdown63d` de `benchmarkStrength`
(bars en vivo — más frescos que el snapshot, ver comentario en el código) y
el resto de `universe`, y llama a `scoreRsQuality(...)` directamente,
usando sus 4 salidas (`rsQualityScore`, `rsStabilityScore`,
`speculationRiskScore`, `rsQualityLabel`) en vez de recalcular solo una con
la fórmula `.68/.32`.

**`relativeStrengthFromBars`: PARO — impedimento real, no se toca.** Se dejó
la fórmula tal cual, con un comentario en el código
(`app/api/company-brief/route.js`, justo antes de `const rsQualityScore =
...`) explicando el impedimento exacto (A.4) para que quien lo lea después
no lo confunda con un descuido. `relativeStrengthFromBars` y
`mergeUniverseRelativeStrength` se exportaron (antes eran privadas del
módulo) para poder probarlas directamente — mismo patrón que
`computeListingDate`/`mergeChartHistory`, ya exportadas en el mismo archivo
con el comentario "Exportada para test unitario directo".

---

## PARTE D — Verificación

### D.12 `npm test` completo, salida literal (tras todos los cambios)

```
> test
> vitest run

 RUN  v4.1.8 /Users/alejandrofrutos1204/Documents/Codex/2026-05-13/estoy-desarrollando-un-screener-investment-research/Statsedge-v0.1

(node:18276) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.

 Test Files  98 passed (98)
      Tests  1302 passed | 8 skipped (1310)
   Start at  22:28:55
   Duration  14.37s (transform 5.95s, setup 0ms, import 15.08s, tests 23.63s, environment 12ms)
```
`EXIT=0`. Antes de añadir los tests nuevos, corrí la suite completa solo con
el cambio de `dataCoverageForRow` (96 archivos, 1297 tests, en verde) para
aislar que ese cambio por sí solo no rompía nada antes de seguir con
`rsQualityScore`.

### D.13 Tests nuevos

**`tests/dataCoverageForRowUnified.test.js`** (3 casos):
1. Las tres vías de acceso (`@/lib/dataCoverageShared`, `@/lib/researchRow`,
   `materializedScanner._forTest`) son la **misma referencia de función**
   (`toBe`), no solo el mismo resultado.
2. Con `ebitdaMargin` presente, las tres coinciden (100% — antes del fix
   también habrían coincidido en este caso concreto, documentado así en el
   test para no fingir una regresión donde no la había).
3. Con `ebitdaMargin` ausente y el resto de fundamentales presentes: las tres
   dan `fundamentalCoverageScore = 92` (12 de 13). Con el código viejo, la
   vía "cron" habría dado `100` (12 de 12, sin contar `ebitdaMargin`) — esta
   es la aserción que habría fallado antes del fix.

**`tests/companyBriefRsQualityScore.test.js`** (2 casos):
1. `mergeUniverseRelativeStrength` con `universe` disponible produce
   EXACTAMENTE el mismo `rsQualityScore`/`rsStabilityScore`/
   `speculationRiskScore`/`rsQualityLabel` que llamar a `scoreRsQuality`
   directamente con los mismos inputs — y se confirma que el número ya NO
   coincide con la fórmula vieja `.68/.32` (regresión concreta).
2. `relativeStrengthFromBars`, con 300 barras sintéticas, produce un
   `rsQualityScore` que **no** coincide con `scoreRsQuality` llamado con los
   mismos `rating`/`volatility63d`/`maxDrawdown63d` — la divergencia se
   afirma explícitamente como esperada (comentario en el test), no se
   oculta ni se fuerza a coincidir.

### D.14 Pantallas cuyo comportamiento visible cambia

**`dataCoverageForRow`** (efecto solo en filas nuevas del cron; el histórico
ya persistido no se recalcula):
- Cualquier símbolo cuyo `dataCoverageScore`/`fundamentalCoverageScore`
  quede cerca de un umbral (gate del cron en 40, filtros
  `minFundamentalCoverageScore` de los presets) puede empezar a incluirse o
  excluirse de forma distinta si le falta `ebitdaMargin`.
- `screenerDataHealth`, `decisionAudit`, `screenerExplainability` — el
  número/etiqueta de cobertura mostrado para filas del cron puede bajar
  ligeramente (nunca subir: añadir un campo más al denominador solo puede
  igualar o reducir el porcentaje).
- Todo esto **no aplica a filas del camino interactivo** (`/api/scan`),
  que ya incluían `ebitdaMargin` desde el 6 de julio.

**`rsQualityScore`** (solo cuando existe snapshot de `scan_results` para el
símbolo — la rama sin snapshot, bars-only, no cambia):
- `/stock/[symbol]` — métrica "RS quality" (valor y etiqueta) visible en la
  ficha individual.
- `/review` — mismo campo en la fila de revisión.
- El número puede subir o bajar según el símbolo (a diferencia de
  `dataCoverageForRow`, incluir `riskRewardScore` real no tiene una
  dirección garantizada — depende de si ese símbolo tiene buen o mal
  ratio riesgo/recompensa).

---

## CONFIANZA

- **Alta**: citas literales de ambas implementaciones de `dataCoverageForRow`
  (incluidos sus dos helpers) y de las tres versiones de `rsQualityScore` —
  lectura directa de código en `HEAD` antes de tocar nada.
- **Alta**: antigüedad relativa de las tres parejas de implementaciones —
  `git log --follow -S` sobre cada función/campo específico, con fechas de
  commit verificadas.
- **Alta**: ausencia de ciclo de imports en los tres casos — verificado
  listando imports existentes y confirmando que ya eran dependencias
  directas antes de esta tarea.
- **Alta**: que `ebitdaMargin` estaba disponible para el cron (A.4 de la
  parte 1) — verificado siguiendo la cadena `materializedScanner.js` →
  `lib/yahoo.js` directo, `researchRow.js`(vía `serverScanRunner.js`) →
  `lib/marketData.js` (fachada de caché pura, sin transformación) →
  `lib/yahoo.js` mismo origen.
- **Alta**: que `riskRewardScore`/`liquidityScore`/etc. ya estaban en la
  respuesta de `readUniverseRsSnapshot` antes de proyectarlos (A.4 de la
  parte 2) — la consulta SQL ya traía `raw`/`metrics` completos; confirmado
  leyendo la consulta literal.
- **Alta**: que `relativeStrengthFromBars` no puede delegar sin construir
  una segunda señal canónica completa (`riskRewardScore`) — verificado
  leyendo sus `requiredInputs` en `lib/scoringEngine.js:236` y confirmando
  que ninguno de esos inputs (`returnToVol3m`, `returnToDrawdown3m`) se
  calcula en `app/api/company-brief/route.js`.
- **Alta**: `npm test` completo en verde tras todos los cambios (98/98
  archivos, 1302/1302 tests, 8 skipped preexistentes) — salida literal
  pegada, ejecutado dos veces (antes y después de añadir los tests nuevos).
- **Media**: la lectura de B.8 (parte 1) sobre cuántas de las 200 filas
  muestreadas habrían divergido realmente con la lista vieja de 12 campos —
  el patrón de valores redondeados es consistente con 12 campos, pero no
  pude confirmarlo fila por fila sin consultar `raw.growthMetrics.ebitdaMargin`
  directamente (fuera del alcance de la consulta acotada usada).
- **Media**: el efecto de `dataCoverageForRow` en el gate del cron (D.14) —
  razonado desde el código (`baseRejectReason`), no observado en una
  ejecución real del cron (restricción dura: no ejecutar el cron).

## LO QUE NO HE VERIFICADO

- **Cuántos símbolos reales cambiarían de `dataCoverageScore` lo bastante
  como para cruzar el umbral de 40 del gate del cron** — necesitaría
  `raw.growthMetrics` fila por fila de producción, no solo el
  `dataCoverageScore` ya redondeado que consulté.
- **El efecto visual real en `/stock/[symbol]` y `/review`** — no arranqué
  el servidor de desarrollo ni tomé captura; el cambio se verificó por
  ejecución de tests unitarios sobre las funciones puras, no por inspección
  de la UI renderizada (restricción de la tarea: no se pidió verificación
  visual, y no hay símbolo real de prueba con `universe` disponible sin
  consultar producción de nuevo).
- **La relación exacta entre la cobertura de `rsQualityScore` en
  `scan_results` (B.8, parte 2) y la cobertura real de `mergeUniverseRelativeStrength`
  en producción** — son mecanismos relacionados pero no idénticos (uno mide
  lo que persiste el motor de scan; el otro es lo que calcula company-brief
  al vuelo a partir de ese mismo snapshot) y no crucé ambos con datos reales
  fila por fila.
- **Si existen más consumidores de `dataCoverageForRow`/`rsQualityScore`
  fuera de `app`/`lib`** (scripts, endpoints no listados) — el `grep` se
  limitó a esos dos directorios, igual que en el precedente de
  `weaknessScore`.
- **El comportamiento de `readUniverseRsSnapshot` con símbolos cuyo `raw`
  tenga `riskRewardScore`/`liquidityScore`/etc. genuinamente ausentes** (no
  solo el caso "todo presente" de mis tests) — no encontré una fila real
  así para probarla; el fallback de `scoreRsQuality`
  a sus propios valores neutros internos para esos términos (`45` para
  `riskRewardScore`, etc. — la MISMA discusión de constantes fabricadas de
  la tarea anterior de esta sesión) se hereda sin cambios, no se tocó aquí.
