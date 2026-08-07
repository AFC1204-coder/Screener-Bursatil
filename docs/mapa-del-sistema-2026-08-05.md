# Mapa del sistema — el recorrido de un símbolo en StatsEdge

Fecha de esta versión: 2026-08-05 (contenido verificado el 2026-08-07). Rama
`codex/statsedge-ui-polish`, `BASE_SHA b51d1b4`.

## Para quién es esto y cómo leerlo

Este documento explica cómo viaja la información dentro de StatsEdge: desde
que un símbolo bursátil entra al sistema hasta que un número aparece en tu
pantalla. Está escrito para que puedas razonar sobre tu propio sistema sin
depender de que un modelo de IA te lo explique cada vez.

Cada vez que este documento afirma algo sobre el código, termina la frase con
una referencia entre paréntesis con el formato `archivo:línea` — es el sitio
exacto donde se verificó, por si algún día quieres (o alguien a quien se lo
pidas quiere) comprobarlo. Cuando la afirmación es sobre datos reales de tu
base de datos, se incluye la consulta usada y lo que devolvió. Ninguna
afirmación de este documento se hizo "de memoria" o por analogía con cómo
suelen funcionar estos sistemas — todo se leyó del código o se consultó
directamente contra producción (en modo solo lectura; no se escribió nada,
no se ejecutó el cron, no se hizo commit).

Cuando algo no se pudo verificar con confianza, este documento lo dice
explícitamente en vez de rellenar el hueco. La sección final,
["Lo que no he podido verificar"](#lo-que-no-he-podido-verificar), reúne
todos esos casos en un solo sitio.

Una nota de vocabulario antes de empezar: vas a ver la palabra "pipeline"
mucho. Significa, literalmente, "tubería" — una cadena de pasos por la que
pasa un dato, uno detrás de otro, hasta salir convertido en otra cosa. Este
sistema tiene más de una tubería de ese tipo funcionando en paralelo, y una
de las razones de ser de este documento es que sepas distinguirlas.

## Índice

- [Parte A — El recorrido completo](#parte-a--el-recorrido-completo)
  - [A.0 — El mapa de conjunto](#a0--el-mapa-de-conjunto)
  - [A.1 — Etapa 1: el universo](#a1--etapa-1-el-universo)
  - [A.2 — Etapa 2: precios históricos](#a2--etapa-2-precios-históricos)
  - [A.3 — Etapa 3: datos de empresa (fundamentales)](#a3--etapa-3-datos-de-empresa-fundamentales)
  - [A.4 — Etapa 4: señales y puntuaciones](#a4--etapa-4-señales-y-puntuaciones)
  - [A.5 — Etapa 5: qué se guarda en la base de datos](#a5--etapa-5-qué-se-guarda-en-la-base-de-datos)
  - [A.6 — Etapa 6: cómo llega a las pantallas](#a6--etapa-6-cómo-llega-a-las-pantallas)
  - [A.7 — Los caminos: cuál se usa cuándo](#a7--los-caminos-cuál-se-usa-cuándo)
- [Parte B — Los conceptos](#parte-b--los-conceptos)
  - [B.1 — Qué es el universo](#b1--qué-es-el-universo)
  - [B.2 — Qué es un escaneo](#b2--qué-es-un-escaneo)
  - [B.3 — Qué son las 18 señales](#b3--qué-son-las-18-señales)
  - [B.4 — Qué es un percentil de universo](#b4--qué-es-un-percentil-de-universo)
  - [B.5 — totalScore, objectiveScore y compositeScore](#b5--totalscore-objectivescore-y-compositescore)
  - [B.6 — Qué es un preset](#b6--qué-es-un-preset)
- [Parte C — Los sitios donde se guardan cosas](#parte-c--los-sitios-donde-se-guardan-cosas)
  - [C.1 — Las tablas](#c1--las-tablas)
  - [C.2 — `raw` frente a `metrics`](#c2--raw-frente-a-metrics)
  - [C.3 — Las cachés](#c3--las-cachés)
- [Parte D — Lo que está roto o a medias](#parte-d--lo-que-está-roto-o-a-medias)
  - [D.1 — Lo que ya sabías (auditorías del 2026-08-04)](#d1--lo-que-ya-sabías-auditorías-del-2026-08-04)
  - [D.2 — Qué se arregló en los últimos días](#d2--qué-se-arregló-en-los-últimos-días)
  - [D.3 — Qué sigue abierto](#d3--qué-sigue-abierto)
  - [D.4 — Si ves esto, sospecha](#d4--si-ves-esto-sospecha)
- [Parte E — Preguntas abiertas](#parte-e--preguntas-abiertas)
- [Lo que no he podido verificar](#lo-que-no-he-podido-verificar)

---

## Parte A — El recorrido completo

### A.0 — El mapa de conjunto

Antes del detalle etapa por etapa, así es la forma general del sistema.
Fíjate en que no hay una sola tubería: hay varias, y todas terminan
escribiendo en las mismas dos tablas (`scans` y `scan_results`), que es lo
que finalmente lee la pantalla.

```
                    ┌─────────────────────────────────────────┐
                    │  FUENTES EXTERNAS DE SÍMBOLOS            │
                    │  NasdaqTrader, HKEX, TWSE, J-Quants,     │
                    │  ASIC, ESMA/FIRDS, FCA + listas fijas    │
                    └───────────────────┬───────────────────────┘
                                        │
                                        ▼
                          ┌─────────────────────────┐
                          │  UNIVERSO (universeEngine) │──── caché: universe_snapshots
                          └────────────┬────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
  ┌───────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
  │ CAMINO INTERACTIVO │   │  CAMINO CRON           │   │  CAMINOS "SOMBRA"      │
  │ (usuario pulsa     │   │  (scan-refresh, 7      │   │  (shadow-europe,       │
  │ "Ejecutar")         │   │  grupos de mercado)    │   │  shadow-firds — 12     │
  │ lib/serverScanRunner│   │  lib/materializedScanner│  │  grupos más, Europa)   │
  └─────────┬───────────┘   └───────────┬────────────┘   └───────────┬────────────┘
            │                            │                             │
            │  cada uno descarga precios (lib/yahoo.js) y fundamentales│
            │  (lib/yahoo.js), calcula señales (lib/scoringEngine.js)  │
            │  y arma la fila (buildResearchRow, DUPLICADO en 2 sitios)│
            ▼                            ▼                             ▼
                    ┌─────────────────────────────────────────┐
                    │   scans + scan_results (Supabase)         │
                    │   columnas raw (todo) y metrics (subset)  │
                    └───────────────────┬───────────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
  ┌───────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
  │ Screener (pantalla │   │  Leaderboards           │   │  Ficha de acción       │
  │ principal) — lee   │   │  (lib/leaderboards.js) │   │  (company-brief) —      │
  │ el último scan      │   │  lee scan_results,     │   │  recalcula casi todo    │
  │ guardado; recalcula │   │  NUNCA vuelve a         │   │  en vivo, solo toma     │
  │ solo si pulsas       │   │  calcular nada          │   │  rsGlobalPct de la      │
  │ "Ejecutar"           │   │                         │   │  última fila guardada   │
  └───────────────────┘   └───────────────────────┘   └───────────────────────┘
```

Las etapas 1 a 4 (universo, precios, fundamentales, señales) están
**duplicadas**: existe una versión para el camino interactivo y otra,
escrita por separado, para el camino de cron. No comparten una única
función — cada una se mantiene a mano, así que un arreglo hecho en una no se
aplica automáticamente a la otra. Esto se repite en varios de los hallazgos
de la Parte D.

### A.1 — Etapa 1: el universo

**Qué entra**: nada — es el punto de partida. **Qué sale**: una lista de
símbolos elegibles para escanear, con su mercado, nombre, y de qué fuente
salió. **Dónde ocurre**: `lib/universeEngine.js` y `lib/universes.js`.

Antes de nada, una advertencia importante: `AGENTS.md` (el documento de
gobernanza de este repositorio) describe una regla de universo basada en
descargar el catálogo completo de Twelve Data y filtrarlo por `mic_code` y
`type == "Common Stock"`. **Esa regla no está implementada en el código que
corre hoy.** Se buscó cualquier llamada activa a ese catálogo de Twelve Data
para construir la lista de símbolos y no apareció ninguna — Twelve Data sí
se usa en otras etapas (como proveedor alternativo de precios), pero no para
decidir qué símbolos entran al universo. Lo que el código realmente hace es
lo que se describe a continuación. Esto se retoma en la
[Parte E](#parte-e--preguntas-abiertas) porque es una discrepancia real
entre lo que el repositorio dice que hace y lo que hace.

Para cada mercado (US, HK, AU, JP, TW, GB, y trece mercados europeos vía
FIRDS/ESMA — AT, BE, DE, DK, ES, FI, FR, IE, IT, NL, NO, PT, SE), el sistema
intenta un fetch en vivo a una fuente oficial distinta según el mercado, y
siempre lo combina con una lista curada a mano (tickers escritos
directamente en el código como respaldo):

| Mercado(s) | Fuente oficial en vivo | Función |
|---|---|---|
| US | NasdaqTrader (dos ficheros de símbolos) | `fetchUSUniverse` (`lib/universes.js:274-335`) |
| AU | ASIC (informes de posiciones cortas) | `fetchAsicShortUniverse` (`lib/universes.js:112-126`, `lib/asicShort.js:3`) |
| HK | HKEX (lista completa de valores) | `fetchHkexUniverse` (`lib/officialUniverses.js:435`) |
| TW | TWSE (registro ISIN) | `fetchTwseUniverse` (`lib/officialUniverses.js:501`) |
| JP | J-Quants (API oficial japonesa) | `fetchJquantsUniverse` (`lib/officialUniverses.js:576`) |
| GB | FCA FIRDS | `fetchFcaFirdsUniverse` (`lib/officialUniverses.js:803`) |
| 13 mercados europeos | Registro ESMA FIRDS | `fetchFirdsUniverse` (`lib/officialUniverses.js:758`) |
| Todos los demás (CA, SG, ZA, IL, IN, etc.) | Ninguna — solo lista curada | `lib/universes.js:128-147` |

Cada símbolo que sobrevive pasa un filtro de higiene (`qualityGate`,
`lib/universeEngine.js:82-98`) que descarta nombres vacíos, símbolos con
formato inválido, y tipos de instrumento que no son acciones ordinarias
(fondos, deuda, derivados) — esta clasificación se hace por patrones en el
nombre/símbolo, no leyendo un campo `type` de un proveedor externo.

**Qué puede salir mal**: la construcción completa del universo, mercado por
mercado, ocurre **en serie, no en paralelo** (`buildUniverse`,
`lib/universeEngine.js:221-231`) — si tiene que reconstruirlo desde cero
(ver la caché en [A.7](#a7--los-caminos-cuál-se-usa-cuándo) y
[C.3](#c3--las-cachés)), tarda decenas de segundos, y eso ha causado
corridas de cron matadas por tiempo límite (ver
[D.3](#d3--qué-sigue-abierto)). Si un proveedor oficial falla (red caída,
formato cambiado), ese mercado se queda solo con la lista curada fija, sin
que nada te avise de que la cobertura de ese mercado se redujo — es un fallo
silencioso, no un error visible.

### A.2 — Etapa 2: precios históricos

**Qué entra**: un símbolo (p. ej. `AAPL`). **Qué sale**: un array de velas
diarias (fecha, apertura, máximo, mínimo, cierre ajustado, volumen). **Dónde
ocurre**: `lib/yahoo.js`.

El proveedor principal es **Yahoo Finance**, sin necesidad de credencial
para este endpoint concreto (`fetchYahooChartDirect`,
`lib/yahoo.js:1226-1281`, llamando a
`query1.finance.yahoo.com/v8/finance/chart/{símbolo}`). Si Yahoo falla, o
responde con menos de 20 velas diarias (5 en datos intradía), el sistema
intenta dos proveedores de respaldo en cascada: **Stooq** y **Alpha
Vantage** (`fetchYahooChart`, `lib/yahoo.js:1283-1309`) — ambos requieren
una clave de API que, según los logs de producción revisados en esta misma
sesión, no está configurada hoy (ver ejemplo real en
[D.4](#d4--si-ves-esto-sospecha)).

Este endpoint de Yahoo **no reintenta** ante un error HTTP genérico ni ante
un `429` (límite de peticiones superado) — un fallo aquí es un `throw`
directo (`lib/yahoo.js:1231`), y de ahí pasa a la cascada de respaldo. No
hay una lógica de "esperar y reintentar" en esta capa.

Una vez descargadas, las velas se convierten en las métricas técnicas base
de una fila (precio actual, medias móviles de 50/150/200 sesiones,
distancia a máximos, rendimientos a 3/6/12 meses, volumen medio, y el
recuento de barras `chartBarsCount`, que es literalmente la longitud del
array de velas). Esa conversión ocurre dentro de una función llamada
`buildResearchRow`, que **existe en dos copias independientes**: una en
`lib/researchRow.js:188-319` (camino interactivo) y otra, casi idéntica pero
mantenida por separado, en `lib/materializedScanner.js:483-608` (camino de
cron).

**Qué puede salir mal**: si un símbolo trae menos de 20 velas, la
construcción de la fila falla directamente con un error ("Histórico
insuficiente", `lib/researchRow.js:196-197` y
`lib/materializedScanner.js:485-486`) y ese símbolo no produce ninguna fila
en absoluto. El camino de cron, además, exige 180 velas como mínimo de
política de negocio, no de construcción técnica (`baseRejectReason`,
`lib/materializedScanner.js:610-617`, con el umbral fijado en
`app/api/cron/scan-refresh/route.js:192`) — así que una fila puede
construirse con éxito (20+ velas) y aun así ser rechazada después por no
llegar a 180.

### A.3 — Etapa 3: datos de empresa (fundamentales)

**Qué entra**: un símbolo. **Qué sale**: sector, industria, capitalización
de mercado, acciones en circulación, y un bloque de crecimiento (ingresos,
beneficios, márgenes, ROE/ROA, deuda) usado más adelante para puntuar
crecimiento. **Dónde ocurre**: `lib/yahoo.js`, función `fetchYahooProfile`
(`lib/yahoo.js:1311-1378`).

A diferencia de las velas de precio, aquí sí hay una capa de autenticación:
Yahoo exige una cookie y un "crumb" (un token de sesión de corta duración)
para el endpoint que trae sector/industria/perfil detallado
(`quoteSummary`). Esa autenticación se obtiene y se cachea 1 hora
(`getYahooAuth`, `lib/yahoo.js:275-293`). El sistema pide **cuatro fuentes
en paralelo** y tolera que cualquiera de ellas falle sin que la petición
completa falle (`Promise.allSettled`, `lib/yahoo.js:1313-1318`): el perfil
detallado con auth (`quoteSummary`), una serie de fundamentales que **no**
necesita auth (`fundamentals-timeseries`, `lib/yahoo.js:1066-1109`), una
búsqueda de respaldo para sector/industria, y una cotización rápida.

**Qué puede salir mal, y qué ya salió mal**: hasta hace pocos días, cuando
`marketCap` no venía de ninguna de las fuentes, el sistema lo convertía en
`0` en vez de dejarlo vacío — y un `0` de capitalización de mercado es
indistinguible, para un filtro numérico, de una empresa real con
capitalización cero (que no existe). Esto se corrigió el 2026-08-05 (ver
[D.2](#d2--qué-se-arregló-en-los-últimos-días)). La causa raíz que motivó
esa investigación —un supuesto fallo de autenticación 401 "Invalid Crumb"
contra Yahoo— **no se pudo reproducir** al replicar el flujo real de
autenticación (documentado en `docs/yahoo-401-crumb-2026-08-05.md`): dos
peticiones reales, con cookie y crumb genuinos, respondieron con éxito. La
causa original del 401 observado en su momento queda sin explicación
cerrada.

Cuando los fundamentales llegan vacíos por cualquier motivo, las señales que
dependen de ellos (`growthScore`, `epsGrowthProxyScore`) devuelven
explícitamente "sin dato" en vez de fabricar un número neutro
(`lib/scoringEngine.js:494-502`, `531-556`) — este es un diseño correcto,
pero un fallo de fundamentales **no incrementa el contador de errores** que
ves en el progreso de un scan, porque el código lo intercepta antes de
llegar a ese contador (`lib/serverScanRunner.js:219`, `.catch(() => ({}))`)
— es decir, puede haber fundamentales ausentes en una fila sin que el scan
reporte ningún error.

### A.4 — Etapa 4: señales y puntuaciones

**Qué entra**: una fila con precio, velas y fundamentales ya ensamblados.
**Qué sale**: un conjunto de puntuaciones (0 a 100) por símbolo, y una nota
final (`totalScore`/`objectiveScore`). **Dónde ocurre**: `lib/scoringEngine.js`
(el catálogo de fórmulas) y dos orquestadores casi gemelos,
`lib/screenerPipeline.js` (camino interactivo) y la función `sectorize` de
`lib/materializedScanner.js` (camino de cron).

Esta etapa se explica en detalle conceptual en la
[Parte B](#parte-b--los-conceptos) (qué son las 18 señales, qué son
`totalScore`/`objectiveScore`/`compositeScore`, qué es un percentil de
universo). Aquí solo se deja constancia de una asimetría real y verificada
entre los dos caminos: el camino interactivo calcula e incluye una señal
llamada `ipoScore` en su nota final; el camino de cron **nunca la invoca**
(confirmado por búsqueda de texto: cero llamadas a esa señal en
`lib/materializedScanner.js`). El peso de esa señal ausente (2% del total)
se reparte entre las demás en vez de perderse sin más, pero el resultado
numérico final para el mismo símbolo puede diferir entre los dos caminos
solo por esto — ver `docs/equivalencia-pipelines-2026-08-01.md:39-52`.

**Qué puede salir mal**: cuando falta un dato de entrada a una fórmula, cada
capa del sistema decide algo distinto — rechazar la fila, sustituir el dato
ausente por un número fijo (0, 40, 45, 50 según el caso), o simplemente
omitirlo del cálculo. `docs/inventario-dato-ausente-2026-08-01.md` cataloga
más de 150 sitios distintos donde esto ocurre, con criterios que no siempre
coinciden entre sí para el mismo campo. Esto se retoma en la
[Parte D](#parte-d--lo-que-está-roto-o-a-medias).

### A.5 — Etapa 5: qué se guarda en la base de datos

**Qué entra**: la fila ya puntuada de un símbolo, más el resto de símbolos
del mismo escaneo. **Qué sale**: una fila en la tabla `scan_results`, con
una cabecera compartida en `scans`. **Dónde ocurre**: `lib/materializedScanner.js`
(camino de cron) y `lib/serverScanRunner.js` (camino interactivo) — de nuevo,
dos escritores independientes, no uno compartido.

El detalle de qué tablas existen, quién las escribe y quién las lee está en
la [Parte C](#parte-c--los-sitios-donde-se-guardan-cosas). Lo importante en
este punto del recorrido: cada fila se guarda **dos veces dentro de la misma
fila de base de datos** — una copia casi completa en la columna `raw`, y una
copia parcial y con nombres explícitos en la columna `metrics`. Esto tiene
consecuencias reales (ver [C.2](#c2--raw-frente-a-metrics)).

### A.6 — Etapa 6: cómo llega a las pantallas

**Qué entra**: filas ya guardadas en `scan_results` (en la mayoría de los
casos) o, para la ficha de una acción, casi todo recalculado en el momento.
**Qué sale**: lo que ves en pantalla. **Dónde ocurre**: varía mucho según la
pantalla — este es precisamente el motivo de que dos pantallas puedan
mostrarte números distintos para el mismo símbolo. El detalle completo, con
citas, está en [D.4](#d4--si-ves-esto-sospecha) y se resume aquí:

| Pantalla | ¿De dónde saca el dato? | Antigüedad típica |
|---|---|---|
| Screener, al abrir la página | Último scan guardado en la nube o en tu navegador | La del último scan que corriste o que corrió el cron |
| Screener, al pulsar "Ejecutar" | Cálculo en el servidor, en ese momento, que además se guarda | Fresco en el momento; queda guardado para la próxima visita |
| Leaderboards (paneles con filtros por defecto) | Una foto diaria pre-calculada (`leaderboard_snapshots`) | Hasta 1 día |
| Leaderboards (panel de "descubrimiento" del screener, o con filtros propios) | Lectura directa de `scan_results`, sin recalcular nada | Hasta 21 días |
| Salud de mercado (Market Health) | Cálculo propio sobre índices/ETF, **no** sobre el universo de acciones escaneado | Hasta 4 horas, luego recalcula |
| Ficha de una acción | Recalculado casi todo en vivo (con caché propia de 1 día); solo el percentil "RS StatsEdge" viene de la última fila guardada de `scan_results` | Mixta: parte fresca, parte de un scan anterior |

### A.7 — Los caminos: cuál se usa cuándo

El enunciado de esta tarea hablaba de "al menos tres pipelines" (cron,
interactivo, leaderboards). La realidad verificada tiene más piezas móviles
que eso — que quedan agrupadas aquí por lo que realmente hacen:

**1. Interactivo** — se dispara cuando tú (el único usuario del sistema hoy)
pulsas "Ejecutar" en el screener. Corre en el servidor, no en tu navegador
(`app/api/scan/route.js` → `lib/serverScanRunner.js`), y escribe en las
mismas tablas `scans`/`scan_results` que el cron. Es el único camino que, al
completarse con éxito, puede pasar por una fase adicional llamada
"finalización de percentiles" (`lib/scanPercentileFinalization.js`) — el
cron nunca la ejecuta.

**2. Cron de escaneo (`scan-refresh`)** — corre solo, sin que nadie lo
dispare, rotando entre 7 grupos de mercados
(`SCAN_CRON_GROUPS`, `lib/cronPlan.js:21-71`: EEUU+HK+AU, Europa prioritaria,
Europa secundaria, Japón, Taiwán, Canadá, Singapur+Sudáfrica). Cada grupo le
toca aproximadamente una vez por semana. Procesa entre 12 y 24 símbolos por
corrida — un número pequeño, cuya causa se documenta en detalle en
`docs/limites-cron-2026-08-04.md` y se retoma en
[D.2](#d2--qué-se-arregló-en-los-últimos-días).

**3. Cronos "sombra" de Europa** — dos familias adicionales, separadas del
cron principal: `shadow-europe-refresh` (4 grupos: Reino Unido, nórdicos,
Europa occidental, Europa del sur — `lib/cronPlan.js:73-110`) y
`shadow-firds-refresh` (8 cohortes que refrescan el catálogo de referencia
ESMA de 13 mercados europeos — `lib/cronPlan.js:140-197`). Estos alimentan
el descubrimiento y resolución de símbolos europeos (tablas
`shadow_instruments` y `symbol_resolutions`, ver
[C.1](#c1--las-tablas)) antes de que esos símbolos puedan entrar en un scan
real.

**4. Cron de universo (`universe-refresh`)** — el único que **puebla** la
caché de universo (tabla `universe_snapshots`) para 8 mercados
(`CRON_UNIVERSE_MARKETS = ["US","HK","AU","JP","TW","CA","SG","ZA"]`,
`lib/cronPlan.js:19`). Los grupos europeos del cron de escaneo no están
cubiertos por este cron y dependen de otro mecanismo (ver
[D.3](#d3--qué-sigue-abierto)).

**5. Leaderboards** — no calcula nada nuevo, nunca. Solo lee filas ya
guardadas de `scan_results`, o una foto diaria pre-calculada de ellas
(`app/api/cron/leaderboards-refresh/route.js`, una vez al día). Es un
consumidor, no un productor.

**6. Ficha de una acción (`company-brief`)** — es un caso aparte: no lee
`scan_results` como fuente principal, recalcula casi todo en vivo contra
Yahoo (y, para esa pantalla en particular, también SEC EDGAR y Financial
Modeling Prep como fuentes adicionales). Solo un campo, el percentil de RS,
viene de una fila ya guardada.

Verificado con datos reales de producción (`provider_runs`, ventana
2026-08-04 a 2026-08-06) que además del cron de escaneo, sombra y universo
hay una corrida diaria de tipo `run_type=cron-leaderboards-refresh` (marcada
`market: "GLOBAL"` en los datos) que recalcula 5 leaderboards (momentum,
stage2, near-pivot, RS, growth-quality) — consistente con el punto 5.

---

## Parte B — Los conceptos

### B.1 — Qué es el universo

El "universo" es la lista de símbolos que StatsEdge considera candidatos a
analizar. No son todas las acciones del mundo, por dos razones distintas.

La primera es deliberada: el sistema excluye mercados donde el usuario
minorista europeo no puede operar con facilidad (Taiwán, Corea, India, China
continental), mercados donde el proveedor de datos restringe la
redistribución (Australia, según nota de `AGENTS.md:249-251`), y mercados
con poca liquidez o poco material para el tipo de análisis que hace este
sistema (Singapur, Grecia). Esta parte de la decisión está documentada como
regla de negocio en `AGENTS.md`.

La segunda razón es técnica y menos deliberada: como se explica en
[A.1](#a1--etapa-1-el-universo), la cobertura real de cada mercado depende
de si existe una fuente oficial conectada para él. Donde no la hay, el
universo de ese mercado se queda limitado a una lista de símbolos escrita a
mano en el código — no porque se haya decidido excluir el resto, sino porque
nadie ha conectado todavía una fuente dinámica para ese mercado.

### B.2 — Qué es un escaneo

Un "escaneo" (o "scan") es una ejecución completa del proceso: se toma una
lista de símbolos, se descarga su precio y sus fundamentales, se calculan
sus señales y puntuaciones, y el resultado se guarda como un conjunto de
filas (una por símbolo) bajo una misma cabecera. Esa cabecera vive en la
tabla `scans`, y cada fila individual vive en `scan_results`, enlazada a su
cabecera por `scan_id`.

Un escaneo produce, para cada símbolo que sobrevive a los filtros de calidad
(precio disponible, histórico suficiente, liquidez mínima): sus 18 señales,
su nota compuesta, su percentil dentro del universo escaneado en ese momento
concreto, y un conjunto de banderas de calidad de dato. Un mismo símbolo
puede aparecer en decenas de escaneos distintos a lo largo del tiempo, cada
uno con su propia fecha y, potencialmente, con valores algo distintos —
porque el precio cambió, porque el conjunto de símbolos comparado cambió, o
porque el escaneo vino de un camino distinto (ver [A.7](#a7--los-caminos-cuál-se-usa-cuándo)).

### B.3 — Qué son las 18 señales

Una "señal" en este sistema es una fórmula concreta que toma los datos de
**una sola fila** (un símbolo, en un momento dado) y devuelve un número
entre 0 y 100. Todas las señales viven en un catálogo único llamado
`SIGNAL_REGISTRY` (`lib/scoringEngine.js:161-628`), con exactamente 18
entradas verificadas por conteo directo del objeto (no por comentarios del
propio código, que en algún punto llegaron a mencionar 20 o 21 — cifras que
no corresponden a ninguna versión real del registro, según
`docs/contrato-senales-2026-08-04.md:36-51`). Las 18 son:
`weinsteinScore`, `minerviniScore`, `momentumScore`, `riskScore`,
`riskRewardScore`, `volumeEffectScore`, `volumeScore`, `liquidityScore`,
`ipoScore`, `objectiveSetupScore`, `patternContributionScore`,
`patternScore`, `setupQualityScore`, `demandScore`, `growthScore`,
`epsGrowthProxyScore`, `adProxyScore`, y `weaknessScore` (esta última es la
única "negativa": mide deterioro, no fortaleza, y no entra en la nota
compuesta — es un diagnóstico aparte).

`rsGlobalPct` y `dataCoverageScore` (junto con sus primas `rsCountryPct`,
`rsSectorPct` y `technicalCoverageScore`) **no** son señales del registro,
y no es un descuido — es una diferencia de naturaleza real. Una señal del
registro se calcula con una función `compute(fila)` que solo mira esa fila.
`rsGlobalPct` y compañía necesitan, en cambio, **todo el conjunto de filas
del escaneo a la vez** — para saber en qué percentil cae un símbolo hace
falta compararlo contra los demás, no solo mirarlo a él. Por eso viven en un
módulo aparte (`lib/relativeStrength.js`, función `enrichRelativePercentiles`)
que corre **después** de que las 18 señales ya se calcularon fila por fila.
Es la diferencia entre "una fórmula sobre un símbolo" y "una posición
relativa dentro de un grupo".

### B.4 — Qué es un percentil de universo y por qué necesita 20 símbolos

Un percentil de universo responde a la pregunta "¿qué proporción de los
símbolos comparados están por debajo de este?". Si `rsGlobalPct` de una
acción es 85, significa que superó al 85% del resto de símbolos del mismo
escaneo en fuerza relativa.

Esa pregunta no tiene una respuesta fiable con muy pocos símbolos: comparar
una acción contra otras cuatro no te dice casi nada sobre su fuerza relativa
real. Por eso el sistema exige un mínimo de **20 símbolos con dato válido**
en el mismo escaneo antes de calcular este percentil a nivel global
(`RS_GLOBAL_MIN_SAMPLE = 20`, `lib/relativeStrength.js:4`) — por debajo de
ese mínimo, `rsGlobalPct` sale `null` ("sin dato") para todas las filas, no
un número poco fiable. Para los percentiles más estrechos, por país o por
sector/tema, el mínimo baja a 5 símbolos (`RS_SCOPED_MIN_SAMPLE = 5`,
`lib/relativeStrength.js:5`), porque agrupar por país o sector reduce de
entrada cuántos símbolos hay disponibles para comparar.

Esto tiene una consecuencia práctica importante: si escaneas pocos símbolos
a la vez (por ejemplo, seis acciones concretas desde el screener), es
totalmente normal y esperado que `rsGlobalPct` salga vacío para todas ellas
— no es un error, es la protección funcionando como está diseñada.

### B.5 — Qué diferencia hay entre totalScore, objectiveScore y compositeScore

Las tres son notas compuestas (entre 0 y 100) que combinan varias señales
ponderadas, pero están pensadas para responder preguntas distintas.

`compositeScore` es la nota "completa": incluye el bono que se le da a un
símbolo por tener un patrón técnico de calidad (una base de contracción de
volatilidad bien formada, por ejemplo). `totalScore` es, en el diseño
original del sistema, un alias exacto de `compositeScore` — el mismo
número con otro nombre, pensado como la nota que ve el usuario.
`objectiveScore` está pensada para ser más estricta: usa la misma fórmula,
pero **sin** el bono de patrón, precisamente para poder comparar la calidad
subyacente de un símbolo sin que un patrón técnico bonito infle el número
(`lib/screenerPipeline.js:335-336`, donde se ve la diferencia literal en el
código: una llamada usa `objectiveSetupScore` y la otra `setupQualityScore`
como único input distinto).

Esa distinción de diseño se rompió en una fase concreta del sistema (la
"finalización de percentiles", que solo corre en el camino interactivo
cuando el escaneo termina con éxito): un error hacía que las dos fórmulas
recibieran el mismo input, así que `objectiveScore` y `totalScore` acababan
siendo el mismo número letra por letra. Se corrigió en el código el
2026-08-07 (commit `b51d1b4`), pero con una limitación real que se explica
en detalle en [D.2](#d2--qué-se-arregló-en-los-últimos-días): el arreglo
todavía no puede verse reflejado en producción porque depende de un dato
que otra pieza del sistema (una función de base de datos) todavía no
entrega.

### B.6 — Qué es un preset y cómo se relaciona con los filtros

Un "preset" es una plantilla de umbrales ya decididos para un estilo de
búsqueda concreto: capitalización mínima, precio mínimo, volumen mínimo,
distancia máxima a máximos recientes, nota mínima de cada señal, etc. El
sistema trae 7 presets (`SCREENER_FILTER_PRESETS`,
`lib/screenerFilterCatalog.js:167-175`): `balanced` (equilibrado, el que
usa el cron por defecto), `strict`, `early`, `broad`, `ipo`, `nearPivot` y
`weakness`. Cada uno es, literalmente, la misma plantilla base
(`QUALITY_DEFAULTS`, `lib/screenerFilterCatalog.js:103-165`) con algunos
valores sobreescritos para esa estrategia concreta.

Es importante no confundir un preset con el universo: elegir un preset no
cambia qué símbolos se descargan o se analizan — cambia únicamente **cuáles
de las filas ya calculadas pasan el filtro final** y se muestran como
resultado. El universo (de dónde salen los símbolos) y el preset (qué
umbrales tienen que superar) son dos pasos independientes y consecutivos,
no la misma decisión.

Un matiz que ya está documentado como divergencia real entre caminos: el
cron de escaneo **nunca aplica este filtro de preset** — `runMaterializedScan`
no le pasa ningún preset a `applyScreenerFilters`, así que cualquier fila
que la UI interactiva rechazaría por preset puede quedar guardada de todos
modos por el cron (`docs/equivalencia-pipelines-2026-08-01.md:283`, marcada
ahí como divergencia de severidad "Alta"). Se retoma en
[D.3](#d3--qué-sigue-abierto).

---

## Parte C — Los sitios donde se guardan cosas

### C.1 — Las tablas

Verificado leyendo `supabase/schema.sql` completo (1862 líneas). Las cuatro
tablas del "Hito 1B" (`scan_executions`, `scan_result_sets`,
`scan_work_items`, `scan_result_set_rows`) **no están en el esquema activo**
— se apartaron a `supabase/deferred/hito-1b.sql` el 2026-08-03 porque nunca
se llegaron a usar en producción (`docs/adr-hito-1b-diferido.md`); si alguna
vez ves esos nombres mencionados en otro documento, ten en cuenta que hoy no
existen como tablas activas.

| Tabla | Para qué sirve | Quién escribe | Quién lee |
|---|---|---|---|
| `scans` | Cabecera de un escaneo: nombre, preset, progreso, número de filas | Los tres caminos (interactivo, cron, sombras) — `lib/materializedScanner.js:1646`, `lib/serverScanRunner.js:84,94,148` | Pantalla de scans guardados, comparables (`app/api/scans/route.js:389`) |
| `scan_results` | Una fila por símbolo por escaneo, con todas sus señales y puntuaciones | Mismos tres caminos | Screener, leaderboards, ficha de acción — prácticamente toda la app |
| `scan_symbol_history` | Registro de auditoría "solo cuando cambia algo" por símbolo | `lib/scanHistory.js:211`, desde los crons de escaneo | Ningún consumidor externo detectado hoy — parece ser solo un histórico que se alimenta pero no se muestra en ninguna pantalla (`supabase/schema.sql:1300`) |
| `universe_snapshots` / `universe_snapshot_symbols` | Caché del universo por combinación de mercados | `lib/universeEngine.js:354-374,375-381` | El propio motor de universo, al leer la caché (`lib/universeEngine.js:329-352,338`) |
| `symbol_resolutions` | Resolución de un ISIN europeo a un símbolo/ticker negociable | `lib/shadowUniverseStore.js:261`, desde los crons "sombra" de Europa | Los mismos crons sombra, para no repetir resoluciones |
| `shadow_instruments` | Catálogo de instrumentos europeos descubiertos antes de tener ticker resuelto | `lib/shadowUniverseStore.js:242` | Los crons sombra, para decidir qué resolver a continuación |
| `app_settings` | Almacén genérico de configuración (cursor del cron, caché de salud de mercado, caché de fichas) | Casi todos los crons y algunas rutas de API | Mismos consumidores, para leer su propio estado guardado |
| `favorites` | Tu lista de seguimiento, con una foto del estado en el momento de añadir | `app/api/favorites/route.js:196`, `app/api/cron/favorite-snapshots/route.js:113` | Pantalla de favoritos |
| `provider_runs` | Registro de cada ejecución de cada job/cron, con su resultado | Todos los jobs, al empezar y al terminar | Panel de salud del sistema (`app/api/mvp-health/route.js:34`) |

Todas estas tablas tienen activada la seguridad a nivel de fila (RLS) en
Postgres, pero **sin ninguna política propia definida** — en la práctica,
esto significa que el control de acceso real no depende de RLS, sino de que
toda la aplicación use una clave de servicio con permisos totales solo en el
backend, nunca en el navegador (comentario explícito del propio esquema:
`supabase/schema.sql:1574-1575`). Esto es coherente con que hoy solo existe
un usuario (`owner_id: "personal"`) — es una de las condiciones que
`docs/adr-hito-1b-diferido.md` marca como señal para revisar antes de tener
un segundo usuario real.

### C.2 — `raw` frente a `metrics`

Cada fila de `scan_results` guarda la misma información calculada **dos
veces**, en dos columnas de tipo JSON:

- **`raw`** es casi toda la fila calculada, sin filtrar — un volcado casi
  completo de lo que produjo `buildResearchRow` más el resto del cálculo
  (`lib/materializedScanner.js:1638`, `raw: preparedRow`). En una muestra
  real de producción, `raw` tenía **258 claves** distintas.
- **`metrics`** es un subconjunto elegido a mano y con nombres explícitos,
  pensado para lecturas más baratas (listados, filtros, agregaciones) sin
  tener que traer la fila entera. En la misma muestra, `metrics` tenía
  **200 claves** (`docs/proyeccion-metrics-2026-08-05.md`, consulta contra
  `scan_results` del 2026-08-04, símbolos `RUS.TO`/`CU.TO`).

Existen porque no es lo mismo necesitar reconstruir una fila completa (la
página de detalle de un scan, la ficha de una acción) que necesitar filtrar
o rankear miles de filas rápido (leaderboards, comparables) — pero el
criterio de qué campos entran en `metrics` y cuáles no **no está
documentado en ningún sitio del código**: es una lista escrita a mano
(`scanDecisionMetrics`, `lib/scanDecisionProjection.js:10-91`) sin ADR ni
comentario que explique por qué esos campos sí y esos otros no. Se comprobó
que el tamaño no es la explicación real — `metrics` pesa un 72% de `raw` en
bytes, y buena parte de ese ahorro viene de excluir un solo campo pesado
(`chartPreview`, el histórico de precio embebido), no de las decenas de
campos pequeños que también quedan fuera.

En la práctica, casi toda la aplicación lee la fila ya "aplanada" (con
`raw` sobreescribiendo lo que falte en `metrics`, patrón visible en
`lib/leaderboards.js:368-375`), así que la ausencia de un campo en
`metrics` casi nunca se nota hoy. La excepción real y ya corregida es
`marketCap`: no estaba en la lista de `metrics` en absoluto, así que
`metrics.marketCap` salía `null` en el 100% de las filas de producción
muestreadas, aunque el valor correcto sí viajaba dentro de `raw`
(corregido el 2026-08-07, commit `e726c30` — ver
[D.2](#d2--qué-se-arregló-en-los-últimos-días)). Quedan entre 70 y 188
campos más en la misma situación (según de qué camino venga la fila), sin
que ningún consumidor activo los lea hoy desde `metrics` — es un riesgo
latente, no un problema visible ahora mismo.

### C.3 — Las cachés

| Qué se cachea | Dónde vive | Cuánto dura | Qué pasa si falla |
|---|---|---|---|
| Universo por combinación de mercados | Memoria del proceso, luego Supabase (`universe_snapshots`) | 6h en memoria; 24h en Supabase (48h para el cron de escaneo) | Reconstruye desde las fuentes oficiales en vivo — lento (~34s), nunca bloquea la app (`lib/universeEngine.js:438`) |
| Velas de precio, camino interactivo | Memoria del proceso (`lib/marketData.js`) | 6h (diario) / 5 min (intradía) | Vuelve a pedir a Yahoo; sin persistencia entre reinicios |
| Velas de precio, camino de cron | Tabla Supabase `daily_bars` | 5 días | Sirve la versión vieja como respaldo si el proveedor en vivo falla, marcándola como "stale-fallback" |
| Fundamentales, camino interactivo | Memoria del proceso | 24h | Vuelve a pedir a Yahoo |
| Fundamentales, camino de cron | Tabla Supabase `fundamental_snapshots` | 14 días | Igual que arriba, con caída a versión vieja si falla el proveedor en vivo |
| Salud de mercado (Market Health) | `app_settings` (tipo `market_health_cache`) | 4h | Sirve la versión vieja marcándola como desactualizada, o un estado "neutral" si no hay nada guardado |
| Ficha de una acción (company-brief) | `app_settings` (tipo `company_brief_cache`) | 1 día | Recalcula todo en vivo |
| Leaderboards materializados | Tablas `leaderboard_snapshots`/`leaderboard_items` | 1 día (refresco diario por cron) | Sirve lo último disponible, sin importar su antigüedad exacta |

Un detalle que conviene recordar: las cachés de precio y de fundamentales
del camino interactivo y del camino de cron **no se comunican entre sí** —
son cuatro mecanismos independientes (dos en memoria, dos en Supabase), así
que refrescar el dato por un camino no refresca el otro.

---

## Parte D — Lo que está roto o a medias

### D.1 — Lo que ya sabías (auditorías del 2026-08-04)

`docs/sesion-2026-08-04-indice.md` es, en sí mismo, un índice de auditoría
cruzada sobre seis documentos previos de la misma sesión. Su conclusión
general: la mayoría de las cifras de esos seis documentos sobre capacidad
del cron (símbolos por noche, minutos por mes, cuántos símbolos "candidatos"
existen) **no son comparables entre sí** porque miden cosas distintas con
metodologías distintas, y varias fueron corregidas o descartadas por
documentos posteriores dentro de la misma sesión. Los puntos que siguen
vigentes hoy, verificados de nuevo en esta sesión:

- El universo total elegible (23 mercados sumados) es **11.123** símbolos,
  no 8.998 como decía el primer documento de esa serie — la corrección ya
  está incorporada en `docs/limites-cron-2026-08-04.md`.
- El cron procesa entre 12 y 24 símbolos por corrida, y la causa real no es
  que el análisis en sí sea lento (0,044-0,095 s/símbolo en banco de
  pruebas local) sino un coste fijo de unos ~34 segundos por invocación que
  no depende de cuántos símbolos se analicen — reconstruir el universo desde
  cero y leer hasta 5.000 filas de escaneos recientes, ambas cosas
  seriales — dentro de un límite duro de 60 segundos por corrida
  (`docs/limites-cron-2026-08-04.md`, Parte A).
- El registro de señales (`SIGNAL_REGISTRY`) tiene 18 entradas, no 20 ni 21
  — confirmado por conteo directo y por historial de git desde que el
  archivo existe (`docs/contrato-senales-2026-08-04.md`).
- El Hito 1B (infraestructura de base de datos para ejecuciones concurrentes
  de scan) se apartó del esquema activo porque el problema que resuelve
  —arbitrar dos ejecutores compitiendo por el mismo scan— no existe hoy: hay
  un solo `owner_id`, cero usuarios concurrentes
  (`docs/adr-hito-1b-diferido.md`).

### D.2 — Qué se arregló en los últimos días

Verificado leyendo el diff real de cada commit (no solo su mensaje) y, en
dos casos, confirmando el efecto contra datos reales de producción.

**1. El cron de escaneo ya no reconstruye el universo en cada corrida
(commit `6f22087`, 2026-08-04).** El problema: cada uno de los 7 grupos de
mercados del cron pedía la caché de universo con su propia combinación de
mercados, pero solo el cron de universo escribe esa caché, y siempre con la
combinación de 8 mercados de `CRON_UNIVERSE_MARKETS` — ninguna clave
individual de grupo coincidía nunca, así que cada corrida reconstruía el
universo entero desde las fuentes oficiales (~34 de los 60 segundos
disponibles). El arreglo: cuando los mercados de un grupo son un
subconjunto de los 8 mercados del cron de universo, pide la instantánea
combinada y la recorta después. **Confirmado en producción**: la corrida
del grupo `core-us-hk-au` del 2026-08-06 muestra `cache.hit: true` — antes
del arreglo, 17 de las 18 corridas medidas tenían `cache.hit: false`
(consulta `provider_runs`, `run_type=eq.cron-scan-refresh`,
`market=eq.US,HK,AU`, `2026-08-06`).

**2. `marketCap` ausente dejó de fabricarse como `0` (commit `5e43f17`,
2026-08-05).** Había cuatro sitios distintos en el código que convertían un
`marketCap` ausente en `0` en vez de dejarlo vacío, y uno de ellos
"contaminaba" a los demás por cómo funciona la función que elige el primer
valor válido entre varias fuentes. Un `marketCap` de `0` fabricado se
comportaba igual que una empresa real con capitalización cero frente a
cualquier filtro numérico de capitalización mínima — un caso real detectado
en producción antes del fix fue el rechazo de `MAL.TO` con el motivo "market
cap bajo 0", pese a que ese símbolo sí tenía capitalización real en fechas
anteriores. Los cuatro sitios se corrigieron para devolver `null` en vez de
`0`.

**3. `marketCap` ya se guarda dentro de `metrics`, no solo dentro de `raw`
(commit `e726c30`, 2026-08-07).** Bug relacionado pero distinto al
anterior: la función que decide qué campos entran en la columna `metrics`
no incluía `marketCap` en su lista — así que `metrics.marketCap` salía
`null` en el 100% de las filas de producción muestreadas, aunque el dato
correcto sí viajaba dentro de `raw`. No rompía nada visible hoy porque
todos los consumidores activos leen `raw`, pero era un contrato roto
silencioso para cualquier lector futuro que confiara solo en `metrics`.

**4. `objectiveScore` dejó de ser un calco exacto de `totalScore` — en el
código, con una limitación real pendiente (commit `b51d1b4`,
2026-08-07).** Este es el más importante de entender bien, porque el
arreglo está aplicado pero **todavía no se puede ver reflejado en
producción**. La causa del bug: la fase de "finalización de percentiles"
pasaba el mismo dato de entrada a las dos fórmulas que deberían diferir (ver
[B.5](#b5--totalscore-objectivescore-y-compositescore)), así que las 20
filas finalizadas revisadas en producción tenían ambos valores idénticos
hasta el decimoquinto decimal. El código ya está corregido para pasar el
dato correcto a cada fórmula — pero ese dato correcto (`objectiveSetupScore`)
todavía no llega hasta esa fase, porque la función de base de datos que
alimenta la finalización (`scan_finalize_inputs`) no lo proyecta todavía.
Mientras esa función no se actualice, el resultado en producción sigue
siendo el mismo que antes del fix — verificado en esta misma sesión: no
existe ninguna fila con `percentileScope: "final"` posterior al
2026-08-05 en la base de datos (el fix es del 2026-08-07), así que no hay
todavía ningún caso real donde comprobar si el arreglo se manifiesta.

### D.3 — Qué sigue abierto

Ninguno de los cuatro arreglos anteriores toca lo siguiente — sigue
exactamente como estaba documentado el 2026-08-01/04:

- **El cron de escaneo nunca aplica el filtro de preset** — cualquier fila
  que la UI rechazaría por preset (`balanced` u otro) puede quedar guardada
  igual por el cron, porque `runMaterializedScan` no le pasa ningún preset a
  `applyScreenerFilters` (`docs/equivalencia-pipelines-2026-08-01.md:283`,
  severidad "Alta" en ese documento).
- **`ipoScore` sigue sin calcularse en el camino de cron** — divergencia ya
  descrita en [A.4](#a4--etapa-4-señales-y-puntuaciones).
- **`weaknessScore` sigue teniendo dos implementaciones distintas** — la
  canónica (`lib/scoringEngine.js:86-132`, ~15 factores) y una paralela más
  simple (`lib/stockRows.js:252-269`, 5 factores) que producen números
  distintos para la misma fila cuando el dato no viene ya calculado.
- **Los grupos europeos del cron de escaneo siguen sin acertar la caché de
  universo**, por una causa distinta a la ya arreglada: su antigüedad
  máxima permitida es 48 horas, pero la rotación de 7 grupos hace que a cada
  uno le toque cada ~7 días — su instantánea llega con 72-96 horas y se
  descarta por vieja siempre. Esto quedó anotado como pendiente en el propio
  mensaje del commit `6f22087`, sin resolver todavía.
- **El fallo recurrente del grupo `GB` de Europa "sombra"** — verificado de
  nuevo en esta sesión: la corrida del 2026-08-04
  (`id: f5bf5c5e-...`, `market_regime: batch-cache`) tiene `row_count: 0` y
  `progress.status: "failed"`, pero `errors: 0` — un fallo total que no se
  refleja como error contado, detectado incidentalmente en
  `docs/yahoo-401-crumb-2026-08-05.md` y nunca investigado a fondo.
- **El mecanismo de "paridad de esquema" está desactivado a propósito**
  desde que el Hito 1B se apartó del esquema activo — dos pruebas quedan en
  rojo de forma deliberada porque las migraciones del Hito 1B siguen en
  `supabase/migrations/` pero ya no están en el `schema.sql` que se
  despliega. La pregunta de qué debería significar "paridad" en ese caso
  queda sin decidir (`docs/adr-hito-1b-diferido.md`, sección "Estado de la
  verificación tras el push").
- **La decisión de qué otros campos añadir a `metrics`** (más allá de
  `marketCap`, ya resuelto) sigue pendiente — hay una lista priorizada en
  `docs/proyeccion-metrics-2026-08-05.md` sin decisión tomada.

### D.4 — Si ves esto, sospecha

Señales que puedes reconocer sin leer código, con lo que probablemente
significan según todo lo anterior:

- **Un escaneo que devuelve 0 resultados con `errors: 0`** — no asumas que
  no había símbolos que analizar; el ejemplo real del grupo `GB` muestra que
  un pipeline puede fallar por completo sin que el contador de errores se
  entere. Antes de descartar el mercado por "no hay nada ahí", comprueba si
  la corrida en sí terminó en estado `failed`.
- **Un `marketCap`, `sector` o `industry` vacío en una fila que sí tiene
  precio e histórico** — es consistente con un fallo de autenticación de
  Yahoo en la parte de fundamentales (que no requiere que el precio también
  falle, son fuentes independientes) o con que la fila venga vía `metrics`
  en vez de `raw` sin que ese campo esté en la lista curada de `metrics`.
- **`objectiveScore` idéntico a `totalScore` hasta muchos decimales, en
  filas con `percentileScope: "final"`** — según lo explicado en D.2, esto
  sigue pasando hoy incluso después del fix del 2026-08-07, porque el dato
  necesario todavía no llega hasta esa fase.
- **`rsGlobalPct` vacío en un escaneo pequeño (pocos símbolos)** — no es un
  error, es la protección de muestra mínima de 20 símbolos funcionando
  ([B.4](#b4--qué-es-un-percentil-de-universo)).
- **La ficha de una acción y el screener mostrando un número de RS
  distinto para el mismo símbolo** — es esperable, no un bug: calculan el
  RS con algoritmos distintos (ver la tabla de
  [A.6](#a6--etapa-6-cómo-llega-a-las-pantallas)); solo un campo se
  comparte entre ambos, y puede venir de un escaneo de fecha distinta.
- **Un motivo de rechazo tipo "market cap bajo 0" o "cobertura baja 0" en
  los datos de un escaneo** — antes del 2026-08-05 esto casi siempre
  significaba dato ausente disfrazado de dato real; después de esa fecha
  debería significar un rechazo genuino por un valor real bajo, pero sigue
  mereciendo verificación puntual dado el patrón de bugs de este tipo en el
  historial reciente.
- **Dos crons distintos escribiendo el mismo `scan_id` a la vez** — según el
  ADR del Hito 1B, esto es estructuralmente imposible hoy (un solo
  `owner_id`, ejecución en serie); si algún día lo ves, es la señal exacta
  de que hay que reactivar esa infraestructura apartada
  ([D.3](#d3--qué-sigue-abierto), ver también
  `docs/adr-hito-1b-diferido.md` sección 6).

---

## Parte E — Preguntas abiertas

Decisiones de diseño reales, sin resolver, que condicionan el resto del
sistema. No se resuelven aquí — se explica qué está en juego en cada una.

**1. ¿Se implementa la regla de universo de Twelve Data que describe
`AGENTS.md`, o se actualiza `AGENTS.md` para reflejar lo que el código
realmente hace hoy?** Hoy hay una discrepancia real entre gobernanza
documentada y comportamiento en producción ([A.1](#a1--etapa-1-el-universo)).
Mientras esto no se decida, cualquier persona (o modelo de IA) que lea
`AGENTS.md` para entender el universo llegará a una conclusión incorrecta
sobre de dónde salen los símbolos.

**2. ¿Se arregla el cron actual, o se migra a una arquitectura de ventana
larga (GitHub Actions u otra)?** `docs/limites-cron-2026-08-04.md` deja
esto explícito: arreglar los problemas conocidos del cron (caché de
universo — ya hecho en parte — y lectura acotada de escaneos recientes)
probablemente recupere algo de margen, pero ni con eso el cron actual
(limitado a 60 segundos por invocación) puede cubrir el universo elegible
completo (11.123 símbolos) en un plazo de días en vez de más de un año. Lo
que está en juego: cuánto esfuerzo de ingeniería vale la pena invertir en la
arquitectura actual frente a construir una nueva.

**3. ¿Se aplica el filtro de preset también en el cron?** Hoy el cron
guarda filas que la UI interactiva rechazaría. Aplicarlo tiene un coste
(más trabajo por corrida, dentro de un presupuesto de tiempo ya ajustado) y
un beneficio (coherencia entre lo que el cron guarda y lo que el usuario
vería si escaneara lo mismo a mano). No aplicarlo mantiene el problema de
que "lo que hay guardado" no siempre es "lo que pasaría el filtro hoy".

**4. ¿Qué campos deberían estar en `metrics` y cuáles no?** No hay un
criterio documentado, y la lista actual excluye campos con uso real
verificado (`docs/proyeccion-metrics-2026-08-05.md`). Mientras esto no se
decida explícitamente, cada campo nuevo que alguien necesite desde
`metrics` requiere descubrir el problema por casualidad, como pasó con
`marketCap`.

**5. ¿Cuándo se reactiva el Hito 1B?** El propio ADR que lo apartó
(`docs/adr-hito-1b-diferido.md`, sección 6) deja cuatro señales concretas y
observables para decidirlo: más de un `owner_id` real escribiendo scans,
ejecuciones solapadas del mismo `scan_id`, escrituras parciales observadas
en producción, o concurrencia real entre el cron y una ruta interactiva
sobre el mismo scan. Ninguna se cumple hoy — la pregunta abierta no es "si"
sino "quién vigila esas señales y cuándo se revisa esta decisión otra vez".

**6. ¿Se conecta un segundo proveedor de universo (o se completa la
cobertura oficial para los mercados que hoy solo tienen lista curada)?**
Mercados como Canadá, Singapur o Sudáfrica dependen hoy enteramente de una
lista de símbolos escrita a mano, sin ninguna fuente dinámica que la
mantenga al día. Esto es una decisión de alcance/inversión, no un bug.

---

## Lo que no he podido verificar

- **Por qué el 401 "Invalid Crumb" de Yahoo se observó en algún momento
  real**, si el flujo de autenticación replicado en esta sesión (y en
  `docs/yahoo-401-crumb-2026-08-05.md`) funcionó dos veces seguidas sin
  fallo. Puede haber sido un fallo transitorio ya resuelto, un problema del
  entorno de esa verificación concreta, o un error en cómo se construyó esa
  petición original — ninguna de las tres hipótesis está confirmada.
- **Cuánto pesa cada fase del coste fijo de ~34 segundos por corrida del
  cron** (reconstrucción de universo frente a lectura de escaneos
  recientes frente a arranque en frío de la función) — requeriría logs de
  producción con desglose por fase, que no están disponibles en este
  entorno de solo lectura.
- **Si las tres corridas de cron que quedaron con `status: "started"` para
  siempre son timeout de `maxDuration` específicamente**, frente a otra
  causa de muerte del proceso — es la explicación más consistente con el
  código, pero no hay acceso a logs de Vercel para confirmarlo.
- **Si `projection=decision` (un modo de lectura de `scan_results` que
  depende solo de `metrics`, en `app/api/scans/route.js:383`) tiene algún
  consumidor real** fuera de este repositorio (un cliente móvil, una
  integración externa) — no se encontró ningún llamador interno, pero eso
  no descarta uno externo.
- **Qué pantallas de la interfaz, si alguna, muestran `fundamentalCoverageScore`
  al usuario** — no se investigó específicamente en esta sesión.
- **El comportamiento del sistema bajo concurrencia 4 u 8 en el cron
  real** — el techo configurado hoy es 3, así que no existe ningún dato de
  producción a esas concurrencias; los benchmarks disponibles solo cubren
  ráfagas cortas en un entorno local.
- **Si existen filas de producción que hayan pasado por el pipeline
  interactivo "pelado" (`serverScanRunner.js`, con solo 77-78 claves en
  `metrics`, en vez de las 200 del cron)** fuera de la ventana muestreada —
  no se pudo confirmar ni descartar su existencia histórica.
- **El contenido completo del catálogo `/etf` de Twelve Data** mencionado en
  `AGENTS.md` como pendiente de descargar — no se intentó acceder a él en
  esta sesión (no es una fuente conectada al código, solo un documento de
  análisis).
- **Cuántos consumidores reales, y con qué frecuencia, usan
  `lib/stockRows.js:weaknessScore`** (la implementación paralela y
  divergente de deterioro) frente a la canónica en pantallas de producción
  activas — se identificaron los importadores del módulo, pero no se
  verificó el volumen de uso real de cada camino.
