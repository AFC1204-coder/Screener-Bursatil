# Análisis de interfaz — toda la aplicación — 2026-08-14

Base: `codex/statsedge-ui-polish` @ `fce80c2`. Solo análisis; ningún cambio de código.
El gráfico queda fuera (ya diagnosticado en `docs/analisis-grafico-2026-08-14.md`); aquí solo
aparece por cómo encaja con el resto.

## Método (para poder auditar lo que afirmo)

- Sesión de reproducción en navegador contra una instancia aislada: árbol de `fce80c2` exportado
  al scratchpad (`git archive`, sin worktree en el repo), `node_modules` enlazado, servidor propio
  en :3200 con `.env.local` filtrado (sin `STATSEDGE_ACCESS_TOKEN`/`CRON_SECRET`/
  `STATSEDGE_SESSION_SECRET`) — el modo abierto de desarrollo de `lib/internalAuth.js:56`. No
  toqué el servidor del dueño (:3000) ni el de la sesión del gráfico (:3100); no ejecuté scans;
  no escribí en Supabase (navegar produce las escrituras de caché operativa normales del propio
  servidor, igual que en uso normal).
- Recorrido interactivo de las ocho pantallas servidas: `/` (screener con el snapshot nocturno de
  2.531 acciones restaurado, 500 visibles), `/stock/DELL`, `/lists`, `/sectors`, `/market-health`,
  `/research-desk`, `/review`, `/ipo-radar`. Interacciones probadas en el screener: selector de
  periodo, cajón «Más filtros», panel avanzado, botón «Revisar» y su modal, cola de revisión.
- Lectura de código de las superficies: `ScreenerShell.jsx`, `lib/screenerColumns.jsx`,
  `app/page.jsx`, `StockClient.jsx` (parcial), `useQuickReviewSession.js`, `lib/decisionProfile.js`,
  `lib/rsCanonical.js`, `lib/listRationale.js`, `lib/metricCatalog.js`, `BottomNav.jsx`,
  `layout.jsx`.
- Dos barridos sistemáticos delegados (formateo numérico y vocabulario de UI) sobre todo `app/` y
  los `lib/` que generan strings; sus citas están verificadas por muestreo contra el fichero
  (todas las que uso aquí las comprobé línea a línea o contra la pantalla en vivo).
- Nota de método: el panel de navegador embebido deja de repintar cuando está oculto
  (`visibilityState: "hidden"`), así que las verificaciones con scroll se hicieron contra el DOM
  (posiciones, estilos computados, texto), no contra píxeles. Ningún hallazgo de este documento
  depende de un pantallazo con scroll.

Etiquetas: **[REPRODUCIDO]** lo vi en el navegador contra datos reales; **[CÓDIGO]** afirmación
sostenida en lectura de código con cita literal; **[INFERIDO]** mecanismo derivado, no trazado
en runtime.

---

# PARTE A — Recorrer y juzgar

## A0. El resumen en una frase

La pantalla principal está rediseñada de verdad y las otras seis no: **el producto nuevo (siete
columnas, dato ausente honesto, un solo RS) convive con el producto viejo (quince columnas,
veredictos, auditoría, "Objetivo") a un clic de distancia**, y el vocabulario que el principio 1
prohíbe no se borró — se dejó de renderizar en una pantalla y sigue vivo en las demás y en cada
modal.

## A1. Screener (`/`) — la única pantalla que ya es el producto

**Qué decisión ayuda a tomar:** «de estas N que pasan el filtro, cuáles merecen ficha». La tabla
de siete columnas responde exactamente eso y está bien construida — es la referencia contra la
que juzgo el resto.

**Lo que funciona y conviene proteger [REPRODUCIDO]:**

- Las siete columnas del principio 7, definidas en un solo sitio (`lib/screenerColumns.jsx:113-242`)
  con leyenda por cabecera, miniatura en la celda de ticker, y guion+icono para el dato ausente.
- El selector global de periodo: al pulsar 6M la cabecera pasa a «REND. 6M», la ordenación le
  sigue («Ordenar: Rendimiento 6M») y la tabla se reordena. Es el principio 7.5 implementado tal
  cual se escribió.
- La ordenación solo ofrece criterios de columnas visibles (`screenerSortOptions`,
  `lib/screenerColumns.jsx:256-266`) — «ordenar por algo invisible deja de ser posible».
- El filtro «Resolución» de la decisión de 2026-08-12 existe y está en la barra de resultados.

**Lo que se rompe o sobra:**

1. **El H1 de la pantalla principal es «Global Leaders», cableado e inmutable** [CÓDIGO]
   (`app/components/screener/ScreenerShell.jsx:300`):
   ```jsx
   <h1 className="title">Global Leaders</h1>
   ```
   En inglés, y además falso según el estado: con el preset «Deterioro técnico» activo la pantalla
   seguiría titulando «Global Leaders» sobre una lista de valores en derrumbe. Dos líneas más
   abajo el eyebrow de la tabla dice «Results» (`:560`) encima de «233 resultados» — inglés y
   español en líneas contiguas.

2. **«Avanzado · 50 cambios» nada más abrir la aplicación** [REPRODUCIDO]. Sin tocar nada, el
   badge del panel avanzado anuncia 50 cambios sobre el preset. Mecanismo [INFERIDO del código]:
   `advancedChangeCount` (`app/page.jsx:374-385`) compara los settings vigentes con
   `settingsForPreset(presetKey)` a pelo; al restaurar el snapshot nocturno,
   `restoreSnapshot` aplica `settingsForPreset(key, scan.settings)` (`app/page.jsx:403`), y los
   settings persistidos del scan difieren del preset base en ~50 claves. El usuario no ha cambiado
   nada y el producto le dice que ha cambiado 50 cosas. El badge mide «distancia al preset», no
   «cambios del usuario», y esa diferencia lo vuelve ruido.

3. **La jerga interna sigue en la superficie de arranque** [REPRODUCIDO]. La primera sesión
   muestra, por este orden: «Cargando último snapshot guardado...», el banner «SNAPSHOT
   INCOMPLETO — Se muestran 500 de 2531 acciones de este escaneo; el resto no se cargó por el
   límite de tamaño de la restauración», y el desplegable «MUESTRA PARCIAL · PERCENTIL POR LOTE».
   «Snapshot», «restauración» y «percentil por lote» son vocabulario de arquitectura. La
   información es legítima (principio 3: muestra parcial se declara); el idioma no lo es. Nótese
   que el propio código ya sabe traducir: la fila del RS ausente dice «no está en el ranking
   semanal», no «no está en rs_weekly_items».

4. **El botón «JSON audit» exporta una herramienta de desarrollo desde la cabecera de resultados**
   [CÓDIGO] (`ScreenerShell.jsx:568`):
   ```jsx
   <button ... title="Exportar JSON compatible con audit:decisions">JSON audit</button>
   ```
   El `title` filtra el nombre de un comando interno (`audit:decisions`). Junto a él, «Reset
   sesión» (híbrido inglés-español) y «Guardar» (snapshot). La fila de acciones de la tabla mezcla
   la acción de usuario (CSV) con la de desarrollador (JSON audit).

5. **El tercer KPI de la barra lateral nace muerto** [REPRODUCIDO]. `universo / pasan / score`
   muestra «- SCORE» hasta que exista `marketHealth` (`ScreenerShell.jsx:343`), que solo se carga
   al ejecutar un scan. En la misma sesión, `/market-health` mostraba «98 MARKET SCORE». El mismo
   dato: una pantalla lo tiene y la otra enseña un guion — no por ausencia real, sino porque cada
   pantalla carga el suyo.

6. **El panel avanzado reintroduce el idioma que la tabla acaba de limpiar** [REPRODUCIDO]. Dentro
   de «Configuración avanzada»: capas «Trend», «Momentum», «Short Float», toggle **«Stage 2»**
   (`ScreenerShell.jsx:425`) — la misma clasificación que la columna de al lado llama «Etapa 2» —,
   «Media rapida semanal» sin tilde (`:420`), «Auditoria de filtros» sin tilde (`:461`), campos
   «Up/Down volume 50d min» y «Volume Effect min» (`lib/screenerFilterCatalog.js:225`). El embudo
   de diagnóstico dentro («Puerta Tendencia», «filtros duros», «regimen», «post», «vista») es
   telemetría interna. Está plegado por defecto — bien —, pero es la mitad del scroll de la
   barra lateral cuando se abre.

7. **El buscador hace cuatro cosas y no dice cuáles** [REPRODUCIDO]. El placeholder «Ticker,
   nombre, sector, subsector o pais...» (`ScreenerShell.jsx:486`, sin tilde) admite además país y
   temática, y según lo que resuelva cambia mercados, recarga universo o pinta una tarjeta de
   vista rápida. Potente, pero el coste de un resultado inesperado (cambiar la selección de
   mercados por una búsqueda) no está señalizado.

8. **Menor:** «-0.0%» como distancia a máximos [REPRODUCIDO] (MDB, VCTR): el signo negativo sobre
   un cero. `pct` formatea el valor crudo sin normalizar el cero (`lib/formatters.js:5-7`).

**Lo que falta que un operador de tendencia esperaría:** nada estructural en la tabla misma — las
siete columnas son las correctas y la maqueta aprobada (raíl de vistas + cajón de filtros) ya
recoge la evolución pendiente. Las dos ausencias reales (distancia al pivote y semanas de base)
están aplazadas a sabiendas por el principio 7 y no las cuento como fallo: la ficha hoy enseña por
qué (ver A2.4).

## A2. Ficha del valor (`/stock/[symbol]`) — el veredicto expulsado de la tabla vive aquí

**Qué decisión ayuda a tomar:** «¿merece esta acción mi capital y mi atención?». Es la pantalla
con más información útil del producto — lectura técnica, fundamentales por trimestre, RS
completo, noticias — y a la vez la que más de frente contradice el principio 1.

1. **El elemento más prominente de la ficha es una orden del sistema** [REPRODUCIDO]. La esquina
   superior derecha muestra el chip «DECISIÓN — AUDITAR — ETAPA 2» (DELL). El diccionario está en
   `StockClient.jsx:82-89`:
   ```jsx
   const decisionLabel = decision === "vigilar" ? "Vigilar"
     : decision === "auditar" ? "Auditar"
     : decision === "sin-dato" ? "Sin dato" : "Descartar";
   ```
   «Vigilar / Auditar / Descartar» son exactamente las palabras que el principio 7 eliminó de la
   tabla («El VEREDICTO y toda la maquinaria de fiabilidad de la fila — "Revisar datos",
   "Vigilancia", "Auditar". Es exactamente lo que el principio 1 prohíbe»). No se eliminaron: se
   mudaron al lugar más visible de la ficha. Debajo, la franja «FRENO — base reciente no
   confirmada» y «SCORE 0 · SETUP 2/5 condiciones · falta: base, contracciones...» completan el
   veredicto. La ficha tiene espacio para el *detalle* (eso dice el principio 7), pero detalle
   descriptivo — no el juicio con verbo en imperativo.

2. **El «Plan de operación» es lo más cerca de asesoramiento que tiene el producto** [CÓDIGO]
   (`StockClient.jsx:691-728`; no visible en DELL porque su gate no lo permite — `:686` —, se
   renderiza cuando el setup es válido):
   ```jsx
   <SignalStat label="Objetivo 2R" value={priceMoney(plan.target2R, currency)} tone="good" />
   <SignalStat label="Objetivo 3R" value={priceMoney(plan.target3R, currency)} tone="good" />
   ```
   Precio objetivo con nombre «Objetivo», en verde, más stop, más calculadora de tamaño de
   posición («Capital de cuenta», «Riesgo por operación %», «Acciones», «Importe posición»). El
   subtítulo «referencia técnica, no recomendación» (`:692`) es el descargo que confirma el
   problema: si hace falta decir que no es una recomendación, es que se lee como una. El
   principio 1 prohíbe expresamente «nombres de campo que sugieran precio objetivo» — y aquí el
   campo se llama Objetivo y es un precio.

3. **La misma página, dos idiomas para la etapa** [REPRODUCIDO]. Cabecera: «ETAPA 2». Sección
   «Metodología y gates» (título con «GATES» en inglés): «ETAPA — Stage 2 probable». El
   diccionario unificado (`lib/stageDisplay.js`, citado en `screenerColumns.jsx:87-94` justo para
   que «la ficha escriba la MISMA palabra que esta celda») cubre el chip de decisión y la lectura
   técnica, pero no la fila de metodología.

4. **El pivote enseña el defecto que el principio 7 predijo** [REPRODUCIDO]. En DELL, «PIVOT
   -4.5%» y «ATH -4.5%» — idénticos. El pivote mostrado es la línea de máximos, no el pivote real
   de la contracción final; el doc de principios aplazó la columna de la tabla precisamente por
   esto («hoy el pivote parece ser una línea sobre máximos históricos... Un número falso con
   aspecto de preciso es peor que no tenerlo»). La ficha lo muestra igualmente, con una décima de
   precisión.

5. **El contexto comparativo es una tabla de negaciones** [REPRODUCIDO]. Diez filas × columnas
   ESTRUCTURA/CONTRACCIONES/BASE/PIVOT/VOL. SECO, y en DELL prácticamente cada celda dice «No
   validado», «Sin base validada», «Dato sin validar» — o peor: **«0.0% · 0.0 sem»**, que es un
   dato ausente disfrazado de cero (violación directa del principio 3: «Un dato ausente se muestra
   como ausente, no como cero»). Una tabla donde el 90% de las celdas niega tener dato no informa:
   documenta que el detector no ve nada, fila a fila.

6. **El RS se repite cinco veces con cuatro etiquetas** [REPRODUCIDO]: franja de calidad («RS — 09
   ago 2026 · n=4868»), cabecera del gráfico («RS global 98»), lectura técnica («RS 98 · RS
   QUALITY 84»), y el panel Fuerza relativa («RS GLOBAL 98 · RS PAIS 99 · GRUPO Sin dato! · RS
   BENCH 93P · RS QUALITY 84P» — «PAIS» sin tilde viene de `lib/metricCatalog.js:38`). El sufijo
   «P» de percentil no se explica en ningún sitio. El tamaño de muestra `n=4868` aparece dos veces
   en la misma pantalla, contra el principio 5 («ni tamaños de muestra repetidos»).

7. **Números con tres convenciones en la misma cabecera** [REPRODUCIDO]: «490,99 USD · -3,52
   (-0.7%)» — precio y variación con coma es-ES (`priceMoney`/`signedPriceMoney`,
   `StockClient.jsx:406-414`), porcentaje con punto (`pct` local, `:387`). Y las cabeceras de la
   tabla de fundamentales son ISO crudo («2026-05-01») junto a celdas ya formateadas. El detalle
   completo del formateo va en B4.

8. **La navegación entre valores (cosa nº 4 de «las cinco cosas») no existe desde la tabla**
   [REPRODUCIDO + CÓDIGO]. Abriendo la ficha directamente no hay Anterior/Siguiente; el raíl
   existe (`StockReviewFlowRail`, `StockClient.jsx:733-796`) pero solo se alimenta del estado de
   la cola de Review en localStorage (`syncReviewNavigation`, `:1649-1653`, lee
   `STORAGE_KEYS.review`). Es decir: el flujo esencial «entrar en una acción y pasar a la
   siguiente» está acoplado a la maquinaria de cola de revisión — para tenerlo hay que pasar por
   «Revisar», que reordena la lista según el criterio del sistema (ver A7). La función de
   navegación fluida existe; la propiedad de «sin volver atrás» desde la tabla ordinaria, no.

9. **La ficha compartible (cosa nº 5) no existe** [REPRODUCIDO]. No hay ningún control de
   compartir/exportar imagen en toda la ficha. Es la pieza que los principios llaman
   «distribución» y de las cinco cosas es la única completamente ausente del producto.

**Qué sobra:** el bloque de decisión entero en su forma actual (chip Auditar + Freno + mesa de
observación con checklist «Criterio propio: Obligatorio»), el panel social/sentimiento de
titulares con «sesgo heuristico» (sin tilde) y clasificaciones ALCISTA/NEUTRAL por titular, y la
tabla comparativa mientras el detector no valide nada. Con quitar el juicio y dejar el dato, la
ficha queda —el contenido informativo de debajo es bueno.

## A3. Listas (`/lists`) — el producto viejo, intacto

**Qué decisión debería ayudar a tomar:** «¿qué me enseña hoy el universo precalculado, sin
ejecutar nada?» — la respuesta natural al escaneo nocturno. La pantalla existente no responde a
eso: es la tabla de quince columnas que el screener acaba de abandonar, seis veces seguidas.

1. **Catorce columnas por lista, seis listas apiladas** [REPRODUCIDO]: TICKER · EMPRESA · GRÁFICO
   · TEMA · RS · 3M · 52W · SMA50 · ESTRUCTURA · RUPTURA · RS QUALITY · DETERIORO · RISK ·
   OBJETIVO. Los tres periodos fijos que la tabla nueva sustituyó por el selector; «RISK» y «RS
   QUALITY» en inglés; y **«OBJETIVO» como cabecera** — el caso que el propio
   `docs/principios-producto.md` §1 marca como `REVISAR` («su nombre puede leerse como precio
   objetivo»). Viene de `lib/metricCatalog.js:12-16`:
   ```js
   objectiveScore: { label: "Score compuesto", shortLabel: "Objetivo", ... }
   ```
   El shortLabel es el que se pinta como cabecera aquí, en Sectores y en Research desk.

2. **Cada fila lleva un juicio de dirección** [REPRODUCIDO]: la línea de razón dice «Score
   compuesto 86 · RS 87 · 3M +36.1% · **sesgo largo OK**». «Sesgo largo OK» es una aprobación
   operativa por fila — el equivalente al veredicto retirado.

3. **Dos RS distintos en la misma fila** [REPRODUCIDO — el hallazgo más citable de coherencia]:
   - CON: la frase dice «RS 87», la columna RS dice **91**.
   - ABNB: frase «RS 88», columna **80**.
   - TILE: frase «RS 82», columna **«– Sin dato»**.
   Mecanismo [CÓDIGO]: la columna usa el lector único (`CanonicalRsCell`,
   `app/lists/page.jsx:94-98`, sobre `canonicalRs`), pero la frase se construye en
   `lib/listRationale.js:216` y siguientes con `pushMetric(reasons, "RS", metric(row,
   "rsGlobalPct"))` — el percentil del lote del escaneo. `lib/rsCanonical.js:14-19` define ese
   campo, literalmente, como lo que «NO es el RS y no puede mostrarse bajo esa etiqueta». La
   unificación del RS llegó a las columnas y no a las frases: la pantalla se contradice a un
   centímetro de distancia. (Se repite en Sectores, B1.)

4. **Chips crípticos por fila** [REPRODUCIDO]: «OBJ 0 · P 0 · ! 2 · X 1» en cada fila
   (`RowTrustSignature`). Cuatro letras sin leyenda visible; el principio 2 documentó este mismo
   patrón («Tres valores de RS por fila (G, GRP, Q) sin leyenda visible») y aquí sigue con otras
   letras.

5. **Cabeceras de lista en inglés** [CÓDIGO] (`lib/listRationale.js` LIST_CONTRACTS y
   `app/lists/page.jsx:657-664`): «RS Quality Leaders», «Trend template» (nombre propio de
   metodología, retirado en teoría), «IPO / New Leaders», «Extended but strong», «Pullback to
   SMA50», «Stage 2». Mezcladas con títulos en español («Score compuesto», «Vigilancia pivot»).

6. **Auditoría como contenido principal** [REPRODUCIDO]: cada lista lleva su franja «Fiable ·
   Precio fresco, cobertura suficiente y taxonomía coherente · 20 filas · 0 precio viejo · 0
   cobertura baja · 0 datos limitados · 0 excluidas contrato» — cinco contadores de control de
   calidad, casi siempre a cero, seis veces en la página. Más «Auditoria cobertura» (sin tilde,
   `app/lists/page.jsx:210`) y «Contrato aplicado». El usuario de esta pantalla recibe más
   información sobre el sistema de datos que sobre el mercado.

7. **KPI confuso** [REPRODUCIDO]: «Universo — 62 de 5608» en la franja de calidad. ¿62 de 5.608
   qué? (Son las filas que las listas derivadas traen vs el universo analizado — pero eso no se
   dice.) Al lado, «ULTIMO SNAPSHOT LOCAL» sin tilde y «FUENTE RANKINGS — Datos actualizados».

## A4. Sectores (`/sectors`) — la idea correcta debajo de la capa equivocada

**Qué decisión ayuda a tomar:** «¿dónde está la fuerza por grupos?» — pregunta central del método
(la rotación sectorial de Weinstein, los grupos de O'Neil). El «MAPA DE GRUPOS» con fuerza
compuesta, líderes por grupo y filtro Fuertes/Constructivos/Débiles es la respuesta correcta.
Es la pantalla no rediseñada con más valor por rescatar. Pero:

1. **Violación literal del principio 1** [CÓDIGO] (`app/sectors/page.jsx:174`):
   ```jsx
   <b>Accion recomendada</b>
   ```
   Cabecera del panel de auditoría sectorial (además sin tilde). Es la frase exacta que el
   principio prohíbe usar.

2. **La misma divergencia de RS de Listas** [REPRODUCIDO]: drill-down de Medtech/biotech, CON:
   «Score compuesto 86 · RS 87» en la frase; en la tabla de líderes del mismo grupo, columna RS:
   **91**. Mismo mecanismo (B1).

3. **Sectores contiene a Listas** [REPRODUCIDO]: el drill-down de cada grupo replica las sublistas
   contractuales de `/lists` («Score compuesto — LARGO COHERENTE», «Rupturas con contracción —
   TREND TEMPLATE», «Vigilancia pivot», «Extended but strong», «Pullback to SMA50», «Deterioro
   técnico») con las mismas franjas de fiabilidad y los mismos chips. Dos pantallas mantienen el
   mismo contenido con dos códigos distintos — y divergen ya (los títulos de bloque difieren
   ligeramente entre `lib/listRationale.js` y `app/lists/page.jsx:656-664`).

4. **Tabla de líderes de 17 columnas** [REPRODUCIDO]: TICKER · EMPRESA · PAÍS · TEMÁTICA · SECTOR
   · INDUSTRIA · RS · DETERIORO · 3M · 6M · 52W · SMA50 · ESTRUCTURA · RUPTURA · RISK · OBJETIVO ·
   ACCIONES. Tres columnas de taxonomía redundantes con el propio agrupamiento de la pantalla, y
   la última columna se llama «ACCIONES» (botones Ficha/TV) en una aplicación donde «acciones»
   significa valores en todos los demás rótulos («13 acciones», «500 acciones»). Colisión
   semántica evitable.

5. **Detalles** [REPRODUCIDO]: «GRUPO LIDER» y «GRUPO DEBIL» sin tildes como KPIs; botón de
   dimensión «Tematica» sin tilde (`sectors/page.jsx:556`) mientras la cabecera de tabla de la
   misma página escribe «Temática» (`:606`); «1 acciones» en Defensa/aeroespacial (plural sin
   singularizar); «Drill-down» como título de sección; «Ranking en vivo · 14/8/2026, 21:20:44»
   con `toLocaleString()` sin locale (`:444`) — en un navegador en inglés saldría `8/14/2026`;
   botón «Nuevo scan» que lanza un escaneo desde una pantalla de consulta.

## A5. Salud de mercado (`/market-health`) — la pregunta correcta, la superficie a medio traducir

**Qué decisión ayuda a tomar:** la mejor definida del producto, y lo dice en su subtítulo: «¿Qué
exposición tolera este mercado hoy — y si tolera alguna, dónde está el liderazgo?»
(`app/market-health/page.jsx:619`). Régimen → exposición es la decisión diaria previa a cualquier
otra en el método. La estructura (régimen + estructura + liderazgo + amplitud sectorial) es la
correcta.

1. **La constelación de régimen apila los rótulos** [REPRODUCIDO]: en la curva E1–E4, los tickers
   GSPC/IXIC/RUT/DJI/ACWI caen todos en la misma zona (mercado alcista) y se pintan superpuestos,
   ilegibles — cinco etiquetas en el mismo punto de la curva. El estado «todos los índices en la
   misma etapa» es el estado *normal* de un mercado tendencial, así que el solapamiento no es un
   caso raro: es el caso por defecto.

2. **Mitad inglés, mitad español** [REPRODUCIDO + CÓDIGO]: eyebrow «StatsEdge · Market Health»
   sobre el H1 «Salud de mercado» (`:617-618`); sección «Leadership pulse» (`:747`); KPI «Market
   score». Y dentro de la lista de sectores: «Tecnología, Industriales, Materiales» conviven con
   «Real estate» y «Utilities» sin traducir — el mismo listado, dos idiomas.

3. **Tres cuartas partes del panel global están estructuralmente vacías** [REPRODUCIDO]: Europa,
   Asia/Pacífico y Global/Emergentes muestran «SIN RS — SIN DATO — 0 EN SNAPSHOT — Sin activos
   analizados en esta geografía» porque el snapshot nocturno es solo US. Honesto (principio 3),
   pero como diseño: una sección permanente cuyo 75% dice «no hay nada» cada día no está
   ganándose el sitio; la cobertura real debería dimensionar la sección.

4. **Abreviaturas sin diccionario** [REPRODUCIDO]: «5/5 SOBRE MM30S», «64% SECTORES E2», «3.8/3.1
   DIST/ACC 20D», «Ofensivo E2: 4 · Defensivo E2: 2», «Deterioro 2+». Aquí la etapa se abrevia
   «E2» — cuarta forma de escribir el mismo concepto en el producto (Etapa 2 / Stage 2 / E2 /
   «Base / transicion» en Research desk). Y la media semanal se llama «MM30» mientras la ficha
   dice «MA50/MA200» y el screener «SMA50» y «Media rapida semanal» — cuatro convenciones para
   nombrar medias móviles.

5. **El listado «DETERIORO A REVISAR»** [REPRODUCIDO] es una cola de microcaps rotas (JAGX, VCIG,
   KAPA...) con «9 evidencias · 1 · Deterioro alto, RS débil» — números sin unidad ni leyenda — y
   con los mismos chips OBJ/P/!/X. Un operador de tendencia no extrae nada de ahí; parece la
   salida de un job de control de calidad.

6. **Sentimiento de titulares con lectura contraria** [REPRODUCIDO]: «TITULARES · NEUTRAL — 50 ·
   bajistas 4% · neutrales 83% · alcistas 13%» y la frase «Ruido equilibrado: el precio y la
   amplitud mandan mas que los titulares» (sin tilde en «más»). Si el propio panel concluye que
   los titulares no mandan, el panel se está justificando fuera de la pantalla. Las cinco cosas
   del MVP no lo incluyen.

## A6. Research desk (`/research-desk`) — el banco de trabajo del desarrollador

**Qué decisión ayuda a tomar:** ninguna del operador. Es un cuaderno de laboratorio: snapshots
locales («HISTORIAL DE SCANS», «Exportar scan», «Eliminar scan», «Importar ultimo scan», «Pega
aqui un JSON de filas/candidatas»), watchlist manual vacía, alertas comparativas entre snapshots,
y el «OBSERVATORIO» de vigilancia metodológica del detector VCP.

1. **Tres nombres para la misma pantalla** [REPRODUCIDO]: la navegación dice «Research»
   (`BottomNav.jsx:11`), el H1 dice «Registro y favoritos» (`research-desk/page.jsx:625`), y el
   resto del producto la llama «Research Desk» (botones en `/review:951`, textos en
   `DecisionTraceability.jsx:17`). Subtítulo: «Snapshots, watchlist, notas y seguimiento
   local-first» — tres anglicismos y un término de arquitectura en la línea de presentación.

2. **La tabla pre-rediseño sigue aquí, con el vocabulario pre-unificación** [REPRODUCIDO]:
   «CANDIDATAS DEL SNAPSHOT» tiene 16 columnas (★ · TICKER · EMPRESA · TEMA · STAGE · CAMBIOS ·
   3M · 6M · 12M · ESTRUCTURA · RUPTURA · RS QUALITY · DETERIORO · RISK · OBJETIVO · ACCIONES) y
   su columna STAGE escribe «Base / transicion», «Stage 2 probable», «Debil / mixta» — las
   etiquetas exactas que `lib/stageDisplay.js` se creó para eliminar («antes la tabla decía "Base"
   y la ficha "Base / transición"», `screenerColumns.jsx:89-91`). La unificación de la etapa no
   llegó a esta pantalla. Además «candidatas» como sustantivo del producto.

3. **Números que se contradicen en la misma franja** [REPRODUCIDO]: «CAMBIOS DESDE SNAPSHOT
   ANTERIOR — 24 eventos visibles · **sin comparativo previo** — 270 MEJORAS · 165 DETERIOROS ·
   164 STAGE 2». Si no hay comparativo previo, ¿de qué son las 270 mejoras? [INFERIDO: los
   contadores agregan evidencias del snapshot actual, no cambios; el rótulo dice otra cosa.]

4. **El observatorio VCP** («EC — VCP plan válido — 20.8% -> 9.8% -> 7.3%») [REPRODUCIDO] es
   diagnóstico del detector (secuencias de contracción con flechas ASCII, «Datos no fiables»,
   «Compresión de pivot»). Es útil — para auditar el motor, que es trabajo del dueño, no del
   usuario. Es la misma conclusión que el análisis del gráfico dio para el panel VCP de la ficha.

## A7. Review (`/review`) — la sala de máquinas expuesta como pantalla

**Qué decisión ayuda a tomar:** en teoría, «resolver la cola: candidata / vigilar / descartar».
En la práctica es la auditoría del sistema de decisión, con el operador de espectador.

1. **La cola es «todo el universo», sin criterio de entrada** [REPRODUCIDO]: «Screener actual ·
   500 acciones» mete las 500 filas analizadas — incluidos fondos cerrados (GAM, RA, FAX),
   certificados de trust («Corporate Backed Trust Certificates, Goldman Sachs Capital I
   Securities-Backed Series 2004-6...») y SPACs (QETA, UAC, LAFA) — a la cola de revisión. Revisar
   500 valores uno a uno no es un flujo: es una lista infinita. La cabecera lo resume: «291
   ESPERAR · 209 AUDITAR» — el sistema ya ha decidido por ti qué hacer con cada una; tu trabajo es
   confirmarlo.

2. **Cada tarjeta lleva ~12 chips con abreviaturas inventadas** [REPRODUCIDO]: «OBJ 48 · P 0 · !
   0 · X 0 · Esperar confirmacion · Foco Método · OK · Auditar · **Med.** · **Traz.** · Sin alerta
   principal · PRUEBAS OK 9/9 · Setup objetivo 80 · Setup accionable · Liderazgo global ·
   Contexto sectorial · 67». «Med.», «Traz.», «Rev.», «Bloq.», «Desc.», «Metr.» no existen en
   ningún glosario visible. «Esperar confirmacion» (sin tilde) se repite en prácticamente todas
   las filas — una columna entera del mismo valor no discrimina nada.

3. **El panel de la derecha es la descomposición del ranking interno** [REPRODUCIDO]: «Bloqueadas
   611 · DECISION 660 · ACCION 55 · SCORE OBJETIVO 147 · PERCENTIL LOTE 76 · -480 Sin liderazgo RS
   global · -460 Candidato no operable». Pesos y penalizaciones del algoritmo de priorización, con
   «DECISION»/«ACCION» sin tildes. Es la pantalla de depuración del `reviewPriority`.

4. **Identidad** [REPRODUCIDO + CÓDIGO]: badge «StatsEdge · Rapid Review» (inglés,
   `review/page.jsx:905`) sobre H1 «Vista rapida» (sin tilde, `:906`) — y la pantalla se llama
   «Review» en los botones del resto del producto. Tres nombres, dos idiomas, una tilde perdida.

5. **El mismo flujo existe dos veces** [CÓDIGO]: `/review` (1.149 líneas) y el QuickReviewModal
   del screener (mismo contenido en `<dialog>`, A1) implementan la misma revisión con dos códigos.
   El modal, además, al abrirse desde «Revisar» reordena la cola por la prioridad del sistema
   (`prepareReviewQueueRows`, `lib/decisionProfile.js:137-151`: sort por `REVIEW_PRIORITY_RANK`,
   luego perfil, luego score) — por eso con la tabla ordenada por Rendimiento 6M (DELL primero) el
   modal abre en GAM 1/233 [REPRODUCIDO]. El principio 1 lo dice exacto: «si se ordena por él y se
   destaca el primero, el producto está señalando». La ordenación de la cola ni es elegible ni es
   explícita.

## A8. IPO radar (`/ipo-radar`) — la huérfana

No está en la navegación (`BottomNav.jsx:7-13` lista cinco entradas; `/review` tampoco está) y
solo se llega por botones desde Listas/Research. Es un CRUD manual de IPOs vigiladas, vacío («Sin
IPOs vigiladas todavia»), con la mayor densidad de tildes perdidas del producto («cotizacion»,
«Pais», «Paises Bajos», «Japon», «Sudafrica», «Mexico», «Documentacion presentada», «Anadir IPO»,
«Acciones rapidas», fechas «2026-08-14 · en 3 dias» en ISO crudo — `ipo-radar/page.jsx:61-63`).
Como herramienta personal del dueño tiene sentido; como pantalla del producto, no está terminada
ni conectada (sus altas entran al universo del screener vía `ipoRadarUniverseRows`, pero nada en
el screener te lleva a ella).

---

# PARTE B — La coherencia entre pantallas

## B1. El mismo dato, ¿se muestra igual? El RS: unificado a medias

La infraestructura correcta existe y está bien documentada: `lib/rsCanonical.js` (lector único,
«si una superficie no tiene el ranking semanal, muestra AUSENCIA... Nunca cae al percentil del
lote») y las columnas de screener/listas/sectores/ficha la usan. Pero:

- **Las frases de razón no pasan por el lector** [CÓDIGO]: `lib/listRationale.js:216,222,231,...`
  escribe `"RS " + metric(row, "rsGlobalPct")` — el percentil del lote — en el texto de cada fila
  de Listas y de los drill-downs de Sectores. Resultado [REPRODUCIDO]: «RS 87» y «91» en la misma
  fila (CON), «RS 82» junto a «Sin dato» (TILE). La regla del módulo canónico se viola en la
  línea de al lado de donde se cumple.
- **Salud de mercado añade un tercer RS** [REPRODUCIDO]: «RS 1M vs SPY» (+10.2% — un retorno
  relativo mensual) convive con «RS PROMEDIO 52» (media del ranking canónico) y con el «RS 99» de
  las tarjetas de líderes. Tres números con la misma etiqueta «RS» y tres definiciones.
- **El redondeo difiere** [CÓDIGO]: tabla/listas usan `rs.value.toFixed(0)`
  (`screenerColumns.jsx:174`, `lists/page.jsx:98` — línea duplicada carácter a carácter); la
  ficha usa clamp 0-99 con `Math.round` (`StockClient.jsx:385`). Un RS de 99,6 sale «100» en la
  tabla — contradiciendo su propia leyenda «de 0 a 99» (`screenerColumns.jsx:165`) — y «99» en la
  ficha.

## B2. La etapa: una clasificación, cuatro ortografías

El diccionario único (`lib/stageDisplay.js`) existe y la tabla y el chip de la ficha lo usan. Pero
conviven [REPRODUCIDO en las pantallas citadas]:

| Superficie | Escritura |
|---|---|
| Tabla screener, chip de ficha | «Etapa 2» |
| Toggle de filtros del screener (`ScreenerShell.jsx:425`), chip del rail (`lib/screenerFiltersView.jsx:34`), «Metodología y gates» de la ficha, listas («STAGE 2»), Research desk («Stage 2 probable») | «Stage 2» |
| Salud de mercado | «E2» / «SECTORES E2» / «Ofensivo E2» |
| Research desk (tabla de candidatas) | «Base / transicion», «Debil / mixta» (el vocabulario pre-unificación, sin tildes) |

## B3. La taxonomía sectorial está cruzada entre pantallas

El mismo triplete de datos (grupo temático curado / sector del proveedor / industria del
proveedor) recibe nombres distintos **y cruzados**:

| Pantalla | Grupo curado («Consumer tech / hardware») | Sector proveedor («Technology») | Industria proveedor («Computer Hardware») |
|---|---|---|---|
| Screener (columna + cajón de filtros) | **Tema** | Sector | **Subsector** |
| Sectores (botones de dimensión) | **Temática** | Sector | **Industria** |
| Ficha (Bloque empresa) | **SUBSECTOR** | SECTOR | **INDUSTRIA** |

[REPRODUCIDO con DELL]: lo que el screener llama «Subsector» (Computer Hardware) la ficha lo llama
«INDUSTRIA», y lo que el screener llama «Tema» la ficha lo llama «SUBSECTOR». Un usuario que
filtre por «Subsector» en el screener y luego lea «SUBSECTOR» en la ficha está leyendo dos campos
distintos con el mismo nombre. Además, el desplegable «Tema» del cajón mezcla los temas curados en
español con sectores del proveedor sin mapear en inglés («Basic Materials (4)» como tema)
[REPRODUCIDO], y los niveles Sector/Subsector se ofrecen enteros en inglés («Consumer Cyclical»,
«Banks - Regional») dentro de una UI en español.

## B4. Los números no se formatean igual (y a veces ni dentro de la misma línea)

Confirmado el aviso del encargo, y es peor: no es «screener punto, ficha coma» — es que **cada
pantalla tiene su juego de formateadores locales**. Los casos con impacto visible, todos
verificados en código y casi todos en pantalla:

1. **Punto vs coma en la misma línea de la ficha** [REPRODUCIDO]: «490,99 USD · -3,52 (**-0.7%**)».
   Precio con `toLocaleString("es-ES")` (`StockClient.jsx:406-409`), porcentaje con `toFixed`
   (`:387`). Todos los porcentajes del producto usan punto decimal; todos los precios de la ficha,
   coma. España escribe 490,99 y -0,7%.
2. **Dos funciones llamadas `pct` con contrato distinto** [CÓDIGO]: `lib/formatters.js:5-7` (con
   signo `+`) alimenta screener/listas/sectores/salud/review; la local de la ficha
   (`StockClient.jsx:387`) no pone signo. El mismo `perf3m` sale «+126.5%» en la tabla y «98.4%»
   en la ficha.
3. **El precio del screener pierde céntimos y millares** [CÓDIGO]: `lib/screenerFormat.js:15`
   (`n >= 100 ? n.toFixed(0) : n.toFixed(2)`) — la vista rápida muestra «67.78 USD» o «1235 USD»
   mientras la ficha escribe «1.234,50». Además hay un segundo `money` exportado en
   `lib/formatters.js:29-31` que nadie importa (código muerto con contrato opuesto).
4. **Capitalización: tres implementaciones** [CÓDIGO]: `lib/formatters.js:21-27`,
   `lib/screenerFormat.js:16` (duplicado reconocido en su propio comentario de cabecera) y la de
   la ficha (`StockClient.jsx:400-405`). Para 999.000: tabla «999000», ficha «999.000». Sufijos
   T/B/M anglosajones en todo el producto (nunca «mil M»), sin `Intl.NumberFormat` compacto en
   ningún sitio.
5. **RS con clamp distinto** — ver B1 (99,6 → «100» vs «99»).
6. **Fechas en tres regímenes** [CÓDIGO + REPRODUCIDO]: (a) es-ES con tres máscaras distintas
   («14 ago 2026» QualityStrip, «4 ago 2026» snapshotDisplay sin cero, «ago 14, 21:04» en Salud
   de mercado con el **mes primero** — `market-health/page.jsx:22-26` — frente a «14 ago, 21:04»
   en ficha y Review); (b) `toLocaleString()`/`toLocaleDateString()` **sin locale** en 9 sitios
   (Sectores `:430,444`, Research desk `:647,658,671`, Listas `:790`, `ScreenerShell.jsx:251` —
   dependen del navegador: en Chrome en inglés saldría `8/14/2026`); (c) **ISO crudo** en
   superficie: IPO radar entero («2026-08-14 · en 3 dias»), cabeceras de los estados financieros
   de la ficha («2026-05-01», `StockClient.jsx:1146`), fechas de holders (`:1013`), «lastDate» en
   Salud de mercado (`:890`).
7. **`n=` de la muestra con y sin millares** [CÓDIGO]: Listas escribe
   `n=${...toLocaleString("es-ES")}` → «n=4.868» (`lists/page.jsx:123`); la ficha
   `n=${Math.round(...)}` → «n=4868» (`StockClient.jsx:182`). Ambas alimentan el MISMO componente
   `QualityStrip`, cuyo comentario dice que se extrajo «para que dos superficies no puedan
   escribir la misma fecha de dos maneras». Lo consiguió con la fecha; el `n=` se le escapó.
8. **Números ingleses dentro de frases españolas** [CÓDIGO]: `lib/screenerFilters.js:346-356`
   formatea con `toLocaleString("en-US")` los detalles de reglas («precio 12,345 > SMA50...») —
   coma inglesa de millares que en es-ES se lee como decimal.

La causa raíz es estructural [CÓDIGO]: **no hay una capa única de formato**. `lib/formatters.js`
existe pero cada pantalla grande (ficha, screenerFormat, market-health, review, ipo-radar) define
las suyas, con los mismos nombres (`pct`, `money`, `ratio`) y contratos distintos. Es el
equivalente en formato del problema que `rsCanonical`/`stageDisplay` resolvieron para los datos —
y la prueba de que la solución funciona: donde hay lector único, las pantallas coinciden.

## B5. El vocabulario

1. **Los retiros del principio 1 se hicieron dejando de renderizar, no borrando** [CÓDIGO]. Los
   strings citados por el propio doc de principios como problema («Auditabilidad 100%», «Contrato
   incompleto», «Snapshot íntegro», «Contrato largo degradado») siguen en
   `lib/screenerReliability.js:342-355` y `lib/screenerContracts.js` alimentando componentes que
   ya nadie monta (`AuditabilitySummaryRail`, `ScreenerContractPanel`, `SourceStatusWidget` —
   definidos y exportados, cero usos). El vocabulario prohibido no desapareció: quedó en la
   recámara, listo para volver con cualquier reconexión. Y parte sigue montada: el
   QuickReviewModal renderiza `ScreenerOriginPanel` y `ScoreAuditPanel` con «Score audit»,
   «Trazabilidad de decision», «Candidato no operable», «RANKING Decision +660» [REPRODUCIDO].
2. **Prescriptivo vivo en superficie principal** [CÓDIGO, verificado en pantalla]: «Accion
   recomendada» (`sectors/page.jsx:174`); «Objetivo» como cabecera en tres pantallas
   (`metricCatalog.js:14`); «Objetivo 2R/3R» en la ficha (`StockClient.jsx:707-708`); «Preparar
   entrada» y «Entrada» en la tarjeta de búsqueda (`lib/screenerExplainability.js:702,51`);
   «Esperar confirmacion» como ACCIÓN en modal y Review; «sesgo largo OK» por fila en Listas;
   «Candidata/Candidato» como sustantivo del sistema en seis superficies; «Setup accionable»
   (`lib/screenerMethodologyEvidence.js:188-205`).
3. **Nombres propios de metodología** [CÓDIGO]: «Trend Template» y «Stage 2» como chips pulsables
   del screener (`lib/screenerFiltersView.jsx:34-35`), «Trend template, momentum y máximos» como
   subtítulo en Listas (`lists/page.jsx:660`), «VCP» en ~20 puntos de UI (botón del gráfico,
   «Evidencia VCP» como H2 de la ficha, «planes VCP» como KPI en Listas y Sectores, «Setup/VCP»
   como columna). Weinstein/Minervini sí están traducidos en el catálogo («Estructura»,
   «Ruptura») — la limpieza se hizo donde se buscó y no donde no.
4. **Inglés estructural**: los títulos («Global Leaders», «Results», «Leadership pulse», «Market
   Health», «Rapid Review», «Equity Research» bajo la marca en todas las pantallas —
   `layout.jsx:47`), los nombres de listas (A3.5), las métricas («Composite», «Growth», «Risk»,
   «Short Float», «Volume Effect», «Stage»), y micro-textos («capas off», «local-first»,
   «fallback», «Por que rankea» — anglicismo verbal + tilde perdida,
   `lib/screenerExplainability.js:932`).
5. **Tildes**: el barrido encontró ~80 strings visibles sin tilde o sin ñ. Los de mayor exposición:
   «Vista rapida» como H1 de `/review` (`review/page.jsx:906`) y en botones de cuatro pantallas;
   «Auditoria de filtros» (screener), «Accion recomendada» (sectores), «GRUPO LIDER/DEBIL»
   (sectores), «Anadir a watchlist» y «Anadir IPO» (la ñ), «Si"/"No» por «Sí/No» en tres tablas
   (cambia el significado), y el par revelador de `BottomNav.jsx`: `aria-label="Navegacion
   principal superior"` (`:23`) contra `aria-label="Navegación principal"` (`:40`) — el mismo
   fichero, con y sin tilde. No hay corrector en el flujo de trabajo; la ortografía depende de
   quién escribió la línea.

---

# PARTE C — La estructura

## C1. ¿Son estas siete (ocho) pantallas las correctas? No: son dos productos entrelazados

Lo que hay hoy, clasificado por a quién sirve:

| Pantalla | Sirve al operador | Sirve al dueño/desarrollador |
|---|---|---|
| Screener | ✔ el núcleo | el panel avanzado de diagnóstico, JSON audit |
| Ficha | ✔ análisis por valor | mesa de decisión, score audit, comparables sin validar |
| Listas | los rankings precalculados (la idea) | contratos, fiabilidad, chips de auditoría (la ejecución) |
| Sectores | ✔ el mapa de grupos | drill-down contractual, «Accion recomendada» |
| Salud de mercado | ✔ régimen → exposición | «Deterioro a revisar», auditoría |
| Research desk | — | ✔ entero (snapshots, import/export, observatorio VCP) |
| Review | — | ✔ entero (auditar el ranking de decisión del motor) |
| IPO radar | — | ✔ (CRUD personal, ni siquiera en la navegación) |

Solapamientos concretos:

- **Listas ⊂ Sectores** [REPRODUCIDO]: el drill-down de Sectores replica las sublistas de Listas
  con otro código (A4.3). Divergirán (ya divergen en títulos).
- **Listas ≈ Screener**: ambas responden «qué pasa el corte hoy» sobre el mismo universo
  nocturno; una con la tabla nueva de 7 columnas y filtros vivos, la otra con la tabla vieja de
  14 y cortes fijos. La maqueta aprobada de la pantalla principal (raíl de vistas) ya describe a
  Listas mejor de lo que Listas se describe a sí misma: una lista es una vista guardada del
  screener.
- **Review ≈ QuickReviewModal**: el mismo flujo, dos implementaciones (A7.5).
- **Salud de mercado ↔ Sectores**: la amplitud sectorial de Salud enlaza a Sectores («Detalle
  operativo en Sectores») — relación correcta, es la única pareja bien resuelta.

## C2. Research desk y Review: herramientas internas en la navegación del producto

Mi lectura, tras usarlas [juicio, sobre lo REPRODUCIDO arriba]:

- **Review** es el depurador del sistema de priorización (A7: pesos, penalizaciones, colas de
  500). Su única función de usuario final —marcar candidata/vigilar/descartar y navegar entre
  fichas— ya vive en la ficha (resoluciones + raíl). Como pantalla de producto no debería
  existir; como herramienta de desarrollo es valiosa y puede quedarse detrás de un flag (no está
  en la navegación, así que el coste de retirarla del producto es cero enlaces).
- **Research desk** es el cuaderno del dueño (snapshots, JSON, observatorio del detector). Ocupa
  un puesto de los cinco de la navegación con el nombre «Research» — el nombre más prometedor
  para el usuario y el contenido menos usable para él. Retirarla de la navegación no quita
  ninguna capacidad de operador: favoritos puede vivir en el screener (la estrella ya existe en
  cada fila) y las alertas de cambios, si valen, pertenecen a Listas (los deltas nocturnos que
  `scan_symbol_history` ya soporta).

La consecuencia estructural: **de las cinco entradas de navegación actuales, dos (Research) o
tres (más el acceso indirecto a Review) llevan a herramientas internas.** El producto declara
cinco cosas y navega hacia otras.

---

# PARTE D — La pregunta abierta: qué producto dibujan las cinco cosas

Partiendo de cero desde el día del operador de tendencia — y de que las «cinco cosas» del
principio 4 son la definición del MVP — el día tiene cuatro momentos, no siete pantallas:

1. **¿Cómo está el mercado?** (30 segundos) → decide agresividad/exposición.
2. **¿Qué pasa el corte hoy y dónde está la fuerza por grupos?** (minutos) → produce una lista
   corta.
3. **¿Este valor concreto merece capital?** (el grueso del tiempo) → ficha por ficha, adelante y
   atrás, decidiendo y anotando.
4. **¿Qué hago con lo que ya decidí?** → seguimiento de la watchlist propia.

Eso son **cuatro superficies**:

- **Mercado** = Salud de mercado, adelgazada: régimen + estructura + amplitud sectorial +
  liderazgo. Fuera «Deterioro a revisar», sentimiento de titulares y las tres regiones vacías
  (vuelven cuando el snapshot las cubra). Es la pantalla que mejor sabe qué pregunta responde;
  solo hay que dejarla responder únicamente a esa.
- **Screener** = la pantalla principal según la maqueta aprobada («mesa de vistas»), donde el
  raíl de vistas ABSORBE Listas y Sectores:
  - Cada lista precalculada (Score compuesto, Vigilancia pivot, Deterioro...) es una **vista**: un
    preset de filtros+orden sobre el universo nocturno, pintada por la MISMA tabla de siete
    columnas. Muere la tabla paralela de 14 columnas, mueren los contratos como prosa, muere la
    divergencia de RS de B1 (una sola ruta de render).
  - Sectores se convierte en la **dimensión de grupo del screener**: el mapa de grupos (lo
    valioso) como cabecera colapsable o vista propia; pulsar un grupo = filtrar la tabla. El
    drill-down duplicado desaparece. La pregunta «¿dónde está la fuerza?» y la pregunta «¿qué
    valores?» se responden en el mismo sitio, que es como se usan.
- **Ficha** = el valor, con navegación Anterior/Siguiente alimentada por **la lista visible de la
  que vienes** (cualquier vista, no solo la cola de Review) — así se cumple la cosa nº 4 sin
  pasar por la maquinaria de auditoría. Y con la **ficha compartible** (cosa nº 5, hoy
  inexistente) como su función estrella: el resumen visual estado-de-la-tendencia + empresa,
  exportable como imagen.
- **Cartera de decisiones** (nombre a decidir; es el sucesor honesto de «Research/favoritos»):
  las resoluciones del usuario (candidata/vigilar/descartada), sus favoritos y los cambios
  nocturnos SOLO de esos valores. Es la única parte de Research desk que el operador necesita.

Y las cuatro reglas transversales que la reorganización necesita para no reproducir el problema:

1. **El sistema clasifica; el usuario decide.** Se retiran los verbos del sistema
   (Auditar/Vigilar/Esperar confirmación/Acción recomendada) de toda superficie; la única
   «decisión» que el producto muestra es la que el usuario guardó. El detalle de todo lo que hoy
   justifica esos verbos (checks, coberturas, contradicciones) puede quedarse como hechos
   descriptivos con sus valores, sin imperativo. El «Plan de operación» o se elimina o se
   convierte en calculadora explícitamente manual (el usuario introduce SU pivote y SU stop; el
   sistema solo hace la aritmética del riesgo) — con niveles autogenerados y la palabra
   «Objetivo», es un precio objetivo del sistema, y además hoy nace de un pivote que es el ATH
   disfrazado (A2.4).
2. **Una capa de formato única** (`lib/formatters` como único proveedor, es-ES en todo: coma
   decimal, millares con punto, una máscara de fecha corta y una larga). Es el `rsCanonical` de
   los números; B4 muestra que el patrón lector-único ya demostró funcionar en este repo.
3. **Los textos del sistema pasan por el mismo filtro que los datos**: glosario único (Etapa,
   Tema/Sector/Industria con un solo mapa de nombres — deshaciendo el cruce de B3), español con
   ortografía verificada (un test que grepee las ~80 faltas conocidas costaría una tarde y
   congelaría el problema), inglés solo en préstamos asumidos (screener, swing, stop).
4. **Lo interno, detrás de un flag**: Review, Research desk, observatorio VCP, JSON audit, embudo
   de diagnóstico. No borrarlos — el dueño los usa — sino sacarlos del producto que verá un
   suscriptor. La lección de B5.1 es que «dejar de renderizar» no basta como método de retirada;
   un flag explícito (`NEXT_PUBLIC_INTERNAL_TOOLS` o similar) hace la frontera auditable.

Qué se pierde con esta consolidación, dicho entero: (a) URLs dedicadas para listas/sectores
(mitigable: la vista activa puede viajar en la URL del screener); (b) espacio para el contenido
sectorial extenso — si el mapa de grupos crece (histórico de rotación, por ejemplo), Sectores
podría volver a ganarse una pantalla propia, y esa decisión no se pierde por posponerla; (c) la
cola guiada de Review como flujo de barrido rápido — si el barrido uno-a-uno demuestra valor de
usuario, la forma de reintroducirlo es «recorrer la vista visible en modo ficha», no una cola
paralela con ranking propio.

No propongo tocar el motor: scoring, contratos, auditoría y percentiles siguen calculándose
igual (los consumen el nocturno y las herramientas internas). Todo lo anterior es superficie.

---

# CONFIANZA

| Hallazgo | Confianza | Base |
|---|---|---|
| A1 tabla 7 columnas correcta; selector global funciona | Alta | Interacción reproducida + código citado |
| A1 «Global Leaders»/«Results»/«JSON audit» | Alta | Pantalla + línea exacta |
| A1 badge «50 cambios» al restaurar | Alta el hecho; Media el mecanismo | Visto en vivo; mecanismo inferido de `page.jsx:374-385,403` sin trazar las 50 claves |
| A2 chip Decisión «Auditar», Freno, Score 0 | Alta | Reproducido con DELL + `StockClient.jsx:82-99` |
| A2 Plan de operación con Objetivo 2R/3R | Alta (existencia), no visto renderizado | Código citado; gate impidió verlo en DELL — no encontré un símbolo con plan válido en la sesión |
| A2 PIVOT = ATH | Alta el caso DELL; Media como regla general | Un símbolo medido; la regla la afirma el doc de principios, no yo |
| A2 sin ficha compartible | Alta | Ausencia verificada en DOM de la ficha completa |
| A3/A4 divergencia RS frase-columna | Alta | Reproducida en 2 pantallas y 4+ símbolos; mecanismo con citas (`listRationale.js:216` vs `rsCanonical.js`) |
| A7 cola reordenada por prioridad del sistema | Alta | GAM 1/233 reproducido + `decisionProfile.js:137-151` |
| A7 «291 ESPERAR · 209 AUDITAR», chips Med./Traz. | Alta | Texto volcado de la pantalla |
| B3 taxonomía cruzada | Alta | Reproducida con DELL en las tres superficies |
| B4 divergencias de formato (14 casos) | Alta | Barrido delegado + verificación por muestreo de cada cita usada + casos vistos en vivo |
| B5 strings prohibidos «en recámara» (componentes no renderizados) | Media-alta | Barrido de imports (cero usos); no ejecuté un build para confirmar tree-shaking |
| C/D | — | Propuesta; su valor es discutible por diseño, no verificable |

# LO QUE NO HE VERIFICADO

- **Móvil y táctil**: todo el recorrido fue de escritorio (1280px). El screener tiene una lista
  móvil paralela (`MobileResultList`) que lee las mismas columnas; no la vi renderizada, ni los
  paneles `mobileResearchHome` (MarketMiniTape, SetupChipRail — donde viven los chips «Trend
  Template»/«Stage 2») en viewport móvil real.
- **El Plan de operación renderizado**: el gate lo ocultó en DELL y no busqué exhaustivamente un
  símbolo con plan VCP válido. Las líneas citadas existen; el aspecto final, no comprobado.
- **Estados vacíos de arranque**: mi sesión siempre tuvo el snapshot nocturno disponible. No vi
  el producto sin datos (primer uso real), donde los empty states contractuales del Hito 1
  deberían aparecer.
- **La ejecución de un scan en vivo** (prohibida por el encargo): los estados de progreso,
  PendingResultsBar y la franja de percentil por lote los juzgo por código y por el estado
  restaurado, no por verlos progresar.
- **Flujo tabla→ficha con contexto de screener**: verifiqué por código que el raíl
  Anterior/Siguiente solo lee la cola de Review, y que abrir la ficha por URL no lo muestra; no
  hice el clic físico desde la fila (el guardado de `lastOpenedStockContext` alimenta el panel de
  origen, no la navegación — `StockClient.jsx:1726-1727`).
- **Los strings no renderizados** (B5.1): afirmo «cero usos» por grep de imports, sin build.
- **Accesibilidad real** (lectores de pantalla): anoté los `aria-label` sin tilde y los volcados
  de árbol, pero no pasé un lector.
- **El servidor de :3100** (sesión del análisis del gráfico) seguía vivo y no lo toqué; mi
  instancia usó :3200 sobre `fce80c2` exportado. Durante esta sesión el HEAD del repo avanzó a
  `00ebdf9` («fix(chart): invierte el contrato de ventana...») — cambios solo del gráfico, fuera
  del alcance de este documento; ninguna de las pantallas analizadas cambió entre ambos commits.
