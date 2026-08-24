# Vista rápida y cola de revisión: inventario y contradicciones — 2026-08-24

Base: `codex/statsedge-ui-polish` @ `7518448` (árbol limpio). Solo análisis;
ningún cambio de código, ningún commit, ninguna escritura en Supabase.

## Método y entorno

- Lectura completa de `docs/principios-producto.md` y
  `docs/analisis-ficha-cuadro-grafico-2026-08-21.md`, y del código de las dos
  superficies: `QuickReviewModal.jsx`, `useQuickReviewSession.js`,
  `app/review/page.jsx`, `ScreenerOriginPanel.jsx`, `ReviewWidgets.jsx`,
  `PerformanceStrip.jsx`, `RowPriceChart.jsx`, `lib/screenerExplainability.js`,
  `lib/decisionProfile.js`, `lib/decisionAudit.js`, `lib/screenerScoreAudit.js`,
  `lib/stockDecisionResolution.js`, `lib/rsCanonical.js`,
  `lib/scanLightProjection.js`, `lib/screenerDomains/audit.jsx`,
  `lib/screenerMarket.jsx`, `app/UniversalPriceChart.jsx`,
  `app/useChartController.js`.
- Instancia aislada: árbol copiado con rsync al scratchpad, `node_modules`
  enlazado, servidor propio en **:3500** (PID gestionado por el panel, cerrado
  por PID exacto al terminar; puerto verificado libre después). En la copia se
  retiraron `STATSEDGE_ACCESS_TOKEN`, `CRON_SECRET` y
  `STATSEDGE_SESSION_SECRET` para operar en el modo abierto de desarrollo
  (`lib/internalAuth.js:57` exige que no haya NINGÚN token). No se tecleó
  ninguna credencial.
- Población: el arranque normal del producto restauró el **nocturno US del
  2026-08-24** desde la nube (3.309 filas, scan `fbbeaf12`), sin ejecutar
  ningún escaneo. La vista rápida se abrió pulsando la fila de AVAH en la
  tabla; la cola de revisión por URL (`/review?source=latest`).
- **Coste de proveedor — transparencia**: no se abrió ninguna ficha (0
  llamadas a `/api/company-brief` en los logs del servidor). La cinta móvil de
  índices de la home disparó 4 GETs a `/api/chart` de índices globales
  (000001.SS, ^BVSP, ^MXX, ^J203.JO); pasan por la misma caché
  (`writeDailyBarsCache`) y pueden haber refrescado el `updated_at` de esos 4
  índices. Las peticiones de chart de símbolos se abortaron en el cliente y no
  llegaron al servidor.
- **Limitación dura de esta sesión**: el panel del navegador quedó oculto casi
  toda la verificación y un panel oculto reporta viewport 0×0 — no compone, no
  captura, y la home renderizó su superficie móvil. Todo lo etiquetado
  [REPRODUCIDO] es texto del DOM real de la instancia (vía extracción
  directa), no captura de pantalla. Las afirmaciones de píxeles o composición
  visual quedan fuera (ver LO QUE NO HE VERIFICADO).

Etiquetas: **[REPRODUCIDO]** leído del DOM en runtime; **[CÓDIGO]** afirmación
con cita; **[SUPABASE]** consulta de solo lectura (PostgREST, tabla+filtro
citados); **[INFERIDO]** derivado, no trazado en runtime.

---

# PARTE A — Inventario

## A1. Vista rápida (modal del screener)

Se abre al pulsar una fila (`lib/screenerTable.jsx:67` →
`openReview(resultsFiltered, symbol)`, `ScreenerShell.jsx:483`). Componente:
`app/components/screener/QuickReviewModal.jsx`; estado:
`useQuickReviewSession.js`; los props `modal*` se calculan en
`app/page.jsx:1739-1795` sobre la fila y la cola.

| # | Bloque (código) | Qué muestra hoy (AVAH, reproducido) | Datos | Veredicto |
|---|---|---|---|---|
| 1 | **Cabecera** (`quickReviewHeader`) | Logo, breadcrumb «Screener / Vista rápida / 1 de 10», AVAH + nombre, «13,16 USD +71,6% 3M», Anterior · 1/10 · Siguiente, Ficha, TradingView, Cerrar | fila | **Información legítima** (identidad + navegación). El contador aparece 3 veces en el mismo modal (breadcrumb, botonera, bloque origen) |
| 2 | **Origen cola** (`quickReviewSourceBrief`) | «ORIGEN COLA · Revisión Screener · 10 acciones abiertas desde el Screener · 10 ACCIONES · 1/10» | localStorage review | Meta-información repetida; el dato útil (fuente) cabe en el breadcrumb |
| 3 | **Panel de origen** (`ScreenerOriginPanel`, variant review) | «CONTRATO LARGO · Líderes con sesgo largo…», lectura «ACCIÓN Auditar antes · CONFIANZA Muy baja 13 · FRENO Requiere auditar datos», meta «base · modo · decision Auditar · confianza Muy baja 13 · **prioridad 235** · cola 1/10», status «Auditar: **Riesgo severo: requiere revisión manual antes de entrar en cola**», «DATOS Bloqueado · Cob 96 · **Métricas objetivas bloqueadas**», «MÉTRICAS Métricas bloqueadas · Bloq. · 3 medidas · **2 proxy**», snapshot «SCORE 83 ×· **RS 95** · A/D 100 p · EPS 58 p», «SCORE AUDIT Score 84 · calc 84.0 · Δ −0.0 · Percentil lote +16.9 · Setup +15.9 · Demanda +11.1 · **Growth sin dato**», tesis/riesgo/siguiente («Auditar antes»), pruebas, issues, Ranking/Impulsa/Vigilar | motor de decisión (`buildScreenerStockContext`) | **Veredicto operativo + estado interno, todo junto.** Es la mesa de observación que se retiró de la ficha el 22-08, resucitada en el modal: el mismo contexto de origen con acción, confianza, freno y prioridad. El principio 1 prohíbe la mitad y el principio 2 la otra mitad |
| 4 | **Rail de resolución** (`quickReviewResolveRail`) | «RESOLVER COLA · Reabrir · Candidata · Vigilar · Descartar» | escribe localStorage | **Flujo de trabajo real** (ver C9). Conservar |
| 5 | **Barra de tesis** (`reviewThesisBar`, solo sin `origin.decisionBrief`) | Badges de acción + readiness + línea de drivers | `explainScreenerRank` | Veredicto operativo (condicional; en la sesión reproducida no montó porque el panel de origen ya lleva el brief) |
| 6 | **Cola lateral** (`screenerReviewQueue`) | Rails de resumen: «10 DATOS BLOQUEADOS · 10 SCORE REVISAR · 10 PRUEBAS BLOQUEADAS» (auditoría), «2 AUDITAR · 8 VIGILAR» (prioridad), «10 RESTO» (perfil), grupos por decisión; lista con hasta **9 chips por fila**: trust «OBJ 3 · P 2 · ! 1 · X 4», badge «Auditar antes», resolución, «Foco Datos», prioridad «Auditar», perfil, «Método: Riesgo operativo», «Bloqueados», «Bloq.», «Incompleto», riesgo «Extendida SMA50 38.2%», score 83; tooltip con jerga cruda («Score: unverified-value») | `buildDecisionQueueItem` + 6 fábricas más por fila | **Veredicto operativo + estado interno en densidad máxima.** Cuando el resumen marca a las 10 filas como bloqueadas a la vez, además, deja de discriminar |
| 7 | **Zona central** (`ChartPreferences` + `RowPreviewChart` + `PerformanceStrip`) | Preferencias del chart; gráfico (que hoy dice «Sin dato», ver B2); «3M +71,6% · 6M +79,3% · 12M +82,8%» | fila + `/api/chart` | **Información legítima — es el corazón de la vista** y es lo que falla |
| 8 | **Prioridad de investigación** (`ReviewPriorityPanel` compact) | «Bloqueadas · Auditar antes: Requiere auditar datos · **235** · DECISION **260** · ACCIÓN **−80** · SCORE OBJETIVO **183** · −150 Requiere auditar datos · −130 Extendida sobre SMA50» | `decisionPriorityBreakdown` | **Estado interno puro.** 260 y −80 son constantes del motor (`lib/decisionAudit.js:337-372`: audit=260, high-risk=−80); «score objetivo 183» es `totalScore×2.2` (`:563`); el 235 es la suma menos penalizaciones. Números de ordenación interna presentados como datos del valor |
| 9 | **Pruebas** (`DecisionEvidenceChecklist` compact) | «PRUEBAS · BLOQ. · 3» | checklist metodológico | Estado interno (semáforo del motor) |
| 10 | **Score audit** (`ScoreAuditPanel`) | «84 · calc 84.0 · Δ −0.0 · **Componentes sin dato 1** · **Riesgos score 3**», 11 componentes con puntos («Percentil lote 95 +16.9 · … · Growth − +0.0»), chips «Extendida sobre SMA50 · RS volátil · Fundamentales insuficientes/débiles · **Growth sin dato**» | `buildScreenerScoreAudit` | **Estado interno** (auditoría de la fórmula). En la ficha esto vive en N3 colapsado, que es su sitio; aquí está desplegado en una superficie de lectura rápida |
| 11 | **Negocio** (`quickBusinessCard`) | Resumen, actividad, mercado (Estados Unidos · NasdaqGS) | fila | **Información legítima** |
| 12 | **Métricas técnicas** (`profileCard`) | Capitalización 2,1B · Score 83 × · Composite 84 × · **RS 89** · RS Quality − · A/D 100 p · EPS proxy 58 p · Setup quality 84 · Growth − · Rentabilidad/riesgo 70 | fila + `canonicalRs` | Mezcla: capitalización y **RS canónico** son legítimos; los siete scores compuestos son estado interno (la ficha los mandó a N3) |
| 13 | **Volumen y riesgo** (`profileCard`) | Volumen sesión 111M · Vol 5d +82,6% · Up/down 2,59x · Short float +5,1% · Drawdown 3M 11,9% · Volatilidad 64,9% | fila | **Información legítima** (medidas, no juicios) — aunque volatilidad/drawdown la ficha los movió a N3 |

## A2. Cola de revisión (`/review`)

Página completa (`app/review/page.jsx`, 1.154 líneas), con fuentes «Cola
actual / Último snapshot / Favoritos». [REPRODUCIDO con el snapshot local de
576 filas — la muestra repartida del nocturno, que es lo que esta pantalla ve
en el uso real.]

| # | Bloque | Qué muestra hoy | Veredicto |
|---|---|---|---|
| 1 | Hero + selector de fuente | «Vista rápida» (título), Cola actual / Último snapshot / Favoritos / Screener | Legítimo. (El título de la página es «Vista rápida», el mismo nombre que el modal del screener: dos superficies distintas con el mismo nombre) |
| 2 | KPIs | 576 en cola · posición · revisadas · resueltas ficha · ocultas | Meta del flujo, razonable |
| 3 | Controles | Anterior/Siguiente/Favorito/Revisada/Ocultar/Ver ocultas + atajos j/k/f/Enter/t | **Flujo real.** Conservar |
| 4 | Resumen de cola + facetas | «**357 ESPERAR · 150 AUDITAR · 69 DESCARTAR**»; en «Más facetas»: resolución, estado de pruebas, prioridad, perfil | **Veredicto operativo agregado**: clasifica 576 valores en esperar/auditar/descartar — exactamente el patrón que el principio 7 eliminó de la tabla («El VEREDICTO y toda la maquinaria de fiabilidad de la fila») |
| 5 | Lista de la cola | Por fila: trust signature, «Esperar confirmación»/«Auditar antes», Foco, prioridad, perfil, datos, métricas, score audit, riesgo, digest «PRUEBAS OK 9/9 · Setup objetivo 100 · Setup accionable · Liderazgo global · Contexto sectorial», score | **Veredicto + estado interno**, idéntica maquinaria que la cola del modal (implementación duplicada, ver C10) |
| 6 | Foco central | Identidad, **chart nativo 520px** (`ReviewChartPanel`), nav flotante, **MiniSparkline** del mismo símbolo | Legítimo — con el mismo problema de «Sin dato»/«Sin gráfico disponible» que el modal, y un segundo gráfico (sparkline) redundante con el grande |
| 7 | Panel derecho — prioridad | «Vigilancia · Buen perfil o estructura parcial, pero no es entrada limpia · **889** · DECISION **660** · ACCIÓN **55** · SCORE OBJETIVO **195** · PERCENTIL LOTE **114** · −190 Candidato no operable» (GEO) | **Estado interno puro** (las constantes del motor, otra vez) |
| 8 | Panel derecho — «Decisión Screener» | «TESIS Setup objetivo 100 · Apoyos: Setup/VCP · Percentil lote 95 / RIESGO Short float 10.4% / SIGUIENTE **Esperar confirmación** · Resolver o esperar: …» + «PRUEBAS CONFIRMADAS 9/9» | **Veredicto operativo** («Esperar confirmación» es instrucción de acción; `lib/screenerExplainability.js:707`) |
| 9 | Panel derecho — grid de métricas (`metricRows`) | 18 celdas: Composite 90 · **RS 95** · RS BENCH 95 · **RS PAÍS 95 · RS GRUPO 98** · A/D · EPS · 3M/6M/12M · SMA50 · Vol rel · Volume Effect · Short float · Vol 63d · DD 63d · R/Vol · R/DD | Mezcla, con **la violación del RS canónico** (ver B1): la celda «RS» lee `rsGlobalPct` crudo (`app/review/page.jsx:372`), y RS País/Grupo son los percentiles de lote que la ficha declara ausentes con motivo |
| 10 | Panel derecho — «Evidencia medible» | Etapa («Precio > SMA50 > SMA150 > SMA200»), distancias 20d/52w, extensión, highs spread, volumen relativo, benchmark, deterioro | **Información legítima** (medidas descriptivas) |
| 11 | Panel derecho — notas + resolver + historial | Estado local, resolución de ficha, favorito; «Reabrir · Candidata · Vigilar · Descartar»; historial de decisiones | **Flujo real.** Conservar |
| 12 | Empty states | «Cola pendiente completada», «Sin cola de revisión», con métricas y acciones | Legítimo (empty states contractuales del cutover) |
| 13 | Hidratación invisible (`hydrateReviewRow`) | Por cada fila activa sin preview usable pide `/api/company-brief` (14 s de timeout) y cae a `/api/chart` | **Coste oculto**: recorrer la cola con las flechas dispara una descarga de proveedor por valor — el mismo mecanismo de reescritura de caché documentado el 21-08 en la ficha (`app/api/company-brief/route.js:1256-1265`), aquí sin abrir ninguna ficha |

## A3. Solape con la ficha ya limpia

La ficha quedó (análisis del 21-08) en: cabecera adelgazada, gráfico + franja
(+ cuadro), N3 colapsado, similares, fundamentales históricos, noticias. Las
dos superficies de este análisis:

- **Duplican de la ficha**: identidad y resumen de negocio (franja), etapa con
  evidencia (franja: rail + semana), RS (franja: canónico con n), distancia a
  máximos y extensión (franja: banda de estructura), crecimiento (franja: 6T),
  capitalización (cuadro/franja).
- **Reintroducen lo que la ficha retiró**: el veredicto y su maquinaria (la
  mesa de observación se retiró el 22-08 y el `ScreenerOriginPanel` del modal
  es el mismo contexto de origen con acción/confianza/freno/prioridad); el
  panel de fuerza relativa con país/grupo del lote (retirado de la ficha por
  contradecir a la franja — B6 del 21-08); RS Quality y riesgo compuesto en
  superficie de lectura (la ficha los bajó a N3); el score audit desplegado
  (en ficha, cajón colapsado de N3).
- **Único de estas superficies** (no existe en la ficha): la cola con
  navegación secuencial, los botones de clasificación con historial, y la tira
  de rendimiento de tres periodos como bloque compacto.

---

# PARTE B — Las contradicciones

## B1. «RS 99» arriba y «percentil lote 99» abajo

**Verificada, y es peor de lo que parece: el caso 99/99 es el afortunado.**

- [CÓDIGO] La celda «RS» del grid de `/review` lee el percentil del lote:
  `[metricShortLabel("rsGlobalPct"), num(value(row, "rsGlobalPct")), …]`
  (`app/review/page.jsx:372`), y `metricShortLabel("rsGlobalPct")` es
  literalmente «RS» (`lib/metricCatalog.js:29-33`). Lo mismo hace el snapshot
  del panel de origen del modal: `{ key: "rs", label: "RS", item:
  firstMetricItem(byKey, ["rsGlobalPct", "rsRating"]) }`
  (`app/ScreenerOriginPanel.jsx:188`). `lib/rsCanonical.js:14-23` prohíbe
  exactamente esto: «NO es el RS y no puede mostrarse bajo esa etiqueta».
- [SUPABASE] Con el scan del 24-08 (`scan_results`,
  `scan_id=eq.fbbeaf12-5da6-4ea3-bb52-581a8d0d4fea`,
  `select=symbol,metrics->>rsGlobalPct`) contra el ranking canónico
  (`rs_weekly_items`, `week_key=eq.2026-W32&snapshot_date=eq.2026-08-09`):

  | Símbolo | RS canónico (semanal) | «RS» del lote | Diferencia |
  |---|---|---|---|
  | ANRO, SLS, ORKA, FBRX, ERAS, MGRT, QTTB, SNDK | 99 | 99 | 0 — **el caso que vio el dueño: coinciden por casualidad** |
  | AVAH | 89 | 95 | 6 |
  | AMLX | 94 | 99 | 5 |
  | MRNA | 91 | 99 | 8 |
  | AMAL | 87 | 79 | −8 |
  | **AII** | **56** | **90** | **34** |

- [REPRODUCIDO] En el modal de AVAH conviven **tres valores** para la misma
  idea: «RS 89» en Métricas técnicas (canónico, vía `canonicalRs` —
  `QuickReviewModal.jsx:59,271`), «RS 95» en el snapshot del panel de origen
  (lote bajo etiqueta RS), y «Percentil lote 95» en el score audit y la
  prioridad. La tabla del screener, detrás del modal, muestra 89. Un usuario
  que abra AII vería 56 en la tabla y 90 en el modal.
- [INFERIDO por código] Cuarto frente: si el chart de estas vistas llegara a
  pintar, su badge «RS global» enseñaría también el percentil del lote —
  `rsMainScore={row.rsGlobalPct}` (`app/RowPriceChart.jsx:86`), rotulado «RS
  global del snapshot activo» (`app/UniversalPriceChart.jsx:172-174`). En la
  ficha ese mismo badge lleva el canónico.

## B2. El gráfico dice «Sin dato» y la fila inferior muestra tres rendimientos

**Verificada, con causa raíz de código en tres capas.**

- [REPRODUCIDO] Modal de AVAH: `.quickReviewChart` → «Sin dato»;
  `.perfStrip` → «3M +71,6% · 6M +79,3% · 12M +82,8%». La misma fila trae
  `chartPreview` de 48 puntos y `chartBarsCount: 400` en localStorage — datos
  para pintar había.
- [CÓDIGO] Capa 1 — el preview no vale para velas: el estilo por defecto es
  velas y el preview de fila es close-only, así que `localBarsForRow` lo
  descarta y pasa `[]`, forzando el fetch de la serie real
  (`app/RowPriceChart.jsx:47-52`, decisión documentada en su comentario).
- [CÓDIGO] Capa 2 — **mientras carga, y ante cualquier error, el chart pinta
  el literal «Sin dato»**: con `status !== "ready"` el componente solo enseña
  texto alternativo si hay nota de calidad/expansión/render
  (`app/UniversalPriceChart.jsx:70-82`); el notice de **loading** y el de
  error genérico no entran en `notes` (`app/useChartController.js:315-321`).
  El controller sí construye el texto correcto («Cargando…», el error, el
  motivo del vacío) en `emptyFallback` (`useChartController.js:375-382`),
  **pero `emptyFallback` no lo consume nadie** (única referencia en el repo:
  su propia definición). La explicación existe y se tira.
- [CÓDIGO] Capa 3 — por qué la ficha no lo sufre: la ficha pasa las barras
  OHLC completas del brief desde el primer render (`RowPriceChart.jsx`
  cabecera: «La ficha… tiene barras OHLC completas del brief y no necesita
  esta capa»), así que nunca pasa por el estado empty.
- La tira de rendimiento, en cambio, lee la fila directamente y con
  `Number.isFinite` (`PerformanceStrip.jsx:14-25`, ya corregida el pasado
  análisis), por eso ella sí pinta. Resultado: la pantalla afirma a la vez
  «sin dato» y «+71,6% en 3M» para el mismo valor.
- [REPRODUCIDO, matiz de entorno] En esta instancia la petición
  `/api/chart?symbol=AVAH` se abortó en el cliente (ERR_ABORTED) — con el
  panel oculto (viewport 0×0) no es concluyente sobre el navegador del dueño.
  Las capas 1-3 sí lo son: son el camino que produce «Sin dato» visible en
  cada apertura (transitorio siempre; permanente ante cualquier fallo).

## B3. «Growth sin dato» junto a un componente vacío

**Verificada, con dos hallazgos: redundancia interna y dato falso-ausente.**

- [REPRODUCIDO] Score audit de AVAH en el modal: la lista de componentes
  muestra «Growth − +0.0» Y la fila de riesgos añade el chip «Growth sin
  dato» — el mismo dato declarado ausente dos veces en el mismo bloque
  ([CÓDIGO] `ScoreAuditPanel` pinta `audit.components` y `audit.missing` por
  separado, `lib/screenerDomains/audit.jsx:149-160`). Al lado, «Métricas
  técnicas» añade su propia fila «Growth −»: tres menciones de la misma
  ausencia en una pantalla.
- [SUPABASE] Y la ausencia es un artefacto: el scan del día SÍ tiene el dato.
  `scan_results` con
  `scan_id=eq.fbbeaf12…&select=symbol,metrics->>growthScore` → AVAH = **58**.
- [REPRODUCIDO] En el propio navegador convivían dos copias de la misma fila:
  `statsedge.scans` (growthScore 58, setupQualityScore 74.77, preview 48
  puntos) y `statsedge.review.v1` (sin growthScore, setupQualityScore 84) —
  **filas de generaciones distintas del dato**. El modal pintó la vieja. Es el
  mismo mecanismo de degradación por copias locales que documentó el análisis
  de uso real del 23-08; aquí produce un «sin dato» en pantalla con el dato
  disponible a dos claves de localStorage y en la nube.

## B4. Más contradicciones del mismo tipo [REPRODUCIDO]

- **El mismo score, tres lecturas**: snapshot del origen «SCORE 83 ×»
  (bloqueado, `unverified-value`), score audit «84 · Δ −0.0» (cuadra al
  décimo), cola «SCORE REVISAR». 83 frente a 84 y dos severidades distintas en
  la misma pantalla (83 es `objectiveScore`, 84 `totalScore`; ninguna celda lo
  dice).
- **«RS Quality −» y «Calidad lote 82» a la vez**: Métricas técnicas la
  declara ausente con motivo (intencional, `RS_QUALITY_OFF_CANON_REASON`) y el
  score audit muestra «Calidad lote 82 +5.5». Etiquetas distintas a propósito,
  pero el lector ve el par ausente/presente de un concepto que se llama casi
  igual.
- **Los semáforos saturados no discriminan**: la cola del modal marcó a las 10
  filas «DATOS BLOQUEADOS · SCORE REVISAR · PRUEBAS BLOQUEADAS» a la vez; con
  el 100% en rojo el resumen no ordena nada y la cola sigue mostrándose como
  lista operable con «Candidata» a un click.
- **Dos gráficos del mismo símbolo en `/review`**: el chart nativo de 520 px y
  el `MiniSparkline` de la misma fila, uno debajo del otro.
- **El contador de cola por triplicado** en el modal (breadcrumb, botonera,
  bloque de origen).

## B5. Nota sobre los veredictos citados en el encargo

Todos localizados y reproducidos: «Auditar antes»
(`lib/screenerExplainability.js:712` y `lib/decisionProfile.js:42`), «esperar
confirmación» (`:707` y `:619`), «vigilar» (múltiples), «riesgo severo:
requiere revisión manual antes de entrar en cola» (`:638`), «no deben leerse
como estructura de ruptura confirmada, líderes o largos limpios»
(`lib/screenerContracts.js:31`, contrato exploratorio — este último es texto
del CONTRATO del panel de origen, visible cuando el filtro es exploratorio).
«Decisión 260» y «acción −80» son las constantes internas
`READINESS_PRIORITY.audit` y `ACTION_PRIORITY["high-risk"]`
(`lib/decisionAudit.js:337-372`); «score objetivo N» es `totalScore×2.2`
(`:563`); «arrastres», «componentes sin dato» y «riesgos score» son las
etiquetas del score audit (`lib/screenerScoreAudit.js:313-336`); «pendiente
N/9» y «bloqueadas» son el checklist de evidencia; «2 proxy» y «métricas
objetivas bloqueadas» son `objectiveMetricTruth`
(`lib/objectiveMetricTruth.js:643`).

---

# PARTE C — Qué debería ser

## C7. ¿Cumple su función?

La función es recorrer valores deprisa sin abrir la ficha entera. Hoy no la
cumple, por tres motivos medibles:

1. **El elemento central falla**: el gráfico — lo único que un operador de
   tendencia necesita mirar en un recorrido — muestra «Sin dato» en cada
   apertura (transitorio) o permanentemente (fila sin serie, error). Todo lo
   demás sí pinta. La vista invierte la jerarquía: lo accesorio funciona, lo
   esencial no.
2. **La señal está enterrada**: por valor se muestran ~40 elementos de
   juicio/estado (9 chips por fila de cola × 10 filas visibles, más 5 paneles
   laterales); lo que el principio 7 considera la lectura del valor (RS,
   etapa, rendimiento, distancia, capitalización) ocupa una fracción pequeña
   de la superficie y compite con tres valores distintos de «RS».
3. **En `/review`, pasar de valor tiene coste de proveedor**: cada fila activa
   sin preview usable dispara `/api/company-brief` (con su reescritura de
   caché) — recorrer 50 valores son 50 descargas. La vista «ligera» es más
   cara por valor que la ficha.

## C8. Qué debería mostrar (y qué sobra)

Para el recorrido bastan, por valor: **gráfico grande que pinte siempre**
(preview de línea al instante — la fila YA trae 48 puntos —, velas cuando
llegue la serie), la **fila de las siete columnas** (RS canónico único, etapa,
rendimiento del periodo, distancia a máximos, capitalización), el **resumen de
negocio en una línea**, la **tira 3M/6M/12M**, los **botones de clasificar** y
**Ficha / TradingView / Siguiente**. Es decir: los bloques 1, 4, 7, 11 y 13
del inventario del modal, más la celda RS/etapa.

Sobra (por el principio 1 o el 2): el panel de origen entero (bloque 3), la
barra de tesis (5), los rails de resumen y los 9 chips por fila de la cola
(6, dejando ticker+nombre+score… ni siquiera el score: el orden ya lo lleva),
prioridad de investigación (8), checklist de pruebas (9), score audit
desplegado (10), y de Métricas técnicas los siete scores compuestos (12). En
`/review`: el resumen ESPERAR/AUDITAR/DESCARTAR (4), los badges de la lista
(5), la prioridad (7), «Decisión Screener» (8), el grid con RS/RS País/RS
Grupo del lote (9 — o se queda solo con las medidas del bloque 10), y el
sparkline duplicado (6). Nada de esto se pierde: todo lo auditable ya tiene
sitio en N3 de la ficha, a un click.

## C9. Los botones de clasificar: reales, locales, y sin señal de uso

- [CÓDIGO] Escriben de verdad: `applyStockDecisionResolution` →
  `persistReviewQueue` → `localStorage["statsedge.review.v1"]`
  (`lib/stockDecisionResolution.js:182-228`,
  `lib/screenerPipeline.js:261-286`), con log de hasta 200 entradas,
  «Descartar» oculta la fila (`reviewState: "hidden"`), y la resolución se
  refleja en el filtro «Resolución» del screener y en la ficha. **No escriben
  en Supabase** — no existe tabla de resoluciones; es estado por dispositivo,
  sin copia.
- [SUPABASE] La única huella de uso observable desde fuera sería un favorito
  creado desde Review (`createFavoriteFromRow(row, { source: "review" })`).
  Consulta a `favorites` (todas las filas, `select=symbol,source`): **5
  favoritos, fuentes «screener» (4) y «manual» (1), ninguno «review»**; el más
  reciente del 8 de agosto.
- El uso real del flujo de clasificación vive en el localStorage del dueño y
  no es observable desde esta sesión. Las señales indirectas (0 favoritos
  desde Review; el encargo describe estas superficies como «las últimas sin
  revisar») apuntan a poco o ningún uso — pero es inferencia, no medida.
- Decisión de producto pendiente que este análisis deja planteada: si la
  clasificación es flujo de primera (parece serlo: es de lo poco del
  inventario que el principio 1 bendice), hoy es el único estado de usuario
  valioso que **no** tiene copia en la nube (los favoritos sí la tienen).

## C10. ¿Fusionar con la ficha?

**No fusionar con la ficha; sí fusionar las dos colas entre sí.**

- La ficha y la vista rápida tienen costes opuestos por diseño: la ficha paga
  una descarga completa de proveedor por valor (brief + caché); la vista
  rápida existe para no pagarla. Fusionarlas convertiría el recorrido en N
  aperturas de ficha — lo que el propio encargo pide evitar. Separadas, con la
  vista rápida reducida a C8, la pareja es correcta: recorrido barato →
  clasificar → abrir ficha solo en las candidatas.
- Lo que sí está duplicado es **la vista rápida consigo misma**: el modal del
  screener y `/review` son dos implementaciones paralelas del mismo trabajo
  (dos colas con persistencias distintas — y B3 demuestra que divergen —, dos
  charts, dos grids de métricas, componentes literalmente repetidos:
  `ReviewPriorityPanel` y `ReviewQueueFocusBadge` existen en
  `ReviewWidgets.jsx` **y** re-implementados dentro de `review/page.jsx`;
  `CompanyMark` y `MiniSparkline` también viven dos veces). Hasta comparten
  nombre («Vista rápida» es el título de ambas). Una sola superficie de
  recorrido — el modal, que no navega y conserva el contexto de la tabla — con
  `/review` como su forma a pantalla completa sobre LA MISMA cola y LA MISMA
  fila, elimina la clase entera de bugs de B3.

## Propuesta priorizada

1. **Arreglar el «Sin dato» del gráfico** (B2): estado de carga visible
   (consumir `emptyFallback` o incorporar loading/error a `notes`), y pintar
   el preview de línea al instante mientras llega la serie de velas. Es un bug
   de presentación que rompe el corazón de la vista; sin esto, cualquier
   limpieza deja una vista vacía en el centro.
2. **Un solo RS** (B1): toda celda etiquetada «RS» en estas superficies pasa
   por `canonicalRs` (como ya hacen la tabla, `QuickPanel`, `LeaderTape` y las
   Métricas técnicas del modal); el percentil del lote desaparece de las
   superficies de lectura (`review/page.jsx:372-375`,
   `ScreenerOriginPanel.jsx:188`, `RowPriceChart.jsx:86` — y con él, RS
   País/Grupo del lote). Donde el motor lo use, se queda en el motor.
3. **La limpieza de la ficha, aplicada aquí** (A1/A2, lista de C8): retirar
   veredictos operativos y estado interno de ambas superficies. Es la misma
   operación del 21-22 de agosto, con la misma justificación (principios 1 y
   2), sobre las últimas superficies que la arrastran.
4. **Una sola cola** (C10): unificar modal y `/review` sobre la misma
   fuente de filas y la misma persistencia; de paso decidir la hidratación
   (no descargar proveedor por navegar la cola: el preview de línea basta
   para recorrer; la serie completa, al abrir la ficha).
5. **Decidir la copia en nube de las resoluciones** (C9): si clasificar es el
   flujo que se queda, hoy es estado sin respaldo y por dispositivo.

---

# CONFIANZA

| Hallazgo | Confianza | Base |
|---|---|---|
| Inventario de bloques y sus textos exactos (A1/A2) | Alta | DOM real de la instancia (modal de AVAH, `/review` con GEO) + código citado |
| «RS» del grid de review y del snapshot de origen = percentil del lote | Alta | Código citado + DOM (AVAH: 89 canónico vs 95 lote en la misma pantalla) + SQL del par completo |
| Magnitud de la divergencia RS canónico vs lote (hasta 34 puntos, AII) | Alta | `scan_results` del 24-08 × `rs_weekly_items` W32 snapshot 2026-08-09, consultas citadas |
| El caso 99/99 del dueño = coincidencia de dos métricas distintas | Alta | 8 símbolos con 99/99 y 5 con divergencia en el mismo scan |
| «Sin dato» del chart: literal fijo para loading/error; `emptyFallback` sin consumidor | Alta | `UniversalPriceChart.jsx:70-82`, `useChartController.js:315-321,375-382`, grep de consumidores |
| «Sin dato» reproducido junto a la tira 3M/6M/12M | Alta | DOM del modal (con la reserva del viewport 0 para el abort de red) |
| «Growth sin dato» con growth=58 disponible en nube y en scans local | Alta | SQL + localStorage de las dos copias, valores citados |
| La fila del modal era de otra generación que la copia del día | Alta (el hecho) / Media (la cadena exacta de cuál proyección la trajo) | setupQualityScore 84 vs 74.77 en las dos copias del mismo símbolo |
| Resoluciones: solo localStorage, sin tabla en nube | Alta | Código citado + esquema (no existe tabla; favoritos sí) |
| Uso real del flujo de clasificar | No verificable | Estado local del dueño inaccesible; 0 favoritos source review como señal indirecta |
| Coste de proveedor al navegar `/review` (brief por fila activa) | Alta (mecanismo) / Media (frecuencia real) | Código de `hydrateReviewRow` + condición `alreadyUsable`; no medido en vivo (las peticiones de mi instancia se abortaron por el entorno) |
| Veredictos de la Parte C | — | Diseño argumentado sobre los principios; discutible por diseño |

# LO QUE NO HE VERIFICADO

- **Nada visual**: el panel del navegador quedó oculto (viewport 0×0) casi
  toda la sesión — sin capturas, sin composición del canvas, y la home
  renderizó la superficie móvil. Todo lo reproducido es DOM/texto. La
  geometría, los solapes visuales y el aspecto real de ambas superficies con
  pestaña visible quedan pendientes.
- **El abort de `/api/chart` en el navegador del dueño**: en mi instancia las
  peticiones de chart de símbolos murieron con ERR_ABORTED, compatible con el
  viewport 0. Las tres capas de código de B2 explican el «Sin dato» sin
  necesidad de ese abort, pero no he visto el ciclo completo
  (loading→ready/error) con ventana real.
- **La cadena exacta que degradó la fila del modal** (B3): demostrado que dos
  copias de AVAH con campos distintos convivían y que el modal pintó la vieja;
  no he trazado qué proyección/generación concreta la produjo (la sesión
  restaurada arrastraba estado de rondas anteriores de esta misma instancia,
  igual que le ocurre a la sesión del dueño).
- **El comportamiento de la cola «Cola actual» de `/review`** end-to-end desde
  un click del screener (verifiqué `source=latest`; la vía `current` comparte
  el 90% del código pero no la ejecuté).
- **La frecuencia real de hidratación** (cuántas filas de una cola típica
  disparan brief al navegar): el mecanismo y su condición están citados; la
  medición en vivo requiere pestaña visible y consume descargas de proveedor,
  que este encargo pedía minimizar.
- **El modal con contrato exploratorio** (el texto «no deben leerse como…» del
  encargo): localizado en código y en el contrato, no reproducido en pantalla
  (mi sesión restauró preset balanced → contrato largo).
- **Móvil**: ninguna de las dos superficies analizada en viewport móvil real
  (la home móvil que vi era un artefacto del viewport 0).
