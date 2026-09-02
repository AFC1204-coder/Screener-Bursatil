# TABLE-FIRE-1 — Columnas de resultados sin solaparse al redimensionar

**Estado:** Cerrado 2026-09-03 (verify orquestador · smoke 820)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Prioridad:** fuego UI · mesa de resultados · resize  
**No mezclar:** MIGRATE · SHELL-A…D · VCP scoring

## Evidencia (orquestador 2026-09-03)

Captura dueño: cabeceras **RS / RS país / ETAPA** y celdas (95, 88, «Etapa 2») **solapadas**.

Smoke CDP `:3310` (desktop table montada ≥761):

| viewport | `tableW` | RS país / RS tema `th` width | celdas RS/Etapa |
|---|---:|---:|---|
| 820 | **250** | **0 / 0** | mismo `left` (154) — ilegible |
| 760 | 250 | 0 / 0 | igual |
| ≤700 | — | mobile cards (OK) | — |

Causa en CSS (HEAD):

- `.compactResultsTable { min-width:0; table-layout:fixed; width:100%; }` (`styles/screener.css` ~3334, ~4785)
- `.compactTableWrap { overflow-x:hidden; }` (~4781) — aplasta y **no deja scroll**

CLEAN-2 dual DOM (lista ≤760 / tabla ≥761) está bien; el fuego es la **banda tablet/ventana estrecha con tabla**.

## Objetivo

1. En cualquier ancho ≥761 donde se muestre la tabla, **ninguna celda/cabecera se solapa**; el texto de columnas prioritarias es legible.
2. Al **cambiar el tamaño de ventana**, la muestra de datos se adapta sin basura visual: o scroll horizontal honesto, o columnas secundarias ocultas / compactadas con regla clara — no `width:0` silencioso.
3. ≤760 sigue en `mobileResearchHome` (cards); no romper MOBILE-FIRE / usefulChartPx de ficha.

## Alcance (elige el camino mínimo que cumpla aceptación)

**A — Preferido si es suficiente:** restaurar `min-width` útil en `.compactResultsTable` + `overflow-x: auto` en el wrap (quitar `hidden`). Columnas con `min-width` por clase (`.colRs`, `.colStage`, …) para que no colapsen a 0.

**B — Si A deja demasiadas columnas fuera:** además, **ocultar columnas secundarias** por media query / contenedor (p. ej. RS tema, VCP, Dist, Cap) manteniendo Ticker · Tema · RS · Etapa · Rend · (RS país si cabe). Usar clases ya en `lib/screenerColumns.jsx`, no `nth-child`.

**C — Resize:** verificar que `useScreenerMobileViewport` (matchMedia 760) re-monta lista↔tabla al cruzar el umbral sin estado zombie; si el layout mid-width depende solo de CSS, documentarlo en el test.

## Fuera

- SHELL / rediseño aside · MIGRATE · scoring · añadir columnas nuevas · redesign móvil cards.

## Aceptación

```js
// viewport 820×900 y 1100×900, scrollY≈0, ≥1 fila cargada
// para cada par de celdas adyacentes visibles en la 1ª fila:
//   cell[i].right <= cell[i+1].left + 1
// ninguna th/td de columna visible con width < 24 (salvo col vacía intencional)
// overflow-x del wrap: auto o scroll si table.scrollWidth > clientWidth; nunca hidden con columnas aplastadas
```

Smoke resize: 1280 → 820 → 700 → 820 — sin solapes en 820; cards en 700; tabla de nuevo en 820.

Tests: contrato CSS (`overflow-x` / `min-width`) y/o viewport mount; actualizar si hace falta.

Sin commit ni push (programación).

## Verificación (orquestador 2026-09-03)

- CDP `:3310` · **820×900**: `tableW=720`, `overlaps=0`, `zeroWidth=0`, `wrapOverflowX=auto`, RS país/tema **50px**, `scrollX=true`.
- Tests: `screenerTableResizeCss` + sevenColumns + viewportMount → **38 passed**.
