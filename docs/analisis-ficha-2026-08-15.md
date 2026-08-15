# Análisis de la ficha del valor — 2026-08-15

Base: `codex/statsedge-ui-polish` @ `f821962`. Solo análisis; ningún cambio de código.
El gráfico queda fuera (diagnosticado y arreglado, `docs/analisis-grafico-2026-08-14.md`);
aquí solo aparece por cómo encaja en la ficha.

## Método

- Lectura completa de `app/stock/[symbol]/StockClient.jsx` (2.171 líneas) y `page.jsx` (SSR),
  más los módulos que alimentan la ficha: `lib/stockDecisionDesk.js`,
  `lib/reviewQueueNavigation.js`, `lib/stockDecisionResolution.js`, `lib/globalRs.js`,
  `lib/screenerScoreAudit.js` (para B.8), `lib/localState.js`, y el contexto de origen
  (`lib/screenerContracts.js` / `lib/reviewStockContext.js`).
- Reproducción en navegador contra instancia aislada: árbol de `f821962` exportado con
  `git archive` al scratchpad, `node_modules` enlazado, servidor propio en **:3300** con
  `.env.local` filtrado (sin tokens de sesión). No toqué :3000/:3100/:3200; el servidor
  propio (PID 57482) se cerró por PID exacto al terminar. Cero escrituras en Supabase, cero
  scans.
- Fichas recorridas: **WDC** (fuerte, RS 98), **ARRY** (débil, RS 13, Etapa 4), **YARW**
  (sin RS semanal), **AEXA** (SPAC, pocos datos) — elegidas con consultas de solo lectura a
  `rs_weekly_items` y al escaneo nocturno. Más **HBB** abierta desde la tabla del screener
  (para el contexto de origen) y el modal de revisión sobre **BANL** (para B.8).
- Nota de método: el panel embebido deja de repintar oculto; las verificaciones se hicieron
  contra el DOM (`innerText`, fetch a las API) con la pestaña visible para las capturas. El
  scroll físico falló varias veces por ese mismo motivo y lo señalo donde afecta.

Etiquetas: **[REPRODUCIDO]** visto en navegador contra datos reales; **[CÓDIGO]** afirmación
con cita literal; **[SUPABASE]** verificado con consulta de solo lectura; **[INFERIDO]**
mecanismo derivado, no trazado en runtime.

---

# PARTE A — Recorrer y juzgar

## A0. El resumen en una frase

La ficha ya no dicta («Auditar» salió de la cabecera, el plan de operación no existe) y su
esqueleto N0–N3 es el correcto — pero **tiene dos caras según cómo llegues** (por URL es
descriptiva y sin ninguna navegación; desde el screener resucita el veredicto retirado
dentro de la mesa de observación), y varios de sus datos técnicos centrales son **artefactos
del detector vestidos de medidas**: la BASE dura 13.0 semanas en todos los valores, el PIVOT
es el máximo reciclado, el «ATH» es el máximo de 52 semanas, y un símbolo sin RS muestra
«RS 15 ago 2026 · n=0».

## A1. N0 — Cabecera: la estructura correcta con cuatro grietas

**Qué decisión ayuda a tomar:** «¿qué es esto y en qué fase está?» — identidad, precio,
etapa. Correcta y ya sin veredicto [REPRODUCIDO]: el chip dice «ETAPA · ETAPA 2/4/BASE» con
el glifo de curva y la misma palabra que la tabla (`StageCurveChip`, `StockClient.jsx:86-99`).
El formato es-ES unificado llegó («508,80 USD +21,51 (+4,4%)») — la capa única de
formatters funciona aquí.

1. **Los botones de la cabecera no existen: un bug los mata a todos** [CÓDIGO +
   REPRODUCIDO]. `n0Actions` es un fragmento JSX y el guard exige longitud
   (`StockClient.jsx:199`):
   ```jsx
   {actions && actions.length ? (
     <div className="stockVerdictActions">
       {actions}
     </div>
   ) : null}
   ```
   `actions.length` de un elemento React es `undefined` → el bloque con «Screener» (volver)
   y «Web oficial» **no se renderiza nunca** (verificado en DOM: cero enlaces en las cuatro
   fichas). La ficha no tiene ningún control contextual de vuelta; solo la barra global.
2. **El kicker está en inglés crudo de proveedor** [REPRODUCIDO]: «TECHNOLOGY · NASDAQGS»,
   «HEALTHCARE · NASDAQCM», «FINANCIAL SERVICES · NYSE» (`:153` pinta `data.sector` y
   `data.exchange` tal cual, y el CSS lo mayusculiza). La primera línea de la ficha ignora
   el mapa Tema/Sector/Subsector que la propia ficha ya usa bien en N3.
3. **El resumen de setup es una lista de negaciones** [REPRODUCIDO]: «SETUP 0/5 condiciones ·
   falta: base, contracciones, contracción decreciente, cierre sobre pivot, volumen seco» —
   idéntico en WDC (fuerte) y ARRY (débil). Cuando el detector no ve nada, la cabecera
   dedica su línea final a enumerar las cinco cosas que no ve. Es el patrón «tabla de
   negaciones» (A2.5 del análisis del 14) trasladado a N0. Con 0/5, una sola palabra basta
   («Sin estructura de base medible»); la lista completa pertenece al desglose.
4. **«RS 15 ago 2026 · n=0» para símbolos sin ranking** [REPRODUCIDO en YARW y AEXA]. La
   franja de calidad promete un RS de HOY con muestra CERO. Mecanismo [CÓDIGO]: sin semanal,
   `rsGlobalAsOf` cae a la fecha del universo (`app/api/company-brief/route.js:626`:
   `weeklyLatest?.date || relativeStrength.universe?.asOf`) y el strip imprime
   `n=${sharedNum(Math.round(freshness.rsGlobalSample || 0))}` (`StockClient.jsx:180`) — el
   `|| 0` convierte la ausencia en cero. Es la violación literal del principio 3 («un dato
   ausente se muestra como ausente, no como cero»), y contradice al panel de abajo, que para
   el mismo símbolo dice «Sin RS semanal». Menores en la misma franja: «Cobertura util» sin
   tilde (viene del servidor, `route.js:610` — mientras `lib/discoveryAudit.js:134` escribe
   «útil» con tilde: la misma etiqueta, dos ortografías), «Intradía distinta» (jerga: quiere
   decir que la cotización intradía difiere del cierre dibujado), y el label «Cierre del
   gráfico» para el precio.

## A2. La mesa de observación — el veredicto retirado vuelve por la puerta del contexto

Solo existe si llegas con contexto del screener/review (`buildStockDecisionDesk`,
`lib/stockDecisionDesk.js:245`: `if (!origin) return null`). Abriendo HBB desde la tabla
[REPRODUCIDO]:

> «SCREENER · **OBSERVACIÓN: BLOQUEADO · AUDITAR** · Riesgo operativo · extension SMA50
> 44.7% · 6/9 … TESIS: Setup objetivo 79 · Apoyos: **Percentil lote 95** · Estructura 100 …
> SIGUIENTE: **Auditar antes**»

1. **«Auditar» está de vuelta.** El encargo retiró el chip «DECISIÓN · AUDITAR» de N0; la
   mesa lo reimprime como estado de cabecera. Mecanismo [CÓDIGO]: `statusLabel` cae a
   `trace?.readiness?.label || origin?.readiness?.label` (`stockDecisionDesk.js:85`) — el
   `readiness` del motor («Auditar», «Vigilar»…) que viaja en el `decisionTrace` de la fila
   [SUPABASE: la fila de WDC del scan de la mañana trae `readiness: {label: "Auditar"}`,
   `action: "Riesgo alto"`, `confidence: "Muy baja"`]. Y el brief pinta
   `nextAction: "Auditar antes"` tal cual. La retirada del principio 1 se hizo en el chip y
   no en la fuente: **el mismo veredicto, en la misma pantalla, dos bloques más abajo**.
2. **«Percentil lote 95» como TESIS.** La narrativa de la mesa usa los drivers del motor,
   que hablan en jerga interna (percentil del lote — el número que `lib/rsCanonical.js`
   prohíbe mostrar bajo el nombre RS; aquí sale con su nombre de arquitectura).
3. **Dos formatos numéricos a 200 px** [REPRODUCIDO]: la mesa escribe «MA50/200 · 46.5% /
   76.4%» (`pctValue` local con `toFixed`, `stockDecisionDesk.js:49-52` — punto decimal) y
   N1, justo debajo, «+46,5% · +76,4%» (capa es-ES). La misma métrica, con y sin coma, en
   la misma pantalla.
4. **Lo legítimo de la mesa está al fondo.** La clasificación del USUARIO
   (Candidata/Vigilar/Descartar + nota + Reabrir) es exactamente lo que el principio 1
   permite — y está enterrada tras el foco, el brief, las evidencias, la «coherencia
   gráfico» y los presets. Además **solo existe con origin**: por URL directa no hay forma
   de clasificar un valor. La decisión del usuario depende de por dónde entró.
5. Los **presets de vista del gráfico** (Vista método D·1A / entrada D·3M / contexto W·2A)
   son útiles y honestos — de lo mejor de la mesa.

## A3. N1 — Lectura técnica: cuatro datos que no son lo que dicen ser

La tabla de 8 filas es la idea correcta (clave-valor, sin color, máximo 8). Pero
[REPRODUCIDO en las cuatro fichas]:

| Fila | Lo que muestra | Lo que es de verdad |
|---|---|---|
| «ATH» | «-36,4%» (WDC) | **Distancia al máximo de 52 semanas**, no al histórico: `technicalSnapshotFromBars` usa `last252` barras (`StockClient.jsx:1180,1184`) y la fila lo etiqueta «ATH» (`:1964`). La tabla del screener llama a este mismo dato «Dist. máx 52s». Para un valor que cotice a -3% de su 52w pero -50% del ATH real, la ficha diría «ATH -3%». |
| «PIVOT» | «-36,4%» (WDC) · «-2,7%» (HBB) · «-4,0%» (YARW) · «-3,8%» (AEXA) | **Idéntico al «ATH» en 4 de 5 fichas** (en ARRY es la distancia al máximo de 50d). El «pivote» del detector sigue siendo un máximo reciclado — el defecto que el principio 7 predijo y por el que aplazó la columna en la tabla; la ficha lo muestra con décimas. |
| «BASE» | «13.0 sem» | **En las CINCO fichas el mismo 13.0** (WDC, HBB, ARRY, YARW, AEXA; también ARRY en el nocturno [SUPABASE: `baseWeeks: 13`]). No es la duración de la base de cada valor: es la ventana fija del detector (~65 sesiones) devuelta como medida. Un número constante con un decimal de precisión — «un número falso con aspecto de preciso es peor que no tenerlo» (principio 7). Además «13.0» con punto: `toFixed(1)` fuera de la capa es-ES (`:1949`). |
| «MA50/MA200» | «+46,5%» | El dato es correcto (distancia a las medias), pero el nombre añade la **cuarta convención** de nomenclatura de medias del producto (screener «SMA50», salud «MM30», mesa «MA50/200», N1 «MA50»). |

Lo que N1 **no** tiene y un operador esperaría: el volumen. `technicalSnapshotFromBars`
calcula `relativeVolume50` (`:1191`) y ninguna fila lo usa — el dato de demanda del método
(volumen relativo) se computa y se tira, mientras la fila 2 la ocupa «RS QUALITY», un score
compuesto propio.

## A4. N2 — Contexto: una sección con el nombre grande y el contenido vacío

[REPRODUCIDO] En URL directa, la narrativa de WDC/ARRY es solo: «RIESGO — base reciente no
confirmada»; la de AEXA: «RIESGO — **1 contracción útil**». Mecanismo [CÓDIGO]: sin origin,
`narrative.riesgo` cae a `setupDisplay?.reason` (`:1899`) — la razón interna del detector de
patrones como «riesgo» de la tesis. «1 contracción útil» no es un riesgo: es el estado del
contador de contracciones. La sección Contexto, para el 100% de las aperturas por URL, es
una etiqueta de jerga o el vacío («Sin narrativa del screener para esta ficha»).

Los «Fundamentales operativos» (Ventas YoY, EPS YoY, Cap.) sí funcionan y con ausencia
honesta («-» en AEXA) [REPRODUCIDO].

## A5. N3 — Auditoría: el título del primer cajón es falso y el gate del plan quedó huérfano

1. **«Desglose del score» no desglosa EL score** [REPRODUCIDO + CÓDIGO]. El primer
   `<details>` (`:291`) muestra Base/rango, Compresiones, Última comp., Rango 10d, Pivot,
   Volumen seco y «Score patrón» — el desglose del PATRÓN VCP (`n3ScoreBreakdown`,
   `:1999-2009`). El score que ordena listas y filas (el compuesto de doce términos) no se
   desglosa en la ficha en absoluto (ver B.8). El usuario que abra «Desglose del score»
   buscando por qué su valor puntúa 64 encuentra la anatomía de otra cosa. Y dentro, otro
   formato con punto: «1.02x» (`toFixed(2)`, `:2006`).
2. **El gate «Plan: No válido» sobrevivió al plan** [REPRODUCIDO + CÓDIGO]. «Metodología y
   gates» conserva la fila `Plan · Válido/No válido` (`MethodologyAuditPanel`, `:1434`) —
   pero el «Plan de operación» se retiró de la ficha (el comentario de `:592-598` lo
   documenta). Un gate que evalúa la validez de un panel que ya no existe es el «espacio mal
   aprovechado tras la retirada» que el encargo pedía buscar: para el usuario, «Plan: No
   válido» ya no se refiere a nada visible.
3. **Marcas de fiabilidad pegadas al texto** [REPRODUCIDO]: «ETAPA Base**!**», «PLAN No
   válido**X**» — los `MetricSourceMark` (p/!/x) se leen como parte de la palabra
   («válidoX»). En el panel RS: «GRUPO 90**!**», «RS BENCH 74**P**» — el sufijo «P» sigue
   sin leyenda en ninguna parte (señalado el 14, sigue).
4. Lo que está bien: el **Bloque empresa** usa por fin la taxonomía unificada
   (Sector Technology / Subsector Computer Hardware / Tema Consumer tech-hardware ✓
   [REPRODUCIDO], comentario `:325-328`), y «Calidad de datos» es descriptivo y honesto.

## A6. Paneles inferiores: los que se ganan el sitio y los que no

- **Fuerza relativa** [REPRODUCIDO]: la contradicción nueva del RS unificado. En YARW (sin
  ranking): «RS GLOBAL — Sin dato!» junto a «**RS PAÍS 99 · GRUPO 99**». El RS global se
  unificó al semanal (ausencia honesta ✓), pero país y grupo siguen siendo percentiles del
  LOTE del escaneo, pintados con la misma ropa y la misma escala 1-99 al lado del global
  ausente. El lector razonable concluye «no está en el ranking pero es el 99 de su país» —
  dos afirmaciones incompatibles (si sus barras no bastan para el ranking del universo,
  tampoco sostienen un percentil de país; y en un producto US-only, país = universo, ver
  ARQUITECTURA). El panel además repite `n=4868` que ya está en la cabecera (principio 5) y
  suma 12 métricas más los cuatro grupos — la ficha muestra el RS en cuatro superficies
  (franja, N1, badge del chart, panel).
- **Contexto comparativo**: sigue siendo la tabla de negaciones del 14 (columnas
  Estructura/Contracciones/Base/Pivot/Vol. seco con «No validado» en cadena) — sin cambios.
- **Acciones similares** [REPRODUCIDO]: para WDC devuelve **Xiaomi (1810.HK)** — ver
  ARQUITECTURA.
- **Fundamentales históricos**: el mejor panel de la mitad inferior — trimestres/años,
  Resumen/Resultados/Balance/Cash flow, formato correcto, ausencia honesta. Se queda.
- **Noticias**: correcto tras la limpieza («sesgo heurístico» con tilde ✓, publisher
  filtrado). **Pulso X**: bien resuelto — desaparece si no hay integración (`:1300-1305`).

## A7. La ficha por tipo de valor

- **Fuerte (WDC)**: chip «BASE» con RS 98 y +532% — defendible (consolida tras la subida)
  pero el conjunto cabecera («BASE» + setup 0/5 + «base reciente no confirmada» como
  riesgo) le dice al usuario que el líder nº 43 del universo «no tiene nada». Falta la
  frase descriptiva que un operador daría: «consolidando sobre su MA200 tras +532%».
- **Débil (ARRY)**: la mejor ficha de las cuatro — «ETAPA 4», RS 13, MA50 -22,6%: coherente
  y disuasoria sin ordenar nada.
- **Sin RS (YARW)**: la ausencia se maneja bien en N1 («—» con motivo) y mal en la franja
  («n=0») y en el panel RS (país/grupo 99).
- **Pocos datos (AEXA, SPAC)**: la ficha pinta el esqueleto COMPLETO — doce secciones — para
  un cascarón sin negocio: «ETAPA 2» para la curva plana de un trust a 11,54$, fundamentales
  vacíos, comparativo vacío. El chip de etapa afirma una fase de ciclo que un SPAC no puede
  tener. El estado `StockUnavailableBlock` existe para el símbolo SIN datos (`:105-119`,
  bien resuelto), pero no hay estado intermedio «instrumento no clasificable» — mismo
  problema de raíz que los «Shell Companies (18)» pasando el filtro del screener.

---

# PARTE B — Coherencia con el resto

## B6. ¿Coinciden los datos con el screener? El número principal sí; la fuente, a veces no

Comparación tabla (scan 09:50 restaurado) vs ficha [REPRODUCIDO]:

| Símbolo | Tabla: RS / Etapa / Cap | Ficha: RS / Etapa / Cap | ¿Coincide? |
|---|---|---|---|
| HBB | 94 / Etapa 2 / 433M | 94 / Etapa 2 / 433M | ✓ |
| ARRY | (nocturno: semanal 13) | 13 / Etapa 4 | ✓ |
| YARW | «– Sin dato» / Etapa 2 / 110,6M | «—» / Etapa 2 / 111M | ✓ (110,6M vs 111M: redondeo de `cap`, no divergencia) |

**La unificación del RS canónico y de la etapa funcionó entre superficies** — el hallazgo
central de coherencia del 14 está corregido. Pero encontré su límite aguas arriba
[SUPABASE]:

- `rs_weekly_items` tiene **tres snapshots para la misma semana W32** (snapshot_date 07, 08
  y 09 de agosto). El del 08-ago está **calculado sobre cierres del 5 de junio** (WDC:
  close 527,18$ con `fx_date 2026-06-05`, retorno 52w +962%) — dos meses viejo — y asigna
  rating 99; los otros dos, sobre el cierre real de 434,30$, asignan 98.
- El lector canónico (`lib/globalRs.js:25`, `order=snapshot_date.desc`) elige el 09-ago
  (98) como «latest» → el número principal es consistente en todas las superficies ✓.
- Pero la **serie** que el brief entrega al pane RS del gráfico conserva los tres puntos:
  `…2026-08-07: 98, 2026-08-08: 99, 2026-08-09: 98` [REPRODUCIDO vía
  `/api/company-brief?symbol=WDC`] — una serie semanal con tres valores en una semana, uno
  de ellos de datos viejos, dibujada como diente de sierra en el panel. Y cualquier lectura
  «top de la semana» ordenada de otra forma (mi primera consulta a Supabase la devolvió)
  sirve el snapshot corrupto. El deduplicado por `week_key` no existe en el lector
  (`globalRs.js:43-56` filtra por engine, no por semana).

## B7. Vocabulario: lo que se escapó del barrido

Confirmo primero lo corregido [REPRODUCIDO]: precios/porcentajes es-ES en N0/N1/N2 y
fundamentales; «Etapa 2/4» con diccionario único en chip, N1 y tabla; Tema/Sector/Subsector
unificados en N3; «sesgo heurístico» con tilde; la frase de razón de Listas ya usa el RS
canónico (GEO: frase «RS 92» = columna 92 ✓). Se escapó:

| Dónde | Qué | Cita |
|---|---|---|
| Kicker N0 | «TECHNOLOGY · NASDAQGS» — sector proveedor y sufijo de exchange crudos | `StockClient.jsx:153` |
| Franja N0 | «Cobertura util» sin tilde (el servidor la emite; otros módulos escriben «útil») | `company-brief/route.js:610` |
| Mesa | «OBSERVACIÓN: BLOQUEADO · AUDITAR», «Auditar antes», «Percentil lote 95» como tesis | `stockDecisionDesk.js:85` + trace [SUPABASE] |
| Mesa | «extension SMA50 44.7%» — sin tilde y con punto decimal | volcado DOM + `screenerFilters.js:365` |
| Mesa vs N1 | «46.5%» vs «+46,5%» — punto y coma para la misma métrica en la misma pantalla | `stockDecisionDesk.js:49-52` |
| N1 | «13.0 sem» y «1.02x» con punto | `StockClient.jsx:1949,2006` |
| N1 | «ATH» para el máximo de 52 semanas; «MA50» como cuarta convención de nombre de medias | `:1964,1180-1184` |
| Panel RS | Sufijos «P» y «!» pegados al número, sin leyenda | `metricSourceState`, `:407-420` |
| N3 | «Base!», «No válidoX» — marcas fundidas con la palabra | `:1433-1434` |
| Import muerto | `ScreenerOriginPanel` importado y jamás renderizado en la ficha | `StockClient.jsx:5` |

## B8. El desglose del score que imputa cero: qué ve el usuario de verdad

Lo que el análisis del compuesto midió (residual mediano de **21,8 puntos** en filas
ligeras, con la regla `points = Number.isFinite(source.value) ? source.value * item.weight
: 0` de `lib/screenerScoreAudit.js:117`) se comprobó así en pantalla:

1. **En la ficha, ese desglose NO se muestra** — ni con residual ni sin él. La ficha no
   monta `ScoreAuditPanel` (el import de su contenedor, `ScreenerOriginPanel`, está muerto
   — `StockClient.jsx:5`, cero usos). Lo único titulado «Desglose del score» es el desglose
   del patrón (A5.1). El usuario de la FICHA no puede ver hoy ni la versión correcta ni la
   incorrecta del desglose del compuesto.
2. **Donde sí se ve es en el modal de revisión** (QuickReviewModal → `ScoreAuditPanel`)
   [REPRODUCIDO sobre BANL]: «SCORE AUDIT — Score 70 · calc 69.9 · **Δ 0.0** · Percentil
   lote +15.8 · Setup +13.5 · Demanda +9.9 · IPO 0 · Growth 3». Con la fila COMPLETA del
   scan de servidor los componentes existen y el residual es ~0 — el desglose cuadra.
3. **El residual de 21,8 pertenece a las filas ligeras del nocturno** (las que alimentan
   Listas y el snapshot restaurado del producto futuro). En pantalla, el usuario no ve el
   número 21,8: ve sus síntomas — los chips «Obj**0** p0 **!2** x1» de cada fila de Listas
   [REPRODUCIDO con GEO] (cero métricas objetivas verificables, dos alertas) y, cuando el
   desglose se abre sobre una fila ligera, el estado «Revisar fórmula»
   (`screenerScoreAudit.js:222`) con todos los componentes ausentes a «+0,0».
   [CÓDIGO+doc del compuesto; no reproducido en vivo porque ninguna superficie de mi
   sesión abrió el panel sobre fila ligera.]

La conclusión para la ficha: cuando el desglose del compuesto entre en ella (debería —
es la explicación del número que ordena las listas), tiene que llegar con la corrección de
la imputación, no antes; y el cajón actual debe dejar de llamarse «Desglose del score».

---

# PARTE C — Navegación

## C9. Ficha compartible y navegación entre valores

- **La ficha compartible sigue sin existir** [REPRODUCIDO]: ningún control de compartir o
  exportar imagen en las cuatro fichas (la cosa nº 5 del MVP, «distribución», sigue siendo
  la única completamente ausente).
- **La navegación entre valores sigue acoplada a la cola de Review — y ahora sé que además
  falla en silencio.** La cadena verificada:
  1. El rail Anterior/Siguiente (`StockReviewFlowRail`) solo se monta con cola
     (`navigation.totalRows`, alimentado EXCLUSIVAMENTE de `STORAGE_KEYS.review` —
     `buildReviewQueueNavigation`, `lib/reviewQueueNavigation.js:52-55`).
  2. Abrir una ficha desde la tabla NO crea cola → sin rail [REPRODUCIDO con HBB].
  3. Pasar por «Revisar» SÍ escribe la cola (`useQuickReviewSession.js:91`)… con
     `safeWrite`, que **traga el error de cuota y devuelve `false` sin avisar**
     (`lib/localState.js:25-33`, su propio comentario: «localStorage can fail… when a large
     screener session exceeds quota»).
  4. En mi sesión, con `screenerSession` en **31,7 MB** y `scans` en **19,8 MB** de
     localStorage, el write de la cola falló: tras abrir el modal (cola «1/282» en
     pantalla), la clave `statsedge.review.v1` **no existe** [REPRODUCIDO] → la ficha de
     HBB abierta después no muestra el rail. El único mecanismo de navegación del producto
     depende de un write de varios MB que compite por cuota con una sesión gigante, y
     cuando pierde, la función desaparece sin mensaje.

**Cómo debería ser** (mantengo y concreto la propuesta del 14): la ficha navega por **la
lista visible de la que vienes** — el contexto de origen ya viaja (`lastOpenedStockContext`)
y basta con que incluya la lista ordenada de símbolos visibles (no las filas enteras: solo
símbolos), de modo que Anterior/Siguiente sea `symbols[i±1]` sin cola paralela, sin review
state y sin depender de la cuota. La cola de Review queda para el flujo de Review; la ficha
no debería saber que existe.

## C10. Volver al screener conservando el estado

- **Los datos y filtros se conservan** [REPRODUCIDO]: ficha → `history.back()` → «Sesión
  restaurada: 282 acciones en el screener», con el mismo preset y orden. La persistencia de
  sesión cumple.
- **El scroll**: el mecanismo existe (`saveSessionBeforeStockOpen` guarda `scrollY` en el
  pointerdown del ticker; el screener lo reaplica con doble RAF + reintentos a 150/500 ms,
  `app/page.jsx:594-611`). En mi entorno volvió a `scrollY: 0` — pero mi scroll guardado
  ERA 0 (el panel embebido no scrolleó físicamente), así que **no es concluyente** ni a
  favor ni en contra.
- **El botón contextual de vuelta no existe** por el bug de A1.1 — hoy se vuelve por la
  barra de navegación global o con atrás del navegador.

---

# PARTE D — La pregunta abierta: ¿es esta la ficha?

La jerarquía N0–N3 es correcta como principio (lo primero identidad/fase, lo último
auditoría). Lo que la estructura actual no resuelve es **para quién es cada bloque en cada
momento**. La ficha real de un operador de tendencia tiene tres preguntas, en este orden:

1. **¿Qué es y en qué fase está?** → N0 actual (identidad, precio, etapa) + gráfico.
   Ya existe y está bien ordenado (el gráfico segundo, como pidió el dueño).
2. **¿Qué dicen los datos?** → UNA tabla técnica, no tres. Hoy la lectura técnica está
   repartida entre N1 (8 filas), la mesa (RS/MA50-200/benchmark otra vez) y el panel
   Fuerza relativa (12 métricas más abajo, con el mismo RS por cuarta vez). Fusionarlas en
   una sola superficie de ~10 filas: RS (semanal, uno), etapa, MA50/MA200 —con el nombre
   unificado del producto—, distancia al máx 52s (bien etiquetada), volumen relativo (hoy
   calculado y tirado), extensión, y los 3M/6M/12M vs benchmark. El panel RS como sección
   separada desaparece; RS Quality y el riesgo técnico (scores propios) van a N3 con el
   resto de lo compuesto.
3. **¿Qué hago yo con esto?** → la decisión DEL USUARIO: Candidata/Vigilar/Descartar +
   nota + historial, **siempre presente** (no solo con origin — hoy por URL no puedes
   clasificar), compacta, cerca de la cabecera. Y la navegación de contexto
   (Anterior/Siguiente de la lista visible + volver). La mesa del sistema entera —foco,
   evidencias, briefs, «BLOQUEADO · AUDITAR»— o se reduce a hechos descriptivos sin verbo
   (los mismos checks, sin «Auditar antes») o se va detrás del flag de herramientas
   internas con Review y Research (la recomendación C2 del análisis del 14 aplica
   idéntica aquí).

Con ese orden, la mitad inferior queda: N3 (auditoría, con el desglose del compuesto
corregido cuando llegue), fundamentales históricos, noticias, similares — y dos bloques
salen del defecto: el comparativo de negaciones (vuelve cuando el detector valide algo) y
el desglose del patrón como «score» (pasa a llamarse «Estructura de base» dentro del
diagnóstico VCP).

**La pieza nueva que falta no es un panel: es la ficha compartible** (cosa nº 5). El
contenido ya está todo en N0+N1: identidad, etapa, RS, rendimiento, miniatura. Es una
composición de lo existente en formato imagen — la única función de la lista del MVP que
no tiene ni un esbozo, y la que el doc de principios llama «distribución».

---

# CONSIDERACIÓN DE ARQUITECTURA — dos versiones (US pública / internacional privada)

Lo que hoy está incrustado en la ficha y debería ser parámetro de edición:

1. **`BENCHMARK_OPTIONS` en el cliente** (`StockClient.jsx:1222`): `["SPY", "QQQ", "ACWI",
   "IWM", "^GSPC", "^IXIC", "^N225", "^HSI", "^STOXX50E", "^AXJO"]` — Nikkei, Hang Seng,
   Stoxx y ASX cableados en el JSX. La edición US no debería ofrecer (ni resolver contra el
   proveedor) benchmarks de mercados sin licencia; la internacional necesitará otros. Es
   una lista de producto, no una constante de componente.
2. **`/api/similar` devuelve valores fuera de cobertura** [REPRODUCIDO]: la ficha de WDC
   lista Xiaomi (`1810.HK`) como similar clicable — que abrirá una ficha de un mercado que
   la edición pública no puede servir. El endpoint necesita el filtro de mercados
   activos (el mismo parámetro que ya limita el universo del screener).
3. **«RS país» en el panel RS**: en un producto US-only, país ≡ universo — la fila es
   redundante hoy y solo significa algo en la edición internacional. Su presencia/ausencia
   debería colgar del mismo parámetro de cobertura, no estar siempre.
4. **La franja de calidad y los textos de ausencia** ya son neutrales al mercado ✓, y el
   `StockUnavailableBlock` menciona «mercado fuera de cobertura» como causa — correcto
   para ambas ediciones.

---

# Propuesta priorizada

### Arreglar ya (pequeño)

| # | Qué | Por qué |
|---|---|---|
| A1 | El guard `actions && actions.length` (`:199`) → `actions` a secas (o array) | Resucita «Screener» y «Web oficial»; es un if |
| A2 | «ATH» → «Dist. máx 52s» (mismo nombre que la tabla) | Deja de afirmar un máximo histórico que no se mide |
| A3 | BASE «13.0 sem»: no mostrar `baseWeeks` cuando `consolidationCandidate !== true` (hoy es la ventana del detector) — guion con motivo | Principio 3; elimina la constante disfrazada en 5/5 fichas |
| A4 | «RS · n=0» de la franja: sin semanal → «Sin ranking» (no fecha + n=0) | Principio 3; deshace la contradicción con el panel RS |
| A5 | Kicker con el mapa de nombres del producto (Tema/exchange legible) | La primera línea de la ficha, en el idioma del producto |
| A6 | Formatos con punto (13.0 / 1.02x / 46.5% de la mesa) → capa es-ES | Tres citas concretas; cierra B4 del 14 en la ficha |
| A7 | Retirar el gate «Plan» de Metodología y gates; retirar el import muerto de `ScreenerOriginPanel` | Huérfanos de la retirada del plan |
| A8 | Renombrar el cajón «Desglose del score» → «Estructura de la base (VCP)» | Deja de prometer el desglose del compuesto |
| A9 | Setup 0/5 en N0 → una frase corta; la lista de faltas, al desglose | La cabecera deja de ser una lista de negaciones |
| A10 | Deduplicar la serie RS por `week_key` en el lector (`globalRs.js`) | Un punto por semana; el diente 98→99→98 desaparece de la ficha (el snapshot corrupto del 08-ago es asunto del motor, aparte) |

### Mejora mayor (decisión de producto)

| # | Qué | Por qué |
|---|---|---|
| B1 | Desacoplar el veredicto del origin: la mesa no imprime `readiness/action` del motor («Auditar», «Bloqueado», «Auditar antes»); hechos descriptivos o flag interno | Es la misma retirada del principio 1, terminada — hoy está hecha a medias |
| B2 | La clasificación del usuario siempre disponible (sin origin) y compacta | La única «decisión» legítima del producto no puede depender de la ruta de entrada |
| B3 | Navegación por lista visible (símbolos en el contexto de origen), rail sin cola de Review | C9: mata el acoplamiento y la dependencia de la cuota de localStorage |
| B4 | Fusión N1 + panel RS en una tabla técnica única (con volumen relativo; sin RS repetido) | Un dato, un sitio; libera la mitad inferior |
| B5 | Ficha compartible (imagen de N0+N1+miniatura) | Cosa nº 5 del MVP; distribución |
| B6 | Estado «instrumento no clasificable» (SPAC/shell/trust): ficha reducida sin etapa ni setup | AEXA «Etapa 2» es una afirmación falsa del clasificador; misma raíz que los shells del screener |
| B7 | Parametrizar mercado/cobertura: benchmarks, similares, RS país (ver ARQUITECTURA) | Prerrequisito de las dos ediciones |
| B8 | Presupuesto de persistencia: sesión/cola no pueden sumar 50 MB de localStorage con writes que fallan en silencio — mover filas pesadas a IndexedDB o recortar la proyección de sesión, y que `safeWrite` avise cuando pierde | El fallo silencioso de C9 es hoy irreproducible para el usuario: «a veces no hay flechas» |

---

# CONFIANZA

| Hallazgo | Confianza | Base |
|---|---|---|
| Bug `actions.length`: botones de N0 nunca renderizados | Alta | Código citado + DOM vacío en 4 fichas |
| «Auditar»/«Bloqueado» resucitados en la mesa con origin | Alta | Reproducido con HBB + `stockDecisionDesk.js:85` + trace en Supabase |
| BASE 13.0 constante = ventana del detector | Alta el hecho (5/5 fichas + nocturno); Media el mecanismo exacto (no tracé el detector) | Reproducido + `baseWeeks: 13` en filas [SUPABASE] |
| «ATH» = máx 52 semanas; PIVOT = máximo reciclado | Alta | Código (`last252`, `:1964`) + 4/5 fichas con PIVOT=ATH idénticos |
| «RS n=0» en símbolos sin ranking | Alta | Reproducido (YARW, AEXA) + mecanismo citado (`route.js:626`, `:180`) |
| Tres snapshots W32, uno con cierres de junio; serie con diente 98→99→98 | Alta | [SUPABASE] filas completas + serie de `/api/company-brief` [REPRODUCIDO] |
| RS/etapa/cap coherentes tabla-ficha | Alta | Reproducido en 3 símbolos |
| B8: desglose del compuesto ausente en ficha; Δ 0.0 con fila completa; síntomas en Listas | Alta lo reproducido; el residual 21,8 es del doc del compuesto (no re-medido) | Modal BANL + chips GEO + citas |
| C9: cola de Review no escrita por cuota → rail ausente | Alta el hecho (clave ausente tras abrir modal, rail ausente); Media-alta la causa exacta (cuota) — safeWrite silencia el error concreto | Reproducido + `localState.js:25-33` + 51 MB medidos |
| C10: sesión y filtros se conservan al volver | Alta | Reproducido |
| C10: restauración de scroll | No concluyente | Mi scroll guardado era 0 (limitación del panel embebido) |
| Similar 1810.HK fuera de cobertura | Alta | Reproducido en WDC |
| Juicios de D y propuesta | — | Diseño argumentado, discutible por diseño |

# LO QUE NO HE VERIFICADO

- **La restauración del scroll al volver** (C10): el mecanismo existe y está citado; mi
  entorno no pudo generar un scroll real que restaurar.
- **El interior del gráfico** (deliberadamente fuera): solo constaté que las temporalidades
  intradía siguen ofrecidas en la botonera — la propuesta C2 del análisis del gráfico de
  retirarlas sigue pendiente, sin re-analizarla aquí.
- **El residual 21,8 re-medido**: cito el análisis del compuesto; no recalculé la mediana ni
  abrí el ScoreAuditPanel sobre una fila ligera en vivo (ninguna superficie de mi sesión lo
  monta sobre el nocturno).
- **Móvil**: todo el recorrido fue de escritorio 1280 px.
- **El flujo Review completo** (resolver desde la ficha, cola con filtros de resolución):
  bloqueado en mi entorno por el fallo de cuota — precisamente el hallazgo C9; no pude
  ejercitar el rail funcionando.
- **La cuota exacta de localStorage del navegador embebido**: medí 51,5 MB aceptados y el
  write siguiente perdido; no determiné el límite preciso ni si un Chrome de usuario real
  (5-10 MB típicos) permitiría siquiera la sesión de 31 MB — en un navegador estándar el
  producto viviría en el fallback compactado permanentemente, un régimen que no probé.
- **SSR vs cliente**: `page.jsx` sirve `initialData` con timeout de 4,5 s; no medí cuántas
  aperturas caen al timeout ni la diferencia de experiencia entre ambas rutas.
- **El pane RS dibujado píxel a píxel** (el diente): verifiqué la serie servida, no el
  render exacto del panel.
