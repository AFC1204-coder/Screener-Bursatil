# Análisis — los datos financieros del producto

Fecha: 2026-08-22. Base: `codex/statsedge-ui-polish` @ `2b8cb56`.
Encargo: inventariar los datos financieros que el producto usa, medir su
cobertura real, decidir qué falta y con qué proveedor se cubre.

Solo análisis: ningún cambio de código, ninguna escritura en Supabase, ningún
escaneo lanzado, ninguna ficha abierta, ningún commit.

Continúa `docs/principios-producto.md` (principio 3: un dato ausente se muestra
como ausente), `docs/diseno-indicadores-mercado-2026-08-17.md` (método de
medición), `docs/data-providers.md`, `docs/data-licensing-audit.md` y
`docs/adr-universo-twelve-data.md`.

---

## Método

**Etiquetas.** **[DATO]** consulta a producción; **[CALC]** cálculo propio
sobre datos descargados, con el script indicado; **[CÓDIGO]** afirmación
sostenida por el código del repo; **[FUENTE]** definición tomada de la
bibliografía o de la documentación del proveedor; **[EST]** estimación, no
medición.

**Poblaciones.** Mezclarlas es el error fácil:

| Nombre | Qué es | Tamaño |
|---|---|---|
| Universo del nocturno | filas del escaneo `d0f32e08-…` (22-ago, 03:55 UTC) | 3.309 [DATO] |
| Universo de fichas cacheadas | símbolos con perfil en `fundamental_snapshots` | 11.046 [DATO] |
| Población histórica del escáner | símbolos con alguna fila en `scan_results` | 10.025 [DATO] |
| Universo de barras | símbolos en `daily_bars` | 11.210 [DATO] |

**El nocturno es 100 % estadounidense.** No hay ni una fila de otro país:

```sql
select count(*) filas, count(distinct country) paises,
       count(*) filter (where country='US') us
from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67';
-- 3309 | 1 | 3309
```

Por eso, cuando el encargo pide medir «por separado para valores
estadounidenses y para el resto», el resto **no está en el nocturno**: vive en
cohortes pequeñas de otros crones (GB 4 filas, IT-ES 5, SG-ZA 15, DE-FR-NL 6,
CA 17 en la última semana [DATO]) y en el histórico acumulado de
`scan_results`. Las cifras de «resto» de este documento salen de la última fila
por símbolo de esa tabla y del caché de perfiles, no del nocturno — y se
etiquetan como tales.

**Vías de lectura.** La herramienta MCP `execute_sql` sobre Supabase (solo
lectura), `curl` contra endpoints públicos de la SEC, y scripts de node en el
scratchpad. Cada cifra lleva su consulta.

---

# PARTE A — Qué hay hoy

## A.0 Las cuatro fuentes, y por dónde entra cada una

```
                    ┌─ nocturno (materializedScanner) ─┐
Yahoo Finance ──────┤                                   ├──► scan_results
  chart             │   withProfileCache                │     (3.309 filas)
  quoteSummary      └─ fundamental_snapshots ───────────┘
  fundamentals-ts

Yahoo + SEC EDGAR + FMP ──► /api/company-brief ──► la ficha (EN VIVO, sin persistir)

NasdaqTrader ──► universo    ASIC ──► short interest .AX    ESEF ──► 1 fila
```

Cuatro hechos de arquitectura que condicionan todo lo demás [CÓDIGO]:

1. **El nocturno solo conoce Yahoo.** `lib/materializedScanner.js:5` importa
   `withProfileCache` de `lib/fundamentalsCache.js`, que lee y escribe
   `fundamental_snapshots` con datos de Yahoo. El escáner nunca llama a la SEC.
2. **SEC EDGAR se usa en un solo sitio del producto**: `fetchSecFundamentals`
   solo aparece en `app/api/company-brief/route.js:3,1573,1583`. Es decir: solo
   cuando se abre una ficha, en vivo, y su resultado **no se persiste**.
3. **SEC EDGAR es solo EE. UU. por construcción**: `cikForTicker`
   (`lib/sec.js:66`) rechaza cualquier símbolo con punto (`isPlainUsTicker`) y
   exige CIK. Un `.L`, `.HK` o `.T` lanza «SEC EDGAR solo cubre tickers USA con
   CIK».
4. **La proyección ligera tira los fundamentales.** `SCAN_LIGHT_EXCLUDED_FIELDS`
   incluye `growthMetrics` explícitamente (`lib/scanLightProjection.js:54`), con
   el motivo escrito: «copia de métricas que ya viajan sueltas en la misma
   fila». No viajan sueltas: se verá en A.2.

## A.1 El inventario completo

Cobertura medida sobre las 3.309 filas del nocturno del 22-ago,
`scan_id = d0f32e08-3e33-48f6-b5db-2b14c0d3ba67`.
«Vive en» dice dónde queda el dato después del nocturno: `scan_results.metrics`
(todas las filas), `raw` (solo las 44 completas), `fundamental_snapshots`
(caché de perfil) o «en vivo» (se calcula al abrir la ficha y se pierde).

### A.1.1 Capa de precio y volumen — la base

| Dato | Fuente | Vive en | Cobertura nocturno |
|---|---|---|---|
| OHLCV diario | Yahoo Finance (`chart`) → `daily_bars` | `daily_bars` + `metrics.chartPreview` | 3.309 / 3.309 — **100 %** |
| `price`, `lastDate`, frescura | calculado sobre barras | `metrics` | 100 % (última barra 2026-08-21) |
| `chartBarsCount` | calculado | `metrics` | 100 %; ≥ 252 barras: 3.260 — 98,5 % |
| `avgVolume`, `latestVolume`, `avgTurnover` | calculado | `metrics` | 100 % |
| `relativeVolume`, `volumeSurgePct`, `volumeDryUpRatio`, `upDownVolRatio` | calculado | `metrics` | 100 % |
| `perf3m/6m/12m`, `distance20d/50d/52w/ATH`, `sma50/150/200`, `extSma50` | calculado | `metrics` | `perf12m` 3.259 — 98,5 %; el resto 100 % |
| Etapa semanal (`weeklyStageState`, `weeklyStageWeek`, `weeklyPriceAboveSlowMa`) | calculado | `metrics` | 3.265 — **98,7 %** |
| RS semanal canónico (`rs_weekly_items`) | calculado por el motor propio | tabla aparte | 4.970 símbolos, 26 semanas |

```sql
with r as (select metrics m from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67')
select count(*) total,
 count(*) filter (where m ? 'price') price,
 count(*) filter (where (m->>'chartBarsCount')::numeric >= 252) barras_ge252,
 count(*) filter (where m ? 'perf12m') perf12m,
 count(*) filter (where m ? 'volumeDryUpRatio') seco,
 count(*) filter (where m ? 'weeklyPriceAboveSlowMa') wpasm,
 max(m->>'lastDate') ultima_barra from r;
-- 3309 | 3309 | 3260 | 3259 | 3309 | 3265 | 2026-08-21
```

**Novedad respecto al 17-ago.** `weeklyPriceAboveSlowMa` tenía cobertura **0 %**
en el nocturno del 17 (`docs/diseno-indicadores-mercado-2026-08-17.md`, B.2) y
por eso el indicador «Sobre su media de 30 semanas» se declaraba ausente. Hoy
está en 3.265 de 3.309 filas — el 98,7 %, y las 44 que faltan son exactamente
las filas completas, que usan otra proyección. El punto 2 del orden de trabajo
de aquel documento está resuelto [DATO].

### A.1.2 Identidad y clasificación de la empresa

| Dato | Fuente | Vive en | Cobertura nocturno |
|---|---|---|---|
| `companyName` (nombre propio, no el ticker) | Yahoo `quoteSummary` | columna + snapshot | 3.306 — 99,9 % |
| `exchange`, `currency` | Yahoo `quoteSummary` | snapshot | 3.309 — 100 % ambos |
| `sector` (11 valores de Yahoo) | Yahoo | columna + `metrics` | 3.301 — **99,8 %** |
| `industry` (~145 valores de Yahoo) | Yahoo | columna + `metrics` | 3.301 — 99,8 % |
| `theme` (agrupación propia) | calculado (`lib/businessTheme.js`) | columna + `metrics` | 3.309 — 100 % |
| `marketCap` | Yahoo | `metrics` | 3.300 — **99,7 %** |
| `businessSummary` (descripción del negocio) | Yahoo `longBusinessSummary` | **solo snapshot** | 3.296 — **99,6 %** |
| `website`, `fullTimeEmployees`, `city`, `country` | Yahoo | solo snapshot | web 99,1 %, empleados 91,9 % |
| **`ipoDate`** | Yahoo (campo vacío) | `metrics` (vacío) | **0 / 3.309 — 0 %** |

```sql
with uni as (select distinct symbol from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67'),
 snap as (select distinct on (symbol) symbol, metrics from fundamental_snapshots
          where period_type='profile' order by symbol, updated_at desc)
select count(*) universo,
 count(*) filter (where coalesce(s.metrics->>'ipoDate','') <> '') con_ipodate,
 count(*) filter (where coalesce(s.metrics->>'fullTimeEmployees','') <> '') con_empleados,
 count(*) filter (where coalesce(s.metrics->>'website','') <> '') con_web
from uni join snap s on s.symbol=uni.symbol;
-- 3309 | 0 | 3042 | 3280
```

**`ipoDate` está vacío en el 100 % de la historia**, no solo hoy:

```sql
select count(*) total,
 count(*) filter (where coalesce(metrics->>'ipoDate','') <> '') con_ipodate,
 count(*) filter (where metrics ? 'ipoAgeMonths') con_ipoage
from scan_results;
-- 60068 | 0 | 0
```

Consecuencia [CÓDIGO]: los controles `maxIpoAgeMonths` y `requireRecentIpo`
(`lib/screenerFilterCatalog.js`), la categoría `ipoCategory` de
`lib/researchRow.js:15` y el preset `ipo` se evalúan sobre un campo que nunca
tiene valor. La ficha se salva porque `computeListingDate`
(`app/api/company-brief/route.js:110`) cae a la fecha de la barra más antigua —
pero eso es «primera cotización disponible en nuestro caché», no la salida a
bolsa, y solo existe en la ficha.

### A.1.3 Fundamentales de empresa — los trece escalares

Estos son los que alimentan el crecimiento del compuesto. Vienen de Yahoo
(`quoteSummary` + `fundamentals-timeseries`), se guardan en el caché de perfil,
y **se descartan al escribir la fila del nocturno** salvo en las 44 filas que
pasan el preset.

| Dato | Fuente | Vive en | Cobertura sobre el nocturno |
|---|---|---|---|
| `revenueGrowth` (último trimestre YoY) | Yahoo `financialData` | snapshot; `raw` en 44 filas | 3.133 — **94,7 %** |
| `earningsGrowth` | Yahoo `financialData` / `defaultKeyStatistics` | ídem | 3.299 — 99,7 % |
| `grossMargin`, `operatingMargin`, `profitMargin`, `ebitdaMargin` | Yahoo | ídem | 3.304 cada uno — 99,8 % |
| `roe` / `roa` | Yahoo | ídem | 3.288 — 99,4 % / 3.289 — 99,4 % |
| `debtToEquity` | Yahoo | ídem | 3.261 — 98,5 % |
| `currentRatio` | Yahoo | ídem | 3.022 — **91,3 %** |
| `institutionalOwnership` (porcentaje) | Yahoo `majorHoldersBreakdown` | ídem | 3.297 — 99,6 % |
| `institutionsCountApprox` (**número** de tenedores) | Yahoo `majorHoldersBreakdown` | ídem | 3.309 — **100 %** |
| `insiderOwnership` | Yahoo | ídem | 3.297 — 99,6 % |
| `shortPercentOfFloat` | Yahoo `defaultKeyStatistics` | **`metrics`** | 3.280 — **99,1 %** |
| `floatShares`, `sharesOutstanding`, `shortRatio`, `sharesShort` | Yahoo | snapshot | float 3.235 — 97,8 % |

```sql
with uni as (select distinct symbol from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67'),
 snap as (select distinct on (symbol) symbol, metrics->'growthMetrics' g from fundamental_snapshots
          where period_type='profile' order by symbol, updated_at desc)
select count(*) universo,
 count(*) filter (where s.g->>'grossMargin' is not null) gross,
 count(*) filter (where s.g->>'currentRatio' is not null) corriente,
 count(*) filter (where s.g->>'institutionsCountApprox' is not null) n_instituciones
from uni join snap s on s.symbol=uni.symbol;
-- 3309 | 3304 | 3022 | 3309
```

`institutionsCountApprox` no está capado a la longitud de una lista: los valores
llegan a 13, 15, 16, 18, 20, 22… y solo 6 símbolos traen 0. Es el número real
que publica Yahoo, y por tanto **«I» de CAN SLIM (3–10 tenedores como mínimo
razonable) es servible hoy, sin proveedor nuevo** — el campo existe, está al
100 %, no se persiste y no se muestra.

El agregado de los trece es `fundamentalCoverageScore`
(`lib/dataCoverageShared.js`), que **sí** se persiste al 100 %. Su reparto real:

```sql
with r as (select (metrics->>'fundamentalCoverageScore')::numeric f
           from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67')
select f, count(*) n from r group by f order by f;
--   0 →    5      69 →    6      92 →  109
--  46 →    1      77 →   31     100 → 2743
--  54 →    2      85 →  405
```

Media 97,4, mediana 100. **2.743 de 3.309 filas (82,9 %) tenían los trece
campos presentes en el momento de hidratar** — y de todos ellos solo sobrevive
`shortPercentOfFloat`.

### A.1.4 Valoración

| Dato | Fuente | Vive en | Cobertura nocturno |
|---|---|---|---|
| `trailingPe` | Yahoo | solo snapshot | 2.357 — **71,2 %** |
| `forwardPe` | Yahoo | solo snapshot | 3.126 — 94,5 % |
| `priceToSales` | Yahoo | solo snapshot | 3.108 — 93,9 % |

Ninguno se muestra en el producto hoy. Minervini los usa como comparación
(P/E de compra frente a P/E actual), no como criterio de selección [FUENTE].

### A.1.5 La serie trimestral — el hueco de la ficha

`fundamentalsFinancialResults` (estados financieros por trimestre y año) es lo
que alimenta la rejilla de crecimiento de la tarjeta del gráfico
(`lib/chartIdentityCard.js` → `quarterlyGrowthCells`).

En el caché, sobre el universo del nocturno:

```sql
with uni as (select distinct symbol from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67'),
 snap as (select distinct on (symbol) symbol, metrics from fundamental_snapshots
          where period_type='profile' order by symbol, updated_at desc)
select jsonb_array_length(coalesce(s.metrics->'fundamentalsFinancialResults'->'incomeQuarterly','[]'::jsonb)) trimestres,
       count(*) n
from uni join snap s on s.symbol=uni.symbol group by 1 order by 1;
```

| Trimestres en caché | Símbolos |
|---:|---:|
| 0 | 118 |
| 1–4 | 39 |
| **5** | **3.113** |
| 6 | 34 |
| 7 | 5 |

**Yahoo entrega exactamente 5 trimestres al 94,1 % del universo. El máximo es
7. Ninguno llega a 10** [DATO]. Y 10 es justo lo que hace falta, como se mide
en B.3.

Frescura del último trimestre reportado:

```sql
-- misma CTE; q0 = fecha del trimestre más reciente
select min(q0) mas_antiguo, max(q0) mas_reciente,
       percentile_disc(0.5) within group (order by q0) mediana,
       count(*) filter (where q0 < current_date - interval '120 days') mas_de_120d
from x;
-- 2024-12-31 | 2026-06-30 | 2026-06-30 | 886
```

Mediana 30-jun-2026 (53 días). Pero **886 de 3.191 (27,8 %) traen un último
trimestre de hace más de 120 días** — o la empresa no ha publicado, o el caché
se quedó atrás.

### A.1.6 Short interest

| Dato | Fuente | Cobertura |
|---|---|---|
| `shortPercentOfFloat` | Yahoo | 3.280 / 3.309 — 99,1 % (nocturno) |
| Bloque `shortInterest` estructurado | ASIC (solo `.AX`) | **0 / 3.309** en el nocturno — es US |

`docs/data-providers.md` ya avisa de que el dato de ASIC es un proxy agregado y
no equivale al short float estadounidense. Para el universo público (US) el
único origen es Yahoo, sin fecha de corte declarada.

### A.1.7 Lo que existe en el esquema pero está vacío

| Cosa | Estado real |
|---|---|
| `fundamental_snapshots` con `period_type='annual'` | **1 fila**, proveedor `esef-filings`, del 21-may-2026 [DATO] |
| ESEF / filings.xbrl.org | implementado (`lib/esef.js`, 364 líneas) y sin usar |
| J-Quants | implementado; 73 símbolos JP escaneados, último 16-ago |
| FMP | implementado (`lib/fmp.js`); solo se invoca desde la ficha, y solo si hay `FMP_API_KEY` |

```sql
select period_type, provider, count(*) filas, count(distinct symbol) simbolos
from fundamental_snapshots group by 1,2 order by filas desc;
-- profile | StatsEdge normalized profile | 25285 | 11046
-- annual  | esef-filings                 |     1 |     1
```

## A.2 Lo que se calcula y se tira

Esto responde a la parte del encargo que pide contar también lo descartado.

**1. Los trece escalares fundamentales.** Se piden a Yahoo, se cachean, se usan
para puntuar, y no llegan a la fila. Verificación directa: de las 3.309 filas
del nocturno, solo **44** conservan `raw.growthMetrics`.

```sql
select count(*) filas,
 count(*) filter (where metrics->>'rowProjection'='full') completas,
 count(*) filter (where metrics->>'rowProjection'='light') ligeras
from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67';
-- 3309 | 44 | 3265

select symbol, (select count(*) from jsonb_object_keys(raw)) claves_raw, raw ? 'growthMetrics'
from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67' and symbol in ('AAPL','NVDA');
-- AAPL | 0 | false        NVDA | 0 | false
```

**Lo que sobrevive es el resumen, no el dato**: `growthScore`,
`epsGrowthProxyScore` (99,8 % ambos) y `fundamentalCoverageScore` (100 %). Es
decir: la fila dice «este valor puntúa 71 en crecimiento» y no puede decir
«porque sus ventas suben un 34 %».

Peso de eso en el ranking: `COMPOSITE_WEIGHTS` (`lib/scoringEngine.js:688`) da
`growthScore` 0,08 y `epsAnchor` 0,08 — **el 16 % del compuesto sale de datos
que el producto no enseña en ninguna pantalla** [CÓDIGO].

**2. La serie trimestral completa.** Al abrir una ficha, `/api/company-brief`
llama en paralelo a Yahoo extras, SEC EDGAR y FMP
(`app/api/company-brief/route.js:1571-1574`), funde los tres, calcula la
rejilla… y no guarda nada. La siguiente apertura repite las tres llamadas.

**3. `lowAdvance52w`.** `lib/researchRow.js:157` lo calcula, y no está en
`SCAN_LIGHT_FIELDS` — no llega al nocturno. Ya estaba señalado en
`docs/diseno-indicadores-mercado-2026-08-17.md` B.4. La ficha lo recalcula desde
las barras (`lowAdvance52wFromBars`).

**4. Los tres bloques grandes excluidos a propósito**: `objectiveMetricAudit`
(16 KB/fila), `decisionTrace` (6,7 KB) y `growthMetrics` (4,8 KB). Los dos
primeros son decisión defendida en el ADR; el tercero es el que duele.

## A.3 EE. UU. frente al resto

El nocturno no tiene «resto», así que la comparación se hace sobre el caché de
perfiles, que sí es global (11.046 símbolos).

```sql
with snap as (select distinct on (symbol) symbol, metrics from fundamental_snapshots
              where period_type='profile' order by symbol, updated_at desc)
select case when symbol ~ '\.' then 'no-US' else 'US' end grupo, count(*) simbolos,
 count(*) filter (where jsonb_array_length(coalesce(metrics->'fundamentalsFinancialResults'->'incomeQuarterly','[]'::jsonb)) > 0) con_trim,
 max(jsonb_array_length(coalesce(metrics->'fundamentalsFinancialResults'->'incomeQuarterly','[]'::jsonb))) max_trim,
 count(*) filter (where coalesce(metrics->>'businessSummary','') <> '') con_resumen
from snap group by 1;
```

| | US (sin sufijo) | Resto (con sufijo) |
|---|---:|---:|
| Símbolos con perfil | 6.107 | 4.939 |
| Con alguna serie trimestral | 5.206 — **85,2 %** | 1.120 — **22,7 %** |
| Máximo de trimestres | 7 | 6 |
| Con descripción de negocio | 6.003 — 98,3 % | 4.865 — 98,5 % |

Y la cobertura de los trece escalares por país, sobre la última fila de cada
símbolo en `scan_results`:

```sql
with ultimo as (select distinct on (symbol) symbol, country, metrics
                from scan_results order by symbol, created_at desc)
select country, count(*) simbolos,
 round(avg((metrics->>'fundamentalCoverageScore')::numeric),1) fundcov_media,
 max(created_at)::date ultimo_escaneo
from ultimo group by 1 order by simbolos desc;
```

| País | Símbolos | Cobertura fundamental media | Último escaneo |
|---|---:|---:|---|
| US | 5.844 | 95,1 | 2026-08-22 |
| HK | 2.558 | 91,4 | 2026-08-13 |
| AU | 660 | 88,7 | 2026-08-21 |
| CA | 197 | 98,5 | 2026-08-19 |
| JP | 73 | 90,8 | 2026-08-16 |
| GB | 48 | 87,9 | 2026-08-21 |
| resto (20 países) | 494 | 87,4–92,0 | 12–20 ago |

**La lectura correcta de esta tabla no es «fuera de EE. UU. estamos casi
igual».** Los trece escalares de Yahoo sí funcionan fuera; lo que no funciona
fuera es (a) la serie trimestral —22,7 % frente a 85,2 %—, (b) la frescura —el
resto se escanea cada 5-10 días, no cada noche—, y (c) la unidad:

```sql
with ultimo as (select distinct on (symbol) symbol, country, metrics from scan_results
                where country in ('HK','JP','GB') order by symbol, created_at desc)
select country, count(*) n,
 round(percentile_disc(0.5) within group (order by (metrics->>'marketCap')::numeric)) cap_mediana
from ultimo group by country;
-- GB | 48   | 26.992.867.328
-- HK | 2558 |    772.284.608
-- JP | 73   | 6.483.840.335.872
```

La capitalización mediana japonesa es 6,48 billones. Son yenes. **`marketCap`
se guarda en divisa local y el filtro de capitalización los compara como si
fueran la misma unidad** — el mismo problema que el ADR de Twelve Data ya
anticipó para el umbral de liquidez («Pendiente de normalizar»). En el universo
público, que es solo US, esto no muerde; en cuanto entre un segundo mercado, sí.

## A.4 Cuatro cosas que la medición ha dejado claras

1. **La ficha no falla por falta de fuente, falla por dos topes de 8.** Ver B.3.
2. **`ipoDate` lleva 60.068 filas vacío.** Tres controles del screener y un
   preset dependen de él.
3. **El resumen de negocio está en inglés en el 100 % de los casos con dato.**
   `businessEs` (`lib/researchRow.js:45`) **no es una traducción**: concatena
   nombre · sector · industria · tema · primera frase del resumen inglés.
   Medido: 3.296 de 3.296 resúmenes contienen patrones ingleses (`the`, `and`,
   `provides`, `operates`), longitud media 1.192 caracteres, máxima 5.342.
4. **El rango dentro del sector no existe porque la tabla del RS canónico no
   tiene sector.**

```sql
select engine_version, count(distinct symbol) simbolos, count(distinct week_key) semanas,
 count(*) filter (where sector is not null and sector <> '') con_sector, count(distinct country) paises
from rs_weekly_items group by engine_version;
-- statsedge-us-equity-rs-v1  | 4970 | 26 |     0 |  1
-- statsedge-global-rs-usd-v1 |  500 | 55 | 20803 | 16
```

El motor vigente (`statsedge-us-equity-rs-v1`) tiene **cero filas con sector**.
El motor antiguo sí lo tenía, pero está retirado. El motivo de ausencia que
enseña la ficha (`DESCRIPTIVE_ABSENCE.sectorRank`) es exacto.

Y el RS de país tampoco aporta nada hoy:

```sql
select count(*) total,
 count(*) filter (where metrics->>'rsCountryPct' = metrics->>'rsGlobalPct') iguales
from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67';
-- 3309 | 3309
```

**Coinciden en el 100 % de las filas.** Con universo mono-país no pueden no
coincidir.

---

# PARTE B — Qué falta

## B.1 Lo que piden las fuentes de referencia

**Weinstein** no usa fundamentales: su método es precio, volumen, media de 30
semanas y grupo. No aporta requisitos a esta parte.

**Minervini** sí, y es explícito. De `research/books/mark minervini.pdf`
(*Trade Like a Stock Market Wizard*), extraído con lector propio en el
scratchpad (`pdftext.mjs`; el de *Think & Trade Like a Champion* necesita además
un desplazamiento de +29 sobre el CID, `decode29.mjs`). Las reglas se recogen
como definiciones operables; no se reproducen pasajes.

La lista fundamental de SEPA que enumera el propio libro [FUENTE]: beneficios y
ventas reportados; historial de sorpresas de beneficios y ventas; crecimiento
**y aceleración** del BPA; crecimiento **y aceleración** de ingresos; guía de la
compañía; revisiones de las estimaciones de los analistas; márgenes; posición en
la industria y en el mercado; catalizadores; comparación con otros valores del
mismo sector.

Y los criterios cuantificados:

| Criterio | Definición | Dato que exige |
|---|---|---|
| Umbral de beneficios | 20–25 % YoY mínimo en el último trimestre, o en los dos o tres últimos; 30–40 % en fase de superrendimiento; 40–100 % en mercado alcista [FUENTE] | 3 trimestres + los 3 del año anterior = **6+ trimestres** |
| **Código 33** | tres trimestres consecutivos de aceleración simultánea en BPA, ventas y margen [FUENTE] | 4 trimestres + los 4 del año anterior = **8 trimestres**, con margen por trimestre |
| Beneficios anuales | los trimestres fuertes deben traducirse en años fuertes; «uno o dos trimestres buenos no bastan» [FUENTE] | **4–5 años** de BPA anual |
| Ruptura de beneficios | el beneficio anual supera el rango de varios años [FUENTE] | **5+ años** anuales |
| Giro (*turnaround*) | comparar la tasa actual (trimestral o anual) con la tasa a 3 o 5 años [FUENTE] | **5 años** anuales + trimestres |
| Beneficio sostenido por ingresos | el beneficio viene de ventas, no de recorte de costes | ingresos, coste de ventas y margen por trimestre |
| Calidad del beneficio | inventarios y cuentas a cobrar creciendo más rápido que las ventas es bandera roja [FUENTE] | **balance trimestral**: inventarios, cuentas a cobrar |
| Sorpresa de beneficios | batir estimaciones, y el historial de sorpresas | **consenso de analistas** (no lo tiene ninguna fuente pública) |
| Fecha de resultados | saber cuándo publica cada valor de la lista [FUENTE] | **calendario de resultados** |

**O'Neil.** El PDF de `research/books/` sigue sin capa de texto recuperable (1
bloque en 2.371 páginas, confirmado hoy con el mismo extractor), así que la
escuela se cita por fuentes secundarias verificables:

- **EPS Rating**: combina el crecimiento del BPA de **los dos últimos
  trimestres** con la tasa anual **a 3–5 años**, y lo compara con todo el
  universo en escala 1–99 ([Investor's Business Daily vía Yahoo Finance](https://finance.yahoo.com/news/eps-rating-fast-tracks-basic-221200776.html)).
- **SMR Rating**: combina crecimiento de ventas de **los tres últimos
  trimestres**, margen antes de impuestos, margen después de impuestos y ROE, en
  escala A–E ([IBD vía Yahoo Finance](https://finance.yahoo.com/news/quickly-fastest-growers-market-eps-220900226.html)).
- **197 grupos de industria** rankeados de 1 a 197; la guía habitual es mirar
  los 20–40 primeros ([MarketSmith](https://marketsmithindia.com/mstool/industrygrouplist.jsp),
  [IBD vía Yahoo Finance](https://finance.yahoo.com/news/industry-group-rankings-help-pick-204300919.html)).
- **CAN SLIM**: «C» = BPA del trimestre actual **+25 % o más** frente al mismo
  trimestre del año anterior, con aceleración; «A» = beneficio anual **+25 %**
  en los últimos tres años y creciente en cinco; «I» = **3 a 10 propietarios
  institucionales** como mínimo razonable
  ([AAII](https://www.aaii.com/stockideas/article/454702-can-slim-seven-attributes-that-set-market-leaders-apart),
  [Corporate Finance Institute](https://corporatefinanceinstitute.com/resources/equities/can-slim/)).

## B.2 Prioridad: qué cambia el juicio y qué es adorno

Ordenado por cuánto cambia lo que el usuario puede decidir, no por dificultad.

### Cambia el juicio de verdad

**1. Serie trimestral de 10+ trimestres con BPA, ventas y margen.** Es la
condición de todo lo demás: sin ella no hay aceleración, no hay Código 33, no
hay umbral de 25 % sostenido y la rejilla de la ficha se queda en blanco. Hoy
falta para el 100 % del universo en el dato persistido y para el 94,1 % en el
caché.

**2. BPA anual de 5 años.** Habilita «A» de CAN SLIM, la mitad anual del EPS
Rating, la ruptura de beneficios y la detección de giros. Es lo segundo más
citado por las tres escuelas y hoy no existe en ninguna superficie: el nocturno
no guarda anuales, y el caché se queda corto justo por un año.

```sql
-- misma CTE de snapshots, sobre incomeAnnual
select jsonb_array_length(coalesce(s.m->'fundamentalsFinancialResults'->'incomeAnnual','[]'::jsonb)) anuales,
       count(*) n from uni join snap s on s.symbol=uni.symbol group by 1 order by 1;
-- 0 → 24 · 1 → 28 · 2 → 17 · 3 → 59 · 4 → 3147 · 5 → 34
```

**4 ejercicios en el 95,1 % del universo, máximo 5.** «A» de CAN SLIM pide tres
años de +25 % y crecimiento sostenido en cinco: con cuatro no se puede afirmar.
EDGAR trae 9 (B.3.2).

**3. Ranking por grupo de industria.** No es un dato de proveedor: es un cálculo
que hoy no se hace. La materia prima está —99,8 % de las filas traen sector e
industria, y las muestras por sector van de 88 a 614 valores— pero el RS
canónico no clasifica (A.4). Es la pieza que convierte «RS 87» en «4º de 470»,
que es como lo lee un operador de esta escuela.

```sql
select coalesce(nullif(sector,''),'(sin sector)') sector, count(*) n
from scan_results where scan_id='d0f32e08-3e33-48f6-b5db-2b14c0d3ba67' group by 1 order by n desc;
-- Financial Services 614 · Healthcare 516 · Technology 470 · Industrials 432
-- Consumer Cyclical 343 · Basic Materials 206 · Real Estate 176 · Energy 171
-- Communication Services 149 · Consumer Defensive 136 · Utilities 88 · Sin sector 8
```

Ojo con la consulta: `metrics->>'sector'` devuelve 3.257 porque las 44 filas
completas guardan el sector en la **columna** y no en `metrics`. La columna es
la lectura correcta.

**4. Fecha de resultados.** Minervini lo dice sin rodeos: hay que saber cuándo
publica cada valor de la lista. Es el único dato de esta lista que cambia una
decisión el mismo día, y hoy no está en ninguna parte del producto.

**5. Persistir lo que ya se calcula.** Los trece escalares están ahí y se tiran.
Esto no necesita proveedor: necesita quitar `growthMetrics` de
`SCAN_LIGHT_EXCLUDED_FIELDS` o —mejor, por peso— añadir los seis que usa
`epsGrowthProxyScore` a `SCAN_LIGHT_FIELDS`. Coste medido por analogía con el
precedente del ADR (tres escalares añadidos costaron +68 B/fila, +0,95 %): seis
escalares ≈ +130 B/fila ≈ +430 KB sobre 23 MB [EST].

### Segundo nivel: útil, no decisivo

**6. Propiedad institucional con número de tenedores.** «I» de CAN SLIM pide el
**número** de propietarios (3–10 mínimo), no el porcentaje.
`institutionsCountApprox` está al **100 %** en el caché de perfil, con valores
reales (llega a 20 y más), y no se persiste ni se muestra. Es el caso más claro
de dato pagado, medido y tirado: sale gratis y solo hay que dejarlo pasar.

**7. Inventarios y cuentas a cobrar por trimestre.** Es la regla de calidad del
beneficio de Minervini. Llega gratis si entra la serie trimestral con balance.

**8. Revisiones de estimaciones y sorpresas.** Están en la lista de SEPA y en la
mecánica del *earnings surprise*. Son dato de proveedor de pago, sin sustituto
público (C.1), y su ausencia no rompe nada: son confirmación, no clasificación.

### Adorno para este producto

- **P/E, P/S, P/B como criterio.** Minervini los usa como comparación con uno
  mismo, no como filtro; el principio 2 dice que cada elemento debe justificar su
  sitio. Hoy `trailingPe` tiene 71,2 % de cobertura y nadie lo mira.
- **Deuda, ratio corriente, ROA.** Entran en el score y no merecen pantalla:
  ninguna de las tres escuelas los usa para clasificar.
- **Flujo de caja libre, EBITDA.** Se calculan en el caché y no aparecen en
  ninguna regla de la metodología.
- **Sentimiento social y titulares.** Ya descartados en
  `docs/diseno-indicadores-mercado-2026-08-17.md` A.3.

## B.3 El crecimiento, en concreto

El encargo pide ser preciso aquí. Lo soy, porque el hueco no está donde parece.

### B.3.1 La rejilla pide 10 trimestres y el código tiene dos topes de 8

`quarterlyGrowthCells(financialResults, {quarters: 6})` toma los 6 trimestres
más recientes y para cada uno calcula el interanual contra `source[index + 4]`
(`lib/descriptiveStrip.js`). Para llenar las 6 celdas hacen falta **10**
trimestres. Simulado con el código real de la función [CALC, `growth-core.js`]:

| Trimestres disponibles | Celdas pintadas | `usable` | Qué ve el usuario |
|---:|---:|---|---|
| 5 | **1 / 6** | **false** | «Sin serie trimestral suficiente» |
| 6 | 2 / 6 | true | 4 columnas en blanco a la izquierda |
| 7 | 3 / 6 | true | 3 en blanco |
| 8 | 4 / 6 | true | **2 en blanco, siempre las dos más antiguas** |
| 10 | **6 / 6** | true | la rampa completa |

Y hay dos topes de 8 en el camino [CÓDIGO]:

- `lib/sec.js:212`: `statementResultRows` hace `revenue.slice(-8)`. La SEC
  devuelve mucho más y el código se queda con 8.
- `app/api/company-brief/route.js:1072`: `mergeRows(...)` termina en
  `.slice(0, 8)`. Aunque llegaran 30 trimestres, la fusión los corta a 8.

Resultado: con Yahoo solo (94,1 % del universo, 5 trimestres) la rejilla se
declara ausente; con SEC (solo EE. UU., en vivo) se llenan 4 de 6 y **las dos
columnas de la izquierda están vacías por diseño, siempre**. Como la rampa se
lee de izquierda a derecha para ver la aceleración, faltan justo las dos que
sirven de referencia.

### B.3.2 La SEC tiene 30 trimestres, no 8

Comprobado sobre AAPL con el endpoint público de conceptos [DATO]:

```
curl -H "User-Agent: StatsEdge/0.1 <correo>" \
 "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json"
→ 117 filas de 10-K/10-Q · 30 trimestres discretos (2017-12-30 → 2026-06-27)
  9 ejercicios anuales (2017-09-30 → 2025-09-27)
```

**Ocho años y medio de trimestres y nueve de anuales, gratis.** Con eso se
llenan las 6 celdas, se calcula el Código 33, se compara con la tasa a 3 y 5
años y se detecta la ruptura de beneficios.

Con un aviso: **falta sistemáticamente el cuarto trimestre fiscal.** En AAPL,
los cierres de septiembre de 2021, 2022, 2023, 2024 y 2025 aparecen solo como
anuales, nunca como trimestre discreto — porque el 10-K reporta el año, no el
Q4. Se deriva como `FY − (Q1+Q2+Q3)`, pero hay que hacerlo: sin eso, uno de cada
cuatro trimestres sale en blanco.

### B.3.3 Hasta dónde llega la SEC sobre nuestro universo

Dos mediciones, ambas necesarias.

**Identidad.** El 99,8 % del universo del nocturno tiene CIK
[CALC, cruce de `company_tickers.json` de la SEC con la lista del nocturno]:

```
universo nocturno: 3.308 símbolos (1 perdido en la transcripción, ver «lo que no he verificado»)
con CIK en la SEC: 3.303 — 99,8 %
sin CIK: 5 (FRBA, HIFS, NBN, RCBC, TOWN — bancos pequeños)
```

**Datos trimestrales de verdad.** Muy distinto. Usando el endpoint `frames`,
que devuelve todos los declarantes de un concepto en un trimestre natural
[CALC]:

```
frames us-gaap/{RevenueFromContractWithCustomerExcludingAssessedTax, Revenues,
                RevenueFromContractWithCustomerIncludingAssessedTax}/USD/
       {CY2025Q3, CY2025Q4, CY2026Q1, CY2026Q2}
→ 2.385 de 3.308 del universo = 72,1 %
+ InterestAndDividendIncomeOperating y RevenuesNetOfInterestExpense (solo CY2026Q2)
→ 2.550 = 77,1 %
sin ningún trimestre discreto: 758 (22,9 %)
```

Los 758 que faltan no son ruido: la muestra está llena de emisores extranjeros
(ABEV, AEG, AEM, ARCO, ARGX, ASML, ASX, ATHM), REIT (AGNC, AMH, ARR, ABR) y
mineras. Dos causas distintas:

**(a) Emisores privados extranjeros.** Presentan 20-F —anual— y no 10-Q.
Comprobado con seis casos [DATO]:

| Símbolo | Taxonomía | Unidad | Trimestres | Anuales | Formularios |
|---|---|---|---:|---:|---|
| ASML | us-gaap | **EUR** | **0** | 10 | 20-F |
| SAP | **ifrs-full** | EUR | **0** | 11 | 20-F |
| TSM | ifrs-full | TWD | **0** | 10 | 20-F, 6-K |
| NVO | ifrs-full | DKK | **0** | 11 | 6-K, 20-F |
| BABA | us-gaap | CNY | **0** | 14 | 20-F, 6-K |
| SHOP | us-gaap | USD | 8 | 4 | 10-K, 10-Q |

Y para estos hay **dos fallos encadenados en nuestro código** [CÓDIGO]:
`lib/sec.js` solo lee `facts.facts["us-gaap"]` (SAP, TSM y NVO reportan bajo
`ifrs-full` y devuelven cero), y `unitsFor(..., "USD")` solo lee la unidad USD
(ASML reporta en EUR y también devuelve cero). Para un ADR europeo, la vía SEC
del producto no devuelve nada aunque la SEC tenga el dato.

**(b) La lista de etiquetas se queda corta.** Bancos, aseguradoras y REIT no
usan `Revenues`: usan `InterestAndDividendIncomeOperating`,
`RevenuesNetOfInterestExpense` y otras. Añadir dos etiquetas subió la cobertura
5 puntos en un solo trimestre. Con la lista completa por tipo de emisor subiría
más.

Además, el universo del nocturno tiene un 19,0 % de emisores no domiciliados en
EE. UU. aunque coticen allí:

```sql
-- misma CTE de snapshots
select coalesce(nullif(s.metrics->>'country',''),'(sin país)') pais_empresa, count(*) n
from uni join snap s on s.symbol=uni.symbol group by 1 order by n desc;
-- United States 2679 · Canada 139 · United Kingdom 56 · China 51 · Israel 35
-- Bermuda 32 · Switzerland 24 · Ireland 22 · Brazil 22 · … (25 países más)
```

**2.679 de 3.309 (81,0 %) son empresas estadounidenses.** El otro 19 % son el
grupo de riesgo para cualquier plan basado solo en EDGAR.

### B.3.4 Qué haría falta para servir el crecimiento sin huecos

En orden, y separando lo que es ingeniería de lo que es proveedor:

| # | Qué | Tipo | Alcance que resuelve |
|---|---|---|---|
| 1 | Subir los dos topes de 8 a 12 o 16 (`lib/sec.js`, `mergeRows`) | ingeniería | las 6 celdas se llenan donde ya hay dato |
| 2 | Derivar el Q4 fiscal como `FY − (Q1+Q2+Q3)` | ingeniería | 1 de cada 4 trimestres de los declarantes 10-K |
| 3 | Ampliar la lista de etiquetas XBRL por tipo de emisor (banca, seguros, REIT) | ingeniería | +5 pp medidos, probablemente más |
| 4 | Leer también `ifrs-full` y unidades no USD en `lib/sec.js` | ingeniería | los ADR europeos y asiáticos con taxonomía IFRS |
| 5 | Persistir la serie trimestral en `fundamental_snapshots` con `period_type='quarter'` | ingeniería | quita 3 llamadas en vivo por apertura de ficha |
| 6 | Un trabajo nocturno que hidrate la serie desde EDGAR para todo el universo | ingeniería | convierte «en vivo» en «guardado», que es lo que pedía el punto 3 del orden de trabajo del 17-ago |
| 7 | Consenso de analistas, revisiones y sorpresas | **proveedor** | no hay fuente pública |
| 8 | Calendario de resultados futuro | **proveedor** (o derivable con retraso de EDGAR) | Minervini lo pide explícitamente |
| 9 | Trimestres de emisores 20-F | **proveedor** | ~19 % del universo, y no todos publican trimestres en origen |

**Del 1 al 6 no hace falta contratar a nadie.** Es la conclusión más importante
de esta parte: el hueco de crecimiento es, en su mayor parte, un problema de
ingeniería sobre una fuente que ya está integrada, es gratuita y es de dominio
público.

---

# PARTE C — Qué proveedor lo cubre

## C.1 El punto de partida: EDGAR no necesita licencia

Antes de comparar precios conviene fijar esto, porque cambia la conversación.

La SEC declara que la información de su web es información pública y **puede
copiarse y distribuirse sin permiso**, pidiendo que se cite a la SEC como
fuente; lo que sí está restringido es el uso de sus marcas y logotipos
([SEC.gov, Privacy Information](https://www.sec.gov/about/privacy-information),
[SEC.gov, Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)).
`docs/data-licensing-audit.md` ya la clasifica como «Keep. Low legal risk if
rate-limited and attributed».

Traducción a decisiones: **para un producto de pago solo estadounidense, los
fundamentales no son el problema de licencia. El problema de licencia es el
precio.** Los OHLCV vienen hoy de Yahoo, cuya posición legal el propio audit
califica de «High risk for commercial reliance».

Lo que EDGAR **no** da, y por tanto sí exige proveedor: consenso de analistas,
revisiones de estimaciones, sorpresas, calendario de resultados futuro,
clasificación sectorial usable (solo hay código SIC), y datos de emisores 20-F
por trimestre.

## C.2 Comparativa

Todos los precios son de las páginas oficiales, consultadas el 22-ago-2026.
La columna que importa no es el precio: es si el plan autoriza **mostrar el dato
a los usuarios de un producto de pago**.

| Proveedor | Plan más barato con datos suficientes | Precio | ¿Autoriza mostrar a terceros? | Notas |
|---|---|---:|---|---|
| **SEC EDGAR** | — | **0 €** | **Sí**, es información pública | Solo EE. UU.; sin estimaciones; 20-F solo anual |
| **EODHD** | *Fundamentals Data Feed* | 59,99 €/mes (49,99 anual) | **No** — «personal use only» | El *All-In-One* son 99,99 €/mes, mismo límite |
| **EODHD comercial** | *Internal Use* | **399 €/mes** (3.990 €/año) | **No**: «the data is restricted to being used solely within your company» | Mostrar fuera exige plan *Custom* a presupuesto; *Enterprise* son 2.499 €/mes |
| **Twelve Data** | *Pro* (individual) | 99 $/mes | **No** — «personal or internal use» | *Ultra* 329 $/mes, mismo límite |
| **Twelve Data Business** | *Venture* | **499 $/mes** (414 $/mes anual) | **Sí** — «External display data access» | *Enterprise* 1.099 $/mes (916 anual) añade «External distribution» |
| **Financial Modeling Prep** | *Premium* | ~59 $/mes (tarifa anual) | **No por defecto**: mostrar o redistribuir exige acuerdo aparte | *Starter* ~22 $, *Ultimate* ~149 $ |
| **Polygon.io / Massive** | *Stocks Advanced* | 199 $/mes | **No** — «Individual use only» | Fundamentales sueltos 29 $/mes; el plan *Business* es a presupuesto |
| **Intrinio** | *US Fundamentals* | **800 $/mes** (9.600 $/año) | a negociar | Estandarizados y as-reported desde 2006 |
| **Sharadar (vía Nasdaq Data Link)** | *Core US Fundamentals* | precio tras identificarse | **No**: «You may not publish, disseminate, re-distribute or share the Services Data» | 16.000+ empresas desde 1990, point-in-time |
| **Tiingo** | *Power* + add-on de fundamentales | 30 $/mes + add-on | **No**: el plan comercial de 50 $/mes es «internal use» | Redistribución solo por permiso expreso y con coste adicional |
| **Finnhub** | Fundamentals 50 $/mes + Estimates 75 $/mes | 125 $/mes | plan mostrado es de uso personal | *All-In-One* 3.500 $/mes anualizado |

Fuentes: [EODHD pricing](https://eodhd.com/pricing) ·
[EODHD commercial pricing](https://eodhd.com/commercial-pricing) ·
[EODHD commercial vs personal license](https://eodhd.com/financial-apis/commercial-vs-personal-license-use) ·
[Twelve Data pricing](https://twelvedata.com/pricing) ·
[Twelve Data business pricing](https://twelvedata.com/pricing-business) ·
[Twelve Data commercial usage](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage) ·
[FMP pricing (recogido por Qveris, verificado 30-jul-2026)](https://qveris.ai/guides/financial-modeling-prep-api/) ·
[Massive (antes Polygon.io) pricing](https://massive.com/pricing) ·
[Intrinio (vía Datarade)](https://datarade.ai/data-products/us-equities-packages-stock-prices-fundamentals-intrinio) ·
[Sharadar en QuantRocket](https://www.quantrocket.com/pricing/data/sharadar/) ·
[Tiingo pricing](https://www.tiingo.com/about/pricing) ·
[Finnhub fundamentals](https://finnhub.io/pricing-fundamental-data)

**El patrón se repite en los diez.** El plan de 20–100 € nunca autoriza enseñar
el dato a un cliente de pago. Ese permiso empieza en 399–499 € al mes. Es
exactamente el aviso que `docs/data-licensing-audit.md` da desde mayo: «Good API
shape, but licensing can become the real cost».

## C.3 ¿Sigue siendo Twelve Data la mejor opción?

`docs/adr-universo-twelve-data.md` lo dejó aplazado el 27-jul-2026 con una
frase que sigue siendo cierta: no se contrata hasta estar cerca del lanzamiento.
Lo que ha cambiado y lo que no:

**Lo que sigue en pie.** El mapeo del catálogo está verificado contra el
catálogo real (192.112 símbolos), las reglas de exclusión de OTC y la lista
blanca de MIC son buenas, y el diseño de universo por `mic_code` es correcto.

**Lo que ha cambiado.** Sí existe un plan self-serve con derecho de
**exhibición externa**: *Venture*, 499 $/mes (414 $ anual). No es
«redistribución» —eso es *Enterprise*, 1.099 $/mes— pero un screener que enseña
datos a sus suscriptores necesita exhibición, no redistribución. La nota que
tenía guardada («ningún plan self-serve de TD autoriza redistribución») es
correcta en la letra y hay que matizarla en la práctica: **para este caso de
uso, el escalón es Venture.**

**Lo que ha dejado de importar.** La exclusión de Australia por licencia de ASX,
y buena parte de las reglas de mercados internacionales: si la versión pública
es solo estadounidense, ese trabajo no se cobra.

**Lo que sigue faltando.** Twelve Data no resuelve el hueco principal. Los
trimestres profundos que necesita la rejilla los da EDGAR gratis; lo que Twelve
Data aporta de nuevo es el precio con licencia y las estimaciones (en *Pro* y
superiores). Contratarlo por los fundamentales sería pagar 499 $/mes por algo
que ya se tiene.

**Veredicto.** Twelve Data sigue siendo la opción más razonable **para la capa
de precio con licencia**, que es el problema real de Yahoo. No es la respuesta
al hueco de crecimiento. Y conviene comparar *Venture* (499 $) contra EODHD
*Internal Use* (399 €) pidiendo por escrito a EODHD si su plan *Custom* de
exhibición baja de ahí — porque su plan de 399 € **explícitamente no** permite
enseñar el dato fuera de la empresa, y eso lo descarta tal cual está publicado.

## C.4 La recomendación

Para un producto de pago **solo estadounidense**, en este orden:

1. **Fundamentales: EDGAR, gratis, con las seis mejoras de ingeniería de
   B.3.4.** Cubre el 77,1 % medido del universo con trimestres, y sube con la
   lista de etiquetas ampliada. Sin coste de licencia y con base legal explícita.
2. **Precio: un proveedor con licencia de exhibición.** Es el gasto inevitable.
   Rango real 414–499 $/mes (Twelve Data *Venture*) o presupuesto de EODHD /
   Massive. **Este es el número que hay que meter en las cuentas del
   lanzamiento, no el de los fundamentales.**
3. **Estimaciones y calendario: aplazar.** Son el 8.º y 9.º de la lista de
   prioridad; entran cuando el producto cobre y las cuentas los justifiquen.
4. **Emisores 20-F: no comprarlos.** Son el 19 % del universo y muchos no
   publican trimestres ni en origen. Se declaran ausentes con motivo (D.2).

---

# PARTE D — El coste de no tenerlo

## D.1 Hueco por hueco

### Aceptable lanzar sin ello

**Estimaciones de analistas, revisiones y sorpresas.** Son confirmación, no
clasificación. Ninguna de las tres escuelas las usa para decidir la etapa ni el
RS. Y el principio 1 juega a favor: publicar «batió estimaciones» roza la
recomendación. **Coste de no tenerlo: bajo.** Coste de tenerlo: 75 $/mes en
Finnhub o el escalón *Pro* de Twelve Data, sin derecho de exhibición.

**P/E, P/S y ratios de valoración.** No se muestran hoy y no deberían mostrarse
mañana (principio 2). **Coste: cero.**

**Inventarios y cuentas a cobrar.** Regla de calidad de beneficio de Minervini,
de segundo orden. Llegan gratis con la serie trimestral de EDGAR cuando entre.
**Coste de no tenerlo: bajo.**

**Propiedad institucional.** No es un hueco de dato: el porcentaje está al
99,6 % y el número de tenedores al 100 % (A.1.3). Es un hueco de persistencia y
de pantalla, y su coste de resolución es cero. Lo pongo aquí porque el producto
puede lanzarse sin mostrarlo: «I» de CAN SLIM es el criterio más débil de los
siete y ninguna de las otras dos escuelas lo usa.

### No aceptable lanzar sin ello

**La rejilla de crecimiento vacía o a medias.** Hoy: en blanco para el 94,1 %
desde caché, y con las dos columnas de la izquierda vacías cuando funciona. Es
uno de los seis bloques del cuerpo de la tarjeta de identidad y el único con
rejilla propia [CÓDIGO, `ChartIdentityCard.jsx`], en la superficie que el
principio 4 identifica como distribución («cada imagen compartida es un anuncio
con la marca dentro»). **Una ficha compartible con la rampa de crecimiento en
blanco es un anuncio de que al producto le faltan datos.** Y no hay excusa de
licencia: el dato es gratis y el tope es propio.

**El rango dentro del sector.** «RS 87» sin denominador no dice lo mismo que
«4º de 470». Es la lectura que el operador de esta escuela hace primero. Está a
un cálculo de distancia, con la materia prima al 99,8 %. **No lanzar con el
guion ahí puesto es defendible; lanzar con él es dejar visible que falta lo más
fácil.**

**La descripción del negocio en inglés.** El producto es en español, la ficha es
para compartir, y el bloque más humano de la tarjeta —a qué se dedica la
empresa— está en inglés crudo del proveedor en el 100 % de los casos. No es un
problema de dato: el dato está al 99,6 %. Es un problema de idioma.

**El precio sin licencia.** No es un hueco de dato sino de derecho, y es el
único que puede parar el lanzamiento entero. Está fuera del alcance de este
análisis, pero encabeza la lista de lo que impide cobrar.

### Zona gris

**`ipoDate` al 0 %.** Tres controles y un preset se evalúan sobre un campo
vacío. No se ve porque nadie usa esos filtros. Lo correcto por el principio 3 no
es rellenarlo: es que el control declare que no puede evaluarse, o retirarlo
hasta que haya dato. **Lanzar con un filtro que silenciosamente no filtra es
peor que no tener el filtro.**

**Fundamentales no persistidos.** No se ve hoy porque no hay pantalla que los
pida. En cuanto entre un filtro de «ventas +25 %», se ve entero: el nocturno no
puede evaluarlo y habría que reescanear desde el navegador — exactamente el
problema que `docs/adr-universo-precalculado.md` resolvió para lo técnico.

## D.2 Qué se puede aproximar con lo que hay, sin inventar

Cinco cosas se pueden servir hoy, honestamente. Ninguna inventa un dato.

**1. El rango dentro del sector: hacerlo, no aproximarlo.** Ordenar por
`rsGlobalPct` dentro de cada `sector` del propio escaneo y publicar «4 de 470».
Es un hecho contable sobre la población del escaneo, no un rating propietario.
Requisito del principio 5: decir sobre qué población, y no llamarlo «RS de
sector» —ese nombre está reservado al ranking semanal que no existe—. Muestras
por sector medidas: de 88 (Utilities) a 614 (Financial Services). Con menos de
~30 en un sector, ausencia con motivo.

**2. El crecimiento del último trimestre, ya.** `revenueGrowth` (94,7 %) y
`earningsGrowth` (99,7 %) están medidos y se tiran. Persistirlos permite
enseñar, hoy y sin proveedor nuevo, «ventas +34 % · BPA +51 % (3T26)». Un punto
no es una rampa —no demuestra aceleración— y hay que decirlo con esas palabras.
Pero es infinitamente mejor que un guion, y es exactamente lo que la escuela usa
como umbral de entrada (20–25 %).

**3. La antigüedad de cotización en lugar de la fecha de salida a bolsa.**
`computeListingDate` ya lo hace en la ficha y etiqueta el origen («Primera
cotización histórica disponible»). Llevarlo al nocturno resuelve el preset de
IPO sin fingir una fecha que no tenemos. Con la etiqueta puesta, no es
inventarse el dato: es decir cuál es.

**4. La descripción en español, traducida y cacheada.** Traducir con un modelo
las dos primeras frases de cada resumen y guardar el resultado junto al
original, con el pie de fuente intacto. No es inventar: es traducir un texto que
ya se tiene y ya se atribuye. Coste estimado para las 3.309 descripciones del
universo —media 1.192 caracteres, ~3,94 M caracteres, ≈ 1,0 M tokens de entrada
y ≈ 1,1 M de salida— con Claude Haiku 4.5 a 1 $/MTok de entrada y 5 $/MTok de
salida: **≈ 6,5 $ la pasada completa, ≈ 3,3 $ usando la API de lotes** [EST].
No es un coste recurrente relevante: las descripciones cambian una o dos veces
al año.

**5. El número de tenedores institucionales.** Cobertura 100 % en el caché,
valores reales, cero coste. Es el criterio «I» de CAN SLIM y hoy no llega ni a
la fila ni a la ficha. No es una aproximación: es el dato.

Y una que **no** se puede aproximar: **la aceleración de beneficios**. Con un
solo punto de crecimiento no hay derivada. Cualquier cosa que se pinte como
rampa a partir de 5 trimestres de Yahoo será una rampa con cuatro sextos
inventados. Ahí, el guion con motivo es la única respuesta honesta hasta que
entren los 10 trimestres de EDGAR.

---

# CONFIANZA

| Afirmación | Confianza | Base |
|---|---|---|
| El nocturno es 100 % estadounidense (3.309 filas, 1 país) | Alta | consulta directa citada |
| 44 de 3.309 filas conservan `growthMetrics`; las demás tienen `raw` vacío | Alta | dos consultas, una de conteo y otra de inspección de claves |
| `fundamentalCoverageScore` mediana 100, 82,9 % de filas al 100 % | Alta | histograma completo sobre las 3.309 filas |
| Cobertura campo a campo de los trece escalares (márgenes 99,8 %, `currentRatio` 91,3 %, tenedores institucionales 100 %) | Alta | consulta citada sobre el caché de perfil cruzado con el universo |
| `institutionsCountApprox` es un recuento real, no la longitud de una lista | Alta | reparto de valores: llega a 22 y más, y solo 6 símbolos traen 0 |
| Yahoo entrega 5 trimestres al 94,1 % del universo, máximo 7 | Alta | reparto completo sobre el caché de perfiles |
| Ninguno de los 11.046 símbolos del caché llega a 10 trimestres | Alta | mismo reparto, ambos grupos |
| 4 ejercicios anuales en el 95,1 % del universo, máximo 5 | Alta | reparto completo de `incomeAnnual` sobre el universo |
| `ipoDate` vacío en las 60.068 filas de `scan_results` | Alta | consulta sobre la tabla entera |
| `weeklyPriceAboveSlowMa` ha pasado de 0 % a 98,7 % | Alta | consulta de hoy frente a la cifra publicada el 17-ago |
| RS de país idéntico al global en el 100 % de las filas | Alta | consulta directa |
| El motor de RS vigente tiene 0 filas con sector | Alta | agrupación por `engine_version` |
| La rejilla necesita 10 trimestres; con 8 quedan 2 columnas vacías | Alta | simulación con el código real de `quarterlyGrowthCells` |
| Los dos topes de 8 (`lib/sec.js`, `mergeRows`) | Alta | lectura del código, líneas citadas |
| AAPL tiene 30 trimestres y 9 anuales en EDGAR | Alta | descarga y recuento del `companyconcept` |
| Falta el Q4 fiscal en EDGAR desde FY2021 en AAPL | Alta | lista completa de fechas, trimestrales y anuales, mostrada |
| 99,8 % del universo tiene CIK | Alta | cruce completo con `company_tickers.json` (10.403 entradas) |
| 72,1 % / 77,1 % tiene trimestre discreto en EDGAR | **Media-alta** | es un **suelo**: los `frames` solo recogen ejercicios alineados al trimestre natural y una sola unidad; empresas con año fiscal desplazado quedan fuera aunque tengan el dato |
| SAP, TSM y NVO reportan en `ifrs-full`; ASML en EUR | Alta | tres códigos HTTP por emisor, mostrados |
| `lib/sec.js` no lee `ifrs-full` ni unidades distintas de USD | Alta | lectura del código (`unitsFor`, `TAGS`) |
| 81,0 % del universo son empresas domiciliadas en EE. UU. | Alta | agrupación por país del perfil |
| `marketCap` en divisa local (JP mediana 6,48 billones) | Alta | medianas por país mostradas |
| Precios y condiciones de licencia de los proveedores | Media-alta | páginas oficiales consultadas hoy; FMP a través de un tercero porque su web devuelve 403 |
| Coste de traducir 3.309 descripciones ≈ 6,5 $ | **Estimado** | conteo de caracteres real, conversión a tokens aproximada (4 car./token) |
| Prioridades de B.2 y recomendación de C.4 | — | juicio de diseño; discutible, no verificable |

---

# LO QUE NO HE VERIFICADO

- **Una ficha real.** El encargo pedía no abrirlas y no las he abierto. Todo lo
  que digo sobre lo que se ve en la tarjeta sale del código
  (`ChartIdentityCard.jsx`, `chartIdentityCard.js`, `descriptiveStrip.js`) y de
  simular la función de la rejilla, no de mirar la pantalla. En particular, **no
  sé qué proporción de la tarjeta ocupa cada bloque**: cuento seis bloques en el
  JSX, no mido píxeles.
- **Qué devuelve realmente la ficha hoy.** La cadena Yahoo + SEC + FMP se funde
  en vivo y no he ejecutado esa fusión sobre ningún símbolo: las 4 de 6 celdas
  salen de la simulación con 8 trimestres, no de una respuesta real de
  `/api/company-brief`. Si FMP estuviera configurado y aportara trimestres
  extra, el tope de `slice(0, 8)` seguiría mandando, pero el reparto podría
  cambiar.
- **Un símbolo del universo.** La lista que crucé con la SEC tiene 3.308
  símbolos y el escaneo 3.309: se perdió uno al transcribir. Es el 0,03 % y no
  cambia ningún porcentaje al primer decimal, pero la cifra de CIK es sobre
  3.308, no sobre 3.309.
- **Cuántos emisores del universo presentan 20-F.** He demostrado el mecanismo
  con seis casos y he medido el 19,0 % de emisores no domiciliados en EE. UU.
  como población de riesgo. No he contado cuántos de esos 630 presentan 20-F y
  cuántos 10-K como SHOP.
- **La lista completa de etiquetas XBRL por tipo de emisor.** He medido que
  añadir dos sube 5 puntos. No he construido la lista correcta para banca,
  seguros y REIT, ni sé dónde topa.
- **Si EDGAR cubre los trece escalares.** He verificado ingresos y beneficio.
  `lib/sec.js` deriva márgenes, ROE, ROA, deuda y ratio corriente de otros
  conceptos; no he medido su cobertura sobre el universo, solo he leído el
  código.
- **La frescura real de `shortPercentOfFloat`.** Yahoo no publica fecha de corte
  y no la guardamos. Un 99,1 % de cobertura no dice de cuándo es el dato.
- **Por qué 118 símbolos del nocturno no tienen ninguna serie trimestral en
  caché.** Constato el número; no he mirado si son IPO recientes, fallos de
  proveedor o símbolos sin cobertura en Yahoo.
- **Los planes a presupuesto.** EODHD *Custom*, Massive *Business*, Sharadar y
  Tiingo con redistribución no publican precio. Lo que digo de ellos es que hay
  que pedirlo, no cuánto cuesta.
- **La página de precios de FMP.** Devuelve 403 a la herramienta de descarga.
  Los precios de FMP vienen de un recopilador que dice haberlos verificado el
  30-jul-2026; hay que confirmarlos en la fuente antes de decidir nada.
- **Nada de esto se ha contrastado con un abogado.** `data-licensing-audit.md`
  ya avisa de que es una lista de comprobación de ingeniería, no asesoramiento
  legal. Lo que digo de EDGAR se apoya en la declaración de la propia SEC; lo que
  digo de los planes comerciales, en la letra publicada de cada proveedor.
- **El libro de O'Neil.** Sigue sin capa de texto recuperable (1 bloque en 2.371
  páginas, comprobado hoy). Todo lo atribuido a esa escuela viene de fuentes
  secundarias citadas por URL, no del original.
