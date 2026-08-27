# UX-4 — Purga de filtros fantasma de la vista

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium**  
**Origen:** `docs/analisis-ux-filtros-ia-2026-08-27.md` (P0 #2) · orden dueño: UX-4 → UX-3 → UX-2  
**Principio:** «lo que no está en las fichas no filtra» (propuesta A / decisión 2026-08-12).

## Problema

Diez filtros de **juicio del sistema** se retiraron de la UI del screener, pero **siguen evaluándose** en `applyResultViewFilters` y viven como estado + `useMemo` en `useResultViewModel`. Si la sesión/localStorage trae un valor distinto de «Todos»/`all`, **ocultan filas sin ningún control visible**.

Lista (los 10):

`readinessFilter`, `actionFilter`, `confidenceFilter`, `decisionProfileFilter`, `reviewPriorityFilter`, `reliabilityFilter`, `decisionEvidenceFilter`, `dataHealthFilter`, `scoreAuditFilter`, `decisionIssueFilter`

También: `decisionResolutionFilter` — las resoluciones en nube están **descartadas** por producto; si aún filtra la vista sin UI, purgarlo en el mismo ticket.

## Objetivo

Tras este ticket, la vista del screener **solo** puede ocultar filas por controles que el usuario ve (país/tema/sector/industria/fuerza grupo/IPO/resolución local si aún hay UI; sort/página no cuentan como “ocultar”). Ningún estado persistido de los 10+ puede reducir `filtered` en silencio.

## Alcance

### Dentro

1. **`lib/screenerResultView.js` — `applyResultViewFilters`:** eliminar ramas que aplican los 10 (+ `decisionResolutionFilter` si no hay UI). Conservar filtros de vista **visibles**: country / theme / sector / industry / sectorStrength / ipo (y cualquier otro que `ResultFilterBar` aún muestre).
2. **`app/components/screener/useResultViewModel.js`:** quitar estado, restauración de sesión, chips, counts/`useMemo` y deps asociados a esos filtros fantasma. No dejar setters huérfanos exportados al shell.
3. **`app/page.jsx` (y shell si aplica):** dejar de persistir / restaurar esas claves en sesión del screener.
4. **Tests:** actualizar `tests/screenerViewFilters.test.js` y cualquier test que ejerza los filtros fantasma (p. ej. `decisionQualityStrip`, `screenerScoreAudit`, `screenerAnnotation`, `screenerDataHealth` **solo si** fallan por depender del path de vista del screener). Las libs de audit/explainability pueden seguir existiendo para ficha/diagnóstico; **no** deben gobernar el conteo de filas de la tabla.
5. Grep limpio en `app/components/screener/` + `applyResultViewFilters`: cero referencias a esos filtros como entrada de filtrado.
6. Sin commit ni push.

### Fuera

- UX-3 (orden/cabecera), UX-2 (línea de verdad), UX-5 (rail de fichas).  
- Rediseñar `ResultFilterBar` / chips (UX-7).  
- Borrar módulos enteros de audit/explainability si aún los usa la ficha.  
- Cambiar filtro de ejecución (preset/capas/umbrales).

## Archivos probables

- `lib/screenerResultView.js`
- `app/components/screener/useResultViewModel.js`
- `app/page.jsx` (persistencia sesión)
- `tests/screenerViewFilters.test.js` (+ los que fallen al purgar)

## Verificación (orquestador)

1. Tests en verde (suite tocada).  
2. Grep: sin aplicación de los 10 en path de vista.  
3. Browser Use: con sesión limpia y, si se puede, sesión con claves fantasma en `localStorage` → `filtered.length === rows.length` salvo chips de vista visibles activos.

## Plantilla de retorno

```
## Resumen
(1–4 bullets)

## Archivos
(lista real)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
