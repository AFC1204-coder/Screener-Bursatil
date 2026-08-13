# Auditoría de los filtros del screener — 2026-08-13

BASE_SHA: `99b7b13` (rama `codex/statsedge-ui-polish`).
Auditoría de solo lectura: no se ha modificado código, no se ha escrito en
Supabase, no se ha ejecutado ningún escaneo, no hay commits.

> **Estado de los hallazgos (actualizado el 2026-08-14).** El punto 3 del orden
> de gravedad —el mismo preset filtrando distinto de noche que de día, sección
> D.5— está **corregido**: la pantalla aplica ya el preset crudo, ninguna capa
> viene apagada de fábrica, y sobre las mismas 264 filas los siete presets dan
> el mismo conjunto por las dos rutas. Con él se cerró el riesgo abierto de
> `?filterPreset=balanced&setupMode=weakness` (sección B.3). El resto de
> hallazgos sigue vigente. Lo medido en este documento describe el estado
> anterior al arreglo y se conserva como tal.

## Qué se ha auditado y con qué

**Código.** Los cuatro archivos donde vive el filtrado:

- `lib/screenerFilterCatalog.js` — el catálogo: qué reglas existen, qué
  etiqueta ve el usuario, qué valor trae cada preset.
- `lib/screenerFilters.js` — el motor: la función que decide si una fila
  pasa o no.
- `lib/screenerFilterLayers.js` — las capas: qué reglas se apagan cuando
  el usuario apaga una familia entera.
- `lib/screenerPipeline.js` — una segunda pasada de filtrado que corre
  solo en la pantalla, después del motor.

**Datos reales de producción** (vía `supabase_query`, solo lectura). Se han
usado tres poblaciones:

| Población | Qué es | Filas |
|---|---|---|
| **P1 — nocturno** | El escaneo nocturno más reciente: `scan_id = 8c2b05dd-e9ef-483d-9fa4-5599ebeb49a5`, «Materialized scan US 2026-08-13», 2026-08-13T05:03:38Z. Ya filtrado con el preset `balanced`. | 75 |
| **P2 — sin filtrar** | Las filas de los 17 escaneos materializados que se guardaron **sin** preset (`settings.screenerFilters.enabled = false`). Es la entrada real de la función de filtrado. | 189 |
| **P3 — muestra amplia** | Muestra estratificada (5 tramos de 200) de `dd54b3fc-20fe-4c22-a93a-1c834167b955`, «Scan servidor 2026-08-12», 9.918 filas, sin preset. | 1.000 |

**Método de verificación.** Las filas se descargaron de `scan_results` y se
pasaron por **el motor de filtrado real del repositorio** (importando
`lib/screenerFilters.js` bajo Vitest, que es lo que transforma el JSX de la
cadena de imports). No se ha reimplementado ninguna regla: los números de
este informe salen de ejecutar `screenerFilterRejectReason` y
`buildScreenerFilterExplainPlan` sobre filas de producción.

---

## Resumen: el veredicto en cinco frases

1. **No hay ninguna regla con el operador invertido.** Se han revisado las
   62 reglas una a una, con atención especial a las 18 que miden algo donde
   «más es peor». Todas comparan en el sentido correcto.
2. **`minWeaknessScore` no está invertida: está apagada.** Su operador es el
   correcto para el único preset que la usa. El problema es que aparece con
   valor 50 en los otros seis presets, donde el motor **la ignora por
   completo** — y aun así la interfaz la cuenta como activa.
3. **Tres reglas no pueden funcionar nunca** en las rutas de servidor,
   porque el campo que comparan no existe en las filas: `minRsRating`,
   `requireRecentIpo` y `maxIpoAgeMonths`.
4. **El preset por defecto filtra distinto en el escaneo nocturno que en la
   pantalla.** Seis reglas actúan de noche y no de día. Sobre las mismas 264
   filas: 78 pasan por la ruta nocturna, 91 por la ruta de la pantalla.
5. **De los 62 controles numéricos, 44 no descartan ninguna fila** con el
   preset por defecto tal como lo aplica la pantalla: 24 porque su capa
   viene apagada, 10 porque su valor es el neutro, 7 porque el umbral es
   demasiado laxo para la población y 3 porque el dato que comparan no
   existe. En la ruta nocturna, que ignora las capas, son 38 de 62.

---

# PARTE A — El inventario

## A.1 Cómo está organizado

Hay tres niveles superpuestos, y conviene no confundirlos:

- **14 capas** (`EXECUTION_LAYERS`, 13, más `REGIME_LAYER`, 1). Son los
  interruptores grandes: «Tendencia», «Momentum», «Cercanía»…
- **62 controles numéricos** (`FILTER_FIELDS`), repartidos en 14 grupos de
  interfaz. Cada uno es una casilla con un número.
- **6 interruptores de sí/no** (`BOOLEAN_FILTER_KEYS`).

Además hay **3 puertas implícitas** que no tienen control propio y que el
usuario no puede ver ni apagar: el suelo de sesgo largo, la puerta de
validez de la estructura y la puerta del modo de setup. Suman **71 reglas**
en total.

Los 14 grupos de interfaz y los 62 controles:

| Grupo | Controles |
|---|---|
| Liquidez | 4 |
| Volumen objetivo | 6 |
| Short interest | 2 |
| Momentum | 3 |
| Cercanía a máximos | 6 |
| Volatilidad / rango | 5 |
| Estructura / patrones | 12 |
| Rentabilidad / riesgo | 3 |
| Ratings proxy | 2 |
| Cobertura de datos | 4 |
| Fuerza relativa | 6 |
| Scores técnicos | 7 |
| Deterioro técnico | 1 |
| IPO real | 1 |

Las 14 capas, con cuántas reglas dice cada una que agrupa y si viene
encendida de fábrica:

| Capa | Reglas que declara | Encendida por defecto |
|---|---|---|
| Régimen | 1 | sí (interruptor aparte) |
| Trend | 3 | sí |
| Momentum | 4 | sí |
| RS | 6 | sí |
| Cercanía | 7 | sí |
| Volatilidad | 5 | sí |
| Estructura | 13 | **no** |
| Scores | 6 | sí |
| Liquidez | 6 | sí |
| Volumen+ | 8 | **no** |
| Short Float | 2 | **no** |
| Rent/Riesgo | 3 | **no** |
| Cobertura | 4 | sí |
| IPO | 2 | sí |

```js
// lib/screenerFilterCatalog.js:373
export const DEFAULT_FILTER_LAYERS = { trend: true, momentum: true, relativeStrength: true, proximity: true, volatility: true, pattern: false, score: true, liquidity: true, volumeSurge: false, shortInterest: false, riskReward: false, coverage: true, ipo: true };
```

Cuatro de las catorce vienen apagadas de fábrica. La evidencia previa
hablaba de once de catorce apagadas en una configuración guardada: eso no es
el estado por defecto del código, y **no he podido verificarlo** — la
configuración de capas del usuario vive en el navegador
(`localStorage`/`sessionStorage`), no en Supabase. Se consultó `app_settings`
(solo hay entradas de `jobs` y `company_brief_cache`) y el campo
`settings.filterLayers` de los escaneos de servidor, que viene `null` en los
cinco más recientes.

## A.2 Las 62 reglas, una a una

Columnas: clave interna · etiqueta que ve el usuario · campo que compara ·
operador · capa. Después, el valor en cada preset; **el asterisco marca que
ese valor no es el neutro**, es decir, que la regla se evalúa.

`min` significa «rechaza si el valor es menor que el umbral». `max`,
«rechaza si es mayor». `dist` es un caso especial: la métrica es negativa
(distancia por debajo del máximo) y rechaza si `valor < -umbral`.

### Liquidez (capa `liquidity`)

| Clave | Etiqueta | Campo | Op. | balanced | strict | early | broad | ipo | nearPivot | weakness |
|---|---|---|---|---|---|---|---|---|---|---|
| `minPrice` | Precio min | `price` | min | 2\* | 5\* | 2\* | 2\* | 5\* | 3\* | 2\* |
| `minMarketCap` | Market cap min | `marketCap` | min | 200M\* | 500M\* | 150M\* | 150M\* | 300M\* | 250M\* | 150M\* |
| `minAvgVolume` | Acciones/día 20d min | `avgVolume` | min | 150.000\* | 500.000\* | 100.000\* | 100.000\* | 200.000\* | 200.000\* | 100.000\* |
| `minAvgTurnover` | Importe 20d min | `avgTurnover` | min | 1,5M\* | 10M\* | 1M\* | 1M\* | 1M\* | 2M\* | 0 |

### Volumen objetivo (capa `volumeSurge`, **apagada por defecto**)

| Clave | Etiqueta | Campo | Op. | balanced | strict | early | broad | ipo | nearPivot | weakness |
|---|---|---|---|---|---|---|---|---|---|---|
| `minLatestVolume` | Acciones sesión min | `latestVolume` | min | 0 | 250.000\* | 0 | 0 | 0 | 0 | 0 |
| `minLatestTurnover` | Importe sesión min | `latestTurnover` | min | 0 | 5M\* | 0 | 0 | 0 | 0 | 0 |
| `minRelativeVolume` | Volumen hoy / media 20d min | `relativeVolume` | min | 1\* | 1\* | 1\* | 1\* | 1\* | 1\* | 0 |
| `minVolumeSurgePct` | Volumen 5d vs tramo previo min | `volumeSurgePct` | min | 15\* | 15\* | 15\* | 15\* | 15\* | 15\* | −999 |
| `minUpDownVolRatio` | Up/Down volume 50d min | `upDownVolRatio` | min | 0,8\* | 1\* | 0,8\* | 0 | 0,8\* | 0,8\* | 0 |
| `minVolumeEffectScore` | Volume Effect min | `volumeEffectScore` | min | 0 | 35\* | 0 | 0 | 0 | 0 | 0 |

### Short interest (capa `shortInterest`, **apagada por defecto**)

| Clave | Etiqueta | Campo | Op. | Todos los presets |
|---|---|---|---|---|
| `minShortFloatPct` | Short Float min | `shortPercentOfFloat` | min | 0 (neutro) |
| `maxShortFloatPct` | Short Float max | `shortPercentOfFloat` | max | 999 (neutro) |

### Momentum (capa `momentum`)

| Clave | Etiqueta | Campo | Op. | balanced | strict | early | broad | ipo | nearPivot | weakness |
|---|---|---|---|---|---|---|---|---|---|---|
| `minPerf3m` | Perf 3M min | `perf3m` | min | 3\* | 15\* | 0\* | 0\* | 10\* | 6\* | −100 |
| `minPerf6m` | Perf 6M min | `perf6m` | min | 8\* | 30\* | 5\* | 5\* | 0\* | 12\* | −100 |
| `minPerf12m` | Perf 12M min | `perf12m` | min | 12\* | 50\* | 8\* | 10\* | −100 | 18\* | −100 |

### Cercanía a máximos (capa `proximity`)

| Clave | Etiqueta | Campo | Op. | balanced | strict | early | broad | ipo | nearPivot | weakness |
|---|---|---|---|---|---|---|---|---|---|---|
| `maxDistance20dHigh` | Max caída vs 20d | `distance20d` | dist | 20\* | 5\* | 18\* | 25\* | 15\* | 6\* | 999 |
| `maxDistance50dHigh` | Max caída vs 50d | `distance50d` | dist | 30\* | 10\* | 30\* | 35\* | 25\* | 12\* | 999 |
| `maxDistance52w` | Max caída vs 52w | `distance52w` | dist | 40\* | 15\* | 38\* | 40\* | 30\* | 20\* | 999 |
| `maxDistanceATH` | Max caída vs ATH | `distanceATH` | dist | 70\* | 25\* | 65\* | 60\* | 40\* | 35\* | 999 |
| `maxHighsSpreadPct` | Highs spread max | `highsSpreadPct` | max | 25\* | 8\* | 25\* | 35\* | 20\* | 10\* | 999 |
| `maxExtensionSma50` | Extensión SMA50 max | `extSma50` | max | 45\* | 25\* | 28\* | 45\* | 35\* | 18\* | 999 |

### Volatilidad / rango (capa `volatility`)

| Clave | Etiqueta | Campo | Op. | balanced | strict | early | broad | ipo | nearPivot | weakness |
|---|---|---|---|---|---|---|---|---|---|---|
| `maxDailyMove20dPct` | Movimiento diario max 20d | `maxDailyMove20dPct` | max | 25\* | 12\* | 25\* | 999 | 28\* | 14\* | 999 |
| `maxDailyRange20dPct` | Rango intradía max 20d | `maxDailyRange20dPct` | max | 32\* | 16\* | 34\* | 999 | 34\* | 18\* | 999 |
| `maxRange63dPct` | Rango precio 63d max | `range63dPct` | max | 120\* | 55\* | 120\* | 999 | 120\* | 60\* | 999 |
| `maxVolatility63d` | Volatilidad anualizada max | `volatility63d` | max | 120\* | 60\* | 120\* | 999 | 140\* | 70\* | 999 |
| `maxDrawdown63d` | Drawdown 3M max | `maxDrawdown63d` | max | 40\* | 22\* | 40\* | 999 | 40\* | 22\* | 999 |

### Estructura / patrones (capa `pattern`, **apagada por defecto**)

Las doce están en su valor neutro en **los siete presets**. Solo se activan
desde los botones de exigencia de la familia «Estructura»
(`FILTER_FAMILY_PRESETS.pattern`).

| Clave | Etiqueta | Campo | Op. | Neutro |
|---|---|---|---|---|
| `minContractionCount` | Contracciones min | `contractionCount` | min | 0 |
| `maxContraction1DepthPct` | Contracción 1 max | `contraction1DepthPct` | max | 999 |
| `maxContraction2DepthPct` | Contracción 2 max | `contraction2DepthPct` | max | 999 |
| `maxContraction3DepthPct` | Contracción 3 max | `contraction3DepthPct` | max | 999 |
| `maxLastContractionDepthPct` | Última contracción max | `lastContractionDepthPct` | max | 999 |
| `maxBaseDepthPct` | Profundidad base max | `baseDepthPct` | max | 999 |
| `minBaseWeeks` | Duración base min | `baseWeeks` | min | 0 |
| `maxBaseWeeks` | Duración base max | `baseWeeks` | max | 999 |
| `maxAbsDistanceToPivotPct` | Distancia pivot max | `absDistanceToPivotPct` | max | 999 |
| `maxVolumeDryUpRatio` | Volumen seco max | `volumeDryUpRatio` | max | 999 |
| `maxTightness10dPct` | Rango 10d max | `tightness10dPct` | max | 999 |
| `minPatternQualityScore` | Calidad estructura min | `patternQualityScore` | min | 0 |

### Rentabilidad / riesgo (capa `riskReward`, **apagada por defecto**)

| Clave | Etiqueta | Campo | Op. | balanced | strict | resto | weakness |
|---|---|---|---|---|---|---|---|
| `minRiskRewardScore` | Score rent/riesgo min | `riskRewardScore` | min | 35\* | 35\* | 35\* | 0 |
| `minReturnToVol3m` | Retorno 3M / volatilidad min | `returnToVol3m` | min | 0,2\* | 0,2\* | 0,2\* | −999 |
| `minReturnToDrawdown3m` | Retorno 3M / drawdown min | `returnToDrawdown3m` | min | 0,5\* | 0,5\* | 0,5\* | −999 |

### Ratings proxy

| Clave | Etiqueta | Campo | Op. | Capa | Todos los presets |
|---|---|---|---|---|---|
| `minAdProxyScore` | A/D min | `adProxyScore` | min | `volumeSurge` | 0 (neutro) |
| `minEpsGrowthProxyScore` | EPS proxy min | `epsGrowthProxyScore` | min | `score` | 0 (neutro) |

### Cobertura de datos (capa `coverage`)

| Clave | Etiqueta | Campo | Op. | balanced | strict | early | broad | ipo | nearPivot | weakness |
|---|---|---|---|---|---|---|---|---|---|---|
| `maxPriceFreshnessDays` | Precio fresco max | `priceFreshnessDays` o `lastDate` | código propio | 5\* | 5\* | 5\* | 5\* | 5\* | 5\* | 5\* |
| `minDataCoverageScore` | Cobertura total min | `dataCoverageScore` | min | 35\* | 50\* | 35\* | 20\* | 35\* | 35\* | 35\* |
| `minTechnicalCoverageScore` | Cobertura técnica min | `technicalCoverageScore` | min | 45\* | 70\* | 45\* | 35\* | 45\* | 50\* | 45\* |
| `minFundamentalCoverageScore` | Cobertura fundamental min | `fundamentalCoverageScore` | min | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Fuerza relativa (capa `relativeStrength`)

| Clave | Etiqueta | Campo | Op. | balanced | strict | early | broad | ipo | nearPivot | weakness |
|---|---|---|---|---|---|---|---|---|---|---|
| `minRsRating` | RS min | **`weeklyRsRating`** (ranking semanal) | código propio | 50\* | 75\* | 45\* | 0 | 50\* | 58\* | 0 |
| `minRsBenchmarkRating` | RS Bench min | `rsRating` | min | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `minRsCountryPct` | RS Pais min | `rsCountryPct` | min | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `minRsSectorPct` | RS Grupo min | `rsSectorPct` | min | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `minRsQualityScore` | RS Quality min | `rsQualityScore` | min | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `minSectorScore` | Fuerza grupo min | `sectorScore` | min | 0 | 55\* | 0 | 0 | 0 | 0 | 0 |

### Scores técnicos

| Clave | Etiqueta | Campo | Op. | Capa | balanced | strict | early | broad | ipo | nearPivot | weakness |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `minWeinsteinScore` | Estructura tend. min | `weinsteinScore` | min | `trend` | 50\* | 75\* | 40\* | 25\* | 30\* | 60\* | 0 |
| `minMinerviniScore` | Estructura rupt. min | `minerviniScore` | min | `trend` | 38\* | 65\* | 30\* | 20\* | 30\* | 50\* | 0 |
| `minMomentumScore` | Momentum score min | `momentumScore` | min | `momentum` | 15\* | 45\* | 10\* | 0 | 35\* | 15\* | 0 |
| `minRiskScore` | Risk score min | `riskScore` | min | `proximity`+`score` | 15\* | 50\* | 15\* | 0 | 15\* | 45\* | 0 |
| `minVolumeScore` | Volume score min | `volumeScore` | min | `score`+`liquidity` | 0 | 30\* | 0 | 0 | 0 | 0 | 0 |
| `minLiquidityScore` | Liquidity score min | `liquidityScore` | min | `liquidity` | 0 | 35\* | 0 | 0 | 0 | 0 | 0 |
| `minTotalScore` | Score compuesto min | **`objectiveScore`** | min | `score` | 0 | 68\* | 0 | 0 | 0 | 55\* | 0 |

### Deterioro técnico (capa `score`)

| Clave | Etiqueta | Campo | Op. | balanced | strict | early | broad | ipo | nearPivot | weakness |
|---|---|---|---|---|---|---|---|---|---|---|
| `minWeaknessScore` | Deterioro min | `weaknessScore` | código propio | 50\* | 50\* | 50\* | 50\* | 50\* | 50\* | 55\* |

### IPO real (capa `ipo`)

| Clave | Etiqueta | Campo | Op. | Todos los presets |
|---|---|---|---|---|
| `maxIpoAgeMonths` | Edad IPO max | `ipoAgeMonths` o `ipoDate` | código propio | 60\* |

### Los 6 interruptores de sí/no

| Clave | Qué exige | Capa | Presets donde está en `true` |
|---|---|---|---|
| `requireStage2` | Etapa 2 confirmada (semanal, con confirmación diaria) | `trend` | balanced, strict, nearPivot |
| `requireSma200Up` | Pendiente de la SMA200 > 0 | `trend` | ninguno |
| `requirePriceAboveSma50` | Precio por encima de la SMA50 | `trend` | ninguno |
| `requireRecentIpo` | IPO de menos de `maxIpoAgeMonths` | `ipo` | ipo |
| `requireUpVolume` | Última vela alcista con volumen | `volumeSurge` | ninguno |
| `requireContractionsDecreasing` | Contracciones cada vez menores | `pattern` | ninguno |

### Las 3 puertas implícitas (sin control en la interfaz)

| Nombre interno | Qué hace | Cuándo se activa |
|---|---|---|
| `longBiasFloor` | Rechaza si el precio está bajo la SMA200 o la SMA200 cae con fuerza (pendiente < −2) | Siempre que el modo no sea `weakness` ni `ipoRecent` **y** `requireStage2` no sea `true` |
| `patternValidityGate` | Bloquea la fila si los datos de estructura no son fiables, o si la estructura de contracciones está invalidada | Solo si hay alguna regla de patrón activa |
| `setupModeGate` | Comprobación compuesta específica del modo (`nearPivot`, `pullback`, `early`, `ipoRecent`, `extended`) | Según `setupMode`; en `leader` y `any` no hace nada |

## A.3 Cuántas reglas activa cada preset

Hay **siete presets**, todos definidos en `SCREENER_FILTER_PRESETS`
(`lib/screenerFilterCatalog.js:167-175`). Todos parten del mismo bloque
`QUALITY_DEFAULTS` y luego sobreescriben.

| Preset | Nombre visible | Modo de setup | Umbrales no neutros (de 62) | Interruptores en `true` |
|---|---|---|---|---|
| `balanced` | Balanceado | `leader` | **34** | `requireStage2` |
| `strict` | Líderes estrictos | `leader` | **41** | `requireStage2` |
| `early` | Etapa 2 temprana | `early` | **34** | ninguno |
| `broad` | Exploratorio amplio | `any` | **25** | ninguno |
| `ipo` | IPO / nuevos líderes | `ipoRecent` | **33** | `requireRecentIpo` |
| `nearPivot` | Vigilancia pivot | `nearPivot` | **35** | `requireStage2` |
| `weakness` | Deterioro técnico | `weakness` | **8** | ninguno |

Cuidado con un matiz: «umbral no neutro» significa que el motor la evalúa
si la regla llega hasta él. No significa que descarte nada — eso se mide en
la Parte D.

**El preset `balanced` deja 28 de los 62 controles en su valor neutro:**
`minLatestVolume`, `minLatestTurnover`, `minVolumeEffectScore`,
`minShortFloatPct`, `maxShortFloatPct`, `minRsQualityScore`,
`minAdProxyScore`, `minEpsGrowthProxyScore`, los doce de estructura,
`minFundamentalCoverageScore`, `minRsBenchmarkRating`, `minRsCountryPct`,
`minRsSectorPct`, `minVolumeScore`, `minLiquidityScore`, `minSectorScore` y
`minTotalScore`.

---

# PARTE B — Semántica: ¿hace lo que dice?

## B.1 El método

Se han separado las reglas en dos grupos:

- Las que miden algo donde **más es mejor** (precio, capitalización,
  rendimiento, scores de calidad, RS). Ahí `min` es lo correcto.
- Las que miden algo donde **más es peor** (volatilidad, drawdown,
  distancia a máximos, extensión, profundidad de base, short float,
  deterioro). Ahí `max` es lo correcto.

Y se ha comprobado el operador de cada una contra su nombre.

## B.2 Las 18 reglas donde «más es peor»

| Regla | Métrica | ¿Más es peor? | Operador | ¿Correcto? |
|---|---|---|---|---|
| `maxDailyMove20dPct` | mayor salto diario en 20 sesiones | sí | max | sí |
| `maxDailyRange20dPct` | mayor rango intradía en 20 sesiones | sí | max | sí |
| `maxRange63dPct` | amplitud de tres meses | sí | max | sí |
| `maxVolatility63d` | volatilidad anualizada | sí | max | sí |
| `maxDrawdown63d` | caída máxima de tres meses | sí | max | sí |
| `maxExtensionSma50` | distancia por encima de la SMA50 | sí | max | sí |
| `maxHighsSpreadPct` | dispersión entre máximos | sí | max | sí |
| `maxDistance20dHigh` | caída desde el máximo de 20d | sí | dist | sí |
| `maxDistance50dHigh` | caída desde el máximo de 50d | sí | dist | sí |
| `maxDistance52w` | caída desde el máximo de 52 semanas | sí | dist | sí |
| `maxDistanceATH` | caída desde el máximo histórico | sí | dist | sí |
| `maxBaseDepthPct` | profundidad de la base | sí | max | sí |
| `maxContraction1/2/3DepthPct` | profundidad de cada contracción | sí | max | sí |
| `maxLastContractionDepthPct` | profundidad de la última contracción | sí | max | sí |
| `maxAbsDistanceToPivotPct` | distancia al pivote | sí | max | sí |
| `maxTightness10dPct` | rango de las últimas 10 sesiones | sí | max | sí |
| `maxVolumeDryUpRatio` | volumen 10d / volumen 50d | sí (secarse es bueno) | max | sí |
| `maxShortFloatPct` | flota vendida en corto | sí, para largos | max | sí |
| `maxPriceFreshnessDays` | días desde la última vela | sí | max | sí |
| `maxIpoAgeMonths` | meses desde la salida a bolsa | sí, para «IPO reciente» | max | sí |
| `maxBaseWeeks` | semanas de base | sí, en el extremo largo | max | sí (par con `minBaseWeeks`) |
| `minWeaknessScore` | **deterioro técnico** | **sí** | **min** | ver B.3 |

Las cuatro reglas `dist` merecen una nota. La métrica de distancia es
negativa: `distance52w = −12,5` significa «un 12,5 % por debajo del máximo
de 52 semanas». El motor hace:

```js
// lib/screenerFilters.js:752-758
for (const [field, rule] of Object.entries(DISTANCE_RULES)) {
  const threshold = finite(set[field]);
  if (!Number.isFinite(threshold) || threshold >= 999) continue;
  const value = metric(row, rule.metric);
  if (!Number.isFinite(value)) return reject(field, `${rule.label} sin dato`);
  if (value < -threshold) return reject(field, `${rule.label} ${value.toFixed(2)} < -${threshold}`);
}
```

Con `maxDistance52w = 40` rechaza si la distancia es menor que −40, es decir,
si el valor ha caído más de un 40 %. La etiqueta «Max caída vs 52w» describe
exactamente eso. Correcto.

## B.3 El caso `minWeaknessScore`

**La métrica.** `weaknessScore` va de 0 a 100 y **más significa peor**. Lo
confirma su propia etiqueta:

```js
// lib/scoringEngine.js:129
weaknessLabel: weaknessScore >= 78 ? "Deterioro severo" : weaknessScore >= 65 ? "Deterioro alto" : weaknessScore >= 50 ? "Deterioro visible" : weaknessScore >= 35 ? "Debilidad mixta" : "Sin deterioro claro",
```

**La regla.**

```js
// lib/screenerFilters.js:763-768
if (mode === "weakness") {
  const weak = weaknessFilterValue(row);
  const minWeakness = finite(set.minWeaknessScore) ?? 0;
  if (Number.isFinite(weak) && weak < minWeakness) return reject("minWeaknessScore", `deterioro ${weak.toFixed(0)} < ${minWeakness}`);
  return "";
}
```

Efectivamente exige deterioro **alto** para pasar. Pero eso es lo correcto
para el preset que la usa:

```js
// lib/screenerFilterCatalog.js:174
weakness: { name: "Deterioro técnico", desc: "Debilidad para evitar largos", v: { ..., setupMode: "weakness", ..., minWeaknessScore: 55, ... } },
```

El preset «Deterioro técnico» busca precisamente valores deteriorados, para
que el operador sepa cuáles evitar. Exigir un deterioro mínimo de 55 es
literalmente lo que promete su nombre.

**Verificación con datos reales.** Sobre las 189 filas de P2, aplicando el
preset `weakness` completo:

| Símbolo | `weaknessScore` | Etiqueta | Resultado |
|---|---|---|---|
| JMIA | 100 | Deterioro severo | **pasa** |
| CNA.L | 100 | Deterioro severo | **pasa** |
| T.TO | 100 | Deterioro severo | **pasa** |
| DSV.CO | 97 | Deterioro severo | **pasa** |
| TIGO | 0 | Sin deterioro claro | rechazada: `deterioro 0 < 55` |
| OXY | 0 | Sin deterioro claro | rechazada: `deterioro 0 < 55` |
| WABC | 0 | Sin deterioro claro | rechazada: `deterioro 0 < 55` |
| C2PU.SI | 6 | Sin deterioro claro | rechazada: `deterioro 6 < 55` |

Consulta que produjo esas filas:

```
table: scan_results
select: symbol,rank_index,metrics,ipoAgeMonths:raw->ipoAgeMonths,ipoDate:raw->ipoDate,
        weeklyStageState:raw->weeklyStageState,weeklyStageLabel:raw->weeklyStageLabel,
        weeklyFastWeeks:raw->weeklyFastWeeks,weeklySlowWeeks:raw->weeklySlowWeeks,country:raw->country
filter: scan_id=in.(dfc82449-…,abb4d4bd-…,344ca7c0-…,03689e54-…,9bb23e47-…,e33a3aec-…,
        e648499d-…,a4acc5cd-…,a3e05ba4-…,8fc25d28-…,18f637e6-…,5bf5796f-…,8c9599cf-…,
        4d79b20b-…,285071a4-…,8211e7d0-…,9480589e-…)
order: rank_index.asc
limit: 200
→ 189 filas
```

**El problema real es otro.** El valor `minWeaknessScore: 50` está en
`QUALITY_DEFAULTS` (`lib/screenerFilterCatalog.js:130`), y como los siete
presets hacen `{ ...QUALITY_DEFAULTS, ... }`, ese 50 aparece en los seis
presets restantes. Pero el motor **no lo aplica en ninguno de los seis**,
porque la guarda es el modo de setup, no el valor:

```js
// lib/screenerFilters.js:673-676
} else {
  if (Number.isFinite(finite(set.minWeaknessScore))) {
    addRule(bucket, { field: "minWeaknessScore", label: "deterioro", threshold: minWeakness, direction: "min", status: "skipped", detail: `deterioro omitido: setup ${setupModeName(mode) || mode || "sin modo"} no es weakness` });
  }
```

Verificado con datos: con `setupMode: "leader"` y `minWeaknessScore: 90`
—un umbral absurdo, que debería descartar casi todo si se aplicara— sobre
las 264 filas de P1+P2, **0 filas rechazadas por esa regla**.

Y hay dos consecuencias visibles:

1. **La interfaz la cuenta como activa.** `isFieldRuleActive` solo mira si
   la capa está encendida (`score`, encendida de fábrica) y si la regla fue
   quitada a mano. Con el preset `balanced`, el control «Deterioro min: 50»
   se pinta como activo y suma al contador «reglas finas activas».
2. **El plan de explicación también la cuenta.** `addRule` incrementa
   `bucket.active` y, como `"skipped"` no coincide con ningún caso, la mete
   en `bucket.passed`:

   ```js
   // lib/screenerFilters.js:413-420
   function addRule(bucket, item) {
     if (!item) return;
     bucket.active += 1;
     if (item.status === "fail") bucket.failed.push(item);
     else if (item.status === "missing") bucket.missing.push(item);
     else if (item.status === "near") bucket.near.push(item);
     else bucket.passed.push(item);
   }
   ```

   El texto que ve el usuario dice «Pasa N reglas activas» incluyendo una
   regla que no se ha evaluado. El propio test del repositorio lo fija como
   comportamiento esperado (`tests/screenerFilters.test.js:5-16`).

**Un riesgo abierto.** Desde la interfaz no se puede llegar a la
combinación peligrosa: `applySetupMode("weakness")` (`app/page.jsx:851-865`)
copia el preset `weakness` entero, así que el umbral pasa a 55 y todo queda
coherente. Pero por parámetros de URL sí: `?filterPreset=balanced&setupMode=weakness`
produce un screener «Balanceado» que solo devuelve valores deteriorados,
porque `setupMode` está en `SCREENER_FILTER_QUERY_KEYS` y
`screenerFiltersFromParams` mezcla ambos sin comprobar coherencia. Esa ruta
la usa `/api/jobs/scan-refresh` (`app/api/jobs/scan-refresh/route.js:110`).

## B.4 Reglas donde comprobé que «más es mejor»

`minRiskScore` merecía comprobación: si `riskScore` midiera «riesgo», un
mínimo exigiría riesgo alto. No es el caso. Sobre las 264 filas de P1+P2, la
correlación entre `riskScore` y `weaknessScore` es **−0,446** (rango
observado de `riskScore`: 18 a 100). Es decir: cuanto más alto el
`riskScore`, menos deterioro. Es un score de *calidad* de riesgo, no de
cantidad de riesgo. `min` es correcto — aunque la etiqueta «Risk score min»
se presta al malentendido.

`minVolumeSurgePct` («Volumen 5d vs tramo previo min», neutro −999) y
`minUpDownVolRatio`: ambas miden actividad compradora, más es mejor, `min`
correcto.

## B.5 Reglas correctas pero mal etiquetadas

Esto no se arregla en el operador, se arregla en la etiqueta.

| Regla | Etiqueta actual | Problema |
|---|---|---|
| `minRsRating` | «RS min» | Filtra por `weeklyRsRating` (el ranking semanal de `rs_weekly_items` sobre el universo estadounidense), no por `rsGlobalPct`. La etiqueta sale de `metricShortLabel("rsGlobalPct")`, que es la métrica equivocada. El número que muestra la tabla sí es el semanal, así que el usuario no lo nota; pero el código dice una cosa y hace otra. |
| `minTotalScore` | «Score compuesto min» | Compara `objectiveScore`, no `totalScore`. Son dos scores distintos (`compositeScore` incluye el bonus de patrón; `objectiveScore` no). El nombre de la clave miente sobre el campo. |
| `minRiskScore` | «Risk score min» | Es calidad de riesgo, no cantidad. Un mínimo alto es más exigente, al revés de lo que sugiere leerlo rápido. |
| `maxVolumeDryUpRatio` | «Volumen seco max» | El «max» se refiere al ratio, y ratio bajo = volumen seco = lo que se busca. Correcto pero contraintuitivo: pedir «volumen seco máximo 0,9» significa «que el volumen se haya secado al menos a 0,9». |
| `minWeaknessScore` | «Deterioro min» | Correcta en el preset `weakness`. En los otros seis, visible, con valor 50 y sin efecto. |
| `minAvgTurnover` | «Importe 20d min» | El propio `hint` avisa: «En mercados no USD no convierte divisa». El umbral de 1,5 M compara yenes con dólares. Es una limitación declarada, no un fallo de operador. |

---

# PARTE C — Reglas que no pueden funcionar

## C.1 Campos ausentes o siempre nulos

Cobertura medida sobre las 264 filas de P1+P2 (todas de escaneos
materializados, que guardan `metrics` con 201 claves y `raw` con 260):

| Campo | Con dato | Nulo | Ausente | Reglas afectadas |
|---|---|---|---|---|
| `ipoAgeMonths` | **0 (0 %)** | 264 | 0 | `requireRecentIpo`, `maxIpoAgeMonths`, modo `ipoRecent` |
| `ipoDate` | **0 (0 %)** | 264 | 0 | ídem |
| `weeklyRsAvailable` | **0 (0 %)** | 0 | 264 | `minRsRating` |
| `weeklyRsRating` | **0 (0 %)** | 0 | 264 | `minRsRating` |
| `contraction3DepthPct` | 29 (11,0 %) | 235 | 0 | `maxContraction3DepthPct` |
| `contraction2DepthPct` | 112 (42,4 %) | 152 | 0 | `maxContraction2DepthPct` |
| `shortPercentOfFloat` | 115 (43,6 %) | 149 | 0 | `minShortFloatPct`, `maxShortFloatPct` |
| `rsRating` | 93 (35,2 %) | 171 | 0 | `minRsBenchmarkRating` |
| `rsSectorPct` | 127 (48,1 %) | 137 | 0 | `minRsSectorPct` |
| `rsQualityScore` | 162 (61,4 %) | 102 | 0 | `minRsQualityScore` |
| `rsCountryPct` | 174 (65,9 %) | 90 | 0 | `minRsCountryPct` |
| `contraction1DepthPct` / `lastContractionDepthPct` | 196 (74,2 %) | 68 | 0 | 2 reglas de estructura |

### `minRsRating` — muerta en todas las rutas de servidor

```js
// lib/screenerFilters.js:746-750
const minRsRating = finite(set.minRsRating);
if (Number.isFinite(minRsRating) && minRsRating > 0 && row.weeklyRsAvailable === true) {
  const rs = finite(row.weeklyRsRating);
  if (!Number.isFinite(rs) || rs < minRsRating) return reject("minRsRating", `RS semanal ${Number.isFinite(rs) ? rs.toFixed(0) : "sin dato"} < ${minRsRating}`);
}
```

La condición `row.weeklyRsAvailable === true` nunca se cumple en las filas
del escáner. El motivo es de arquitectura: el campo lo añade
`attachWeeklyRs` (`lib/globalRs.js:152`), que se llama **al leer** el
escaneo en `/api/scans` (`app/api/scans/route.js:255`) y en
`/api/discovery`, no al producirlo. El escáner materializado —el que corre
de noche— filtra antes de que ese campo exista.

Verificado con datos: sobre P1+P2 y P3, con umbral 50 (balanced) o 75
(strict), el motor **evalúa la regla 0 veces**. No rechaza ni acepta: la
salta.

Es una decisión deliberada y documentada en el propio código (líneas
623-629 de `lib/screenerFilters.js`): se prefiere omitir el criterio a
rechazar filas por un dato que no se les puede aplicar. El problema es que
en la ruta nocturna eso significa que el criterio **no existe**, mientras el
preset anuncia «RS min 50».

Cuantificación de lo que se pierde: si las filas llegaran hidratadas —se
simuló copiando `rsGlobalPct` en `weeklyRsRating`— la regla rechazaría 77
de 264 filas, de las cuales 68 serían por «sin dato». Es decir, incluso
hidratada la mayor parte del efecto vendría de la ausencia del dato, no de
la fuerza relativa.

### `requireRecentIpo` y `maxIpoAgeMonths` — muertas por falta de dato

```js
// lib/screenerFilters.js:91-94
function isRecentIpo(row = {}, maxMonths = 60) {
  const age = firstFinite(row.ipoAgeMonths, monthsSince(metricText(row, "ipoDate")));
  return Number.isFinite(age) && age >= 0 && age <= maxMonths;
}
```

Con `ipoAgeMonths` nulo e `ipoDate` cadena vacía en el 100 % de las filas
medidas, `age` nunca es finito y la función devuelve siempre `false`. La
regla no filtra: **rechaza todo**.

Efecto medido con el preset `ipo` completo:

- P1 (75 filas del nocturno): **0 pasan**. `requireRecentIpo` es el primer
  motivo de rechazo en 58 de 75.
- P2 (189 filas sin filtrar): **0 pasan**.
- P3 (1.000 filas): **0 pasan**. `requireRecentIpo` es el primer motivo en
  76 de las primeras 97 evaluadas.

`maxIpoAgeMonths` es aún más inerte: solo se consulta *dentro* de
`requireRecentIpo` o del gate `ipoRecent`. Con `requireRecentIpo: false`
—su valor en seis de los siete presets— el control «Edad IPO max: 60» está
visible, su capa está encendida y no hace absolutamente nada.

### Las reglas que filtran por «no tengo el dato»

Cuando una regla con umbral activo encuentra el campo vacío, el motor
rechaza la fila:

```js
// lib/screenerFilters.js:738
if (!Number.isFinite(value)) return reject(field, `${rule.label} sin dato`);
```

Eso convierte varias reglas en filtros de cobertura disfrazados. Medido
sobre P1+P2 (264 filas), activando cada regla por separado:

| Regla | Umbral de prueba | Rechaza por valor | Rechaza por **sin dato** |
|---|---|---|---|
| `minShortFloatPct` | 5 | 61 | **149** |
| `maxShortFloatPct` | 12 | 20 | **149** |
| `minRsBenchmarkRating` | 60 | 17 | **171** |
| `minRsSectorPct` | 50 | 23 | **137** |
| `minRsQualityScore` | 60 | 38 | **102** |
| `minRsCountryPct` | 50 | 43 | **90** |

En los seis casos el motivo dominante es la ausencia del dato, no el
criterio. El `hint` de short float lo avisa («Si no hay dato y esta regla
está activa, no pasa el filtro»); los cuatro de RS, no. Esto choca de frente
con el principio 3 de `docs/principios-producto.md` («Un dato ausente se
muestra como ausente, no como cero ni como valor por defecto»): aquí un dato
ausente se convierte en una exclusión silenciosa.

## C.2 Campos que ya no se calculan

No he encontrado ninguna regla huérfana en el sentido estricto: los 62
campos comparados existen todos en el productor de filas
(`lib/materializedScanner.js` / `lib/researchRow.js`). Pero sí hay un
problema equivalente, **según la ruta que produjo la fila**:

Las filas de los escaneos de servidor (`Scan servidor …`) guardan un
`metrics` compacto de **88 claves**, frente a las **201** de un escaneo
materializado. Verificado sobre las 1.000 filas de P3: las 1.000 tienen
exactamente 88 claves. Faltan, entre otros: `avgVolume`, `avgTurnover`,
`distance20d`, `distance50d`, `distanceATH`, `highsSpreadPct`, `upVolume`,
`volumeSurgePct`, `range63dPct`, `volatility63d`, `maxDailyMove20dPct`,
`maxDailyRange20dPct`, `latestVolume`, `latestTurnover`,
`contractionsDecreasing`, `patternDataStatus`, `contractionStructureStatus`
y `returnToVol3m` / `returnToDrawdown3m`.

Sobre esas filas, cualquier regla que compare uno de esos campos rechaza por
«sin dato». No es un fallo de la regla; es que la misma regla se comporta de
forma distinta según de dónde venga la fila.

## C.3 Redundancias

Método: se activó cada regla por separado con el umbral del preset `strict`
—el más exigente, el que más señal produce— sobre las 264 filas de P1+P2, y
se compararon los conjuntos de filas rechazadas.

### Contención total (A siempre rechazado también por B)

| Regla A | Está contenida en B | \|A\| | \|B\| | Jaccard |
|---|---|---|---|---|
| `minWeinsteinScore` | `requireStage2` | 97 | 136 | 0,713 |
| `minMinerviniScore` | `requireStage2` | 93 | 136 | 0,684 |
| `requirePriceAboveSma50` | `requireStage2` | 71 | 136 | 0,522 |
| `requireSma200Up` | `requireStage2` | 67 | 136 | 0,493 |
| `minMinerviniScore` | `minTotalScore` | 93 | 161 | 0,578 |
| `minReturnToVol3m` | `minPerf3m` | 96 | 151 | 0,636 |
| `minLatestVolume` | `minAvgVolume` | 69 | 115 | 0,600 |
| `minRiskRewardScore` | `minReturnToDrawdown3m` | 38 | 96 | 0,396 |
| `maxHighsSpreadPct` | `requireStage2` | 44 | 136 | 0,324 |
| `minRiskScore` | `minTotalScore` | 27 | 161 | 0,168 |
| `minVolumeScore` | `minTotalScore` | 32 | 161 | 0,199 |

Los tres primeros casos son estructurales y esperables: la definición de
Etapa 2 (`lib/trendStructure.js:45-53`) ya exige precio > SMA50, precio >
SMA150, precio > SMA200, SMA50 > SMA150, SMA150 > SMA200 y pendiente > 0.
Cualquier fila que falle `requirePriceAboveSma50` o `requireSma200Up`
también falla `requireStage2`. Cuando `requireStage2` está activo —balanced,
strict, nearPivot— esos dos interruptores no aportan nada.

### Pares casi idénticos

| Regla A | Regla B | \|A\| | \|B\| | Jaccard |
|---|---|---|---|---|
| `minReturnToVol3m` | `minReturnToDrawdown3m` | 96 | 96 | **0,920** |
| `minWeinsteinScore` | `minMinerviniScore` | 97 | 93 | **0,881** |
| `minPerf6m` | `minPerf12m` | 189 | 175 | 0,820 |
| `minPerf3m` | `minTotalScore` | 151 | 161 | 0,803 |
| `minTotalScore` | `requireStage2` | 161 | 136 | 0,800 |

`minReturnToVol3m` y `minReturnToDrawdown3m` seleccionan prácticamente el
mismo conjunto. Ambas son «retorno de 3 meses dividido por una medida de
riesgo»; en la práctica, el numerador manda.

### Las cuatro distancias a máximos

Sobre las 264 filas con las cuatro métricas presentes:

| Comparación | Filas idénticas | % |
|---|---|---|
| `distance52w` == `distanceATH` | 199 | **75,4 %** |
| `distance20d` == `distance50d` | 159 | 60,2 % |
| `distance20d` == `distance52w` | 108 | 40,9 % |
| las cuatro iguales | 99 | 37,5 % |

Tiene sentido: un valor en máximos históricos tiene las cuatro distancias
iguales a cero. Pero significa que en tres de cada cuatro filas
`maxDistance52w` y `maxDistanceATH` son la misma regla con dos umbrales
distintos (40 y 70 en balanced), y siempre gana el más restrictivo.

### La doble pasada del pipeline de pantalla

`lib/screenerPipeline.js` aplica el motor compartido y **después** una
segunda función con seis reglas que ya estaban aplicadas:

```js
// lib/screenerPipeline.js:276-285
function postFilterRejectReason(row, set) {
  if (set.setupMode === "weakness") return !Number.isFinite(row.weaknessScore) || row.weaknessScore >= (set.minWeaknessScore || 0) ? null : rejectReason("weakness", `Deterioro ${row.weaknessScore.toFixed(0)} < ${set.minWeaknessScore || 0}`, "minWeaknessScore");
  if ((set.minRsCountryPct || 0) > 0 && (!Number.isFinite(row.rsCountryPct) || row.rsCountryPct < set.minRsCountryPct)) return rejectReason(...);
  if ((set.minRsSectorPct || 0) > 0 && ...) return rejectReason(...);
  if ((set.minRsQualityScore || 0) > 0 && ...) return rejectReason(...);
  if ((set.minSectorScore || 0) > 0 && ...) return rejectReason(...);
  const objectiveScore = firstFinite(row.objectiveScore, row.totalScore, row.compositeScore);
  if ((set.minTotalScore || 0) > 0 && ...) return rejectReason(...);
  return null;
}
```

Las seis (`minWeaknessScore`, `minRsCountryPct`, `minRsSectorPct`,
`minRsQualityScore`, `minSectorScore`, `minTotalScore`) ya están en
`FIELD_RULES` o en la rama de weakness del motor.

Verificado sobre las 264 filas, con los presets `balanced` y `strict`:
**la segunda pasada no rechaza ni una sola fila que la primera deje pasar**
(`postOnly = 0` en ambos casos). Con `strict`, 215 filas son rechazadas por
las dos y 46 solo por la primera. Es código duplicado sin efecto observable
hoy — pero con dos diferencias latentes: usa `row.rsCountryPct` plano en
vez de la cadena `metric()`, y compara `firstFinite(objectiveScore,
totalScore, compositeScore)` en vez de la lógica de `metric(row,
"objectiveScore")`. Si las dos implementaciones divergen, ganará la más
restrictiva sin que nadie lo note.

---

# PARTE D — El efecto real

## D.1 El escaneo nocturno del 2026-08-13

```
table: scans
select: id,name,created_at,enabled:settings->screenerFilters->>enabled,preset:settings->screenerFilters->>preset
order: created_at.desc
→ 8c2b05dd-e9ef-483d-9fa4-5599ebeb49a5 | Materialized scan US 2026-08-13
  | 2026-08-13T05:03:38.193+00:00 | enabled=true | preset=balanced
```

```
table: scans
select: total:settings->progress->>total,completed:settings->progress->>completed,
        saved:settings->progress->>saved,errors:settings->progress->>errors,status:settings->progress->>status
filter: id=eq.8c2b05dd-e9ef-483d-9fa4-5599ebeb49a5
→ total=5608 completed=5608 saved=75 errors=41 status=partial
```

Lo lanza `.github/workflows/scan-universe.yml` → `scripts/scan-universe.mjs`,
que sí pasa el preset explícitamente:

```js
// scripts/scan-universe.mjs:289
const screenerFilters = screenerFiltersFromParams({ filterPreset: preset });
```

De 5.608 símbolos analizados quedaron 75 filas guardadas.

**Limitación importante:** `scan_results` solo guarda las filas que
sobreviven. Ese escaneo no escribió historial —se consultó
`scan_symbol_history` con `source_scan_id=eq.8c2b05dd-…` y devolvió 0
filas—, así que **no es posible reconstruir desde la base de datos qué
regla descartó a cada uno de los 5.533 símbolos restantes**. Lo que sigue
usa dos vías indirectas.

## D.2 Vía 1: qué margen tienen las 75 supervivientes

Re-evaluando las 75 filas del nocturno con el mismo preset `balanced`: las
75 pasan (comprobación de coherencia: el motor es determinista y reproduce
el resultado guardado). El preset evalúa **33 reglas**. Ninguna de las 33
falla. Pero el margen dice mucho:

| Regla | Umbral | «cerca del corte» | holgadas |
|---|---|---|---|
| `minReturnToVol3m` | 0,2 | **71 de 75** | 4 |
| `minUpDownVolRatio` | 0,8 | **62 de 75** | 13 |
| `minRelativeVolume` | 1 | **61 de 75** | 14 |
| `minReturnToDrawdown3m` | 0,5 | 22 de 75 | 53 |
| `maxDailyMove20dPct` | 25 | 3 | 72 |
| `minRiskRewardScore` | 35 | 3 | 72 |
| `minVolumeSurgePct` | 15 | 2 | 73 |
| `maxRange63dPct` / `maxVolatility63d` / `minAvgTurnover` / `minPerf6m` | — | 1 cada una | 74 |
| las otras 23 | — | 0 | 75 |

Tres reglas (`minReturnToVol3m`, `minUpDownVolRatio`, `minRelativeVolume`)
tienen a la mayoría de supervivientes rozando el corte: son las que están
haciendo el trabajo real de selección. Las otras veintitrés dejan pasar todo
con margen amplio.

## D.3 Vía 2: aplicar `balanced` a filas que nunca lo pasaron

Sobre P2 (189 filas de escaneos guardados sin preset — la entrada real de la
función):

**Pasan 3 de 189.**

Primer motivo de rechazo (el motor se detiene en el primero):

| Regla | Filas |
|---|---|
| `requireStage2` | 146 |
| `minRelativeVolume` | 18 |
| `minMarketCap` | 12 |
| `minAvgVolume` | 4 |
| `minPerf3m` | 3 |
| `minVolumeSurgePct` | 2 |
| `minPrice` | 1 |

Como el motor corta en la primera, ese reparto no dice cuánto pesa cada
regla. Evaluando **todas** las reglas de cada fila (con
`buildScreenerFilterExplainPlan`, que no corta) y contando cuántas filas
fallaría cada una por separado, con el umbral de `balanced`:

| Regla | Umbral | Rechaza (de 189) | % |
|---|---|---|---|
| `requireStage2` | true | 146 | 77,2 % |
| `minRelativeVolume` | 1 | 127 | 67,2 % |
| `minVolumeSurgePct` | 15 | 125 | 66,1 % |
| `minPerf6m` | 8 | 114 | 60,3 % |
| `minReturnToDrawdown3m` | 0,5 | 107 | 56,6 % |
| `minReturnToVol3m` | 0,2 | 107 | 56,6 % |
| `minPerf12m` | 12 | 95 (+1 sin dato) | 50,3 % |
| `minPerf3m` | 3 | 95 | 50,3 % |
| `longBiasFloor` | implícita | 77 | 40,7 % |
| `minMomentumScore` | 15 | 76 | 40,2 % |
| `minWeinsteinScore` | 50 | 63 | 33,3 % |
| `minMarketCap` | 200M | 45 (sin dato) | 23,8 % |
| `minAvgVolume` | 150.000 | 44 | 23,3 % |
| `minMinerviniScore` | 38 | 44 | 23,3 % |
| `minRiskRewardScore` | 35 | 42 | 22,2 % |
| `minUpDownVolRatio` | 0,8 | 34 | 18,0 % |
| `minAvgTurnover` | 1,5M | 25 | 13,2 % |
| `maxDistance52w` | 40 | 19 | 10,1 % |
| `maxDistanceATH` | 70 | 6 | 3,2 % |
| `minPrice` | 2 | 6 | 3,2 % |
| `maxDistance50dHigh` | 30 | 5 | 2,6 % |
| `maxHighsSpreadPct` | 25 | 5 | 2,6 % |
| `maxDrawdown63d` | 40 | 4 | 2,1 % |
| `maxDistance20dHigh` | 20 | 3 | 1,6 % |
| `maxDailyMove20dPct` | 25 | 1 | 0,5 % |
| `maxRange63dPct` | 120 | 1 | 0,5 % |
| **`maxDailyRange20dPct`** | 32 | **0** | 0 % |
| **`maxExtensionSma50`** | 45 | **0** | 0 % |
| **`maxVolatility63d`** | 120 | **0** | 0 % |
| **`maxPriceFreshnessDays`** | 5 | **0** | 0 % |
| **`minDataCoverageScore`** | 35 | **0** | 0 % |
| **`minTechnicalCoverageScore`** | 45 | **0** | 0 % |
| **`minRiskScore`** | 15 | **0** | 0 % |
| **`minWeaknessScore`** | 50 | **0** (omitida) | 0 % |
| **`minRsRating`** | 50 | **0** (no evaluada) | 0 % |
| las 28 restantes | neutro | **0** (no evaluadas) | 0 % |

## D.4 Clasificación por efecto, con el preset por defecto

Las cifras de abajo son de la **ruta nocturna** (preset crudo, sin capas),
que es la que produjo el escaneo del encargo. Entre paréntesis, la ruta de
la pantalla cuando difiere.

**Reglas que descartan de verdad: 26.** Son 24 controles numéricos más
`requireStage2` y la puerta implícita `longBiasFloor`. Encabezadas por
`requireStage2` (146 de 189), `minRelativeVolume` (127) y
`minVolumeSurgePct` (125). Seis de las 26 (`minRelativeVolume`,
`minVolumeSurgePct`, `minUpDownVolRatio`, `minRiskRewardScore`,
`minReturnToVol3m`, `minReturnToDrawdown3m`) solo descartan en la ruta
nocturna: en la pantalla su capa está apagada — ver D.5. Es decir, en la
pantalla son 20.

**Reglas que no descartan ninguna: 38 de 62 controles numéricos en la ruta
nocturna, 44 de 62 en la pantalla.**

- **10 con umbral neutro pero capa encendida** — la interfaz las pinta
  activas y no hacen nada: `minEpsGrowthProxyScore`,
  `minFundamentalCoverageScore`, `minRsBenchmarkRating`, `minRsCountryPct`,
  `minRsSectorPct`, `minRsQualityScore`, `minSectorScore`, `minVolumeScore`,
  `minLiquidityScore`, `minTotalScore`.
- **18 con el valor neutro dentro de capas apagadas** — no descartan en
  ninguna de las dos rutas: `minLatestVolume`, `minLatestTurnover`,
  `minVolumeEffectScore`, `minAdProxyScore`, los 2 de short float y los 12
  de estructura.
- **6 más que solo descartan en la ruta nocturna** — traen umbral en el
  preset pero su capa viene apagada en la pantalla: `minRelativeVolume`,
  `minVolumeSurgePct`, `minUpDownVolRatio`, `minRiskRewardScore`,
  `minReturnToVol3m`, `minReturnToDrawdown3m`. Son la diferencia entre 38 y
  44.
- **7 con umbral activo que no llegaron a descartar nada** en las 189
  filas: `maxDailyRange20dPct`, `maxExtensionSma50`, `maxVolatility63d`,
  `maxPriceFreshnessDays`, `minDataCoverageScore`,
  `minTechnicalCoverageScore`, `minRiskScore`. Para separar «umbral laxo»
  de «regla inerte» se repitió la medición con el umbral de `strict`, en
  aislado, sobre las mismas 189 filas:

  | Regla | Umbral `strict` | Rechaza |
  |---|---|---|
  | `minRiskScore` | 50 | 30 |
  | `maxVolatility63d` | 60 | 16 |
  | `maxDailyRange20dPct` | 16 | 2 |
  | `maxExtensionSma50` | 25 | 2 |
  | `maxPriceFreshnessDays` | 5 | **0** |
  | `minDataCoverageScore` | 50 | **0** |
  | `minTechnicalCoverageScore` | 70 | **0** |

  Las cuatro primeras son umbrales laxos en `balanced`, no reglas muertas.
  Las tres últimas no muerden ni con el preset más exigente sobre esta
  población — aunque `maxPriceFreshnessDays` sí rechazó 1 fila (CRH.L) en
  las 1.000 de P3, así que funciona; simplemente casi nunca se activa
  porque el escáner ya descarta el precio viejo antes.
- **3 que no pueden descartar por falta de dato**: `minRsRating` (nunca
  evaluada), `maxIpoAgeMonths` (inerte con `requireRecentIpo: false`) y
  `minWeaknessScore` (omitida fuera del modo weakness).

**Reglas que descartan todo (fallo).** `requireRecentIpo` en el preset
`ipo`: 0 filas pasan en las tres poblaciones. Y `contractionStructureStatus`
cuando se activa la familia «Estructura»: con los ajustes de «Contracción
progresiva» (`FILTER_FAMILY_PRESETS.pattern.actions[0]`), de 264 filas pasan
**4**, y el motivo dominante es la puerta de validez (136 filas), no los
umbrales de profundidad:

| Motivo | Filas |
|---|---|
| `contractionStructureStatus` (estructura invalidada) | 136 |
| `longBiasFloor` | 77 |
| `minContractionCount` (< 3) | 41 |
| `maxVolumeDryUpRatio` | 3 |
| `maxAbsDistanceToPivotPct`, `maxContraction1DepthPct`, `maxContraction2DepthPct` | 1 cada uno |

## D.5 El mismo preset filtra distinto de noche que de día

Este es el hallazgo con más consecuencias prácticas.

> **Corregido el 2026-08-14.** Las catorce capas arrancan encendidas
> (`FILTER_LAYERS_CONTRACT_VERSION = 2`), `PRESET_LAYER_OVERRIDES` está vacío y
> la pantalla aplica el preset crudo, igual que el cron. Sobre estas mismas 264
> filas las dos rutas dan ahora 78 y 78, y coinciden en los siete presets. Lo
> que sigue describe el estado anterior.

- El **escaneo nocturno** usa el preset crudo:
  `screenerFiltersFromParams({ filterPreset: "balanced" })`. No hay capas.
- La **pantalla** usa el preset pasado por las capas:
  `effectiveSettingsFromLayers(settings, filterLayers, fieldRules)`
  (`app/page.jsx:199`). Y cuatro capas vienen apagadas de fábrica.

Diferencias de ajuste efectivo, con el mismo preset `balanced`:

| Regla | Escaneo nocturno | Pantalla |
|---|---|---|
| `minRelativeVolume` | 1 | 0 (neutro) |
| `minVolumeSurgePct` | 15 | −999 (neutro) |
| `minUpDownVolRatio` | 0,8 | 0 (neutro) |
| `minRiskRewardScore` | 35 | 0 (neutro) |
| `minReturnToVol3m` | 0,2 | −999 (neutro) |
| `minReturnToDrawdown3m` | 0,5 | −999 (neutro) |

Resultado sobre las mismas 264 filas de P1+P2:

| Ruta | Pasan |
|---|---|
| Nocturno (preset crudo) | **78** |
| Pantalla (preset + capas por defecto) | **91** |

Trece filas de 264 (un 5 %) entran o no según por dónde se mire. Dos de esas
seis reglas (`minRelativeVolume`, `minVolumeSurgePct`) están entre las tres
más selectivas del preset. Dicho de otro modo: el escaneo nocturno aplica
seis reglas que la pantalla dice tener apagadas, y ninguna interfaz declara
esa diferencia.

## D.6 Lo que la interfaz dice que está activo

Con el preset por defecto y las capas de fábrica:

- **44 reglas de ejecución** (suma de `count` de las 9 capas encendidas, más
  la de régimen). El total declarado es 70.
- **38 de 62 controles finos** marcados como activos.
- Pero el motor solo **evalúa 33 reglas**, y de esas 33 una
  (`minWeaknessScore`) se omite y se contabiliza igualmente como pasada.

Los números de `EXECUTION_LAYERS` son constantes escritas a mano
(`count: 3`, `count: 4`, …) que nadie compara contra el catálogo real. Por
ejemplo, la capa «Estructura» declara 13 reglas y el grupo de interfaz tiene
12 controles más el interruptor de contracciones; la capa «RS» declara 6 y
`minRsRating` no funciona.

---

# PARTE E — El veredicto

## E.1 Clasificación

### INVERTIDA (el operador es el contrario del que debería)

**Ninguna.** Se han revisado las 62 reglas y las 18 que miden magnitudes
donde «más es peor» comparan todas en el sentido correcto.

El caso que motivó esta auditoría, `minWeaknessScore`, **no está
invertido**: su operador es el correcto para el único preset que lo usa
(«Deterioro técnico», que busca deterioro alto a propósito). Está mal
*colocado*, no mal *orientado*, y se clasifica abajo.

### MUERTA (compara un campo ausente o no calculado) — 3 reglas

| Regla | Por qué | Evidencia |
|---|---|---|
| **`minRsRating`** | Exige `row.weeklyRsAvailable === true`, campo que solo añade `attachWeeklyRs` al **leer** el escaneo, nunca al producirlo. En el escaneo nocturno la regla no se evalúa. | 264 filas de P1+P2 y 1.000 de P3: **0 evaluaciones** con umbral 50 o 75. `weeklyRsAvailable` ausente en 264/264. |
| **`requireRecentIpo`** | `ipoAgeMonths` nulo e `ipoDate` vacío en el 100 % de las filas. `isRecentIpo` devuelve siempre `false`: no filtra, **rechaza todo**. | Preset `ipo`: 0 de 75, 0 de 189 y 0 de 1.000 pasan. Primer motivo en 58/75 y 76/97. |
| **`maxIpoAgeMonths`** | Mismo campo ausente, y además solo se consulta dentro de `requireRecentIpo` (false en 6 de 7 presets). Control visible, capa encendida, efecto nulo. | 0 rechazos en P1+P2 con umbral 60. |

### APAGADA POR DISEÑO, VISIBLE COMO ACTIVA — 1 regla

| Regla | Diagnóstico |
|---|---|
| **`minWeaknessScore`** | Correcta en el preset `weakness` (verificado: acepta deterioro 100, rechaza deterioro 0). En los otros **seis presets** trae valor 50 desde `QUALITY_DEFAULTS`, el motor la omite por la guarda `mode === "weakness"`, y sin embargo `isFieldRuleActive` la pinta activa y `addRule` la suma al contador de reglas activas y a la lista de pasadas. Riesgo abierto: por URL, `?filterPreset=balanced&setupMode=weakness` produce un screener «Balanceado» que solo devuelve valores deteriorados. |

### REDUNDANTE (otra regla ya hace lo mismo) — 14 reglas

| Regla | Redundante con | Evidencia |
|---|---|---|
| `requirePriceAboveSma50` | `requireStage2` | 71 ⊆ 136; Etapa 2 ya exige precio > SMA50 |
| `requireSma200Up` | `requireStage2` | 67 ⊆ 136; Etapa 2 ya exige pendiente > 0 |
| `minWeinsteinScore` | `requireStage2` | 97 ⊆ 136, Jaccard 0,713 |
| `minMinerviniScore` | `requireStage2` y `minWeinsteinScore` | 93 ⊆ 136; Jaccard 0,881 con Weinstein |
| `minReturnToVol3m` | `minReturnToDrawdown3m` | Jaccard **0,920** |
| `minLatestVolume` | `minAvgVolume` | 69 ⊆ 115 |
| `maxDistanceATH` | `maxDistance52w` | métricas idénticas en 199 de 264 filas (75,4 %) |
| `minRiskScore`, `minVolumeScore` | `minTotalScore` | 27 ⊆ 161, 32 ⊆ 161 |
| `minRsCountryPct`, `minRsSectorPct`, `minRsQualityScore`, `minSectorScore`, `minTotalScore` (5 de las 6 de `postFilterRejectReason`; la sexta, `minWeaknessScore`, va aparte) | el motor compartido | 264 filas, 2 presets: la segunda pasada rechaza **0** filas que la primera deje pasar |

Nota: redundante no siempre es malo. `requirePriceAboveSma50` sí tiene
sentido en un preset donde `requireStage2` esté apagado. Lo que sobra es
tenerlas las dos activas a la vez, y que la interfaz cuente ambas.

`minRiskScore` está aquí y no en INCIERTA porque su conjunto de rechazo
está contenido en el de `minTotalScore` (27 ⊆ 161); que además no descarte
nada con el umbral de `balanced` es un dato aparte, recogido en D.4.

### INCIERTA — 3 reglas

`maxPriceFreshnessDays`, `minDataCoverageScore`, `minTechnicalCoverageScore`.
No descartan nada ni con el umbral de `balanced` ni con el de `strict` sobre
las 189 filas de P2. No puedo distinguir «umbral laxo» de «regla inerte»,
porque P2 ya pasó el cribado base del escáner (`minPrice 1`,
`minAvgTurnover 250.000`, `minMarketCap 300M`, `minCoverageScore 40`), que
solapa con las tres. La única señal a favor de que funcionan:
`maxPriceFreshnessDays` sí rechazó una fila (CRH.L) en las 1.000 de P3.

### CORRECTA — el resto (50 reglas)

Hacen lo que su nombre promete, con el operador adecuado. Seis de ellas
tienen una etiqueta mejorable (B.5) y seis se comportan de forma distinta en
la ruta nocturna que en la pantalla (D.5), pero el operador es correcto en
todas.

### Recuento

| Clasificación | Reglas |
|---|---|
| CORRECTA | 50 |
| REDUNDANTE | 14 |
| MUERTA | 3 |
| INCIERTA | 3 |
| APAGADA POR DISEÑO, VISIBLE COMO ACTIVA | 1 |
| INVERTIDA | **0** |
| **Total** | **71** (62 controles + 6 interruptores + 3 puertas implícitas) |

## E.2 Orden de gravedad

Ordenado por daño real: primero lo que produce resultados falsos sin que
nadie lo note.

**1 — `requireRecentIpo` / `maxIpoAgeMonths` rechazan el 100 %.** El preset
«IPO / nuevos líderes» devuelve cero filas siempre, en las tres poblaciones
medidas. Un preset entero del producto no funciona, y su modo de fallo es
silencioso: parece que no hay candidatos.

**2 — `minRsRating` no se evalúa nunca en el escaneo nocturno.** El preset
anuncia «RS min 50» (75 en `strict`) y ese criterio simplemente no existe en
la ruta que produce los datos que ve el usuario. Es la regla que el usuario
más asocia con la metodología, y es la que menos hace.

**3 — El mismo preset filtra distinto de noche que de día.** Seis reglas
actúan en el escaneo nocturno y no en la pantalla; 13 de 264 filas cambian
de lado. Un usuario que compare la tabla con lo que guardó el cron verá
diferencias que no puede explicar.

**4 — `minWeaknessScore`: visible, con valor 50, y sin efecto en seis de
siete presets.** No produce resultados falsos hoy, pero produce una lectura
falsa de la configuración, y la ruta por URL puede convertirla en un fallo
real.

**5 — Las reglas de RS y short float filtran por ausencia de dato.** Si se
activan, entre el 34 % y el 65 % de los rechazos son por «sin dato», no por
el criterio. Contradice el principio 3 de producto.

**6 — 10 controles visibles y activos con valor neutro.** Ruido de
interfaz: el usuario cree tener diez criterios más de los que tiene.

**7 — La doble pasada de `postFilterRejectReason`.** Hoy no cambia ningún
resultado (0 rechazos exclusivos sobre 264 filas × 2 presets), pero mantiene
dos implementaciones de las mismas seis reglas que pueden divergir.

**8 — Redundancias estructurales** (`requirePriceAboveSma50` y
`requireSma200Up` bajo `requireStage2`, `maxDistanceATH` con
`maxDistance52w`, `minReturnToVol3m` con `minReturnToDrawdown3m`). No
producen error, sí inflan el recuento de criterios.

**9 — Etiquetas engañosas** (`minRsRating` etiquetada con la métrica
equivocada, `minTotalScore` que compara `objectiveScore`, `minRiskScore`).
Se arreglan en el texto, no en el operador.

---

# CONFIANZA

## Verificado ejecutando el motor real sobre datos de producción

- Las 264 filas de P1+P2 y las 1.000 de P3 se pasaron por
  `screenerFilterRejectReason` y `buildScreenerFilterExplainPlan` importadas
  de `lib/screenerFilters.js` bajo Vitest (el loader plano de
  `scripts/loader.mjs` no sirve: la cadena de imports llega a
  `app/components/ui/MetricSource.jsx`, que es JSX). No se reimplementó
  ninguna regla.
- Los siete presets se evaluaron sobre las tres poblaciones.
- El aislamiento regla a regla se hizo con `buildScreenerFilterExplainPlan`,
  que evalúa todas las reglas activas sin cortar en la primera que falla.
  El primer intento, hecho con `screenerFilterRejectReason` (que sí corta),
  daba cifras contaminadas por `longBiasFloor`; se descartó.
- La comparación nocturno/pantalla se hizo llamando a
  `effectiveSettingsFromLayers(settingsForPreset("balanced"), filterLayersForPreset("balanced"), DEFAULT_FIELD_RULES)`,
  la misma función que usa `app/page.jsx:199`.
- Los conteos de reglas, capas y presets salen de leer
  `lib/screenerFilterCatalog.js` en ejecución, no de contar a ojo.

## Verificado leyendo código

- Las citas literales de este informe se copiaron del archivo en `99b7b13`.
- El recorrido de `minRsRating` (dónde se hidrata `weeklyRsAvailable`) se
  siguió con grep exhaustivo: solo `lib/globalRs.js:152` lo escribe, y solo
  se llama desde `app/api/scans/route.js:255`, `app/api/discovery/route.js:70`
  y `app/page.jsx:1087` (búsqueda rápida). `lib/materializedScanner.js` no
  lo llama.
- El preset del escaneo nocturno se confirmó en dos sitios: el código
  (`scripts/scan-universe.mjs:289`) y el dato guardado
  (`scans.settings.screenerFilters.preset = "balanced"`, `enabled = true`).

## Verificado con datos de Supabase (solo lectura)

Todas las consultas de este informe están citadas en el punto donde se usan.
Las cinco descargas de datos fueron:

```
scan_results · scan_id=eq.8c2b05dd-… · select symbol,rank_index,raw · 75 filas (2 consultas)
scan_results · scan_id=eq.75af44c8-… · select symbol,rank_index,raw · 97 filas (2 consultas)
scan_results · scan_id=in.(17 escaneos con enabled=false) · select symbol,rank_index,metrics,+6 campos de raw · 189 filas
scan_results · scan_id=eq.dd54b3fc-… · 5 tramos de rank_index (1-200, 2401-2600, 4901-5100, 7401-7600, 9700-9899) · 1.000 filas
scan_symbol_history · source_scan_id=eq.8c2b05dd-… · 0 filas
```

Los ficheros de resultado se procesaron íntegros con Python (parseo completo
del JSON, no lectura parcial); ningún fichero se resumió a partir de una
lectura truncada.

---

# LO QUE NO HE VERIFICADO

**La configuración guardada con once de catorce capas apagadas.** No está en
Supabase. `app_settings` solo tiene entradas de `jobs` y
`company_brief_cache`; `scans.settings.filterLayers` viene `null` en los
cinco escaneos de servidor más recientes. Esa configuración vive en el
navegador del usuario (`localStorage`/`sessionStorage`, ver
`lib/localState.js`) y no la he podido inspeccionar. Lo que sí está
verificado es el estado de fábrica: **cuatro de catorce apagadas**.

**Qué regla descartó a cada uno de los 5.533 símbolos del nocturno.** No es
reconstruible: `scan_results` guarda solo supervivientes y ese escaneo no
escribió `scan_symbol_history`. Las cifras de la Parte D salen de aplicar el
preset a poblaciones equivalentes, no al conjunto exacto que el cron
descartó. Los porcentajes de D.3 son de 189 filas, no de 5.608.

**El tamaño de la muestra.** P2 tiene 189 filas de mercados variados
(GB, SG, ZA, IT, ES, CA, US, DE, FR, NL, TW, FI, DK, NO, SE, JP, BE, PT, AT,
IE, HK, AU) y ya pasó el cribado base del escáner. No es una muestra
aleatoria del universo: es lo que sobrevivió a `minPrice 1`,
`minAvgTurnover 250.000`, `minMarketCap 300M` y `minCoverageScore 40`. Las
tasas de rechazo de D.3 están sesgadas a la baja para las reglas de liquidez
y cobertura.

**Las siete reglas INCIERTAS.** Con más población podría decidirse si son
laxas o inertes. Con lo medido, no.

**La interfaz en ejecución.** No he abierto el navegador ni hecho capturas.
Las afirmaciones sobre lo que ve el usuario (contadores de reglas activas,
control de deterioro pintado como activo) salen de leer
`isFieldRuleActive`, `addRule` y los componentes de
`lib/screenerFiltersView.jsx` y `app/components/screener/ScreenerShell.jsx`,
no de verlo renderizado.

**Los tres filtros de régimen de mercado.** `regimeRejectReason`
(`lib/scoring.js:150-158`) es una capa aparte, con su propio interruptor, y
solo actúa en la pantalla (no en el escaneo nocturno). No entra en las 62
reglas del encargo y no la he auditado con datos: haría falta el
`marketHealth` del momento, que no se persiste con el escaneo.

**Las acciones de exigencia de `FILTER_FAMILY_PRESETS`.** Son 40 botones que
sobreescriben ajustes desde la interfaz. Solo he medido una
(«Contracción progresiva», en D.4). Las otras 39 no se han auditado.

**El pipeline del cliente completo.** He auditado `postFilterRejectReason`.
`qualityGateForResearchRow` (que exige 180 barras de histórico y precio > 0)
y `regimeRejectReason` corren antes y después, y sus rechazos no están
contabilizados en las cifras de la Parte D.
