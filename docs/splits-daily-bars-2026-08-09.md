# Diagnóstico — splits/reestructuraciones no reflejados en `daily_bars`

<!-- fecha interna: 2026-08-09 · BASE_SHA: 3bd69c9 · rama: codex/statsedge-ui-polish -->

Documento de **diagnóstico**. No se modificó ningún archivo de código,
no se escribió en Supabase, no se ejecutó ningún cron ni escaneo. Se
usaron 2 de las 3 peticiones a Yahoo permitidas.

**Resumen ejecutable en una frase**: el problema es real pero **menos
extendido** de lo que sugerían los 6 casos iniciales — en una muestra
de 220 símbolos US, solo 5 (≈2,6% de los que tienen barras) muestran
un salto de precio no plausible, y el mecanismo no es "el código
ignora el precio ajustado de Yahoo" (falso, según se verifica abajo)
sino que, para los casos verificados en vivo, **Yahoo mismo no
proporciona una corrección utilizable** para esos símbolos concretos.

---

## PARTE A — Cuán extendido está

### A.1 — Método de detección sin recorrer toda la tabla

**Diseño**: para cada símbolo de una muestra, una única consulta
filtrada por `symbol` (obligatorio por el aviso de timeout) trae sus
barras ordenadas por fecha ascendente:

```
GET /daily_bars?select=trade_date,close&symbol=eq.<SYM>&order=trade_date.asc&limit=280
```

Con las barras en mano, se calcula el ratio día-a-día
`ratio = close[i] / close[i-1]` para cada par consecutivo. Se marca
como **salto anómalo** cualquier `ratio > 3` o `ratio < 1/3` — un
cambio de precio de más de 3x en una sola sesión en cualquier
dirección. Justificación del umbral: los circuit breakers y límites de
volatilidad de los mercados US regulados no permiten normalmente un
movimiento de precio de un día para otro de esa magnitud salvo por un
evento corporativo (split, contrasplit, fusión) o una noticia extrema
en un valor muy ilíquido — en cualquier caso, un movimiento que merece
revisión antes de usarse en un cálculo de rendimiento.

Esto evita recorrer `daily_bars` completa: son N consultas filtradas
(una por símbolo de la muestra), cada una barata y con filtro
obligatorio, nunca una consulta sin `symbol=eq.`.

**Limitación del método, descubierta al ejecutarlo**: la herramienta
MCP de solo lectura tiene un tope duro de 200 filas por llamada
*independientemente* del `limit` pedido — pedir `limit=280` no
garantiza 280 filas; en la práctica la mayoría de símbolos devolvieron
entre 200 y 235 filas (algunos exactamente 200, el tope). Eso limita
la ventana de detección a, aproximadamente, **las últimas ~200-235
sesiones de trading por símbolo (~9-11 meses)** — un salto anterior a
esa ventana no se detecta con este método tal como se ejecutó. Esto
también significa que el caso DUKR (salto el 2026-03-05, hace ~5
meses desde la fecha de la sesión) sí habría caído dentro de esta
ventana si DUKR hubiese estado en la muestra — no lo estaba.

### A.2 — Aplicación sobre 220 símbolos

**Muestra**: 220 símbolos únicos del universo US investable
(`passed=true`, `instrument_type IN (equity, listed-vehicle)`),
muestreados de forma espaciada (particionando el espacio de `id` UUID
de `universe_snapshot_symbols` en 220 buckets uniformes y tomando la
primera fila en o después de cada límite — el UUID es independiente
del ticker, así que es equivalente a un muestreo uniforme por fila sin
sesgo alfabético). Snapshot usado:
`snapshot_id=41c54e8d-bc6a-4695-b57e-d65811bc4d45` (mismo que en
`docs/adr-rs-universo-us.md` y `docs/universo-us-rs-2026-08-08.md`,
sigue siendo el más reciente para `market='US'`).

El trabajo de 220 consultas se delegó en 5 subagentes en paralelo (44
símbolos cada uno), todos restringidos a usar exclusivamente
`mcp__supabase-readonly__supabase_query`, para no agotar el contexto
de esta sesión con las filas crudas — cada subagente calculó los
ratios y devolvió solo el resumen por símbolo, nunca las filas
completas.

**Resultado (medición sobre los 220, no extrapolación todavía):**

| Métrica | Valor |
|---|---:|
| Símbolos muestreados | 220 |
| Sin ninguna fila en `daily_bars` | **25 (11,4%)** |
| Con al menos una fila | 195 |
| Con al menos un salto anómalo (ratio>3 o <1/3) | **5 (2,56% de los 195 con datos)** |

Símbolos sin ninguna fila (25): STUB, STTK, CRD-A, CURV, ELOX, SUPX,
CTNT, CREX, AVB, AUST, SU, AZO, ATRA, DPC, STZ, SYPR, BXP, COGT, PECE,
EROC, BRK-A, ARCC, ASR, SSL, SCL.

**Los 5 saltos detectados:**

| symbol | fecha | close antes | close después | factor |
|---|---|---:|---:|---:|
| BCTX | 2025-01-29 | 3.70 | 59.00 | **15.95x** (máximo observado en la muestra) |
| SBET | 2025-05-27 | 6.72 | 35.83 | 5.33x |
| TDIC | 2025-10-10 | 30.50 | 5.80 | 5.26x (caída) |
| IBO | 2025-06-23 | 0.362 | 1.61 | 4.45x |
| PASW | 2026-01-09 | 0.618 | 0.200 | 3.09x (caída) |

Consultas literales usadas para cada uno (patrón, con el símbolo
correspondiente):
```
GET /daily_bars?select=trade_date,close&symbol=eq.BCTX&order=trade_date.asc&limit=280
GET /daily_bars?select=trade_date,close&symbol=eq.SBET&order=trade_date.asc&limit=280
GET /daily_bars?select=trade_date,close&symbol=eq.TDIC&order=trade_date.asc&limit=280
GET /daily_bars?select=trade_date,close&symbol=eq.IBO&order=trade_date.asc&limit=280
GET /daily_bars?select=trade_date,close&symbol=eq.PASW&order=trade_date.asc&limit=280
```

**Concentración por fecha**: 2025-01 (1), 2025-05 (1), 2025-06 (1),
2025-10 (1), 2026-01 (1) — **dispersos en el tiempo, ningún mes
concentra más de un caso**. Esto es un dato importante: si el problema
viniera de un fallo puntual del pipeline de ingesta (un despliegue
roto, una ventana de backfill mal ejecutada), esperaríamos ver los
saltos agrupados alrededor de una fecha común. No es lo que se observa
— el patrón es compatible con eventos idiosincráticos por símbolo
(splits/contrasplits reales de micro-caps, o movimientos de precio
extremos genuinos), no con un fallo sistémico de una sola fecha.

**Advertencia honesta sobre BCTX, SBET, TDIC, IBO, PASW**: a diferencia
de DUKR y QMMM (verificados en vivo contra Yahoo, ver A.4 y Parte B),
estos 5 **no se verificaron contra la respuesta cruda de Yahoo** — el
presupuesto de la tarea era de 3 peticiones y se usaron 2 en DUKR y
QMMM. No puedo afirmar que estos 5 sean necesariamente artefactos de
datos: por ejemplo, SBET (Sharplink Gaming) tuvo en el mundo real un
rally extremo en 2025 ligado a una estrategia de tesorería en
criptoactivos — un salto de 5,33x en un día, aunque inusual, no es
descartable como movimiento genuino para ese valor concreto. Marco
estos 5 como "candidatos a revisar", no como "confirmados como
artefacto".

### A.3 — Extrapolación al universo completo (EXTRAPOLACIÓN, no medición)

Con 2,56% de prevalencia sobre los símbolos con datos en la muestra de
195, y usando la cifra ya verificada de ~4.400 símbolos del universo US
con barras en `daily_bars` (dato del contexto de esta tarea, no
remedido aquí):

**Extrapolación: 2,56% × 4.400 ≈ 113 símbolos** del universo
investable podrían tener al menos un salto anómalo detectable con este
método y esta ventana temporal. Esta cifra es una extrapolación lineal
de una muestra de 195 sobre 4.400 — no es un conteo. El margen de
error de una proporción muestral de n=195 sobre una tasa real ~2,5%
(binomial, 95% de confianza) es aproximadamente ±2,2 puntos
porcentuales, así que la cifra real podría razonablemente estar entre
~15 y ~200 símbolos, no exactamente 113.

**Esto es sustancialmente menos extendido de lo que sugerían los 6
casos iniciales** si se interpretaran como "el problema es omnipresente
en el universo US" — no lo es, según esta muestra. Sí sigue siendo un
número no trivial (~100+ símbolos por extrapolación) que contaminaría
cualquier ranking o clasificación que los incluya sin filtrar.

### A.4 — ¿`adj_close` difiere de `close` en ALGÚN símbolo?

**No, en ningún caso verificado — y hay una razón estructural, no solo
empírica, para esperarlo así.**

Evidencia empírica combinada (dos fuentes, mismo resultado):
- Una corrida previa (parcial, 33 símbolos con datos de una muestra de
  41) comparó `close` vs `adj_close` fila por fila: **0/33 con alguna
  fila donde difirieran** — `adj_close` fue idéntico a `close` en el
  100% de las filas de los 33.
- Las respuestas en vivo de Yahoo para DUKR y QMMM (Parte B) muestran
  `adjclose` idéntico a `close` en cada punto de datos consultado.

Evidencia estructural (código, ver B.5): `cleanWriteBar()` en
`lib/dailyBarsCache.js:236-254` construye las columnas así:
```js
close: numberOrNull(bar.rawClose ?? bar.close) ?? close,
adj_close: numberOrNull(bar.adjClose ?? bar.close) ?? close,
```
Los objetos `bar` que llegan desde `lib/yahoo.js` (ver B.5) **nunca
traen un campo `rawClose` ni `adjClose` separado** — solo traen
`close` (un único valor ya resuelto). Por lo tanto ambas expresiones
caen siempre en `bar.close` — **`adj_close` es, por construcción del
código, una copia exacta de `close` para toda fila que este pipeline
escriba**, no una casualidad de los símbolos muestreados. No hace
falta ampliar la muestra para "encontrar" un símbolo donde difieran:
el código no tiene ninguna vía para que difieran.

---

## PARTE B — De dónde viene

### B.5 — Trazado de la descarga y escritura de barras

**Descarga** — `lib/yahoo.js:1226-1281`, función `fetchYahooChartDirect`:
```js
async function fetchYahooChartDirect(symbol, options = {}) {
  const yahooSymbol = canonicalYahooSymbol(symbol);
  const request = chartRequestOptions(options);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${encodeURIComponent(request.yahooRange)}&interval=${encodeURIComponent(request.yahooInterval)}&includePrePost=false&events=div%2Csplits`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, next: { revalidate: request.intraday ? 60 : 21600 } });
  if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error("Sin historico Yahoo");
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const adj = r.indicators?.adjclose?.[0]?.adjclose || [];
  const splitEvents = Object.values(r.events?.splits || {})
    .map((event) => { /* ... parsea numerator/denominator/date ... */ })
    .filter((event) => event.date && Number.isFinite(event.ratio) && event.ratio > 0);
  const bars = ts.map((t, i) => {
    const rawClose = Number(q.close?.[i]);
    const close = Number(adj[i] ?? q.close?.[i]);
    const factor = Number.isFinite(close) && Number.isFinite(rawClose) && rawClose > 0 ? close / rawClose : 1;
    const scaled = (value, fallback = close) => {
      const n = Number(value);
      return Number.isFinite(n) ? n * factor : fallback;
    };
    return {
      time: t,
      date: /* ... */,
      open: scaled(q.open?.[i]),
      close,
      high: scaled(q.high?.[i]),
      low: scaled(q.low?.[i]),
      volume: safeNumber(q.volume?.[i]),
    };
  }).filter(/* ... */).sort(/* desc por fecha */);
  return { bars, meta: { /* incluye splitEvents */ } };
}
```

**Escritura** — `lib/dailyBarsCache.js:236-254`, función `cleanWriteBar`
(citada completa en A.4), invocada desde `writeDailyBarsCache`
(`lib/dailyBarsCache.js:316-`), que a su vez es invocada por
`withDailyBarsCache` (`lib/dailyBarsCache.js:412-463`) — el flujo
general: si hay caché fresca en `daily_bars`, se sirve sin volver a
pedir nada a Yahoo; si no, se llama al `fetcher` (que baja hasta
`fetchYahooChartDirect`) y el resultado se escribe con `cleanWriteBar`.

### B.6/B.7 — ¿Yahoo devuelve el precio ajustado? ¿El código lo usa?

**Sí a ambas — y esto contradice la hipótesis de partida de la
tarea.** La URL ya incluye `events=div%2Csplits` (línea 1229), lo cual
hace que Yahoo devuelva `r.events.splits` (eventos de split
detectados) y `r.indicators.adjclose[0].adjclose` (el array de precio
ajustado). El código sí lee ambos: `adj[i]` se usa preferentemente
sobre `q.close[i]` para construir `close` (línea 1253:
`const close = Number(adj[i] ?? q.close?.[i])`), y `splitEvents` se
extrae y se propaga en `meta.splitEvents` (línea 1278).

**Entonces, ¿por qué persiste el salto?** Porque para los símbolos
verificados en vivo (B.8), **el propio `adjclose` de Yahoo es idéntico
al `close` sin ajustar, y Yahoo no reporta ningún evento de split para
esa fecha**. No es que el código pida el parámetro equivocado o
ignore el campo — es que, para estos tickers concretos, Yahoo no tiene
o no aplica la corrección, así que no hay nada distinto que el código
pudiera haber usado. **El "bug", si existe, no está en cómo este
código llama a Yahoo o usa su respuesta — está en la fiabilidad de los
propios datos de Yahoo para estos símbolos concretos** (típicamente
micro-caps con baja cobertura de datos).

Nota aparte, ya señalada en A.4: aunque `fetchYahooChartDirect` sí
usa `adjclose` preferentemente al construir el único campo `close` que
expone, ese único campo se copia después a AMBAS columnas
(`close` y `adj_close`) en `cleanWriteBar` — así que incluso en un
caso hipotético donde Yahoo SÍ tuviera un `adjclose` útil y distinto
de `close`, nuestra base de datos no conservaría el "close sin
ajustar" por separado; solo tendría el ajustado, duplicado en ambas
columnas. Esto no es el problema de los 5-6 casos verificados (donde
Yahoo tampoco ajusta), pero es una limitación de diseño que vale la
pena anotar aparte.

### B.8 — Peticiones reales a Yahoo (2 de 3 permitidas)

**Petición 1 — DUKR**, réplica exacta de la URL del código (`range=1y`
en vez de `2y` para acotar la respuesta, mismo endpoint y parámetros):
```
GET https://query1.finance.yahoo.com/v8/finance/chart/DUKR?range=1y&interval=1d&includePrePost=false&events=div%2Csplits
→ HTTP 200
```
Campos relevantes de la respuesta cruda (parseados del JSON):
```
splits events: {}
meta.currency: USD   meta.exchangeName: NCM
2026-03-02  close=0.3240000009536743  adjclose=0.3240000009536743
2026-03-03  close=0.3240000009536743  adjclose=0.3240000009536743
2026-03-04  close=0.34700000286102295 adjclose=0.34700000286102295
2026-03-05  close=0.30000001192092896 adjclose=0.30000001192092896
2026-03-06  close=7.659999847412109   adjclose=7.659999847412109
2026-03-09  close=7.25                adjclose=7.25
2026-03-10  close=7                   adjclose=7
```
**Confirmado: Yahoo mismo, en este momento, devuelve el salto sin
ajustar, con `adjclose` idéntico a `close`, y sin ningún evento de
split reportado para esa fecha.** No es un problema de caché ni de
staleness de nuestros datos — una descarga fresca ahora mismo
reproduciría exactamente el mismo salto.

**Petición 2 — QMMM**, mismo patrón de URL:
```
GET https://query1.finance.yahoo.com/v8/finance/chart/QMMM?range=1y&interval=1d&includePrePost=false&events=div%2Csplits
→ HTTP 200
```
```
splits events: {}
2025-09-22  close=105.90  volume=646900
2025-09-23  close=109.00  volume=404000
2025-09-24  close=95.00   volume=393000
2025-09-25  close=100.00  volume=371400
2025-09-26  close=119.40  volume=773300
2025-09-29  close=119.40  volume=0
2025-09-30  close=119.40  volume=0
... (idéntico, volumen 0, hasta:)
2026-08-06  close=119.40  volume=0
2026-08-07  close=119.40  volume=0
```
**Confirmado: el precio congelado en 119,40 con volumen 0 desde
2025-09-26 hasta hoy también viene directamente de Yahoo, no de
nuestra caché.** Este es un fenómeno distinto al de DUKR — no es un
salto de precio sin ajustar, es un valor "último precio conocido"
repetido con volumen cero durante meses, compatible con una
suspensión de cotización o un valor que dejó de operar activamente,
reflejado así por el proveedor.

No se usó la 3ª petición disponible — la evidencia de las dos primeras
ya es suficiente para responder B.6/B.7 sin necesidad de gastarla, y
usarla sobre BCTX/SBET/TDIC/IBO/PASW sin poder verificar los 5 habría
dejado uno sin comprobar de todos modos.

---

## PARTE C — Qué está contaminado

### C.9 — Todo lo que se calcula a partir de las barras

Todo lo listado usa `bar.close` (o, para SMA/máximos/mínimos,
`bar.high`/`bar.low`, también no ajustados) directamente sobre las
barras leídas de `daily_bars`, sin ningún filtro de plausibilidad:

- **`perf(b, n)`** — rendimiento simple `(b[0].close/b[n].close - 1) * 100`. Definido en `lib/indicators.js:11` y de nuevo (misma lógica) en `lib/materializedScanner.js:401-403` para `perf3m` (n=63), `perf6m` (n=126), `perf12m` (n=252). Un salto en cualquier punto de la ventana de 63/126/252 sesiones contamina directamente el resultado.
- **`sma(b, n, o)`** — media móvil simple de `close`. `lib/indicators.js:10`, usado en `lib/materializedScanner.js:391-394` para SMA50/150/200. Si el salto cae dentro de la ventana, la media mezcla precios de dos escalas distintas.
- **`maxDrawdown(b, n)`** — máximo drawdown pico-a-valle. `lib/indicators.js:40-50` y duplicado en `lib/materializedScanner.js:198-208`. Un salto hacia abajo se lee como un drawdown catastrófico falso; uno hacia arriba desplaza el "pico" y distorsiona el drawdown posterior.
- **`annualizedVolatility`/`downsideVolatility`** — desviación estándar de retornos diarios anualizada. `lib/indicators.js:31-39`. Un solo día con retorno de +2400% (caso DUKR) infla la volatilidad de cualquier ventana de 63 días que lo incluya durante meses.
- **`maxDailyMovePct`/`dailyRangePcts`/`maxDailyRangePct`/`avgDailyRangePct`** — `lib/indicators.js:51-70`, duplicado en `lib/materializedScanner.js:210-232`. El día del salto se registra literalmente como el movimiento diario máximo.
- **`highDist`/`lowAdv`** (distancia a máximo/mínimo de N sesiones) — `lib/indicators.js:14-15`. Un salto hacia arriba crea un "máximo" falso que después hace que el precio real parezca "lejos de máximos" permanentemente hasta que la ventana se desplace.
- **`weeklyStageForBars`** (clasificación de etapas de Weinstein) — `lib/weeklyStage.js:39-184`. Construye barras semanales agregando `bar.close` (línea 39-57) y calcula SMA10w/SMA30w (línea 59-60) sobre esas barras semanales — hereda exactamente la misma contaminación, con el agravante de que una barra semanal que contenga el día del salto queda permanentemente distorsionada en el histórico semanal aunque las barras diarias posteriores sean correctas.
- **RS (fuerza relativa, ambos mecanismos)**: `rsRawComposite`/`enrichRelativePercentiles`/`percentileFromSorted` en `lib/relativeStrength.js` consumen `perf3m`/`perf6m`/`perf12m` ya contaminados — no recalculan nada desde barras crudas, así que heredan el problema sin filtro adicional. El calculador nuevo de `scripts/rs-universe.mjs` (construido ayer, ver informe previo) también usa `close` directo de `daily_bars` de la misma forma — es exactamente el mecanismo que produjo el ranking distorsionado documentado ayer (DUKR/QMMM/SNDK en el top).
- **`objectiveMetricTruth.js:303-336`** — reimplementación paralela de `perf`/`maxDrawdown` sobre las mismas barras (mencionada como duplicación conocida en la memoria del proyecto) — misma exposición, doble mantenimiento.

### C.10 — ¿Algo es inmune?

**Nada de lo anterior es inmune.** No existe en el código ningún
mecanismo de recorte (winsorización), tope de retorno diario, ni
detección de splits aplicada a `daily_bars` — se buscó explícitamente
(`grep` de `winsoriz|cap.*return|clamp.*return`) y no hay resultados.

Lo más cercano a "consciencia de splits" que existe en el repo es
`app/api/company-brief/route.js:1124-1163`
(`splitFactorAfterDate`/`normalizeEpsRowForSplits`), pero **se aplica
solo a filas de resultados financieros (EPS) para ajustar por cambios
en el número de acciones, nunca a `daily_bars`**. Y aunque se
reutilizara para precios, no habría servido para el caso DUKR: usa
`chart.meta.splitEvents`, que viene de `r.events.splits` de Yahoo —
el mismo campo que confirmamos vacío (`{}`) para DUKR en B.8. El
"conocimiento de splits" existente no habría detectado este caso de
todos modos.

Lo único parcialmente protegido por naturaleza son las métricas que NO
derivan de `close` — volumen (`avgVolume`, `relativeVolume`,
`volumeEffectScore`) — que siguen siendo correctas frente a un salto
de precio (aunque el caso QMMM muestra que el volumen puede tener su
propio problema de datos independiente: volumen=0 sostenido).

### C.11 — ¿Están contaminados los datos ya en `scan_results`?

**Sí, potencialmente — y no hay forma limpia de distinguir las filas
afectadas de las sanas sin recalcular.** `scan_results`
(`supabase/schema.sql:24-43`) persiste `metrics jsonb` y `raw jsonb`
con todos los campos de la Parte C.9 ya calculados
(`materializedScanner.js:1411-1415` proyecta `maxDailyMove20dPct`,
`volatility63d`, `maxDrawdown63d` hacia el registro final), más
`rs_rating numeric` como columna propia.

La única vía indirecta de detección sin recalcular desde cero sería
usar los propios campos ya persistidos como señal: un
`maxDailyMove20dPct` extremo (por ejemplo, muy por encima de lo que un
movimiento diario normal produciría) en un `scan_results` cuya
`created_at` cae dentro de los ~20 días de trading posteriores al
salto sería una pista fuerte. Pero esto tiene una ventana de vida
corta: `maxDailyMove20dPct` usa una ventana de 20 sesiones
(`lib/materializedScanner.js:210`, `n=20`), así que un escaneo hecho
hoy ya no vería el salto de DUKR (hace ~5 meses) en ese campo
concreto — sí seguiría viéndolo en `perf12m`/`volatility63d` (ventanas
de 252/63 sesiones) mientras el salto siga dentro de esas ventanas. No
hay ninguna columna dedicada tipo "row_contains_price_anomaly" — habría
que construir la detección de la Parte A y cruzarla contra la fecha de
cada escaneo, sin garantía de cobertura completa para saltos ya fuera
de todas las ventanas relevantes.

---

## PARTE D — Las opciones (sin recomendar ninguna)

1. **Pedir a Yahoo el precio ajustado y redescargar todo el histórico.**
   Qué se toca: `lib/yahoo.js` (separar `rawClose`/`adjClose` en el
   objeto `bar` en vez de colapsarlos en uno solo), `lib/dailyBarsCache.js`
   (`cleanWriteBar` para no depender del fallback `?? bar.close`), un
   script de redescarga masiva similar al mecanismo ya existente.
   Coste: ver C.13 (~30 min medidos/extrapolados). **Riesgo verificado,
   no hipotético: para DUKR y QMMM, esto NO arregla nada** — ya
   confirmamos en B.8 que Yahoo mismo no tiene un `adjclose` distinto
   ni un evento de split para esos casos. Esta opción solo ayudaría
   para símbolos donde Yahoo SÍ tenga una corrección real y el código
   simplemente no la esté preservando por separado — no sabemos
   cuántos casos son de ese tipo frente al tipo "Yahoo tampoco lo
   sabe", porque no se verificó ninguno de los 5 candidatos adicionales
   de la Parte A contra Yahoo en vivo.
2. **Detectar los saltos y ajustar retroactivamente en la base**
   (backward-adjustment: multiplicar todas las barras anteriores al
   salto por el factor inverso, técnica estándar de proveedores de
   datos). Qué se toca: un job nuevo de solo escritura sobre
   `daily_bars`, que primero necesitaría correr la detección de la
   Parte A sobre el universo completo (no solo una muestra) para no
   dejar casos sin corregir. Coste: computacional, sin llamadas de red
   — pero requiere la barrida completa de ~4.400 símbolos con el mismo
   método (ver limitación de ventana de A.1: con el tope de 200
   filas/llamada de la herramienta MCP, una barrida completa
   necesitaría paginar cada símbolo más allá de esa ventana para no
   repetir la misma limitación). Riesgo: el umbral de 3x tiene falsos
   positivos (SBET podría ser un movimiento real, no un artefacto —
   ver A.2) y falsos negativos (splits que no cruzan 3x, ej. 1:2, no
   se detectan); es una escritura irreversible sobre producción si se
   aplica sin verificar caso por caso.
3. **Filtrar los símbolos afectados del universo** (excluirlos de
   cualquier cálculo de RS/screener hasta que se resuelva). Qué se
   toca: reutilizar el detector de la Parte A como un filtro adicional
   en el momento de construir la población (ej. en
   `scripts/rs-universe.mjs` o donde se decida). Coste: bajo, es un
   filtro, no una reescritura de datos. Riesgo: reduce el universo
   investable en una cantidad no verificada con precisión (la
   extrapolación de A.3 sugiere del orden de ~100 símbolos, con margen
   amplio); no arregla nada para superficies que sí quieran mostrar
   esos símbolos individualmente (la ficha de un símbolo afectado
   seguiría mostrando el gráfico/métricas contaminadas); trata el
   síntoma en el screener, no la causa en los datos.
4. **Winsorizar/acotar los retornos diarios en el momento del cálculo**
   (sin tocar `daily_bars`): capar cualquier retorno diario individual
   a un máximo razonable (ej. ±50%) dentro de `dailyReturns`/`perf`
   antes de usarlo. Qué se toca: las funciones de `lib/indicators.js`
   y su duplicado en `lib/materializedScanner.js` (dos lugares, por la
   duplicación ya conocida). Coste: bajo, cambio de código localizado,
   sin escritura en Supabase. Riesgo: enmascara el problema en el
   cálculo sin corregir el dato subyacente (que sigue siendo
   objetivamente incorrecto en la tabla); no distingue un artefacto de
   un movimiento real extremo pero legítimo (ej. una OPA con prima
   grande) — los trataría igual, silenciando ambos.
5. **Cambiar o complementar el proveedor de datos** para corporate
   actions/precios ajustados (ej. explorar de nuevo Twelve Data u
   otro). Qué se toca: todo el pipeline de ingesta. Coste: alto —
   posible coste de licencia. Riesgo: ya evaluado y aplazado en el
   pasado según la memoria del proyecto (Twelve Data sin autorización
   de redistribución en planes self-serve); no es una opción de corto
   plazo sin resolver esa restricción comercial primero.

### C.13 — Coste de redescargar el histórico completo

**Medición dada por el contexto de esta tarea** (no remedida en esta
sesión): ~410 ms por símbolo. **Cifra de símbolos con barras, también
dada por el contexto**: ~4.400.

`4.400 × 0.410 s ≈ 1.804 s ≈ 30,1 minutos` — combina una medición real
(410ms) con un conteo aproximado (4.400, redondeado según el propio
contexto de la tarea, coincide con el 4.427 medido ayer en la corrida
completa de `scripts/rs-universe.mjs`), así que el resultado final
(**~30 minutos**) es una estimación, no una medición end-to-end de
este pipeline concreto redescargando de verdad.

---

## CONFIANZA

- **Alta (medición directa, consulta o respuesta HTTP citada,
  reproducible)**: A.4 (ausencia estructural de diferencia
  close/adj_close, código citado), B.5 (código de descarga/escritura
  completo), B.6/B.7 (el código sí pide y usa `adjclose`), B.8 (las
  dos respuestas crudas de Yahoo, pegadas literalmente), C.9 (cada
  función citada con ruta y línea), C.11 (estructura de `scan_results`
  y sus columnas).
- **Media (extrapolación estadística explícita a partir de una
  muestra real, con margen de error estimado)**: A.2 (prevalencia
  2,56% sobre 195 símbolos con datos), A.3 (extrapolación a ~113
  símbolos del universo completo, con intervalo amplio reconocido).
- **Baja / sin verificar**: si BCTX, SBET, TDIC, IBO y PASW son
  artefactos de datos como DUKR/QMMM o movimientos genuinos — no se
  verificaron contra Yahoo en vivo (presupuesto de peticiones no
  usado en ellos deliberadamente, ver B.8); si existen saltos más
  allá de la ventana de ~200-235 sesiones que cubrió el método de A.1.

## LO QUE NO HE VERIFICADO

- **No verifiqué BCTX, SBET, TDIC, IBO ni PASW contra la respuesta
  cruda de Yahoo** — no sé si son artefactos de splits no reflejados
  (como DUKR) o movimientos de mercado genuinos (como podría ser el
  caso de SBET, dado su historial real conocido). Usé 2 de las 3
  peticiones permitidas en DUKR y QMMM porque ya daban una respuesta
  clara a B.6/B.7; no me quedaba margen para verificar los 5 con una
  sola petición adicional sin dejar 4 sin comprobar de todos modos.
- **No verifiqué saltos anteriores a la ventana de ~200-235 sesiones**
  por símbolo (limitación del tope de 200 filas/llamada de la
  herramienta MCP, documentada en A.1) — el método tal como se
  ejecutó no puede detectar un salto de hace, por ejemplo, 15 meses,
  si el símbolo tiene suficiente historia posterior para que esa fecha
  quede fuera de las últimas ~200-235 filas devueltas.
- **No hice una barrida completa del universo de ~4.400-5.600
  símbolos** — la extrapolación de A.3 es estadística, sobre una
  muestra de 195 con datos, no un conteo exhaustivo. El intervalo de
  confianza es amplio (~15 a ~200 símbolos).
- **No verifiqué si `scan_results` ya contiene filas visiblemente
  distorsionadas** (cruzando `maxDailyMove20dPct`/`perf12m` extremos
  contra `created_at` y las fechas de los saltos conocidos) — C.11
  describe el método posible, no lo ejecuté.
- **No investigué si BCTX/TDIC/IBO/PASW tuvieron eventos corporativos
  reales documentados** (splits, fusiones, delistings) fuera de esta
  sesión — no busqué fuentes externas más allá de Yahoo.
- **No confirmé si el patrón "volumen=0 sostenido" de QMMM (Parte
  B.8) es exclusivo de ese símbolo o aparece en otros** de los 25 sin
  datos o de los 195 con datos de la muestra — no se diseñó una
  detección específica para ese patrón, solo para el de saltos de
  precio.
