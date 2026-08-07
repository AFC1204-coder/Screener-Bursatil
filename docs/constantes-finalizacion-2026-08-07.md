# Constantes en `finalizeScanPercentiles` — qué fabrican, cuánto pesan, a quién afectan

Fecha: 2026-08-07. BASE_SHA: `87b246c`. Rama: `codex/statsedge-ui-polish`.

Tarea de análisis. No se modificó ningún archivo de código, no se escribió en
Supabase, no se ejecutó el cron.

---

## PARTE A — Qué se fabrica y cuánto pesa

### 1 — El bloque completo y el peso de cada término

Cita literal, `lib/scanPercentileFinalization.js:127-143`:
```js
const setupQualityScore = Number.isFinite(row.setupQualityScore) ? row.setupQualityScore : 0;
const objectiveSetupScore = Number.isFinite(row.objectiveSetupScore)
  ? row.objectiveSetupScore
  : setupQualityScore;
const rsAnchor = Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : (Number.isFinite(row.rsRating) ? row.rsRating : 50);
const rsQualityScore = Number.isFinite(row.rsQualityScore) ? row.rsQualityScore : rsAnchor;
const demandScore = Number.isFinite(row.demandScore) ? row.demandScore : 0;
const adProxyScore = Number.isFinite(row.adProxyScore) ? row.adProxyScore : 0;
const growthScore = Number.isFinite(row.growthScore) ? row.growthScore : 0;
const epsAnchor = Number.isFinite(row.epsGrowthProxyScore)
  ? row.epsGrowthProxyScore
  : growthScore;
const sectorScore = Number.isFinite(row.sectorScore) ? row.sectorScore : 40;
const riskRewardScore = Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45;
const riskScore = Number.isFinite(row.riskScore) ? row.riskScore : 0;
const momentumScore = Number.isFinite(row.momentumScore) ? row.momentumScore : 0;
const ipoScore = Number.isFinite(row.ipoScore) ? row.ipoScore : 0;
```
(`objectiveSetupScore` cae a la variable `setupQualityScore`, no a una
constante — no forma parte de esta lista; el propio bug de `b51d1b4`, ya
arreglado, es sobre esa línea y no se toca aquí.)

Pesos, `lib/scoringEngine.js:633-646` (`COMPOSITE_WEIGHTS`):
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

| Métrica | Constante de fallback | Peso | Efecto de fabricarla |
|---|---|---|---|
| `setupQualityScore` | `0` | 0.17 | Empuja siempre hacia abajo (0 = peor caso de la escala 0-100) |
| `rsAnchor` | `rsGlobalPct` → `rsRating` → `50` | 0.16 | El primer nivel de fallback (a `rsRating`) es dato real, no fabricación — ver nota abajo. Solo el último nivel (`50`) es una constante pura; dirección ambigua (por encima o debajo según el resto de la fila) |
| `rsQualityScore` | `rsAnchor` (variable, no constante directa) | 0.06 | Hereda el sesgo de `rsAnchor` |
| `demandScore` | `0` | 0.10 | Siempre hacia abajo |
| `adProxyScore` | `0` | 0.08 | Siempre hacia abajo |
| `growthScore` | `0` | 0.08 | Siempre hacia abajo — y ver punto 3, además cambia de significado |
| `epsAnchor` | `epsGrowthProxyScore` → `growthScore` (variable) | 0.08 | Hereda el sesgo de `growthScore` cuando ambos faltan |
| `sectorScore` | `40` | 0.10 | Dirección ambigua (dato real de la fila puede estar por encima o debajo de 40) |
| `riskRewardScore` | `45` | 0.08 | Dirección ambigua |
| `riskScore` | `0` | 0.05 | Siempre hacia abajo |
| `momentumScore` | `0` | 0.02 | Siempre hacia abajo |
| `ipoScore` | `0` | 0.02 | Siempre hacia abajo |

**Nota sobre `rsAnchor`**: de los tres niveles de fallback, solo el último
(`50`) es una constante pura, indistinguible de una medición real. El nivel
intermedio (caer a `rsRating` cuando `rsGlobalPct` es `null`) es un dato
real — un percentil/rating alternativo, no un número inventado — así que no
tiene el mismo problema que los demás. Esto importa para la Parte B: es la
**única** rama de las doce que observé activarse en datos reales de
producción (ver B.4).

**Suma de pesos que caen en la constante fija "0"**: `setupQualityScore
(0.17) + demandScore (0.10) + adProxyScore (0.08) + growthScore (0.08) +
riskScore (0.05) + momentumScore (0.02) + ipoScore (0.02) = 0.52` — **52%
del composite**, si absolutamente todo faltara, cae en fallbacks que
matemáticamente solo pueden empujar hacia abajo (ver 2).

### 2 — ¿Empuja arriba o abajo? Cálculo para una fila sin ningún fundamental

**Prueba matemática general, para los siete términos que fabrican `0`**:
la fórmula de hoy (sin renormalizar) es una suma ponderada lisa —
`Σ vᵢ·wᵢ`, con `Σwᵢ ≈ 1`. Si un término ausente se sustituye por `0`, su
contribución a la suma es `0·w = 0`; la fórmula renormalizada divide la
suma de los términos presentes entre el peso presente
(`presentWeightedSum / presentWeight`, `lib/scoringEngine.js:801-805`,
citado en el punto 8). Como `presentWeight ≤ 1` siempre, dividir por un
número ≤1 nunca puede dar un resultado **menor** que la suma sin dividir.
**Conclusión, válida para cualquier fila**: sustituir por `0` los siete
términos (`setupQualityScore`, `demandScore`, `adProxyScore`,
`growthScore`, `riskScore`, `momentumScore`, `ipoScore`) **nunca puede dar
un score más alto** que renormalizar — como mucho da el mismo número (si
esos términos genuinamente valían 0). Para `sectorScore→40`,
`riskRewardScore→45` y `rsAnchor→50` no hay esa garantía: la dirección
depende de si la constante queda por encima o por debajo del promedio
ponderado de lo que sí hay dato.

**Cálculo derivado** (no una fila real observada — ver B.4/B.6 para por
qué no encontré una fila real con `growthScore`/`epsAnchor` realmente
ausentes en la ventana de finalización) para una fila técnicamente fuerte
sin ningún fundamental (`growthScore` y `epsAnchor` ausentes, el resto con
los valores reales de una fila real, AAPL `id=ebe66356...`,
`scan_id=9f2ff675...`, ver B.4 para el origen de estos números):
```
Pesos de growthScore + epsAnchor (ambos ausentes): 0.08 + 0.08 = 0.16 (16% del composite)

Forma 1 — constantes (código actual):        65.0286
Forma 2 — renormalizado (motor):              77.4150  (coverage=0.840)
Diferencia (forma2 - forma1):                +12.3864
```
Es decir: fabricar `0` para ambos términos **resta 12,39 puntos** sobre
100 respecto a excluirlos y renormalizar, para esta fila concreta. El
mismo tipo de efecto, con otra magnitud, es lo que midió el commit
`eaee4f1` cuando arregló el mismo patrón en `scoringEngine.js` ("+5,74
para técnicos fuertes sin fundamentales, -2,57 para débiles" — cita
literal del mensaje de commit, ver C.7).

### 3 — `growthScore→0`: ¿de invisible a "malo"?

**Confirmado, con cita literal.** `lib/scoring.js:113`:
```js
if ((r.growthScore || 0) < 45) risks.push("Fundamentales insuficientes/débiles");
```
Esta línea vive en `compositeNarrative(r)` (`lib/scoring.js:86-117`),
exportada (`lib/scoring.js:187`) y usada por `lib/screenerPipeline.js` para
construir la lista de "riesgos" que se muestra por fila. `growthScore=0`
(fabricado por ausencia de dato) es indistinguible aquí de
`growthScore=0` (medido, fundamentales realmente pésimos): la condición
`< 45` es verdadera en ambos casos, y el texto que ve el usuario es el
mismo: **"Fundamentales insuficientes/débiles"**. Un dato ausente pasa de
invisible ("no sé") a una afirmación negativa concreta ("sé que son
débiles").

Contraste con el motor arreglado (`SIGNAL_REGISTRY.growthScore.compute`,
`lib/scoringEngine.js:493-503`):
```js
compute: (r) => {
  const metrics = r.growthMetrics || {};
  const values = ["revenueGrowth", "earningsGrowth", "grossMargin", "operatingMargin", "profitMargin", "roe", "roa", "debtToEquity", "currentRatio"].map((k) => metrics[k]);
  // Sin ningún campo finito no hay señal de crecimiento que calcular — se
  // señaliza ausencia (null), igual que epsGrowthProxyScore (línea 547), en
  // vez de fabricar un 45 "neutro" indistinguible de una medición real.
  // computeComposite (línea ~730) renormaliza sobre los términos presentes
  // cuando esto ocurre, en vez de tratar la ausencia como el peor caso.
  if (!values.some(Number.isFinite)) return null;
  ...
```
El motor ya distingue "ausente" (`null`) de "medido y malo" (`0` real,
posible si todos los sub-términos son negativos). `lib/scoring.js:113` no
hace esa distinción — trata `null`/`undefined` igual que `0` vía `(r.growthScore
|| 0)`, y `scanPercentileFinalization.js` es quien convierte el `null`
correcto del motor en un `0` que dispara ese texto.

---

## PARTE B — Cuántas filas están afectadas

### 4 — Filas con `percentileScope: 'final'` y métricas ausentes al finalizar

**Ventana usada**: `created_at >= 2026-07-10T00:00:00Z` (fecha del commit
`4a851e2` que introdujo este bloque — antes de esa fecha `percentileScope:
'final'` no podía existir con esta lógica) hasta hoy, sin límite superior.

Consulta exacta (metrics, valores persistidos):
```
table=scan_results
select=id,symbol,scan_id,created_at,metrics->>percentileScope,
       metrics->>setupQualityScore,metrics->>objectiveSetupScore,
       metrics->>rsGlobalPct,metrics->>rsRating,metrics->>rsQualityScore,
       metrics->>demandScore,metrics->>adProxyScore,metrics->>growthScore,
       metrics->>epsGrowthProxyScore,metrics->>sectorScore,
       metrics->>riskRewardScore,metrics->>riskScore,metrics->>momentumScore,
       metrics->>ipoScore,metrics->>objectiveScore,metrics->>compositeScore,
       metrics->>totalScore
filter=created_at=gte.2026-07-10T00:00:00Z&metrics->>percentileScope=eq.final
order=created_at.desc, limit=200
```
**86 filas** (población completa, no una muestra — 86 < el tope de 200,
así que no hay truncamiento). 50 símbolos distintos, 7 `scan_id` distintos
(un scan de 50 símbolos + seis scans de 6 símbolos cada uno — el patrón de
pruebas manuales con megacaps ya visto en trabajo previo de este repo).

Para saber cuáles tenían de verdad alguna de las once/doce métricas
**ausente antes de finalizar** (no lo que quedó persistido en `metrics`,
que ya lleva el fallback aplicado), repetí la consulta sobre `raw` — la
columna que `finalize_scan_results` NUNCA toca (solo hace `metrics =
sr.metrics || src.metrics_patch`, `supabase/schema.sql:339`), así que
sigue teniendo el estado previo a la finalización:
```
table=scan_results
select=id,symbol,scan_id,raw->>setupQualityScore,raw->>objectiveSetupScore,
       raw->>rsGlobalPct,raw->>rsRating,raw->>rsQualityScore,
       raw->>demandScore,raw->>adProxyScore,raw->>growthScore,
       raw->>epsGrowthProxyScore,raw->>sectorScore,raw->>riskRewardScore,
       raw->>riskScore,raw->>momentumScore,raw->>ipoScore
filter=created_at=gte.2026-07-10T00:00:00Z&metrics->>percentileScope=eq.final
order=created_at.desc, limit=200
```
Resultado (medición directa, script Python sobre las 86 filas):
```
null counts per field: {'setupQualityScore': 0, 'objectiveSetupScore': 0,
'rsGlobalPct': 36, 'rsRating': 0, 'rsQualityScore': 0, 'demandScore': 0,
'adProxyScore': 0, 'growthScore': 0, 'epsGrowthProxyScore': 0,
'sectorScore': 0, 'riskRewardScore': 0, 'riskScore': 0, 'momentumScore': 0,
'ipoScore': 0}
rows with ANY null field: 36 / 86
rows with any null EXCLUDING rsGlobalPct: 0 / 86
```
**Hallazgo, medido, no derivado**: de las 86 filas finalizadas hoy en
producción, **0 tienen alguno de los diez fallbacks "duros" activado**
(`setupQualityScore`, `demandScore`, `adProxyScore`, `growthScore`,
`sectorScore`, `riskRewardScore`, `riskScore`, `momentumScore`, `ipoScore`,
y el último nivel de `rsAnchor`→`50`). **36 de 86 (42%)** sí tienen
`rsGlobalPct` ausente — pero, como `rsRating` está presente en las 86
filas sin excepción, `rsAnchor` nunca llega a fabricar el `50`: cae en el
nivel intermedio (dato real, `rsRating`), no en la constante.

Esto no significa que el defecto no exista — el código lo permite
estructuralmente y lo hace para cualquier fila que llegue con esos campos
ausentes (confirmado leyendo el código en A.1). Significa que, **en la
población real y completa de filas finalizadas desde que existe este
mecanismo**, la exposición observada es menor de lo que el enunciado del
problema sugiere: los scans interactivos que sí se ejecutan (y son los
únicos que finalizan, ver contexto dado) han sido, hasta hoy, casi
exclusivamente sobre valores de gran capitalización estadounidenses con
cobertura de fundamentales completa por parte del proveedor de datos. Cité
también, más abajo (búsqueda adicional, fuera de `percentileScope='final'`),
filas reales con `epsGrowthProxyScore` ausente para instrumentos sin
fundamentales de verdad (preferentes, ETN apalancados) — pero esas filas
son de scans de cron/prueba masiva, no pasaron por `finalizeScanPercentiles`
(el cron nunca finaliza, dado en el contexto), así que no forman parte de
esta cuenta.

### 5 — ¿Se puede distinguir a posteriori una fila fabricada de una completa?

**Depende de qué se mire.** La columna `metrics` (lo que persiste el
patch de finalización) **no** distingue: `metrics_patch` no incluye
ningún flag de "este término se fabricó" — solo el valor final
(`lib/scanPercentileFinalization.js:172-197`, el objeto devuelto tiene
`rsGlobalPct`, `sectorScore`, `objectiveScore`, `compositeScore`,
`totalScore`, `percentileScope`, `signalContradictions`,
`contradictionsSkipped` — ningún campo de cobertura de fallback). Mirando
solo `metrics`, una fila con `growthScore: 0` fabricado es
indistinguible de una fila con `growthScore: 0` medido y genuinamente
pésimo. **El defecto es invisible una vez persistido, mirando solo
`metrics`.**

Sí es parcialmente reconstruible cruzando con `raw`, como hice en el punto
4 — porque `finalize_scan_results` nunca toca esa columna. Pero esto es
una casualidad de implementación (que el patch solo escriba `metrics`), no
un contrato documentado ni garantizado — y aun con `raw`, solo se puede
reconstruir el estado en el momento del scoring por lote, no si `raw`
mismo se sobrescribiera alguna vez (no verificado que nunca ocurra en
otros caminos). Para un consumidor que solo mira `metrics` (que es lo que
leen `leaderboard_publishable_rows`, `readScanRows`, la UI, ver documento
hermano de la sesión anterior sobre `scan_results`), la respuesta práctica
es: **no, no se puede distinguir.**

### 6 — 5 filas reales afectadas, score de las dos formas

**No hay ninguna fila real, en la población completa de 86, afectada por
los diez fallbacks "duros"** (punto 4). La única rama que sí se activó en
datos reales es `rsAnchor: rsGlobalPct → rsRating` (36 filas). Uso esas 5,
con datos reales de `raw` y de `metrics`, comparando **(a)** el valor
literal de hoy (`rsAnchor = rsRating`, código actual) contra **(b)** lo
que daría renormalizar excluyendo `rsAnchor` en vez de sustituirlo (lo que
haría el motor si tratara la ausencia de `rsGlobalPct` como ausencia de
`rsAnchor`, sin caer a `rsRating`):

| Símbolo | `id` | Literal (hoy, `rsAnchor=rsRating`) | Renormalizado (excluye `rsAnchor`) | Diferencia | `compositeScore` persistido |
|---|---|---:|---:|---:|---:|
| AAPL | `ebe66356…` | 79.6686 | 80.3674 | +0.6988 | 79.1934 |
| GOOGL | `c56aca4c…` | 51.3639 | 50.0999 | −1.2640 | 51.1275 |
| MSFT | `2e3cc7ff…` | 45.7531 | 48.7537 | +3.0006 | 44.8279 |
| NVDA | `5352da30…` | 41.7179 | 41.6642 | −0.0537 | 41.1023 |
| AMZN | `c6493d0a…` | 45.4657 | 47.2687 | +1.8030 | 44.4001 |

Metodología: "Literal" y "Renormalizado" son mi propio recálculo, con la
fórmula literal de `scanPercentileFinalization.js` (columna `compositeScore`,
que usa `setupQualityScore` directo, no `objectiveSetupScore`) sobre los
valores reales de `raw` para cada fila, usando `COMPOSITE_WEIGHTS` exacto.
**No reproduce bit a bit el `compositeScore` persistido** (columna de la
derecha, para contexto) — hay una discrepancia de 0,4-0,9 puntos sin
explicar del todo (ver "LO QUE NO HE VERIFICADO"); no cambia la lectura
cualitativa (dirección y orden de magnitud del efecto de excluir vs.
sustituir por `rsRating`), pero lo marco como medición no exacta, no
bit-perfecta.

**Lectura**: a diferencia de los fallbacks "duros" (punto 2, siempre hacia
abajo), sustituir por `rsRating` empuja hacia arriba en 3 de 5 casos y
hacia abajo en 2 — porque `rsRating` es un dato real, no un relleno
neutro, y puede estar por encima o por debajo de lo que el resto de la
fila implica.

Como ninguna fila real muestra los fallbacks "duros" activados, el punto
2 usa un cálculo derivado (con datos reales de fondo, término forzado
ausente a propósito) para responder lo que pide la Parte A sin fabricar
una afirmación falsa sobre datos que no existen en la población
observada.

---

## PARTE C — Por qué se hizo así

### 7 — Justificación en la migración, comentarios y commits

**Migración `supabase/migrations/20260710184308_scan_finalize_sector_composite_inputs.sql`**,
cita literal (líneas 14-18):
```
-- Mismo patrón que el resto del thin projection: statsedge_coverage_finite_number
-- aplicado a cada candidato, coalesce entre raw y metrics (raw primero porque
-- así lo consume el helper JS via `...(row.raw || {})`). null si ninguno
-- existe -> el helper JS aplica defaults internos (riskRewardScore ?? 45,
-- el resto a 0).
```
Es la única justificación textual que encontré: documenta el fallback como
comportamiento **esperado y ya asumido**, no lo argumenta — no explica por
qué "el resto a 0" es preferible a excluir y renormalizar. La migración
está fechada `20260710184308`.

**Commit `4a851e2`** (`Fri Jul 10 20:49:29 2026 +0200`,
`fix(scan): elimina bonus temático de sectorScore y recalcula sobre
población completa en finalización`) es donde se introdujo este bloque de
fallbacks en `scanPercentileFinalization.js` (confirmado con `git log
--follow -- lib/scanPercentileFinalization.js`). Cita literal del cuerpo
del commit, sección "D) lib/scanPercentileFinalization.js":
```
D) lib/scanPercentileFinalization.js
   finalizeScanPercentiles: (1) computeSectorScoresForRows sobre la
   población completa del thin-raw; (2) applySectorScores inyecta
   sectorScore final antes de enrichRelativePercentiles; (3) en el
   callback del patch, recalcula objectiveScore/compositeScore/
   totalScore con scoreCompositeValue. Todo se añade al MISMO
   metrics_patch atómico — no hay estado mixto.
```
Y más abajo, en la sección de tests (G):
```
- objectiveScore/compositeScore se recalculan con sectorScore
  final + rsGlobalPct final + fallbacks explícitos a 0/45.
```
**El problema que este commit resolvía era otro**: `sectorScore` quedaba
"stale" tras la finalización (hallazgo C2/C3 del audit
`docs/screener-design-audit-2026-07-10.md`, citado en el propio mensaje)
porque se calculaba por lote local en vez de sobre la población completa
del scan. Recalcular `objectiveScore`/`compositeScore` con el `sectorScore`
final exigía llamar a `scoreCompositeValue`, y eso exigía darle **algún**
valor a los otros once términos que la RPC `scan_finalize_inputs` no
proyectaba todavía completos en ese momento (`riskScore, growthScore,
demandScore, epsGrowthProxyScore, ipoScore` son justo los 5 campos que esa
misma migración añade al thin-raw, según su propia cabecera, líneas 9-12).
Los fallbacks a 0/40/45/50 son un efecto colateral de resolver el problema
de `sectorScore`, no una decisión razonada sobre qué hacer con datos
ausentes — no encontré ningún comentario o mensaje que discuta
alternativas (renormalizar, excluir la fila) en este commit.

**`eaee4f1`** (`Mon Jul 27 19:57:32 2026 +0200`, 17 días después),
mensaje completo:
```
fix(scoring): growthScore señaliza ausencia en vez de fabricar 45

El 45 fijo entraba en el composite indistinguible de una medición real, y
además contaba doble (growthScore directo + epsAnchor por fallback).
computeComposite ahora renormaliza sobre los términos presentes: sin dato
deja de significar peor caso. Desplazamiento medido: +5,74 para técnicos
fuertes sin fundamentales, -2,57 para débiles.
```
Nótese que el valor que corrigió `eaee4f1` en el motor era **45** (no
`0`) — el propio motor, antes de este fix, ya fabricaba un valor distinto
al que sigue fabricando hoy `scanPercentileFinalization.js` (`0`). Son dos
decisiones tomadas en momentos distintos, con constantes distintas, nunca
reconciliadas entre sí — exactamente como describe el contexto de la
tarea.

### 8 — ¿Hay alguna razón técnica que impida renormalizar?

**No.** Verificación en tres partes:

**a) `scoreCompositeValue` ya soporta renormalización — es la misma
función que se llama aquí.** `lib/scoringEngine.js:857`:
```js
export const scoreCompositeValue         = computeComposite;
```
Y `computeComposite` (`lib/scoringEngine.js:812-814`):
```js
export function computeComposite(args) {
  return computeCompositeDetailed(args).value;
}
```
`computeCompositeDetailed` (`lib/scoringEngine.js:764-806`) es
exactamente la lógica que excluye términos no finitos y redistribuye su
peso — la misma que el enunciado cita como "el comportamiento correcto":
```js
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
**Es la MISMA función que llama `scanPercentileFinalization.js`** en las
líneas 144 y 158 (`scoreCompositeValue({...})`). El bloqueo no está en
`scoreCompositeValue` — está en que, para cuando se la llama, `missing`
**siempre** es 0: las líneas 127-143 ya convirtieron los doce `null`
posibles en doce números finitos. La rama de renormalización de
`computeCompositeDetailed` es alcanzable en el código, pero **inalcanzable
en la práctica desde este call site** — nunca se ejecuta, porque nunca
llega con nada ausente.

**b) La RPC `scan_finalize_inputs` no impone su propio default — deja
pasar `null` fielmente.** Cita, `supabase/migrations/20260710184308_scan_finalize_sector_composite_inputs.sql`
(patrón repetido para cada campo, ejemplo con `growthScore`):
```sql
'growthScore', coalesce(
  public.statsedge_coverage_finite_number(l.raw -> 'growthScore'),
  public.statsedge_coverage_finite_number(l.metrics -> 'growthScore')
),
```
El `coalesce` prueba `raw` y luego `metrics`; si **ninguno de los dos**
tiene un número finito, el resultado SQL es `NULL` — la RPC no sustituye
ningún 0/40/45/50 propio. El propio comentario de la migración lo dice
explícitamente (cita ya reproducida en el punto 7): "null si ninguno
existe -> el helper JS aplica defaults internos" — la RPC delega
conscientemente en el JS, no impone nada ella misma.

**c) `evaluateContradictions` (la otra consumidora de `row` en esta
función) no depende de este bloque.** Se llama en la línea 109, **antes**
de que se calculen las constantes de las líneas 127-143, sobre `row`
directamente (el resultado de `enrichRelativePercentiles`, no el objeto
con fallbacks). Esto descarta que las constantes existan para servir a
`evaluateContradictions` — solo alimentan las dos llamadas a
`scoreCompositeValue`.

**Conclusión de la Parte C**: no hay ningún obstáculo técnico. El
`missing` de `computeCompositeDetailed` nunca llega a >0 desde este call
site porque el propio código de `scanPercentileFinalization.js` se
encarga de que no llegue nunca `null`/`undefined` a `scoreCompositeValue`
— el fallback ocurre una línea antes de donde el motor ya sabría
manejarlo de otra forma.

---

## PARTE D — Las opciones

Enumeradas sin recomendación (excepto la línea final, pedida
explícitamente por el enunciado).

### 9 — Alternativas

**a) Renormalizar como el motor: excluir ausentes y repartir pesos.**
- *Código*: dejar de calcular `setupQualityScore`/`rsAnchor`/…/`ipoScore`
  con fallback a constante — pasar `row.X` (posiblemente `undefined`)
  directamente a `scoreCompositeValue`, dejando que
  `computeCompositeDetailed` haga la exclusión/redistribución que ya sabe
  hacer (Parte C.8a). Cambio acotado: sustituir las 12 líneas `const X =
  Number.isFinite(...) ? ... : constante` por `const X = row.X` (o
  equivalente), sin tocar `scoringEngine.js`.
- *Efecto para el usuario*: el score de una fila con fundamentales
  ausentes deja de estar sistemáticamente penalizado (punto 2); el texto
  de `lib/scoring.js:113` seguiría diciendo "Fundamentales insuficientes/
  débiles" salvo que también se toque esa condición (fuera del alcance de
  este bloque) — la Parte A.3 seguiría sin resolverse aunque se
  renormalice el score.
- *Qué se rompe*: nada estructuralmente — es la misma función que ya usa
  el resto del motor. Sí cambia el número que ya está persistido para las
  86 filas existentes (no se recalculan retroactivamente, mismo patrón que
  documentó `b51d1b4`: "las filas ya persistidas conservan el valor
  colapsado").

**b) Excluir del ranking las filas sin datos suficientes.**
- *Código*: en `finalizeScanPercentiles` o aguas abajo (`readScanRows`/
  `buildLeaderboard`), filtrar filas cuyo `coverage` (ya lo devuelve
  `computeCompositeWithCoverage`, `lib/scoringEngine.js:826-828` — hoy sin
  consumidor, comentario propio: "No hay ningún consumidor todavía") caiga
  bajo algún umbral.
- *Efecto para el usuario*: menos filas en pantalla; ninguna fila "a
  medias" visible, pero también menos cobertura del universo — un símbolo
  real (aunque con menos fundamentales) desaparece en vez de aparecer con
  peor información.
- *Qué se rompe*: nada en código existente si se implementa como filtro
  nuevo; cambia el contrato implícito de "toda fila calculada se
  publica".

**c) Mantener el score pero marcar la fila como incompleta y que se vea.**
- *Código*: usar `computeCompositeWithCoverage` en vez de
  `computeComposite`/`scoreCompositeValue`, y persistir `coverage`/`partial`
  en el `metrics_patch` (hoy no se guarda nada de esto — punto 5). Requiere
  además tocar la UI para mostrar el aviso.
- *Efecto para el usuario*: transparencia — la fila sigue publicándose,
  pero con una señal visible de "score parcial". Resuelve directamente el
  hallazgo de la Parte B.5 (hoy es invisible).
- *Qué se rompe*: ningún camino existente de escritura; es aditivo. Sí es
  el cambio de mayor alcance de las cuatro (toca persistencia + UI).

**d) Umbral: si falta más de X% del peso, no publicar la fila.**
- *Código*: combinación de (a) [para calcular `coverage` de verdad] + (b)
  [aplicar el corte] — usa el mismo `coverage` que ya devuelve
  `computeCompositeWithCoverage`.
- *Efecto para el usuario*: intermedio entre (a) y (b) — filas con
  degradación leve (p. ej. solo `rsAnchor`, 16% del peso, como las 36
  filas reales de la Parte B) se publican renormalizadas; filas con
  degradación severa (p. ej. sin ningún fundamental, 16% también en este
  caso concreto, pero podría ser más si además falta `sectorScore` o
  `demandScore`) se ocultan.
- *Qué se rompe*: nada estructuralmente; la elección del umbral X% es una
  decisión de producto no técnica, y no hay un valor "obvio" en el código
  actual que la sugiera.

### 10 — Cuántas filas cambiarían de posición

**Solo pude calcular esto con datos reales para la alternativa (a)**
(renormalizar) sobre las 86 filas de la Parte B, porque es la única rama
con ejemplos reales de ausencia (`rsAnchor`, 36 filas). Agrupé por
`scan_id` (el ranking real se ve por scan, no mezclado entre scans) y
comparé el orden por `compositeScore` literal (hoy) contra el
renormalizado:

```
scan 9f2ff675 (6 filas): mismo orden
scan 819b849e (6 filas): mismo orden
scan 7b8bea36 (6 filas): mismo orden
scan 0fbf42e1 (6 filas): mismo orden
scan 7886ef20 (6 filas): CAMBIA posición: GOOGL, AMZN, NVDA, MSFT
scan cc772a99 (50 filas): mismo orden (rsGlobalPct presente en las 50)
scan 2ba74d4b (6 filas): CAMBIA posición: NVDA, META

scans con cambio de orden: 2 / 7
filas cuya posición relativa cambia: 6 / 86 (7%)
```
Para (b) y (d) — dependen de un umbral que no está definido en el código
actual (Parte D.9), así que no hay un número que calcular sin que alguien
fije primero ese umbral: con el único caso real que tengo (`rsAnchor`
ausente, 16% del peso), un umbral típico como "excluir si falta >20% del
peso" no afectaría a ninguna de las 36 filas (16% < 20%); un umbral de
"excluir si falta >10%" las afectaría a las 36. Para (c), el número de
filas que **cambiarían de posición** es cero por definición — no cambia el
score, solo añade una marca visible; sí cambiarían las 36 filas en cuanto
a qué se les mostraría (marcadas como parciales).

---

## PARTE E — La pregunta de fondo

### 11 — ¿Debería publicarse una fila cuyo score se calculó sobre la mitad de los datos?

Lo que está en juego, en las dos direcciones, sin decidir:

**A favor de publicar igual (con o sin marca)**: el universo de símbolos
que StatsEdge cubre incluye, por diseño, países y tipos de instrumento con
cobertura de fundamentales desigual (confirmado indirectamente en la Parte
B: encontré instrumentos reales — preferentes, ETN apalancados — con
`epsGrowthProxyScore` nulo por naturaleza, no por fallo de proveedor). Si
"faltan fundamentales" excluyera la fila, un usuario de swing trading
técnico (Weinstein/Minervini, el propio posicionamiento del producto,
según memoria de proyecto) podría perder setups técnicamente válidos solo
porque el símbolo no tiene revenue growth que reportar (preferentes, REITs
poco cubiertos, small caps recientes). El coste de excluir es invisible
para el usuario — nunca sabe qué no vio.

**En contra de publicarla sin más**: el score compuesto es la señal
principal de ranking del producto ("El score resultante se PERSISTE y
ordena la pantalla", enunciado de la tarea). Si el 16-52% del peso
(dependiendo de cuántos términos falten) se rellena con un número que no
mide nada, el usuario confía en un ranking que en parte es ruido
determinista, no señal — y, por el hallazgo de la Parte A.3, en el caso
concreto de `growthScore` no es neutro: es un **castigo activo**
("Fundamentales insuficientes/débiles") aplicado a un dato que en
realidad no existe. La Parte B.5 agrava esto: hoy no hay forma de que ni
el usuario ni un futuro auditor distingan una fila así de una fila con
todos los datos — el defecto, una vez publicado, es indetectable sin
volver a `raw`.

---

## CONFIANZA

- **Alta**: cita literal del bloque de constantes (A.1), de
  `COMPOSITE_WEIGHTS` y de `computeCompositeDetailed`/`computeComposite`
  (C.8) — lectura directa de código, sin ambigüedad.
- **Alta**: que `lib/scoring.js:113` trata `growthScore` ausente igual que
  `growthScore` medido y malo (A.3) — cita literal + contraste directo con
  el `compute()` ya arreglado del motor.
- **Alta**: que las 86 filas con `percentileScope: 'final'` desde
  2026-07-10 son la población completa, no una muestra (B.4) — confirmado
  porque 86 < el tope de 200 filas de la consulta, sin truncamiento.
- **Alta**: que 0 de esas 86 filas tienen alguno de los diez fallbacks
  "duros" activado, y que 36 sí tienen `rsAnchor` degradado a `rsRating`
  (B.4) — medición directa sobre `raw`, columna que `finalize_scan_results`
  nunca toca.
- **Alta**: que no hay obstáculo técnico para renormalizar desde este call
  site — `scoreCompositeValue` ya lo soporta, la RPC no impone sus propios
  defaults, `evaluateContradictions` no depende del bloque (C.8) — tres
  verificaciones independientes de código.
- **Alta**: la justificación (o ausencia de ella) en la migración y en los
  commits (C.7) — citas literales, ningún comentario que discuta
  alternativas.
- **Media**: el cálculo de "cuántas filas cambian de posición" (D.10) —
  correcto para los datos reales que tengo (`rsAnchor`), pero no puedo
  extrapolar a un escenario con fallbacks "duros" activados porque no
  existen filas reales así en la población observada.
- **Media**: el recálculo de `compositeScore` en la Parte B.6 — reproduce
  la fórmula correctamente pero no coincide bit a bit con el valor
  persistido (discrepancia de 0,4-0,9 puntos, dirección consistente, causa
  no identificada — ver abajo).

## LO QUE NO HE VERIFICADO

- **La causa exacta de la discrepancia entre mi recálculo y el
  `compositeScore` persistido** (B.6, 0,4-0,9 puntos en las 5 filas de la
  tabla). No descarté: orden de suma en punto flotante distinto entre mi
  Python y el JS original, un recómputo posterior no capturado por mi
  consulta, o alguna diferencia de precisión al serializar `numeric` de
  Postgres a texto vía `->>`.
- **Si existen filas con los fallbacks "duros" activados fuera de la
  ventana consultada** (antes de 2026-07-10 — aunque el mecanismo de
  `percentileScope: 'final'` con este código no debería poder existir
  antes de esa fecha, no verifiqué si una versión anterior de
  `finalizeScanPercentiles` ya escribía `percentileScope: 'final'` con
  otro código).
- **Si `sectorScore` puede llegar `null`/ausente en la práctica** (para
  confirmar si su fallback a `40` alguna vez se activa) — no audité
  `computeSectorScoresForRows`/`sectorScoreForGroup` en profundidad; en
  los 86 casos reales siempre tuvo un valor.
- **Cuántas filas de `scan_results` en total (no solo las 86 finalizadas)
  tendrían `growthScore`/`epsGrowthProxyScore` genuinamente ausentes** si
  pasaran por finalización — encontré ejemplos reales (preferentes, ETN)
  pero fuera del alcance de `percentileScope='final'` (vienen de scans de
  cron/prueba masiva que nunca finalizan, según el contexto dado), así que
  no pude medir su score de las dos formas contra un valor persistido real.
- **El efecto de la Parte D.9(c)/(d) en la UI** — no revisé qué componente
  de React renderiza el score ni si ya existe algún indicador de
  "cobertura parcial" en otro punto del producto que se pudiera reutilizar.
- **Si hay otros consumidores de `scoreCompositeValue`/`computeComposite`
  con el mismo patrón de pre-relleno de constantes** fuera de
  `lib/scanPercentileFinalization.js` — no lo busqué; el enunciado ya
  acota el alcance a este archivo.

---

Si tuviera que señalar una sola línea sin decidir por el dueño: la opción
(a) es la única que no exige elegir un umbral nuevo ni tocar la UI —
reutiliza código que ya existe y ya está probado en `scoringEngine.js`.
