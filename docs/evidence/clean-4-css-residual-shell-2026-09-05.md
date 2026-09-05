# CLEAN-4 — evidencia purga CSS post-SHELL (2026-09-05)

## Método

Cruce `rg` de classNames vivos en `*.{jsx,js}` vs selectores en `styles/screener.css` y `styles/components.css`, anclado a JSX retirado en SHELL A→D (`f41203e`, `f50ff8f`, `e10dbe9`, `d6dd808`). Solo se borró CSS sin usos demostrables.

## Selectores eliminados

### Árbol finos / condiciones (SHELL-A)

| Selector | Origen |
|---|---|
| `.advancedFiltersDetails` | `<details>` «Ajustes finos» retirado del aside |
| `.filterGroups` | Contenedor del árbol 14× `FILTER_GROUPS` |
| `.filterGroup` | Cada `<details>` de familia en el árbol legado |
| `.filterGroupHead` | `<summary>` del árbol legado |
| `.filterGroup h3`, `.filterGroupHead h3`, `.filterGroupHead span` | Tipografía/contador del árbol |
| `.filterGroup[open] .filterGroupHead` | Estado abierto del árbol |
| `.filterFooter` | Pie «Resetear condiciones» del árbol |

### Toggle de capa legado (pre-`layerPowerToggle`)

| Selector | Origen |
|---|---|
| `.layerToggle`, `.layerToggle:hover` | Sustituido por `.layerPowerToggle` en `LayerToggleButton` |
| `.layerToggleState`, `.layerToggleState i`, `.layerToggleState b` | Subárbol del toggle antiguo |
| `.layerToggleText`, `.layerToggleText strong/small` | Etiquetas del toggle antiguo |
| `.layerToggleCount` | Contador del toggle antiguo |
| `.layerToggle.on`, `.layerToggle.off` | Estados del toggle antiguo (`components.css`) |
| `.layerToggle.on .layerToggleState i` | Acento del toggle antiguo (`components.css`) |

### Acciones / plomería retiradas del aside

| Selector | Origen |
|---|---|
| `.filterLayerActions` | Botones «Base preset» / «Todo activo» (SHELL-A) |

### Referencias compuestas actualizadas (no borradas enteras)

- `.layerToggle, .filterGroup, .filterField, .searchScopeChip` → `.filterField, .searchScopeChip`
- `.filterGroup h3, .filterLayerBlock h3, …` → `.filterLayerBlock h3, …`
- `.filterGroupHead h3` eliminado de la regla de títulos de sección
- `.layerToggle.on, .searchScopeChip:hover` → `.searchScopeChip:hover`
- `.filterTemplateBtn.active, .layerToggle.on` → `.filterTemplateBtn.active`
- Grupo `.templateQuickPresets, …, .filterGroup, .filterField` → sin `.filterGroup`
- Grupo `.filterTemplateBtn, .layerToggle` → solo `.filterTemplateBtn`

## Ya purgado en SHELL-D (no repetido)

- `.filterArchitectureHead` — commit `d6dd808`
- `viewLayerMini` / `viewLayerBar` — sin reglas residuales en `styles/` al inventariar

## Archivos tocados

- `styles/screener.css` (−179 líneas netas)
- `styles/components.css` (−21 líneas netas)

## Verificación

```bash
npm test -- --run tests/screenerFiltersView.test.js tests/screenerViewportMount.test.js tests/marketChipCss.test.js tests/huntRailButtonCss.test.js
# 4 files, 39 tests passed

./vfc styles/screener.css styles/components.css
# tests + lint OK; alcance vfc avisa por docs preexistentes fuera del diff CSS
```

Smoke visual: pendiente orquestador (Browser Use `/` desktop + 390).
