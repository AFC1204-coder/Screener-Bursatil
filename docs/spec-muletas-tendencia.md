# Spec — Muletas de tendencia (persistencia MA · aceleración · volumen, MET-4)

- **Fecha:** 2026-08-31
- **Rama:** `codex/statsedge-ui-polish`
- **Estado:** **aceptado** por el dueño 2026-08-31 — MET-4b autorizado.
- **Contratos reconciliados:** `docs/spec-rs-global-multi-mercado-fx.md` (aceptado) · `docs/spec-rs-pais.md` (aceptado) · `docs/spec-rs-tema.md` (aceptado) · `docs/principios-producto.md` · `docs/tickets/MET-4-muletas-tendencia.md` · decisión dueño 2026-08-27 (`docs/backlog-activo.md`) · código vivo (`lib/weeklyStage.js`, `lib/trendStructure.js`, `lib/indicators.js`, `lib/marketVolume.js`, `lib/stockVolume.js`, `lib/descriptiveStrip.js`, `lib/setupPatterns.js`, `lib/materializedScanner.js`) · auditoría etapas (`docs/auditoria-etapas-2026-08-16.md`, C-15).

---

## Veredicto

Las **muletas de tendencia** son **tres lecturas descriptivas por símbolo** que responden una sola pregunta de mesa: **«¿se sostiene la tendencia actual?»**. No son un score, no son una señal, no son una etapa. Cada muleta es una **palabra + el dato que la sustenta**, con ausencia declarada y motivo cuando el dato no existe (principio 3):

1. **Persistencia de medias** — cuántas semanas lleva el cierre semanal sosteniéndose sobre sus medias de 30 y 10 semanas (las mismas medias de la etapa, calculadas en el mismo sitio).
2. **Aceleración** — si el avance de precio del tramo reciente gana o pierde ritmo frente al tramo anterior (13 vs 13 semanas, derivado de `perf3m`/`perf6m` ya en filas).
3. **Volumen** — si el reparto up/down de volumen (50 sesiones, `upDownVolRatio` ya en filas) acompaña o no la tendencia.

Superficie v1: **solo la ficha** (franja descriptiva), bajo el rótulo trader-facing **«Sostén de la tendencia»** («muletas» es nombre interno de documentación, no copy de UI). Sin columna nueva (contrato de 7 columnas), sin filtros hunt nuevos, sin tocar la línea de verdad.

Nada entra en `objectiveScore`, `compositeScore`, `totalScore`, `weaknessScore` ni en ningún score persistido. No hay job nuevo, ni tabla nueva, ni `engine_version`: las tres muletas son **funciones deterministas por símbolo sobre las barras diarias que el scan y la ficha ya cargan** — a diferencia del RS, no existe denominador cruzado que versionar.

`lib/weeklyStage.js` **no se modifica**: las muletas leen sus campos y añaden contadores. Etapa y muletas pueden divergir (Etapa 2 + «se frena» + «volumen en contra») y esa divergencia es información, no contradicción.

Implementación = **MET-4b**, solo con OK explícito del dueño sobre este spec.

---

## Resolución vs MET-1/2/3 / principios / dueño

| Cláusula | Origen | Resolución |
|---|---|---|
| Muletas = lectura operativa de si la tendencia «aguanta», no score compuesto | Dueño 2026-08-27 (`docs/backlog-activo.md`) | **Gana.** Tres lecturas descriptivas independientes; el agregado 0–100 es MET-5 y no se fusiona aquí. |
| La herramienta clasifica, no recomienda | `docs/principios-producto.md` §1 | **Se conserva.** Copy describe estado («sobre la media 23 semanas», «se frena»), nunca acción. Sin semáforos por fila ni veredictos. |
| Tabla de 7 columnas; añadir exige quitar | Principios §7 | **Se conserva.** MET-4 no añade columna. Superficie = ficha. |
| Dato ausente = ausente con motivo, no cero | Principios §3, `lib/descriptiveStrip.js` | **Se conserva.** Cada muleta tiene sus motivos de ausencia (tabla en pregunta 5). |
| La metodología vive en un solo sitio | Principios §5 | **Se conserva.** Definiciones y umbrales van a la página de metodología; la ficha solo muestra lectura + dato. |
| Etapa = solo precio vs media 30 sem + pendiente (D.14, C-4…C-15) | `lib/weeklyStage.js`, `docs/auditoria-etapas-2026-08-16.md` | **Se conserva literalmente.** Las muletas no entran en la clasificación de etapa ni en `stage2RejectDetail`. La lección C-15 (etapa mostrada ≠ filtrada) no se repite. |
| Scoring off por defecto | MET-1/2/3 pregunta scoring | **Se conserva.** Ninguna muleta alimenta scores; v1 tampoco filtros. |
| Pin RS global / motores semanales país y tema | MET-1b/2b/3b | **No se tocan.** Las muletas no leen ni escriben `rs_weekly_*`. |
| VCP / bases / pivote = track investigación aparte | Backlog (VCP aplazado), principios §7 «Aplazado» | **Se conserva.** `volumeDryUpRatio` y todo `lib/setupPatterns.js` quedan fuera de las muletas. |

---

## Lista cerrada

### Pregunta 1 — Qué son las muletas y qué queda fuera

**Propuesta:** lista **cerrada de tres** muletas. La metáfora es literal de Weinstein: la media es la muleta en la que se apoya la tendencia; las otras dos dicen si el apoyo va a más o a menos.

| # | Muleta | Pregunta de mesa | Dato base (ya existe) |
|---|---|---|---|
| 1 | **Persistencia de medias** | ¿Cuánto lleva apoyada en su media? | Barras semanales + `sma` de `lib/weeklyStage.js` |
| 2 | **Aceleración** | ¿Avanza más o menos que antes? | `perf3m` / `perf6m` (63/126 sesiones, `lib/indicators.js`) |
| 3 | **Volumen** | ¿El volumen acompaña? | `upDownVolRatio` 50 sesiones (`udVol`, ya en filas) |

Cada muleta emite: **lectura** (palabra de un vocabulario cerrado), **dato de soporte** (número + ventana), o **ausencia con motivo**. Las tres son independientes: no se promedian, no se ponderan, no votan.

**Queda fuera de MET-4** (lista explícita): VCP / detección de bases / distancia al pivote (track `research/contracciones/` + `lib/setupPatterns.js`); RS en stress (MET-6); índice 0–100 de salud de etapa (MET-5); extensión sobre la media como métrica de riesgo (`distanceSlowMaPct` ya existe y se queda donde está); indicadores nuevos (MACD, RSI, OBV, ADX, EMA); cualquier lectura sobre series de RS semanal (la ficha ya tiene «desde N» vía `rsWeeklyDelta`).

**Alternativa rechazada:** framework extensible de «checks de salud» con registro de N señales enchufables. Rechazada porque la superficie crecería por acumulación sin decisión de producto (el anti-patrón que el principio 2 documenta), y porque el agregado ya tiene sitio propio: MET-5. Tres muletas es la decisión, no el punto de partida.

**Alternativa rechazada:** fusionar las tres en un único semáforo (verde/ámbar/rojo). Rechazada porque un semáforo es un veredicto — exactamente lo que el rediseño eliminó de la tabla (principios §7 «Lo que se elimina») — y porque decidir cuántas muletas «valen» un verde es la ponderación de MET-5, que exige su propio spec.

---

## Persistencia de medias

### Pregunta 2 — Qué MAs, horizonte, «encima» y «pendiente»

**Propuesta:**

| Aspecto | Decisión |
|---|---|
| **Medias** | Las dos que ya existen en producto semanal: **30 semanas** (lenta, la de la etapa) y **10 semanas** (rápida, la operativa de Minervini/O'Neil). Ninguna media nueva. |
| **Fuente de cálculo** | **Exactamente** `weeklyBarsFromDaily` + `sma` de `lib/weeklyStage.js` (cierre semanal, SMA simple). Prohibido recalcular con otra convención (EMA, precio típico, barras diarias): una sola verdad por media. |
| **«Encima»** | Cierre semanal > valor de la media esa misma semana. Igual que `priceAboveSlowMa` / `priceAboveFastMa` ya emitidos por `weeklyStageForBars`. |
| **Contadores** | `weeksAboveSma30w` y `weeksAboveSma10w` (nombres orientativos MET-4b): **semanas consecutivas** con cierre semanal sobre la media, contando hacia atrás desde la última semana cerrada. Un solo cierre semanal bajo la media **resetea** el contador. |
| **Horizonte de reporte** | Tope 104 semanas; por encima se muestra «≥104». Más allá de dos años el número exacto ya no cambia la lectura de mesa. |
| **«Pendiente»** | La palabra de pendiente de la media de 30 es la que ya existe: `slopeWord` (`lib/descriptiveStrip.js`) con `slopeWeeks=10` y banda muerta `flatPct=2` de `lib/weeklyStage.js`. **No** se introduce una segunda definición de pendiente. |
| **Ausencia** | Sin barras para la media de 30 (`insufficient_history` de la etapa) → muleta ausente con el mismo motivo que la etapa. La de 10 puede existir sin la de 30 en históricos cortos: se muestra la que se pueda demostrar. |

Lecturas trader-facing (orientativas): «Sobre la media de 30 semanas: 23 semanas» · «Perdió la media de 10 semanas esta semana» · «Bajo la media de 30 semanas: 4 semanas» (el contador también corre por debajo — cuántas semanas lleva sin muleta es tan descriptivo como cuántas lleva con ella).

**Alternativa rechazada:** contador **diario** sobre SMA50 (sesiones consecutivas sobre la media de 50). Rechazada porque (a) el ruido diario resetea el contador con cualquier shakeout intradía y convierte la persistencia en una lotería de sesiones; (b) la estructura diaria ya tiene lectura propia y binaria en producto (`requirePulso` / `trendTemplateIssue`, seis condiciones Minervini); (c) la escuela lee la tendencia en semanal — la muleta debe hablar el mismo idioma que la etapa.

**Alternativa rechazada:** banda de tolerancia (p. ej. no resetear si la penetración es <2% o dura una sola semana). Rechazada en v1 porque cualquier tolerancia es un parámetro de producto sin número publicado por la escuela, y una penetración «perdonada» es exactamente el tipo de maquillaje que el principio 3 prohíbe. Se empieza estricto; si el uso real muestra falsos reseteos molestos, la tolerancia se decide con casos concretos delante, no a priori.

---

## Aceleración

### Pregunta 3 — Precio vs momentum, horizonte, ausencia

**Propuesta:** la aceleración se lee sobre **precio**, no sobre un oscilador. Se comparan dos tramos consecutivos de avance:

- **Tramo reciente** `r1` = `perf3m` (63 sesiones, campo ya persistido en filas).
- **Tramo anterior** `r0` = rendimiento de las 63 sesiones previas, derivado de campos existentes: `r0 = ((1 + perf6m/100) / (1 + perf3m/100) − 1) × 100`.

Ventanas 13/26 semanas: las mismas dos primeras ventanas de la fórmula RS (40/20/20/20), deliberadamente — el usuario ya piensa en esos plazos.

Lectura con banda muerta:

| Condición | Lectura |
|---|---|
| `r1 − r0 > +banda` | **acelera** |
| `abs(r1 − r0) ≤ banda` | **mantiene** |
| `r1 − r0 < −banda` | **se frena** |

**Banda muerta: 5 puntos porcentuales** por defecto, configurable. Como `flatPct=2` de la etapa, es decisión de producto declarada (la escuela no publica número); va documentada en la página de metodología, no repetida en la ficha. El dato de soporte se muestra siempre: «se frena (+6% últimos 3 meses vs +19% los 3 anteriores)» — la palabra nunca viaja sola.

**Ausencia:** sin `perf6m` (histórico < 126 sesiones, IPOs recientes) → muleta ausente con motivo («Sin lectura de aceleración: histórico inferior a 6 meses»). **Prohibido** degradar en silencio a ventanas más cortas (1m vs 1m): cambiaría la semántica sin avisar. Serie discontinua (≥3×, `detectPriceDiscontinuities`) → ausente con motivo, misma disciplina que el RS.

**Alternativa rechazada:** oscilador de momentum (MACD, ROC suavizado, pendiente de RSI). Rechazada porque (a) introduce jerga de laboratorio en copy que los principios prohíben; (b) exige maquinaria de indicador nueva cuando la pregunta del operador — «¿avanza más o menos que antes?» — se responde con dos rendimientos que ya están en la fila; (c) un oscilador con parámetros propios es otra definición de «fuerza» conviviendo con el RS, el anti-patrón que MET-1…3 pasaron tres specs eliminando.

**Alternativa rechazada:** usar `momentumScore` del batch (`computeSignal` en `lib/researchRow.js`). Rechazada: es maquinaria de scoring dependiente del lote, con cobertura parcial y semántica de score 0–100 — todo lo que las muletas no son.

**Alternativa rechazada:** aceleración sobre la serie de RS semanal (¿sube el ranking?). Rechazada porque mezcla ejes: el RS ya tiene su lectura de cambio en ficha (`rsWeeklyDelta`, «desde N hace 13 semanas»), y la aceleración de un percentil depende del comportamiento de los demás símbolos, no solo del propio — no es una muleta del valor.

---

## Volumen

### Pregunta 4 — Qué ratio, relación con up/down ya en filas

**Propuesta:** la muleta de volumen es **el mismo `upDownVolRatio` de 50 sesiones que ya está en filas** (`udVol` en `lib/indicators.js` / `lib/materializedScanner.js:478`, cobertura mínima 80% de sesiones con volumen), leído con los **umbrales que ya existen** en `lib/marketVolume.js`:

| Condición | Lectura | Constante existente |
|---|---|---|
| `ratio ≥ 1,25` | **acompaña** | `UP_DOWN_VOLUME_THRESHOLD` |
| `1 ≤ ratio < 1,25` | **neutro** | `UP_DOWN_VOLUME_RATIO_BALANCED` |
| `ratio < 1` | **en contra** | — |

Dato de soporte siempre visible: «acompaña (1,4× up/down, 50 sesiones)». **No se introduce ningún número nuevo**: los umbrales 1 / 1,25 son los que `market-health` ya usa para el mismo ratio, y la ficha ya muestra la ventana de 50 sesiones (`lib/stockVolume.js`). Una sola definición de «el volumen acompaña» en todo el producto.

**Relación con lo que ya existe:** `volumeDryUpRatio` (10d/50d, secado ≤0,85) y `latestVolumeRatio` / `volumeSurgePct` **no son muletas**: el secado es lectura de base/setup (track VCP, así lo etiqueta ya `lib/descriptiveStrip.js`) y el surge mide un día, no la tendencia. Siguen donde están, sin cambio.

**Ausencia:** cobertura de volumen <80% en 50 sesiones → `udVol` ya devuelve `null`; la muleta se muestra ausente con motivo («Sin reparto de volumen: cobertura de volumen insuficiente en 50 sesiones»).

**Alternativa rechazada:** serie semanal nueva de volumen (up-weeks vs down-weeks) u OBV. Rechazada porque crea una **segunda definición** de la misma pregunta conviviendo con el `upDownVolRatio` que tabla, ficha y market-health ya muestran — la incoherencia multi-superficie que costó tres specs de RS eliminar. Si algún día se decide que la lectura semanal es mejor, se migra la definición única, no se añade una paralela.

**Alternativa rechazada:** volumen relativo del día (`relativeVolume` / `latestVolumeRatio`) como muleta. Rechazada: una sesión de volumen alto no dice si la **tendencia** está acompañada; mide el evento, no el sostén. Es dato de breakout/ficha, no muleta.

---

## Superficie

### Pregunta 5 — Ficha / truth / columna / research; etiquetas

**Propuesta:** superficie v1 = **solo la ficha**, como bloque de la franja descriptiva bajo el rótulo **«Sostén de la tendencia»**. Tres líneas, cada una palabra + dato:

```
Sostén de la tendencia
· Sobre la media de 30 semanas: 23 semanas (media ascendente)
· Avance: se frena (+6% últimos 3 meses vs +19% los 3 anteriores)
· Volumen: acompaña (1,4× up/down, 50 sesiones)
```

| Superficie | Decisión |
|---|---|
| **Ficha** (franja descriptiva) | **Sí** — el bloque de arriba. Es donde el principio 4 de «las cinco cosas» sitúa la profundización por valor. |
| **Tabla** | **No.** Sin columna nueva: el contrato de 7 columnas exige quitar para añadir, y ninguna de las 7 sale. |
| **Línea de verdad / truth** | **No.** La verdad de mesa habla de población y mercados, no de lecturas por símbolo. |
| **Vista rápida / `/review`** | **No en v1.** Si el uso real lo pide, es un ticket de superficie posterior (mismo cálculo, sin re-especificar). |
| **Ficha compartible** | **Candidata natural** («estado de la tendencia» es literalmente su contenido según principios §4), pero fuera de MET-4b: entra cuando se trabaje esa ficha, sin cambiar definiciones. |
| **Página de metodología** | **Sí** — definiciones, ventanas y umbrales (30/10 sem, 13 vs 13 sem, banda 5 pp, umbrales 1/1,25) viven ahí, una sola vez (principio 5). |

**Etiquetas trader-facing:** vocabulario cerrado — persistencia: «sobre / bajo la media de N semanas: X semanas»; aceleración: «acelera / mantiene / se frena»; volumen: «acompaña / neutro / en contra». Todo describe estado, nada sugiere acción (principio 1). «Muletas» no aparece en UI: es útil entre nosotros, pero en pantalla suena a diagnóstico.

**Motivos de ausencia** (texto único componente/tests, patrón `DESCRIPTIVE_ABSENCE`):

| Código (orientativo) | Texto UX (orientativo) |
|---|---|
| `support-insufficient-history` | Sin lectura de medias: el histórico semanal no alcanza para la media de 30 semanas. |
| `accel-insufficient-history` | Sin lectura de aceleración: histórico inferior a 6 meses. |
| `accel-discontinuous` | Sin lectura de aceleración: salto sin ajustar en la serie de precios. |
| `volume-coverage` | Sin reparto de volumen: cobertura de volumen insuficiente en 50 sesiones. |

**Alternativa rechazada:** columna nueva en tabla (o tres mini-iconos de estado por fila). Rechazada porque rompe el contrato de 7 columnas y porque un icono de estado por fila es el VEREDICTO que el rediseño eliminó: ordenar la mesa por «salud» con la mirada es señalar, y eso es MET-5 con decisión de dueño, no un efecto lateral de MET-4.

**Alternativa rechazada:** empezar por vista rápida además de ficha. Rechazada por disciplina de superficie mínima: el ticket pide la superficie que permita validar la lectura con uso real; la ficha basta para eso, y cada superficie extra en v1 es coste de smoke y de mantenimiento antes de saber si la lectura sirve.

---

## Scoring y filtros

### Pregunta 6 — Default NO; ¿alimenta filtros hunt?

**Propuesta: confirmar prohibición (default MET-1/2/3), y en v1 ni siquiera filtros.** Ninguna muleta ni campo derivado entra en `objectiveScore`, `compositeScore`, `totalScore`, `weaknessScore` ni en scores persistidos en `scan_results`. La taxonomía de filtros (UX-FILTERS, cerrada) no se amplía en MET-4b: no hay `minWeeksAboveMa` ni «solo acelerando» en v1.

El filtro de estructura diaria que ya existe (`requirePulso`, seis condiciones Minervini) **no cambia** y no se refunde con las muletas: mide otra cosa (foto binaria diaria, no persistencia semanal).

Si tras uso real el dueño quiere cazar con alguna muleta (candidata obvia: persistencia mínima sobre la media de 30), eso es un **ticket de filtro propio** con decisión explícita — lectura del dato, nunca scoring — siguiendo el mismo camino que los filtros de RS semanal.

**Alternativa rechazada:** alimentar `weaknessScore` / deterioro con «se frena» o «volumen en contra». Rechazada porque condiciona un score persistido a cobertura de las muletas (IPOs sin aceleración, volumen sin cobertura) y reabre la auditoría de coherencia de scoring sin validación del dueño — la misma razón por la que RS país y tema quedaron fuera de scores.

**Alternativa rechazada:** lanzar MET-4b ya con un filtro hunt de persistencia. Rechazada por orden de validación: primero el dueño lee las muletas en fichas reales y decide si la definición estricta (reset por un cierre semanal) caza como él caza; convertirla en puerta de filtro antes de eso congela un parámetro no validado dentro del flujo de caza.

---

## Cadencia

### Pregunta 7 — Derivado en scan vs job aparte

**Propuesta: derivado, sin job.** Las tres muletas son funciones deterministas de la serie de barras del propio símbolo — no hay denominador cruzado, no hay población que versionar, no hay «semana W» que congelar. Se calculan donde ya se calculan sus ingredientes:

| Dónde | Qué |
|---|---|
| **Scan / materializado** (`lib/materializedScanner.js`, junto a `weeklyStageFields` y `udVol`) | Contadores de persistencia y lectura de aceleración como campos de fila (nombres orientativos: `weeksAboveSma30w`, `weeksAboveSma10w`, `advanceRecentPct`, `advancePriorPct`). Volumen no necesita campo nuevo: `upDownVolRatio` ya está. |
| **Ficha** | Cálculo desde las barras del chart (patrón `lib/descriptiveStrip.js`: funciones puras, testeables sin render), para que la ficha no dependa de que el símbolo esté en el último scan. |

Sin tabla nueva, sin `engine_version`, sin cron, sin escritura fuera de los campos de fila del scan. Coste marginal ~0: las barras ya están en memoria en ambos sitios y los bucles semanales ya existen (`weeklyBarsFromDaily` se invoca hoy por fila).

**Alternativa rechazada:** job semanal con snapshots (patrón `rs_weekly_*`). Rechazada porque ese patrón existe para versionar un **denominador** (invariante 10) y aquí no lo hay; añadiría ops (cron, idempotencia, motivos persistidos, MIGRATE en pausa) para comprar una auditabilidad que la función determinista por símbolo ya da gratis: mismas barras → mismas muletas.

**Alternativa rechazada:** calcular solo en ficha on-demand (sin campos en scan). Rechazada porque dejaría cualquier superficie futura (vista rápida, filtro de persistencia si el dueño lo pide) sin dato consistente con la mesa, y porque el scan ya paga el coste de agrupar semanas por fila — recalcular en ficha lo que el scan tiró sería la incoherencia scan/ficha que la etapa ya sufrió y arregló.

---

## Relación con la etapa

### Pregunta 8 — `weeklyStage*`: complemento, no duplicado

**Propuesta:** reparto de papeles explícito:

| | Etapa (`weeklyStage*`) | Muletas |
|---|---|---|
| Pregunta | ¿En qué **fase del ciclo** está? | ¿La tendencia actual **se sostiene**? |
| Naturaleza | Clasificación (1–4, confirmada/tentativa) | Tres lecturas continuas/contadas |
| Ingredientes | Precio vs media 30 + pendiente, nada más (D.14) | Los mismos ingredientes semanales **+ contadores**, `perf3m/6m`, `upDownVolRatio` |

Contratos duros:

1. **`lib/weeklyStage.js` no se toca.** Ni la clasificación, ni `stage2RejectDetail`, ni `isConfirmedStage2`. Las muletas **leen** `weeklyStageForBars` (medias, `flatPct`, `priceAboveSlowMa`) y añaden contadores encima.
2. **`weekInStage` ≠ persistencia.** `weekInStage` cuenta semanas en el **estado** (una Etapa 2 puede seguir siendo Etapa 2 con el precio bajo la media de 10); `weeksAboveSma30w/10w` cuentan semanas sobre la **media**. Son números distintos y se documentan como tales — no se sustituye uno por otro.
3. **La divergencia es contenido.** «Etapa 2 confirmada» + «se frena» + «volumen en contra» es exactamente la lectura que el dueño pidió: la etapa dice dónde está, las muletas dicen cómo llega. Ninguna lógica «corrige» a la otra.

**Alternativa rechazada:** subdividir la etapa con las muletas («Etapa 2 sana» / «Etapa 2 débil») dentro del clasificador o del filtro. Rechazada porque (a) repite el bug C-15 ya pagado — la etapa mostrada dejaría de ser la etapa filtrada; (b) «sana/débil» es un agregado ponderado con otro nombre: es MET-5, y MET-4 tiene prohibido fusionarse con él.

**Alternativa rechazada:** duplicar el cálculo de las medias con otra convención (EMA de 10 semanas, media sobre barras diarias ×5). Rechazada: dos verdades para «la media de 30 semanas» garantizan una ficha que contradice a su propia etapa. La fuente es una (`weeklyStage.js`) y las muletas la importan.

---

## Fuera

### Pregunta 9 — Qué NO es MET-4

MET-4 (y su eventual MET-4b) **no** incluye:

- **MET-5** — índice 0–100 de salud de etapa. Las muletas serán insumo *candidato* de ese spec, pero aquí ni se agregan, ni se ponderan, ni se colorean.
- **MET-6** — RS en stress / bajadas.
- **VCP, bases, pivote, semanas de base** — track `research/contracciones/` + `lib/setupPatterns.js`; `volumeDryUpRatio` sigue siendo lectura de setup, no muleta.
- **Indicadores nuevos** — MACD, RSI, OBV, ADX, EMAs, ni ningún oscilador.
- **Columna de tabla, cambios en línea de verdad, filtros hunt, vista rápida** — superficie v1 = ficha; lo demás son tickets posteriores con decisión de dueño.
- **Scoring** — ni entrada en scores ni cambios en `lib/scoring.js` / `scoringEngine.js` / `weaknessScore`.
- **Schema, jobs, cron, `engine_version`** — no hay escrituras nuevas fuera de campos de fila del scan.
- **Chart** — sin overlays ni marcas nuevas (las MAs ya se dibujan; su copy no cambia aquí).
- **Tocar `lib/weeklyStage.js`, el pin RS global, los motores semanales país/tema** — solo lecturas de convivencia.
- **THEME-SERIES, MIGRATE, línea pública US-only** — otros tracks.

**Alternativa rechazada (al recorte mismo):** aprovechar MET-4b para «ya que estamos» mostrar las muletas en vista rápida y añadir el filtro de persistencia. Rechazada: cada pieza extra antes de validar la lectura con uso real multiplica el coste de un rechazo del dueño; el spec entrega la unidad mínima aceptable o rechazable.

---

## Tickets siguientes

| Ticket | Contenido | Condición |
|---|---|---|
| **MET-4b** (implementación) | Funciones puras (contadores persistencia + lectura aceleración, patrón `descriptiveStrip`) + campos de fila en scan + bloque «Sostén de la tendencia» en ficha + motivos de ausencia + tests (etapa intacta, scoring untouched, ausencias honestas) + smoke visual ficha | Spec **aceptado** por el dueño; activar cuando lo pida |
| **MET-4c** (opcional, superficie) | Vista rápida y/o ficha compartible; filtro de persistencia si el dueño lo decide | Tras uso real de MET-4b |
| **MET-5** | Spec índice 0–100 salud de etapa (puede consumir muletas como insumo) | No empieza aquí |

---

## LO QUE NO VERIFIQUÉ

- **Nada ejecutado:** ni tests, ni scan, ni Supabase, ni navegador — spec only, sin diff de código de producto.
- **Distribución real de los contadores** (cuántos valores del universo llevan ≥N semanas sobre la media de 30): la utilidad de mesa del número exacto es hipótesis razonada, no medida sobre datos.
- **Banda muerta de aceleración (5 pp):** número propuesto por analogía con `flatPct`, sin backtest ni muestreo de distribución de `r1 − r0` sobre el universo; el dueño puede recortarlo o pedir calibración con casos reales.
- **Sensibilidad del reset estricto de persistencia** (cuántos líderes reales pierden el contador por una única semana bajo la media): no muestreado; es justo lo que el uso real de MET-4b debe enseñar antes de considerar tolerancias.
- **Cobertura de `perf6m` y `upDownVolRatio`** sobre filas intl y IPOs recientes: asumida desde las convenciones del scanner (`udVol` exige 80% de sesiones con volumen; `perf6m` exige 126 barras), no contada.
- **Espacio disponible en la franja descriptiva** de la ficha para tres líneas más: no comprobado en pantalla; si no cabe, es decisión de maquetación de MET-4b, no de metodología.
- **`docs/auditoria-etapas-2026-08-16.md` y `docs/diseno-salud-y-cambio-2026-08-16.md`** citados vía comentarios del código vivo y grep, no releídos enteros en esta sesión.
