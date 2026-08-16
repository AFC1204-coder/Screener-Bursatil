# Análisis de Salud de mercado (`/market-health`) — 2026-08-16

Base: `codex/statsedge-ui-polish` @ `a767836`. Solo diagnóstico; ningún cambio de código,
ninguna escritura en Supabase, ningún escaneo ejecutado.

## Método

- **Lectura de código** de la superficie completa: `app/market-health/page.jsx` (914 líneas),
  `app/market-health/RegimeConstellation.jsx`, `app/api/market-health/route.js`,
  `lib/newsSentiment.js`, `lib/formatters.js`, `lib/scanHistory.js`, `lib/snapshotDisplay.js`,
  y los puntos de contacto en `app/page.jsx` (screener) y `lib/cloudSyncClient.js`.
- **Reproducción en navegador** contra una instancia aislada: árbol de `a767836` copiado con
  `rsync` al scratchpad (sin tocar el repo), `node_modules` enlazado, `.env.local` filtrado
  (sin `STATSEDGE_ACCESS_TOKEN`/`CRON_SECRET`/`STATSEDGE_SESSION_SECRET` — modo abierto de
  desarrollo), servidor propio en `:3500`. Perfil de navegador limpio: el localStorage empezó
  vacío, lo que permitió ver el flujo de primer arranque de verdad. La captura del hero se hizo
  con la pestaña visible; el resto de verificaciones (el panel embebido deja de repintar al
  ocultarse) se hicieron contra el DOM vivo: texto volcado, `getBoundingClientRect`,
  `localStorage` y la respuesta JSON real del API en esa pestaña.
- **Datos de producción** vía la herramienta de solo lectura `supabase_query` (PostgREST).
  Cada cifra de datos lleva su consulta exacta en el texto.
- **Ejecución aislada del algoritmo de la constelación**: las funciones puras de
  `RegimeConstellation.jsx` ejecutadas en Node con los datos reales del caché de producción.

Etiquetas: **[REPRODUCIDO]** visto en el navegador contra la instancia de `:3500`;
**[CÓDIGO]** afirmación sostenida con cita literal; **[DATO]** resultado de consulta a
producción; **[INFERIDO]** mecanismo derivado, no observado en el entorno donde ocurre.

## El resumen en una frase

La pantalla mezcla **tres fuentes con tres fechas** — un caché de servidor congelado el 20 de
junio que nadie puede refrescar desde el producto, el localStorage del navegador (21 de mayo en
el navegador del dueño), y titulares vivos de hoy — no enseña ninguna de las tres fechas fuera
de un panel colapsado, y encima el único porcentaje de amplitud sectorial que rotula dos veces
(«Sobre SMA50») está roto en una de las dos: un conteo (6) disfrazado de porcentaje («6%»).

---

# PARTE A — De dónde lee

## A.1 Las cinco+1 fuentes al cargar [CÓDIGO, verificado en red]

`load()` + `loadMethodologyHealth()` + `loadCoverage()` en el `useEffect` de montaje
(`app/market-health/page.jsx:595-599`) disparan:

| # | Fuente | Timeout | Qué alimenta |
|---|---|---|---|
| 1 | `GET /api/market-health` | 25 s | Régimen, constelación, KPIs del hero, Estructura del mercado, Amplitud sectorial, tabla de Auditoría |
| 2 | `GET /api/market-news` | 8 s | Fila «Titulares» del Sentimiento |
| 3 | `GET /api/social-sentiment` | 8 s | Fila «Social» (no configurada en este entorno; la fila se oculta) |
| 4 | `GET /api/methodology-health` | 20 s | Franja «Datos · cobertura» (detalle metodológico) |
| 5 | `GET /api/coverage?markets=US,JP,HK,AU,TW` y después `?markets=US,EU1,JP,HK,AU,TW` | 30/45 s | Franja «Datos · cobertura» |
| 6 | **`localStorage`** (`STORAGE_KEYS.scans` = `statsedge.scans.v1`) | — | «Liderazgo y fuerza relativa global» (regiones) y «Leadership pulse» entero |

La sexta no es una petición: `refreshScanPulse()` se ejecuta al principio de `load()`
(`app/market-health/page.jsx:525-527`):

```jsx
function refreshScanPulse() {
  setScanPulse(buildScanPulse(safeRead(STORAGE_KEYS.scans, [])));
}
```

## A.2 Por qué enseña datos viejos: son DOS congelaciones distintas

### A.2.1 El caché del API: congelado el 20 de junio, y el producto no puede regenerarlo [CÓDIGO + DATO]

`/api/market-health` calcula índices y sectores desde Yahoo (`fetchYahooChart`,
`app/api/market-health/route.js:310,340`) **solo si le piden `refresh=1` o `live=1`**. Desde
el commit `b2551c9` (2026-06-22, «checkpoint: stabilize statsedge phase 1», que añadió 83
líneas al route) el GET sin parámetros hace esto (`route.js:521-544`):

```js
const live = refresh || searchParams.get("live") === "1";
...
if (!live) {
  if (cached?.payload) {
    return Response.json(annotateCache(cached.payload, {
      ...cached,
      hit: false,
      stale: true,
      fallbackError: cached.error || "market health cache stale",
    }));
  }
```

Es decir: **sin `live`, sirve el caché aunque esté caducado, para siempre**. La UI llama
`fetchJsonWithTimeout("/api/market-health", 25000)` sin parámetro alguno
(`page.jsx:535`), y el botón «Actualizar» (`refreshAll`, `page.jsx:589-593`) repite la misma
llamada sin parámetros: **el botón de refrescar no puede refrescar**. Ningún cron llama al
endpoint: los seis crons de `vercel.json` van a `universe-refresh`, `scan-refresh`,
`shadow-europe-refresh`, `shadow-firds-refresh`, `favorite-snapshots` y
`leaderboards-refresh`. El único escritor del caché es el propio GET en modo live
(`writeMarketHealthCache`, `route.js:551`), que nada invoca.

El caché en producción [DATO]:

> `supabase_query {table: app_settings, select: setting_type,setting_key,updated_at,
> filter: setting_type=eq.market_health_cache}` →
> `updated_at = 2026-06-20T08:18:24.721+00:00`

> `supabase_query {table: app_settings, select: value->payload->>generatedAt,
> value->payload->marketScore,value->payload->breadthProxy,value->payload->sectorSummary,
> filter: setting_type=eq.market_health_cache}` →
> `generatedAt 2026-06-20T08:18:24.719Z · marketScore 97.6 ·
> breadthProxy {above30w: 5, indexes: 5, ...} · sectorSummary {above50: 6, count: 11, avgScore: 73}`

La última escritura es del **20 de junio**, dos días antes del commit que cerró la vía live
por defecto. Cuadra: con el código anterior el caché se regeneraba al navegar; con el nuevo,
nadie volvió a escribirlo. Los índices del payload tienen `lastDate: "2026-06-17"` — los datos
de mercado que la pantalla enseña hoy son del **17 de junio** [DATO].

Y el servidor lo declara: la respuesta real recibida por el navegador en mi sesión
[REPRODUCIDO, fetch en la pestaña]:

```json
"freshness": {
  "cacheHit": false,
  "cacheStale": true,
  "cachedAt": "2026-06-20T08:18:24.721Z",
  "cacheAgeHours": 1374.87,
  "cacheMaxAgeHours": 4,
  "fallbackError": "market health cache stale"
}
```

**El payload viaja con una marca que dice «este caché tiene 1.375 horas y su máximo son 4», y
la pantalla no lee `freshness` en ningún sitio** (`grep freshness app/market-health/` → cero
usos). La única fecha del payload visible en toda la superficie es la columna «Fecha» de la
tabla de índices («17 jun 2026»), dentro del `<details>` colapsado de Auditoría
[REPRODUCIDO].

### A.2.2 El «último snapshot · 21 may»: es el localStorage del navegador del dueño [CÓDIGO + REPRODUCIDO el mecanismo]

La fecha de la cabecera del Leadership pulse sale de `scanPulse.createdAt`
(`page.jsx:744`), y `buildScanPulse` toma **el primer elemento del array de localStorage
tal cual** (`page.jsx:109-111`):

```js
function buildScanPulse(scans = []) {
  const scan = scans[0];
```

¿Quién escribe ese array? Solo el screener y las pantallas viejas:

- El screener, al **arrancar sin sesión guardada**, restaura el último scan de la nube y lo
  escribe primero (`app/page.jsx:498-500`). Pero si hay sesión (`STORAGE_KEYS.screenerSession`),
  la restauración de nube **no se ejecuta** (`app/page.jsx:604-605`:
  `if (!restoredRowsCount) restoreLatestSnapshot(...)`) y `statsedge.scans.v1` queda como
  estuviera.
- El «Guardar» manual del screener (`app/page.jsx:1444`).
- Listas y Research desk releen y reescriben lo que ya había (`app/lists/page.jsx:556-563`).

En el navegador del dueño, con sesión persistente desde hace meses, `scans[0]` es el último
snapshot que entró por cualquiera de esas vías — el 21 de mayo. La pantalla no tiene ningún
mecanismo propio de refresco: ni lee la nube, ni lee el resultado nocturno, ni invalida por
edad. **[INFERIDO** el estado concreto del navegador del dueño; el mecanismo está reproducido:
en mi perfil limpio, el screener (raíz) se cargó primero, escribió un scan y `/market-health`
mostró «Último snapshot · 15 ago, 11:50» — la fecha de ESE scan, no la del último nocturno**]**.

### A.2.3 Ni siquiera el flujo sano enseña el último escaneo [REPRODUCIDO + CÓDIGO]

En mi sesión limpia, el localStorage quedó con exactamente un scan
[REPRODUCIDO, `localStorage.getItem("statsedge.scans.v1")`]:

```json
{ "id": "server-scan-9123db18-...", "createdAt": "2026-08-15T09:50:13Z",
  "preset": "balanced", "marketRegime": "server-scan", "rows": 500 }
```

Dos cosas: (a) es el scan del **15 de agosto**, no el nocturno del 16 (que existe en la nube:
`supabase_query {table: scans, order: created_at.desc}` → `b9ac783f… 2026-08-16T03:57:58Z,
preset materialized-cache`); (b) trae **500 filas**, porque el cliente pide
`/api/scans?includeRows=1&limit=1&rowsLimit=500` (`lib/cloudSyncClient.js:260-262`). Todo lo
que el Leadership pulse y las regiones calculan, lo calculan sobre ese recorte de 500 — no
sobre las 3.313 filas del escaneo nocturno.

La cabecera además dice «Actualización disponible», que no significa nada: es el rótulo fijo
que `snapshotDisplayUpdate` devuelve cuando el scan tiene `marketRegime`
(`lib/snapshotDisplay.js:23-25`).

## A.3 Confirmación del punto 8: sí, la amplitud de regiones sale del navegador [CÓDIGO + REPRODUCIDO]

`GlobalRegionsPanel rows={scanPulse?.rows || []}` (`page.jsx:738`). La «AMPLITUD (SMA50)» de
la tarjeta de Estados Unidos se calcula sobre las filas del localStorage
(`page.jsx:430-432`):

```jsx
const measured = filtered.filter((r) => Number.isFinite(r.extSma50));
const above50 = measured.filter((r) => r.extSma50 >= 0).length;
const amplitudePct = measured.length ? (above50 / measured.length) * 100 : null;
```

En mi sesión: «+67,7% AMPLITUD (SMA50) · 52 RS PROMEDIO · 500 EN SNAPSHOT» [REPRODUCIDO].
Es la amplitud de las 500 filas del scan del 15-ago que el screener dejó en el navegador.
Lo que apuntaba el análisis de Listas queda confirmado.

## A.4 ¿Se quedó atrás respecto a las demás pantallas? Sí, con matiz

El screener se ancló a la nube: al arrancar restaura el último scan del servidor
(`app/page.jsx:479-505`). Listas/Sectores/Review siguen leyendo localStorage, pero se
benefician del refresco que el screener escribe al arrancar sin sesión. Salud de mercado está
un escalón por debajo de todas: su mitad «snapshot» depende del mismo localStorage sin
refresco propio, y su mitad «índices/sectores» depende de un caché de servidor que **ninguna
pieza del sistema regenera desde el 20 de junio**. Es la única superficie del producto cuyos
datos centrales no tienen hoy ningún camino de actualización.

---

# PARTE B — Los números que no cuadran

## B.1 «6%» vs «6/11» bajo la misma etiqueta «Sobre SMA50» — un conteo disfrazado de porcentaje [CÓDIGO + DATO + REPRODUCIDO]

Los dos aparecen en pantalla hoy, a dos bloques de distancia [REPRODUCIDO]:
«ESTRUCTURA DEL MERCADO … 6% SOBRE SMA50» y «AMPLITUD SECTORIAL … 6/11 SOBRE SMA50».

El de Estructura del mercado (`page.jsx:690`):

```jsx
<div className="marketTapeKpi"><b>{pctShare(data.weinsteinTape.pctSectorsAbove50 ?? data.sectorSummary?.above50)}</b><span>Sobre SMA50</span></div>
```

`weinsteinTape()` **no genera ningún `pctSectorsAbove50`** — el objeto que devuelve tiene
`pctSectorsAbove30w`, `pctSectorsStage2`, `pctSectorsStage4` y nada más de SMA50
(`app/api/market-health/route.js:442-468`; verificado también contra el payload real:
`"pctSectorsAbove50" in weinsteinTape → false` [REPRODUCIDO]). El `??` cae SIEMPRE a
`sectorSummary.above50`, que es un **conteo** (`route.js:394`):

```js
above50: sectors.filter((x) => x.price > x.sma50).length,
```

Con los datos reales del caché (`above50: 6, count: 11` [DATO]), `pctShare(6)` pinta «6%».

- **Qué mide cada número**: los dos miden lo mismo — sectores SPDR (de 11) cuyo ETF cotiza
  sobre su SMA50 — sobre los datos del 17 de junio.
- **Cuál es correcto**: «6/11» (54,5%). El «6%» no es ninguna medición: es la unidad
  equivocada. El porcentaje verdadero, 55%, no aparece en ninguna parte.

## B.2 El «98 sobre 100» convive con su propia contradicción metodológica [CÓDIGO + DATO]

El hero enseña «98 MARKET SCORE · 5/5 SOBRE MM30S · 64% SECTORES EN ETAPA 2», y Estructura
del mercado «73% SECTORES SOBRE MM30S» [REPRODUCIDO; payload: `marketScore 97.6`,
`pctSectorsAbove30w 72.7`, `pctSectorsStage2 63.6` [DATO]].

El 98 se calcula **solo con los 5 índices**, ponderados 30/30/20/10/10
(`route.js:484-485`):

```js
const marketScore = results.reduce((a, x) => a + x.score * x.weight, 0) / totalWeight;
```

La amplitud sectorial no entra en el score. Resultado: la misma pantalla dice «98/100,
mercado alcista» y, más abajo, que solo 6 de 11 sectores sostienen su SMA50 y que la
distribución supera a la acumulación (3.8/3.1). Eso no es un error aritmético — es que el
número grande ignora exactamente lo que la escuela de este producto mira primero: si la
amplitud acompaña al índice. Los umbrales internos de divergencia (`route.js:426-427`:
dispara si `indexPct >= 60 && sectorPct < 45`) no saltan con 72,7%, así que «Divergencias y
presión» dice «Sin divergencias internas relevantes» mientras el 100% de índices convive con
55% de sectores sobre SMA50.

## B.3 El desglose de sentimiento suma 101% — redondeos independientes [CÓDIGO + REPRODUCIDO]

Hoy, con 24 titulares vivos: «bajistas 21% · neutrales 67% · alcistas 13%» = **101%**
[REPRODUCIDO]. Mecanismo: el servidor manda las proporciones crudas
(`lib/newsSentiment.js:54-56`) y la UI redondea cada una por separado
(`page.jsx:219-221`, tres llamadas a `pctShare`, que es
`toLocaleString(..., maximumFractionDigits: 0)` — `lib/formatters.js:47-49`). Con 5/16/3
sobre 24: 20,83→21, 66,67→67, 12,5→13. Suma real 100, suma pintada 101. Cualquier reparto
puede dar 99–101; no se aplica resto mayor (largest remainder) ni se deriva el tercero como
`100 − a − b`.

## B.4 Más pares del mismo concepto que no coinciden [REPRODUCIDO salvo indicación]

1. **Dos «cuántos lideran por RS» distintos.** El pulse dice «10% RS ≥ 80» (500 filas de
   localStorage del scan del 15-ago); el universo nocturno real del 16-ago tiene
   653/3.313 = **19,7%** con `rs_rating ≥ 80` [DATO, consulta en C.1]. Mismo concepto, dos
   poblaciones, ninguna etiqueta lo declara.
2. **Dos épocas en la misma pantalla sin fecha que las separe.** El régimen «alcista» y sus
   KPIs son del 17-jun; «43% DETERIORO 2+» y el listado de deterioro son del snapshot de
   agosto. Un lector razonable asume que todo es de hoy; solo la tabla colapsada de Auditoría
   revela la fecha de la mitad vieja.
3. **Tres definiciones bajo la etiqueta «RS».** «RS 1M vs SPY +10,2%» (retorno relativo de un
   ETF sectorial), «RS PROMEDIO 52» (media del ranking canónico de la región) y «RS 95»
   (percentil individual de FTNT) conviven en la misma pantalla. Ya señalado en el análisis
   del 14-08 (B1); sigue igual.
4. **«+67,7%» como amplitud** [CÓDIGO]: `pct(amplitudePct)` (`page.jsx:461`) usa el
   formateador de variaciones (con signo) para una proporción; el resto de proporciones de la
   pantalla usan `pctShare`. Una amplitud del 67,7% no es «+67,7%».
5. **«Último snapshot» que no es el último** (A.2.3) y «Actualización disponible» que no
   informa de nada (`lib/snapshotDisplay.js:23-25`).
6. **«Sectores con confirmación» que incluye Utilities y Real estate con RS 3M de −15,5% y
   −7,0%** [DATO, payload `leadingSectors`]: el filtro es `rs1m > 0 || rs3m > 0`
   (`route.js:418`) y sus rs1m son +0,6 y +0,2 — pasan por centésimas de punto mensual. Dos
   de los cinco «sectores con confirmación» son defensivos con fuerza relativa trimestral
   negativa, en la fila de al lado de «Ofensivos en etapa 2: 4 · Defensivos en etapa 2: 2».
7. Coinciden, para ser justos: «5/5 Sobre MM30s» (hero) y «5/5» (Estructura) son la misma
   fuente; «Score medio sectorial 73» (pulse) y «Score medio 73» (Amplitud sectorial) también.

## B.5 Confirmaciones de lo ya observado

- **Regiones vacías con ausencia explícita** [REPRODUCIDO]: Europa, Asia/Pacífico y
  Global/Emergentes muestran «SIN RS · –SIN DATO (con icono de motivo) · 0 EN SNAPSHOT · Sin
  activos analizados en esta geografía». El arreglo (commit `07cca5f`, 2026-08-13,
  «fix(ui): ausencias explícitas y fuera los detalles internos») sigue vigente. La crítica de
  diseño del análisis 14-08 (¾ de la sección permanentemente vacíos) también sigue vigente.
- **La constelación** — ver Parte D: ya no se apilan exactamente unos sobre otros (hay
  algoritmo anti-solape desde `0bcf603`, 8-jul), pero el resultado con los datos reales es una
  torre vertical con líneas cruzando la curva, el marcador agregado pisando dos rótulos y el
  último rótulo invadiendo la fila de ticks E1–E4 [REPRODUCIDO + medido].

---

# PARTE C — Qué debería mostrar (y qué se puede calcular hoy de verdad)

Criterio: la escuela de etapas juzga el mercado por amplitud (cuántos acompañan), la MM30
del índice y su pendiente, volumen en subidas vs bajadas, máximos vs mínimos, rotación
entre grupos, y la distribución de etapas EN EL TIEMPO. Nada de sentimiento ni
posicionamiento. Lo que sigue es qué puede servirse con los datos que ya existen.

## C.1 Amplitud del universo, hoy — calculable YA, con estas cifras reales

El escaneo nocturno del 16-08 (`scan_id b9ac783f-52f0-4dd9-a65e-f45e2c38f886`) tiene
**3.313 filas** y cada una lleva en `metrics` los ingredientes: `price`, `sma50`, `sma150`
(≈ MM30 semanal en proxy diario), `sma200`, `sma200Slope`, `extSma50`, `distance52w`,
`upDownVolRatio`, `theme`, y `rs_rating` al 100% de cobertura. Números reales de esta noche
[DATO — cada fila indica su consulta `supabase_query` sobre `scan_results` con
`filter: scan_id=eq.b9ac783f-… & <condición>` y `select: count`]:

| Indicador (escuela) | Condición | Resultado | % de 3.313 |
|---|---|---|---|
| Total analizado | — | 3.313 | 100% |
| **Sobre SMA50** | `metrics->extSma50=gte.0` | 2.220 | **67,0%** |
| **Sobre MM30 semanal** (price>sma150) | muestreo, ver nota | ~272/400 | **≈68% ±4,6** |
| **SMA200 ascendente** | `metrics->sma200Slope=gt.0` | 2.153 | **65,0%** |
| **En zona de máximo 52s** (≤1% del alto) | `metrics->distance52w=gte.-1` | 166 | **5,0%** |
| A ≤15% del máximo | `metrics->distance52w=gte.-15` | 1.661 | 50,1% |
| A ≥30% bajo el máximo | `metrics->distance52w=lte.-30` | 851 | 25,7% |
| **RS ≥ 80** | `rs_rating=gte.80` | 653 | 19,7% |
| **Volumen: sube con más volumen del que baja** | `metrics->upDownVolRatio=gte.1` | 2.323 | 70,1% |

Nota del muestreo: PostgREST no compara dos columnas entre sí, así que `price > sma150` se
midió sobre dos muestras de 200 filas por rango de UUID
(`filter: …&id=gte.00000000-…&id=lt.28000000-…` y `id=gte.c8…&id=lt.f0…`,
`select: metrics->price,metrics->sma150`): 133/200 y 139/200 → 68,0% (IC95 ±4,6 pt). En el
pipeline es una comparación por fila trivial; el dato existe, solo falta materializarlo como
campo.

**Lectura de ejemplo que la pantalla podría dar hoy, con hechos y sin predicción**: «El 68%
del universo sostiene su media de 30 semanas y el 65% tiene la SMA200 subiendo, pero solo el
5% está en zona de máximos y una cuarta parte cotiza a más del 30% de su máximo anual». Eso
es amplitud real de 3.313 valores — no un proxy de 5 índices de hace dos meses.

## C.2 Distribución por etapas: el dato se calcula cada noche y se descarta

La etapa semanal por valor (`weeklyStageState`/`weeklyStageWeek`, `lib/weeklyStage.js:169-171`)
se computa durante el escaneo, se usa para decidir, y **no se persiste en
`scan_results.metrics`** (verificado contra las 203 claves de una fila real [DATO]). Hoy no se
puede consultar «cuántos en etapa 2» del universo nocturno.

Dónde sí está diseñada: `scan_symbol_history` guarda `stage`, `stage_week`, `distance_52w`,
`rs_*`, `passed_screen` por símbolo y noche **cuando hay cambio** (`lib/scanHistory.js:146-159`,
change reasons), con el RPC `scan_symbol_history_latest_v1` para reconstruir la foto vigente.
Estado real: **448 filas** [DATO: `select: count` sobre la tabla] — el estreno EU más las
primeras corridas; el fix de hoy (`a767836`, «el nocturno escribe el histórico de símbolos»)
es precisamente lo que falta desplegar para que acumule las ~5.600 filas/noche de la primera
pasada completa. Cuando corra, la distribución por etapas del universo — y su evolución
diaria — sale de ahí sin tocar el pipeline.

## C.3 Máximos vs mínimos: la mitad falta, pero las barras existen

`distance52w` mide contra el **máximo** de 52 semanas; no hay campo simétrico contra el
mínimo en las filas del scan (los índices del API sí llevan `advanceFrom52wLow`; las acciones
no). Nuevos mínimos no es calculable desde `scan_results` hoy. Pero `daily_bars` tiene el
histórico completo: NVDA 1.260 barras [DATO: `filter: symbol=eq.NVDA, select: count`] y
**5.599 símbolos con barra del 2026-08-14** [DATO: `filter: trade_date=eq.2026-08-14,
select: count`] — máximos/mínimos 52s, series de amplitud reconstruidas hacia atrás, y el
ratio nuevos-máximos/nuevos-mínimos son un job batch sobre esa tabla, no un dato nuevo que
comprar.

## C.4 Evolución en el tiempo: 26 semanas de RS ya utilizables

`rs_weekly_items`: 154.646 filas totales, de las cuales **133.843 del motor vigente**
`statsedge-us-equity-rs-v1` [DATO: `select: count` con y sin
`filter: engine_version=eq.statsedge-us-equity-rs-v1`], desde `2026-W07` (snapshot
2026-02-13, muestra 4.745) hasta `2026-W32` (2026-08-09, muestra 4.868) [DATO: `order:
snapshot_date.asc/desc, limit: 1`]. Son **26 semanas homogéneas del motor actual** — la
memoria del proyecto («solo 1 semana útil») quedó obsoleta; el corte de `engine_version` que
descarta el motor anterior (`lib/globalRs.js:29-41`) hoy descarta 20.803 filas de
`statsedge-global-rs-usd-v1` (2025, muestras de ~259: irrelevantes).

Qué serie temporal honesta sale de ahí:

- **Rotación de grupos**: cada fila lleva `rank_index`/`rs_rating`/`rs_raw` por símbolo y
  semana, pero `sector/industry/theme` vienen a null [DATO: fila NVDA completa]. Cruzando con
  la taxonomía del nocturno (`scan_results.theme`, poblada), la media de RS por tema semana a
  semana — «Software/IA ganando fuerza 4 semanas seguidas, Energía perdiéndola» — es un JOIN
  en aplicación, con el sesgo declarable de usar la taxonomía de hoy hacia atrás.
- **Momentum absoluto del universo**: la mediana de `rs_raw` (retorno ponderado crudo) por
  semana sí se mueve en absoluto (el percentil `rs_rating` no: por construcción siempre hay
  ~20% ≥80).
- **Persistencia del liderazgo**: qué fracción de los RS≥90 de hace 4 semanas sigue ≥80 hoy.
- Lo que rs_weekly NO da: amplitud de medias (no lleva precio/medias). Esa serie nace de
  `scan_symbol_history` (C.2) o de un agregado nocturno nuevo (C.5).

## C.5 El hueco real: nadie guarda el agregado diario

Todo lo anterior son fotos por símbolo. Para «los valores en etapa 2 caen de 611 a 400 en
tres semanas» hace falta la serie del AGREGADO (fecha → conteos). Piezas que ya existen:
`scan_symbol_history` la hace derivable (C.2); `daily_bars` la hace reconstruible hacia atrás
(C.3). Lo que no existe es la tabla/fila de resumen nocturno («2026-08-16: 3.313 analizadas,
2.220 sobre SMA50, ~68% sobre MM30s, 166 en máximos, X en etapa 2») — una fila por noche,
escrita por el mismo cron del escaneo. Es la pieza más barata y la que convierte la pantalla
de foto en pantalla de tendencia.

---

# PARTE D — La constelación

## D.1 Qué hace y qué le pasa con los datos reales [CÓDIGO + ejecutado + REPRODUCIDO]

`RegimeConstellation` coloca los 5 índices sobre la «Curva de Etapa» por
(`stage30w`, `distanceSma30w`), con anti-solape por escalonado vertical de 7 unidades y
líneas guía (`layoutConstellationPoints`, `RegimeConstellation.jsx:102-156`; el comentario
del propio archivo reconoce el clustering: «en la práctica los 5 índices principales están
clusterizados en zonas estrechas (mismo E2 con distances similares)»).

Ejecutado el algoritmo real con los datos reales del caché (los 5 en «Etapa 2 probable»,
distancias 5,4–9,5%):

```
^GSPC  punto=(49.4, 31.0)  label=(49.4, 28.0)
^IXIC  punto=(53.0, 29.5)  label=(53.0, 33.5)
^RUT   punto=(53.5, 30.7)  label=(53.5, 41.7)  leaderLine
^DJI   punto=(48.4, 29.4)  label=(48.4, 47.4)  leaderLine
^ACWI  punto=(50.4, 27.7)  label=(50.4, 52.7)  leaderLine
```

En un viewBox de 120×56 con los ticks E1–E4 en y=54: los cinco puntos caben en 5×3 unidades
y los rótulos forman una **torre vertical de 25 unidades** con tres líneas guía cruzando la
curva. Medido en el DOM renderizado [REPRODUCIDO, `getBoundingClientRect`]: el marcador
agregado (28×28 px) **solapa los rótulos de GSPC e IXIC**; el rótulo de ACWI (y 547–579)
**invade la fila de ticks** (y 560–585). En la captura con pestaña visible se ve el círculo
gris pisando «GSPC» y una línea tachando «IXIC». La observación original («se amontonan unas
sobre otras») corresponde al síntoma; tras el anti-solape del 8-jul el amontonamiento literal
se convirtió en torre-con-colisiones. Sigue sin ser legible, y no por un bug puntual:

**El caso que rompe el diseño es el caso normal.** En un mercado tendencial los 5 índices
están en la misma etapa con distancias parecidas — es el estado por defecto del dato. Un
gráfico cuyo layout degenera en su estado de entrada más frecuente no es rescatable con más
stagger.

## D.2 ¿Cuánta información lleva? Cuatro números y medio

Con 5 índices casi siempre en la misma zona, la constelación comunica: la zona común (1 bit
útil: ¿E2 o no?), y la distancia a la MM30 de cada índice — que es un eje unidimensional
disfrazado de curva bidimensional. Todo lo demás (jitter vertical, forma de la curva, el
marcador agregado) es decoración. Los mismos hechos caben en una frase: «5/5 sobre su MM30s,
a +5,4%…+9,5%». La crítica de «bonito pero informativamente pobre» es correcta y el análisis
coincide: **como visualización de 5 índices, retirarla**.

## D.3 Qué haría que la forma aportara

La «Curva de Etapa» como forma tiene una versión con contenido: **la distribución del
UNIVERSO por etapas** (C.2), no 5 puntos. 3.313 valores repartidos en 4 zonas — densidad por
zona (barras o violín sobre la misma curva), con el delta contra hace una y cuatro semanas
(«E2: 1.480, −90 vs semana pasada») cuando `scan_symbol_history` acumule. Eso responde a la
pregunta de la escuela (¿el mercado acompaña, y hacia dónde se mueve la masa?) con un dato
que ningún par de números resume, que es el listón que un gráfico debe pasar. Los 5 índices
quedan mejor servidos por la tabla que ya existe en Auditoría — promovida a visible, con su
fecha.

Recomendación: **retirar la constelación de índices; reutilizar la curva solo si se
alimenta con la distribución del universo por etapas.** Mientras tanto, los cuatro KPIs del
hero cumplen la función sin ambigüedad.

---

# PARTE E — Propuesta priorizada

La pregunta de la pantalla («¿qué exposición tolera este mercado hoy?») es la correcta y su
esqueleto (régimen → estructura → liderazgo → amplitud) también. Lo que está roto es el
suministro: responde con datos muertos, de tres relojes distintos, y su mejor materia prima
(el nocturno) no la usa. En orden:

**P0 — Un solo reloj, visible.** (a) La fecha del dato en la cabecera de cada bloque,
siempre — «Índices y sectores: 17 jun · Universo: 16 ago» habría hecho este diagnóstico
innecesario; el dato ya viaja en `freshness` y en `scan.createdAt`, solo falta pintarlo.
(b) Decidir el mecanismo de refresco del bloque índices/sectores: o el cron nocturno llama a
`/api/market-health?refresh=1` tras el escaneo (una línea en un cron existente), o —mejor—
el cálculo se muda al nocturno leyendo `daily_bars` (los 16 tickers ya están ahí) y se
elimina la dependencia runtime de Yahoo. Sin P0, cualquier otro arreglo re-decora datos de
junio.

**P1 — La amplitud del universo sustituye al proxy.** El bloque central pasa a ser la tabla
de C.1, calculada en el nocturno y persistida como agregado diario (C.5, una fila/noche):
% sobre MM30s, % sobre SMA50, SMA200 ascendente, zona de máximos, RS≥80, up/down volumen —
del universo entero (3.313), no de 500 filas de localStorage ni de 11 ETFs. El pulse deja de
leer `STORAGE_KEYS.scans` y lee el resultado nocturno del servidor (la misma fuente que el
screener). La divergencia índice-amplitud se muestra como hecho: «índices en máximos; el x%
del universo los acompaña (hace 4 semanas: y%)» — clasificación, no señal (principio 1).

**P2 — Tiempo, no foto.** Con el agregado diario de P1 y las 26 semanas de `rs_weekly_items`:
sparklines de amplitud (% sobre MM30s por semana), rotación de temas (media RS por tema,
4 semanas), y — cuando `scan_symbol_history` acumule — el flujo entre etapas. Es la parte
«si los E2 caen de 611 a 400 en tres semanas, se ve aquí antes que en los índices».

**P3 — Poda.** Retirar: la constelación de índices (D), el sentimiento de titulares (la
escuela no lo usa, el propio panel se desautoriza — «el precio y la amplitud mandan más que
los titulares» — y hoy suma 101%; si se conserva por decisión de producto, corregir el
redondeo por resto mayor y derivar el tercer porcentaje), «Deterioro a revisar» como lista de
microcaps (su valor real — el conteo agregado de deterioro — ya está en el KPI), y las tres
regiones vacías mientras el universo sea US-only (volver a montarlas cuando haya datos, como
ya decía el análisis 14-08). Arreglos puntuales que no esperan a nada: la línea del «6%»
(`page.jsx:690` — o existe `pctSectorsAbove50` en el API o la celda pinta `6/11` como su
gemela de `:809`), «+67,7%» → `pctShare`, y el filtro de «Sectores con confirmación» exigiendo
una fuerza relativa que un +0,2% mensual no debería pasar.

Con P0–P1 la pantalla queda anclada al mismo escaneo nocturno que el resto del producto, con
una fecha, una población y una definición por métrica. P2 la convierte en la pantalla que la
metodología pide. P3 es la mitad de la superficie actual que sobra.

---

# CONFIANZA

| Hallazgo | Confianza | Base |
|---|---|---|
| A.1 seis fuentes, pulse desde localStorage | Alta | Código citado + red + localStorage volcado |
| A.2.1 caché congelado 20-jun, sin camino de refresco, `freshness` ignorado | Alta | Código + `app_settings` + JSON real recibido en navegador + grep de crons |
| A.2.2 «21 may» = localStorage del dueño sin refresco con sesión | Alta el mecanismo; Media el estado exacto de su navegador | Código citado + flujo reproducido en perfil limpio; su navegador no es observable desde aquí |
| A.2.3 pulse enseña scan del 15-ago recortado a 500 pese a existir el del 16 | Alta | Reproducido + `cloudSyncClient.js:262` + tabla `scans` |
| B.1 «6%» = conteo por `pctShare`, correcto 6/11 (55%) | Alta | Código + payload sin `pctSectorsAbove50` (verificado en runtime) + ambos en pantalla |
| B.2 score 98 solo-índices, divergencia no señalada | Alta | Código + payload |
| B.3 101% por redondeo independiente | Alta | Reproducido hoy (21+67+13) + código de ambos lados |
| B.4 pares divergentes (10% vs 19,7%, dos épocas, tres «RS», +67,7%) | Alta | Reproducidos; el 19,7% con consulta count |
| B.5 regiones vacías con ausencia explícita (fix 13-ago vigente) | Alta | Reproducido + commit localizado |
| C.1 cifras de amplitud del nocturno | Alta (counts exactos); Media-alta el ≈68% MM30s (muestreo n=400) | Consultas count citadas; muestreo declarado |
| C.2 etapa no persistida en metrics; `scan_symbol_history` con 448 filas | Alta | Inventario de 203 claves + count + `lib/scanHistory.js` |
| C.4 26 semanas homogéneas del motor actual | Alta | Counts y extremos por consulta |
| D layout degenerado en el caso normal | Alta | Algoritmo ejecutado con datos reales + geometría DOM + captura visible |
| E | — | Propuesta; discutible por diseño, no verificable |

# LO QUE NO HE VERIFICADO

- **El navegador del dueño.** El «21 may» de su pantalla es un hecho reportado; reproduje el
  mecanismo (localStorage sin refresco propio) en perfil limpio, no su estado concreto ni por
  qué vía entró su scan de mayo (guardado manual vs arranque antiguo sin sesión).
- **El modo live del endpoint.** No llamé a `/api/market-health?refresh=1` (habría escrito el
  caché en producción — prohibido por el encargo). Que Yahoo responda hoy desde el server
  (hay historial de fallos 401/crumb, `docs/yahoo-401-crumb-2026-08-05.md`) queda sin probar;
  si Yahoo fallara, el modo live también devolvería el stale (`route.js:558-566`).
- **`/api/scans` por dentro.** Por qué devolvió el `server-scan` del 15-ago y no el
  `materialized-cache` del 16-ago (criterio de "último" del endpoint / restorabilidad de los
  materialized) lo dejo señalado, no trazado.
- **La cifra «solo 448 filas» como techo.** No verifiqué si el fix de hoy (`a767836`) está
  desplegado en producción ni cuándo correrá la primera pasada completa del histórico.
- **El apilamiento pre-8-jul.** La observación original de rótulos «amontonados» pudo ser
  sobre la versión sin stagger; lo que verifiqué es el comportamiento actual (torre con
  colisiones puntuales), que juzgo suficiente para la conclusión de la Parte D.
- **Móvil.** Todo el recorrido fue de escritorio (~1280 px).
- **El panel «Datos · cobertura» y `/api/methodology-health`** los dejé fuera del foco: cargan
  y renderizan, pero no audité sus números (son telemetría interna, candidata a flag según el
  análisis 14-08).
- **Redondeo de `pctShare`**: asumo half-up de `toLocaleString` es-ES para el 12,5→13 del
  ejemplo del 101%; el caso reproducido (21+67+13) no depende de ese detalle.
