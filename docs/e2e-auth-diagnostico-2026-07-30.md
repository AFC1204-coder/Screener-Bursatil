# Diagnóstico y fix de autenticación en la suite E2E — 2026-07-30

MODEL: claude-sonnet-5
BASE_SHA: 3df6d05d82612af6bda21fc11daca2481ded495f

## Situación de partida

`npm run test:e2e` daba 16 fallos de 17. El único test en verde era
`tests/e2e/stockChartRangeSequence.e2e.mjs`, porque era el único que hacía
login manualmente (`POST /api/auth/session` con `STATSEDGE_ACCESS_TOKEN` leído
de `.env.local`). Los otros 16 tests nunca autenticaban su `context` de
Playwright y se quedaban atascados en `AuthGate` (pantalla "Acceso a
StatsEdge — Introduce el token privado...").

## Causa raíz

`scripts/e2e/run.mjs` crea un `browser.newContext()` distinto por cada spec
(línea ~94) y nunca autenticaba ese contexto antes de invocar `spec.run(...)`.
El único test que pasaba llevaba su propia lógica de login duplicada dentro
del spec, en vez de compartir un mecanismo centralizado en el runner.

## Cambio implementado

1. **`scripts/e2e/run.mjs`**: se añadió `accessToken()` (lee
   `STATSEDGE_ACCESS_TOKEN` de `.env.local`, mismo parsing que ya existía en
   `stockChartRangeSequence.e2e.mjs`) y `login(context)` (mismo `POST
   /api/auth/session` que ya funcionaba). Se invoca `await login(context)`
   justo después de crear cada `newContext()`, antes de `spec.run(...)`. Así
   **todos** los specs arrancan con la sesión ya autenticada, sin que cada
   test tenga que reimplementar el login.
2. **`tests/e2e/stockChartRangeSequence.e2e.mjs`**: se eliminó su login manual
   duplicado (import de `readFileSync`, `accessToken()`, y el bloque
   `context.request.post(...)` dentro de `run()`), porque ahora ese trabajo lo
   hace el runner centralizado. El resto del test (mocks de rutas, navegación,
   aserciones de rango) queda intacto.

No se tocó ningún archivo de `app/` ni `lib/`. No se usó `.skip`/`.only` ni se
debilitó ninguna aserción.

## Resultado tras el fix

**5 de 17 tests pasan** (antes: 1 de 17). Ninguno de los 12 fallos restantes
muestra la pantalla de login — verificado con `grep -c "Acceso a
StatsEdge\|token privado"` sobre el log crudo → **0 coincidencias**. Los 12
fallos restantes son reales (bugs de producto o de test), documentados abajo
sin tocarlos.

### Output crudo de la suite (tras el fix)

```
> test:e2e
> node --import ./scripts/refactor-check/register.mjs scripts/e2e/run.mjs

(node:67445) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
· arrancando dev server...
✗ navegación del gráfico conserva contexto manual: Tras hacer zoom: esperaba vista manual, recibí {"stateText":"Último dato","stateClass":"universalChartViewState ","visibleBars":null,"scopeText":"1A · D","viewportText":"ModoÚltimo datoVentana24 mar 2026 - 29 jul 2026BarrasSin dato","viewportMode":"unknown","viewportManual":"false","viewportWindow":"24 mar 2026 - 29 jul 2026"}
✗ filtro por salud de datos: No encontré el filtro compacto de salud de datos en la fila STALE
✗ filtro por pruebas de decisión: Mostrar resumen clicable de pruebas no ocurrió. Texto visible: ★ 1 BD BLOCK 🇺🇸 G 91 GRP 84 Q 80 3M - 6M - 52W - RV - A/D 76 EF. 78 86 Revisar datos · Muy baja +14 ★ 2 RC READY 🇺🇸 G 91 GRP 84 Q 80 3M - 6M - 52W - RV - A/D 76 EF. 78 86 Candidato largo · Alta +6 ★ 3 CF CHECK 🇺🇸 G 74 GRP 71 Q 52 3M - 6M - 52W - RV - A/D 50 EF. 69 82 Candidato largo · Media +9
✗ filtro por incidencia desde badge de fila: No encontré badge de evidencia incompleta
✓ trazabilidad de decisiones en research y listas (11.4s)
✗ favoritos en research-desk: page.fill: Timeout 30000ms exceeded.
✓ filtros de vista sobre resultados restaurados (11.0s)
✓ market health marca métricas proxy del snapshot (1.8s)
✗ trabajo pendiente conserva contexto hasta ficha: Abrir Vista rápida con origen Trabajo pendiente no ocurrió. Texto visible: StatsEdge EQUITY RESEARCH Screener Listas Sectores Research Mercado STATSEDGE · SCREENER Global Leaders Exploratorio amplio · 1 mercados · 1 resultados visibles Ejecutar ESTADO Trabajo pendiente: 1 pendientes priorizadas. MUESTRA PARCIAL · PERCENTIL POR LOTE MUESTRA PARCIAL DESCUBRIMIENTO GLOBAL CURADO No es un ranking global comparable. Reúne filas publicables con percentil por lote y las ordena con señales absolutas por símbolo. No se puede confirmar la disponibilidad de candidatas curadas ahora; no se concluye que no existan candidatas. La cobertura por mercado se mantiene como contexto independiente. ‹ 2 UNIVERSO 2 PASAN - SCORE FILTRO EDITABLE Base Exploratorio amplio Bases opcionales 7 Mis plantillas 0 guardadas MERCADOS 1/29 Global EE. UU. Europa Asia HK Cargar universo 🇺🇸 US
✗ filtro por fiabilidad de observación: Mostrar panel de auditabilidad interna no ocurrió. Texto visible: ★ 1 BS BLOCK 🇺🇸 G 91 GRP 84 Q 80 3M - 6M - 52W - RV - A/D 76 EF. 78 75 Revisar datos · Muy baja +9 ★ 2 VP VAL 🇺🇸 G 91 GRP 84 Q 80 3M - 6M - 52W - RV - A/D 76 EF. 78 75 Revisar datos · Muy baja +9 ★ 3 RO REL 🇺🇸 G 91 GRP 84 Q 80 3M - 6M - 52W - RV - A/D 76 EF. 78 75 Candidato largo · Alta +1
✗ restore (sesión local + snapshot Supabase): page.waitForFunction: Timeout 45000ms exceeded.
✗ review a ficha con contexto de decision: page.waitForFunction: Timeout 20000ms exceeded.
✗ filtro por auditoría de score: No encontré el filtro compacto de score audit en la fila MIS
✗ screener vista rápida a ficha con foco Review: No encontré el filtro de prioridad Validar primero en el Screener
✓ sectores marca métricas proxy en filas (2.1s)
✗ scan server-side desde la UI: El scan completó pero la tabla no muestra ningún símbolo del universo
✓ gráfico de ficha actualiza tres rangos consecutivos (2.9s)
E2E: 12 fallo(s) de 17
```

## Clasificación de los 12 fallos restantes

Investigados leyendo cada spec y el código de producto correspondiente
(componentes en `app/`, `lib/`), sin modificar nada. Reproducidos en vivo
cuando fue posible.

| # | Test | Veredicto | Causa |
|---|------|-----------|-------|
| 1 | `chartNavigation.e2e.mjs` | **BUG DE PRODUCTO** | El zoom (`actions.zoom(0.72)` en `app/UniversalPriceChart.jsx:118` → `lib/chartViewportLifecycle.js:269`) no transiciona el estado de vista a "manual"; `universalChartViewState` sigue mostrando "Último dato" tras el zoom real |
| 2 | `dataHealthFilter.e2e.mjs` | BUG DE TEST | Busca `.dataHealthBadge.compactTrustFilter` por fila en `CompactResultsTable`; ese badge por fila se retiró intencionalmente en el commit `26596c0` ("compact table row with aggregated trust badge"). El filtro equivalente vive ahora en `DataHealthSummaryRail` dentro de `DecisionGroups.jsx` |
| 3 | `decisionEvidenceFilter.e2e.mjs` | BUG DE TEST | `DecisionEvidenceSummaryRail` vive dentro de un `<details>` ("Auditoría y datos") colapsado por defecto (`lib/screenerAtoms.jsx`, `defaultOpen=false`). El test nunca hace click en el `<summary>` antes de leer el texto, así que `innerText` devuelve vacío |
| 4 | `decisionIssueFilter.e2e.mjs` | BUG DE TEST | Mismo patrón que #2: `decisionIssueBadge` por fila (`lib/screenerAtoms.jsx:80`) retirado de `CompactResultsTable` en el mismo refactor `26596c0` |
| 5 | `favorites.e2e.mjs` | BUG DE TEST | El textarea/formulario de favoritos manuales en `/research-desk` está dentro de un `<details className="card researchDeskTools">` colapsado por defecto (`app/research-desk/page.jsx:736`). El test intenta `page.fill` sin abrir el `<summary>` "Herramientas de mantenimiento" antes |
| 6 | `pendingWorkReviewContext.e2e.mjs` | BUG DE TEST | El test busca `.pendingDecisionWorkActions button`; el JSX actual usa `.decisionRailAction` (`lib/screenerDomains/decision.jsx:223`). La clase vieja quedó como CSS huérfano en `styles/screener.css:7230` — vale la pena limpiarla aparte |
| 7 | `reliabilityFilter.e2e.mjs` | BUG DE TEST | Mismo `<details>` "Auditoría y datos" colapsado que #3; `AuditabilitySummaryRail` no es visible hasta abrirlo |
| 8 | `restore.e2e.mjs` | BUG DE TEST | El spec crea un **segundo** `context` (`fresh = await context.browser().newContext(...)`, línea 26) para simular sesión vacía, pero nunca lo autentica — el login centralizado del runner solo cubre el `context` original que recibe cada spec |
| 9 | `reviewStockContext.e2e.mjs` | **AMBIGUO** | Dos causas: (a) `text-transform:uppercase` en CSS (`styles/components.css:5892-5899`) transforma el `innerText` del `sourceLabel`, y el `.includes(...)` del test compara contra el texto sin mayúsculas — bug de test claro; (b) el test también busca `.screenerOriginPanel`/`.screenerOriginReviewFocus`, que no se renderizan en `/stock/[symbol]` (el import de `ScreenerOriginPanel` en `StockClient.jsx` está muerto, solo se usa en `QuickReviewModal.jsx`). Info equivalente sí existe vía `StockDecisionDesk`, pero no queda claro si `ScreenerOriginPanel` debía seguir viviendo en la ficha o si fue reemplazado intencionalmente — a confirmar con el equipo |
| 10 | `scoreAuditFilter.e2e.mjs` | BUG DE TEST | Mismo patrón que #2/#4: `.scoreAuditMini.compactTrustFilter` (`lib/screenerDomains/audit.jsx:118`) ya no se renderiza por fila en `CompactResultsTable` |
| 11 | `screenerQuickReviewStock.e2e.mjs` | BUG DE TEST | Busca `select[aria-label="Filtrar por prioridad de investigacion"]`, que solo existe en la vista **móvil** (`lib/screenerMobile.jsx:153`). El desktop reemplazó los `<select>` de filtro por rails clicables (`ReviewPriorityResultRail`, `app/components/screener/ReviewWidgets.jsx:14`) — documentado explícitamente en un comentario de `ScreenerShell.jsx:615-617` |
| 12 | `serverScan.e2e.mjs` | **RECLASIFICADO 2026-07-30 → BUG DE PRODUCTO** (ver abajo) | El scan corrió correctamente contra datos reales/en vivo (`providerErrors: []`, 6 símbolos analizados). El motor los rechaza porque el filtro `minRsRating: 50` exige `rsGlobalPct` finito, pero con un universo de 6 símbolos `enrichRelativePercentiles` no puede calcular `rsGlobalPct` (`RS_GLOBAL_MIN_SAMPLE = 20`). Resultado: las 6 filas se rechazan con "RS universo sin dato < 50", no por condición de mercado ni por filtro de tendencia. Ver "Reclasificación #12" abajo |

### Resumen

- **2 bugs de producto reales**: el zoom del gráfico no activa la vista manual
  (`chartNavigation.e2e.mjs`) y el filtro `minRsRating: 50` rechaza todo
  escaneo con universo menor que `RS_GLOBAL_MIN_SAMPLE = 20`, incluso cuando
  las filas limpian todos los demás umbrales del preset (`serverScan.e2e.mjs`
  — ver reclasificación abajo).
- **1 caso ambiguo**: mezcla de test frágil (case-sensitivity sobre
  `text-transform`) y una posible deuda de refactor sin confirmar
  (`ScreenerOriginPanel` con import muerto en la ficha).
- **9 bugs de test**, casi todos por el mismo patrón raíz: refactors legítimos
  de UI (badges de filtro por fila consolidados en un badge agregado;
  `<details>` colapsados por defecto para "Auditoría y datos" y "Herramientas
  de mantenimiento"; `<select>` de filtro reemplazados por rails clicables en
  desktop) que no se reflejaron en los selectores de los E2E cuando se hicieron
  esos cambios.

No se corrigió ninguno de estos 12 fallos — quedan documentados para que se
prioricen aparte, según instrucción explícita de la tarea.

## Reclasificación #12 (2026-07-30, sesión posterior): BUG DE PRODUCTO

La justificación original ("el motor rechazó legítimamente los 6 tickers...
condición de mercado del día") citaba datos de ejecución (`providerErrors:
[]`, "6 símbolos analizados") que no quedaron guardados en ningún artefacto
del repo — a diferencia de los otros 11 hallazgos de esta tabla, ninguno
verificable después del hecho. Se re-ejecutó el spec instrumentado
(`page.on("response", ...)` capturando `/api/scan*` en vivo) para verificar
con evidencia reproducible.

**Confirmado: el escaneo funcionó perfecto — 6/6 símbolos analizados, 0
errores de proveedor.** El texto visible tras completar decía literalmente
`Completado: 0 pasan Balanceado · muestra 6/6 (100%)`. El rechazo es 100%
del filtro, no un fallo de datos — hasta ahí, la clasificación original
acertaba. Pero el motivo era otro. Scores reales de `scan_results` para esa
corrida exacta (`scan_id: 9f2ff675-b2d3-484a-b037-cc27e051c0f5`):

| Symbol | Weinstein | Minervini | RS | WeaknessScore | ¿Limpia Weinstein≥50 / Minervini≥38 / RS≥50? |
|---|---|---|---|---|---|
| AAPL | 100 | 100 | 76 | **0** | Sí, sí, sí — **rechazado igualmente** |
| GOOGL | 68 | 62 | 58 | **29** | Sí, sí, sí — **rechazado igualmente** |
| MSFT | 0 | 8 | 30 | 97 | No — rechazo legítimo (Stage 4 real) |
| META | 0 | 6 | 31 | 100 | No — rechazo legítimo (Stage 4 real) |
| NVDA | 68 | 50 | 42 | 67 | RS 42<50 — rechazo por RS, defendible con universo de 6 |
| AMZN | 60 | 50 | 36 | 79 | RS 36<50 — rechazo por RS, defendible con universo de 6 |

AAPL y GOOGL limpian todos los umbrales de tendencia/RS por márgenes amplios
y aun así quedan fuera. El motivo es **`minRsRating`**, no `minWeaknessScore`.

### Atribución anterior (descartada)

Una versión previa de esta sección atribuía el rechazo al filtro
`minWeaknessScore`, citando `lib/screenerFilters.js:747-748` como:

```js
const minWeakness = Math.max(35, finite(set.minWeaknessScore) ?? 0);
if (!Number.isFinite(weak) || weak < minWeakness) return reject("minWeaknessScore", ...);
```

La cita recoge líneas reales del código tal como estaba cuando se redactó
este diagnóstico, pero la lectura original perdió de vista el contexto. El
error fue de **encuadre**, no de invención:

1. **El suelo `Math.max(35, ...)` sí existía y era un defecto real, pero
   no era la causa del rechazo de AAPL.** La línea
   `lib/screenerFilters.js:747` decía
   `const minWeakness = Math.max(35, finite(set.minWeaknessScore) ?? 0);`.
   El suelo `35` anulaba la intención del preset de diagnóstico "Abrir
   scores" (`lib/screenerFilterCatalog.js:472`), que fija
   `minWeaknessScore: 0` para indicar "sin restricción". El código de
   aplicación del filtro lo convertía en `35` y, por tanto, ignoraba esa
   configuración. Ese suelo se eliminó en un cambio posterior del propio
   `lib/screenerFilters.js`, junto con el tratamiento del dato ausente.
   Sin embargo, **no explica el rechazo de AAPL**: aunque el suelo
   existiera, el bloque que lo usa está guardado tras
   `if (mode === "weakness")`, y el preset `balanced` que se ejecutó en
   la corrida `9f2ff675` usa `setupMode: "leader"` (heredado de
   `QUALITY_DEFAULTS`, `lib/screenerFilterCatalog.js:105`). Con ese modo
   la guarda de `weakness` **nunca se evalúa**. Por tanto, aunque el
   `Math.max(35, ...)` era un bug real, no era la causa de la fila
   rechazada. Lo mismo ocurre en el segundo pipeline,
   `lib/screenerPipeline.js:264-265`, que también está guardado tras
   `setupMode === "weakness"`.

2. **El bloque entero está guardado tras `mode === "weakness"`.** La
   condición completa, `lib/screenerFilters.js:747-752`, era:
   ```js
   if (mode === "weakness") {
     const weak = weaknessFilterValue(row);
     const minWeakness = Math.max(35, finite(set.minWeaknessScore) ?? 0);
     if (!Number.isFinite(weak) || weak < minWeakness) return reject("minWeaknessScore", `deterioro ${Number.isFinite(weak) ? weak.toFixed(0) : "sin dato"} < ${minWeakness}`);
     return "";
   }
   ```
   El preset `balanced` usa `setupMode: "leader"` (heredado de
   `QUALITY_DEFAULTS`, `lib/screenerFilterCatalog.js:105`). Con ese modo la
   guarda de `weakness` **nunca se evalúa**. Lo mismo ocurre en el segundo
   pipeline, `lib/screenerPipeline.js:264-265`, que también está guardado
   tras `setupMode === "weakness"`.

La atribución previa fue una **deducción estática a partir de un fragmento
de dos líneas**, sin leer el `if (mode === "weakness")` que lo precede ni
el `setupMode` del preset que se estaba ejecutando. **No existe ningún
artefacto que registre `field: "minWeaknessScore"` para AAPL en
`scan_results` de la corrida `9f2ff675`.**

### Causa real (verificada leyendo código)

El rechazo lo produce `minRsRating`, en `lib/screenerFilters.js:737-741`:

```js
const minRsRating = finite(set.minRsRating);
if (Number.isFinite(minRsRating) && minRsRating > 0) {
  const rs = metric(row, "rsGlobalPct");
  if (!Number.isFinite(rs) || rs < minRsRating) return reject("minRsRating", `RS universo ${Number.isFinite(rs) ? rs.toFixed(0) : "sin dato"} < ${minRsRating}`);
}
```

`minRsRating: 50` está activo en `QUALITY_DEFAULTS`
(`lib/screenerFilterCatalog.js:123`) y por tanto en `balanced`
(`lib/screenerFilterCatalog.js:168`). La guarda exige `rsGlobalPct >= 50`
y rechaza con `"RS universo sin dato < 50"` cuando el campo no es finito.

El dato falta por construcción. `enrichRelativePercentiles`
(`lib/relativeStrength.js:224-241`) calcula `rsGlobalPct` llamando a
`percentileFromSorted(row.rsCompositeRaw, sortedGlobal, minGlobalSample)`,
con `minGlobalSample = RS_GLOBAL_MIN_SAMPLE = 20`
(`lib/relativeStrength.js:4, 226`). Y `percentileFromSorted`
(`lib/relativeStrength.js:192-201`) devuelve `null` cuando
`sorted.length < minSample`:

```js
export function percentileFromSorted(value, sorted = [], minSample = 1) {
  if (!Number.isFinite(value) || sorted.length < minSample) return null;
  ...
}
```

Con un universo de **6** símbolos, `sortedGlobal.length = 6 < 20` →
`rsGlobalPct = null` para todas las filas. Confirmación en los datos
persistidos: el `objectiveMetricAudit` de AAPL en `scan_results` marca
`rsGlobalPct` con `"status": "insufficient-input"`, `"inputCount": 6`,
`"minInputCount": 20`.

**Cadena causal completa:**

1. `tests/e2e/serverScan.e2e.mjs` define un universo manual de 6 símbolos
   (AAPL, GOOGL, MSFT, NVDA, AMZN, META).
2. `lib/screenerPipeline.js:120` llama `sectorize(qualityPassed)`, que en
   `:314` invoca `enrichRelativePercentiles(...)`.
3. `lib/relativeStrength.js:231` calcula `rsGlobalPct = percentileFromSorted(row.rsCompositeRaw, sortedGlobal, 20)`.
4. `lib/relativeStrength.js:193`: con `sortedGlobal.length = 6 < 20`,
   `percentileFromSorted` retorna `null` para las 6 filas.
5. `lib/screenerPipeline.js:121` → `splitByFilter` → `filterRejectReason`
   → `screenerFilterRejectReason`.
6. `lib/screenerFilters.js:738-741`: como `rsGlobalPct` no es finito y
   `minRsRating = 50 > 0`, retorna `reject("minRsRating", "RS universo sin dato < 50")`.
7. Las 6 filas van a `filterRejections`. `postPassed` queda vacío.
   `finalRows.length = 0` → la UI muestra `Completado: 0 pasan Balanceado`.

### Nota sobre la nomenclatura `rsRating` vs `rsGlobalPct`

El parámetro `minRsRating` lee `metric(row, "rsGlobalPct")` (línea 739),
que es el **percentil sobre el universo del escaneo**. No es el RS contra
el benchmark SPY. Ese otro valor aparece persistido en `scan_results` bajo
el nombre `rsRating`: por ejemplo, AAPL tiene `rsRating: 76` y
`rsGlobalPct: null`. La coincidencia de nombre entre el parámetro del
filtro (`minRsRating`) y el campo de la fila (`rsRating`) **no es
coincidencia de datos** — son magnitudes distintas, con mínimos de
muestreo distintos. Esa discrepancia de nomenclatura es probablemente lo
que indujo el error de diagnóstico original.

### Alcance real del defecto

`minRsRating: 50` está en `QUALITY_DEFAULTS`, así que **cualquier escaneo
con menos de 20 símbolos devuelve cero resultados siempre**, con
independencia de la calidad de los valores. El mensaje al usuario es
"0 pasan", no "universo insuficiente para calcular RS de universo" — el
fallo de producto es exactamente esa falta de diagnóstico en la UI.

De los 7 presets definidos en `SCREENER_FILTER_PRESETS`
(`balanced`, `strict`, `early`, `broad`, `ipo`, `nearPivot`, `weakness`),
los 7 heredan `minRsRating: 50` de `QUALITY_DEFAULTS` sin sobrescribirlo
(verificado contra `lib/screenerFilterCatalog.js:167-175`). El umbral
afecta a todos por igual.

No se tocó `lib/screenerFilters.js`, `lib/relativeStrength.js` ni
`lib/screenerFilterCatalog.js` — el arreglo (¿relajar `minRsRating` cuando
`rsGlobalSample < RS_GLOBAL_MIN_SAMPLE`? ¿mostrar advertencia explícita al
usuario cuando el universo no llega al mínimo?) es una decisión de
producto pendiente, deliberada, tomada aparte de esta investigación.

### Nota sobre el diseño del test

`tests/e2e/serverScan.e2e.mjs` usa un universo manual de **6 símbolos**,
por debajo del mínimo de 20 que el pipeline necesita para calcular
percentiles de universo. Con ese tamaño el test **no puede validar el
camino de filtrado de forma significativa**, sea cual sea el estado del
código: cualquier filtro que dependa de `rsGlobalPct` producirá siempre
"0 pasan" con ese universo, sin que el resultado informe sobre el
comportamiento real de los filtros para usuarios con universos típicos
(decenas o cientos de símbolos). La utilidad de este spec como cobertura
del preset `balanced` es, en este punto, nula — pendiente de rediseñar
la fixture con un universo mínimo válido o un bypass explícito del
requisito de percentil.

### Nota metodológica

La atribución errónea a `minWeaknessScore` se produjo por **deducir una
causa a partir de una lectura estática de código** (dos líneas citadas sin
su `if (mode === "weakness")` guard) **en lugar de capturar la razón de
rechazo real** (la salida del motor de filtros con `field` y `reason`).
La evidencia cruda — `filterRejections` con `symbol`/`key`/`reason` para
cada fila de la corrida `9f2ff675` — no quedó preservada en el log de la
sesión original. Sin esa evidencia, la conclusión no era verificable y
la cita de código, al estar descontextualizada, apuntaba a un mecanismo
(`minWeaknessScore`) que en realidad está inactivo para el preset
ejecutado. Lección operativa: para clasificar rechazos del screener, la
única fuente válida es la lista de `rejections` emitida por
`filterAnalyzedRows` / `applyScreenerFilters` en la corrida concreta; las
deducciones a partir de fragmentos sueltos de `screenerFilters.js` deben
tratarse como hipótesis a verificar, no como causa confirmada.
