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
| 12 | `serverScan.e2e.mjs` | BUG DE TEST (no determinista) | El scan corrió correctamente contra datos reales/en vivo (`providerErrors: []`, 6 símbolos analizados) y el motor rechazó legítimamente los 6 tickers por no cumplir el filtro de tendencia bajo el preset "Balanceado" — condición de mercado del día, no un fallo de pipeline. El test no mockea datos ni fija un preset permisivo, así que depende de que al menos un ticker real pase el filtro ese día |

### Resumen

- **1 bug de producto real**: el zoom del gráfico no activa la vista manual
  (`chartNavigation.e2e.mjs`).
- **1 caso ambiguo**: mezcla de test frágil (case-sensitivity sobre
  `text-transform`) y una posible deuda de refactor sin confirmar
  (`ScreenerOriginPanel` con import muerto en la ficha).
- **10 bugs de test**, casi todos por el mismo patrón raíz: refactors legítimos
  de UI (badges de filtro por fila consolidados en un badge agregado;
  `<details>` colapsados por defecto para "Auditoría y datos" y "Herramientas
  de mantenimiento"; `<select>` de filtro reemplazados por rails clicables en
  desktop) que no se reflejaron en los selectores de los E2E cuando se hicieron
  esos cambios.

No se corrigió ninguno de estos 12 fallos — quedan documentados para que se
prioricen aparte, según instrucción explícita de la tarea.
