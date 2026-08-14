# Análisis del gráfico — 2026-08-14

Base: `codex/statsedge-ui-polish` @ `fce80c2`. Solo análisis; ningún cambio de código.

## Método (para poder auditar lo que afirmo)

- Lectura completa de la cadena del chart: `UniversalPriceChart.jsx`, `useChartController.js`,
  `useChartDataModel.js`, `useChartViewport.js`, `useChartDrawings.js`, `useChartInteraction.js`,
  `chartNativeAdapter.js`, `ChartPreferences.jsx`, `lib/chartDataModel.js`, `lib/chartSettings.js`,
  `lib/chartViewportModel.js`, `lib/chartViewportLifecycle.js`, `lib/chartNavigation.js`,
  `lib/chartSeriesModel.js`, `lib/chartInteractionMachine.js`, `StockClient.jsx`, `/api/chart`,
  `/api/company-brief` (parcial), `lib/dailyBarsCache.js` (parcial).
- Sesión de reproducción en navegador contra una instancia aislada: worktree desasociado en el
  scratchpad al mismo commit, `node_modules` y datos enlazados, servidor propio en :3100 con el
  `.env.local` filtrado (sin `STATSEDGE_ACCESS_TOKEN`/`CRON_SECRET`/`SESSION_SECRET`), que es el
  modo abierto de desarrollo documentado en `lib/internalAuth.js`. No introduje credenciales, no
  toqué el servidor del dueño (:3000), no ejecuté escrituras en Supabase; navegar la ficha hace que
  el propio servidor escriba su caché operativa (`daily_bars`, memoria), igual que en uso normal.
- Ficha usada: AAPL, viewport 1280×860 (y uno estrecho accidental que resultó revelador).
- Los estados internos se midieron por consola vía los handles que el propio código expone en dev
  (`window.__trendlinePrimitive`, `window.__chartInteractionState`) y la API pública de
  lightweight-charts. Los datos de red, contra `/api/company-brief` y `/api/chart` reales.

Etiquetas: **[REPRODUCIDO]** lo vi y lo medí en el navegador; **[MEDIDO]** cifra tomada en vivo;
**[INFERIDO]** mecanismo derivado del código, no trazado paso a paso en runtime.

---

# PARTE A — Lo que se rompe

## A0. El resumen en una frase

El lienzo pinta bien; todo lo que rodea al lienzo —qué ventana se ve, qué dicen los rótulos, qué
hacen los botones— tiene **varias fuentes de verdad compitiendo**, y cuál gana depende del orden en
que corran efectos, observers y timers. Por eso "parece estar bien y se rompe con mirarlo": cada
redibujado es una lotería entre 3 comportamientos de ventana distintos, con controles que hablan
con instancias muertas.

## A1. La ventana inicial no respeta el rango declarado — [REPRODUCIDO]

**Síntoma medido.** Con «VISTA 1A · D» el modelo de datos tiene 243 filas (ago 2025→ago 2026) pero
el lienzo abre mostrando **las últimas ~160** (ene→ago 2026). Con «VISTA 2A · W», ~104 filas
semanales y abre mostrando **~88** (dic 2024→hoy) [MEDIDO: `getVisibleLogicalRange()` =
`{from: 15.04, to: 101.89}`]. El resto del histórico existe, cargado, fuera de pantalla a la
izquierda; nada en la UI lo dice (el rail de ventana está muerto — A7).

**Mecanismo.** El perfil adaptativo fija un número objetivo de barras por intervalo, no por rango
(`lib/chartViewportModel.js:269-276`):

```js
const targetBars = normalizedInterval === "M"
  ? (compact ? 30 : 52)
  : normalizedInterval === "W"
    ? (compact ? 48 : 88)
    : intraday
      ? (compact ? 70 : 120)
      : (compact ? 90 : 160);
```

En el attach se hace `fitContent()` (todo el rango)… pero el `ResizeObserver` del lifecycle entrega
su callback inicial y **reaplica el `barSpacing` del perfil encima del fit**
(`lib/chartViewportLifecycle.js:566-572`) [INFERIDO el paso exacto; el resultado, MEDIDO]:

```js
chart.applyOptions?.({
  width: nextWidth,
  height: nextHeight,
  timeScale: { ...nextProfile.timeScale },
});
```

Con `barSpacing` dimensionado para `targetBars`, lightweight-charts ancla la vista a la derecha con
ese espaciado: la ventana pasa a ser `targetBars`, no el rango. La cifra del dueño sale sola: en
contenedor compacto (≤520 px) el objetivo W es **48 barras** → 48 semanas desde el 14-ago-2026 ≈
**segunda semana de septiembre de 2025**.

**Además es inestable.** Tras recrear el chart por benchmark, la ventana quedó en `{0, 105}` (fit
completo) en lugar de 88; y entre dos lecturas consecutivas sin tocar nada la ventana pasó de 215 a
63 barras [MEDIDO]. Tres comportamientos distintos para el mismo estado declarado — consistente con
los timers/listeners huérfanos de A7.

## A2. Fallo 1 del dueño («cambio benchmark → parece mensual y el 2A empieza en sept 2025») — mecanismo compuesto

No reproduje un cambio literal de `interval` W→M: tras aplicar benchmark QQQ, el estado guardado
siguió siendo `{range: "2A", interval: "W"}` [MEDIDO en `localStorage`]. Lo que sí reproduje es un
conjunto que produce **exactamente esa percepción**, y se dispara **precisamente al cambiar el
benchmark**:

**(a) Los puntos del RS inyectan columnas fantasma en el eje de tiempo.** La serie del ranking se
proyecta con sus fechas propias, sin ajustarlas al tiempo de la vela
(`lib/chartSeriesModel.js:192-207`: filtra por ventana y ordena, pero no re-muestrea). Las velas
semanales llevan `time` del viernes (último día del grupo, `lib/chartDataModel.js:123-135`) y los
snapshots del RS caen en domingo (último medido: `2026-08-09`). lightweight-charts fusiona los
tiempos de todas las series en un solo eje indexado: cada semana pasa a tener dos huecos, cada vela
queda separada por una columna vacía. En M es extremo y lo medí: **58 huecos lógicos para 33 velas
mensuales** (`fitContent` → `to: 57.85`, serie principal 33 barras) [MEDIDO, captura con velas
mensuales flotando entre vacíos]. Un semanal espaciado al doble, con menos velas en pantalla,
**se lee como un mensual**.

**(b) El eje ayuda a la confusión.** Con W y rango 2A/5A/MAX las etiquetas pasan a «mes año»
(`lib/chartViewportModel.js:171-173`):

```js
if (normalizedInterval === "W") {
  return ["2A", "5A", "MAX"].includes(range) ? `${month} ${shortYear}` : `${day} ${month}`;
}
```

Un eje que rotula «sep 25 · nov 25 · ene 26» sobre velas espaciadas es la firma visual de un
gráfico mensual.

**(c) Y ocurre justo al cambiar benchmark por A3:** la serie RS con histórico **solo llega cuando la
petición lleva benchmark**. Al aplicarlo, el chart se recrea, aparecen 28 puntos semanales nuevos, y
con ellos los huecos de (a). Con el doble de columnas por semana, la ventana de ~88 columnas de A1
cubre ~44 semanas reales: la serie dibujada **arranca en septiembre–octubre de 2025** aunque la
vista declare 2A.

**Mecanismos latentes para saltos literales de configuración** (no observados hoy, código en mano):

- La corrección de compatibilidad reescribe la elección del usuario en silencio
  (`app/ChartPreferences.jsx:66-71`): puse Max con D, cambié a M, y el rango guardado pasó a `5A`
  sin aviso [REPRODUCIDO]; además «Max» desaparece de la fila de botones con M
  (`ChartPreferences.jsx:57`).
- Los presets por símbolo/lista se re-aplican encima de cada escritura
  (`lib/chartSettings.js:116-126` `applyScopedPreset`): cualquier `writeChartSettings` bajo scope
  símbolo/lista con un preset viejo guardado puede devolver un `interval` distinto del que se ve.
  El modal del screener escribe el mismo storage global (`app/page.jsx:720`).

## A3. La ficha recibe un RS distinto según cómo se pida — [REPRODUCIDO]

```
GET /api/company-brief?symbol=AAPL                → globalRsSeries: 2 puntos  (08-08 y 08-09)
GET /api/company-brief?symbol=AAPL&benchmark=QQQ  → globalRsSeries: 28 puntos (13-feb → 09-ago)
```

[MEDIDO]. Consecuencia visible: la ficha abre con «Sin línea RS: 1 semana de histórico (mínimo 8)»
y, al aplicar cualquier benchmark, **la línea RS aparece** con 28 semanas. La pieza central del
producto es no determinista en su superficie principal, y es otra instancia del patrón «se arregla
al tocarlo».

El mecanismo es la caché de la ficha, no el motor de RS (ya trazado en la sesión paralela de hoy
sobre el relleno de 26 semanas): `getCompanyBrief` retorna en el cache-hit **antes** de leer la
serie RS (`app/api/company-brief/route.js:1485-1487`), la clave de caché incluye el benchmark, y el
TTL es de un día (`DEFAULT_BRIEF_MAX_AGE_DAYS = 1`, línea 22). Una entrada `AAPL:AUTO` cacheada
antes del relleno sirve la serie vieja de 2 puntos durante todo su día de vida; `AAPL:QQQ`, nunca
cacheada, recalcula y trae las 28 semanas. El histórico está en la base; la ficha lo verá cuando
caduque su entrada. Para el gráfico la lección es de contrato: **la serie que alimenta la línea RS
puede cambiar de 2 a 28 puntos entre dos interacciones cualesquiera**, y el chart debe comportarse
igual de bien con ambas (hoy, ese cambio dispara además los huecos de A2).

## A4. Fallo 2 del dueño («Sin dato al abrir») — corregido; verificado hoy

El diagnóstico de aquella sesión existe como commit: `5941767` (2026-07-24) — el guard
`mountedRef` de `useChartDataModel` quedaba en `false` tras el desmontaje simulado de StrictMode y
todo cambio de `requestKey` posterior abortaba sin refetch. El fix (poner `mountedRef.current =
true` en el cuerpo del efecto de montaje, `app/useChartDataModel.js:317`) está en la base actual.
Verifiqué hoy: recarga con `1D · 1m` guardado (combinación que siempre exige remoto,
`lib/chartDataModel.js:158`) → `/api/chart` dispara y el gráfico monta [REPRODUCIDO]. Nota menor:
en dev dispara **dos** fetches idénticos por el doble montaje de StrictMode [MEDIDO].

## A5. Fallo 3 del dueño (1D/5D/1M apagados) — [REPRODUCIDO]

Con W quedan apagados 1D/5D/1M; con M, también 3M, y Max además desaparece. La regla vive en
`app/ChartPreferences.jsx:17-26`:

```js
if (interval === "W") return !["1D", "5D", "1M"].includes(rangeKey);
if (interval === "M") return !["1D", "5D", "1M", "3M", "MAX"].includes(rangeKey);
```

La única explicación al usuario es un tooltip de hover (`ChartPreferences.jsx:43`:
`"${item.label} no aplica a esta temporalidad"`). Nada visible dice por qué, y la asimetría
(apagar unos, ocultar otros, reescribir el guardado — A2) hace el conjunto ilegible. La causa de
fondo es que **estos rangos solo existen por los intervalos intradía** (A6): en un producto de
cierres diarios, un «rango 1D» son 2 velas (`lib/chartSettings.js:4`, `bars: 2`).

## A6. Fallo 4 del dueño (temporalidades intradía) — [REPRODUCIDO]

`CHART_INTERVALS` publica 1m/5m/15m/30m/1H/4H (`lib/chartSettings.js:15-25`). Funcionan —
`/api/chart?range=1D&interval=1m` devolvió velas de minuto de Yahoo — y eso es lo malo:

- El producto clasifica sobre cierres diarios/semanales; el propio desk lo dice
  (`lib/stockDecisionDesk.js:173`: «Filtro validado en marco diario/semanal»).
- Las medias se calculan sobre las filas dibujadas (`chartNativeAdapter.js:283-292` +
  `movingAverage`): en 1m son **medias de 50/200 minutos** con la misma ropa que las de 50/200
  días. Un número falso con aspecto de preciso.
- El RS se oculta («la línea RS se calcula con cierre diario y se oculta en intradía»), los
  marcadores VCP también (`projectPatternMarkers` solo en D), el rango salta solo a 1D, y cada
  apertura intradía golpea al proveedor sin caché diaria (`shouldRequestRemoteBars` → siempre
  remoto). Y de fondo: servir intradía de Yahoo en un SaaS de pago es exactamente el problema de
  licencia ya documentado para diario, agravado.
- Toda la maquinaria de compatibilidad rango↔intervalo (A5, la corrección silenciosa de A2) existe
  para sostener estas seis opciones.

## A7. La navegación del chart está muerta y habla con instancias fantasma — [REPRODUCIDO]

Lo medible hoy, en una ficha recién abierta:

- El rail dice para siempre «MODO Último dato · VENTANA Sin ventana · BARRAS Sin dato», con el
  chart dibujado y con zoom aplicado [REPRODUCIDO].
- Los botones ←/→ y «Restaurar» están deshabilitados siempre; los de zoom, habilitados, **no hacen
  nada** [REPRODUCIDO]. Ctrl+rueda sí funciona.

Tres defectos encadenados:

1. **El snapshot público no lleva `view`** (`lib/chartViewportLifecycle.js:127-135`,
   `buildPublicSnapshot` publica `lifecycle/visibleLogicalRange/visibleTimeRange/label/profile`).
   El controller construye el rail desde `viewport.state.view`
   (`app/useChartController.js:346-355`) — siempre `undefined` → `manual` siempre `false` → los
   botones con `disabled={!viewportRail.manual}` (`UniversalPriceChart.jsx:115-119`) no se
   habilitarán jamás. Es estructural, no una carrera.

2. **El canal de publicación se auto-bloquea.** `schedulePublishSoon` no agenda si hay un RAF
   pendiente (`chartViewportLifecycle.js:184-186`: `if (state.rafHandle != null) return;`), pero el
   attach guarda en ese mismo `state.rafHandle` el RAF de `onLogicalRangeChange`
   (`chartViewportLifecycle.js:523-524`, vía `localHandleSet("rafPublication", rafId)`), un
   callback que **no limpia el handle al ejecutarse**. Desde ese momento toda publicación queda
   descartada: por eso «VENTANA» no se rellena ni tras zoom [REPRODUCIDO].

3. **Los botones hablan con otro lifecycle que el chart.** `useChartDrawings` devuelve un objeto
   nuevo cada render con `getInteractionState: () => interaction.getState()`
   (`app/useChartDrawings.js:477`) — identidad nueva siempre —, y `useChartViewport` **recrea el
   lifecycle entero cuando esa identidad cambia** (`app/useChartViewport.js:81-97`). Cualquier
   re-render del padre (y la ficha re-renderiza por mil motivos) deja: chart vivo enganchado al
   lifecycle viejo (su listener de rueda funciona — por eso ctrl+rueda zoomea), y
   `viewport.actions` apuntando al lifecycle nuevo, `"detached"`, cuyos `zoom()/pan()/reset()`
   retornan en el guard (`chartViewportLifecycle.js:270`). Además el `release()` del attach viejo
   no lo llama nadie (el controller ignora el retorno de `viewport.attach`,
   `useChartController.js:236-247`, y su cleanup llama `viewport.detach()` — que ya apunta al
   nuevo): **listeners de rueda, suscripciones y `setTimeout(applyRestored, 80)` del viejo quedan
   vivos y se acumulan**. La mutación espontánea de ventana de A1 (215→63 barras sin tocar nada) es
   el tipo de efecto que esa acumulación produce [la mutación, MEDIDA; su autor exacto, INFERIDO].

## A8. Redimensionar rompe el lienzo hasta el siguiente redibujado — [REPRODUCIDO]

Al ensanchar la ventana del navegador (≈800→1280), el chart conservó el ancho viejo: velas en la
mitad izquierda, **eje de precios flotando en el centro del lienzo**, mitad derecha vacía
[REPRODUCIDO, captura]. Se recompone al forzar una recreación (clic en un rango). Con A7-3 el
observer que debía reaccionar pertenece a un attach cuyo guard de `attachmentId` ya no casa
[INFERIDO]; el hecho medido: `canvas 730px` dentro de `container 1187px` hasta recrear.

## A9. «Comparar vs» promete y no entrega — [REPRODUCIDO]

Cambiar el benchmark destruye y recrea el chart entero (nueva primitiva de dibujo [MEDIDO:
`window.__trendlinePrimitive` cambió de instancia]) para no pintar nada nuevo: **la línea del
benchmark no existe**. El adaptador la calcula y la tira (`app/chartNativeAdapter.js:363-367`):

```js
// Benchmark line (proyección sin pintar — el controller decide si la quiere)
void projectBenchmarkLineSeries(rows, overrides.benchmarkSeries, interval, indicators);
```

`overrides.benchmarkSeries` no se pasa nunca (`useChartController.js:217-223` pasa
`patternOverlay/rsRatingSeries/requestedHeight/positive`) y la prop `relativeStrength` entra al
controller y muere sin uso (`useChartController.js:78`). Efectos reales del control: un teardown
con parpadeo, la lotería de ventana de A1, y la aparición del RS por A3. El motivo del chart —
comparar — es el único que no ocurre.

## A10. Menores (vistos de pasada, todos [REPRODUCIDO] salvo indicación)

- **Banda que cruza el lienzo:** el fondo del chart es `transparent`
  (`chartNativeAdapter.js:155`) y el límite de secciones de la página pasa por detrás de las velas
  como una franja de otro tono.
- **El % de la cabecera** es el retorno del rango dibujado (89,3% en 5A), pegado al último cierre y
  a un paso del +0,2% diario del hero: dos números con ropa idéntica y semántica distinta.
- **«ene 26»** como etiqueta de eje es ambiguo en es-ES (¿26 de enero?); el año con siglo
  («ene 2026» o «’26») desambigua.
- Velas alcistas sólidas claras / bajistas huecas (`downColor: "rgba(0,0,0,0)"`,
  `chartNativeAdapter.js:219-226`): legible en pantalla oscura, pero es la convención invertida de
  la mayoría de plataformas (huecas = alcistas). Decisión estética a validar, no fallo.
- La entrada sintética del navegador embebido no consiguió arrastrar ni provocar crosshair
  (los eventos despachados al canvas superior por consola sí panean y sí disparan
  `subscribeCrosshairMove`): **no concluyente para ratón real** — conviene verificación manual.
- Doble fetch de `similar/comparables/social-sentiment` en cada apertura de ficha (StrictMode).

---

# PARTE B — El RS dentro del gráfico

## B1. Primero, deshacer una ambigüedad: hay dos «RS»

| | Qué es | Forma | Puntos por año |
|---|---|---|---|
| **RS line** (MarketSmith la superpone) | ratio precio/benchmark (típicamente vs S&P 500) | línea continua, un valor por barra | ~252 (D) |
| **RS Rating** (el número 1–99) | percentil semanal del universo | escalera discreta, un valor por semana | ~52 |

MarketSmith dibuja la **línea ratio** en azul bajo las barras de precio, dentro del mismo panel, y
el **rating** lo muestra como número aparte; la señal clásica es «RS line en máximo nuevo antes que
el precio» (punto azul). Referencias: [MarketSmith chart overview](https://www.marketsmith.hk/overview/chart-overview/),
[réplicas del indicador en TradingView](https://in.tradingview.com/scripts/marketsmith/),
[useThinkScript](https://usethinkscript.com/threads/relative-strength-line-for-thinkorswim.20397/).

Hoy StatsEdge dibuja en el panel inferior **el percentil** (`chartNativeAdapter.js:294-361`), y la
línea ratio existe en el payload (`relativeStrength.series`, 798 puntos desde 1999 [MEDIDO]) pero no
se pinta (A9). Es decir: tenemos en pantalla la serie con menos resolución visual, y guardada en un
cajón la que MarketSmith enseña.

## B2. ¿Se puede superponer bien con lightweight-charts 5.2? Sí — verificado en el chart real

El problema original («escalas incompatibles, 1–99 frente a cotización; la línea se salía de la
pantalla») ocurre cuando la serie RS comparte la escala del precio, o cuando se usa una escala
oculta sin fijar rango ni banda — que es lo que hacía el overlay antiguo (`"rs-line-overlay"`,
descrito en `chartNativeAdapter.js:296-300`). La solución canónica de la librería es otra:

- **Overlay price scale**: cualquier `priceScaleId` distinto de `left/right` crea una escala
  independiente, invisible por defecto, sin límite de cuántas
  ([docs de price scale](https://tradingview.github.io/lightweight-charts/docs/price-scale)).
- **Banda propia** vía `scaleMargins` de esa escala (p. ej. `{top: 0.75, bottom: 0.02}` = franja
  inferior del panel).
- **Rango fijo** vía `autoscaleInfoProvider: () => ({priceRange: {minValue: 1, maxValue: 99}})`
  para percentiles — el mismo truco que el pane actual ya usa
  (`chartNativeAdapter.js:326-328`) — o autoescala de banda para el ratio.

Lo comprobé **sobre el chart vivo de la ficha, por consola, sin tocar código**: una `LineSeries`
con `priceScaleId: 'rs-overlay'`, banda 0.55/0.30 y provider 1–99 dibujó la serie del ranking
superpuesta al precio, con su «RS 70» rotulado por `lastValueVisible`, sin aplastar el autoscale
del precio ni salirse del lienzo. La mecánica funciona en 5.2.0.

**La condición que no es negociable** (y que la PoC también demostró, por la vía negativa): **los
tiempos de la serie superpuesta deben ser los tiempos de las velas.** Al añadir la serie ratio con
sus 798 fechas propias, el eje compartido absorbió todos esos puntos (1999→2026) y las velas
quedaron flotando entre columnas vacías — la versión extrema del bug A2-(a). Antes de superponer
nada hay que re-muestrear la serie al `time` de la barra dibujada (snap a la vela de su semana/mes,
forward-fill si falta). Esto arregla de paso el pane actual, que sufre lo mismo.

## B3. Propuesta

**1. La línea superpuesta es la RS line ratio, no el percentil.**

- Serie: `close(símbolo) / close(benchmark)`, un punto por vela dibujada, re-muestreada a los
  tiempos de las velas; rebase al primer valor de la ventana de datos (el nivel absoluto del ratio
  no significa nada; su forma sí). `projectBenchmarkLineSeries` (`lib/chartSeriesModel.js:213-243`)
  ya hace casi exactamente esto (log-ratio rebasado y agregado por intervalo) — está escrito y sin
  usar.
- Colocación: overlay scale invisible, banda inferior ~25% del panel de precio, línea 1–1.5 px en
  color secundario (`--traza`), sin eje propio, `lastValueVisible: false`.
- El **RS Rating** (percentil del universo) se queda como número — el badge «RS global» que ya
  existe — y, si se quiere en el lienzo, como etiqueta junto al último punto de la línea, no como
  serie.
- El pane inferior actual desaparece: el precio recupera el 20% de altura que hoy pierde
  (`PRICE_PANE_STRETCH/RS_PANE_STRETCH`, `chartNativeAdapter.js:47-48`).

**2. Por qué así y no de otras maneras.**

- *Por qué superpuesta y no en panel:* lo que un operador de tendencia extrae del RS en el gráfico
  son **divergencias con el precio** (RS marcando máximo antes que el precio, RS plano mientras el
  precio sube). Eso exige alinear ojos y máximos en el mismo espacio; en un panel aparte de 70 px la
  comparación es de memoria, no visual. Y es el patrón que el usuario objetivo ya tiene entrenado de
  MarketSmith.
- *Por qué el ratio y no el percentil:* el percentil semanal tiene ~28 puntos hoy y es una
  escalera acotada 1–99 casi plana (la captura del pane actual lo muestra: una línea horizontal
  alrededor de 70 en una franja de 70 px — resolución visual nula). El ratio es continuo, tiene un
  punto por vela, y sus máximos/mínimos son la señal metodológica (O'Neil/Minervini la miran así).
- *Por qué sin eje:* la línea RS se lee por forma, no por valor — MarketSmith tampoco le pone eje.
  El valor puntual va al crosshair/tooltip. (La objeción que mató al overlay antiguo — «una línea
  sin eje que la lea» — aplicaba al percentil, cuyo valor absoluto sí importa; se resuelve
  mostrando el rating como número, no dándole eje a la línea.)

**3. Contrapartidas, dichas enteras.**

- La banda inferior convive con el volumen (hoy en `scaleMargins {top: 0.82}` del overlay de
  volumen): dos capas en el 25% inferior. Mitigación: volumen 0.85→1.00, RS 0.70→0.85, línea fina.
  Aun así, en valores con rangos de precio muy anchos habrá cruces puntuales línea-vela. Es el
  precio de la superposición; MarketSmith lo paga igual.
- Sin eje, el valor exacto del ratio no es visible de un vistazo (mitigado por tooltip y por el
  rating numérico).
- Exige servir el benchmark alineado por barra para el rango pedido (hoy `rs.series` llega con
  muestreo irregular y profundidad fija). Es trabajo de servidor, no de librería.
- Una escala overlay más = un poco más de estado en el adaptador. Comparado con mantener un pane
  (stretch factors, eje fijo, separador), sale ganando.
- Si algún día se quiere el percentil como línea (histórico largo del ranking), necesitará su panel
  con eje 1–99 — esa decisión no se pierde: se pospone hasta que exista más de un año de ranking.

---

# PARTE C — La pregunta abierta

## C1. El diagnóstico honesto: el gráfico no necesita más capas, necesita un dueño

Los fallos de la Parte A no son diez bugs independientes: son **el mismo bug con diez caras**. Hoy
«qué se ve en el lienzo» lo deciden, compitiendo: la config declarada (`settings`), el perfil
adaptativo (`targetBars`), `fitContent`, la restauración de ventana manual
(`manualChartWindowRestorePolicy`), el `ResizeObserver`, los `setTimeout(applyRestored, 80)`, la
corrección de compatibilidad de `ChartPreferences`, los presets por scope, y el doble montaje de
StrictMode. Ocho archivos y ~2.700 líneas para un chart, construidos ADR sobre ADR, cada capa
arreglando a la anterior — y las tres instancias de estado de A7 conviviendo en la misma página.

La propuesta de fondo no es «arreglar los diez»: es **invertir el contrato de la ventana**.

> La ventana visible es una función pura de `(settings, datos)`: el rango declarado se dibuja
> entero, siempre (`fitContent` como única verdad inicial). El perfil adaptativo decide densidad
> visual (espaciado mínimo, formato de eje), nunca la ventana. La única desviación legítima es un
> gesto explícito del usuario, y se guarda como estado de primera clase (una `visibleWindow` en
> settings, junto a `range` e `interval`), no como una «captura» heurística reconstruida en cada
> attach.

Con ese contrato: A1 desaparece (el 2A muestra 2A), A2-(c) desaparece, la mitad de
`chartViewportLifecycle`/`chartNavigation` (restore policy, rescaled ranges, captura manual) se
borra, y el rail —si sobrevive— publica un estado que existe. Menos código, no más.

Segunda inversión, del lado datos: **una respuesta por `(símbolo, rango, intervalo)` con todas las
series alineadas por vela** — OHLCV, medias, RS line, rating forward-filled, benchmark — servida
por un solo endpoint. Hoy el cliente adivina si las 520 barras del brief bastan
(`shouldRequestRemoteBars`), fusiona local/remoto con una matriz de 8 estados
(`chartDataModel.resolve`), y cada serie llega con sus fechas (origen de las columnas fantasma).
Si el servidor alinea, el cliente solo pinta; la matriz entera y los avisos «Ampliando
histórico...» se quedan en un `loading` y un `error`.

## C2. Qué necesita ver un operador de tendencia (y qué no)

Partiendo de cero, con los principios del producto delante:

**El defecto debería ser semanal.** Weinstein es un método semanal; la etapa se define sobre la
media de 30 semanas. El chart abre hoy en `1A · D` con SMA 50/200 diarias
(`DEFAULT_CHART_SETTINGS`, `lib/chartSettings.js:39-51`) — **el producto dice Weinstein y su
gráfico por defecto no puede enseñar una etapa Weinstein**. Propuesta: defecto `2A · W` con
**SMA30 semanal** (y en vista D, la 50/200 actuales). Es un cambio de constantes, y es el más
importante de todo este documento en términos de producto.

**Escala log por defecto.** Para estructura de tendencia y bases largas, la escala aritmética
distorsiona (un 10% arriba no mide lo mismo que abajo). Log existe hoy escondida como tercera
opción. Minervini/Weinstein publican sus gráficos en log.

**Lo que se queda en el lienzo (y nada más):**
1. Velas (o barras) del precio, con el rango declarado entero a la vista.
2. SMA30w (en W) / SMA50-200d (en D).
3. Volumen con su media, abajo.
4. RS line superpuesta (Parte B) + rating como número.
5. Máximo de 52 semanas y pivote válido cuando exista (la línea `Pivot` actual, que ya es
   honesta respecto a cuándo mostrarse).

**Lo que sobra de la superficie actual** (principio 2: cada elemento justifica su sitio):
- El **rail de chips** Modo/Ventana/Barras — hoy muerto (A7) y, aun funcionando, es telemetría
  interna, no lectura de mercado.
- La **botonera de 7 iconos** (←/→/zoom±/restaurar/saltar/dibujar) — hoy 5 de 7 muertos o
  redundantes con gestos nativos (arrastre, rueda, doble clic en eje). Dejar: dibujar trendline, y
  un solo «ajustar al rango».
- Las **temporalidades intradía y los rangos 1D/5D** — con cierres diarios son ruido, arrastran
  la matriz de compatibilidad entera (A5) y el riesgo de licencia (A6). Quedaría: `D W M` ×
  `3M 6M 1A 2A 5A Max`, sin reglas de compatibilidad, sin botones apagados, sin reescrituras.
- El **selector de escala** como segmento visible (log defecto, % útil solo para comparar — que
  viva junto al benchmark cuando la comparación exista de verdad).

Cada elemento eliminado borra además su clase de bugs: es la manera de que «menos superficie» y
«deja de romperse» sean el mismo trabajo.

**Una adición que sí ganaría su sitio** (cuando el pivote real exista): sombreado ligero de la
base detectada (rango de la consolidación) en vez del panel VCP de chips — la información del
patrón, dibujada donde el operador ya está mirando. El panel de diagnóstico VCP actual es útil para
auditar el detector, no para operar: su sitio natural es detrás del toggle de diagnóstico, no en la
ficha por defecto.

## C3. Qué no haría

- **No cambiar de librería.** Todos los fallos encontrados son nuestros; lightweight-charts 5.2
  hizo todo lo que se le pidió, incluida la superposición con escalas independientes (PoC).
- **No añadir indicadores** (RSI/MACD/etc.): el principio 1 y el nicho lo prohíben — la metodología
  es estructura + volumen + RS.
- **No paneles múltiples estilo terminal.** La ventaja competitiva declarada es «se entiende de un
  vistazo»; cada panel extra es un vistazo más.

---

# CONFIANZA

| Hallazgo | Confianza | Base |
|---|---|---|
| A1 ventana ≠ rango declarado | Alta | Reproducido y medido 3 veces (160/88/48 targetBars); código citado |
| A1 mecanismo exacto (RO reaplica barSpacing tras fit) | Media | Inferido del código; encaja con las 3 medidas; no tracé el frame a frame |
| A2 columnas fantasma por tiempos RS | Alta | Medido 58 slots / 33 velas; captura; reproducción extrema con serie 1999→2026 |
| A2 como explicación del reporte del dueño (benchmark→«mensual», sept 2025) | Media-alta | Encaja cuantitativamente (48×2 slots ≈ sept-2025) y causalmente (RS aparece con benchmark); no vi su sesión |
| A2 salto literal de `interval` W→M | Baja | No reproducido; mecanismos latentes citados (presets por scope, storage compartido) |
| A3 RS distinto con/sin benchmark | Alta | Dos GET consecutivos, 2 vs 28 puntos; mecanismo (caché del brief) trazado en la sesión paralela de hoy y citado en línea |
| A4 fallo «Sin dato» corregido | Alta | Commit `5941767` + verificación en vivo hoy |
| A5, A6 | Alta | Reproducidos con captura; código citado |
| A7 rail muerto / botones muertos / lifecycle triple | Alta | Reproducido (botones vs ctrl+rueda) + tres defectos localizados en línea concreta |
| A7 la mutación espontánea 215→63 y su autor | Media | La mutación está medida; el autor (timers huérfanos) es el sospechoso coherente, no está trazado |
| A8 resize roto | Alta | Reproducido con captura y medidas de ancho |
| A9 benchmark sin línea | Alta | `void projectBenchmarkLineSeries` + overrides sin la prop + teardown medido |
| B viabilidad overlay en LWC 5.2 | Alta | PoC ejecutada sobre el chart real de la ficha |
| B idoneidad ratio vs percentil | Media-alta | Juicio de producto apoyado en MarketSmith y en la resolución visual medida del percentil |
| C | — | Propuesta; su valor es discutible por diseño, no verificable |

# LO QUE NO HE VERIFICADO

- El salto literal de temporalidad W→M del reporte original: no ocurrió con mi `localStorage`
  limpio. Si el dueño conserva el estado donde le pasó, `statsedge.chartSettings.v1` (en concreto
  `symbolPresets`/`listPresets` y el scope activo) diría si fue la vía de presets.
- Arrastre y crosshair con ratón real: la entrada sintética del navegador embebido no los disparó
  y eso no es prueba (los mismos eventos bien dirigidos por consola sí funcionan). Verificar a mano.
- El detalle frame a frame de la lotería de ventana (por qué el mismo attach a veces respeta el
  fit y a veces no): tres resultados medidos, mecanismo dominante citado, traza completa no.
- La cola de revisión y la navegación entre valores con flechas (sin cola montada en mi entorno);
  el modal rápido del screener; móvil táctil; otros símbolos con RS completo (solo AAPL a fondo).
- Las capturas de las PoC y de los estados rotos viven en la sesión de análisis; los pasos para
  regenerarlas están descritos en cada hallazgo (todas parten de `/stock/AAPL` en dev).
