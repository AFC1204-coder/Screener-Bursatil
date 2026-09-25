# FILTER-SESSION-BACK-1 — Defaults agresivos · back pierde criterios · chart cola lento

**Estado:** `prep`  
**Prioridad:** P1 (fricción dueño 2026-09-25 · tres síntomas en un S–M)  
**Tamaño:** S–M closable  
**Rama prog:** `cursor/filter-session-back-a41e`  
**Base:** `codex/statsedge-ui-polish` @ `51f8a02` (tip idle post MH-MINI-RPC-1 / #56)  
**Modelo:** Composer  
**Tipo:** sesión filtros · navegación ficha↔mesa · hydrate chartPreview cola/modal  
**Origen:** reporte dueño 2026-09-25 · preferencia producto: abrir en **EE.UU. primero** (`DEFAULT_MARKETS = ["US"]` ya)

## Problema (tres síntomas)

1. **Defaults demasiado agresivos** al abrir sesión fresca / sin criterios útiles: demasiados filtros activos (núcleo + umbrales Balanceado) → mesa estrecha sin que el usuario haya tocado nada.
2. **Back desde ficha** (`/stock/…` → screener): parece reaplicar filtros predeterminados; se pierde la sesión de criterios que el usuario tenía en resultados filtrados.
3. **Gráfico lento** al abrir empresa desde filtro en **Vista rápida / review queue** (modal o cola): chartPreview diferido + espera OHLC.

## Inventario breve (HEAD `51f8a02`)

### A · Defaults / sesión fresca

| Pieza | Dónde | Qué hace |
|---|---|---|
| Mercado cold | `lib/screenerConfig.js` `DEFAULT_MARKETS = ["US"]` | Sesión diaria fresca / reset abre EE.UU. (decisión 2026-09-16). Preferencia dueño OK. |
| Versión sesión | `SCREENER_SESSION_VERSION = 4` · key `statsedge.screenerSession.v1` (`lib/localState.js`) | Restore solo si `session.version === 4`; si no → cold defaults. |
| Estado React cold | `app/page.jsx` `useState`: `markets=DEFAULT_MARKETS`, `presetKey="balanced"`, `settings=settingsForPreset("balanced")` | Primera pintura antes de `useLayoutEffect` restore. |
| Reset nuclear | `lib/screenerSessionActions.js` `screenerCriteriaAfterReset()` | Mismos defaults: US + balanced + `filterLayersForPreset("balanced")` + `DEFAULT_VIEW_LAYERS`. |
| Capas | `lib/screenerFilterCatalog.js` `DEFAULT_FILTER_LAYERS` / `CORE_LAYER_KEYS` (8 on) · `OPTIONAL_LAYER_KEYS` off (UX-FILTERS-8 / contrato v3) | Núcleo liquidity→coverage **todas on**; pattern/vcp/volumen+/RR/SI/IPO off. |
| Umbrales Balanceado | `QUALITY_DEFAULTS` + preset `balanced.v` | p.ej. `requireStage2`, scores Weinstein/Minervini, RS≥50, liquidez/precio, `setupMode: "leader"`, distancias a máximos, perfs mínimas. |
| Compat restore | `lib/filterRestoreCompat.js` `resolveStoredFilterConfig` · `restoreFilterLayers` | Plantillas/sesión pre-v3; preset inválido → balanced. |
| Auto preset mercado | `shouldAutoRestoreBalancedFilterPreset` / `shouldAutoApplyIntlFilterPreset` en restore de `page.jsx` | Al volver a US puede forzar balanced y **descartar** overrides de settings de sesión. |

Hipótesis A: el «demasiado agresivo» no son las 6 opcionales (ya off), sino **núcleo 8 + umbrales Balanceado** (y/o auto-corrección a balanced).

### B · Persistencia / back (popstate · remount `/`)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Guardar criterios | `persistScreenerSession` + autosave debounce (`page.jsx` · `createDebouncedSessionSaver`) | Criterios + `scanRef` / `scanContext`; **no** filas. |
| Antes de ficha | `saveSessionBeforeStockOpen` · `buildScreenerStockOpenContext` | Flush cancel + write `lastOpenedStock*` + `scrollY`. |
| Quick Review → ficha | `useQuickReviewSession.saveQuickReviewStockOpen` | Llama `saveSessionBeforeStockOpen`. |
| Restore entrada | `useLayoutEffect` lee `screenerSession` v4 → markets/settings/layers/filters + rehydrate vía `scanRef` | Si falta versión/scan/corrupt → cae a cold A. |
| **popstate** | `page.jsx` ~1156 | Solo `restorePersistedScroll` (scrollY). **No** re-aplica filtros; criterios dependen del remount + localStorage. |
| Back UI ficha | `StockClient` link `href="/"` (`stockBackLink`) | Navegación completa a `/` → remount screener → restore sesión. |
| Tests sesión | `tests/filterRestoreCompat.test.js` · `tests/screenerSessionActions.test.js` · `tests/screenerSessionExpiry.test.js` | Compat capas + P4 refresh vs reset + caducidad nocturna. |

Hipótesis B: race autosave / write fallido / versión / auto-balanced al restore → usuario ve defaults al back; o scroll restore enmascara criterios ya perdidos.

### C · Chart cola / Vista rápida (hydrate lento)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Transporte diferido | `GET /api/scans` `chartPreview=deferred` · `lib/scansChartPreviewTransport.js` | Filas sin `chartPreview` en cold. |
| Hydrate mesa/modal | `app/page.jsx` `chartPreviewHydratePlan` + `fetchChartPreviewsForSymbols` → `POST /api/scans/chart-preview` | Incluye `quickReviewRows` (+ pagedRows) fuera de Caza. |
| Hydrate `/review` | `app/useReviewChartPreviewHydrate.js` · `lib/reviewChartPreviewHydrate.js` | Foco activo±1; sin brief. |
| Pintura fila | `app/RowPriceChart.jsx` | Sin preview usable → espera `/api/chart` OHLC («Cargando histórico…»); con preview close-only → línea al instante (CHART-QR-1). |
| Modal | `QuickReviewModal` + `RowPriceChart` / scope `quickReview` | Misma cola que hydrate plan. |
| API miniaturas | `app/api/scans/chart-preview/route.js` | Batch por `cloudId` / scanIds + symbols. |

Hipótesis C: abrir Vista rápida antes de que el POST chart-preview rellene el símbolo (o fallo/miss) → chart bloqueado en OHLC; cola Review sin foco hydrate a tiempo.

## Alcance (programación)

Cerrar los **tres** síntomas en un S–M, sin rediseño de scoring:

1. **Defaults más suaves en cold / reset** (US primero se mantiene): reducir agresividad percibida (umbrales y/o capas núcleo activas por defecto) sin romper mesa usable; documentar el nuevo cold en test.
2. **Criterios sobreviven ficha→back**: save antes de stock fiable + restore al volver a `/` sin reaplicar balanced/defaults no deseados; cubrir race debounce / popstate/pageshow si aplica. Tests de sesión round-trip.
3. **Chart cola/modal más rápido**: asegurar preview del foco (activo ± vecinos) hidratado al abrir Vista rápida / review queue **antes** o en paralelo útil al OHLC; no reabrir batch 80 de Caza (#52).
4. Vitest focalizado + `./vfc` si toca paths del gate. Smoke orquestador Browser Use.

## Fuera de alcance (NO)

| Tema | Motivo |
|---|---|
| Scoring / umbrales de régimen / nocturno scan | Gate dueño |
| FIRDS / Twelve Data / Hito 1B | Aparcado |
| Revertir transporte deferred chartPreview global | Solo cola/foco |
| Rediseño FILTER-SHELL / LOOK | Solo sesión + paint |
| Commit/push desde programación | Orquestador cierra |

## Criterios de aceptación (orquestador)

1. Cold US: menos filtros/umbrales agresivos que HEAD `51f8a02` (evidencia: conteo capas on / truth N/M o chips activos vs antes) · sigue abriendo EE.UU.
2. Flujo: filtrar → abrir ficha → back → **mismos criterios** (preset/layers/settings/markets) que antes de la ficha; no silent balanced.
3. Vista rápida / cola: chart del activo muestra línea (preview) sin espera larga a OHLC; o mejora medible vs baseline (Network: chart-preview del símbolo antes/junto a chart).
4. Vitest OK · `./vfc` si aplica · sin scoring/FIRDS.

## Prompt para Agent chat (copiar tal cual)

Ver bloque en `docs/tickets/activo.md` (misma rama `cursor/filter-session-back-a41e`).

Sin commit ni push.
