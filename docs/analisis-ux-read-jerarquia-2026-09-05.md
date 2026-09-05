# UX-READ-1 — Retorno Fable: jerarquía de lectura (mesa → ficha) · 2026-09-05

Fuente: brief `docs/tickets/UX-READ-1-fable-jerarquia-lectura.md`.  
Modelo: Fable 5.1. Sin código. HEAD citado: `a810d2f` (rama `codex/statsedge-ui-polish`).  
Smoke propio: hard-reload Mini `http://127.0.0.1:13000/` (Líderes Etapa 2, 50 filas) y `/stock/AAPL`. La sesión del Mini tenía selección Global (28 mercados, 17 en mesa) en vez de la mesa US del orquestador; las proporciones coinciden con la evidencia del brief y se citan las medidas propias.

---

## Resumen

La mesa no tiene diez columnas porque el pase de caza necesite diez datos: las tiene porque cada ficha de caza añadió su pregunta a la misma parrilla y ninguna la retiró. En Líderes Etapa 2, medido en 50 filas: la palabra «Etapa 2» es constante (el preset la exige), RS país es idéntico a RS en 22/50 y difiere en ±1 en el resto (universo mono-US), RS tema falta en 28/50 y VCP falta en 31/50. Cuatro de diez columnas no distinguen una fila de la siguiente en ese gesto. Lo que sí decide abrir o pasar son tres cosas: la forma (miniatura), un RS y la distancia al máximo; el rendimiento a 3M ya está dicho por el orden.

La ficha de caza debe ser lente y no solo filtro. El precedente ya existe en código: `WEAKNESS_SCORE_COLUMN` aparece solo en Deterioro. Generalizarlo cierra la pregunta «¿un RS o tres?» sin perder nada: un RS en la parrilla base, RS país como lente de Líderes intl, VCP como lente de Cerca de pivot, RS tema fuera de la mesa. Etapa y VCP no son dos dialectos del mismo setup: Etapa (código + «Con fuga») responde «¿ha salido ya?» y VCP («2C·form·PV%») responde «¿está comprimiendo antes de salir?». Son dos preguntas; cada una tiene su ficha.

En `/stock`, el gráfico con su badge es el escenario y todo lo demás es leyenda, pero la leyenda repite: la etapa 2 se cuenta cuatro veces (chip N0, raíl de la tarjeta, «Media 30s ascendente», «Sobre la media de 30 semanas: 21 semanas»), el reparto de volumen dos (celda 0,91× y frase «en contra (0,9×)»), y el RS se ve en tres dialectos con cifras distintas en la misma pantalla (tarjeta FR 64 · RS país 64; overlays RS 72 · RS país 64 · RS tema 57 activos por defecto). «Salud de etapa 57/100» es el mismo desglose que «Sostén de la tendencia» dicho en número en vez de en prosa.

La línea de verdad hoy es un log de nueve segmentos más badge. Dos cifras merecen peso: cuántas pasan (con su denominador) y el corte. Orden y paginación ya están en la cabecera y en el pager; los mercados desalineados son alarma, no verdad; «RANKING PROVISIONAL» es un atributo de los percentiles RS, no de la población, y su sitio son las celdas RS con marca y leyenda, no la frase.

Dirección: cinco oleadas sustractivas y acotadas (parrilla base 7 + lente por ficha, verdad de dos cifras, una lectura de etapa en la ficha, un RS por defecto en el chart). Nada de scoring, motor, umbrales, aside ni rail.

## Decisiones dueño (2026-09-05, post-retorno)

| # | Decisión | Implicación vs Fable |
|---|---|---|
| 1 | **VCP se queda en la mesa** (también en Líderes E2). Muchas filas seguirán sin patrón; TABLE-QUIET-1 ya las deja en guion. | No retirar VCP de `SCREENER_COLUMNS`. Lente VCP solo en Cerca de pivot **no** es requisito. |
| 2 | **RS en mesa:** US solo → columna **RS** (global). Mezcla / no-US → también **RS país**. **RS tema** solo en ficha del valor, nunca en tabla. | Retirar RS tema de la parrilla. RS país **condicional** a mercados (no «solo ficha intl»). |
| 3 | Indiferente dónde vive el provisional; lo que importa es **menos mensajes de laboratorio** en la UI: solo avisos relevantes, compactos. | READ-C: acortar verdad + no gritar jerga; provisional puede ir a RS o quedar mínimo — criterio = ruido de producto, no ubicación estética. |

Oleadas ajustadas: **READ-A** = fuera RS tema + RS país solo si mesa no es US-only; VCP se mantiene. **READ-B** = opcional/aplazado (lente VCP ya no urgente). **READ-C** = verdad/avisos. D/E ficha-chart sin cambio de prioridad.

## Las 4 preguntas

### 1. Fila en ~1,5 s (Líderes Etapa 2)

**Tres datos:** (a) **forma** — la miniatura del ticker (P7.1 ya lo dice: «adelanta medio análisis»); (b) **RS**, un número; (c) **Dist. máx 52s** («¿llego tarde?»). El **Rend. 3M** no hace falta leerlo: es el orden, y la posición en la lista ya lo cuenta. El calificador **«Con fuga»** es el cuarto dato útil (31/50 lo llevan, 19/50 no): es la única variación real de la columna Etapa en esta ficha.

**Ruido en ese gesto (medido, 50 filas Mini):**
- **ETAPA palabra:** 50/50 «Etapa 2». El preset `balanced` la exige (mode strip: «Etapa 2 mínima»). La palabra es eco del filtro; el calificador es el dato.
- **RS país:** 22/50 exactamente igual a RS; resto difiere en 1 (92/91, 95/94…). Memoria `ficha-descriptiva-franja-2a`: `rsCountryPct == rsGlobalPct` en universo mono-US. En Líderes intl sí informa.
- **RS tema:** 28/50 ausente (guion quieto, TABLE-QUIET-1). Solo 12 themes curadas.
- **VCP:** 31/50 ausente. Cuando existe (`2C·form·PV-1.5%`) es la pregunta de Cerca de pivot, no la de Líderes E2.
- **Tema:** contexto de grupo, no decide abrir/pasar. Se queda, subordinado.
- **Capitaliz.:** cola necesaria (P7.7), no lectura.

La fila mide 66 px de alto y 1360 px de ancho: 272 px de ticker+miniatura, 272 px para tres RS, 245 px para Etapa+VCP. Siete columnas caben cómodas; diez aprietan (P7, «Aplazado»).

### 2. La ficha de caza como lente

**Hoy** (`lib/screenerHuntCards.js`): ficha = `presetKey` + `defaultSort`. No cambia columnas. La única lente existente es `WEAKNESS_SCORE_COLUMN` en `screenerVisibleColumns(ctx)` (Deterioro), insertada tras Etapa. Es el molde.

**¿Un RS o tres?** Uno en la parrilla base (P7.3 lo decidió en agosto y la parrilla lo desobedece). RS país es **lente de Líderes intl**: el preset `intl` se describe como «sin RS canónico» y allí el ranking intra-mercado es el dato. RS tema **no es lente de ninguna ficha del rail**: va a la ficha del valor (ya está: overlay del chart y tarjeta).

**¿Etapa vs VCP: dos juicios o dos dialectos?** Dos juicios distintos sobre la misma pregunta de fondo («¿dónde está el precio respecto a su estructura?»):
- Etapa «Etapa 2 · Con fuga» = ciclo MM30s + techo/fuga Weinstein. Responde **«ya ha salido»**. Es la lente natural de **Líderes Etapa 2**.
- VCP «2C·form·PV-1.5%» = contracciones + distancia al pivot Minervini. Responde **«está comprimiendo antes de salir»**. Es la lente natural de **Cerca de pivot**.

No se fusionan. Se reparten. Nota de honestidad de copy (no de umbrales): el preset `nearPivot` filtra por distancia a máximos 20d/50d/52s (`maxDistance20dHigh: 6`…), no por `distanceToPivotPct` (eso vive en la capa VCP, apagada por defecto). La ficha se llama «Cerca de pivot» y el único dato de pivot real que la mesa puede enseñar es el `PV%` de la columna VCP. Poner VCP como lente de esa ficha es lo que hace verdadero el nombre.

**Qué columna existe solo en cada ficha (propuesta):**

| Ficha | Parrilla base (7) | Lente (+1) |
|---|---|---|
| Líderes Etapa 2 | Ticker · Tema · RS · Etapa (+calificador) · Rend. · Dist. 52s · Cap. | ninguna |
| Cerca de pivot | misma | **VCP** (tras Etapa) |
| Deterioro | misma | **Deterioro** (ya existe) |
| Líderes intl | misma, con **RS país en el hueco de RS** | — |
| Radar IPO | misma | ninguna (badge «Vigilada» ya en ticker) |

### 3. Ficha `/stock`: una frase canónica

**Canónico:** el gráfico es el escenario de decisión; el badge «BASE CONSTRUCTIVA 12.9% → 4.9%» es la frase única de estructura (CHART-BADGE-2); la tarjeta de identidad sobre el lienzo da identidad + etapa (raíl «2 · sem. 21») + un RS + Máx. 52s. Eso es lo que se lee. El resto es leyenda.

**Qué repite (medido en AAPL, Mini):**

| Dato | Apariciones visibles | Dónde |
|---|---|---|
| Etapa 2 | 4 | chip N0 «ETAPA 2» · raíl tarjeta «2 sem. 21» · franja «Media 30s +10,6% ascendente» · Sostén «Sobre la media de 30 semanas: 21 semanas (media ascendente)» |
| Reparto volumen up/down | 2 | franja «Reparto vol. 50d 0,91× up/down» · Sostén «Volumen: en contra (0,9× up/down, 50 sesiones)» |
| RS | 3 dialectos, cifras distintas | tarjeta «FR 64 · RS PAÍS 64» (idénticos, mono-US) · overlays activos «RS 72 · RS país 64 · RS tema 57» · vista rápida del screener «RS 57» |
| Salud de etapa | 2 formatos | «57/100» + desglose «media 30 sem 20.2 de 25 · media 10 sem 2.0 de 10 · avance 15.0 de 20 · volumen 0.0 de 25 · extensión 20.0 de 20» **es** el Sostén en número |
| Taxonomía | 2 | kicker N0 «TECHNOLOGY · NASDAQGS» (inglés crudo) · tarjeta «Consumer tech / hardware» |
| 12.9% → 4.9% | 1 visible + 1 enterrado | badge · «Evidencia VCP · 2 comp. · 12.9% -> 4.9%» dentro de N3 «Metodología y gates» (plegado: aceptable, es auditoría) |
| −7,1% | 1 visible + 1 enterrado | tarjeta «Máx. 52s −7,1%» · metodología «pivot −7,1%» (plegado) |

Lo que no repite y aporta: Media 50d / 200d, Volumen 10d/50d «secado», Impulso 5/20d, la línea «Avance: mantiene (−5% vs −2%)», N3 entero (auditoría plegada), Similares, Fundamentales, Noticias.

**Veredicto:** gráfico + badge + tarjeta = decisión. Franja = los números que el gráfico no dibuja. Sostén = la única lectura de etapa en prosa; la puntuación 57/100 se pliega dentro (no se recalcula nada). N3 = auditoría, correcto tal cual. El chip N0 se mantiene (decisión 22-ago: único dato de etapa sin scroll).

### 4. Verdad: instrumento vs log

**Observado:** `3867 analizadas · 681 pasan «Líderes Etapa 2» · 681 en lista · 50/página · 17 mercados en mesa · 28 mercados en selección · selección ≠ mesa · orden: Rendimiento 3M ↓ · corte 5 sept, 13:03` + badge `RANKING PROVISIONAL`. Nueve segmentos + badge. Es un log.

**Peso (dos cifras):**
1. **`681 de 3867 pasan`** — la cifra de la caza con su denominador fusionado.
2. **`corte 5 sept, 13:03`** — frescura.

**A `details` («¿Qué recorta?») o fuera:**
- `681 en lista` — idéntico a «pasan» siempre que no haya filtros de vista. Mostrar **solo cuando difiera** («· 120 en lista»).
- `50/página` — control del pager, no verdad.
- `17 mercados en mesa · 28 en selección · selección ≠ mesa` — tres segmentos de alarma. Ya existe banner accionable (UX-2). En la frase queda como máximo «mesa US» compacto cuando está alineado; desalineado → solo banner.
- `orden: Rendimiento 3M ↓` — la cabecera ya lo enseña («Rend. 3M ↓») y `screenerSortOptions` solo permite ordenar por columnas visibles; el segmento es redundante por construcción.

**RANKING PROVISIONAL:** es un hecho sobre los **percentiles RS** de ciertas filas (`percentileScope === "batch"`), no sobre la población. Su sitio: marca en la **cabecera RS** (leyenda: «algunos percentiles calculados sobre lote; cambian al finalizar») y marca discreta en las **celdas afectadas**, con el mismo gesto que el «·» de etapa tentativa (P7: sin etiquetas de estado en la fila; una marca, no una palabra). **Callar hasta percentil final** violaría P3 (métrica sobre muestra insuficiente se marca). En la frase de verdad, fuera.

## IA de lectura (mesa / ficha / verdad)

| Zoom | Se ve | No se ve (vive en otro sitio) |
|---|---|---|
| **Mesa, cada fila (diario)** | Miniatura + ticker · Tema · **RS** (uno) · **Etapa + calificador** · Rend. (selector global = orden) · **Dist. máx 52s** · Cap. | RS país (salvo Líderes intl) · RS tema · VCP (salvo Cerca de pivot) · Deterioro (salvo Deterioro) |
| **Mesa, lente de ficha** | Una columna extra o sustituida según ficha (tabla en §2) | — |
| **Verdad (una frase)** | «681 de 3867 pasan · corte 5 sept 13:03» (+ «· N en lista» solo si ≠) | orden · página · mercados · ranking provisional |
| **Cabecera RS** | Marca si hay percentiles por lote, con leyenda | — |
| **Ficha, sin scroll** | N0 (ticker, precio, cierre, chip etapa) · gráfico · badge de estructura · tarjeta (raíl etapa, un RS, Máx. 52s, base ausente con motivo, crecimiento) | RS país en tarjeta salvo mercado no-US o ≠ FR |
| **Ficha, bajo el gráfico** | Franja: Media 30s/50d/200d · Volumen 10d/50d · Impulso 5/20d. Sostén: tres frases (media 30 sem, avance, volumen) con «Salud 57/100 · desglose» plegado dentro | Reparto vol. como celda (queda solo en la frase de Sostén) |
| **Ficha, chart overlays** | Una línea RS por defecto (canónica); RS país / RS tema bajo demanda | — |
| **Ficha, auditoría (plegado)** | N3 entero, incluida Evidencia VCP con «12.9% → 4.9%», pivot, base 13,0 sem | — |
| **Se retira** | Segmentos de la verdad listados · kicker N0 en inglés crudo (o pasa por la taxonomía Tema) · celda «Reparto vol. 50d» duplicada · dos de tres overlays RS por defecto | — |

## Kill list

| Superficie actual | Acción | Motivo |
|---|---|---|
| **Mesa** | | |
| Columna RS país | **lente-por-ficha** (Líderes intl, en el hueco de RS) | 22/50 idéntica a RS, resto ±1 (mono-US). P7.3 |
| Columna RS tema | **retirar** de la mesa (sigue en ficha: overlay + tarjeta) | 28/50 ausente; solo 12 themes; P7.3 |
| Columna VCP | **lente-por-ficha** (Cerca de pivot, tras Etapa) | 31/50 ausente en Líderes E2; único dato de pivot real; en Cerca de pivot es la pregunta |
| Columna ETAPA (palabra) | **mantener**; el calificador es la información | constante «Etapa 2» en Líderes E2; «Con fuga» 31/50 |
| Columna Tema | **mantener**, peso secundario | contexto de grupo; no decide abrir/pasar |
| Columna Capitaliz. | **mantener**, cola | P7.7 |
| Columna Deterioro (contextual) | **mantener** como molde de lente | ya implementado en `screenerVisibleColumns` |
| Miniatura en ticker (272 px) | **mantener** | P7.1: adelanta medio análisis |
| **Verdad** | | |
| «3867 analizadas» | **fusionar** → «681 de 3867 pasan» | denominador, no cifra |
| «681 pasan «Líderes Etapa 2»» | **mantener**, peso | la cifra de la caza |
| «681 en lista» | **enterrar**: solo si ≠ pasan | redundante al 100 % sin filtros de vista |
| «50/página» | **retirar** → pager | control, no verdad |
| «17 mercados en mesa · 28 en selección · selección ≠ mesa» | **retirar** de la frase → banner accionable existente; alineado: «mesa US» compacto | alarma de tres segmentos, no verdad |
| «orden: Rendimiento 3M ↓» | **retirar** | cabecera ya marca «↓»; solo se ordena por columnas visibles |
| «corte 5 sept, 13:03» | **mantener**, peso | frescura |
| Badge «RANKING PROVISIONAL» en la verdad | **mover** a cabecera RS (marca + leyenda) y celdas afectadas (marca) | atributo de percentiles, no de población; callar viola P3 |
| `details` «¿Qué recorta?» | **mantener**; recibe lo retirado | log en su sitio |
| **Ficha `/stock`** | | |
| Badge «Base constructiva 12.9% → 4.9%» | **mantener**, canónico | frase única de estructura |
| Kicker N0 «TECHNOLOGY · NASDAQGS» | **fusionar** con taxonomía Tema o **retirar** | inglés crudo; tarjeta ya dice «Consumer tech / hardware» y exchange; pendiente desde 15-ago |
| Chip N0 «ETAPA 2» | **mantener** (decisión 22-ago) | único dato de etapa sin scroll |
| Tarjeta: raíl «2 · sem. 21» | **mantener** | canónico de etapa en la lente |
| Tarjeta: «RS país 64» junto a «FR 64» | **enterrar**: solo si ≠ FR o mercado no-US | idéntico en universo mono-US |
| Overlays RS / RS país / RS tema activos por defecto (72 / 64 / 57) | **retirar** dos por defecto; bajo demanda | tres RS con cifras distintas a la tarjeta en la misma pantalla |
| Franja «Media 30s +10,6% ascendente» | **mantener** | número que el gráfico no da |
| Franja «Reparto vol. 50d 0,91× up/down» | **fusionar** con Sostén «Volumen: en contra (0,9×)» — queda la frase | misma cifra dos veces (número + adjetivo) |
| «Salud de etapa 57/100» + «Desglose» | **enterrar** dentro de Sostén (details) | Sostén es la prosa del mismo desglose; número tipo score en primer plano roza P1 |
| Sostén «Sobre la media de 30 semanas: 21 semanas (media ascendente)» | **mantener** como única frase de etapa en prosa | raíl y franja dan número; esta da lectura |
| N3 «Evidencia VCP · 2 comp. · 12.9% -> 4.9%» | **mantener** enterrado | auditoría plegada, no repetición visible |
| Tarjeta «Máx. 52s −7,1%» vs metodología «pivot −7,1%» | **mantener** | uno visible, otro plegado |

## Oleadas

| ID | Título | Prio | Zona | Riesgo | Criterio aceptación |
|---|---|---|---|---|---|
| **READ-A** | Parrilla base a 7: retirar RS país, RS tema y VCP de `SCREENER_COLUMNS`; siguen calculándose | P0 | columnas (`lib/screenerColumns.jsx`) | Bajo. Tests de columnas y sort options; móvil comparte la lista | En Líderes E2 la fila muestra 7 columnas; `screenerSortOptions` no ofrece RS país/tema/VCP; `./vfc` OK; smoke Mini 50 filas |
| **READ-B** | Lente por ficha: `lensColumn` en `HUNT_CARDS`; `screenerVisibleColumns(ctx)` la inserta (VCP en Cerca de pivot tras Etapa; RS país sustituye a RS en Líderes intl; Deterioro ya) | P0 (tras A) | hunt-lens (`lib/screenerHuntCards.js`, `screenerVisibleColumns`) | Medio. El sort default de Cerca de pivot sigue `distance52w`; comprobar que la lente entra en `screenerSortOptions` | Cambiar de ficha cambia como mucho una columna; máx. 8 columnas; test por ficha; smoke de las 5 fichas |
| **READ-C** | Verdad de dos cifras: «N de M pasan · corte»; «en lista» solo si ≠; orden y página fuera; mercados solo alineado-compacto; `RANKING PROVISIONAL` → marca en cabecera RS + celdas `percentileScope === "batch"` | P1 | verdad (`lib/screenerTruthLine.js`, `ScreenerShell.jsx` líneas ~719-722, `screenerColumns.jsx` cabecera RS) | Medio. `tests/screenerTruthLine.test.js` y `screenerPercentileScopeBanner.test.js` cambian de contrato; banner de desalineación debe seguir disparando solo | Frase ≤ 3 segmentos en estado normal; con filtros de vista aparece «en lista»; badge no está en la frase y sí en cabecera RS cuando hay lote; tests actualizados |
| **READ-D** | Una lectura de etapa en la ficha: «Salud de etapa» plegada dentro de Sostén; celda «Reparto vol. 50d» fuera de la franja (queda en Sostén); kicker N0 pasa por taxonomía Tema o se retira; «RS país» en tarjeta solo si ≠ FR o no-US | P1 | ficha (`DescriptiveStrip.jsx`, `ChartIdentityCard.jsx`, `StockClient.jsx` N0) | Medio. JSX → hard-reload obligatorio; `tests/descriptiveStrip.test.js`, `fichaRetiradas.test.js` | AAPL: etapa 2 visible en chip + raíl + Sostén (3, no 4); reparto vol. una vez; kicker legible; smoke Mini `/stock/AAPL` y un no-US |
| **READ-E** | Un RS por defecto en el chart: overlay canónico activo, RS país / RS tema apagados por defecto (preferencia global, no por símbolo) | P2 | chart (`app/ChartPreferences.jsx`, defaults) | Bajo-medio. Preferencias persistidas del dueño pueden pisar el default; el badge no se toca | Ficha nueva sin preferencias muestra una línea RS; los botones RS país / RS tema siguen; smoke con hard-reload |

Orden: A → B → C ∥ D → E. Cada una un commit; A y B son alto riesgo visual (layout) y llevan smoke antes de commit.

## Qué no tocar

- Scoring, `stageHealth`, motor VCP, `setupPatterns`, umbrales de presets (`screenerFilterCatalog.js`), `nearPivot` como filtro — el nombre «Cerca de pivot» se hace verdadero con la lente VCP, no cambiando el preset.
- Rail de 5 fichas, `HUNT_CARDS` como preset + sort (solo se añade `lensColumn`).
- Aside SHELL A→D, mesa de vistas UX-1, chips «+ Filtro».
- Guion quieto de TABLE-QUIET-1 (sigue valiendo para las columnas que queden y para las lentes).
- Gating badge ≠ markers de CHART-BADGE-2; el badge es la frase canónica y no se mueve.
- Chip N0 de etapa (decisión 22-ago), densidad de la tarjeta 2c (decisión del dueño 21-ago), N3 plegado.
- Tokens, look, móvil ya medido, Mini / GHA / finalize.
- Vista rápida del screener (UX-P4, pendiente aparte): solo se anota que enseña «RS 57» mientras la ficha dice FR 64.

## LO QUE NO VERIFIQUÉ

- Mesa **US** del orquestador: mi sesión Mini estaba en Global (28 mercados, 17 en mesa, 3867 analizadas, 681 pasan). Las proporciones de ausencia (VCP 31/50, RS tema 28/50, «Con fuga» 31/50) son de esa sesión, no de la mesa US del brief (30/50 y 29/50).
- Por qué el overlay del chart dice «RS 72» y la tarjeta «FR 64» para AAPL (y la vista rápida «RS 57»): no seguí el dato; solo constato tres cifras en pantalla.
- Visibilidad del badge en reposo con la tarjeta desplegada: `opacity: 1` computado, pero en la captura del lienzo no lo distinguí; la memoria del 21-ago dice «opacity 0 salvo hover» cuando la tarjeta está visible. Comprobar antes de READ-E.
- Móvil (`lib/screenerMobile.jsx` comparte `SCREENER_COLUMNS`): no medí cómo se comporta con 7 + lente.
- Coste de `screenerVisibleColumns(ctx)` leyendo la ficha activa en cada render; y si `screenerSortInvariant` necesita saber de la lente al cambiar de ficha.
- Ficha de un valor no-US para confirmar que «RS país ≠ FR» ocurre y justifica la regla de enterrado condicional.
- Gestos mutadores en la sesión del dueño (`:3000`): no toqué nada allí.
