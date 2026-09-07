# Análisis — Criterio de libros → etapas en screener + huecos de Mercado

Fecha: 2026-09-08
Rama: `codex/statsedge-ui-polish` · HEAD `344684e`
Ticket: `docs/tickets/AUDIT-CRITERIO-1-libros-etapas-mercado.md`
Tipo: auditoría read-only. **Sin diff de producto.** `lib/weeklyStage.js` y el scoring no se han tocado.

Convención de fuentes:
**[CÓDIGO]** leído en HEAD con ruta y línea.
**[LIBRO]** criterio de Weinstein/Minervini/O'Neil tomado de la extracción ya versionada (`docs/auditoria-etapa1-etapa2-2026-09-01.md` §2, con capítulo y página PDF; `research/notes/02-operational-extraction.md`; `research/notes/03-expanded-methodology-map.md`). **No se han reabierto los PDF en esta sesión** — ver «Lo que no verifiqué».
**[JUICIO]** valoración de producto de este informe, no un hecho del repo.

---

## 1. Resumen ejecutivo

1. **El hueco conceptual grande de las etapas ya está cerrado.** La frontera Weinstein E1/E2 (fuga del techo, no solo MM30s al alza) vive en `lib/weeklyStageStructure.js` como campo paralelo, se persiste en el scan y se muestra en mesa, ficha y vista rápida como calificador **«Pre-fuga» / «Con fuga»**. VCP-0 → STAGE-1 hicieron su trabajo; no hay que reabrirlo.
2. **Lo que queda de etapas no es criterio: es honestidad de la ausencia y superficie.** Cuando el subestado no concluye (`n/a`), la mesa muestra «Etapa 2» a secas y **calla el motivo**, mezclando tres casos muy distintos: dudoso mecánico, histórico corto (<56 semanas) y no aplica. El motivo ya está calculado y persistido (`weeklyStageStructureDetail`) — solo no se pinta.
3. **Hay una tercera cosa llamada «Etapa» en la UI.** En `/review` la fila rotulada **Etapa** muestra Trend Template diario («Precio > SMA50 > SMA150 > SMA200»), no la etapa Weinstein. Misma palabra, dos significados, dos pantallas. Es la lección C-15 repetida en otra superficie.
4. **El volumen de la fuga no se muestra.** Weinstein (2× la media previa) y O'Neil (+40-50%) coinciden en que el volumen confirma la ruptura. «Con fuga» con volumen seco y «Con fuga» con volumen 3× se ven idénticos.
5. **No existe la página de metodología.** Los specs MET-4 y MET-5 delegan en ella todos los umbrales declarados (2%, 32%, 26/10, 15/50%, pesos 25/10/20/25/20…). No hay ruta `/metodologia` en `app/`. El criterio no es auditable por el usuario.
6. **Mercado (Parte B) es el hueco real hoy.** El régimen se calcula sobre **5 ETF US** (SPY/QQQ/IWM/DIA = 90% del peso, ACWI 10%) y **11 sector SPDR US**, en un producto que vende US/Europa/Japón/HK/Canadá/Australia. La pregunta rectora del spec — «¿qué exposición tolera este mercado?» — se responde con un termómetro estadounidense.
7. **La mitad «dónde está el liderazgo» depende del navegador.** Leadership pulse y las tarjetas regionales salen de `localStorage`, no del servidor. Sin snapshot guardado, la sección queda vacía aunque el dato exista en `scan_results`.
8. **Mercado usa un criterio de etapa más pobre que la mesa**: llama `weeklyStageForBars` pero no `weeklyStageStructureForBars`. SPY sale «Etapa 2 confirmada» con el criterio que la propia auditoría marcó como incompleto.
9. **Falta el timing de mercado de la escuela**: follow-through day, nuevos máximos/mínimos, línea A/D, tasa de fugas fallidas. Y no hay **serie temporal** del régimen: todo es foto de hoy, y Weinstein es intrínsecamente temporal.
10. Si el dueño solo hace dos cosas: **MH-FILL-1** (paridad de criterio de etapa en Mercado) y **MH-FILL-3** (liderazgo desde servidor). Baratas y arreglan incoherencias ya pagadas.

---

## 2. Parte A — Etapas y métricas en el screener

### 2.1 Matriz libro → regla medible → código → UI

Estado: `ok` = implementado y visible con el nombre correcto · `parcial` = implementado pero no visible o mal declarado · `no` = no existe.

| # | [LIBRO] Criterio | Regla medible | [CÓDIGO] Dónde | [CÓDIGO] Superficie UI | Estado |
|---|---|---|---|---|---|
| W1/W6 | Etapa 1 = base lateral **bajo el techo**, media aplanándose | `stage1` + cierre ≤ techo 52s−4 | `weeklyStageStructure.js:157-159` | Mesa/ficha: «Etapa 1 · Pre-fuga» | ok |
| W3 | **Inicio de E2** = fuga del techo de la base y de la MM30s | `close_semanal > max(high, 52s excl. 4 últimas)` | `weeklyStageStructure.js:125-128` (`ruptura`) | Calificador «Con fuga» | ok |
| W4 | Tras la fuga, HH y HL sucesivos | Pivotes semanales radio 2, últimos dos crecientes | `weeklyStageStructure.js:52-73, 131-134` | Solo vía calificador; `weeklyHhHl` no se pinta | parcial |
| W5 | Sacudidas válidas sobre MM30s ascendente | precio vs MM30s + pendiente | `weeklyStage.js:135-190` | Columna Etapa · ficha «Media 30s» | ok |
| W8 | **Volumen de fuga ≥ 2×** la media del mes anterior | `vol_semana / mediana(4 previas)` | **no existe** en el módulo de estructura | — | **no** |
| W9 | Resistencia = **zona** tocada varias veces, no un tick | Candidato C (agrupar máximos ±2% / 0,5·ATR, ≥3 toques) | **no**: se usa candidato A (máximo 52s−4) | — | parcial |
| W10 | MM30s es la media de referencia; no comprar bajo MM30s descendente | precio vs MM30s + pendiente `flatPct=2%` | `weeklyStage.js:18-29` | Columna Etapa | ok |
| M1/M2 | Cuatro etapas heredadas; no comprar Etapa 1 | Clasificador 1–4 | `weeklyStage.js:122-191` | Columna Etapa, 4 estados + tentativa | ok |
| M3 | Transición 1→2: medias alineadas + HH/HL + **≥25-30% desde mínimo 52s** | `lowAdvance52w` | **no** en el subestado (`advanceFrom52wLow` sí existe para índices en Mercado) | — | **no** |
| M4 | Trend Template = ocho criterios | Seis criterios diarios | `trendStructure.js:32-45` | Filtro **Pulso**; fila «Etapa» de `/review` | parcial (ver A-3) |
| M5 | VCP **después** de Etapa 2 confirmada | Puerta G1: `stage === stage2`, con tight extra si `E2_ma_only` | `vcpEngine.mjs:591-601`, `setupPatterns.js:490-510` | Columna VCP · filtro `vcpWeeklyStageStructure` | ok |
| M6/O5 | Recuento de bases del avance (1ª-2ª mejores, 4ª-5ª tardías) | Histórico de fugas / conteo de bases | **no existe** | — | **no** |
| M7/O2 | Pivot = máximo de la última contracción | Detector de contracciones + distancia al pivote | `setupPatterns.js:267-356` | Columna VCP (2C · form · PV%) | ok |
| O3 | Volumen del día de fuga ≥ +40-50% | `relativeVolume` / `volumeSurgePct` (existen en fila) | `indicators.js` | No junto al calificador de fuga | parcial |
| O4 | Comprar **en** el pivote; >5-10% después = extendido | `distResistancePct`, `extSma50` | `weeklyStageStructure.js:127`; `indicators.js` | `weeklyDistResistancePct` **no se pinta** en mesa | parcial |
| O6 | El pivote no suele ser el máximo histórico viejo | — | Contradice el candidato A en uso | — | riesgo declarado |
| MET-4 | Sostén: persistencia MA, aceleración, volumen | 3 lecturas descriptivas | `trendSupport.js:110-268` | Ficha «Sostén de la tendencia» · vista rápida · filtro `minWeeksAboveSma30w` | ok |
| MET-5 | Solidez dentro de E2/E4 | Índice 0–100 ponderado | `stageHealth.js:19-247` | Ficha «Salud N/100» (solo ficha) | ok |

**Cobertura del subestado**: `weeklyStageStructureForBars` exige `lookbackWeeks + rightWeeks = 56` semanas de histórico (`weeklyStageStructure.js:111`). Por debajo devuelve `n/a` con detalle. IPOs recientes y buena parte del universo internacional joven **nunca** tendrán calificador.

### 2.2 Hallazgos

#### A-1 · `criterio-ok` — La frontera E1/E2 está resuelta y bien colocada

`lib/weeklyStageStructure.js` implementa el candidato B de la auditoría con sus umbrales declarados (caja 26s ≤32%, tendencia ancha ≥50%, pull ≥−8%, radio de pivote 2, techo 52s−4). No reclasifica: `weeklyStage.js` sigue intacto y el filtro «Etapa 2» sigue leyendo solo `weeklyStageState` (`screenerFilters.js:884-886`). El copy vive en un solo sitio (`lib/stageDisplay.js:99-116`) y lo consumen mesa, ficha, vista rápida, preview cards y chart identity card. Los campos se persisten y viajan en las proyecciones (`scanLightProjection.js:107-109`, `scanDecisionProjection.js:137-143`).

**No hay nada que corregir aquí.** Es el activo sobre el que se apoya todo lo demás.

#### A-2 · `hueco de producto` — El silencio del calificador es ambiguo

`stageDisplayForRow` solo añade el calificador si `structure` es `E2_ma_only` o `E2_structural` (`stageDisplay.js:139, 150`). Cuando es `n/a` no hay calificador **y no hay motivo**. Tres situaciones distintas se ven igual en la mesa:

| Caso real | `detail` calculado | Lo que ve el usuario |
|---|---|---|
| Ni caja ≤32% ni fuga+HH/HL (dudoso) | `ni caja ≤32% ni fuga+HH/HL (rng26=45%)` | «Etapa 2» |
| Histórico < 56 semanas | `Histórico semanal corto para 52+4 semanas de techo.` | «Etapa 2» |
| Etapa 3/4 (no aplica, correcto) | `código stage4; el subestado estructural no aplica` | «Etapa 4» |

En la muestra de 18 de la auditoría, **8 de 17 filas `stage2` (47%) caían en «dudoso»**. Si esa proporción se sostiene en el universo, casi la mitad de la mesa muestra una etapa sin calificar y sin decir por qué. Esto contradice el principio 3 («dato ausente = ausente con motivo, no silencio») que los specs MET-4/MET-5 defienden explícitamente. El coste de arreglarlo es bajo: el texto ya está en la fila.

#### A-3 · `mal nombrado en UI` — «Etapa» significa otra cosa en `/review`

```404:404:app/review/page.jsx
    ["Etapa", objectiveStage(row)],
```

`objectiveStage` (`lib/scoring.js:168-178`) devuelve `"Precio > SMA50 > SMA150 > SMA200"`, `"Precio < SMA200"`, `"Precio < SMA50"`, `"Precio > SMA200"`. Es una lectura de Trend Template **diario**, no la etapa Weinstein semanal. El mismo símbolo puede leerse «Etapa 2 · Pre-fuga» en la mesa y «Precio < SMA50» bajo el rótulo «Etapa» en la cola de revisión.

Severidad alta [JUICIO]: `/review` es la superficie donde el dueño decide, y es la única de las tres colas que no usa `stageDisplay.js`. El propio módulo existe porque este bug ya se pagó una vez en la tabla (comentario de cabecera de `stageDisplay.js`).

#### A-4 · `hueco de producto` — El volumen de la fuga no acompaña al calificador

W8 y O3 son la misma idea en dos libros: la ruptura sin volumen no es una ruptura. `weeklyStageStructure.js` calcula `ruptura` con precio de cierre y **no mira volumen en ningún punto**. La auditoría lo dejó fuera a propósito (la última semana de la muestra estaba seca en todos los símbolos y exigir 2× habría vaciado el resultado), y la decisión de **no** condicionar la etapa al volumen es correcta. Lo que falta es **reportarlo al lado**: `vol_semana_fuga / mediana(4 previas)` como dato de soporte del calificador «Con fuga», igual que las muletas MET-4 muestran «acompaña (1,4× up/down)».

#### A-5 · `hueco de producto` — «Etapa 1 · Con fuga» es el evento del libro y no es accionable

La lógica permite que un `stage1` con ruptura y HH/HL salga `E2_structural` (`weeklyStageStructure.js:163-165`): eso es literalmente la transición 1→2 de Weinstein, el momento que W3/W7 describen como la compra del inversionista. Hoy ese estado **se muestra** (aparece el calificador) pero **no se puede cazar**: el único filtro que lee `weeklyStageStructure` es `vcpWeeklyStageStructure` (`screenerFilters.js:913-918`), que vive dentro de la familia VCP y solo actúa con la puerta VCP activa.

Requiere decisión de producto, no de código: el ADR VCP-0 prohibió expresamente un filtro «E2 cazable» en v1 para no repetir C-15 (dos «Etapa 2»). La pregunta para el dueño es si ese veto sigue vigente ahora que el campo lleva una semana en producción. [JUICIO]

Nota menor: el valor se llama `E2_structural` aunque el estado sea `stage1`. Es confuso en logs y en el JSON de auditoría; en pantalla no se nota porque solo viaja la etiqueta.

#### A-6 · `proxy-honesto-pero-limitado` — El techo es el candidato A, con sus límites declarados

El módulo usa el máximo de 52 semanas excluyendo las 4 últimas. La propia auditoría lo documenta como insuficiente por dos vías: O6 (el pivote no suele ser el máximo viejo) y el caso SPY (una digestión alta dentro de E2 se etiqueta igual que una primera base tras una caída, porque no hay recuento de bases ni histórico de fugas). El candidato C (zona tocada ≥3 veces, más fiel a W9) quedó como iteración siguiente.

No es un defecto de ejecución: está declarado y el detalle lo dice. Es un techo de calidad conocido. [JUICIO] No lo tocaría antes que la Parte B.

#### A-7 · `hueco de producto` (transversal) — No existe la página de metodología

`app/` contiene `api`, `components`, `ipo-radar`, `lists`, `market-health`, `research-desk`, `review`, `sectors`, `stock`. **No hay ruta de metodología**, y ningún archivo de `app/` o `lib/` enlaza a una.

Los specs aceptados por el dueño la dan por existente y le delegan todo lo que hace auditable el criterio:

- `spec-salud-etapa.md` §Fórmula: «Página de metodología: sección "Salud de etapa" con la tabla completa de componentes/pesos/rampas/umbrales… la fórmula nunca se repite en la interfaz».
- `spec-muletas-tendencia.md` §Superficie: «definiciones, ventanas y umbrales (30/10 sem, 13 vs 13 sem, banda 5 pp, umbrales 1/1,25) viven ahí, una sola vez».

Hoy el usuario ve «Salud 90/100» y «Etapa 2 · Pre-fuga» sin ninguna vía para saber que detrás hay un `flatPct` del 2%, una caja del 32% y unos pesos 25/10/20/25/20 decididos a juicio. Para un producto cuya tesis es «clasificamos con criterio publicado, no recomendamos», esto es el eslabón que falta. [JUICIO]

#### A-8 · deuda menor — Segunda taxonomía de etapa viva en el payload de Mercado

`app/api/market-health/route.js:240-246` define un `stageLabel` local («Etapa 2 / alcista», «Base / transición», «Presión / corrección», «Etapa 4 / bajista», «Neutral») y lo asigna a `item.stage` en la línea 373. La tabla de índices **ya no lo muestra** — usa `stage30w` canónico, con un comentario que explica por qué se quitó (`page.jsx:927-930`) — pero el campo sigue viajando en la respuesta de la API y cualquier consumidor futuro lo pintaría. Borrado trivial; lo agrupo en MH-FILL-1.

### 2.3 Tickets propuestos — Parte A

| ID | Qué | Tamaño | Depende de |
|---|---|---|---|
| **STAGE-2** | Motivo de ausencia del calificador estructural. Cuando `weeklyStageStructure === "n/a"`, mostrar el porqué desde `weeklyStageStructureDetail`, distinguiendo *dudoso* / *histórico corto* / *no aplica*. Patrón `DESCRIPTIVE_ABSENCE`, en `stageDisplay.js` para que las tres superficies lo hereden | S | — |
| **STAGE-3** | `/review`: la fila «Etapa» pasa a usar `stageDisplayForRow`. Lo que hoy muestra `objectiveStage` se conserva con su nombre real (estructura diaria / Trend Template), no bajo el rótulo «Etapa» | S | — |
| **STAGE-4** | Volumen de la fuga como dato de soporte del calificador «Con fuga»: `vol_semana / mediana(4 previas)`. **No** entra en la clasificación ni en el subestado — solo se reporta | M | — |
| **STAGE-5** | *Decisión de dueño antes de código*: ¿el veto del ADR VCP-0 a un filtro por subestado sigue vigente? Si se levanta, filtro de estructura fuera de la familia VCP (nombre distinto de «Etapa 2») | S (tras decisión) | Dueño |
| **MET-7** | Página de metodología `/metodologia`: umbrales declarados de etapa, subestado, muletas y salud, con el ejemplo trabajado de MET-5. Cierra principio 5 en los cuatro tracks a la vez | M | — |
| **STAGE-6** | *Aplazado*: candidato C (zona de resistencia por toques) + recuento de bases (M6/O5). Investigación con corpus, no ticket de producto | L | STAGE-2..4 |

---

## 3. Parte B — Análisis de mercado

### 3.1 Checklist: qué debe verse según libros + framework, y qué hay

Fuentes de la columna «debe»: `docs/methodology/market-leadership-framework.md` §1, `research/notes/02-operational-extraction.md` §Market Condition, `research/notes/03-expanded-methodology-map.md` §Market Health Layer.

| # | Señal que debe verse | Estado hoy | Dónde [CÓDIGO] |
|---|---|---|---|
| 1 | Índices vs medias clave | **sí** | `market-health/route.js:191-204` |
| 2 | Pendiente MM larga | **sí** | `sma200Slope`, `sma30wSlope` en tabla de auditoría |
| 3 | Etapa del índice | **sí, pero sin subestado** | `route.js:191-204` usa `weeklyStageForBars`; **no** llama `weeklyStageStructureForBars` |
| 4 | % de índices/sectores sobre MM | **sí** | `weinsteinTape` `route.js:402-467` |
| 5 | % de sectores en Etapa 2 / Etapa 4 | **sí** | ídem |
| 6 | Amplitud del universo (% sobre SMA50/MM30s/SMA200) | **sí, US y dependiente del nocturno** | `lib/marketBreadth.js:70-165` |
| 7 | Participación (líderes que acompañan al índice) | **sí**, con serie temporal | `marketBreadth.js:356-399` |
| 8 | Liderazgo sectorial y su tipo (ofensivo vs defensivo) | **sí, sector ETF US** | `route.js:413-415, 434-435` |
| 9 | Liderazgo por región / país | **parcial: desde `localStorage`** | `page.jsx:396-408`, `GlobalRegionsPanel` |
| 10 | Líderes sosteniendo máximos vs rompiendo | **parcial: desde `localStorage`** | `buildScanPulse` `page.jsx:110-145` |
| 11 | Presión de distribución | **proxy con otro nombre** | `volumeTape` `route.js:206-224` |
| 12 | Tasa de **fugas fallidas** entre líderes | **no** a nivel mercado | `failedBreakout` existe por símbolo en `setupPatterns.js` |
| 13 | Nuevos máximos / nuevos mínimos | **no** | `rules.yaml` los lista como `_optional`; no implementados |
| 14 | Línea de avance/descenso (A/D) | **no** | — |
| 15 | Follow-through day (O'Neil) | **no** | solo en docs de diseño |
| 16 | Régimen por **región** (no solo US) | **no** | `INDEXES` = SPY/QQQ/IWM/DIA/ACWI |
| 17 | Participación por **industria** | **no** (solo sector ETF) | — |
| 18 | Contexto contrarian (sentimiento) | **sí**, en N2, rango correcto | `newsSentiment.js`, `socialSentiment.js` |
| 19 | Fiabilidad de datos declarada | **sí**, franja infra | `ReliabilityStrip` `page.jsx:263-322, 647-654` |
| 20 | **Qué cambió** desde el snapshot anterior | **no**, salvo participación | framework §10 lo pide explícitamente |

### 3.2 Estado real de la página

Buena noticia primero: **`MARKET-HEALTH-IA` está mayoritariamente ejecutado**. La jerarquía N0/N1/N2/N3 existe, la franja infra existe, el gauge semáforo y los colores hardcodeados (`#ef4444`, `#10b981`, `#2563eb`, `#a855f7`, `#0a0a0d`) **no aparecen** en `app/market-health/*` ni en `styles/market-health.css` — se usan tokens. Los estilos inline que quedan son geometría dinámica (ancho de micro-barra, posición de marcador), no color. La constelación se resolvió como `StageStrip` con curva SVG, documentado como sustituto en la cabecera del componente. Los 8 KPIs duplicados de sentimiento se eliminaron.

Lo que **no** cerró el spec y sigue abierto es de contenido, no de forma:

- **El régimen es US.** `INDEXES` (`route.js:15-21`): SPY 30, QQQ 30, IWM 20, DIA 10, ACWI 10. `SECTOR_ETFS` (`route.js:23-35`): los 11 SPDR estadounidenses. El `marketScore`, el régimen, la `weinsteinTape` y el KPI «Sectores en etapa 2» son, en la práctica, una lectura del mercado estadounidense con un 10% de peso global.
- **La mitad de la pregunta rectora depende del navegador.** «Dónde está el liderazgo» se responde con `buildScanPulse` sobre `safeRead(STORAGE_KEYS.scans)` (`page.jsx:110-145, 535`). Sin snapshot guardado en ese navegador, la sección muestra un CTA en lugar de datos, aunque las filas estén en `scan_results` del servidor.
- **La amplitud sí es de servidor pero solo US**, y cae entera si no hay nocturno (`marketBreadth.js:416-419`), con umbral de cobertura del 60%.

### 3.3 Gaps priorizados

Clasificación pedida por el ticket: *dato ya existe* (solo hay que mostrarlo/mover) · *falta API* · *falta UI* · *ops Mini*.

| # | Gap | Clase | Nota |
|---|---|---|---|
| G1 | Índices y sectores sin subestado estructural | **dato ya existe** | Mismo módulo, mismas barras; `route.js` ya importa `weeklyStage` |
| G2 | Leadership pulse y regiones desde `localStorage` | **falta API** | Los datos están en `scan_results`; hace falta un agregado servidor |
| G3 | «Dist/Acc 20d» presentado como días de distribución | **dato ya existe** | Es el **promedio de los 11 sectores** (`route.js:453-454`), no el conteo sobre el índice — que sí se calcula y sale en la tabla de auditoría (`page.jsx:940`) |
| G4 | Régimen solo US | **falta API** | Decisión previa: qué índice por región y de dónde salen las barras |
| G5 | Sin nuevos máximos/mínimos ni A/D | **falta API** | Calculable desde `scan_results` para el universo cubierto |
| G6 | Sin tasa de fugas fallidas de mercado | **falta API** | `failedBreakout` existe por fila; falta el agregado |
| G7 | Sin serie temporal del régimen | **falta API + ops** | Exige persistir el score histórico (hoy la caché es de 4 h en `app_settings`) |
| G8 | Sin follow-through day | **falta API** | [JUICIO] baja prioridad: es señal de timing, roza el terreno de «señal de compra» que los principios vetan |
| G9 | `item.stage` (taxonomía muerta) en el payload | **dato a borrar** | `route.js:240-246, 373` |

Sobre G3, el matiz importa para el criterio: O'Neil cuenta días de distribución **sobre el índice**, en una ventana de ~25 sesiones, exigiendo caída con volumen superior al día anterior. Lo que muestra el KPI hero es el promedio de un conteo de 20 sesiones sobre once ETF sectoriales, con «alto volumen» definido como superior a la media de 20 previas **y** al día anterior (`route.js:206-224`). Es un proxy defendible de presión interna, pero **no es el indicador que su nombre sugiere**, y el conteo correcto por índice ya está calculado a dos líneas de distancia.

### 3.4 Tickets propuestos — Parte B

| ID | Qué | Tamaño | Clase |
|---|---|---|---|
| **MH-FILL-1** | Paridad de criterio de etapa: `weeklyStageStructureForBars` para índices y sectores; el calificador «Pre-fuga»/«Con fuga» viaja a la tabla de índices y al `StageStrip` vía `stageDisplay.js`. Incluye borrar el `stageLabel` muerto (G9) | S | dato existe |
| **MH-FILL-2** | Días de distribución honestos: KPI hero pasa al conteo **sobre el índice** con ventana declarada; el promedio sectorial se conserva con su nombre real («presión sectorial») o baja a N3 | S | dato existe |
| **MH-FILL-3** | Leadership pulse y liderazgo regional desde servidor: agregado sobre `scan_results` en vez de `localStorage`. Cierra la mitad «dónde está el liderazgo» de la pregunta rectora | M | falta API |
| **MH-FILL-4** | Amplitud real del universo: nuevos máximos/nuevos mínimos y tasa de fugas fallidas entre líderes, calculados sobre las filas del nocturno | M | falta API |
| **MH-FILL-5** | **Régimen por región.** Decidir el índice de referencia por mercado (US/EU/JP/HK/CA/AU), calcular etapa + amplitud por región y romper el monopolio de SPY sobre el veredicto. El ticket grande | L | falta API + decisión |
| **MH-FILL-6** | «Qué cambió»: serie del market score y del % sobre MM30s (8-13 semanas) para que el régimen tenga historia y no solo foto | M | falta API + ops Mini |

---

## 4. Orden sugerido

Si el dueño solo hace **una** cosa: **MH-FILL-1**. Es la incoherencia más barata y más visible — la mesa ya distingue pre-fuga de fuga y Mercado no, con el mismo módulo disponible a un import de distancia.

Si hace **dos**: añadir **STAGE-2**. Cierra el principio 3 en la columna que el dueño mira todo el día, con el texto ya calculado en la fila.

Orden completo sugerido:

1. **MH-FILL-1** + **STAGE-2** — paridad de criterio y ausencias honestas. Baratos, sin decisiones nuevas.
2. **STAGE-3** — quitar la tercera acepción de «Etapa» en `/review`.
3. **MH-FILL-3** — el liderazgo deja de depender del navegador.
4. **MET-7** — página de metodología. A partir de aquí el criterio es auditable y los tickets siguientes pueden apoyarse en ella en vez de repetir umbrales en tooltips.
5. **MH-FILL-2** + **STAGE-4** — volumen y distribución con su nombre correcto.
6. **MH-FILL-5** — régimen regional. El trabajo grande; conviene después de MET-7 para poder declarar el criterio por región en un solo sitio.
7. **MH-FILL-4**, **MH-FILL-6**, **STAGE-5/6** — según lo que el uso real pida.

Los tres primeros escalones no requieren ninguna decisión de producto nueva: son coherencia con criterios que el dueño ya aceptó.

---

## 5. Confianza

| Afirmación | Base |
|---|---|
| `weeklyStageStructure` implementado, con umbrales y labels | Lectura completa del módulo en HEAD |
| Superficies donde se muestra la etapa | `stageDisplay.js`, `screenerColumns.jsx:266-290`, `page.jsx:930`, `review/page.jsx:404` leídos |
| `/review` muestra Trend Template bajo el rótulo «Etapa» | `scoring.js:168-178` + `review/page.jsx:404` leídos |
| No existe página de metodología | `ls app/` + búsqueda de enlaces: 0 resultados |
| Régimen sobre 5 ETF US + 11 SPDR | `route.js:15-35` leído |
| Dist/Acc 20d = promedio sectorial | `route.js:206-224, 453-454` leídos |
| Leadership pulse desde `localStorage` | `page.jsx:110-145, 535` leídos |
| Criterios de libros (W1-W10, M1-M7, O1-O6) | **Auditoría 2026-09-01 §2**, no relectura de PDF |
| 47% de filas `stage2` en «dudoso» | Muestra n=18 de la auditoría; **no es una tasa de universo** |

---

## 6. LO QUE NO VERIFIQUÉ

- **No he reabierto ningún PDF de `research/books/`.** La capa de libro procede de la extracción ya versionada en `docs/auditoria-etapa1-etapa2-2026-09-01.md` §2 (que sí cita capítulo y página) y de las notas de `research/notes/`. Si alguna paráfrasis de aquella auditoría estaba mal, este informe la hereda.
- **No he ejecutado nada**: ni tests, ni scan, ni consultas a Postgres/Mini, ni navegador. Sin smoke visual.
- **Cobertura real del subestado en la mesa**: cuántas filas del nocturno tienen `weeklyStageStructure` distinto de `n/a`, y cuántas de esas `n/a` son por histórico corto vs dudoso. Es una consulta a `scan_results` que no he corrido; el 47% citado viene de la muestra de 18 de la auditoría y **no debe leerse como tasa del universo**.
- **Estado visual de `/market-health` en navegador**: la valoración de la ejecución del spec sale de leer el JSX y el CSS, no de una pantalla. No he comprobado el recuento real de KPIs en pantalla ni si la jerarquía se lee como pretende el spec.
- **Los tres subagentes de exploración** que produjeron el mapa inicial: he verificado a mano los puntos que sostienen cada hallazgo (módulos, líneas y strings citados arriba), pero no todas las rutas secundarias que reportaron (`chartIdentityCard.js`, `screenerHuntTape.jsx`, `research-desk`, `company-brief`).
- **Estimaciones de tamaño (S/M/L)** de los tickets: juicio, sin desglose de archivos.
- **`docs/auditoria-etapas-2026-08-16.md`**, `docs/diseno-indicadores-mercado-2026-08-17.md` y la serie `diseno-contracciones-v*.md`: citados a través de otros documentos y de los comentarios del código, no leídos enteros en esta sesión.
- **Si `MH-FILL-5` es viable con el proveedor actual**: no he comprobado que Yahoo sirva barras fiables para los índices de referencia europeos/asiáticos que un régimen regional necesitaría.

Sin commit ni push. `lib/weeklyStage.js`, el scoring y el código de producto no se han modificado.
