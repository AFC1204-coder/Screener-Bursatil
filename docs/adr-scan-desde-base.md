# ADR — El escaneo interactivo deja de descargar y pasa a leer de la base

<!-- fecha interna: 2026-08-09 · BASE_SHA: 6894d14 · rama: codex/statsedge-ui-polish -->

Este documento es de **diseño**, no de implementación. No se modificó
ningún archivo de código ni se escribió en Supabase. La decisión de
producto (el escaneo interactivo lee `daily_bars` en vez de pedir a Yahoo
el histórico símbolo a símbolo; la ficha de un valor concreto sigue en
vivo) ya está tomada y no se cuestiona aquí — este documento diseña las
opciones para llegar a ella.

**Resumen para quien no programa**: hoy, cuando pulsas "Ejecutar" con
"Todo el universo", el servidor le pide a Yahoo Finance el histórico de
cada una de las 10.234 acciones, una por una — por eso muere de timeout
sobre el símbolo 600. Gran parte de esos datos YA están guardados en
nuestra propia base de datos (`daily_bars`), refrescados por un script que
ya corre aparte. Este documento examina si el escaneo puede leer esa base
en vez de llamar a Yahoo, cuánto costaría, dónde tocaría el código, qué
se rompería y qué opciones hay — sin decidir todavía cuál tomar.

**Hallazgo que condiciona todo el diseño, adelantado aquí**: no solo hay
que sustituir las barras de precio — el **perfil de empresa** (sector,
industria, capitalización, resumen de negocio, interés en corto) que
`buildResearchRow` también necesita **igualmente se pide a Yahoo en vivo
hoy**, con CUATRO peticiones por símbolo, no una. Existe una caché
equivalente a `daily_bars` para esto (`fundamental_snapshots`, con
`period_type='profile'`) que el cron ya usa — pero el escaneo interactivo
tampoco la usa hoy. El diseño tiene que cubrir las dos cosas, no solo las
barras.

---

## PARTE A — Qué necesita el escaneo y de dónde sale hoy

### A.1 — Inventario completo de lo que pide `buildResearchRow`

Cita literal de la firma, [`lib/researchRow.js:72`](../lib/researchRow.js#L72):
```js
function buildResearchRow(symbol, chart, profile = {}, requireLongHistoryOrOptions = false, benchmarks = {}) {
```
Cuatro fuentes de datos, además del propio `symbol`:

| Parámetro | Qué campos usa `buildResearchRow` de él | ¿Está en Supabase hoy? |
|---|---|---|
| `chart` | `chart.bars` (array OHLCV), `chart.meta.regularMarketPrice`/`regularMarketPreviousClose`/`previousClose`, `chart.meta.shortName`, `chart.meta.exchangeName`, `chart.meta.currency`, `chart.meta.dataProvider`, `chart.meta.fallbackReason` | **Las barras sí** (`daily_bars`). El resto de `meta` (shortName/exchangeName) no tiene equivalente — pero es redundante con `profile`, ver A.4. |
| `profile` | `profile.name`, `.exchange`, `.sector`, `.industry`, `.currency`, `.ipoDate`, `.website`, `.businessSummary`, `.growthMetrics`, `.shortPercentOfFloat`, `.sharesPercentSharesOut`, `.shortRatio`, `.sharesShort`, `.floatShares`, `.marketCap` | **Sí**, con matices — ver A.2. |
| `options` (`requireLongHistory`, `stageFastWeeks/SlowWeeks/SlopeWeeks`) | Parámetros de cálculo, no datos externos | N/A — vienen de `activeSettings` del propio scan, no de un proveedor. |
| `benchmarks` | Mapa `{ [symbol]: { bars } }` para SPY/QQQ/ACWI + benchmark local (ej. `^IBEX`) | Los benchmarks son símbolos como cualquier otro — sus barras también viven en `daily_bars` si se han descargado alguna vez (ver A.4, `loadBenchmarks`). |

### A.2 — El perfil de empresa: cita del código, y sí existe un equivalente

**Hoy se pide siempre a Yahoo, con CUATRO llamadas por símbolo.** Cita
completa, [`lib/yahoo.js:1311-1318`](../lib/yahoo.js#L1311):
```js
export async function fetchYahooProfile(symbol) {
  const yahooSymbol = canonicalYahooSymbol(symbol);
  const [summaryResult, fundamentalsResult, searchResult, quoteResult] = await Promise.allSettled([
    fetchYahooQuoteSummary(yahooSymbol),
    fetchYahooFundamentals(yahooSymbol),
    fetchYahooSearchProfile(yahooSymbol),
    fetchYahooQuote(yahooSymbol),
  ]);
```
Es decir: el problema de "una llamada por símbolo" en realidad son
**cinco** llamadas de red externas por símbolo (una de chart + cuatro de
perfil), no una — el diagnóstico de la Parte B necesita contar con esto.

**Sí existe una tabla y una caché equivalente, y el cron ya la usa —
el escaneo interactivo no.** `fundamental_snapshots` con
`period_type='profile'`, gestionada por [`lib/fundamentalsCache.js`](../lib/fundamentalsCache.js).
Cita de qué guarda exactamente, `lib/fundamentalsCache.js:62-91`:
```js
function profileMetrics(profile = {}) {
  return {
    name: profile.name || "",
    sector: profile.sector || "",
    industry: profile.industry || "",
    exchange: profile.exchange || "",
    currency: profile.currency || "",
    ipoDate: profile.ipoDate || "",
    website: profile.website || "",
    city: profile.city || "",
    country: profile.country || "",
    fullTimeEmployees: profile.fullTimeEmployees ?? null,
    businessSummary: profile.businessSummary || "",
    marketCap: numberOrNull(profile.marketCap),
    shortPercentOfFloat: numberOrNull(profile.shortPercentOfFloat),
    sharesPercentSharesOut: numberOrNull(profile.sharesPercentSharesOut),
    shortRatio: numberOrNull(profile.shortRatio),
    sharesShort: numberOrNull(profile.sharesShort),
    sharesShortPriorMonth: numberOrNull(profile.sharesShortPriorMonth),
    floatShares: numberOrNull(profile.floatShares),
    sharesOutstanding: numberOrNull(profile.sharesOutstanding),
    valuationMetrics: profile.valuationMetrics || {},
    quoteSnapshot: profile.quoteSnapshot || {},
    growthMetrics: profile.growthMetrics || {},
    fundamentalsFinancialResults: profile.fundamentalsFinancialResults || null,
    shortInterest: profile.shortInterest || null,
    profileProviderError: profile.profileProviderError || null,
    sourceProviders: sourceProviders(profile),
  };
}
```
Cubre **exactamente** los campos que `buildResearchRow` necesita de
`profile` (comparar con la tabla de A.1). El lector/escritor con el mismo
patrón "leer caché, si falta pedir en vivo y guardar" que `daily_bars`:
[`lib/fundamentalsCache.js:217-247`](../lib/fundamentalsCache.js#L217)
(`withProfileCache`, citado completo en C.10).

**Quién lo usa hoy** (grep exhaustivo):
```
grep -rln "withProfileCache|readProfileCache|writeProfileCache" app lib
→ app/api/company-brief/route.js, app/api/profile/route.js,
  lib/materializedScanner.js, lib/fundamentalsCache.js
```
**`lib/serverScanRunner.js` NO está en esa lista.** El escaneo interactivo
llama a `fetchYahooProfile` directamente (cita en C.9), sin pasar por la
caché — a diferencia del cron, que sí la usa vía `fetchProfileForScan`
(cita completa en C.10).

**Cobertura real, medida** (no puedo hacer `COUNT`, la clave de solo
lectura no soporta agregados — ver "LO QUE NO HE VERIFICADO"):
```
supabase_query(table="fundamental_snapshots", select="symbol,updated_at",
  filter="period_type=eq.profile&symbol=in.(JPM,V,XOM,WMT,PG,UNH,HD,KO,PFE,PEP,TSLA,META)",
  order="symbol.asc,updated_at.desc", limit=50)
```
Las 20 mega-caps estadounidenses que probé (JPM, V, XOM, WMT, PG, UNH, HD,
KO, PFE, PEP, TSLA, META + AAPL, MSFT, GOOGL, AMZN, NVDA, BAC, COST, DIS)
**todas tienen fila** — pero la fecha más reciente varía mucho: algunas
actualizadas hoy mismo (AAPL, 2026-08-09), otras no se tocan desde
**2026-06-05** (WMT, V, PG, KO, HD, PEP, PFE) — más de 2 meses de
antigüedad a fecha de hoy. La caché de perfil existe y cubre símbolos
grandes, pero está **mucho menos fresca** que `daily_bars` (que el script
de refresco toca a diario) — esto importa para C.10/D.14: leer perfil de
esta tabla es viable, pero con `maxAgeDays` generoso (el perfil cambia
lento — sector/industria no cambian en 2 meses — así que esto es
aceptable, pero hay que decidirlo explícitamente, no asumirlo).

### A.3 — Fundamentales financieros: `fundamental_snapshots` con otros `period_type`

La misma tabla también guarda fundamentales financieros propiamente
dichos (no solo el perfil), vía [`lib/jquants.js`](../lib/jquants.js) y
[`lib/esef.js`](../lib/esef.js) — pero `buildResearchRow` **no los usa
directamente**: los fundamentales financieros "duros" (balance, cuenta de
resultados) entran a través de `profile.growthMetrics`/`fundamentalsFinancialResults`,
que ya vienen empaquetados dentro del objeto `profile` de A.2, no como una
fuente aparte. No hay una fuente adicional que `buildResearchRow` necesite
de aquí más allá de lo que ya cubre A.2.

### A.4 — ¿Hay algo que NO esté materializado? Bloqueantes

**No hay ningún bloqueante duro** (algo que `buildResearchRow` necesite y
para lo que no exista NINGUNA tabla) — las dos piezas (barras, perfil)
tienen tabla y caché equivalentes, ambas ya en uso por el cron. Pero hay
**dos huecos de cobertura** que sí condicionan el diseño, no bloquean el
concepto:

1. **`daily_bars` está fuertemente sesgado a EE.UU.** Cita del propio
   script de refresco, [`scripts/refresh-bars.mjs:142,161`](../scripts/refresh-bars.mjs#L142):
   ```js
   "market=eq.US",
   ...
   "market=eq.US",
   ```
   Es decir: la corrida que produjo los "5.564 símbolos con barras hasta
   el 7 de agosto" **solo tocó el mercado US** — no es una muestra
   aleatoria del universo global de 10.234, es prácticamente toda la
   población investable estadounidense. Comprobé con símbolos europeos y
   japoneses sueltos (no una medición sistemática — no puedo contar):
   ```
   SAN.MC → 2026-07-31   BBVA.MC → 2026-08-07   SAP.DE → 2026-08-06
   DSV.CO → 2026-08-07   KBC.BR → 2026-08-07    6758.T → 2026-08-07 (con historial largo)
   ```
   Los símbolos no-US que probé SÍ tienen barras recientes — pero vienen
   del cron general (`materializedScanner.js`/`shadow-europe-refresh`,
   que ya escribe en `daily_bars` vía `withDailyBarsCache`, cita en C.10),
   no de un barrido deliberado como el de EE.UU. **No hay ningún script
   equivalente a `refresh-bars.mjs` para el resto de los 29 mercados** —
   confirmado por grep: `scripts/refresh-bars.mjs` es el único con este
   propósito. La cobertura real fuera de EE.UU. es desconocida (no
   medible sin `COUNT`), plausiblemente mucho más baja e irregular.
2. **La caché de perfil (`fundamental_snapshots`, A.2) tiene freshness
   muy dispar** — de "hoy" a "hace 2 meses" en las mismas mega-caps.

**Ninguno de los dos es un "párate, no se puede diseñar"** — son
condicionantes del plan de fases (Parte E) y de las opciones de la Parte
C.11, no bloqueantes del concepto general.

---

## PARTE B — Cuánto costaría leer en vez de descargar

### B.5 — Volumen: ¿es viable leer 1,3M de filas vía PostgREST?

El cálculo del enunciado es razonable como orden de magnitud: `perf12m`
necesita 252 barras (`lib/researchRow.js:105`: `perf(calcBars, 252)`), y
el cap de escritura real es más generoso — `WRITE_CAP_DEFAULT = 400`
([`lib/dailyBarsCache.js:19`](../lib/dailyBarsCache.js#L19)) — así que el
volumen realista por símbolo va de ~250 (mínimo necesario) a 400 (tope de
lo que se guarda) filas. Para 5.564 símbolos (US), eso es
**1,4-2,2 millones de filas ya almacenadas**; para el universo global de
10.234 (si algún día estuviera igual de cubierto), 2,6-4,1 millones.

**¿Viable vía PostgREST?** Sí, pero **no en una sola consulta, ni
agrupando muchos símbolos por consulta** — lo verifiqué directamente
(no es una suposición, ver B.6): un solo símbolo grande (AAPL) por sí solo
ya llena una respuesta de 200 filas sin agotar su historial. La
arquitectura que ya existe en el repo (`readDailyBarsCache`,
`lib/dailyBarsCache.js:256-314`, citado completo en C.10) resuelve esto
exactamente como cabría esperar: **una consulta por símbolo**
(`symbol=eq.<uno>`, no `in.(...)`), igual que hoy se hace una llamada a
Yahoo por símbolo. El volumen total de filas no cambia el hecho de que
sigue siendo ~1 petición HTTP por símbolo — lo que cambia es que cada
petición es una consulta a la propia base (rápida, sin depender de
Yahoo) en vez de una llamada a un proveedor externo.

### B.6 — Medición real, y su límite

**Medición intentada, con el resultado honesto de que no se pudo
completar como pedía el enunciado.** El conector de solo lectura
disponible en esta sesión tiene un tope de 200 filas por respuesta y no
soporta paginación (`offset`) — así que "leer 100 símbolos × ~260 barras
(26.000 filas) en una consulta" es **físicamente imposible con esta
herramienta**, no solo lento. Lo comprobé directamente:

```
supabase_query(table="daily_bars", select="symbol,trade_date,close",
  filter="owner_id=eq.personal&symbol=in.(AAPL,MSFT,GOOGL,AMZN,NVDA)",
  order="symbol.asc,trade_date.desc", limit=200)
```
Resultado: **las 200 filas devueltas son TODAS de `AAPL`** — ni siquiera
llegó a MSFT. Esto es, en sí mismo, una confirmación empírica y directa de
la pregunta de B.7 (el límite de tamaño de respuesta es real y se topa con
un solo símbolo, no con cien) — no una medición de velocidad, pero sí una
medición de la forma del problema.

**No pude cronometrar con precisión** por dos razones adicionales: (1) la
herramienta de solo lectura no expone latencia de red, y (2) no tengo
acceso directo (curl/credenciales) a la API de Supabase fuera de esa
herramienta — usarlo hubiera esquivado el canal que la tarea autoriza.
Lo más cercano a una medición real de este tipo de lectura que existe en
el repo es de una tabla comparable (`scan_results`, no `daily_bars`, pero
mismo Postgres/PostgREST, paginación por lotes de 1000):
[`docs/overhead-scan-2026-08-05.md:347`](../docs/overhead-scan-2026-08-05.md#L347):
```
universe_read: 12 peticiones, 2712ms suma-duraciones, 226.0ms/peticion promedio, 3401ms span-reloj-pared
```
**Esto es una medición real, pero de otra tabla — lo cito como la mejor
referencia disponible del orden de magnitud de latencia Supabase-a-Vercel
en este proyecto, no como una medición directa de `daily_bars`.**

**Extrapolación (marcada como tal, no medición)**: si una lectura de un
símbolo contra `daily_bars` (filtrada por `owner_id,symbol`, cubierta por
el índice `daily_bars_symbol_date_idx`, [`supabase/schema.sql:1539`](../supabase/schema.sql#L1539))
tarda un orden de magnitud similar (100-300ms, por analogía con
`universe_read` arriba, que es una lectura indexada equivalente en forma),
5.000 símbolos a razón de 1 petición cada uno, con la concurrencia 5 que
ya usa el runner ([`lib/serverScanRunner.js:27`](../lib/serverScanRunner.js#L27):
`SCAN_CONCURRENCY = 5`), darían:
```
5.000 símbolos / 5 concurrentes × 0,15-0,3s ≈ 150-300s solo para las barras
```
Esto **es una extrapolación con un supuesto no verificado (que
Supabase-Vercel se comporta como Vercel-Supabase para `scan_results`)**,
no un número medido. Lo marco así explícitamente. Es, aun así, muy
probablemente más rápido y más FIABLE que las llamadas a Yahoo de hoy
(sin rate-limiting externo, sin dependencia de un tercero fuera de la
infraestructura propia) — pero la ganancia real solo se confirma
midiendo, no extrapolando.

### B.7 — Troceo y encaje en el tiempo de una invocación de Vercel

**Cómo trocear**: por símbolo, reusando `readDailyBarsCache`/`withDailyBarsCache`
tal cual existen — no por lotes de varios símbolos por consulta. Un lote
de "varios símbolos por consulta" (`symbol=in.(...)`) para reducir el
número de peticiones **no funciona bien aquí** porque, como demostró B.6,
un solo símbolo grande ya se acerca o supera cualquier límite razonable
de tamaño de respuesta — mezclar varios en una respuesta obligaría a un
`limit` por símbolo muy pequeño (menos barras de las que el scoring
necesita) o a construir lógica nueva de "trocear por símbolo dentro de la
respuesta mezclada", que no existe hoy y que el propio `dedupeBars`/`normalizeCachedBar`
de `lib/dailyBarsCache.js` no está pensado para separar por símbolo desde
una respuesta multi-símbolo.

**¿Cabe en el tiempo de una invocación?** Con `DEFAULT_SCAN_CHUNK_SIZE =
300` ([`lib/serverScanRunner.js:34`](../lib/serverScanRunner.js#L34), que
esta tarea NO propone tocar) y concurrencia 5, un tramo de 300 símbolos
leídos de la base en vez de descargados de Yahoo, con la extrapolación de
B.6 (0,15-0,3s/símbolo), tardaría:
```
300 símbolos / 5 concurrentes × 0,15-0,3s ≈ 9-18s por tramo (solo barras)
```
— muy por debajo del techo real de Vercel (documentado en
`docs/limite-600-scan-2026-08-09.md` como "probablemente 60s en el plan
Hobby pese al `maxDuration=300` declarado"). Sumando el perfil (misma
lectura, misma tabla distinta, mismo orden de magnitud) el tramo
completo seguiría, con esta extrapolación, muy por debajo de 60s. **Esto
sigue siendo estimación, no medición** — la mejora real solo se confirma
corriendo un tramo real (fuera del alcance de esta tarea, que prohíbe
ejecutar escaneos).

### B.8 — Alternativa: métricas precalculadas por símbolo

**Evaluación, sin decidir.** Es la opción que reduce el volumen de verdad:
en vez de leer ~260-400 filas de `daily_bars` por símbolo y recalcular
SMA/perf/etapa/patrón en cada escaneo, un proceso nocturno podría dejar
**una fila por símbolo** con las métricas ya calculadas (lo que hoy
calcula `buildResearchRow` a partir de las barras), y el escaneo
interactivo solo leería esa fila — de 1,3-4 millones de filas a
10.000-10.234 filas, una por símbolo.

**No es una idea nueva sin precedente parcial**: existe `scan_symbol_history`
(tabla "aditiva", solo inserta en cambios reales — ver
[`docs/limite-scan-interactivo-2026-08-09.md`](limite-scan-interactivo-2026-08-09.md),
sección de este mismo repo que ya la analizó), pero **no cubre lo que
`buildResearchRow` necesita**: guarda `rs_global`, `rs_benchmark`,
`composite_score`, `stage`, `passed_screen` — no las ~45 métricas VCP
crudas (`baseNearPivotDays`, `contractionDepths`, `setupVerdictKey`, etc.)
que sí construye `buildResearchRow`. Reusarla exigiría o (a) ampliar su
esquema con todas esas columnas, o (b) crear una tabla nueva paralela.
Ambas son más trabajo que "leer `daily_bars` tal cual", pero el ahorro de
volumen es real y sustancial. Compensación: el propio proceso nocturno que
la alimentaría tendría que ejecutar `buildResearchRow` (o un equivalente)
para los 10.234 símbolos cada noche — es decir, mueve el coste
computacional de "en cada escaneo interactivo" a "una vez cada noche",
que es exactamente el tipo de trade-off que ya aplica `scripts/rs-universe.mjs`
para RS.

---

## PARTE C — Dónde encaja en el código

### C.9 — Punto exacto de la llamada a Yahoo

Cita literal, [`lib/serverScanRunner.js:255-259`](../lib/serverScanRunner.js#L255):
```js
        try {
          const [chart, profile] = await Promise.all([
            fetchYahooChart(symbol),
            fetchYahooProfile(symbol).catch(() => ({})),
          ]);
```
Y para los benchmarks (SPY/QQQ/ACWI + benchmark local), dentro de
`loadBenchmarks`, [`lib/serverScanRunner.js:159-166`](../lib/serverScanRunner.js#L159):
```js
  const entries = await Promise.all(all.map(async (symbol) => {
    try {
      return [symbol, await fetchYahooChart(symbol)];
    } catch {
      return [symbol, { bars: [] }];
    }
  }));
```
Import correspondiente, [`lib/serverScanRunner.js:16`](../lib/serverScanRunner.js#L16):
```js
import { fetchYahooChart, fetchYahooProfile } from "@/lib/marketData";
```

### C.10 — ¿Se puede sustituir sin tocar `buildResearchRow`?

**Sí — y no haría falta escribir la lógica de lectura desde cero: ya
existe, ya está en producción, y `lib/serverScanRunner.js` ya importa el
módulo hermano de escritura.**

Cita del wrapper de lectura-o-descarga para barras (completo),
[`lib/dailyBarsCache.js:412-464`](../lib/dailyBarsCache.js#L412):
```js
export async function withDailyBarsCache(symbol, options = {}, fetcher) {
  const cacheable = !isIntraday(options);
  const useCache = options.useCache !== false && cacheable;
  let cached = null;

  if (useCache && !options.refresh) {
    cached = await readDailyBarsCache(symbol, options);
    if (cached.hit) return chartFromCache(symbol, cached, options);
  }

  try {
    const live = await fetcher(symbol, options);
    const write = useCache ? await writeDailyBarsCache(symbol, live, options) : { status: cacheable ? "skipped-disabled" : "skipped-intraday", written: false, count: 0 };
    ...
    return { ...live, bars: resolvedBars, meta: { ...(live.meta || {}), asOf, cache: { read: cacheSummary(cached), write } }, dataQuality: resolvedDataQuality };
  } catch (error) {
    if (cached?.bars?.length) {
      return chartFromCache(symbol, { ...cached, stale: true, ... }, options, { fallbackError: error.message || "live provider failed" });
    }
    throw error;
  }
}
```
Y el equivalente para perfil, `withProfileCache`, [`lib/fundamentalsCache.js:217-247`](../lib/fundamentalsCache.js#L217)
(mismo patrón: lee caché, si falta/caduca pide en vivo, escribe).

**El cron YA usa exactamente este patrón** para el mismo propósito,
[`lib/materializedScanner.js:521-537`](../lib/materializedScanner.js#L521):
```js
async function fetchChartForScan(symbol, options = {}) {
  return withDailyBarsCache(symbol, {
    range: options.chartRange || "2A",
    interval: "D",
    refresh: options.refreshPrices,
    useCache: options.cache !== false,
    maxAgeDays: options.maxPriceFreshnessDays,
  }, fetchYahooChart);
}

async function fetchProfileForScan(symbol, options = {}) {
  return withProfileCache(symbol, {
    refresh: options.refreshProfiles,
    useCache: options.cache !== false,
    maxAgeDays: options.maxFundamentalsAgeDays,
  }, fetchLiveProfile);
}
```
El cambio de diseño en `lib/serverScanRunner.js` (que esta tarea NO
implementa) sería, conceptualmente, sustituir la línea 256-259 citada
arriba por algo con la misma forma que estas dos funciones — pasando
`fetchYahooChart`/`fetchYahooProfile` como `fetcher` de fallback, igual
que hace el cron. `buildResearchRow` recibiría el `chart`/`profile`
resultante **sin cambiar su firma ni su cuerpo**: `withDailyBarsCache`
devuelve `{ bars, meta, dataQuality }` (vía `chartFromCache`, citado en
A.1), la misma forma que ya consume `buildResearchRow` hoy.

**Matiz no crítico**: `chartFromCache` no rellena `meta.shortName` ni
`meta.exchangeName` (cita, [`lib/dailyBarsCache.js:167-185`](../lib/dailyBarsCache.js#L167),
solo trae `symbol,regularMarketPrice,currency,dataProvider,sourceProvider,...`).
`buildResearchRow` los usa como *fallback* de `companyName`/`exchange`
(`profile.name || chart.meta?.shortName || symbol`,
[`lib/researchRow.js:111`](../lib/researchRow.js#L111)) — como `profile`
ya trae `name`/`exchange` por su propio lado (A.2), este fallback nunca
llegaría a activarse en la práctica. No requiere cambiar
`buildResearchRow`; es una observación, no un bloqueante.

### C.11 — Símbolos sin barras en la base: opciones sin decidir

El enunciado cita ~41 de 5.605 que fallaron al refrescar (no lo pude
verificar de forma independiente — es una cifra del propio commit de
`scripts/refresh-bars.mjs`, no algo que haya re-contado), más los que
nunca se han tocado (sobre todo fuera de EE.UU., ver A.4). Opciones:

1. **Fallback automático a Yahoo en caliente, solo para el símbolo que
   falte** — es lo que YA hace `withDailyBarsCache`/`withProfileCache`
   tal cual (C.10, rama `if (cached.hit) ... else fetcher(...)`): si la
   caché falla o caduca, cae a Yahoo para ESE símbolo en concreto, sin
   código nuevo. Riesgo: si la cobertura real (sobre todo fuera de
   EE.UU., A.4) es baja, una fracción grande del universo seguiría
   golpeando Yahoo símbolo a símbolo — el mismo riesgo de timeout que
   hoy, solo que reducido a los símbolos sin caché en vez de a todos.
2. **Excluir del scan los símbolos sin dato materializado** (no
   fallback, no se analizan esta vez) — predecible en tiempo, pero el
   usuario ve menos símbolos de los que pidió sin ningún aviso claro de
   por qué (mismo tipo de problema de transparencia que
   `docs/limite-600-scan-2026-08-09.md` ya identificó en la etiqueta
   final).
3. **Barrer primero, escanear después**: correr un equivalente de
   `scripts/refresh-bars.mjs` para TODO el universo (no solo US) antes de
   activar la lectura-en-vez-de-descarga por defecto — cierra el hueco de
   A.4 en vez de convivir con él. Es trabajo adicional (un script nuevo o
   una extensión del existente para cubrir todos los mercados), no un
   cambio de una línea.
4. **Híbrido con techo**: fallback a Yahoo solo hasta un número máximo de
   símbolos por tramo (ej. 20-30), y el resto de símbolos sin caché se
   marcan como "pendiente" para un tramo posterior o para el cron
   nocturno — acota el riesgo de timeout sin excluir símbolos
   permanentemente, a cambio de más complejidad en el runner (que esta
   tarea no debe tocar de todas formas, al ser de diseño).

No recomiendo ninguna — quedan como opciones, tal como pide el encargo.

---

## PARTE D — Qué se rompe

### D.12 — Qué deja de funcionar

- **Frescura del precio intradía**: hoy, durante la sesión, el precio que
  ve el usuario en el scan puede incluir la cotización en vivo (Yahoo
  suele incluir una vela parcial del día en curso). Leyendo de
  `daily_bars` (refrescada de noche), el precio mostrado sería el cierre
  del día anterior — esto es EXACTAMENTE el cambio de producto ya
  decidido y no cuestionado aquí (ver motivo del encargo: "es lo que hace
  MarketSmith").
- **Símbolos genuinamente nuevos** (IPOs recientes, o cualquier símbolo
  que el universo incorpore pero que nunca se haya descargado): sin
  fallback a Yahoo (opción 2 de C.11) simplemente no aparecerían en un
  escaneo hasta que el proceso nocturno los cubra. Con fallback (opción
  1), sí aparecerían, pero pagando la misma latencia de hoy solo para
  ellos.
- **Cualquier `dataQuality`/`chartFallbackReason` que dependa de
  particularidades del fetch en vivo de Yahoo de ESE instante** (ej. un
  fallback estimado puntual que Yahoo hubiera devuelto en ese momento
  exacto) — al leer de caché, lo que se sirve es lo que se guardó la
  última vez que se descargó, no lo que Yahoo devolvería *ahora mismo*.
  El guard anti-estimados de `writeDailyBarsCache`
  ([`lib/dailyBarsCache.js:321-333`](../lib/dailyBarsCache.js#L321)) ya
  garantiza que nada estimado se guarda, así que este riesgo es bajo, no
  nulo.

### D.13 — ¿Alguna superficie depende hoy de que el escaneo descargue?

Búsqueda de consumidores que dependan específicamente de que el CHART
usado por el scan sea el de Yahoo en vivo (no de que exista un chart en
absoluto): no encontré ningún código que distinga "este dato vino de un
escaneo interactivo en vivo" de "este dato vino de caché" más allá del
propio `chart.meta.dataProvider`/`dataQuality.source`, que ya está
diseñado para tolerar ambos casos (`"StatsEdge daily_bars cache"` vs
`"Yahoo Finance"`) — es decir, el resto del pipeline (`scoreRelativeStrength`,
`scoreWeinstein`, etc.) ya es agnóstico a la procedencia del chart, porque
`buildResearchRow` nunca ramifica en función de `dataProvider` para el
cálculo, solo para mostrarlo. La única superficie que sí depende de que
el escaneo descargue barras FRESCAS es la propia escritura a
`daily_bars` que el escaneo hace hoy
(`writeDailyBarsCache(symbol, chart, {interval:"D"})`,
[`lib/serverScanRunner.js:272`](../lib/serverScanRunner.js#L272),
documentado como el fix de `docs/barras-desfasadas-2026-08-09.md`): si el
escaneo deja de descargar, deja de alimentar esa vía de refresco — el
propio `scripts/refresh-bars.mjs` señala esto en su cabecera
([`scripts/refresh-bars.mjs:6-9`](../scripts/refresh-bars.mjs#L6)): *"el
escaneo interactivo... solo refresca lo que alguien escanea — ninguno de
los dos barre el universo"*. Si el escaneo deja de descargar, esa fuente
de refresco desaparece del todo, y el peso de mantener `daily_bars` al
día recae enteramente en `scripts/refresh-bars.mjs` (manual, solo US hoy)
y en el cron nocturno (lento, doce símbolos/noche).

### D.14 — `priceFreshnessOk`/`maxPriceFreshnessDays` con datos del cierre anterior

Cita del cálculo, [`lib/dataCoverageShared.js:81-98`](../lib/dataCoverageShared.js#L81):
```js
export function priceFreshnessForDate(lastDate = "", maxDays = DEFAULT_PRICE_FRESHNESS_DAYS) {
  ...
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
Umbral por defecto, [`lib/screenerFilterCatalog.js:4`](../lib/screenerFilterCatalog.js#L4):
`export const DEFAULT_PRICE_FRESHNESS_DAYS = 5;` — y hay presets
distintos: "Datos limpios" usa 3 días, "Normal" usa el default (5),
"Permitir parcial" usa 10
([`lib/screenerFilterCatalog.js:515-517`](../lib/screenerFilterCatalog.js#L515)).

**Qué cambia**: `row.lastDate` pasa de ser (normalmente) hoy — Yahoo
suele incluir una vela parcial del día en curso durante la sesión — a ser
el cierre del día hábil anterior. En un día normal, `days` pasaría de
0 a 1: **sigue por debajo de cualquiera de los tres umbrales (3/5/10)**,
así que `priceFreshnessOk` seguiría siendo `true` en el caso normal.

**Dónde SÍ cambiaría el resultado**: fines de semana y puentes. Si el
`daily_bars` refrescado el viernes se lee el lunes, `days` = 3 (no 0-1);
tras un puente de 3 días, `days` puede llegar a 4. Con el preset "Datos
clean" (`maxPriceFreshnessDays: 3`), un lunes normal ya rozaría el
límite; un puente lo superaría, marcando `priceFreshnessOk: false` para
TODO el universo simultáneamente (no un símbolo aislado) el primer día
hábil tras el fin de semana/puente, cosa que hoy no ocurre porque Yahoo
en vivo siempre da "hoy". **Esto sí habría que ajustarlo** — o bien
subiendo el umbral por defecto unos días, o (mejor, pero más trabajo)
calculando `days` en días hábiles en vez de días naturales. No lo
decido aquí, solo señalo que hace falta decidirlo antes de activar el
cambio para presets con umbral ajustado (3 días).

**Nota de continuidad**: el cron (`materializedScanner.js`) YA opera bajo
esta misma mecánica hoy — usa `withDailyBarsCache` con
`maxAgeDays: options.maxPriceFreshnessDays`
([`lib/materializedScanner.js:527`](../lib/materializedScanner.js#L527))
y **también** aplica `priceFreshnessForDate(row.lastDate, options.maxPriceFreshnessDays)`
como filtro de rechazo (`baseRejectReason`,
[`lib/materializedScanner.js:507`](../lib/materializedScanner.js#L507):
`if (!row.priceFreshnessOk) return row.priceFreshnessIssue || "precio no fresco";`).
Es decir: el efecto fin-de-semana descrito arriba **ya existe en
producción, hoy, para el cron** — no es un riesgo nuevo que este cambio
introduzca de cero, es un riesgo ya asumido en una superficie del
producto que se extendería a otra.

---

## PARTE E — El plan

### E.15 — Fases, de menor a mayor riesgo

1. **Fase 0 — Verificable sin cambiar lo que ve el usuario.** Medir
   cobertura real de `daily_bars`/`fundamental_snapshots` para el
   universo completo (no solo la muestra de esta sesión) — necesitaría
   una vía de conteo real (una función `COUNT`/RPC, o acceso con permisos
   de agregación, ninguno disponible en esta sesión de solo lectura).
   Cero cambios de código, cero riesgo — solo confirma o corrige los
   supuestos de A.4 antes de construir nada encima.
2. **Fase 1 — Cerrar el hueco de cobertura no-US** (opción 3 de C.11):
   adaptar/extender `scripts/refresh-bars.mjs` para cubrir el resto de
   los 29 mercados, corriéndolo a mano como hoy. No toca ningún camino
   que el usuario vea — solo rellena `daily_bars`.
3. **Fase 2 — Extender la escritura del escaneo interactivo al perfil**,
   en la misma línea que ya se hizo para barras
   (`docs/barras-desfasadas-2026-08-09.md`): que el scan interactivo,
   ADEMÁS de seguir descargando, empiece a escribir en
   `fundamental_snapshots` vía `writeProfileCache` — sin cambiar todavía
   de dónde LEE. Riesgo bajo (aditivo, mismo patrón ya probado con
   `writeDailyBarsCache`), mejora la cobertura de perfil de cara a la
   fase siguiente.
4. **Fase 3 — Cambiar la lectura, con fallback en caliente** (opción 1 de
   C.11): sustituir `fetchYahooChart`/`fetchYahooProfile` por
   `withDailyBarsCache`/`withProfileCache` en `lib/serverScanRunner.js`
   (C.10). El comportamiento visible cambia (precio de cierre anterior,
   como ya está decidido) pero el riesgo de romper el scan por completo
   es bajo porque el fallback a Yahoo sigue existiendo para lo que falte
   en caché — es la fase de mayor riesgo funcional (toca el camino
   caliente del producto) pero el diseño ya la reduce con datos leídos
   primero, Yahoo como red de seguridad.
5. **Fase 4 (opcional, más adelante)** — evaluar B.8 (métricas
   precalculadas por símbolo) si, tras la Fase 3, el volumen de lectura
   por símbolo sigue siendo el cuello de botella dominante.

### E.16 — Estimación de tiempo del escaneo del universo completo leyendo

**Estimación, no medición** (repito la advertencia de B.6/B.7): con la
extrapolación de 0,15-0,3s/símbolo a concurrencia 5 para barras, más un
orden de magnitud similar para perfil (misma tabla, mismo patrón de
índice), un tramo de 300 símbolos tomaría **~15-35s** (antes: min. varios
minutos por tramo, limitado por la latencia de Yahoo y el propio timeout
de Postgres que motivó este documento). Para el universo completo (10.000
símbolos tras el tope `MAX_SYMBOLS`, [`lib/serverScanRunner.js:29`](../lib/serverScanRunner.js#L29)),
a 300 símbolos/tramo, son **~34 tramos** encadenados; a ~15-35s/tramo más
el overhead de encadenamiento (el PATCH de reclamo entre tramos, ya
identificado como pendiente de optimizar en
`docs/limite-600-scan-2026-08-09.md`, Parte D), el escaneo completo
rondaría **entre 15 y 35 minutos** de duración total — sigue siendo
lento para "todo el universo", pero cambia de naturaleza: de "muere por
timeout a los 600" a "tarda pero avanza previsiblemente", que es
justamente el problema que este rediseño busca resolver. **Esta cifra no
se puede verificar sin ejecutar un escaneo real, prohibido por esta
tarea.**

---

## CONFIANZA

- **Alta** — el inventario completo de lo que `buildResearchRow` necesita
  y de dónde sale hoy (Parte A.1-A.3): lectura directa y completa de la
  firma y el cuerpo de la función, sin ambigüedad.
- **Alta** — que existe una caché de perfil equivalente
  (`fundamental_snapshots`/`fundamentalsCache.js`) ya usada por el cron
  pero no por el escaneo interactivo (A.2, C.9-C.10): confirmado por grep
  exhaustivo de los cuatro archivos que sí la usan, y por la ausencia de
  `serverScanRunner.js` en esa lista.
- **Alta** — que `withDailyBarsCache`/`withProfileCache` ya existen,
  tienen la forma exacta que necesitaría el escaneo interactivo, y el
  cron ya los usa en producción (C.10): cita literal completa de ambas
  funciones y de sus call-sites en `materializedScanner.js`.
- **Alta** — que un solo símbolo grande agota la respuesta de 200 filas
  del conector de solo lectura antes de llegar al segundo símbolo (B.6):
  reproducido directamente, no es una suposición.
- **Media** — que la cobertura de `daily_bars` está fuertemente sesgada a
  EE.UU. (A.4): confirmado que `scripts/refresh-bars.mjs` solo apunta a
  `market=eq.US` (cita literal), y que varios símbolos no-US SÍ tienen
  barras recientes (vía el cron general) — pero no pude medir la
  cobertura NO-US de forma sistemática (sin `COUNT`), así que "sesgado"
  es una inferencia razonada sobre una muestra de 6 símbolos, no una
  medición de cobertura.
- **Media** — las estimaciones de tiempo de B.6/B.7/E.16: aritméticamente
  correctas dado el supuesto de partida (0,15-0,3s/símbolo), pero ese
  supuesto viene de una tabla distinta (`scan_results`/`universe_read`,
  no `daily_bars`) medida en una sesión anterior — es la mejor referencia
  disponible en el repo, no una medición directa de la tabla en cuestión.
- **Baja** — la cifra de "41 de 5.605 símbolos fallaron al refrescar" del
  enunciado de la tarea: no la verifiqué de forma independiente, la tomo
  como dato ya documentado por el commit de `scripts/refresh-bars.mjs`.
- **Baja** — el número exacto de filas en `daily_bars`/`fundamental_snapshots`
  para el universo completo: no hay forma de contarlas con la clave de
  solo lectura disponible (sin agregados, sin `COUNT`).

## LO QUE NO HE VERIFICADO

- **El conteo exacto de símbolos con barras materializadas**, tanto en
  EE.UU. como en el resto de mercados — la clave de solo lectura no
  soporta `COUNT`/agregados; solo pude comprobar existencia/fecha símbolo
  a símbolo, sobre una muestra pequeña (11 símbolos no-US, 20 mega-caps
  US para el perfil).
- **La latencia real de una lectura a `daily_bars`/`fundamental_snapshots`
  desde una función de Vercel** — no medible con las herramientas
  disponibles en esta sesión (sin timing del conector MCP, sin acceso
  directo a la API de Supabase fuera de él). Las cifras de B.6/B.7/E.16
  son extrapolaciones explícitamente marcadas como tales, basadas en la
  medición más cercana disponible en el repo (`universe_read` contra
  `scan_results`, no `daily_bars`).
- **Si el límite de 200 filas por respuesta es del propio PostgREST/Supabase
  o específico de la clave de solo lectura de esta sesión** — no lo pude
  distinguir; el código de producción (`lib/supabaseServer.js`,
  `supabaseRequestAll`) pagina en lotes de hasta 1000, sugiriendo que el
  límite real de PostgREST es mayor que 200, pero no lo confirmé
  directamente.
- **La cifra "41 de 5.605 fallaron al refrescar"** del enunciado — no
  re-verificada, tomada del propio commit citado.
- **Si `scripts/refresh-bars.mjs` se ha corrido más de una vez, o si hay
  un cron/job programado que lo repita** — solo confirmé que existe y qué
  mercado apunta; no rastreé su historial de ejecuciones en
  `provider_runs` (esa tabla no registra corridas de scripts manuales,
  solo de las rutas `/api/jobs`/`/api/cron`, y el script no las escribe
  — no tiene ningún `provider_runs` en su código, verificado por grep).
- **El comportamiento exacto de `withDailyBarsCache`/`withProfileCache`
  bajo la concurrencia y el volumen de un escaneo de universo completo**
  — están probados en producción por el cron (12-24 símbolos/noche), no a
  la escala de miles de símbolos en paralelo con concurrencia 5 que
  tendría el escaneo interactivo; el patrón es el mismo pero la escala no
  se ha probado.
- **Si el guard `isSymbolReferenced` de `writeDailyBarsCache`** (3
  consultas EXISTS por símbolo antes de decidir el cap de escritura,
  [`lib/dailyBarsCache.js:211-234`](../lib/dailyBarsCache.js#L211)) tiene
  algún coste no despreciable a la escala de miles de símbolos por
  escaneo — no lo medí; hoy solo se ejecuta una vez por símbolo cuando el
  escaneo interactivo ESCRIBE (ya ocurre hoy), no cuando LEE, así que no
  cambia con este rediseño, pero no descarté que sea relevante si Fase 2
  (escribir perfil) se combina con Fase 3 (leer barras) en el mismo
  tramo.
