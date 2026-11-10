# Auditoría de filtros del screener — 2026-11-06

Solo lectura. Rama `codex/statsedge-ui-polish` (árbol con cambios sin comitear de otros agentes; lo leído es el estado del disco a 2026-11-06). Base medida: copia local `statsedge_local` (:55432, transacción `read_only`). No se tocó el Mini ni Supabase.

**Aviso sobre la copia local.** El último materializado US es del **2026-10-18** (3.287 filas); el último ranking RS semanal, del **2026-09-27**; `daily_bars` llega a 2026-11-06 pero solo para 54 símbolos desde el 19-oct. Todas las cifras de frescura son de la copia, no del Mini de hoy.

Leyenda: **V** = verificado con consulta o lectura de código (cifra incluida) · **S** = supuesto o inferencia no medida.

---

## 1. Resumen ejecutivo

1. Hoy el preset Balanceado lo deciden casi solo dos filtros: **etapa 2 semanal** (1.002 de 3.287) y la **liquidez**. Quedan 883 filas. Riesgo ≥15, cobertura 35/45 y frescura ≤5 d dejan pasar al 100 % (V).
2. **«Fuerza sector»/«Fuerza grupo» no funciona.** La opción «Fuertes» (≥70) devuelve 0 filas y «Débiles» devuelve el 98,8 %. Es una puntuación absoluta con suelo de 40 que el 39 % de las filas tiene exactamente (V).
3. **La clasificación por tema es poco fiable.** Hay mineras de oro en «Inmobiliario / REIT» y fertilizantes en «Software / IA». El tema alimenta la fuerza de grupo y el RS tema (V).
4. **La huella VCP siempre muestra «13W».** `baseWeeks` tiene un único valor (13) en las 3.287 filas. Es el mismo defecto que ya retiró el filtro por semanas de base (V).
5. **La frescura no es fiable.** `priceFreshnessDays` se congela al escanear y el filtro lo prefiere a recalcularlo. `lastDate` va una sesión por detrás del precio (3.225/3.229 filas). En los nocturnos del 14 al 16-oct, el 98 % de las filas tenía `lastDate` = domingo 11-oct (V).
6. **El RS sin dato tiene tres políticas distintas.** RS semanal: la fila pasa sin aviso (89 filas, 2,7 %). RS país y RS tema: se rechazan en el post-filtro pero se omiten en el filtro duro. Las reglas genéricas: se rechazan (V).
7. **«RS Benchmark» no mide contra el benchmark** en el 98,8 % de las filas (`rsBenchmarkAvailable` vacío en 3.249). El RS de lote discrepa ≥20 puntos del RS semanal en el 21 % de las filas (V).
8. **Hay duplicados y señales con el mismo nombre.**
   - Fuerza sector existe dos veces: como capa de vista y como campo de la familia RS.
   - Estructura y VCP repiten los campos de contracciones, pivote y volumen seco con claves distintas.
   - RS país es idéntico al RS global en un universo solo US.
   - «E2» semanal no coincide con «etapa 2» (375 filas en etapa 1 figuran como `E2_ma_only`) (V).
9. **El filtro «Régimen» está encendido por defecto y apenas se ve.** Según la salud de mercado, recorta de 883 a 609, 272 o 42 filas (V las cifras; S el `marketScore` vivo, que no se midió).
10. **Prioridad recomendada:**
    - Arreglar antes de añadir nada: frescura, fuerza de grupo, tema y una política única de dato faltante.
    - Después, y quitando filtros a cambio: pendiente de RS, proximidad a pivote, volumen seco/expansión y aceleración de ventas.

---

## 2. Inventario de filtros

### 2.1 Familias (`lib/screenerFilterCatalog.js`; neutralización en `lib/screenerFilterLayers.js`; aplicación en `lib/screenerFilters.js` → `screenerFilterRejectReason`, y post-filtro en `lib/screenerPipeline.js:628`)

Contrato de capas v4: el **núcleo** está encendido en frío (liquidez, tendencia, scores, cobertura) y el resto son **opcionales** (`CORE_LAYER_KEYS`). Hay 14 familias, 67 campos numéricos, 8 interruptores booleanos, `setupMode` (8 modos), `filterStrictness`, «Régimen» y 6 selectores de vista. Los presets están en `SCREENER_FILTER_PRESETS` (balanced, strict, early, broad, intl, ipo, ipoDiscovery, nearPivot, weakness).

| Familia (capa) | Campos y umbral en Balanceado | Métrica | Nota |
|---|---|---|---|
| Liquidez (núcleo) | precio ≥2 · cap ≥150 M · acciones/día 20d ≥100 k · importe 20d ≥1 M · liquidityScore ≥0 | price, marketCap, avgVolume, avgTurnover | El importe no se convierte a USD fuera de US (dice el hint) |
| Tendencia (núcleo) | requireStage2 = on · requirePulso = off · estructura tend. ≥40 · estructura rupt. ≥30 · semanas sobre MA30s ≥0 | weeklyStageState, weinsteinScore, minerviniScore, weeksAboveSma30w | `requireSma200Up` y `requirePriceAboveSma50` existen pero no tienen control en la UI |
| Momentum | perf 3/6/12M ≥0/5/8 · momentumScore ≥15 | perf* | Opcional (se neutraliza si la capa está apagada) |
| RS | RS ≥50 (semanal) · RS Benchmark · RS país · RS tema · RS quality · Fuerza grupo | weeklyRsRating, rsRating, weeklyCountryRs, weeklyThemeRs, rsQualityScore, sectorScore | `minRsSectorPct` vive en `FIELD_RULES` sin familia ni UI |
| Cercanía | caída vs 20d/50d/52s/ATH ≤25/35/45/75 · highs spread ≤30 · ext. SMA50 ≤50 | distance*, highsSpreadPct, extSma50 | |
| Volatilidad | movimiento diario 20d ≤25 · rango 20d ≤32 · rango 63d ≤120 · vol. 63d ≤120 · DD 3M ≤40 | | |
| Scores (núcleo) | risk ≥15 · volume ≥0 · composite ≥0 · A/D proxy · EPS proxy · deterioro ≥50 (solo en modo weakness) | | |
| Cobertura (núcleo) | precio fresco ≤5 d · cobertura total ≥35 · técnica ≥45 · fundamental ≥0 | priceFreshnessDays, *CoverageScore | |
| Estructura | contracciones, C1–C3, última, base, pivote, volumen seco, rango 10d, calidad | contraction*, baseDepthPct… | Neutra en Balanceado |
| VCP | candidato del motor, etapa 2, ≥N contracciones, última ≤X, pivote [min, max], volumen seco, estructura semanal | vcpCandidate, distanceToPivotPct… | Repite campos de Estructura con otras claves |
| Volumen+ | volumen y importe de sesión, RVOL ≥1, volumen 5d ≥15 %, up/down ≥0,8, Volume Effect, vela alcista | | Neutro si la capa está apagada |
| Rent./Riesgo | score ≥35 · ret/vol ≥0,2 · ret/DD ≥0,5 | | |
| Short % | min/max % de la flota | shortPercentOfFloat | |
| IPO | requireRecentIpo · edad ≤60 m | ipoAgeMonths | |
| Régimen | on por defecto | marketHealth.marketScore (cliente) | `lib/scoring.js:150`. Exige composite/risk/estructura según la salud del mercado |

Orden de aplicación (`screenerPipeline.js:275-313`): quality gate → sectorize → filtro duro (`screenerFilterRejectReason`, o atajo `screenPassed`) → **régimen** → **post-filtro** (RS país, RS tema, RS quality, fuerza grupo, composite) → orden. El filtro duro corta en el **primer** rechazo, así que el motivo que se muestra depende de ese orden.

### 2.2 Capas de vista (cliente, `useResultViewModel.js` → `lib/screenerResultView.js:57`)

Resolución (tu clasificación: solo `localStorage`, `app/page.jsx:370`) → País → Tema → Sector → Subsector → Fuerza sector (Fuertes ≥70 / Constructivos 55–70 / Débiles <55 / Muy débiles <40). Al elegir un tema se reinician sector y subsector. Las opciones de sector se limitan al tema elegido. Las opciones que dejan de existir se reinician solas (`useEffect`, línea 513).

### 2.3 Cinta Caza (`lib/screenerHuntTape.jsx`)

Muestra RS canónico semanal, etapa y semanas (`weeklyStageWeek`), distancia al máximo de 52 semanas y la huella VCP `XW Y/Z NT` (usa `baseWeeks`). El contador «N en cola» (`ResultPagerTable.jsx:95`) es igual a `filtered.length` (tras las capas de vista).

---

## 3. Fiabilidad de los datos (materializado US 2026-10-18, n = 3.287)

### 3.1 Cobertura y degeneración

| Campo | % numérico | Valores distintos | Observación | V/S |
|---|---|---|---|---|
| RS lote (`rsGlobalPct`), `rsCountryPct` | 100 | 99 | **Iguales en las 3.287 filas** (mono-US) | V |
| RS semanal canónico (private-global, 27-sep) | 97,3 (3.198) | — | 89 filas sin ranking → pasan el filtro RS sin aviso | V |
| `rsRating` («RS Benchmark») | 100 | 85 | `rsBenchmarkAvailable` = true solo en 38; `benchmarkPerf3m` nulo en 3.249 | V |
| `sectorScore` | 100 | **10** | Máx. 57,0; p90 51,6; **1.269 filas = 40,00** (suelo) | V |
| `groupStrengthScore` | 1,2 | — | Solo en una generación distinta de 38 filas | V |
| `baseWeeks` | 100 | **1 (13)** | Constante | V |
| `weeklyStageWeek` | 98,4 | 45 | | V |
| `lastContractionDepthPct` | 86,2 | — | 452 filas sin contracciones | V |
| `shortPercentOfFloat` | 97,7 | — | 29 ceros | V |
| `dataCoverageScore` / `technicalCoverageScore` | 100 | 22 / 8 | **mín. 77 / 79** → umbrales 35/45 inertes | V |
| `riskScore` | 100 | 25 | **mín. 18** → umbral 15 inerte | V |
| `priceFreshnessDays` | 100 | 4 (2–5) | Congelado al escanear | V |
| `marketCap` | 98,1 | — | mín. 300 M (suelo del cron); 64 nulos | V |
| `weeklyStageStructure` | 100 | 3 | n/a 2.542 · E2_ma_only 578 · E2_structural 167 | V |
| Fundamentales trimestrales (perfil más reciente) | 95 (5 trimestres) | — | Ingresos/beneficio sí; **EPS por acción 0 %**; YoY último trimestre 89,5 %; mediana de antigüedad 25,7 d | V |
| Fecha de resultados (earnings date) | 0 | — | No existe el campo (`quoteSnapshot` solo tiene `price`) | V |

### 3.2 Frescura

- `lastDate` por nocturno: 14, 15 y 16-oct → **3.240 filas con `lastDate` = 2026-10-11 (domingo)** y `priceFreshnessDays` = 4. En `daily_bars` solo hay **1** barra con esa fecha (V).
- Nocturno del 18-oct: 3.229 filas con `lastDate` 15-oct, pero el precio coincide con el **cierre del 16-oct** en 3.225 de ellas. Causa en el código (V): `price` sale de `chart.meta.regularMarketPrice` y se injerta como cierre de `bars[0]`, que es de la sesión anterior (`materializedScanner.js:393-409`). `lastDate` se toma de `bars[0]` (línea 501). Las métricas de ese día (rango, volumen, `upVolume`, RVOL) mezclan dos sesiones.
- El filtro de frescura (`screenerFilters.js:107`) **prefiere el `priceFreshnessDays` guardado** y solo recalcula si falta. Un materializado viejo, restaurado, sigue pareciendo «fresco» indefinidamente (V en código; S el efecto en el Mini, que no se midió).
- El RS semanal (27-sep) iba 3 semanas por detrás del materializado (18-oct) en la copia. El RS mostrado no indica su semana en la tabla (V en la copia; S en el Mini).

### 3.3 Coherencia entre filtros que dicen medir lo mismo

- **RS lote frente a RS semanal:** correlación 0,774; diferencia media absoluta 13,2; **691 filas (21 %) difieren ≥20**. Con RS ≥80 hay 757 por el semanal y 648 por el lote, y solo 477 en ambos. El composite y el gate `nearPivot` usan el de lote; el filtro y el orden «RS», el semanal (V).
- **Etapa 2:** `weeklyStageState` = stage2 da 1.002 filas. `weeklyStageStructure` E2 da 745, de las cuales 375 están en **stage1** y 649 filas stage2 tienen n/a. La plantilla de tendencia aproximada (precio > SMA50 > SMA150 > SMA200, SMA200 al alza, ≤25 % del máximo) se cumple en solo 414 de las 1.002 stage2 (V; plantilla aproximada sin `lowAdvance52w`, que no está en metrics).
- **Tema frente a sector:** «Basic Materials» aparece en 13 temas; «Inmobiliario / REIT» mezcla 6 sectores. Causa (V, `lib/businessTheme.js`): si sector+industria no casan con `SECTOR_INDUSTRY_RULES` (no hay regla para Metals & Mining, Gold, Chemicals, Steel…), se busca en el `summary` con palabras como `properties` (las mineras hablan de «mineral properties») o `data`/`platform`. Hay 43 filas con temas no curados («Basic Materials», «Technology», «Sin sector») que no tienen RS tema.
- **Fuerza de grupo:** `sectorScoreForGroup` (`screenerComposite.js:94`) suma tamaño (satura en 25 con ≥3 filas) + líderes (satura en 15) + rendimientos medios recortados a ≥0. Cualquier grupo grande parte de **40** y llegar a 70 exige rendimientos medios de un grupo de cientos de valores por encima del 20–30 %. No es relativo ni percentil.
- **Dos generaciones de filas en un mismo scan:** 38 filas sin `chartPreview`, con benchmark y con `priceFreshnessLabel` = «útil», frente a 3.249 de la otra forma (V).

### 3.4 Embudo real del preset Balanceado (núcleo v4, sin régimen)

| Paso | Filas que pasan |
|---|---|
| Total | 3.287 |
| Precio ≥2 | 3.240 |
| Cap ≥150 M | 3.223 (las 64 que fallan son **cap nula**: el cron ya exige ≥300 M) |
| Acciones/día ≥100 k | 3.072 |
| Importe ≥1 M | 3.184 |
| Liquidez completa | 2.957 |
| Etapa 2 semanal | 1.002 |
| + Weinstein ≥40 y Minervini ≥30 | 999 (recortan 3) |
| Risk ≥15 / cobertura / frescura | 3.287 / 3.287 / 3.287 (inertes) |
| **Núcleo Balanceado** | **883** |
| + Régimen (`marketScore` 55–75 / 40–55 / <40) | 609 / 272 / 42 |

Familias opcionales (V): candidato VCP 170 (todos en etapa 2) · contracciones decrecientes 512 · ≥2 contracciones 1.404 · aproximación de la acción «VCP Minervini» 167 · `contractionStructureStatus` = ok 873 (1.643 en `lower_low_drift`).

### 3.5 Universo y mercados (V)

- Último materializado por mercado:
  - US: 3.287 filas
  - HK: 74
  - CA: 76
  - GB: 19
  - DE: 8
  - CH: 23
  - ES, FR, IT, SE y JP: 24 cada uno
  - **AT, AU, BE, FI, IE, PT y TW: 0**
- En Europa, cualquier filtro opera sobre una muestra curada de ≤24 filas.
- `scan_symbol_history`: no tiene filas US salvo 12 de XNYS. Para US no hay historia por símbolo con la que construir deltas.
- **RGNT** no es un `mic_code`: es el ticker de Regentis Biomaterials (NasdaqTrader). Está en 5 scans y no tiene filas en `scan_symbol_history`. No pude reproducir una incidencia con «mic_code RGNT».
- Barras mensuales en `daily_bars`: quedan **16 filas en 8 símbolos** (todos no US) con huecos ≥25 días. En los símbolos del scan US, ningún hueco >7 días desde oct-2025.

---

## 4. Coherencia de la interfaz de filtros

| # | Hallazgo | Evidencia | V/S |
|---|---|---|---|
| U1 | La misma métrica se controla desde dos sitios: «Fuerza sector» (capa de vista) y «Fuerza grupo min» (familia RS), las dos sobre `sectorScore` | `screenerResultView.js:46`, `FILTER_FAMILIES.relativeStrength` | V |
| U2 | «Débiles» (<55) incluye a «Muy débiles» (<40): los cubos se solapan | `passesSectorStrength` | V |
| U3 | Opciones con 0 resultados aparecen sin contador (`optionLabel` omite el 0) y vacían la vista: «Fuertes» | `useResultViewModel.js:64` | V |
| U4 | El «impacto» de cada chip es el conteo total de esa categoría en `rows`, no lo que recorta encima de los demás filtros | `resultFilterChips` | V |
| U5 | «N en cola» usa la misma palabra que la cola de Review, que es otra cosa; la línea de verdad dice «X de Y pasan» y «Z en lista» | `ResultPagerTable.jsx:95`, `screenerTruthLine.js` | V |
| U6 | La familia Estructura (`minContractionCount`, `maxLastContractionDepthPct`, `maxVolumeDryUpRatio`, `maxAbsDistanceToPivotPct`) y la familia VCP (`vcpMinContractionCount`, …) repiten conceptos con claves distintas; las dos pueden estar activas a la vez con umbrales contradictorios | catálogo | V |
| U7 | La familia RS ofrece 6 umbrales; con universo mono-US, RS país = RS global, y RS Benchmark no tiene benchmark en el 98,8 % | §3.1 | V |
| U8 | Etiqueta del umbral RS = `metricShortLabel("rsGlobalPct")`, pero filtra el RS semanal; `rsGlobalPct` (lote) sigue vivo en composite/gates | `screenerFilters.js:769` | V |
| U9 | «Régimen» recorta más que el propio preset y no aparece como chip en la barra de resultados | `scoring.js:150` | V |
| U10 | «Exacto / Balanceado / Descubrimiento» (`filterStrictness`) solo cambia si se aplica el suelo de sesgo largo diario; el nombre promete mucho más | `screenerFilters.js:908` | V |
| U11 | Taxonomía mixta: temas en español y sectores/subsectores del proveedor en inglés; «Basic Materials» y «Technology» aparecen como temas | §3.3 | V |
| U12 | Resolución depende solo de `localStorage`: otro navegador u otro dispositivo verán otra cola | `app/page.jsx:370` | V |
| U13 | Persistencia: el estado de vista (tema, sector, país, fuerza, resolución, orden, página) se restaura desde la sesión; las capas v3+ se respetan; los avisos de frescura no se persisten (correcto) | `restoreResultViewSession`, `snapshotNoticeForPersistence` | V |
| U14 | Tema/Sector «se excluyen en silencio»: elegir tema reinicia sector y subsector, y si una opción desaparece del lote el `useEffect` la devuelve a «Todos» sin aviso | `ResultFilterBar.jsx`, `useResultViewModel.js:513` | V |

---

## 5. Tabla de hallazgos

| ID | Severidad | Hallazgo | Cifra | V/S |
|---|---|---|---|---|
| H1 | **Crítica** | Fuerza sector/grupo inservible (escala absoluta con suelo de 40, inalcanzable) | Fuertes 0 · Débiles 3.248 (98,8 %) · 10 valores | V |
| H2 | **Crítica** | Clasificación temática errónea que contamina la fuerza de grupo y el RS tema | Basic Materials repartido en 13 temas; mineras en REIT | V |
| H3 | **Alta** | `lastDate` desfasado o en domingo; precio de una sesión pegado a la barra de otra | 3.225/3.229 (18-oct); 3.240 con fecha 11-oct (14–16 oct) | V |
| H4 | **Alta** | Frescura congelada en el scan: el filtro no detecta datos viejos al restaurar | `priceFreshnessDays` 2–5, no se recalcula | V (código) |
| H5 | **Alta** | Huella VCP con semanas de base constantes | `baseWeeks` = 13 en el 100 % | V |
| H6 | **Alta** | Política de dato faltante incoherente en RS | 89 pasan sin RS; país/tema se rechazan en el post-filtro | V |
| H7 | **Alta** | «RS Benchmark» sin benchmark | 3.249/3.287 | V |
| H8 | Media | RS de lote y RS semanal discrepan, y ambos alimentan decisiones distintas | 21 % con Δ ≥20; correlación 0,77 | V |
| H9 | Media | Dos «etapa 2» incompatibles (estado frente a estructura E2) | 375 stage1 marcadas E2 | V |
| H10 | Media | Régimen activo por defecto, poco visible y con un recorte fuerte | 883 → 609/272/42 | V (S el valor vivo) |
| H11 | Media | Filtros del núcleo inertes (risk, cobertura, frescura, cap 150 M) que suben la carga visual sin aportar | 100 % pasan | V |
| H12 | Media | RS semanal desfasado respecto al materializado y sin semana visible | 27-sep frente a 18-oct (copia) | V copia / S Mini |
| H13 | Media | Duplicados Estructura/VCP y 6 variantes de RS | catálogo | V |
| H14 | Baja | Cubos de fuerza solapados y opciones a 0 seleccionables | — | V |
| H15 | Baja | Europa e intl: muestras de 0–24 filas en las que los filtros no informan | §3.5 | V |
| H16 | Baja | Liquidez intl en moneda local (sin FX) | hint del campo | V código |
| H17 | Baja | `minRsSectorPct` vive en las reglas sin UI (percentil de lote) | `FIELD_RULES` | V |

---

## 6. Propuestas priorizadas

Criterio: primero que lo que ya existe diga la verdad, y después nuevo valor **retirando** controles a cambio (el presupuesto de información baja).

| Prio | Propuesta | Impacto | Esfuerzo | Riesgo | Datos/origen |
|---|---|---|---|---|---|
| **1** | **Frescura honesta.** Recalcular la antigüedad desde la fecha real del precio al pintar, no desde el valor guardado. Fijar `lastDate` = fecha de la sesión del precio usado (o no injertar `regularMarketPrice` si es de otra sesión). Una sola marca fantasma por fila cuando el dato tenga >1 sesión de retraso | Alto: evita decidir sobre precios de otra sesión | Bajo–medio (`materializedScanner.js` ~395-505, `screenerFilters.js:107`) | Bajo; requiere renocturno | Ya disponible |
| **2** | **Política única de dato faltante.** Todo filtro activo trata «sin dato» igual: la fila pasa con marca «sin RS/sin dato» visible en el title de la celda (o se excluye, pero siempre igual). Alinear el post-filtro (`screenerPipeline.js:630-641`) con el filtro duro | Alto: fin de las exclusiones silenciosas | Bajo | Bajo | — |
| **3** | **Rehacer «Fuerza de grupo» como percentil relativo** (mediana del RS semanal de los miembros de la industria del proveedor, 152 grupos US, puesta en rango 1–99). Quitar la capa de vista «Fuerza sector» **y** el campo `minSectorScore`, y dejar un único control «Grupo top X %» | Alto: es el filtro de grupo que usa un trader Minervini/O'Neil | Medio | Medio (cambia composite si lo consume) | `rs_weekly_items` + `industry` (0 nulos) |
| **4** | **Arreglar el clasificador de temas**: añadir reglas de sector/industria para Metals & Mining, Gold, Steel, Chemicals, Agricultural Inputs, Building Materials y Lumber (tema «Materiales/minería») y no buscar en el `summary` palabras ambiguas (`properties`, `data`, `platform`). Mientras tanto, agrupar por industria y no por tema | Alto (H2 contamina H1 y el RS tema) | Bajo–medio | Medio: cambia los engines de RS tema (requiere recálculo) | `lib/businessTheme.js` |
| **5** | **Quitar «13W» de la huella VCP** hasta que exista el detector real de base: mostrar `Y/Z NT` sin semanas | Medio | Muy bajo | Nulo | — |
| **6** | **Adelgazar la familia RS**: quedarse con RS (semanal) + *RS en tendencia* (nuevo, P7) + grupo (P3). Ocultar RS país cuando la selección es solo US, retirar RS Benchmark de la UI hasta hidratar el benchmark y retirar `minRsSectorPct`. Mostrar en el title de la columna RS la semana del ranking y avisar si va >8 días por detrás del scan | Medio–alto | Bajo | Bajo | — |
| **7** | **Nuevo: RS en tendencia** (Δ del RS semanal a 4 semanas y «RS en máximo de N semanas»). Detecta líderes antes que el precio | Alto para swing | Medio | Bajo | Motor `us-equity` con 33 snapshots; `private-global` (canónico) solo 6 en la copia → completar el backfill con `--snapshot-date` (commit b3b12c3) |
| **8** | **Fusionar Estructura + VCP en una familia «Base»** con 3 controles: contracciones ≥N (usando `contractionStructureStatus` = ok como compuerta), última contracción ≤X % y **distancia al pivote** en [−X %, +Y %]. Retirar C1/C2/C3, rango 10d y calidad (opaca) | Alto (proximidad a pivote es la pregunta diaria) | Medio | Medio (sesiones/plantillas guardadas) | `distanceToPivotPct` 100 %, `vcpCandidate` 170, status ok 873 |
| **9** | **Volumen seco / expansión** como dos chips de setup, no como familia: «Base seca» (`volumeDryUpRatio` ≤0,8 y rango 10d ≤8 %) y «Ruptura con volumen» (RVOL ≥1,5 + vela alcista + ≤3 % sobre el pivote). **Requiere P1** (hoy el volumen de la última barra puede ser de otra sesión) | Alto | Bajo tras P1 | Bajo | Campos ya presentes |
| **10** | **Hacer visible el Régimen**: chip «Régimen: exige composite ≥60…» en la barra cuando recorta, o apagarlo por defecto y dejar el aviso de mercado en la cabecera | Medio | Bajo | Bajo | — |
| **11** | **Retirar del núcleo los filtros inertes**: risk ≥15, cobertura 35/45 y cap 150 M (por debajo del suelo del cron, 300 M; además rechaza las 64 cap nula como «sin dato»). Declarar el suelo del universo en un solo sitio («Universo: cap ≥300 M…») | Medio (menos ruido) | Muy bajo | Bajo | — |
| **12** | **Unificar «etapa 2»**: que `weeklyStageStructure` no pueda decir E2 si `weeklyStageState` ≠ stage2, y que «Pulso» (plantilla de tendencia) sea la única versión diaria. Mostrar solo una etiqueta | Medio | Medio | Medio | — |
| **13** | **Aceleración de ventas** (YoY trimestral creciente 2 trimestres y margen al alza) como filtro fundamental único, en lugar del «EPS/growth proxy» opaco | Medio–alto | Medio | **Licencia:** viene de Yahoo (no viable para SaaS de pago); válido para uso personal | `incomeQuarterly` 95 % con 5 trimestres; EPS por acción 0 % (no hay filtro EPS posible) |
| **14** | **Liquidez real en USD**: ADV$ 50d con FX y opción «posición X $ ≤ Y % del ADV» | Medio fuera de US | Medio | Bajo | Hay FX en el motor de RS |
| **15** | Arreglos de UI menores: cubos de fuerza sin solape (si P3 no los elimina), opciones a 0 deshabilitadas, impacto incremental en los chips, «en cola» → «en lista» | Bajo–medio | Bajo | Bajo | — |
| **16** | Earnings (días hasta resultados) | Alto para swing | **Alto**: no hay dato | — | Requiere proveedor nuevo; no hay campo hoy |

### Eliminar o fusionar (resumen)

- **Eliminar de la UI:**
  - capa de vista «Fuerza sector» y campo «Fuerza grupo» (sustituidos por P3)
  - RS Benchmark, RS país (solo US) y `minRsSectorPct`
  - risk score, cobertura total/técnica/fundamental (pasar a marca por fila), liquidity score y volume score
  - C1/C2/C3, «Calidad estructura», «A/D proxy» y «EPS/growth proxy» (sustituido por P13)
  - caída vs 20d, 50d y ATH, y highs spread (quedarse con 52 semanas y pivote)
  - 3 de los 5 de volatilidad (quedarse con drawdown 3M y movimiento diario máximo, o ATR %)
- **Fusionar:**
  - Estructura + VCP → «Base»
  - Volumen+ → dos chips de setup
  - Momentum → retirar los umbrales 3/6/12M si P7 entra (el RS ya los resume)
- **Mantener:** Liquidez (simplificada), Etapa 2, RS, Base, Short %, IPO, Resolución, País, Industria (o un tema corregido).

---

## 7. Consultas usadas (todas SELECT, `default_transaction_read_only=on`)

```sql
-- Q1 cobertura numérica por campo (materializado US 18-oct)
with r as (select r.metrics m from scan_results r join scans s on s.id=r.scan_id
           where s.local_id='materialized:US:2026-10-18:t030032:o0:l5613')
select k, count(*) filter (where jsonb_typeof(m->k)='number') num, ...
from r, unnest(array['rsRating','rsGlobalPct',...]) k group by k;

-- Q2 distribución (n distintos, p10/p50/p90, ceros) de 44 métricas: misma CTE + percentile_cont.

-- Q3 igualdad RS y cubos de fuerza
select count(*) filter (where m->'rsGlobalPct'=m->'rsCountryPct'),
       count(*) filter (where (m->>'sectorScore')::numeric>=70), ... from r;

-- Q4 lastDate por scan y coincidencia de precio con daily_bars del 15 y 16-oct
select r.ld, count(*) filter (where abs(r.p-d16.close)/d16.close<0.001) ...
from r left join daily_bars d16 on d16.symbol=r.symbol and d16.trade_date='2026-10-16' group by 1;

-- Q5 tema × sector y valores de sectorScore
select theme, count(*), count(distinct sector), string_agg(distinct sector,' | ') from r group by theme;
select round((m->>'sectorScore')::numeric,2), count(*), string_agg(distinct theme,', ') from r group by 1;

-- Q6 snapshots RS por engine_version; RS semanal (private-global, último) frente a RS de lote
select engine_version, count(*), min(snapshot_date), max(snapshot_date) from rs_weekly_snapshots group by 1;
... corr(wr,(m->>'rsGlobalPct')::numeric), count(*) filter (where abs(wr-...)>=20) ...

-- Q7 huecos en daily_bars (lag de trade_date por símbolo; gap>=25)
-- Q8 embudo de Balanceado y régimen (umbrales de §3.4 sobre metrics)
-- Q9 VCP/etapa/estructura: vcpCandidate, contractionsDecreasing, weeklyStageState × weeklyStageStructure
-- Q10 cobertura de fundamental_snapshots (perfil más reciente por símbolo, incomeQuarterly)
-- Q11 último materializado por mercado; scan_symbol_history por mic_code; búsqueda de 'RGNT'
```

Los scripts completos están en el scratchpad de la sesión (`cov.sql`, `dist.sql`, `rs.sql`, `bars.sql`, `funnel.sql`); no forman parte del repo.

---

## 8. Qué no se midió

- El `marketScore` vivo (se calcula en el cliente), así que no se sabe qué tramo del régimen aplica hoy.
- El estado del Mini a 2026-11-06 (por instrucción): frescura y RS actuales pueden ser mejores que en la copia.
- El efecto en el navegador (no se abrió la UI ni el :3320): contadores, chips y persistencia se auditaron por código.
- La muestra de 576 en recarga en frío (P2 de memoria): no se reprodujo; `rowsLimit` por defecto es 5.000 y el muestreo sistemático solo actúa si hay más filas (`app/api/scans/route.js:318`).
- La plantilla de tendencia exacta («Pulso»): solo se aproximó, porque falta `lowAdvance52w` en metrics.
- Precisión del detector VCP frente al corpus etiquetado (ver `research/contracciones/`): no se recalculó.

---

## 9. Implementación de las propuestas 1 y 2 (2026-11-06, sin commit)

### 9.1 Frescura veraz (P1)

- **Regla:** toda lectura de frescura sale de `lib/dataAge.js → livePriceFreshness(row, { maxDays, now })`: días desde `lastDate` (plano o en `metrics`/`snapshot`/`raw`) hasta hoy, con las etiquetas de `priceFreshnessForDate` (que acepta ahora un `now` opcional). El `priceFreshnessDays` guardado solo se usa si la fila no trae fecha (0 de 3.287 en el nocturno US del 18-oct).
- **Dónde se aplica:** filtro de frescura (`screenerFilters.js`), re-comprobación del atajo `screenPassed` (`screenerPipeline.js`), salud de datos (`screenerDataHealth.js`), fiabilidad de listas (`listRationale.js`) y evidencia de método (`screenerMethodologyEvidence.js`). El rechazo distingue «precio de hace Nd > 5d» de «fecha del precio sin dato».
- **Marca de fila (única):** `rowDataAgeMark` con el umbral del aviso de lista (≥2 sesiones hábiles sin precio). En la cinta Caza, la miniatura se atenúa (opacidad 0,45 en línea, sin CSS nuevo) y su `title` dice «Precio del 15 oct: N sesiones sin actualizar». Toque en `HuntTapeView.jsx`: un import y la línea del `div` de la miniatura (`huntTapeSparkWrapProps`).
- **Desfase de un día en la fecha del precio (H3): origen localizado en `lib/`, ya corregido en `a34389a` (23-oct).** No es el injerto de `regularMarketPrice`. En modo pg, node-postgres devolvía las columnas `date` de `daily_bars` como `Date` a medianoche LOCAL y `toDate()` las pasaba por `toISOString()`. En Europe/Madrid eso corre al día anterior **toda la serie leída de caché**: el viernes pasa a jueves y el lunes a domingo. Evidencia (V) en la copia local, en los nocturnos del 12, 14, 15, 16 y 18-oct:
  - Del 97 % al 98 % de las filas tienen barras en domingo en `chartPreview`, y ninguna en viernes. En los nocturnos del 13 y el 17-oct (barras descargadas en vivo) es al revés: 3 y 12 filas con domingo.
  - MSFT en el nocturno del 18-oct: el «15-oct» vale 529,05, que es el cierre del 16-oct en `daily_bars`.
  - El «domingo 11-oct» de los nocturnos del 14 al 16 es el lunes 12-oct.

  Se añadió una prueba de regresión de `toDate(Date)`. **No hace falta `arreglo-fecha-precio.md`**: el origen no está en los scripts de escaneo. Queda un riesgo latente que no se ha observado: si Yahoo devuelve `regularMarketPrice` de una sesión más nueva que `bars[0]`, el injerto de `materializedScanner.js` la etiquetaría con la fecha anterior.

### 9.2 Política única de dato que falta (P2)

**Decisión:** una fila sin el dato que exige un filtro **activo** no pasa ese filtro. Su rechazo lleva `missingData: true` («X sin dato») y se cuenta aparte en `diagnostics.missingDataRejected` / `missingDataByField`. Con el filtro apagado, la ausencia no cuenta. Módulo: `lib/missingDataPolicy.js`. Prueba que fija la decisión: `tests/missingDataPolicy.test.js`.

- Se aplica igual al RS semanal (antes se omitía en silencio), al RS país y al RS tema (antes se omitían en el filtro duro y se rechazaban en el post-filtro), al RS quality, a la fuerza de grupo, al score compuesto y a las reglas genéricas y de distancia.
- **Escáner (stage `"scan"`):** `applyScreenerFilters` (nocturno, leaderboards) aplaza el RS semanal, porque aún no está hidratado. El cliente lo aplica al leer con `screenerReadTimeRejectReason`, también sobre las filas del atajo `screenPassed`. Así, reglas y atajo dan el mismo veredicto y el mismo recuento.
- El post-filtro ya no duplica RS país/tema.
- Fuera de alcance: el modo weakness con `weaknessScore` nulo sigue omitiendo el criterio, con una traza «omitido: sin dato».

### 9.3 Medición antes/después (copia local, nocturno US 18-oct, 3.287 filas, solo lectura)

| Escenario | Antes | Después |
|---|---|---|
| Frescura ≤5 d (hoy, 6-nov) | 3.287 pasan (días guardados 2–5) | **0 pasan** (21–24 d reales). Cambian las 3.287 |
| Balanceado núcleo (hoy) | 899 | **0** («Precios del 15 oct»; 3.287 rechazos de cobertura) |
| Frescura ≤5 d (reloj simulado: lunes 19-oct, 08:00 UTC) | 3.287 | 3.285 (cambian 2; 3 filas con marca) |
| Balanceado núcleo (19-oct) | 899 | 899 (0 cambian: las 2 viejas ya caían por tendencia) |
| Balanceado + familia RS (19-oct) | 866 | **854**: 12 filas sin RS semanal que pasaban en silencio ahora salen como «sin dato» (ANDG, CBC, CYPH, MICC, NAVN, NP, NTSK, PURR, REPL, TJGC, TTRX, WLTH) |

Mismo resultado por reglas y por el atajo. El RS semanal falta en 89 filas, el RS país en 83 y el RS tema en 2.420. Para RS país y tema el veredicto del pipeline no cambia (el post-filtro ya los rechazaba). Lo que cambia es que ahora se marcan «sin dato» y que los contadores que usan `screenerFilterRejectReason` (impacto por familia, chips de cohorte IPO) dejan de darlas por buenas.

---

## 9. Implementado: propuestas 1 y 2 (2026-11-06, sin commit)

### 9.1 Frescura veraz (P1, H3, H4)

- **Una sola fuente de antigüedad:** `lib/dataAge.js` → `livePriceFreshness(row)` calcula los días desde `lastDate` (plano o en `metrics`/`snapshot`/`raw`) hasta **hoy**, con las mismas etiquetas que el escáner (`dataCoverageShared.priceFreshnessForDate`, que ahora acepta `now` opcional). El `priceFreshnessDays` guardado solo se usa si la fila no trae fecha (0 de 3.287 en el nocturno del 18-oct).
- **La leen:** el filtro (`screenerFilters.js`, también la explicación por fila), la salud de datos (`screenerDataHealth.js`), la fiabilidad de listas (`listRationale.js`) y la evidencia de método (`screenerMethodologyEvidence.js`).
- **Atajo `screenPassed`:** el pipeline vuelve a comprobar la frescura real (y el RS semanal) sobre las filas que el nocturno dio por buenas (`screenerReadTimeRejectReason`).
- **Marca por fila (única):** la miniatura de la cinta Caza se atenúa (opacidad 0,45) y su `title` dice «Precio del 15 oct: N sesiones sin actualizar» cuando la fila lleva ≥2 sesiones sin precio (mismo umbral que el aviso de lista). Sin columnas ni texto nuevos. Toca 2 líneas de `app/components/screener/HuntTapeView.jsx` (import + `<div {...huntTapeSparkWrapProps(row, sparkTitle)}>`).
- Umbrales sin cambios (≤5 días naturales en Balanceado).

**Desfase de un día en la fecha del precio — origen (V).** No está en los scripts de escaneo ni en el injerto de `regularMarketPrice`: en los nocturnos del 12, 14, 15, 16 y 18-oct **toda la serie** de `chartPreview` sale corrida −1 día (el 97 % de las filas tiene barras en domingo y ninguna en viernes; MSFT «2026-10-15» = cierre real del 16-oct en `daily_bars`). Los del 13 y 17-oct, con barras recién descargadas de Yahoo, están bien. Causa: en modo pg, node-postgres devolvía las columnas `date` como `Date` a medianoche local y `toDate()` las pasaba por `toISOString()` (Europe/Madrid → día anterior). Ya corregido en `a34389a` (23-oct: parser de `date` como texto en `lib/pgPostgrestAdapter.js` y `toDate` con componentes locales en `lib/supabaseServer.js`); se añade test de regresión (`tests/freshnessLive.test.js`). No hace falta `arreglo-fecha-precio.md`. Los materializados de la copia anteriores al 23-oct siguen con la fecha corrida hasta un renocturno. El injerto de `regularMarketPrice` sobre `bars[0]` (`materializedScanner.js:395-409`) sigue siendo un riesgo latente si Yahoo omitiera la vela del día, pero no es lo observado.

### 9.2 Política única de dato que falta (P2, H6)

**Decisión:** una fila **sin** el dato que exige un filtro **activo** no pasa ese filtro, y el rechazo va marcado `missingData: true` («… sin dato»). Se cuenta aparte en `diagnostics.missingDataRejected` y `diagnostics.missingDataByField`. Vale igual para RS semanal, RS país, RS tema, RS quality, fuerza de grupo, score compuesto, frescura sin fecha y reglas numéricas genéricas. Con el filtro apagado, la ausencia no cuenta. Módulo: `lib/missingDataPolicy.js`; contrato en `tests/missingDataPolicy.test.js`.

- **Escáner frente a lectura:** en el veredicto del escáner (`applyScreenerFilters`, stage `"scan"`: nocturno y leaderboards) el RS semanal/país/tema se **aplaza**, porque aún no está hidratado. Se aplica al leer, en el cliente, tanto por reglas como por el atajo `screenPassed`. Sin esto, el nocturno marcaría todas las filas como «RS sin dato».
- **Post-filtro:** ya no repite RS país/tema. RS quality, fuerza de grupo y composite usan el mismo módulo.
- Queda fuera, a propósito: `minWeaknessScore` en modo weakness sigue **omitido** con traza «deterioro omitido: sin dato» (contrato previo documentado).

### 9.3 Medido (copia local, nocturno US 2026-10-18, n = 3.287, solo lectura)

| Escenario | Antes | Después |
|---|---|---|
| Frescura ≤5 d, hoy (6-nov) | 3.287 pasan (días guardados 2–5) | 0 pasan (21–24 días reales) |
| Balanceado núcleo, hoy | 899 | **0** (todas rechazadas por frescura) |
| Simulado lunes 19-oct 08:00 UTC: frescura | 3.287 | 3.285 (2 cambian: 6 días) |
| Balanceado núcleo, 19-oct | 899 | 899 (las 2 ya caían por tendencia) |
| Balanceado + familia RS (RS semanal ≥50), 19-oct | 866 | 854 (−12 que pasaban sin RS en silencio, ahora «sin dato»: ANDG, CBC, CYPH, MICC, NAVN, NP, NTSK, PURR, REPL, TJGC, TTRX, WLTH) |
| Marcas de fila, 19-oct | — | 3 filas |

Mismo resultado por reglas y por el atajo `screenPassed`. Filas sin dato: RS semanal 89, RS país 83, RS tema 2.420. RS país/tema: el veredicto final del pipeline no cambia (el post-filtro ya las rechazaba), pero ahora las cuentan también los contadores de impacto que usan `screenerFilterRejectReason`.

### 9.4 Opción B (decisión del usuario, 2026-11-06)

- **Filtro en pausa:** si TODA la lista va atrasada (mediana de `lastDate` a ≥2 sesiones; mismo criterio que el aviso, `datasetPriceIsStale` en `lib/dataAge.js`), el filtro de frescura **no recorta**. Se ven las filas con la banda única «Precios del …» y la marca atenuada por fila. Con datos mixtos recorta solo las filas atrasadas. Se aplica igual en las dos rutas (reglas y atajo `screenPassed`); `diagnostics.freshnessSuspended` y `freshnessRejected` lo dejan registrado.
- **Estado vacío:** si la frescura dejó filas fuera, dice «Ningún valor de los N analizados pasa: todos tienen el precio de más de 5 días.» (o «M quedan fuera por precio de más de 5 días y el resto no cumple el filtro.») en lugar de «Afloja alguna condición».
- **Banda:** ya no promete «Los resultados siguen siendo válidos para esa fecha». Dice «Mientras no lleguen precios nuevos, el filtro de frescura no recorta: todo se calcula con los precios de esa fecha.»
- **Medido en la copia local, hoy (precios de 21–24 días):** Balanceado núcleo 899 filas, otra vez (antes de la opción B, 0). Con la familia RS, 854 (12 «sin dato» por RS semanal). En `:3320`, 937 de 3.287 con la banda; la vista abierta usa la plantilla y los filtros de la sesión, no Balanceado puro.
- **Recuperación del nocturno:** `scripts/ops/nightly-recover.sh` y `research/ops-recuperacion-nocturno.md`.

---

## 10. Implementado: propuestas 4 y 5 (2026-11-06, sin commit)

Base de medida: copia local `statsedge_local` (:55432), transacción `read_only`, nocturno US `materialized:US:2026-10-18:t030032:o0:l5613`. No se escribió en la base. Scripts de medida en el scratchpad de la sesión (`theme/measure.mjs`, `theme/themefilter.check.js`), fuera del repo.

### 10.1 Clasificador de temas (P4, H2)

**Qué cambia (`lib/businessTheme.js`).** Orden de decisión nuevo:

1. **Industria del proveedor** (`INDUSTRY_RULES`, en orden: REIT → Finanzas → Semis → Materiales → Defensa → transporte/autos → Medtech → Energía → Software → hardware → Internet → industriales).
2. **Sector del proveedor** (`SECTOR_DEFAULTS`) si la industria no casa.
3. Texto sector+industria con reglas amplias, solo para taxonomías que no son las de Yahoo.
4. **La descripción solo decide si no hay sector ni industria** (o son «Sin sector»/«Sin industria»). Las reglas de la descripción ya no contienen palabras ambiguas (`properties`, `residential`, `leasing`, `data`, `platform`, `applications`, `infrastructure`, `device`, `tablets`, `chemicals`, `steel`…), y gana la palabra que aparece **antes** en el texto, no la primera regla de la lista.

Reglas añadidas: tema nuevo **«Materiales / minería»** (Gold, Silver, Copper, Aluminum, Steel, Coking Coal, Other Industrial/Precious Metals & Mining, Chemicals, Specialty Chemicals, Agricultural Inputs, Building Materials, Lumber & Wood, Paper); seguros (`Insurance - Property & Casualty`) a Finanzas antes que cualquier regla con «property»; transporte (Airlines, Airports, Trucking, Railroads, Marine Shipping, Freight & Logistics) y Auto Parts / Auto & Truck Dealerships a «Autos / movilidad», cuyo texto ya decía «movilidad, carga o tecnología aplicada al transporte»; el resto de Industrials a «Automatizacion» (el tema industrial de la taxonomía); Communication Equipment a «Consumer tech / hardware», salvo si la descripción habla de fotónica/óptica/láser, que va a «Semis / fotonica» (único caso en que la descripción afina dentro de una industria). Se normalizan los guiones de Yahoo (`Banks—Regional` = `Banks - Regional`).

**Taxonomía.** Las 12 claves existentes no cambian de nombre. Se añade una, la 13.ª. Su slug de RS tema es `materiales-mineria` (`themeRsSlug` quita la tilde).

**Medido (V), 3.249 filas con tema guardado** (las otras 38 de ese scan son la generación sin `theme` en `metrics`):

- Línea base: el clasificador anterior, con el `businessSummary` del perfil más reciente, **reproduce el 100 %** del tema guardado (3.249/3.249).
- **Cambian de tema 565 filas (17,4 %).** No cambia ninguna fila de Healthcare, Real Estate, Energy, Utilities, Consumer Defensive ni Communication Services.
- Temas por sector, antes → después: Basic Materials **13 → 1**; Industrials **9 → 3**; Technology **10 → 5**; Financial Services 2 → 1. «Inmobiliario / REIT» pasa de mezclar 6 sectores a 2 (Real Estate + 19 de Residential Construction, como antes).
- Desaparecen los temas no curados «Basic Materials» (39) y «Technology» (3): ahora rankean en RS tema.

| Tema | Antes | Después |
|---|---|---|
| Finanzas | 592 | 631 |
| Medtech / biotech | 487 | 486 |
| Consumo / marca | 412 | 357 |
| Software / IA | 353 | 273 |
| Automatizacion | 231 | 344 |
| Inmobiliario / REIT | 341 | 189 |
| Energia / red | 287 | 258 |
| Materiales / minería | — | 206 |
| Internet / plataformas | 201 | 165 |
| Autos / movilidad | 76 | 143 |
| Semis / fotonica | 114 | 86 |
| Defensa / aeroespacial | 82 | 58 |
| Consumer tech / hardware | 30 | 51 |
| Basic Materials / Technology / Sin sector | 39 / 3 / 1 | 0 / 0 / 2 |

Transiciones más frecuentes: REIT → Materiales 55 · Consumo → Autos 51 (Auto Parts y concesionarios) · Software → Automatizacion 46 · REIT → Automatizacion 44 · Automatizacion → Autos 42 (transporte) · **REIT → Finanzas 39 (seguros de daños)** · Basic Materials → Materiales 39 · Autos → Materiales 30 (química).

**Muestra de 40 cambios revisada a mano** (determinista: los 565 cambios ordenados por símbolo, uno cada 14,1). ✓ = mejor que antes · ~ = aceptable o discutible · ✗ = peor que antes.

| Símbolo | Industria (proveedor) | Antes → después | Rev. |
|---|---|---|---|
| AA | Aluminum | Energia → Materiales | ✓ |
| ADT | Security & Protection Services | Internet → Automatizacion | ~ |
| ALK | Airlines | Automatizacion → Autos / movilidad | ✓ |
| APG | Engineering & Construction | Software → Automatizacion | ✓ |
| ASR | Airports & Air Services | REIT → Autos / movilidad | ✓ |
| B | Gold | REIT → Materiales | ✓ |
| BMM | Other Industrial Metals & Mining | REIT → Materiales | ✓ |
| CC | Specialty Chemicals | Semis → Materiales | ✓ |
| CLMB | Electronics & Computer Distribution | Technology → Consumer tech | ✓ |
| CPRT | Specialty Business Services | Software → Automatizacion | ~ |
| CVLG | Trucking | REIT → Autos / movilidad | ✓ |
| DGII | Communication Equipment | Software → Consumer tech | ✓ |
| EFX | Consulting Services | Software → Automatizacion | ✗ |
| EVLV | Security & Protection Services | Software → Automatizacion | ~ |
| FIP | Conglomerates | REIT → Automatizacion | ✓ |
| GATX | Rental & Leasing Services | REIT → Automatizacion | ✓ |
| GPRE | Chemicals (etanol/combustibles) | Energia → Materiales | ~ |
| HL | Other Precious Metals & Mining | Basic Materials → Materiales | ✓ |
| HUN | Chemicals | Autos → Materiales | ✓ |
| IPI | Agricultural Inputs (potasa) | Software → Materiales | ✓ |
| KFY | Staffing & Employment Services | Software → Automatizacion | ~ |
| LAR | Other Industrial Metals & Mining (litio) | Automatizacion → Materiales | ✓ |
| LWLG | Specialty Chemicals (polímeros electroópticos) | Semis → Materiales | ✗ |
| MEOH | Chemicals | Basic Materials → Materiales | ✓ |
| MP | Other Industrial Metals & Mining | Automatizacion → Materiales | ✓ |
| NEU | Specialty Chemicals | Software → Materiales | ✓ |
| NTR | Agricultural Inputs (fertilizantes) | Software → Materiales | ✓ |
| ONDS | Communication Equipment (drones/inalámbrico) | Defensa → Consumer tech | ~ |
| PGR | Insurance - Property & Casualty | REIT → Finanzas | ✓ |
| RBA | Specialty Business Services (subastas) | Internet → Automatizacion | ~ |
| RS | Steel | Semis → Materiales | ✓ |
| SBLK | Marine Shipping | Automatizacion → Autos / movilidad | ✓ |
| SKE | Other Industrial Metals & Mining | REIT → Materiales | ✓ |
| SPIR | Specialty Business Services (satélites) | Defensa → Automatizacion | ✗ |
| SXC | Coking Coal | Semis → Materiales | ✓ |
| TNET | Staffing & Employment Services | Software → Automatizacion | ~ |
| TTEK | Engineering & Construction | Software → Automatizacion | ✓ |
| USAR | Other Industrial Metals & Mining (tierras raras) | Semis → Materiales | ✓ |
| VRSK | Consulting Services (analítica de datos) | Software → Automatizacion | ✗ |
| WMS | Building Products & Equipment | REIT → Automatizacion | ✓ |

**Resultado: 28 ✓ · 8 ~ · 4 ✗.**
- Los 4 ✗ son casos en que la descripción acertaba por suerte y el proveedor los clasifica en una industria genérica: consultoras de datos (EFX, VRSK), una química fotónica (LWLG) y una empresa de satélites (SPIR).
- Los 8 ~ son, casi todos, **servicios a empresas de Industrials** (Specialty Business Services, Consulting, Staffing, Security & Protection, Rental & Leasing, Waste Management: 88 filas en total). Caen en «Automatizacion» porque la taxonomía no tiene un tema de servicios.
- **Decisión pendiente del dueño:** crear un tema «Servicios a empresas», o aceptar «Automatizacion» como el cajón industrial.

**Filtro de Tema (V).** Se aplicó `applyResultViewFilters` (`lib/screenerResultView.js`) a las 3.249 filas con el tema nuevo:
- Cada una de las 14 opciones devuelve exactamente sus miembros, la suma da 3.249 y «Todos» da 3.249.
- Las opciones se construyen a partir de los datos (`themeOptions` en `useResultViewModel.js`), así que «Materiales / minería» aparece sola, sin tocar la UI.
- Una sesión guardada con tema «Basic Materials» da 0 filas. El `useEffect` existente (U14) la devuelve a «Todos» sin avisar.

**Cómo y cuándo se propaga (S, no ejecutado):**
- **Hoy no cambia nada en el screener:** los temas viven en `scan_results.metrics.theme` de cada nocturno. Se recalculan en `lib/materializedScanner.js:506` con el perfil del proveedor, en el **primer nocturno que corra este código en el Mini**, es decir, después de comitear y hacer pull allí. Los scans anteriores conservan el tema viejo, y al comparar scans antiguos (p. ej., «Qué cambió esta semana») aparecerán cambios de tema que no son del negocio.
- **Superficies que recalculan al leer** (cambian en cuanto se despliega el código, antes del nocturno): `rowTheme` en `lib/stockRows.js` (research desk, market health), `canonicalTheme` en `lib/leaderboards.js`, `lib/cachedScreenerRows.js`, `lib/peers.js`, `lib/comparables.js` y `app/api/company-brief`. Durante esa ventana, el screener (tema guardado) y esas páginas (tema recalculado) pueden discrepar.
- **RS tema:** `themeRsAssignmentForRow` usa primero el tema guardado de la fila.
  - Hasta que se recalcule el ranking, una fila reclasificada busca su RS en el ranking de su tema nuevo, que se calculó con los miembros antiguos, y no lo encuentra.
  - «Materiales / minería» no tiene `engine_version` todavía: las 12 existentes tienen 11 snapshots cada una en la copia y la nueva, 0.
  - Con la política P2, esas filas salen como «RS tema sin dato» si el filtro RS tema está activo.
  - Orden recomendado: `scripts/rs-theme-private.mjs --write` (no ejecutado, por regla) **en la misma ventana** que el nocturno.
  - Riesgo a decidir: el sufijo `-v1` se mantiene con miembros distintos. La traza queda en `metadata.businessThemeGitSha`, pero mezclar semanas antiguas y nuevas bajo la misma versión distorsiona cualquier delta de RS tema (P7). Recomiendo subir a `-v2` (`lib/rsEngines.js`, fuera de mi propiedad).
- Fuerza de grupo (`sectorScore`, P3) agrupa por tema y cambiará en el mismo nocturno.

**Temas sin tilde (hallazgo aparte, solo documentado).**
- Van sin tilde «Automatizacion», «Energia / red» y «Semis / fotonica», además de los textos descriptivos de cada tema.
- **No es trivial ni seguro:** la clave es el dato que se guarda en `metrics.theme` de cada scan, en las sesiones de filtros (`themeFilter`, en el navegador) y en listas o favoritos. Renombrarla dejaría scans viejos y nuevos con dos nombres para el mismo tema y reiniciaría filtros guardados.
- Los `engine_version` **no** se verían afectados: el slug ya quita las tildes.
- Para hacerlo bien hace falta un mapa de alias leído en un solo sitio, que también aplique a los scans viejos, más un renocturno. Mientras tanto, la clave nueva nace ya con tilde.

Tests: `tests/businessTheme.test.js` (nuevo, 12 casos); `tests/themeRs.test.js` y `tests/rsThemePrivate.test.js` pasan de 12 a 13 claves. El ejemplo de «residual», que era «Basic Materials», ahora es un sector sin regla. `scripts/symbol-mapping-test.mjs` sigue pasando. Fuera de mi propiedad, una línea en `lib/themeRs.js`: el texto visible «no es una de las 12 ocupaciones curadas» pasa a «…de las ocupaciones curadas». Los comentarios con «12 keys» en `lib/rsEngines.js`, `lib/themeRsAssign.js` y `scripts/rs-theme-private.mjs` quedan como estaban.

### 10.2 Huella VCP sin «13W» falso (P5, H5)

- **Origen (V):** `lib/setupPatterns.js:427,569`: `baseWeeks = min(65, nº de barras) / 5`, una ventana fija de 65 sesiones. En la copia, `baseWeeks` = 13 en las 3.287 filas (1 valor distinto).
- **¿Existe el dato real? No (V):**
  - `contractionSwings`, con fechas, solo trae swings en 22 filas (38 con el campo), y se buscan dentro de esa misma ventana de 65 sesiones, así que tampoco miden la base desde su máximo izquierdo.
  - `weeklyBaseWeeks` (línea 262) es otra ventana fija (16 semanas).
  - El detector de bases real (`docs/diseno-contracciones-2026-08-17.md`) no está en producto.
- **Cambio:**
  - `formatVcpFootprintFromRow` (`lib/screenerHuntTape.jsx`) omite el segmento `XW`: la huella es **`Y/Z NT`** (p. ej., `31/3 2T`). Ya no exige `baseWeeks`: basta con tener profundidades.
  - El `title` añade «Semanas de base: sin medir (falta el detector de bases)».
  - En la ficha, `vcpObjectiveSummary` (`lib/vcpDiagnostics.js`) deja de escribir «13.0 sem» junto a «base X %». El número sigue en los objetos devueltos, para los scripts de auditoría.
  - La notación `XW Y/Z NT` de `docs/vcp-footprint-notacion.md` se respeta: se omite el segmento que no tiene dato, no se inventa otro formato. No toqué el doc (no es de mi propiedad). Conviene anotar en él que XW queda suspendido hasta el detector.
- **Efecto (V en la copia):** 2.835 filas con `contraction1DepthPct` numérico mostraban «13W …» y ahora muestran `Y/Z NT`. No hubo que tocar `HuntTapeView.jsx`.
- **Tests:** `tests/screenerHuntTape.test.js` (la huella no contiene «W»; las profundidades bastan; el title avisa) y `tests/vcpReliability.test.js` (sin «sem» en la ficha).

### 10.3 Verificación

- `npx vitest run tests` dos veces: **304 archivos, 3.467 pasan, 8 omitidos, 0 fallos**, las dos veces.
- No verificado en navegador: no abrí el `:3320` ni una instancia aislada. El cambio de la huella es de texto y no de JSX, pero queda pendiente un vistazo a la cinta Caza antes de comitear.
- Sin commit, sin `git add` y sin escrituras en la base.
