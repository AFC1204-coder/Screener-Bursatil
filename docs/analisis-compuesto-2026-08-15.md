# El score compuesto — qué es, qué mide y qué decide

Fecha: 2026-08-15. BASE_SHA: `1825897`. Rama: `codex/statsedge-ui-polish`.

Tarea de análisis. No se modificó ningún archivo de código, no se escribió en
Supabase, no se ejecutó ningún escaneo, no se hizo commit ni push. El único
archivo creado es este.

Población medida: las **3.314 filas** del escaneo nocturno
`42545bfc-cb3f-4a46-ad74-5019fe2e65d7` ("Materialized scan US 2026-08-15",
`created_at` 2026-08-15T03:50:28Z, `row_count` 3314). Se descargaron las 3.314
(no una muestra) y se verificó el recuento.

---

## Resumen

1. La fórmula tiene **doce términos**. Uno de ellos, **IPO, vale cero en las
   3.314 filas** y en las de todos los escaneos revisados, porque el dato del
   que depende (`ipoDate`/`ipoAgeMonths`) no existe en ninguna fila. No se
   excluye del promedio: **resta**. Mediana 1,15 puntos; 287 filas (8,7%)
   cambiarían de etiqueta sin él.
2. Los componentes que salen como "–" en la ficha **sí entraron en el
   cálculo**. Lo que falla no es el cálculo: es que la fila guardada no los
   conserva (proyección ligera), y el desglose de la ficha, al no encontrarlos,
   los pinta como ausentes y les asigna +0,0. El score que muestra la fila no se
   puede reconstruir con lo que la fila enseña. Afecta al **99,1%** de las filas.
3. rsGlobalPct **sigue sin ser comparable** con la población ampliada. El mismo
   día, mismo símbolo, mismo cierre: AAPL vale **52** en el nocturno (muestra
   3.314) y **65** en el escaneo de servidor de esa mañana (muestra 5.838).
   Sistemático en los siete símbolos comprobados. La premisa de que "3.314 filas
   lo estabilizan" no se sostiene, entre otras cosas porque el percentil **ya se
   calculaba sobre ~3.300**: lo que cambió anoche es cuántas filas se *guardan*,
   no sobre cuántas se *calcula*.
4. Quitar los componentes sin dato apenas mueve el orden global (Spearman 0,986)
   pero **destroza la cabeza**: del top 10 solo coinciden 4. Como el usuario solo
   mira la cabeza, la respuesta correcta a la pregunta 10 es la incómoda: no son
   decorativos, y deciden con datos que la fila no tiene.
5. Tres de los doce términos son casi el mismo dato: rsAnchor, rsQualityScore y
   momentumScore correlacionan a ρ = 0,93. Suman el 24% del peso.

---

# PARTE A — Qué es exactamente

## 1. La fórmula completa

### 1.1 Los pesos

Cita literal, `lib/scoringEngine.js:633-646`:

```js
export const COMPOSITE_WEIGHTS = [
  { key: "setupQualityScore", weight: 0.17 },
  { key: "rsAnchor",          weight: 0.16 },
  { key: "rsQualityScore",    weight: 0.06 },
  { key: "demandScore",       weight: 0.10 },
  { key: "adProxyScore",      weight: 0.08 },
  { key: "growthScore",       weight: 0.08 },
  { key: "epsAnchor",         weight: 0.08 },
  { key: "sectorScore",       weight: 0.10 },
  { key: "riskRewardScore",   weight: 0.08 },
  { key: "riskScore",         weight: 0.05 },
  { key: "momentumScore",     weight: 0.02 },
  { key: "ipoScore",          weight: 0.02 },
];
```

### 1.2 El cálculo

Cita literal, `lib/scoringEngine.js:764-806` (`computeCompositeDetailed`):

```js
  let weightedSum = 0;
  let presentWeight = 0;
  let missing = 0;
  for (const { key, weight } of COMPOSITE_WEIGHTS) {
    const v = values[key];
    if (Number.isFinite(v)) {
      weightedSum += v * weight;
      presentWeight += weight;
    } else {
      missing++;
    }
  }
  if (missing === 0) {
    return { value: weightedSum, coverage: 1, partial: false };
  }
  if (presentWeight <= 0) {
    return { value: 0, coverage: 0, partial: true };
  }
  return {
    value: weightedSum / presentWeight,
    coverage: presentWeight / COMPOSITE_TOTAL_WEIGHT,
    partial: true,
  };
```

Y la firma, `lib/scoringEngine.js:764-777` — nótese el último parámetro:

```js
function computeCompositeDetailed({
  setupQualityScore, rsAnchor, rsQualityScore, demandScore, adProxyScore,
  growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore,
  momentumScore,
  ipoScore = 0,
} = {}) {
```

`ipoScore = 0` es un valor por defecto de parámetro. Se activa cuando el
argumento llega como `undefined` — que es exactamente lo que ocurre en el
escaneo nocturno (punto 5). Como `Number.isFinite(0) === true`, ese cero **no se
excluye**: entra en la suma y su peso cuenta como presente.

### 1.3 De dónde sale cada entrada

| Término | Peso | Origen | Fallback antes de entrar |
|---|---|---|---|
| `setupQualityScore` | 0,17 | `SIGNAL_REGISTRY.setupQualityScore` (`scoringEngine.js:433-449`): setup objetivo + contribución de patrón − 12 si hubo ruptura fallida | ninguno en el cron |
| `rsAnchor` | 0,16 | **no es una señal del motor**: se compone en el llamador | `rsGlobalPct` → `rsRating` → `50` |
| `rsQualityScore` | 0,06 | `scoreRsQuality` (`lib/relativeStrength.js:243`), calculado **sobre `rsGlobalPct`** | → `rsAnchor` |
| `demandScore` | 0,10 | `SIGNAL_REGISTRY.demandScore` (`scoringEngine.js:450-475`); su primer bloque de puntos **también usa `rsGlobalPct`** vía `rsPrimaryValue(r) ?? 50` | ninguno |
| `adProxyScore` | 0,08 | `SIGNAL_REGISTRY.adProxyScore`, base 45 ± volumen up/down | ninguno |
| `growthScore` | 0,08 | `SIGNAL_REGISTRY.growthScore`; devuelve `null` si no hay ningún fundamental | ninguno |
| `epsAnchor` | 0,08 | `epsGrowthProxyScore` → `growthScore` | encadenado |
| `sectorScore` | 0,10 | `sectorScoreForGroup` (`lib/screenerComposite.js:93-105`) | 40 si no hay grupo |
| `riskRewardScore` | 0,08 | `SIGNAL_REGISTRY.riskRewardScore` | **45** (`materializedScanner.js:330`) |
| `riskScore` | 0,05 | `SIGNAL_REGISTRY.riskScore` | ninguno |
| `momentumScore` | 0,02 | `SIGNAL_REGISTRY.momentumScore` (perf 3M/6M/12M por tramos) | ninguno |
| `ipoScore` | 0,02 | `SIGNAL_REGISTRY.ipoScore` — **no se invoca en el cron** | `0` por defecto de parámetro |

El ensamblaje en el escaneo nocturno, cita literal
`lib/materializedScanner.js:330-337`:

```js
    const riskRewardScore = Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45;
    const rsAnchor = Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : (row.rsRating || 50);
    const rsQuality = scoreRsQuality({ ...row, riskRewardScore });
    const rsQualityScore = Number.isFinite(rsQuality?.rsQualityScore) ? rsQuality.rsQualityScore : rsAnchor;
    const epsAnchor = Number.isFinite(epsGrowthProxyScore) ? epsGrowthProxyScore : growthScore;
    const objectiveScore = scoreCompositeValue({ setupQualityScore: objectiveSetupScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: row.riskScore, momentumScore: row.momentumScore });
    const composite = computeCompositeWithCoverage({ setupQualityScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: row.riskScore, momentumScore: row.momentumScore });
```

Las dos llamadas pasan **once** argumentos. `ipoScore` no aparece.

**Verificación de que esta lectura es correcta** (medición, no estimación): se
reprodujo la fórmula sobre las 31 filas del nocturno que conservan todos los
campos y se comparó con el valor persistido.

```
max |recalculado − totalScore persistido|     = 0.0000000000
max |recalculado − objectiveScore persistido| = 0.0000000000
```

Error exactamente cero en las 31 filas, tratando `ipoScore` ausente como 0. La
fórmula documentada arriba es la que produjo los números que hay en producción.

## 2. Los tres nombres

No hay tres compuestos: hay **dos números y un alias**.

| Nombre | Qué es | Dónde se calcula |
|---|---|---|
| `objectiveScore` | El compuesto con **`objectiveSetupScore`** en el primer término: setup **sin** el bonus de patrón/VCP | `materializedScanner.js:335`, `screenerPipeline.js:366` |
| `compositeScore` | El mismo compuesto con **`setupQualityScore`**: setup **con** el bonus de patrón | `materializedScanner.js:336`, `screenerPipeline.js:367` |
| `totalScore` | **Alias literal de `compositeScore`.** Cita: `totalScore: compositeScore` (`screenerPipeline.js:385`) y `totalScore: compositeScore, compositeScore,` (`materializedScanner.js:354-355`) | — |

Los dos difieren **solo** en el primer término. Diferencia medida en las 31
filas completas del nocturno: entre 0,00 y 2,69 puntos (el 0,17 × la diferencia
entre el setup con y sin bonus de patrón).

Existe un cuarto número, `legacyTotalScore` (`screenerPipeline.js:365`), con
trece términos y pesos distintos. **Solo lo produce el escaneo interactivo, y su
único consumidor es una columna del CSV de exportación** (`app/page.jsx:1699`).
No ordena nada.

**Cuál ordena qué** (esto responde a la pregunta de si alguno sobra):

- La **tabla de siete columnas: ninguno**. `defaultSortForSettings`
  (`screenerPipeline.js:92-94`) devuelve `DEFAULT_PERFORMANCE_PERIOD`
  (= `"perf3m"`) o `weaknessScore`. Y el desplegable de orden solo ofrece las
  columnas visibles — comentario literal en
  `app/components/screener/ResultFilterBar.jsx:73`: *"Ordenar solo por lo que
  la tabla muestra"*.
- Las **Listas**: `objectiveScore`, vía `objectiveMetric(row)`
  (`lib/leaderboards.js:112-114`), que resuelve
  `objectiveScore ?? totalScore ?? compositeScore`. Entra en tres sitios: la
  puerta `minTotalScore` (`:402`), los umbrales de pertenencia de cada
  estrategia (`total >= 45/50/55`, `:410-434`) y el peso del orden
  (`strategyScore`, `:436-471`, entre 0,14 y 0,38 según estrategia; en la
  estrategia `composite` es el 100%). Además desempata el orden final (`:635`).
- **Qué filas se guardan cada noche**: `byScore` ordena por
  `objectiveScore ?? totalScore` y recorta (`materializedScanner.js:1714`,
  `:1742`).
- **Elegibilidad para ranking**: `objectiveScore >= 45` (`lib/coveragePlan.js:122`).
- **Puerta de régimen de mercado**: umbrales 60 / 72 / 82 (`lib/scoring.js:153-157`).

**¿Sobra alguno?** Sí: `totalScore` es una copia byte a byte de
`compositeScore`, y `legacyTotalScore` no se usa para nada salvo una columna de
CSV. Los dos que hacen trabajo real son `objectiveScore` y `compositeScore`, y
el producto en la práctica solo consume el primero.

---

# PARTE B — Cuántos componentes tienen dato de verdad

## 3. Presencia por componente en las 3.314 filas

**Cómo se obtuvieron los datos.** Consulta base (PostgREST, solo lectura),
paginada por rangos alfabéticos de `symbol` hasta cubrir los 3.314 símbolos
únicos:

```
table=scan_results
select=symbol,metrics
filter=scan_id=eq.42545bfc-cb3f-4a46-ad74-5019fe2e65d7&symbol=gte.<A>&symbol=lt.<B>
order=symbol.asc
limit=200
```

Rangos usados: `< APLD`, `APLD–B`, `B–BM`, `BM–C`, `C–CM`, `CM–D`, `D–EM`,
`EM–F`, `F–FSBC`, `FSBC–G`, `G–HM`, `HM–J`, `J–LM`, `LM–MM`, `MM–NUE`, `NUE–O`,
`O–PLSE`, `PLSE–PS`, `PM–RM`, `RM–SG`, `SG–T`, `T–U`, `U–W`, `>= W`. Recuento
final: 3.314 símbolos distintos, igual a `scans.row_count`.

Consulta auxiliar para separar filas completas de ligeras:

```
table=scan_results
select=symbol
filter=scan_id=eq.42545bfc-cb3f-4a46-ad74-5019fe2e65d7&metrics->>screenPassed=eq.true
order=symbol.asc&limit=200
→ 31 filas
```

**Resultado (medición sobre la población completa):**

| Componente | Peso | Con dato en la fila | Sin dato | En las 31 completas | En las 3.283 ligeras |
|---|---|---|---|---|---|
| `setupQualityScore` | 0,17 | 31 (0,9%) | **99,1%** | 31/31 | **0/3283** |
| `rsGlobalPct` (rsAnchor) | 0,16 | 3.314 (100%) | 0% | 31/31 | 3283/3283 |
| `rsQualityScore` | 0,06 | 3.314 (100%) | 0% | 31/31 | 3283/3283 |
| `demandScore` | 0,10 | 31 (0,9%) | **99,1%** | 31/31 | **0/3283** |
| `adProxyScore` | 0,08 | 3.314 (100%) | 0% | 31/31 | 3283/3283 |
| `growthScore` | 0,08 | 31 (0,9%) | **99,1%** | 31/31 | **0/3283** |
| `epsGrowthProxyScore` (epsAnchor) | 0,08 | 3.311 (99,9%) | 0,1% | 31/31 | 3280/3283 |
| `sectorScore` | 0,10 | 3.314 (100%) | 0% | 31/31 | 3283/3283 |
| `riskRewardScore` | 0,08 | 3.314 (100%) | 0% | 31/31 | 3283/3283 |
| `riskScore` | 0,05 | 3.314 (100%) | 0% | 31/31 | 3283/3283 |
| `momentumScore` | 0,02 | 3.314 (100%) | 0% | 31/31 | 3283/3283 |
| `ipoScore` | 0,02 | **0 (0,0%)** | **100%** | **0/31** | **0/3283** |

### 3.1 Por qué faltan tres componentes en el 99,1% de las filas

**No es falta de dato: es la proyección de guardado.** Las filas que no pasan el
preset se guardan con `scanLightMetrics`, que copia una lista cerrada de campos
(`lib/scanLightProjection.js:131-138`). `setupQualityScore`, `demandScore` y
`growthScore` **no están en esa lista**; `adProxyScore`, `epsGrowthProxyScore`,
`sectorScore`, `riskRewardScore`, `riskScore`, `momentumScore`, `rsGlobalPct`,
`rsQualityScore`, `objectiveScore`, `totalScore` e `ipoScore` sí.

Comprobación de que tampoco están en `raw`:

```
table=scan_results
select=symbol,raw->>demandScore,raw->>setupQualityScore,raw->>growthScore,raw->>ipoScore,raw->>objectiveSetupScore
filter=scan_id=eq.42545bfc-cb3f-4a46-ad74-5019fe2e65d7&symbol=in.(AAPL,ACHV,AIT,PLTR)
```

| símbolo | tipo | demand | setup | growth | ipo | objectiveSetup |
|---|---|---|---|---|---|---|
| AAPL | ligera | null | null | null | null | null |
| PLTR | ligera | null | null | null | null | null |
| ACHV | completa | 100 | 91.16 | 20 | **null** | 83 |
| AIT | completa | 74.576 | 100 | 68 | **null** | 95 |

### 3.2 Pero sí entraron en el cálculo — demostración

El score persistido de una fila ligera **no se puede explicar sin ellos**.
Despejando el bloque que falta de la identidad de la fórmula, para las 3.280
filas ligeras con `epsGrowthProxyScore`:

```
bloque = totalScore − (0,16·rsAnchor + 0,06·rsQuality + 0,08·adProxy
                       + 0,08·eps + 0,10·sector + 0,08·riskReward
                       + 0,05·risk + 0,02·momentum + 0,02·0)
       = 0,17·setup + 0,10·demanda + 0,08·growth

min = 5,138 (METCB)   mediana = 21,842   max = 33,701 (RELY)
rango teórico si los tres valen entre 0 y 100: [0 ; 35]
filas fuera de ese rango: 0 de 3.280
```

Los tres términos entraron con valores reales y coherentes (mediana 21,84 sobre
un máximo posible de 35). El cálculo los usó; **la fila no los conserva**.

### 3.3 La consecuencia: el desglose de la ficha no puede cuadrar

El desglose que ve el usuario lo produce `buildScreenerScoreAudit`
(`lib/screenerScoreAudit.js:112-163`). Su regla de imputación, cita literal
(`:117`):

```js
    const points = Number.isFinite(source.value) ? source.value * item.weight : 0;
```

Es decir: **el desglose asigna 0 puntos a lo que no encuentra**, mientras el
motor renormaliza. El propio módulo mide la diferencia y la llama `residual`
(`:130-132`):

```js
  const calculatedScore = components.reduce((sum, item) => sum + item.points, 0);
  const displayedScore = fieldValue(row, "totalScore") ?? fieldValue(row, "compositeScore");
  const residual = Number.isFinite(displayedScore) ? displayedScore - calculatedScore : null;
```

Para una fila ligera ese residual es el bloque de 3.2: **mediana 21,8 puntos**.
El umbral de alarma del propio módulo es 4 (`:146`, `:208`), así que el 100% de
las filas ligeras entra en el estado "Revisar fórmula". Lo que el usuario vio
—"Demanda –, +0,0"— no es un componente vacío: es un componente que sí pesó y
que la ficha no puede ver.

## 4. Un componente ausente, ¿suma cero o se excluye?

**Depende de por dónde pase la fila, y hay tres comportamientos distintos.**

**(a) Se excluye y se renormaliza** — cuando el valor llega como `null`/`NaN` a
`computeCompositeDetailed`. Es el caso de `growthScore` cuando no hay ningún
fundamental (`scoringEngine.js:502`: `if (!values.some(Number.isFinite)) return null;`)
y de `epsAnchor` cuando hereda esa ausencia.

**(b) Se sustituye por una constante antes de llegar** — el motor nunca ve la
ausencia, así que no puede excluirla:

```js
const riskRewardScore = Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45;   // materializedScanner.js:330
const rsAnchor = Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : (row.rsRating || 50); // materializedScanner.js:331
```

y `sectorScore` con su `defaultScore` de 40 (`screenerComposite.js:148`).

**(c) Suma cero sin excluirse** — `ipoScore`. El argumento no se pasa, el
default de parámetro lo convierte en `0`, `Number.isFinite(0)` es cierto, y por
tanto `missing` sigue valiendo 0 y **no hay renormalización**.

**Verificación con datos.** Si (c) no fuera cierto, el recálculo de las 31 filas
completas tratando `ipoScore` como excluido no daría el valor persistido. Se
comprobó: tratándolo como `0` presente, el error es 0,0000000000 en las 31
filas. Tratándolo como excluido, todas las filas darían un valor 1/0,98 mayor.

**Nota sobre el otro camino.** El escaneo de servidor (`scanPercentileFinalization.js:291-316`)
ya fue corregido para pasar `null` en vez de constantes, con una excepción
declarada para `rsAnchor` — pero **ese camino no es el que produce el nocturno**.
Cita literal, `lib/screenerComposite.js:55-58`:

```
// CRON: este helper también lo consume lib/materializedScanner.js, pero la
// finalización no se ejecuta en el cron (ADR fase 3 lo deja fuera de scope).
```

Verificado en datos: las filas del nocturno no llevan `percentileScope`; las del
escaneo de servidor del mismo día llevan `percentileScope: "final"`.

## 5. Componentes que no están midiendo nada

**`ipoScore` — 100% ausente. No mide nada en ningún escaneo.**

- El cron no lo calcula (no aparece en las llamadas de
  `materializedScanner.js:335-336`). Ya estaba documentado en el propio motor
  (`scoringEngine.js:15-19`): *"`lib/materializedScanner.js` NO la invoca:
  `row.ipoScore` queda undefined"*.
- El escaneo de servidor **sí** lo calcula, y da 0 igualmente:

```
table=scan_results
select=symbol,metrics->>ipoScore,metrics->>ipoDate,metrics->>ipoAgeMonths
filter=scan_id=eq.bed4bf79-d385-4470-95ef-8faa321c8afa&metrics->>ipoScore=neq.0
→ [] (cero filas con ipoScore distinto de 0)
```

- La razón es el dato de origen: en las 3.314 filas del nocturno,
  **`ipoDate` no vacío: 0; `ipoAgeMonths` finito: 0**. Y `scoreIpo` empieza con
  `if (!Number.isFinite(m) || m < 0 || m > 60) return 0;` (`scoringEngine.js:361`).

**Efecto medido de ese cero:**

```
penalización mediana = 1,146 puntos (score/0,98 − score)   máx = 1,761
filas que cambian de etiqueta si se excluye: 287 / 3.314 (8,7%)
```

No cambia el orden (es un factor constante), pero **comprime todos los scores un
2% hacia abajo** y mueve 287 filas de banda (`compositeLabel`, umbrales
85/75/65/55 en `scoringEngine.js:831-837`).

**`sectorScore` — presente al 100%, pero casi constante.** Toma **14 valores
distintos** en 3.314 filas (uno por grupo temático), rango 10–80, desviación
típica 11,7 frente a 21–30 del resto. Con peso 0,10 aporta el **5,6%** de la
dispersión del compuesto. No es ruido, pero por cada punto de peso rinde la
mitad que cualquier otro término.

**Dispersión medida de cada componente sobre las 3.314 filas:**

| Componente | n | mín | mediana | máx | valores distintos | sd |
|---|---|---|---|---|---|---|
| `rsGlobalPct` | 3314 | 1,00 | 50,00 | 99,00 | 99 | 28,57 |
| `rsQualityScore` | 3314 | 4,82 | 61,66 | 96,28 | 2145 | 21,36 |
| `adProxyScore` | 3314 | 2,00 | 57,00 | 100,00 | 83 | 18,37 |
| `epsGrowthProxyScore` | 3311 | 0,00 | 53,00 | 100,00 | 100 | 24,50 |
| `sectorScore` | 3314 | 10,00 | 60,58 | 80,00 | **14** | 11,74 |
| `riskRewardScore` | 3314 | 0,00 | 54,00 | 100,00 | 95 | 29,55 |
| `riskScore` | 3314 | 18,00 | 80,00 | 100,00 | 25 | 26,26 |
| `momentumScore` | 3314 | 0,00 | 36,00 | 100,00 | 32 | 30,10 |
| `ipoScore` | **0** | — | — | — | **0** | **0,00** |

---

# PARTE C — La entrada no comparable

## 6. Sigue entrando, y pesa más de lo que parece

`rsGlobalPct` es la primera opción de `rsAnchor`, **peso 0,16**. Pero su
influencia real es mayor, porque otros dos términos se calculan sobre él:

- `rsQualityScore` (**0,06**) — `scoreRsQuality` usa `rsPrimaryValue(row)`, que
  es `rsGlobalPct ?? rsRating` (`relativeStrength.js:96`, `:244`). El propio
  repo ya lo documenta: *"El que viaja en las filas de scan_results está
  calculado sobre el percentil del lote"* (`lib/rsCanonical.js:36-40`).
- `demandScore` (**0,10**) — su primer bloque de puntos, hasta 34 de ~100, sale
  de `const rs = rsPrimaryValue(r) ?? 50;` (`scoringEngine.js:456-460`).

**Peso directamente atado al percentil de lote: 0,22. Peso parcialmente atado:
otro 0,10.**

## 7. ¿Es estable con la población completa? No

**Primero, un matiz sobre la premisa.** El percentil no se calculaba sobre 75
símbolos: se calculaba sobre toda la población analizada, y solo se *guardaban*
75 filas. Verificado:

```
table=scan_results
select=symbol,metrics->>rsGlobalPct,metrics->>rsGlobalSample,metrics->>rsRating,metrics->>objectiveScore
filter=scan_id=eq.8c2b05dd-e9ef-483d-9fa4-5599ebeb49a5      (nocturno del 2026-08-13, row_count=75)
→ las 75 filas traen rsGlobalSample = 3317
```

Es decir: la muestra del nocturno pasó de **3.317** (13 de agosto, 75 filas
guardadas) a **3.314** (15 de agosto, 3.314 filas guardadas). Lo que cambió
anoche es la persistencia, no la base del percentil. **La ampliación no podía
arreglar este problema porque el problema no era el tamaño de la muestra
guardada.**

**Segundo, la prueba directa.** Comparación del mismo símbolo, el **mismo día**
(2026-08-15), entre el nocturno y los escaneos de servidor de esa mañana:

```
table=scan_results
select=symbol,scan_id,metrics->>rsGlobalPct,metrics->>rsGlobalSample,metrics->>rsRating,metrics->>objectiveScore
filter=scan_id=in.(bed4bf79-…,9ec25341-…,42545bfc-…)&symbol=in.(AAPL,PLTR,PLUG,PLUS,NVDA,MSFT,TSLA)
```

| símbolo | rsGlobalPct (n=3.314) | rsGlobalPct (n=5.838) | Δ | rsRating (n=3.314 / n=5.838) |
|---|---|---|---|---|
| AAPL | 52 | 65 | **+13** | 56 / 57 |
| NVDA | 52 | 65 | **+13** | 56 / 57 |
| MSFT | 60 | 71 | **+11** | 55 / 55 |
| PLTR | 70 | 78 | **+8** | 60 / 60 |
| PLUS | 45 | 59 | **+14** | 50 / 51 |
| PLUG | 13 | 26 | **+13** | 48 / 48 |
| TSLA | 8 | 21 | **+13** | 29 / 30 |

Siete de siete se desplazan, todos en la misma dirección, entre 8 y 14 puntos.
El mismo día y con el mismo cierre. El otro RS de la fila (`rsRating`, calculado
contra un benchmark y no contra el lote) se mueve como mucho 1 punto.

El efecto arrastra al compuesto: AAPL pasa de `objectiveScore` 62,81 a 64,07 —
1,26 puntos por el tamaño y composición del lote, no por el mercado.

**Por qué ocurre.** El percentil es la posición dentro de lo que se escaneó esa
vez (`relativeStrength.js:224-241`), y `percentileFromSorted` divide por
`sorted.length` (`:192-201`). El escaneo de servidor incluía mercados europeos
(`settings.markets: ['FI','DK',…]`), cuya distribución empuja a los valores
estadounidenses hacia arriba. No es solo tamaño: es **composición**. Dos
escaneos con el mismo número de filas pero distinto reparto de mercados darían
también números distintos.

**Conclusión de C.7:** la auditoría de filtros
(`docs/auditoria-filtros-2026-08-13.md`) sigue vigente palabra por palabra.
Guardar 3.314 filas no cambió nada del problema.

## 8. ¿Debería el compuesto usar el RS canónico?

Lo que declara el módulo, cita literal `lib/rsCanonical.js:14-18`:

```
//   2. `scan_results.rsGlobalPct` — percentil del símbolo DENTRO del lote de
//      un escaneo concreto. Puede calcularse sobre 50 símbolos o sobre 9.916,
//      cambia con cada escaneo y no es comparable con nada. Sigue existiendo
//      y sigue alimentando el scoring (no se toca), pero NO es el RS y no
//      puede mostrarse bajo esa etiqueta.
```

Tiene sentido conceptual: hoy la tabla ordena y pinta el RS semanal
(`sortMetric` → `canonicalRsSortValue`, `screenerPipeline.js:83`) mientras el
compuesto que decide las Listas usa otro número que nadie ve. Pero hay cuatro
contrapartidas medidas:

**(a) Cobertura: se perdería un 7% de las filas.** Muestreo sistemático de 150
símbolos del nocturno (uno de cada 22, ordenados por `objectiveScore`, para
cubrir todo el rango):

```
table=rs_weekly_items
select=symbol
filter=snapshot_id=eq.8c42021d-…&symbol=in.(<los 150>)
→ 140 de 150 presentes (93,3%)
sin RS semanal: AGCC, AMBQ, AXIN, BRNX, BTQ, ELVR, GIW, NAVN, SBET, SOLS
```

Con el principio 3 (nada por defecto), esas filas se quedarían con un compuesto
renormalizado sobre el 84% del peso, o sin compuesto. Hay que decidirlo
explícitamente, no dejarlo al fallback.

**(b) El canónico también depende de la corrida.** La misma semana `2026-W32`
tiene **tres snapshots** en la tabla, con poblaciones distintas y ratings muy
distintos para el mismo símbolo:

```
table=rs_weekly_items
select=symbol,week_key,snapshot_id,snapshot_date,sample_size,rank_index,rs_rating,created_at
filter=symbol=in.(AAON,GSHD,BETR)&week_key=eq.2026-W32
```

| símbolo | 2026-08-07 (n=4.865) | 2026-08-08 (n=4.217) | 2026-08-09 (n=4.868) |
|---|---|---|---|
| AAON | 44 | **86** | 44 |
| GSHD | 63 | **8** | 63 |
| BETR | 7 | **57** | 7 |

El lector siempre coge el más reciente (`order=symbol.asc,snapshot_date.desc` y
se queda con la primera fila, `lib/globalRs.js:107-112`), así que **el producto
es determinista**; pero la propiedad "comparable entre valores" descansa en que
todas las filas se lean del mismo snapshot, y eso hoy no está garantizado por
contrato, solo por el orden de la consulta.

**(c) Latencia.** El snapshot más reciente es del **2026-08-09** para un escaneo
del 15: entre 6 y 8 días de retraso frente a un percentil que se calcula con el
cierre del día anterior. Para un compuesto que ordena listas diarias es un
cambio de naturaleza, no solo de fuente.

**(d) Hay una alternativa más barata en la propia fila.** `rsRating` (fuerza
frente al benchmark) ordena casi igual que el percentil de lote —
**Spearman = 0,963** sobre las 3.314 filas — y **no depende del lote** (se movió
como mucho 1 punto entre escaneos con muestras de 3.314 y 5.838). Ya está
persistido en el 100% de las filas y ya es el segundo eslabón de `rsAnchor`.

**Recomendación de C.8:** el candidato natural a sustituir a `rsGlobalPct` en la
fórmula no es el RS semanal, sino **`rsRating`**: misma disponibilidad, mismo
orden, sin dependencia del lote y sin latencia añadida. El RS semanal es el
número correcto para *enseñar*; para *puntuar* a diario, su retraso y su 7% de
huecos son un coste que hoy no hace falta pagar.

---

# PARTE D — El efecto real

## 9. Reordenar quitando lo que no tiene dato

Escenario A: orden actual, por `objectiveScore` persistido.
Escenario B: compuesto con **solo los ocho componentes que la fila conserva con
dato** (rsAnchor 0,16 · rsQuality 0,06 · A/D 0,08 · EPS 0,08 · grupo 0,10 ·
rent/riesgo 0,08 · riesgo 0,05 · momentum 0,02), renormalizados sobre 0,63.
Escenario C: el actual quitando solo el término IPO.

```
n = 3.314

Spearman(A, B) = 0,9864
Spearman(A, C) = 1,000000

|Δ posición| A vs B:  mediana = 94   p90 = 265   máx = 665   (sobre 3.314)

coincidencias en cabeza:
  top  10:  4/10  (40%)
  top  25: 14/25  (56%)
  top  50: 34/50  (68%)
  top 100: 74/100 (74%)
  top 200: 158/200 (79%)

|A − B| en puntos: mediana 1,81   p90 4,44
cambian de banda (Elite/Leader/Fuerte/Watchlist/Revisar): 437/3.314 (13,2%)
cruzan los umbrales de las Listas: 112 filas (≥45), 140 (≥50), 146 (≥55)
```

Movimiento en la cabeza:

| top 10 actual | puesto en B | | entra en top 10 de B | puesto en A |
|---|---|---|---|---|
| GEO | 3 | | BWFG | 12 |
| ENVA | 7 | | RDVT | **41** |
| FTNT | 2 | | KRT | 15 |
| HNGE | 12 | | RVMD | 13 |
| DXCM | **49** | | LGND | 16 |
| LTH | 21 | | MSBI | 23 |
| NHC | **50** | | | |
| APGE | 10 | | | |
| ABNB | **73** | | | |
| BBVA | 45 | | | |

## 10. Qué significa

**Las dos respuestas a la vez, y hay que separarlas por componente:**

- **El término IPO es decorativo en el orden y dañino en el valor.** Spearman
  1,000000: no mueve ni una posición. Pero comprime todos los scores un 2% y
  reetiqueta 287 filas. Es exactamente lo que describe el encargo: ruido
  constante.
- **Setup, demanda y growth no son decorativos: deciden.** El orden global se
  mantiene (0,986) porque los tres correlacionan con el resto, pero **en la
  cabeza — lo único que el usuario mira — seis de los diez primeros son otros**.
  Y ABNB pasa del puesto 9 al 73.

Que decidan no sería un problema si el dato estuviera. El problema es el de la
Parte B: **deciden con valores que la fila guardada no contiene**, así que ni el
usuario ni la ficha ni una auditoría posterior pueden comprobar por qué ABNB es
noveno. El score es reproducible solo en el instante del escaneo, en memoria.

---

# PARTE E — La propuesta

## 11. Qué hacer

Cuatro cambios, en orden de coste creciente. Los tres primeros son
independientes entre sí.

**(1) Quitar el término IPO de la fórmula.** No de la señal: del compuesto. Mide
cero en el 100% de las filas de todos los escaneos, y su único efecto es restar
un 2% a todo el mundo y mover 287 etiquetas. Si algún día `ipoDate` se puebla,
volver a añadirlo es una línea. Mientras tanto, un peso de 0,02 sobre un valor
que siempre vale 0 no es un componente: es una constante multiplicativa
disfrazada.

**(2) Persistir los tres componentes que hoy se calculan y se tiran.**
`setupQualityScore`, `demandScore` y `growthScore` son tres números por fila:
del orden de 70 B de JSON con sus claves, frente a los 7.233 B que ya ocupa la
fila ligera — **en torno al 1% más** (estimación aritmética, no medida). Sin
ellos, el 99,1% de las filas tiene un score que no se puede explicar, el
desglose de la ficha miente por construcción y el propio módulo de auditoría
marca todas las filas como "Revisar fórmula". Con ellos, el residual del
desglose baja de 21,8 a ~0 y la ficha deja de enseñar "–" donde hubo dato.

**(3) Cambiar `rsGlobalPct` por `rsRating` como `rsAnchor`.** Ordena igual
(ρ = 0,963), está en el 100% de las filas, no depende del lote y no añade
latencia. Esto arregla de raíz el problema de comparabilidad en el 0,16 directo,
y —si se aplica también dentro de `scoreRsQuality` y `demandScore`— en el 0,32
total. Es el cambio con mejor relación entre beneficio y riesgo de los cuatro.

**(4) Reducir de doce términos a cinco o seis.** Tres de los doce son
prácticamente el mismo dato:

```
Spearman entre componentes (3.311 filas):
  rsAnchor ↔ momentumScore   0,935
  rsAnchor ↔ rsQualityScore  0,929
  rsQuality ↔ riskReward     0,760
  rsQuality ↔ adProxy        0,713
```

`rsAnchor` (0,16), `rsQualityScore` (0,06) y `momentumScore` (0,02) suman el 24%
del peso midiendo casi lo mismo — los tres derivan de perf 3M/6M/12M. Y la
contribución real de cada término a la dispersión del compuesto es muy desigual:

| Término | Peso | sd | peso × sd | % de la dispersión |
|---|---|---|---|---|
| setup + demanda + growth (bloque) | 0,35 | 17,76 | 6,22 | 29,7% |
| `rsAnchor` | 0,16 | 28,57 | 4,57 | 21,8% |
| `riskRewardScore` | 0,08 | 29,55 | 2,36 | 11,3% |
| `epsGrowthProxyScore` | 0,08 | 24,50 | 1,96 | 9,4% |
| `adProxyScore` | 0,08 | 18,38 | 1,47 | 7,0% |
| `riskScore` | 0,05 | 26,25 | 1,31 | 6,3% |
| `rsQualityScore` | 0,06 | 21,36 | 1,28 | 6,1% |
| `sectorScore` | 0,10 | 11,71 | 1,17 | 5,6% |
| `momentumScore` | 0,02 | 30,10 | 0,60 | 2,9% |
| `ipoScore` | 0,02 | 0,00 | 0,00 | **0,0%** |

Cinco términos (setup, RS, rent/riesgo, EPS, riesgo) explicarían el grueso. Un
dato que ayuda a dimensionar la ambición: el compuesto de doce términos
reproduce con Spearman 0,870 el orden de **`minerviniScore` a secas**, y 0,863
el de `rsGlobalPct` a secas. Doce términos para acabar cerca de donde llega uno.

## 12. Sobre no inventar datos

Los tres mecanismos que hoy fabrican valor por defecto y que este análisis ha
localizado en el camino del nocturno:

| Dónde | Qué fabrica | Debería |
|---|---|---|
| `computeCompositeDetailed`, `ipoScore = 0` (`scoringEngine.js:776`) | un 0 que no se excluye | pasar `null` explícito o quitar el término |
| `materializedScanner.js:330` | `riskRewardScore` → 45 | pasar `null` y renormalizar, como ya hace `scanPercentileFinalization.js:313` |
| `materializedScanner.js:331` | `rsAnchor` → 50 | el eslabón intermedio (`rsRating`) es dato real y debe quedarse; el `50` final no |
| `screenerComposite.js:148` | `sectorScore` → 40 | `null` cuando no hay grupo |

Ninguno de los cuatro se activó en las 3.314 filas de esta noche (todos los
campos implicados estaban presentes), salvo `ipoScore`, que se activó en las
3.314. Es decir: **el único fallback que hoy está disparando de verdad es el
único que además no puede excluirse.**

Y un caso que no es de fórmula sino de vocabulario, ya documentado en
`docs/constantes-finalizacion-2026-08-07.md` y que sigue vivo: `lib/scoring.js:113`

```js
  if ((r.growthScore || 0) < 45) risks.push("Fundamentales insuficientes/débiles");
```

Con `growthScore` ausente, `(undefined || 0)` es 0, la condición se cumple, y el
producto afirma que los fundamentales son débiles cuando lo que ocurre es que no
los conoce. En las filas ligeras `growthScore` no existe, así que esa frase es
hoy estructuralmente falsa para el 99,1% de la población.

## 13. ¿Hace falta un compuesto?

**Para la tabla, ya se decidió que no, y la decisión se ha ejecutado.** Ninguna
de las siete columnas es el compuesto, y el orden por defecto es el rendimiento
del periodo elegido. El comentario del código lo explica mejor que cualquier
resumen (`screenerPipeline.js:88-91`):

```js
// Orden por defecto de la tabla. En modo normal sigue al selector de periodo
// de la columna de rendimiento (docs/principios-producto.md, principio 7.5):
// ordenar por un score que la tabla ya no muestra dejaría al usuario sin
// forma de entender por qué una fila está antes que otra.
```

**Pero el compuesto no ha desaparecido: se ha ido donde no se ve.** Sigue
decidiendo cuatro cosas, todas invisibles para el usuario:

1. Qué símbolos entran en cada Lista (umbrales 45/50/55).
2. En qué orden salen (entre el 14% y el 38% del `strategyScore`, y el 100% en
   la lista "composite").
3. Qué filas sobreviven al recorte nocturno (`byScore`).
4. Si un valor es elegible para ranking (`objectiveScore >= 45`).

Eso choca de frente con el principio 1: *"Un número sin contexto no es neutral:
si se ordena por él y se destaca el primero, el producto está señalando. La
ordenación debe ser elegible y su criterio, explícito."* Hoy el criterio no es
elegible ni explícito — es un promedio de doce cosas del que el usuario no ve
ninguna, con un término que vale cero siempre y otro que cambia según cuántos
símbolos se escanearon esa noche.

**Recomendación.** Sí hace falta *algo* que ordene las Listas — una lista sin
orden no es una lista. Pero no hace falta que ese algo sea un promedio de doce
métricas ocultas. Dos caminos, y el segundo es el que recomiendo:

- **Conservador:** arreglar el compuesto (puntos 1-3), publicarlo en la página
  de metodología con sus pesos y sus tamaños de muestra (principio 5), y
  enseñarlo en la ficha con el desglose ya cuadrado.
- **Coherente con los principios:** que **cada Lista se ordene por lo que esa
  Lista dice ser**. "RS" por RS, "Rendimiento 6M" por rendimiento a 6 meses,
  "Cerca del pivote" por distancia al pivote. Es un criterio que el usuario ve,
  entiende y puede reproducir con la columna que tiene delante; y elimina de un
  golpe la pregunta "¿por qué este valor está antes que aquel?". El compuesto
  quedaría entonces como lo que de verdad es hoy: un filtro de calidad mínima
  (`>= 45`), un uso para el que ni su precisión ni su desglose importan tanto —
  y donde un umbral sobre `minerviniScore` o sobre el RS haría probablemente el
  mismo trabajo siendo explicable en una frase.

---

# CONFIANZA

**Alta (medición directa, población completa, reproducible con las consultas
citadas):**

- La fórmula y los pesos. Reproducidos con **error 0,0000000000** sobre las 31
  filas del nocturno que conservan todos los campos.
- Presencia de cada componente en las 3.314 filas (tabla del punto 3). Es un
  censo, no una muestra: 3.314 símbolos únicos descargados, cuadrando con
  `scans.row_count`.
- `ipoScore` = ausente en el 100% de las filas, y `ipoDate`/`ipoAgeMonths`
  ausentes en el 100%. Confirmado además en el otro camino de escaneo con una
  consulta que devuelve cero filas con `ipoScore != 0`.
- Que setup/demanda/growth entraron en el cálculo: el despeje da un valor dentro
  del rango teórico [0 ; 35] en las 3.280 filas, sin una sola excepción.
- La inestabilidad de `rsGlobalPct`: siete de siete símbolos, mismo día, misma
  fecha de cierre, desplazamientos de 8 a 14 puntos.
- Los números de la Parte D. Calculados sobre las 3.314 filas.

**Media (medición correcta, alcance limitado):**

- La cobertura del RS semanal (93,3%) sale de un muestreo sistemático de 150
  símbolos, no del censo. El método (uno de cada 22 ordenados por score) evita
  el sesgo alfabético, pero el intervalo de confianza real está en torno a
  ±4 puntos.
- Las estadísticas de `setupQualityScore`, `demandScore` y `growthScore` (punto
  B.3) salen de solo 31 filas, y son precisamente las 31 que **pasaron** el
  preset: están sesgadas al alza por construcción. No las use como referencia de
  la población.

**Baja / declarada como estimación:**

- El coste de persistir tres campos más ("~1% de la fila") es una estimación
  aritmética a partir de los 7.233 B/fila que documenta
  `lib/scanLightProjection.js:16-18`, no una medición nueva.
- La afirmación de que cinco términos "explicarían el grueso" es una inferencia
  de la tabla peso × sd, no el resultado de haber construido y comparado esa
  fórmula.

# LO QUE NO HE VERIFICADO

1. **No he abierto la interfaz.** Todo lo que digo sobre lo que ve el usuario
   está deducido del código (`buildScreenerScoreAudit`, `screenerColumns.jsx`,
   `ResultFilterBar.jsx`) y de los datos persistidos. No he comprobado en un
   navegador que la ficha muestre hoy el desglose con "+0,0", ni con qué fila
   concreta se produjo la captura que cita el encargo.
2. **No he ejecutado la suite de tests.** No sé si algún test fija los valores
   actuales de forma que los cambios propuestos lo rompan (hay al menos
   `tests/screenerScoreAudit.test.js`, `tests/scoringEngine.test.js` y
   `tests/objectiveMetricTruth.test.js` en el radar).
3. **No he investigado por qué hay tres snapshots de `rs_weekly_items` para la
   semana 2026-W32**, ni por qué el del 8 de agosto (n=4.217) da valores tan
   distintos de los otros dos. Lo reporto como riesgo para C.8; la causa puede
   ser benigna (una corrida parcial) o no.
4. **No he comprobado el camino del escaneo interactivo end-to-end.** Verifiqué
   que sus filas llevan `percentileScope: "final"` y que sí calculan
   `ipoScore`/`demandScore`/`growthScore`, pero no he auditado su proyección de
   guardado ni si sufre el mismo problema de desglose.
5. **No he medido cuántas filas de las Listas reales cambiarían** con las
   propuestas: los 112/140/146 cruces de umbral son sobre la población del
   escaneo, no sobre las listas ya filtradas por `basePasses` y
   `strategyPasses`, que aplican además freshness, cobertura y contrato de lista.
6. **No he verificado el histórico** (`scan_symbol_history`) ni si los deltas
   nocturnos que se guardan ahí arrastran el mismo problema de componentes no
   persistidos.
7. **La comparación con el escaneo del 13 de agosto mezcla dos días de
   mercado.** Por eso la conclusión de C.7 se apoya en la comparación
   intradía (nocturno vs servidor del mismo 15 de agosto), donde el precio de
   cierre es el mismo y la única variable es la población.
