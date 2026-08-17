# Diseño: contracciones de volatilidad y pivote calculados de verdad

<!-- fecha interna: 2026-08-17 · BASE_SHA: d072dd0 · rama: codex/statsedge-ui-polish -->

Documento de **diseño y medición**. No modifica código, no escribe en Supabase
y no ejecuta ningún escaneo. El prototipo que se prueba en la Parte C vive
fuera del repo (directorio temporal de sesión) precisamente para no serlo.

Contexto: el principio 7 de [`docs/principios-producto.md`](principios-producto.md)
aplazó las columnas **distancia al pivote** y **semanas de base** porque hoy no
se calculan bien. Este documento propone cómo calcularlas, y mide si la
propuesta funciona.

---

## Resumen para el dueño (sin jerga)

1. **La metodología sí es calculable.** Minervini y O'Neil dan números
   concretos: cuántos retrocesos esperar (2 a 6, típicamente 2 a 4), qué
   proporción entre ellos (cada uno ≈ la mitad del anterior), cuánto dura una
   base (4-7 semanas las planas; 7 a 65 semanas las de taza) y —lo importante—
   que **el pivote es el máximo del último retroceso, que casi siempre está por
   debajo del máximo de la base**. Eso es exactamente lo que hoy no hacemos.

2. **Lo que hay hoy está roto de la forma que sospechabas, y lo he medido en
   las 3.312 filas del nocturno**: `baseWeeks` vale 13.0 en las 3.312 (100%), y
   la distancia al pivote coincide con la distancia al máximo de 52 semanas
   —hasta la centésima— en 1.494 filas (45,1%).

3. **Se puede calcular con las barras que ya tenemos**, y cuesta nada: 0,12 ms
   por símbolo, 0,4 segundos para las 3.312 filas. El nocturno tarda hoy unos
   4,3 minutos; esto añade un 0,15%.

4. **Pero la propuesta todavía no está lista para ponerse en la tabla.** En la
   prueba contra casos reales acierta al rechazar (0 falsos positivos sobre 60
   valores sin base; 6 de 6 en los casos "bloqueados" del corpus del proyecto),
   pero solo reconoce 2 de las 8 bases que yo señalé a ojo, y 1 de los 3 casos
   positivos del corpus. Es un detector honesto pero **corto de vista**.
   Recomendación concreta en la Parte C.9.

---

## PARTE A — Qué dice la metodología

Fuentes primarias: los libros que ya están en `research/books/`. Las páginas se
citan por el número de página del PDF. No reproduzco los textos; extraigo las
reglas numéricas, que son hechos.

### A.1 Cuántas contracciones, y en qué proporción

| Regla | Valor | Fuente |
|---|---|---|
| Número de contracciones ("Ts") | de 2 a 6; **típicamente de 2 a 4** | Minervini, *Trade Like a Stock Market Wizard*, p. 213-214; *Think & Trade Like a Champion*, p. 109-110 |
| Proporción entre contracciones sucesivas | cada una **≈ la mitad de la anterior**, "más o menos una cantidad razonable" | ídem, p. 214 / p. 109 |
| Progresión de ejemplo | 25% → 15% → 8% | ídem |
| Otra progresión de ejemplo | 25% → 10% → 5% | *Trade Like a Stock Market Wizard*, p. 215 |
| Primera contracción | la más profunda del conjunto | ídem |

Casos concretos que el propio Minervini documenta, con su notación
`<semanas>W <mayor>/<menor> <n>T`:

| Valor | Footprint | Profundidades | Fuente |
|---|---|---|---|
| Meridian Bioscience (VIVO) | `40W 31/3 4T` | 31% → 17% → 8% → 3% | *T&T*, p. 113-114 |
| Michaels (MIK) | `19W 16/3 4T` | 16% → 8% → 6% → 3% | *T&T*, p. 118 |
| Mercadolibre (MELI) | `6W 32/6 3T` | 32% → … → 6% | *T&T*, p. 117 |
| Bitauto (BITA) | 8 semanas, 3T | 28% → 16% → 6% | *T&T*, p. 110 |
| FSI International (FSII) | 10 semanas | 18% en la taza → 5% en el asa | *TLSMW*, p. 213 |
| Netflix (NFLX) | `27W … 3T` | — | *T&T*, p. 113 |

Lectura operativa: **la última contracción cae casi siempre entre el 3% y el
8%**, y la primera entre el 16% y el 32%.

### A.2 Duración de la base

| Tipo de base | Duración | Corrección | Fuente |
|---|---|---|---|
| Taza (cup) | **7 a 65 semanas**; la mayoría 3-6 meses | 12-15% hasta 33%; 40-50%+ solo en bajistas severos | O'Neil, *How to Make Money in Stocks*, p. 170-171, 183 |
| Base plana (flat base) | **al menos 5-6 semanas** | no más de 10-15% | O'Neil, p. 238 |
| Caja cuadrada (Darvas) | 4 a 7 semanas | 10-15% | O'Neil, p. 244; Minervini, *TLSMW*, p. 215 |
| Base tras salida a bolsa | al menos 10 días | — | Minervini, *T&T*, p. 135 |

Además, requisito previo en O'Neil (p. 171): antes de la base debe haber una
**subida previa de al menos el 30%**, con fuerza relativa mejorando. El VCP es
un patrón de continuación (Minervini, *T&T*, p. 116): aparece después de que el
valor ya haya subido un 30, 40 o 50 por ciento.

Y la condición de entrada al análisis, en las propias palabras del método:
primero se confirma la **etapa 2**, y solo entonces se mira el patrón
(Minervini, *T&T*, p. 109). Esto es importante para el diseño: la etapa ya la
calculamos, y sirve de puerta previa.

### A.3 El papel del volumen

| Regla | Valor | Fuente |
|---|---|---|
| Volumen durante la base | contrae en los puntos más estrechos; cada contracción con menos volumen | Minervini, *TLSMW*, p. 218; *T&T*, p. 111 |
| Volumen en la contracción final | **por debajo de la media de 50 días**, con uno o dos días de volumen extremadamente bajo | Minervini, *T&T*, p. 117 |
| Volumen en la ruptura | **al menos 40-50% por encima de lo normal** | O'Neil, p. 195; Minervini, *T&T* (regla de 1,4× la media de 50 días) |
| Señal de máxima calidad | el volumen seca hasta niveles próximos a los más bajos desde que empezó el avance | Minervini, *TLSMW*, p. 218 |

### A.4 Cómo se determina el pivote

Este es el punto decisivo, y las dos fuentes coinciden:

- **O'Neil** (p. 201): el precio máximo de la zona del asa es lo que determina
  la mayoría de los puntos de compra, y ese máximo está casi siempre *algo por
  debajo* del máximo real de la base. Añade la advertencia: esperar a un máximo
  nuevo hace llegar tarde.
- **Minervini** (*T&T*, p. 116-117): el pivote se forma en la última
  contracción; la entrada se produce cuando el precio supera el máximo de ese
  pivote con volumen en expansión. En el ejemplo de VIVO, el pivote lo forma un
  retroceso corto y estrecho del 3% en dos semanas con volumen muy bajo
  (p. 114).
- El asa, además, se forma casi siempre en la **mitad superior** de la base
  medida de máximo a mínimo, por encima de la media de 10 semanas, y su caída
  debe contenerse en un **8-12%** desde su pico en mercados alcistas (O'Neil,
  p. 187, 190).

**Conclusión calculable**: `pivote = máximo de la contracción final`, y se
espera `pivote ≤ techo de la base`, con la diferencia normalmente entre 0% y
12%. Si el pivote sale idéntico al máximo de la base o al máximo de 52 semanas
en la mitad de las filas, el cálculo está mal — que es justo lo que pasa hoy.

### A.5 Fuentes web consultadas

Complementarias, útiles solo para vocabulario y umbrales de practicantes; los
números de arriba salen de los libros:

- [TradingSim — VCP guide](https://www.tradingsim.com/blog/volatility-contraction-pattern)
- [TraderLion — Pivot points](https://traderlion.com/technical-analysis/pivot-points/)
- [TrendSpider — VCP](https://trendspider.com/learning-center/volatility-contraction-pattern-vcp/)
- [FinerMarketPoints — VCP criteria](https://www.finermarketpoints.com/post/vcp-criteria-complete-checklist)
- [ChartMill — Minervini strategy](https://www.chartmill.com/documentation/stock-screener/fundamental-analysis-investing-strategies/465-Mark-Minervini-Strategy-Think-and-Trade-Like-a-Champion-Trading-Strategy)

(La página de TraderLion sobre VCP citada en `docs/methodology/vcp-spec.md`
devuelve hoy **HTTP 403** a peticiones automatizadas; no he podido releerla.)

---

## PARTE B — Qué hay hoy en el código

### B.1 Dónde vive

| Pieza | Archivo |
|---|---|
| Medición del patrón | [`lib/setupPatterns.js`](../lib/setupPatterns.js) |
| Narrativa y rechazo estricto | [`lib/patternNarrative.js`](../lib/patternNarrative.js) |
| Veredictos | [`lib/methodologyVerdict.js`](../lib/methodologyVerdict.js), [`lib/methodologyDisplay.js`](../lib/methodologyDisplay.js) |
| Diagnóstico compacto | [`lib/vcpDiagnostics.js`](../lib/vcpDiagnostics.js) |
| Especificación escrita | [`docs/methodology/vcp-spec.md`](methodology/vcp-spec.md) |
| Corpus de calibración | [`docs/methodology/vcp-corpus.json`](methodology/vcp-corpus.json) (18 casos) |

### B.2 Qué calcula, con qué ventana

El detector es `setupPatternForBars(bars, options)`
([`lib/setupPatterns.js:421`](../lib/setupPatterns.js:421)). Sus ventanas están
fijadas en el código, no derivadas del valor:

```js
// lib/setupPatterns.js:425-428
const baseRows  = rows.slice(0, Math.min(65, rows.length));   // "la base": 65 sesiones fijas
const pivotRows = rows.slice(1, Math.min(66, rows.length));   // "el pivote": las 65 anteriores
const base      = rangeStats(baseRows);
const pivotPrice = rangeStats(pivotRows).high;                // = máximo de esas 65 sesiones
```

y de ahí salen los dos campos que se muestran:

```js
// lib/setupPatterns.js:543-544
baseDays: baseRows.length,
baseWeeks: baseRows.length ? baseRows.length / 5 : null,
```

```js
// lib/setupPatterns.js:435
const distanceToPivotPct = Number.isFinite(price) && Number.isFinite(pivotPrice) && pivotPrice > 0
  ? ((price / pivotPrice) - 1) * 100 : null;
```

**Por qué produce una constante**: `baseWeeks` no mide nada del valor. Es
`min(65, nº de barras) / 5`. Como el nocturno guarda 400 barras por símbolo
(`WRITE_CAP_DEFAULT = 400` en [`lib/dailyBarsCache.js:19`](../lib/dailyBarsCache.js:19)),
`rows.length ≥ 65` siempre, y el cociente es siempre `65/5 = 13.0`.

**Por qué el pivote es el máximo reciclado**: `pivotPrice` es el máximo de las
65 sesiones anteriores a hoy. En un valor que está cerca de máximos anuales,
ese máximo *es* el máximo de 52 semanas. No tiene ninguna relación con la
última contracción.

Además existen piezas que sí intentan estructura —`localPivots`
([`:157`](../lib/setupPatterns.js:157)), `contractionSequence`
([`:185`](../lib/setupPatterns.js:185)), `decreasingSequence`
([`:213`](../lib/setupPatterns.js:213)), `consolidationContext`
([`:265`](../lib/setupPatterns.js:265)) y `structuralContractions`
([`:357`](../lib/setupPatterns.js:357))— pero ninguna alimenta a `baseWeeks` ni
a `pivotPrice`. Son un circuito paralelo que produce `contractionCount`,
`contractionsDecreasing` y `contractionStructureStatus`.

### B.3 La medición, sobre las 3.312 filas del nocturno del 17-08-2026

Escaneo medido: `scans.local_id = materialized:US:2026-08-17:t040137:o0:l5609`,
`id = cea57d44-6424-42fc-bd55-93fe8153f346`, `row_count = 3312`.

Consulta (MCP `supabase_query`):

```
table=scans  select=*  order=created_at.desc  limit=3
```

Descarga de las métricas de patrón de las 3.312 filas (REST de solo lectura,
4 páginas de 1.000; `$SEL` abreviado):

```
GET /rest/v1/scan_results
  ?scan_id=eq.cea57d44-6424-42fc-bd55-93fe8153f346
  &select=symbol,baseWeeks:metrics->>baseWeeks,pivotDist:metrics->>distanceToPivotPct,
          dist52w:metrics->>distance52w,cCount:metrics->>contractionCount,
          cStatus:metrics->>contractionStructureStatus,setup:metrics->>setupDisplayKey
  &order=rank_index.asc&limit=1000&offset={0,1000,2000,3000}
```

Resultados:

| Medida | Resultado |
|---|---|
| `baseWeeks` distintos en 3.312 filas | **uno solo: `13`** (3.312 de 3.312, 100%) |
| \|dist. al pivote\| = \|dist. máx 52s\| dentro de 0,01 pp | **1.494 filas (45,1%)** |
| …dentro de 0,1 pp | 1.520 (45,9%) |
| …dentro de 1,0 pp | 1.696 (51,2%) |
| `contractionStructureStatus` = `ok` | 830 (25,1%) |
| …`lower_low_drift` | 1.109 (33,5%) |
| …`not_consolidating` | 860 (26,0%) |
| …`depth_reexpansion` | 477 (14,4%) |
| `contractionsDecreasing` = true | 338 (10,2%) |
| `setupDisplayKey` = `actionable_vcp` | 11 |

Es decir: tus cinco fichas no eran una casualidad. `baseWeeks` es constante en
**todo** el universo, y el pivote coincide con el máximo de 52 semanas en
**casi la mitad** de las filas.

### B.4 ¿Hay algo aprovechable?

**Sí, bastante — pero no las dos cifras que queremos mostrar.**

Aprovechable tal cual:

- La **puerta de datos** `patternDataGate` ([`:124`](../lib/setupPatterns.js:124)):
  mínimo de barras, frescura del precio, cobertura de OHLC y de volumen. Es
  exactamente lo que hace falta para decidir cuándo *no* se puede afirmar nada.
- El **vocabulario de motivos de rechazo** (`lower_low_drift`,
  `depth_reexpansion`, `ceiling_break`, `pivot_noise`) y su traducción en
  [`lib/vcpDiagnostics.js:44`](../lib/vcpDiagnostics.js:44). Los motivos son
  correctos conceptualmente y ya están en español.
- El **corpus** `docs/methodology/vcp-corpus.json` y el arnés
  `npm run audit:vcp:corpus`: 18 casos con etiqueta humana. Es el activo más
  valioso que hay aquí (con una limitación seria, ver C.8.3).
- Los **filtros ya declarados** en `lib/screenerFilterCatalog.js:239`
  (`minBaseWeeks`, `maxBaseWeeks`, `maxAbsDistanceToPivotPct`,
  `minContractionCount`, `maxContraction1DepthPct`…). El contrato de filtro no
  hay que inventarlo: existe. Lo que falla es el dato que compara.

A rehacer:

- `baseRows`/`pivotRows`/`baseWeeks`/`pivotPrice` (líneas 425-428 y 543-544).
  No son medidas del valor.
- `localPivots` con radio fijo de 3 y sin amplitud mínima
  ([`:157`](../lib/setupPatterns.js:157)): produce ruido. En una base larga
  cuenta decenas de "contracciones" de 3%.
- `consolidationContext` ([`:265`](../lib/setupPatterns.js:265)): decide si hay
  base con ventanas fijas de 65/130 sesiones y un marcador compuesto de puntos
  (`baseContextScore`). Es un modelo de puntuación, no una medida geométrica; no
  puede decir *dónde* empieza la base.

**Veredicto: rehacer el núcleo geométrico, conservar la puerta de datos, el
vocabulario, el corpus y el contrato de filtros.**

---

## PARTE C — Qué se puede calcular

### C.1 Materia prima disponible

`daily_bars` (columnas: `symbol`, `trade_date`, `open`, `high`, `low`, `close`,
`adj_close`, `volume`, `currency`, `provider`, `updated_at`). Verificado:

```
GET /rest/v1/daily_bars?symbol=eq.NVDA&owner_id=eq.personal&select=trade_date
    &order=trade_date.asc&limit=1     →  2021-09-08
GET /rest/v1/daily_bars?symbol=eq.NVDA&owner_id=eq.personal&select=trade_date
    &order=trade_date.desc&limit=1    →  2026-08-14
    Prefer: count=exact               →  content-range: 0-999/1260
```

Profundidad real: **400 barras** para el símbolo corriente y **1.260** para los
referenciados por el usuario (`WRITE_CAP_DEFAULT` / `WRITE_CAP_REFERENCED`,
[`lib/dailyBarsCache.js:19-20`](../lib/dailyBarsCache.js:19)). Comprobado en
diez símbolos: META, ISRG, XOM, MCD, AAPL, COST, WELL, BRK-B y MSFT empiezan
todos en `2025-01-10`; NVDA (referenciado) en `2021-09-08`.

400 barras ≈ 19 meses. Suficiente para una base de hasta 45 semanas más su
contexto previo. **No** suficiente para reproducir los casos históricos del
corpus (2022-2024), ver C.8.3.

### C.2 Lo que se puede detectar, y con qué algoritmo

Los cuatro puntos que pedías, uno por uno.

#### (a) Dónde empieza y acaba una base

**Acaba hoy** (la base vigente es la que interesa a un screener).

**Empieza en el máximo desde el que el precio dejó de avanzar.** Criterio
operativo, verificable línea a línea:

1. Calcular `ATR20%` = ATR de 20 sesiones dividido por el cierre, en tanto por
   ciento.
2. Umbral de swing `θ = clamp(1,2 · ATR20%, 3%, 10%)`.
3. Candidatos a inicio: cada **máximo local** (radio 3 sesiones) seguido de una
   caída de al menos `θ`.
4. Un candidato `s` es válido si, desde `s` hasta hoy, el máximo del intervalo
   no supera `high(s)` en más de `tol = max(3%, 25% · profundidad del intervalo)`
   — la tolerancia escala con la profundidad porque un techo del 20% de
   profundidad no es una línea perfecta— y la profundidad no pasa del 35%.
5. Se evalúan **todos** los candidatos válidos y se elige la base completa que
   pase los filtros de calidad; entre varias válidas anidadas, la más larga.

Parámetros: `atrLen=20`, `pivotK=1,2`, `θ∈[3,10]%`, `radio=3`,
`ceilingTolPct=3`, `ceilingTolDepthFrac=0,25`, `maxBaseDepthPct=35`,
`minBaseBars=20` (4 semanas), `maxBaseBars=225` (45 semanas).

#### (b) Cada retroceso dentro de ella y su profundidad

Dos algoritmos probados. El segundo es el que reproduce las cifras publicadas.

- **Codicioso desde el techo** (v3): C1 = techo → mínimo global de la base;
  C2 = máximo posterior → mínimo posterior; y así. Determinista y sin
  parámetros de swing, pero en bases largas se salta estructura intermedia.
- **Zigzag ligado a la profundidad** (v5): swings alternados dentro de la base
  con umbral `θ_C = max(2,5%, 0,5·ATR20%, 0,15 · profundidad de la base)`.
  Ligar el umbral a la profundidad es lo que evita contar 70 micro-swings en
  una base del 30%.

Profundidad de cada contracción: `(máximo − mínimo) / máximo · 100`, que es la
definición de Minervini (de máximo a mínimo). Se exige duración mínima de 3
sesiones por contracción y un máximo de 6 contracciones (el techo del método).

Evidencia de que el zigzag mide lo correcto: para **WELL a 2026-05-14**, el
corpus del proyecto documenta `10.2% → 7.5% → 5.0%`; el prototipo mide
`10.8 → 9.4 → 7.5 → 5.0`. Los tres últimos coinciden con una diferencia
inferior a 0,1 pp.

#### (c) Si los retrocesos son decrecientes

Regla derivada de "cada uno ≈ la mitad, ± una cantidad razonable":

```
decreciente(i) ⟺  d(i) ≤ 0,75 · d(i−1)   ó   d(i) ≤ d(i−1) − 1,5 pp
```

El segundo término es necesario porque cuando `d` ya es pequeña (5% → 3,5%) la
proporción del 75% deja de ser exigible en términos absolutos.

Además, dos comprobaciones estructurales de la propia metodología:

- **Los mínimos no deben derivar a la baja**: `L(i) ≥ L(i−1) · (1 − tol)`. La
  tolerancia importa: O'Neil admite explícitamente que un valor perfore
  brevemente el mínimo (*shakeout*) y el patrón siga siendo válido. He probado
  `tol = 2%` (estricto) y `tol = 4%` (laxo).
- **El techo debe aguantar**: el máximo de la base no se supera de forma
  sostenida.

#### (d) El máximo de la contracción final

`pivote = high de la última contracción`. Se reporta además
`pivotBelowBaseHighPct = (1 − pivote / techo) · 100`, que es la comprobación de
sanidad de la Parte A.4: debe ser ≥ 0 y normalmente ≤ 12%.

En las bases detectadas en la prueba: DAL 0,5%, RLAY 0,4%, COST 0,3%,
WELL 1,7%, BHP 9,1%. **Ninguna sale 0,0% por construcción**, que es lo que hoy
pasa con el máximo de 65 sesiones.

### C.3 Puertas de calidad de la base

| Puerta | Umbral | Origen |
|---|---|---|
| Duración | ≥ 20 sesiones (4 semanas), ≤ 225 (45 semanas) | O'Neil p. 238, 244; p. 170 |
| Profundidad | ≤ 35% | O'Neil p. 171 (12-33%), holgura del 2% |
| Avance previo | ≥ 20% en las 130 sesiones anteriores al inicio | O'Neil p. 171 (30%), rebajado |
| La base se forma arriba | techo ≥ 90% del máximo de 52 semanas | derivada: el VCP es continuación |
| El precio vive en la mitad alta | `(cierre − suelo)/(techo − suelo) ≥ 0,5` | O'Neil p. 187 (el asa, en la mitad superior) |
| Pivote no lejos del techo | `pivotBelowBaseHighPct ≤ 12%` | O'Neil p. 190 (asa 8-12%) |
| Estructura regular | swings estructurales ≤ nº de contracciones + 1 | derivada: las Ts describen la base |

### C.4 Volumen

Tres medidas, todas contra la media de 50 sesiones:

- `lastContractionVolRatio` = volumen medio de la contracción final / media 50.
  Debe ser < 1,0 (Minervini, *T&T* p. 117).
- `lastContractionMinVolRatio` = volumen mínimo de la contracción final / media
  50. Captura el "uno o dos días de volumen extremadamente bajo".
- Serie `contractionVolRatios`, una por contracción, para ver si el volumen se
  seca de izquierda a derecha.

Medidos en las bases detectadas: DAL 0,57 · RLAY 0,58 · COST 0,99 · WELL 1,06.

### C.5 Ausencia explícita

El detector devuelve siempre un motivo cuando no hay base:
`price_still_advancing`, `too_short`, `too_deep`, `no_prior_advance`,
`base_below_52w_high`, `price_in_lower_half`, `no_contraction`,
`fewer_than_2_contractions`, `lower_low_drift`, `depth_reexpansion`,
`irregular_structure`, `pivot_far_below_ceiling`. Nunca un número por defecto.

---

## C.8 — La prueba contra casos reales

### C.8.1 Cómo elegí los casos (y por qué así)

Etiquetar a ojo tiene el riesgo de que uno vea lo que el algoritmo va a
encontrar. Para evitarlo:

1. **Muestra aleatoria, semilla fija.** De las 3.312 filas del nocturno filtré
   por liquidez (capitalización ≥ 1.000 M, precio ≥ 10, rotación media ≥ 5 M) →
   2.223 valores; de ahí una muestra aleatoria de 44 con `random.seed(20260817)`.
2. **Estrato dirigido**, porque las bases de continuación viven donde por
   definición viven: etapa 2, a ≤12% del máximo de 52 semanas, rentabilidad 12m
   ≥ 20% → 614 valores; muestra aleatoria de 24 con la misma semilla.
3. **Etiqueté los 68 a ojo antes de escribir el detector**, mirando gráficos
   diarios generados a partir de las barras de producción (260 y 150 sesiones,
   precio + volumen). Criterio declarado: consolidación **vigente** tras un
   avance, con al menos dos retrocesos, ≥4 semanas, y el precio hoy dentro del
   rango (ni roto al alza ni hundido).
4. Solo después ejecuté el prototipo y comparé.

Consultas exactas de la selección:

```
GET /rest/v1/scan_results?scan_id=eq.cea57d44-…&select=symbol,price:metrics->>price,
    mcap:metrics->>marketCap,turn:metrics->>avgTurnover,stage:metrics->>weeklyStageState,
    d52:metrics->>distance52w,p12:metrics->>perf12m&order=symbol.asc&limit=1000&offset=…

GET /rest/v1/daily_bars?symbol=eq.<SYM>&owner_id=eq.personal
    &select=trade_date,open,high,low,close,volume&order=trade_date.desc&limit=520
```

**Resultado del etiquetado**: de 68 valores revisados encontré **8 con base
evidente** (APGE, BUD, BHP, DAL, SKWD, JAZZ, XMTR, RLAY) y **60 sin ella**. No
llegué a diez con base: en el mercado del 14 de agosto de 2026, entre 68
valores líquidos, no había diez bases nítidas. Lo digo en vez de rellenar la
lista con casos dudosos.

Para compensar añadí una **verdad terreno independiente de mi ojo**: los casos
del corpus del proyecto (`docs/methodology/vcp-corpus.json`) cuya fecha `asOf`
cae dentro del histórico disponible: 3 positivos (1 `plan`, 2 `watch`) y 6
`block`.

### C.8.2 Resultados

Dos parametrizaciones: **estricto** (las puertas de secuencia bloquean la base)
y **laxo** (la base es geométrica; la secuencia es un atributo aparte).

#### Los 8 que etiqueté con base

| Valor | estricto | contracciones | pivote | dist. | bajo techo | motivo de rechazo | laxo |
|---|---|---|---|---|---|---|---|
| APGE | sin base | — | — | — | — | `price_still_advancing` | sin base |
| BUD | sin base 11,2s | 9,0 | 86,60 | −7,9% | 0,0% | `irregular_structure`, `price_in_lower_half`, `fewer_than_2_contractions` | sin base |
| BHP | sin base 13,0s | 18,1 | 93,83 | −7,5% | 0,0% | `irregular_structure`, `fewer_than_2_contractions` | **base** 13,0s · 14,8→9,2→4,5 |
| DAL | **base 7,2s** | 15,5→6,9 | 95,01 | −6,0% | 0,5% | — | base 7,2s |
| SKWD | sin base 2,8s | 10,7 | 65,69 | −9,0% | 0,0% | `too_short`, `price_in_lower_half` | sin base |
| JAZZ | sin base 2,8s | 9,2 | 265,05 | −7,6% | 0,0% | `too_short`, `price_in_lower_half` | sin base |
| XMTR | sin base 10,6s | 24,0 | 106,08 | −9,3% | 0,0% | `irregular_structure`, `fewer_than_2_contractions` | sin base |
| RLAY | **base 5,4s** | 14,8→6,5 | 20,71 | −4,1% | 0,4% | — | sin base |

**2 de 8** con la parametrización estricta.

#### Los 60 que etiqueté sin base (12 primeros del muestreo)

| Valor | estricto | motivo | laxo |
|---|---|---|---|
| NN | sin base | `price_still_advancing` | sin base |
| BEKE | sin base 44,2s | `irregular_structure`, `price_in_lower_half`, `pivot_far_below_ceiling`, `no_prior_advance` | **base** (falso positivo) |
| AVAH | sin base | `price_still_advancing` | sin base |
| VRDN | sin base 0,8s | `too_short`, `base_below_52w_high`, `price_in_lower_half` | sin base |
| CUZ | sin base 4,2s | `price_in_lower_half`, `fewer_than_2_contractions` | sin base |
| FND | sin base 21,0s | `irregular_structure`, `base_below_52w_high`, `no_prior_advance` | sin base |
| D | sin base 4,2s | `price_in_lower_half`, `fewer_than_2_contractions` | sin base |
| ELE | sin base 18,8s | `irregular_structure`, `base_below_52w_high` | sin base |
| DLR | sin base 15,6s | `irregular_structure`, `fewer_than_2_contractions` | **base** (falso positivo) |
| WEC | sin base 22,8s | `irregular_structure`, `price_in_lower_half`, `no_prior_advance` | sin base |
| SPGI | sin base 31,6s | `irregular_structure`, `price_in_lower_half`, `no_prior_advance` | sin base |
| CFG | sin base 4,4s | `irregular_structure`, `fewer_than_2_contractions` | sin base |

**Agregado sobre los 60**: parametrización estricta **0 falsos positivos**;
parametrización laxa **12 falsos positivos** (BEKE, DLR, LNG, HBM, DHR, ES,
WOR, SPXC, RIO, TECK, FANG, CCNE).

#### Corpus del proyecto (etiqueta humana previa, independiente de mi ojo)

| Caso | esperado | estricto | contracciones | pivote | dist. | bajo techo | resultado |
|---|---|---|---|---|---|---|---|
| 3988.HK 2026-05-28 | plan | sin base 5,2s | 5,1 | 5,19 | −3,8% | 0,0% | ✗ perdido |
| COST 2026-05-07 | watch | **base 7,8s** | 6,7→3,9 | 1029,63 | −1,9% | 0,3% | ✓ |
| WELL 2026-05-14 | watch | sin base 35,8s | 13,7 | 221,68 | −2,1% | 0,0% | ✗ perdido |
| BRK-B 2026-06-02 | block | sin base | 10,2→4,4 | 489,42 | −3,7% | 5,3% | ✓ |
| 3988.HK 2026-06-03 | block | sin base 0,8s | — | — | — | — | ✓ |
| ISRG 2026-06-02 | block | sin base | 34,3 | 603,88 | −33,4% | 0,0% | ✓ |
| AAPL 2026-06-01 | block | sin base 13,0s | 22,1 | 314,73 | −2,8% | 0,0% | ✓ |
| META 2026-06-02 | block | sin base | 34,5→14,3→7,2 | 642,40 | −7,1% | 19,1% | ✓ |
| MSFT 2026-06-02 | block | sin base | 30,3 | 510,27 | −13,5% | 0,0% | ✓ |

**7 de 9**: los 6 `block` correctos, 1 de 3 positivos.

#### Barrido de sensibilidad

Probé 48 combinaciones de `maxExtraSwings` ∈ {1,2,3,∞},
`minContractionBars` ∈ {2,3}, `minContractionPct` ∈ {2,0; 2,5; 3,0} y
`minClosePosInBase` ∈ {0,4; 0,5}. Ningún punto del espacio sube de **3 de 8**
en sensibilidad, y a partir de ahí los falsos positivos crecen más deprisa que
los aciertos. **Aflojar no arregla el problema**: es estructural, no de umbral.

### C.8.3 Diagnóstico honesto de los fallos

Los seis casos perdidos se reparten en tres grupos, y solo uno es un fallo
inequívoco del algoritmo:

1. **Discrepancia de criterio, y el algoritmo tiene razón** (SKWD, JAZZ): bases
   de 2,8 semanas. Ni O'Neil (mínimo 5-6 semanas para una base plana) ni
   Minervini (4-7 semanas) las admitirían. Mi ojo fue generoso.
2. **Discrepancia de criterio, discutible** (APGE, BUD): el precio seguía
   marcando máximos crecientes por encima de la tolerancia del techo. Lo que yo
   leí como "consolidación" el algoritmo lo lee como "sigue avanzando". No
   tengo forma objetiva de decidir quién tiene razón sin datos de resultado.
3. **Fallo real** (BHP, XMTR, WELL, 3988.HK): hay estructura y el algoritmo la
   mide bien —en WELL reproduce las profundidades del corpus con menos de
   0,1 pp de error— pero la rechaza por `irregular_structure` o
   `fewer_than_2_contractions`. La causa es que el detector elige una base
   demasiado larga (WELL 35,8 semanas cuando la real ronda las 12) y dentro de
   ella la estructura se ve irregular.

**La causa raíz del fallo real: la elección de qué base, entre varias
anidadas, es "la actual".** Ese es el problema abierto, y es el que hay que
resolver antes de mostrar nada.

Limitación adicional del corpus: **13 de los 18 casos no son reproducibles**
desde `daily_bars` porque sus fechas `asOf` (2022-2025) caen fuera de las 400
barras que se retienen. Solo pude usar 9. El arnés actual
(`npm run audit:vcp:corpus`) los reproduce porque descarga barras del proveedor
en vivo, no de la base.

### C.9 Recomendación

**No poner "semanas de base" ni "distancia al pivote" en la tabla todavía.** El
principio 7 sigue aplicándose: con 2 de 8, el 75% de las bases reales saldrían
como "sin base", y eso es un dato falso con aspecto de preciso, igual que el
13,0 constante — solo que en la otra dirección.

Lo que sí propongo hacer, en este orden:

1. **Resolver la selección de base entre candidatos anidados.** Es un problema
   acotado: en vez de "la válida más larga", puntuar cada base candidata por
   calidad de estructura (contracciones decrecientes, volumen que seca, pivote
   cerca del techo) y elegir la mejor. Es donde está el 100% del fallo real.
2. **Ampliar el corpus con casos actuales** (as-of ≤ 400 barras), para poder
   calibrar contra etiquetas humanas sin depender del proveedor en vivo.
3. **Reevaluar con el objetivo explícito**: ≥ 6 de 8 en sensibilidad
   manteniendo 0 falsos positivos sobre 60. Si se consigue, entra en la ficha
   primero (donde hay espacio para el motivo), y solo después en la tabla.
4. Mientras tanto, **quitar los filtros que hoy comparan contra el dato roto**:
   `minBaseWeeks`/`maxBaseWeeks` (`lib/screenerFilterCatalog.js:168-169`) filtran
   sobre una constante — `minBaseWeeks=14` deja el resultado vacío siempre y
   `maxBaseWeeks=12` también, sin que nada lo explique.

---

## PARTE D — El coste

### D.1 Tiempo de cálculo, medido

Prototipo en Node 26 sobre las barras reales de 76 símbolos (401 barras de
media), 20 repeticiones tras calentamiento:

| Variante | ms/símbolo | 3.312 filas | 5.609 analizados |
|---|---|---|---|
| Codicioso (v3) | **0,111** | 0,37 s | 0,62 s |
| Zigzag (v5) | **0,117** | 0,39 s | 0,66 s |

### D.2 En contexto

El nocturno actual tarda **≈4,3 minutos** para el universo estadounidense, con
**45,6 ms/símbolo efectivos** dominados por la lectura de barras
([`docs/adr-escaneo-nocturno.md:332`](adr-escaneo-nocturno.md)). El detector
añade 0,12 ms sobre esos 45,6: **un 0,26% del coste por símbolo, 0,15% del
tiempo total**.

Y no hay coste de datos: `setupPatternForBars` ya se ejecuta esta noche sobre
las mismas barras, ya cargadas en memoria. Esto **sustituye** un cálculo, no lo
añade.

**Conclusión: el coste no es un argumento en contra. Es despreciable.**

### D.3 Qué campos guardar para filtrar sin recalcular

La fila ligera (`lib/scanLightProjection.js`) pesa 7.233 B frente a 46.481 B de
la completa, y el 98,8% de las filas se guardan ligeras. Todo lo que se añada
va en las 3.312. Propuesta: **13 campos escalares**, sin objetos anidados.

| Campo | Tipo | Para qué |
|---|---|---|
| `baseStartDate` | fecha | mostrar "base desde…" en la ficha |
| `baseWeeks` | número | columna y filtros `minBaseWeeks`/`maxBaseWeeks` |
| `baseHigh` | número | techo; línea del gráfico |
| `baseLow` | número | suelo; profundidad recomputable |
| `baseDepthPct` | número | filtro `maxBaseDepthPct` |
| `contractionCount` | entero | filtro `minContractionCount` |
| `contractionDepths` | array corto (≤6) | la secuencia "31→17→8→3"; ficha |
| `contractionsDecreasing` | booleano | filtro `requireContractionsDecreasing` |
| `lastContractionDepthPct` | número | filtro `maxLastContractionDepthPct` |
| `pivotPrice` | número | línea del gráfico |
| `distanceToPivotPct` | número | columna y filtro `maxAbsDistanceToPivotPct` |
| `pivotBelowBaseHighPct` | número | control de sanidad: si sale 0 en masa, algo va mal |
| `lastContractionVolRatio` | número | filtro de volumen seco |
| `baseStatus` / `baseReason` | texto corto | la ausencia explícita del principio 3 |

Los 11 nombres que ya existen (`baseWeeks`, `contractionCount`,
`contractionDepths`, `contractionsDecreasing`, `lastContractionDepthPct`,
`pivotPrice`, `distanceToPivotPct`, `baseDepthPct`, `absDistanceToPivotPct`,
`volumeDryUpRatio`, `contractionStructureStatus`) **ya están en `RULE_FIELDS`
(`lib/scanLightProjection.js:59`) y `GATE_FIELDS` (`:107`)**. Cambia el valor, no el
contrato. Los nuevos serían tres: `baseStartDate`, `baseHigh`/`baseLow` y
`pivotBelowBaseHighPct`. Coste estimado: **+120 B por fila ligera** (+1,7%).

Lo que **no** hay que persistir: las series de swings completas
(`contractionSwings`, `measuredContractionSwings`, `rejectedContractionSwing`).
Hoy ocupan sitio en `metrics` y solo las lee la ficha, que puede recalcularlas
en el momento con las barras que ya carga para el gráfico.

---

## PARTE E — Cómo se muestra

Recordatorio del principio 1: "tres contracciones decrecientes" es descripción;
"comprar en el pivote" no lo es. Lo que sigue se ciñe a describir.

### E.1 En la tabla

**Una sola columna nueva, no dos.** Las siete columnas actuales
(`lib/screenerColumns.jsx`: ticker, tema, RS, etapa, rendimiento, dist. máx 52s,
capitalización) ya llenan la pantalla, y el principio 7 avisa: nueve aprietan.

Propuesta: columna **«Base»**, con dos datos en una celda:

```
14 sem
−2,4% del pivote
```

La primera línea es el tiempo; la segunda, la distancia. Es el footprint de
Minervini reducido a lo que cabe. La distancia va con signo: negativo = por
debajo del pivote. **Sin colores de semáforo y sin ordenación por defecto**: un
número por el que se ordena y se destaca el primero está señalando (principio 1).

Qué sale a cambio: **«Dist. máx 52s»**. Es la candidata natural porque la
distancia al pivote la sustituye con ventaja —dice lo mismo (si llegas tarde) y
además dice respecto a qué nivel operable—, y porque hoy es el dato con el que
la distancia al pivote se confunde en el 45,1% de las filas. En la ficha se
queda.

### E.2 En la ficha

Aquí sí cabe el footprint completo, y es donde la ausencia se explica:

```
BASE
Desde el 12 de mayo de 2026 · 14 semanas · profundidad 18,4%

Contracciones          16,2%  →  8,1%  →  4,3%
Volumen por tramo      1,04x  →  0,81x  →  0,58x   (media de 50 sesiones)

Pivote  95,01          2,1% por debajo del máximo de la base (97,05)
Precio  92,88          −2,4% respecto al pivote
```

Tres decisiones deliberadas:

- **La secuencia de profundidades es el dato**, no un marcador de calidad. Un
  operador que sigue el método lee `16,2 → 8,1 → 4,3` y ya sabe todo lo que
  necesita. Un "calidad de patrón: 78" no le dice nada y sugiere un juicio.
- **El pivote se muestra siempre junto a su distancia al techo.** Es la
  comprobación que hoy falta: si el pivote es el máximo de la base, esa línea
  dice "0,0% por debajo" y el usuario ve el problema sin que se lo escondamos.
- **Nada de «entrada», «objetivo», «stop»**. La columna «Objetivo» que el
  principio 1 marcaba para revisar es el precedente exacto que no repetir.

El gráfico de la ficha ya tiene un conmutador `VCP`
([`docs/methodology/vcp-spec.md`](methodology/vcp-spec.md), última línea): pintar
ahí el techo, el suelo, el pivote y las marcas C1/C2/C3 con su profundidad es la
forma más barata de que el usuario **audite el cálculo con sus ojos**. Eso vale
más que cualquier puntuación.

### E.3 En el filtro

Los controles ya existen en `lib/screenerFilterCatalog.js:239`, bloque
«Estructura / patrones». Lo que hay que hacer es **reducirlos a los cuatro que
un operador usa**, y que el principio 2 pide:

| Control | Rango | Qué hace |
|---|---|---|
| Semanas de base | 4 – 45 | duración |
| Distancia al pivote | ±% | cercanía |
| Contracciones mínimas | 2 – 4 | el conteo de Ts |
| Contracciones decrecientes | sí/no | la regla de la mitad |

Los ocho restantes (`maxContraction1DepthPct`, `maxContraction2DepthPct`,
`maxContraction3DepthPct`, `maxLastContractionDepthPct`, `maxBaseDepthPct`,
`maxVolumeDryUpRatio`, `maxTightness10dPct`, `minPatternQualityScore`) van a un
plegable «avanzado» o desaparecen. Nadie filtra por "profundidad de la
contracción 2 máxima".

**Importante**: mientras el dato siga roto, `minBaseWeeks` y `maxBaseWeeks`
deberían estar **desactivados**, no con valores neutros. Hoy están activos en el
preset (`minBaseWeeks: 0`, `maxBaseWeeks: 999`) y cualquier valor que el usuario
ponga fuera del rango 13,0 vacía el resultado sin explicación.

### E.4 Cuando no hay base detectable

Ausencia explícita, con motivo, y en el sitio donde falta (principio 5, la
excepción):

| Sitio | Qué se muestra |
|---|---|
| Tabla | `—` en la celda «Base», con el icono de información |
| Tooltip | el motivo en una línea: «sin base: el precio sigue marcando máximos» |
| Ficha | bloque BASE con el motivo en prosa y **sin ningún número** |

Traducción de los motivos, para no repetir el error de "Contrato largo
degradado" (principio 2):

| Motivo interno | Texto al usuario |
|---|---|
| `price_still_advancing` | El precio sigue marcando máximos: no hay consolidación que medir |
| `too_short` | Consolidación de menos de 4 semanas: demasiado corta para medirla |
| `too_deep` | El rango supera el 35%: es una corrección, no una base |
| `no_prior_advance` | No hay subida previa: una base de continuación necesita algo que consolidar |
| `base_below_52w_high` | La consolidación está lejos de máximos anuales |
| `price_in_lower_half` | El precio está en la mitad baja del rango |
| `fewer_than_2_contractions` | Solo un retroceso medible: hacen falta dos |
| `lower_low_drift` | Los mínimos no aguantan: el suelo va cediendo |
| `depth_reexpansion` | Los retrocesos vuelven a ampliarse |
| `irregular_structure` | El movimiento dentro del rango no forma una secuencia legible |
| `insufficient_history` / puerta de datos | Histórico insuficiente para medir la estructura |

Y una regla que conviene escribir ahora: **si el motivo es de datos, se dice que
es de datos**; si es de estructura, se dice que es de estructura. Son cosas
distintas y el usuario decide distinto con cada una.

---

## CONFIANZA

**Alta** (medido, con la consulta reproducible en el documento):

- `baseWeeks` = 13 en las 3.312 filas del nocturno del 17-08-2026. Es una
  constante del detector, no una medida del valor. Causa localizada en
  `lib/setupPatterns.js:425` y `:544`.
- La distancia al pivote coincide con la distancia al máximo de 52 semanas
  dentro de 0,01 pp en 1.494 filas (45,1%). Causa en `lib/setupPatterns.js:426-428`.
- El coste de cálculo: 0,117 ms/símbolo, 0,39 s para las 3.312 filas, sobre
  barras reales de producción y con el motor (Node) en el que correría.
- La profundidad real de `daily_bars`: 400 barras (1.260 para referenciados),
  verificada en 11 símbolos.
- Los resultados del prototipo sobre los 68 valores y los 9 casos del corpus:
  0 falsos positivos sobre 60 en la parametrización estricta; 2 de 8 en
  sensibilidad; 7 de 9 en el corpus. Todos reproducibles con las barras
  descargadas.

**Media** (fundamentado, pero con juicio de por medio):

- Los umbrales propuestos (θ = 1,2·ATR20%, tolerancia de techo del 25% de la
  profundidad, ratio de decrecimiento 0,75). Salen de las reglas de los libros
  traducidas a números, pero la traducción es mía y hay margen.
- La atribución de los seis fallos a tres causas (C.8.3). El grupo 2 (APGE,
  BUD) es genuinamente discutible.
- Que la columna que debe salir a cambio sea «Dist. máx 52s». Es un argumento
  de producto, no una medición.

**Baja** (opinión declarada como tal):

- Que resolver la selección de base entre candidatos anidados baste para llegar
  a 6 de 8. Es mi diagnóstico, no un resultado.
- El formato concreto de la celda de tabla y del bloque de ficha. Son bocetos.

---

## LO QUE NO HE VERIFICADO

1. **No he ejecutado el detector actual (`setupPatternForBars`) fuera de
   producción** para compararlo lado a lado con el prototipo sobre las mismas
   barras. Sus importaciones usan el alias `@/lib` y habría hecho falta montar
   el build de Next. La comparación de la Parte B es entre el **código leído** y
   los **valores persistidos**, no una ejecución controlada.

2. **La verdad terreno de los 68 valores es mi juicio visual, un solo
   observador, sin doble ciego.** Etiqueté antes de ver los resultados, pero no
   hay una segunda opinión ni un criterio externo. Los 9 casos del corpus sí son
   independientes de mí — y ahí la sensibilidad fue aún peor (1 de 3).

3. **No he medido si las bases detectadas anticipan algo.** No hay ni un solo
   dato de rendimiento posterior en este documento. Que un patrón se detecte
   correctamente no dice nada sobre si funciona.

4. **No he probado fuera de EE. UU.** Los 68 valores son estadounidenses salvo
   los del corpus (3988.HK). No sé cómo se comporta el algoritmo con la
   liquidez y los huecos de cotización de Japón, Hong Kong o Europa. Vi al menos
   dos casos (VOD, CDNA) con saltos en la serie que parecen discontinuidades de
   datos, no movimientos de precio.

5. **No he verificado el impacto de los splits.** `daily_bars` guarda `close` y
   `adj_close`; el prototipo usa `close` sin ajustar, igual que el detector
   actual. Hay dos documentos abiertos sobre esto
   (`docs/splits-daily-bars-2026-08-09.md`, `docs/splits-eventos-2026-08-09.md`)
   que no he leído. Un split no ajustado dentro de la ventana crearía una
   "contracción" del 50% que no existió.

6. **No he comprobado cuántos valores del universo tienen menos de 300 barras**,
   que es la ventana de análisis del prototipo. Si son muchos, la cobertura real
   del detector será menor que la que sugieren estas pruebas.

7. **No he tocado ni ejecutado el arnés del corpus** (`npm run audit:vcp:corpus`),
   que descarga barras del proveedor en vivo. La afirmación de que 13 de los 18
   casos no son reproducibles desde `daily_bars` se apoya en las fechas del
   corpus y en la profundidad medida de la tabla, no en una ejecución del arnés.

8. **Los precios y volúmenes usados son los de la base a 14-08-2026.** No he
   comprobado su exactitud contra ninguna fuente externa.
