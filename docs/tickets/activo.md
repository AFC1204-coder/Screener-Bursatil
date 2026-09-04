# Ticket activo — UX-SHELL A→D (aterrizado)

**Estado:** Oleada UX-SHELL **aterrizada** en `codex/statsedge-ui-polish` · **siguiente:** post-SHELL (ninguno en cola UX-SHELL)  
**Último cerrado:** SHELL-D — laboratorio fuera del aside; `ScreenerSidebar.jsx` + `ScreenerLaboratoryPanel.jsx`; purga CSS `filterArchitectureHead`  
**Rama de trabajo:** `codex/statsedge-ui-polish` @ `d6dd808` (fast-forward desde `cursor/shell-d-laboratorio-sidebar-4cdb`)

## Aterrizaje (4 sep 2026)

- Merge **fast-forward** de `cursor/shell-d-laboratorio-sidebar-4cdb` → `codex/statsedge-ui-polish`.
- Sin conflictos. Sin reintroducción de árbol legado, `viewLayerMini`, plomería en primer paint ni diagnóstico en aside.
- PRs draft #2–#5 (SHELL A/B/C/D por rama) quedan **supersedidos** por este aterrizaje directo en polish.

## SHELL A→D (resumen)

| Oleada | Qué |
|---|---|
| **A** | Un solo editor de filtros; retira árbol «Condiciones + Ajustes finos». |
| **B** | Plomería de sesión al menú ⋯; retira `viewLayerMini`. |
| **C** | Aside = Mercados + familias de ficha activa; retira `advancedConfigPanel`. |
| **D** | Laboratorio (Diagnóstico) al menú ⋯; extrae `ScreenerSidebar` + `ScreenerLaboratoryPanel`. |

## Verificación aterrizaje

- `npx vitest run tests/screenerFiltersView.test.js tests/screenerViewportMount.test.js tests/huntCardModeDisclosure.test.js tests/screenerHuntCardRail.test.js tests/decisionQualityStrip.test.js tests/screenerPercentileScopeBanner.test.js` — **81/81 OK**
- `npm run lint` — OK
- `./vfc` — lint OK; 4 fallos preexistentes en `screenerFilterLayers.test.js` (C-03 sessionStorage) y `screenerSessionActions.test.js` (P4 copy) — no tocados
- Smoke en página: no (este entorno no tiene sesión logueada en `:3000`)

## Qué no se tocó

Scoring, hunt rail semántica, VCP, settings keys, sesión v4, MIGRATE, `/stock`, tokens nuevos, taxonomía UX-FILTERS intensidad/−N.

## Deuda residual / aparcado

- CSS `.weeklyStageControls` / `.filterSwitches` en `screener.css`: siguen usados en el modal de familia (`screenerFiltersView.jsx`), no en aside — no purgados.
- `advancedConfigPanel` / `viewLayerMini`: ya retirados del JSX en oleadas A–B; sin reglas CSS dedicadas encontradas en HEAD.
- Smoke visual del menú ⋯ con Diagnóstico expandido: pendiente en instancia con sesión.

## Post-MIGRATE

Oleada UX-SHELL completa (A→B→C→D). Ver `docs/analisis-ux-shell-aside-2026-09-03.md`.
