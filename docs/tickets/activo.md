# Ticket activo — SHELL-D (cerrado)

**Estado:** SHELL-D cerrado · **siguiente:** post-SHELL (ninguno en cola UX-SHELL)  
**Último cerrado:** SHELL-D — laboratorio fuera del aside; `ScreenerSidebar.jsx` + `ScreenerLaboratoryPanel.jsx`; purga CSS `filterArchitectureHead`  
**Base:** SHELL-C (`cursor/shell-c-aside-families-62d8`)

## SHELL-D (cerrado)

- **Laboratorio fuera del aside:** Diagnóstico (auditoría de filtros + cobertura internacional) movido al menú ⋯ (`resultsMoreMenu` escritorio, `mobileResultsMoreMenu` móvil).
- **Extracción:** `ScreenerSidebar.jsx` (Mercados + familias de ficha); `ScreenerLaboratoryPanel.jsx` (paneles de diagnóstico).
- **«Ver auditoría»** en desglose de filtros abre el menú ⋯ y expande Diagnóstico (ya no abre el drawer de filtros).
- **CSS purgado:** bloque `.filterArchitectureHead` (huérfano desde SHELL-A). Estilos de laboratorio reubicados bajo `.resultsMoreMenuLaboratory` / `.mobileResultsMoreMenuLaboratory`.

## Verificación SHELL-D

- `npx vitest run tests/screenerFiltersView.test.js tests/screenerViewportMount.test.js tests/huntCardModeDisclosure.test.js tests/screenerHuntCardRail.test.js tests/decisionQualityStrip.test.js tests/screenerPercentileScopeBanner.test.js` — OK
- `npx eslint` archivos tocados + `npm run lint` — OK
- `./vfc` — lint OK; fallos preexistentes en `screenerFilterLayers.test.js` y `screenerSessionActions.test.js` (no tocados)
- Smoke en página: no (este entorno no tiene sesión logueada en `:3000`)

## Qué no se tocó

Scoring, hunt rail semántica, VCP, settings keys, sesión v4, MIGRATE, `/stock`, tokens nuevos, taxonomía UX-FILTERS intensidad/−N.

## Deuda residual / aparcado

- CSS `.weeklyStageControls` / `.filterSwitches` en `screener.css`: siguen usados en el modal de familia (`screenerFiltersView.jsx`), no en aside — no purgados.
- `advancedConfigPanel` / `viewLayerMini`: ya retirados del JSX en oleadas A–B; sin reglas CSS dedicadas encontradas en HEAD.
- Smoke visual del menú ⋯ con Diagnóstico expandido: pendiente en instancia con sesión.

## Post-MIGRATE

Oleada UX-SHELL completa (A→B→C→D). Ver `docs/analisis-ux-shell-aside-2026-09-03.md`.
