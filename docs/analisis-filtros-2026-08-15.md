# Análisis del sistema de filtros del screener — 2026-08-15

Base: `codex/statsedge-ui-polish` @ `1825897`. Solo análisis; ningún cambio de código.

## Método

- Lectura completa del sistema: `app/page.jsx` (contenedor y máquina de estados del scan),
  `app/components/screener/ScreenerShell.jsx`, `ResultFilterBar.jsx`, `useResultViewModel.js`,
  `lib/screenerTable.jsx`, `lib/screenerFiltersView.jsx`, `lib/screenerColumns.jsx`,
  `lib/screenerFilterCatalog.js`, `lib/screenerResultView.js`, `lib/screenerFormat.js`,
  `lib/screenerConfig.js`, `lib/cloudSyncClient.js`, `styles/screener.css`.
- Verificación en producción (solo lectura, Supabase): el escaneo nocturno de hoy
  («Materialized scan US 2026-08-15», 03:50 UTC) tiene **3.314 filas** en `scan_results`
  con señales precalculadas por fila (`screenPassed`, `screenRejectField`,
  `screenRejectReason`, `weeklyStageState`, `sectorScore`, `rsGlobalPct`…). También constan
  **dos scans en vivo lanzados esta mañana** («Scan servidor», 09:40 UTC con 5.838 filas y
  09:50 UTC con 5.365), que son el contexto del estado que motiva este encargo.
- Reproducción en navegador contra una instancia aislada: árbol de `1825897` exportado con
  `git archive` al scratchpad, `node_modules` enlazado, servidor propio en :3200 con
  `.env.local` filtrado (sin tokens de sesión). No toqué el servidor del dueño (:3000), no
  ejecuté scans, no escribí en Supabase. El servidor propio se cerró por PID al terminar.
- Nota de método: el panel de navegador embebido deja de repintar cuando queda oculto; las
  verificaciones sensibles a scroll se hicieron contra el DOM (texto e `innerText` de los
  bloques), no contra píxeles, y las capturas se tomaron con la pestaña visible.

Etiquetas: **[REPRODUCIDO]** visto en el navegador contra datos reales; **[CÓDIGO]**
afirmación sostenida en lectura de código con cita; **[SUPABASE]** verificado con consulta
de solo lectura; **[INFERIDO]** mecanismo derivado, no trazado en runtime;
**[CONOCIMIENTO]** práctica de la industria citada de memoria, no verificada hoy.

---

## 0. El mapa: tres poblaciones y dos sistemas de filtro

Todo lo que sigue se explica con un hecho de arquitectura: la pantalla mantiene **tres
conjuntos de filas** y **dos sistemas de filtrado** que el usuario nunca ve nombrados:

| Conjunto (estado en `app/page.jsx`) | Qué es | Quién lo pinta |
|---|---|---|
| `analyzedRows` | todo lo analizado (el universo del scan) | «N analizadas» (`ScreenerShell.jsx:563`) y el KPI «universo» |
| `rows` | lo que pasa el **filtro de ejecución** (preset + capas + umbrales) | «N pasan» (`:563` y KPI `:343`) |
| `filtered` | `rows` menos lo que esconde la **vista** (Resolución, País, Tema, Sector, Subsector, Fuerza grupo, IPO, orden) | «N resultados» (`:562`), la tabla |

- El **filtro de ejecución** vive en el sidebar: 7 presets, 13 capas + régimen, ~70
  umbrales numéricos en 13 grupos con toggle por regla, 6 booleanos, 3 niveles de
  exigencia, 8 modos de setup, plantillas locales y en nube (`lib/screenerFilterCatalog.js`).
- El **filtro de vista** vive sobre la tabla: `applyResultViewFilters`
  (`lib/screenerResultView.js:62-106`). No re-ejecuta nada: esconde filas de `rows`.
- Además hay un **cuarto conjunto fantasma**: `pendingResults` — resultados nuevos retenidos
  mientras la tabla visible está «congelada» (problema 1).

Esa distinción ejecución/vista era necesaria cuando filtrar exigía re-escanear. Hoy el
nocturno guarda el universo completo con las señales ya calculadas [SUPABASE], el
recálculo del filtro de ejecución sobre filas ya analizadas es local e instantáneo
(`filterAnalyzedRows`, efecto en `app/page.jsx:733-754`), y la vista también. **Las dos
capas siguen siendo distintas por dentro, pero ya no hay razón para que el usuario las
distinga por fuera** — y hoy la interfaz le obliga: dos vocabularios («pasan» /
«ocultas por vista»), dos contadores, dos sitios donde tocar.

---

## 1. «LISTA CONGELADA · 1903 resultados · +896 vs visibles»

### Qué es cada pieza [CÓDIGO]

La barra es `PendingResultsBar` (`lib/screenerTable.jsx:34-44`):

```jsx
export function PendingResultsBar({ pending, visibleCount = 0, filteredCount = 0, onCommit }) {
  if (!pending?.rows?.length && !pending?.diagnostics) return null;
  const pendingCount = Number(pending.filteredCount ?? pending.rows?.length ?? 0);
  const delta = pendingCount - filteredCount;
  return <div className="pendingResultsBar">
    <span>{pending.done ? "Actualización lista" : "Lista congelada"}</span>
    <b>{pendingCount} resultados</b>
    {delta ? <em>{delta > 0 ? `+${delta}` : `${delta}`} vs visibles</em> : ...}
    <button ... onClick={onCommit}>Mostrar</button>
  </div>;
}
```

«1903» es `pendingFilteredCount`: las filas de la actualización pendiente tras aplicarles
la MISMA vista que a la tabla (`useResultViewModel.js:328-331`). «+896» es la resta contra
las 1.007 visibles. El botón «Mostrar» ejecuta `commitPendingResults`
(`app/page.jsx:780-787`), que vuelca `pendingResults` sobre `rows`.

### Por qué existe la capa [CÓDIGO]

`run()` congela deliberadamente: si al pulsar «Ejecutar» ya había tabla
(`hadVisibleRows`, `app/page.jsx:1327`), todo el progreso del scan va a `pendingResults`
y nunca a `rows` (`publishPartial`, `:1394-1421`) — **incluido el resultado final**
(`:1506-1514`, con `done: true`). El propósito original es legítimo: un scan en vivo llega
por lotes durante minutos (el de esta mañana tardó ~6,5 min para 5.838 símbolos
[SUPABASE]) y una tabla que se reordena sola cada dos segundos es inusable. Congelar
estabiliza la lectura.

### Por qué hoy produce el estado absurdo que viste [CÓDIGO + SUPABASE, secuencia INFERIDA]

La secuencia que deja «1686 pasan · 500 analizadas» junto a «LISTA CONGELADA · 1903»:

1. La sesión tenía la tabla del scan anterior: `rows` = 1.686.
2. Pulsas «Ejecutar». `run()` hace `setAnalyzedRows([])` (`:1332`) y, como hay tabla
   visible, congela.
3. Carga la «previa cacheada» de la nube y hace `setAnalyzedRows(cachePreview.rawRows)`
   (`:1363`) — pero esa previa viene de `getLatestScanFromCloud()`, que pide
   **`rowsLimit=500`** (`lib/cloudSyncClient.js:260`). Resultado: «**1686 pasan · 500
   analizadas**» — más filas pasan que filas analizadas, una imposibilidad aritmética
   fabricada por un límite de transporte.
4. El scan de servidor va llenando `pendingResults`; con tu vista aplicada son 1.903,
   frente a 1.007 visibles: «LISTA CONGELADA · 1903 resultados · +896 vs visibles».

Los dos scans de la mañana en `scans` [SUPABASE] encajan con esta secuencia. El comentario
de `:1359-1362` confirma que el paso 3 se añadió para que «analizadas» no se quedara en 0
— la corrección de un contador rompió otro.

Dos agravantes del mecanismo [CÓDIGO]:

- **El auto-commit solo dispara si la tabla visible está vacía** (`app/page.jsx:1726-1734`:
  `if (running || filtered.length || ...) return`). Con cualquier fila visible, la
  reconciliación es siempre manual.
- **`pendingResults` no se persiste** (no está en `buildScreenerSessionPayload`,
  `:613-673`): si recargas con la barra a la vista, la actualización pendiente se pierde
  — minutos de scan tirados sin aviso.

### Juicio y qué hacer

La capa congelado/visible es correcta **como mecánica interna** y errónea **como
superficie**. Pide al usuario que administre la caché del producto: reconciliar dos
números, decidir cuándo «Mostrar», y entender «congelada» — vocabulario de sistema, no de
mercado. Y en el producto post-nocturno el caso que la justifica (scan largo con tabla
delante) deja de ser el camino normal: el filtrado ya es instantáneo sobre la población
entera; «Ejecutar» es un refresco excepcional, no el gesto diario.

Propuesta (en orden de preferencia):

1. **Disolverla**: mientras un refresco corre, la tabla se actualiza en su sitio como ya
   hace cuando no hay filas visibles, con un indicador de progreso discreto («Refrescando
   universo · 2.310/5.838») en la propia cabecera de resultados. Sin segunda lista, sin
   botón. El caso «no me muevas la tabla mientras leo» se resuelve congelando SOLO el
   orden visual durante el scroll activo, no la población.
2. Si se conserva la retención, **contarla sin mecanismo**: una sola frase — «Hay una
   actualización con 1.903 resultados · Ver» — sin «congelada», sin delta que obligue a
   restar, y con auto-aplicación cuando el usuario no ha interactuado en N segundos o al
   terminar el scan (`done: true` hoy sigue esperando el clic). Y persistirla o
   descartarla explícitamente al salir, nunca perderla en silencio.

En ambos casos, el arreglo del `rowsLimit` (ver §5-B2) elimina el «500 analizadas»
imposible: es un fallo independiente de la barra.

---

## 2. «Más filtros» empuja todo y deja media pantalla vacía

**[REPRODUCIDO]** Con el cajón abierto, los seis selects (País, Tema, Sector, Subsector,
Fuerza grupo, IPO) se apilan en una columna estrecha a la derecha; «Resolución» y
«Ordenar» quedan flotando al fondo izquierdo de un hueco de ~350px de alto; la tabla
desaparece del viewport.

**Causa exacta [CÓDIGO]** — la barra es un grid de celdas estrechas y el cajón es una
celda más:

```css
/* styles/screener.css:8373 */
.screenerTerminalPage .resultFilterBar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 240px));
  ...
}
```

El `<details className="... viewLayerFilters">` (`ResultFilterBar.jsx:82`) vive DENTRO de
ese grid sin `grid-column: 1 / -1`. Al abrirse:

- su contenido interior (`viewLayerFilterGrid`, que a su vez es `.controls.resultFilterBar`
  — otro grid `auto-fit` de minmax 140-240px, `ResultFilterBar.jsx:84`) queda confinado al
  ancho de UNA celda (≤240px), así que solo cabe una columna → seis selects apilados;
- la fila del grid exterior adopta la altura de esa columna de selects, y las celdas
  hermanas («Resolución», «Ordenar») se quedan con ~36px de contenido dentro de una fila
  de ~350px → el vacío a la izquierda;
- todo lo posterior (chips, tabla) baja esa misma altura.

**Arreglo mínimo** (una regla): `.viewLayerFilters { grid-column: 1 / -1; }` — el cajón
pasa a ocupar el ancho completo de la barra y su grid interior vuelve a repartir los
selects en fila. **Arreglo bueno**: que no exista el cajón (ver §5-B5) — un disclosure que
esconde seis selects «Todos» es un mueble para guardar controles vacíos; la barra de
chips propuesta hace que solo ocupe sitio lo que filtra.

---

## 3. Los números contradictorios de la cabecera

### Reproducción y significado de cada número

**[REPRODUCIDO]** en la instancia aislada, con un solo filtro de vista activo
(«Fuerza: Débiles») sobre la restauración de hoy:

| Texto en pantalla | Fuente [CÓDIGO] | Qué significa de verdad |
|---|---|---|
| KPI sidebar «500 UNIVERSO» | `kpiUniverseCount` (`page.jsx:761`) | aquí: las 500 filas restauradas (truncadas) — no el universo (5.838) |
| KPI sidebar «282 PASAN» | `rows.length` (`ScreenerShell.jsx:343`) | pasan el filtro de ejecución |
| h2 «123 resultados» | `filtered.length` (`:562`) | pasan ejecución Y vista |
| «282 pasan · 500 analizadas · Rendimiento 3M · scan 15 ago, 11:58» | `:563` | `rows` · `analyzedRows` · etiqueta del ORDEN (sin decir que es el orden) · fecha |
| «VISTA DE INVESTIGACIÓN 123/282 · FILTROS 1 · OCULTAS 159» | `ResultFilterChips` (`screenerFiltersView.jsx:51-65`) | filtered/rows · nº filtros · rows−filtered |
| «159 ocultas por vista» + chip «Fuerza: Débiles ×» | el MISMO componente, 20px más abajo (`:72-75`) | otra vez rows−filtered |

En tu sesión de hoy los mismos seis huecos decían: 1686 pasan · 500 analizadas ·
Rendimiento 12M · 1007 resultados · 1007/1686 · 679 ocultas. **El mismo estado se cuenta
seis veces con tres vocabularios**, y dos de los números («500 analizadas», «500
UNIVERSO») eran falsos por el truncado de la restauración (§1, paso 3).

### Qué sobra y qué vocabulario ya no es cierto

- **«analizadas» sobra de la cabecera.** Era el contador de progreso del scan en vivo
  («¿cuánta muestra llevo?»). Con el nocturno completo, la muestra ES el universo; el dato
  pertenece a la página de metodología o al estado del refresco mientras corre, no a la
  cabecera permanente. Y mientras pueda valer 500-por-truncado, es directamente
  desinformación (principio 3: eso no es un dato ausente mostrado como ausente — es un
  dato falso mostrado como cierto).
- **«pasan» está tres veces** (KPI, cabecera, resumen de vista). Una basta, y con
  población nombrada: «de 3.314 analizadas anoche, pasan 1.686».
- **«ocultas por vista» está dos veces en el mismo componente** y es derivable de
  «1007/1686». La palabra «vista» es jerga interna: el usuario no llama «vista» a sus
  filtros — los llama filtros.
- **«Rendimiento 12M» flotando sin rótulo** en la línea de cabecera es el criterio de
  orden (`SORT_LABELS[sort]`), pero nada lo dice; parece un dato más.
- **El h2 «N resultados» y la barra congelada «M resultados»** usan la misma palabra para
  dos poblaciones distintas (§1) a 40px de distancia.

### Propuesta

Una sola línea de estado bajo un solo número grande:

> **1.007 resultados** — de 1.686 que pasan tu filtro (universo de anoche: 3.314) ·
> ordenados por Rendimiento 12M ↓

Es la misma información que hoy dan seis contadores, en una frase con las poblaciones
nombradas. El KPI «pasan» del sidebar se retira (duplicado); «OCULTAS 159» se retira
(derivable); los chips de filtros activos se quedan — son el control, no el contador.

---

## 4. No se puede ordenar clicando la cabecera

**[REPRODUCIDO]** Click en el `<th>` de RS: nada cambia (mismo primer ticker, mismo valor
del select de orden), `cursor: auto`, sin `aria-sort`, sin botón dentro de la celda.

**[CÓDIGO]** La cabecera se pinta sin manejador (`lib/screenerTable.jsx:64-73`):

```jsx
<th key={column.key} className={column.className} data-align={column.align}>
  <span className="columnHead">
    {screenerColumnLabel(column, ctx)}
    {column.legend ? <InfoHint text={column.legend} /> : null}
  </span>
</th>
```

Lo irónico es que **toda la infraestructura ya existe**: cada columna declara su
`sortKey` (`lib/screenerColumns.jsx:113-242` — `rsGlobalPct`, el periodo activo,
`distance52w`, `marketCap`), y el desplegable «Ordenar» se deriva de esas mismas columnas
(`screenerSortOptions`, `:256-266`) precisamente para que solo se pueda ordenar por lo
visible. La cabecera clicable es la misma regla con mejor ergonomía: el criterio de orden
no solo es elegible y explícito (principio 1), sino que está *donde está el dato*.

Detalle de implementación que sí hay que decidir: hoy el orden es **siempre
descendente** (`useResultViewModel.js:242`: `sortMetric(b) - sortMetric(a)`), y el dueño
pide asc/desc. Hace falta añadir dirección al estado de orden (hoy es solo una clave), el
indicador ▲/▼ en la cabecera activa, `aria-sort`, y `cursor: pointer`. El desplegable
puede quedarse como espejo accesible o retirarse; con cabeceras clicables y el selector de
periodo, queda redundante.

Coste bajo, patrón universal [CONOCIMIENTO]: Finviz, TradingView, MarketSmith/MarketSurge
y cualquier tabla financiera seria ordenan por click en cabecera con toggle de dirección.
Es de los pocos gestos que TODO usuario de screeners trae aprendido de fábrica.

---

## 5. El sistema entero: qué separa un instrumento de un prototipo

### 5.1 Inventario de lo que hay (para dimensionar el juicio)

Filtro de ejecución [CÓDIGO, `lib/screenerFilterCatalog.js`]: 7 presets · 13 capas +
régimen · ~70 umbrales en 13 grupos, cada uno con su toggle · 6 booleanos · 3 niveles de
exigencia · 8 modos de setup · plantillas con nube. Filtro de vista [CÓDIGO,
`useResultViewModel.js`]: 6 selects «físicos» + Resolución + orden — y **once filtros
más del sistema de decisión que siguen calculándose aunque su UI se retiró** (confianza,
fiabilidad, pruebas, prioridad, perfil, salud de datos, score audit… `:109-119`, con sus
options/counts/summaries todos vivos). Es un coste por render y una recámara de
vocabulario prohibido — la misma lección que B5.1 del análisis del 14.

### 5.2 Lo observado que un usuario de pago notaría

1. **El dato roto lidera la tabla** [REPRODUCIDO]: restauración de hoy ordenada por
   Rendimiento 3M → primera fila BANL «+2235,5%» (microcap de 8M); con «Débiles» activo,
   primera fila YARW con RS «– Sin dato» y «+124,7%». El guion honesto para el dato no
   fiable existe por celda (principio 7), pero **el orden no lo respeta**: una fila cuyo
   rendimiento la auditoría no avala compite en el ranking con ese mismo número. Un
   instrumento profesional no deja que su primera pantalla la ganen los datos corruptos.
2. **Controles vacíos ocupando sitio** [REPRODUCIDO]: «IPO: Todos» con UNA opción (no
   puede filtrar nada); «País: Todos» con solo US — el lanzamiento es US-only, así que
   nace vacío por diseño.
3. **«Fuerza» tiene tres nombres y filtra por un dato invisible** [CÓDIGO +
   REPRODUCIDO]: la capa se llama «Fuerza sector» (`screenerConfig.js:55`), el select
   «Fuerza grupo» / «Filtrar por fuerza de grupo» (`ResultFilterBar.jsx:97`), el chip
   «Fuerza: Débiles» (`useResultViewModel.js:643`). Y filtra por `sectorScore`
   (`passesSectorStrength`, `screenerResultView.js:51-60` — donde además la condición
   `mode === "Débiles" || mode === "Débiles"` está duplicada literalmente, resto de la
   normalización de tildes), **una métrica que ninguna columna muestra**: por eso al
   filtrar «Débiles» salen valores con RS 94 en Etapa 2 (grupo débil, valor fuerte) y la
   pantalla no puede explicártelo. La tabla ya cumplió «ordenar solo por lo visible»; el
   filtro incumple la misma regla.
4. **La restauración trunca el producto** [REPRODUCIDO]: «Último snapshot de la nube
   cargado: 500 de 5838 acciones (parcial)» + banner «SNAPSHOT INCOMPLETO … límite de
   tamaño de la restauración». La promesa nueva del producto —filtrado instantáneo sobre
   la población entera— muere en el arranque: la población entera no llega al navegador
   (`rowsLimit=500`, `cloudSyncClient.js:253-260`, un límite pensado «para paginar sin
   volver al servidor» cuando las listas eran cortas).
5. **El desplegable de Subsector tiene 83 opciones en inglés** [REPRODUCIDO], en un
   select nativo sin buscador, incluyendo «Shell Companies (18)» — dieciocho cascarones
   pasando el preset Balanceado. Y «Tema» mezcla temas curados en español con sectores del
   proveedor sin mapear («Basic Materials», «Sin sector (1)») — la taxonomía cruzada de
   B3 del análisis del 14 sigue viva en los filtros.
6. **Pulsar «Ejecutar» re-analiza el universo entero en vivo** (~6,5 min [SUPABASE])
   para producir casi lo mismo que el nocturno ya dejó calculado. El botón más prominente
   de la pantalla es hoy su gesto menos necesario — herencia del producto pre-nocturno.

### 5.3 Qué separa un filtro premium de uno prototipo

De lo anterior sale una formulación corta — las cinco reglas que este screener incumple
hoy y que las plataformas serias cumplen [CONOCIMIENTO]:

1. **Una población, un contador.** El usuario tiene UNA pregunta («¿cuántas quedan?») y
   el instrumento da UNA respuesta, con las demás poblaciones nombradas en una frase, no
   contadas en paralelo. Prototipo: seis contadores de tres poblaciones (§3).
2. **El resultado se muestra, no se negocia.** Filtrar/refrescar actualiza lo que miras;
   nunca aparece una segunda lista que reconciliar a mano (§1).
3. **Se filtra y ordena por lo que se ve, con el gesto donde está el dato.** Cabecera
   clicable (§4); ningún filtro sobre métricas que la fila no enseña (§5.2-3).
4. **La maquinaria no se enseña**: «congelada», «snapshot», «restauración», «percentil
   por lote», «vista», «analizadas» son vocabulario de arquitectura. El instrumento habla
   de mercado: valores, filtros, resultados, «datos de anoche».
5. **Los estados imposibles no se muestran**: 1.686 pasan de 500 analizadas, un filtro
   IPO sin opciones, un +2235% liderando el ranking. Cada uno tiene arreglo mecánico;
   dejarlos en pantalla es lo que hace que el conjunto «se sienta» prototipo aunque el
   motor sea sólido.

El patrón de interfaz consolidado en el sector [CONOCIMIENTO, no verificado hoy]:
Finviz/TradingView muestran un único «N matches», filtros que editan la población visible
al instante, orden por cabecera, y los criterios activos como fila de chips/controles
compactos con «añadir filtro» explícito. Nada de eso es innovación: es el suelo.

### 5.4 La forma propia (propuesta de estructura)

No copiar la parrilla de 60 selects de Finviz: la ventaja de StatsEdge es que **el
juicio grueso ya viene hecho de fábrica** (presets/vistas sobre el nocturno). La
estructura que lo aprovecha:

```
[Vista: Balanceado ▾]  [Fuerza grupo: Débiles ×] [Tema: Semis ×] [+ Filtro]      1.007 resultados — de 1.686 · orden: Rend. 12M ↓
─────────────────────────────────────────────────────────────────────────────
TICKER | TEMA | RS ▾ | ETAPA | REND 12M ↓ | DIST MÁX 52S | CAPITALIZ.
```

- **Nivel 1 — la vista** (preset del filtro de ejecución): un selector con nombre. Es el
  raíl de la maqueta A «mesa de vistas»; esta propuesta la mantiene y la refuerza (§6).
- **Nivel 2 — chips de filtros activos** + un solo botón «+ Filtro» que abre un popover
  con los filtros disponibles (Tema, Sector/Subsector con buscador, Fuerza grupo,
  Resolución; mañana Capitalización y Bolsa). Solo ocupa sitio lo que filtra: se acabaron
  los seis selects en «Todos» y el cajón que los esconde (§2).
- **Nivel 3 — el editor completo** (capas y 70 umbrales): detrás de «Editar filtro», para
  el 5% de las veces. Es la pirámide preset → ajuste → cirugía; hoy los tres niveles
  compiten en la misma barra lateral.
- Los filtros pedidos para más adelante encajan sin obra: **Capitalización** es columna
  visible (rango con tramos micro/small/mid/large sobre `marketCap`, ya en cada fila);
  **Bolsa** (`row.exchange` ya viaja en la fila [CÓDIGO, `screenerFormat.js:228`]) entra
  como chip cuando se decida mostrarla o al menos nombrarla en la ficha. **País** sale del
  producto US-only y vuelve como chip cuando haya segundo mercado — el mecanismo de
  `viewLayers` ya permite apagarlo hoy sin borrar código.

---

## 6. Relación con la propuesta de cuatro superficies (2026-08-14)

**Se mantiene íntegra y esto la concreta.** La «mesa de vistas» del screener es el nivel 1
de §5.4; las listas precalculadas siguen siendo vistas del mismo universo nocturno. Lo que
este análisis añade a aquella propuesta:

- La capa congelado/pending debe disolverse ANTES o DURANTE la absorción de Listas en el
  raíl de vistas: si cada vista es un preset sobre el universo nocturno, un «pending» por
  vista multiplicaría el problema.
- El contador único de §3 es la misma regla para todas las vistas (hoy Listas tiene su
  propio juego de contadores de fiabilidad).
- El arreglo del `rowsLimit` (B2) es prerrequisito de la mesa de vistas: sin población
  completa en cliente, cada vista heredaría el «500 de 3.314».

---

## 7. Propuesta priorizada

### Arreglar ya (pequeño, sin rediseño)

| # | Qué | Por qué ahora |
|---|---|---|
| A1 | Cabeceras clicables con asc/desc, ▲▼, `aria-sort` (§4) | Lo pide el dueño; la infraestructura (`sortKey`) ya existe; es el gesto estándar del sector. Única decisión real: añadir dirección al estado de orden. |
| A2 | `grid-column: 1 / -1` al cajón «Más filtros» (§2) | Una regla CSS elimina la media pantalla vacía mientras llega B5. |
| A3 | Cabecera de resultados: un número + una frase con poblaciones nombradas; retirar «analizadas», el KPI «pasan» duplicado y el «ocultas por vista» redundante (§3) | Elimina la reconciliación mental diaria. Es borrar, no construir. |
| A4 | Etiqueta y visibilidad de «Fuerza grupo»: un solo nombre en capa/select/chip, y su leyenda diciendo que es la fuerza DEL GRUPO (§5.2-3) | Dos strings y una leyenda; deshace la confusión «filtro débiles → RS 94». |
| A5 | Ocultar filtros de vista sin opciones reales (IPO con 1 opción, País US-only) (§5.2-2) | `viewLayers` ya lo soporta; un control que no puede filtrar no debe ocupar sitio. |
| A6 | Auto-aplicar `pendingResults` cuando `done: true` y el usuario lleva N segundos sin interactuar, y no perderlo en recargas (§1) | Mitiga lo peor de la barra sin esperar a B1. |

### Mejora mayor (rediseño con decisión de producto)

| # | Qué | Por qué |
|---|---|---|
| B1 | Disolver la capa congelado/visible de la superficie (§1) | El caso que la justificaba (scan largo delante de tabla) deja de ser el camino normal post-nocturno; su coste (dos listas, tres números, un botón) lo paga el usuario cada día. |
| B2 | Restauración completa del universo nocturno: subir `rowsLimit` a la escala real (3.314 filas ligeras) o paginar/stream desde `scan_results` | Sin esto, «filtrado instantáneo sobre la población entera» es falso en el arranque, y el banner «SNAPSHOT INCOMPLETO» + contadores rotos reaparecen cada mañana. Es la raíz del «500 analizadas». |
| B3 | Barra única de chips + «+ Filtro» con popover; muere el cajón y los selects permanentes (§5.4) | Solo ocupa sitio lo que filtra; escala a los filtros futuros (Capitalización, Bolsa) sin re-maquetar. |
| B4 | Guardarraíl de plausibilidad en el orden: fila cuyo métrico de orden está marcado no fiable por la auditoría → al final del ranking (o fuera, con contador «N excluidas por datos») | La primera pantalla es el producto; hoy la ganan BANL +2235% y shells. El criterio de no-fiabilidad ya existe por celda (`auditIssueReason`); falta aplicarlo a `sortMetric`. |
| B5 | «Ejecutar» pasa a «Refrescar» secundario; la fuente por defecto es el nocturno | Coherente con la decisión ya tomada para Listas (el nocturno como canon); reduce a la vez la exposición del embudo/diagnóstico en la superficie. |
| B6 | Retirar del modelo de vista los once filtros de sistema sin UI (o moverlos tras el flag de herramientas internas) | Coste por render + recámara de vocabulario prohibido; la retirada a medias es la vulnerabilidad que el análisis del 14 documentó (B5.1). |

Orden sugerido: A1-A6 en una pasada corta; luego B2 (desbloquea la promesa del nocturno),
B1+B3 juntos (son la misma superficie), B4, B5, B6.

---

## CONFIANZA

| Afirmación | Confianza | Base |
|---|---|---|
| Mecanismo de PendingResultsBar y sus números | Alta | Código citado línea a línea; componente y textos localizados |
| Secuencia exacta que produjo «1686/500/1903» en la sesión del dueño | Media-alta | [INFERIDO] de código + los dos scans de la mañana en Supabase + reproducción parcial (la restauración truncada y el juego de contadores sí se reprodujeron; no ejecuté el scan que crea el pending, prohibido por el encargo) |
| Truncado a 500 en restauración («500 de 5838 (parcial)») | Alta | [REPRODUCIDO] + `cloudSyncClient.js:260` |
| Causa CSS del cajón «Más filtros» | Alta | [REPRODUCIDO] con captura + reglas exactas en `screener.css:8373-8404` |
| Números duplicados/contradictorios de la cabecera | Alta | [REPRODUCIDO] vía DOM con un filtro activo; fuentes citadas |
| Cabecera no ordena; solo desplegable; orden siempre descendente | Alta | [REPRODUCIDO] (click sin efecto, cursor auto) + `screenerTable.jsx:64-73`, `useResultViewModel.js:242` |
| Nocturno de hoy = 3.314 filas con señales por fila | Alta | [SUPABASE] `scans` + fila completa de ARRY en `scan_results` |
| «Débiles» devuelve Etapa 2 con RS alto (dato de grupo invisible) | Alta | [REPRODUCIDO] sobre 282 restauradas; mecanismo citado |
| Once filtros de sistema vivos sin UI | Alta | Código citado; no medí su coste real de render |
| Prácticas de Finviz/TradingView/MarketSmith | Media | [CONOCIMIENTO] estable del sector; no las abrí hoy |
| Juicios de §5.3 y propuesta §5.4/§7 | — | Diseño argumentado, no verificable; discutible por diseño |

## LO QUE NO HE VERIFICADO

- **El PendingResultsBar en vivo**: ejecutar scans está prohibido por el encargo, así que
  la barra «LISTA CONGELADA» no se vio renderizada en mi sesión; su comportamiento está
  afirmado por código y por el estado que el dueño observó hoy.
- **El estado exacto del navegador del dueño** (1686/1007/1903): reconstruido, no
  fotografiado por mí; los números de mi reproducción fueron 282/123/159 con la misma
  mecánica.
- **Móvil**: `MobileResultList` y `SetupChipRail` leen el mismo modelo pero no los abrí
  en viewport móvil; el problema 2 (grid del cajón) tiene reglas responsive propias que
  no auditué.
- **El coste de render de los once filtros fantasma** (B6): afirmo que se calculan
  (código), no cuánto cuestan.
- **`kpiUniverseCount` en todos sus estados**: verifiqué el caso restaurado (muestra 500);
  su cascada de fallbacks (`page.jsx:761`) tiene más ramas que no recorrí.
- **La viabilidad de subir `rowsLimit` a 3.314** (B2): el límite existe por tamaño de
  respuesta; no medí el peso real de 3.314 filas ligeras (`rowProjection: "light"`) ni el
  impacto en `cacheableLatest` (`app/api/scans/route.js:420-427`).
- **Plataformas de la competencia**: no las abrí hoy; el patrón citado es conocimiento
  general del sector.
- **Accesibilidad**: anoté `cursor` y `aria-sort` ausentes en cabeceras; no pasé lector de
  pantalla sobre la barra de filtros ni el cajón.
