# UX-SHELL-1 — Retorno Fable: sobrecarga del aside (2026-09-03)

Fuente: brief `docs/tickets/UX-SHELL-1-fable-aside-overload.md`.  
Modelo: Fable 5. Sin código. HEAD citado: `2836bed`.

**Decisión orquestador:** **aceptado** como dirección post-MIGRATE.  
Verificación puntual contra repo: tres editores en `ScreenerShell` (árbol `FILTER_GROUPS` + `FilterArchitecturePanel` + modal), tres contadores (`advancedChangeCount` / `executionRuleActive` / `fineRuleActive`), tres resets («Base preset» / «Resetear condiciones» / ⋯), `persistAdvancedOpen(true)` desde ModeStrip y «Ver auditoría», `FilterTemplatePanel` primero en aside — **confirmados**.

**Gate pre-SHELL-A:** confirmar que `FilterFamilyModal` expone reglas por familia para todas las familias (no solo IPO/RS); si no, completar modal antes de retirar el árbol.

---

## Resumen

Veredicto: el aside no está sobrecargado por tener 67 umbrales; está sobrecargado porque **apila tres generaciones del mismo editor** sin haber retirado ninguna. En HEAD (`2836bed`) conviven, dentro de `<aside class="sidebar">`: (a) el árbol legado «Condiciones + Ajustes finos» (14 `FILTER_GROUPS` × `FilterNumber`, 4 inputs de medias semanales, 4 switches sueltos), (b) las capas v2 (`FilterArchitecturePanel`, 13 `LayerControl` + Régimen, botones «Base preset / Todo activo»), y (c) las tarjetas de familia con intensidad/cobertura/impacto de UX-FILTERS-1…7. Las tres escriben las mismas claves de `settings`. Encima, la plomería de sesión (plantillas, nube, «Más bases») ocupa la primera pantalla del aside, y «Vista de resultados» duplica los chips «+ Filtro» ya aceptados en UX-7.

Cada poda anterior (UX-6, FILTER-SHELL-1/2) siguió el patrón «meter en `<details>`», no «retirar». Resultado: 7 summaries de primer nivel, anidamiento a 4 niveles (Configuración avanzada → Ajustes finos → familia → campo), **tres contadores distintos** para la misma pregunta y **tres resets**.

El dato decisivo: la mesa de vistas ya hizo el trabajo diario del aside. `HuntCardModeStrip` en `main` declara modo + puertas de la ficha y enlaza «Abrir familia». **El único control diario que queda en el aside es Mercados.** Todo lo demás es semanal o de laboratorio.

Dirección: aside = **Mercados + tarjetas de familia de la ficha activa** (con −N), un solo editor (el modal de familia), plomería en ⋯, laboratorio fuera. Cuatro oleadas sustractivas, cada una acotada a una zona de `ScreenerShell`/`screenerFiltersView`, sin reescribir el shell.

## Por qué sigue sobrecargado

- **Tres editores del mismo estado, superpuestos.** `ScreenerShell.jsx` árbol legado `FILTER_GROUPS` + `weeklyStageControls` + `filterSwitches`; `FilterArchitecturePanel` (capas v2 + tarjetas UX-FILTERS); `FilterFamilyModal`. El usuario ve el mismo umbral en tres sitios.
- **Tres contadores:** `advancedChangeCount`, `executionRuleActive/Total`, `fineRuleActive/Total` (`FILTER_FIELDS.length` = 67).
- **Tres resets:** «Base preset», «Resetear condiciones», «Resetear criterios» en ⋯.
- **`advancedOpen` persistido** (`statsedge.screenerAdvancedOpen.v1`); «Abrir familia» / «Ver auditoría» llaman `persistAdvancedOpen(true)` → Configuración avanzada queda abierta.
- **Plomería antes que caza:** `FilterTemplatePanel` primero en el aside.
- **«Más bases»** sigue compitiendo con fichas (hint lo admite).
- **`viewLayerMini`** duplica chips + «+ Filtro» (UX-7).
- **Definición de etapa** (MA semanales) mezclada con filtros.
- **Switches huérfanos** fuera de familia.
- **Diagnóstico** aún hermano de Mercados pese a FILTER-SHELL-1.
- **CSS acumulativo** sin borrados; un DOM aside+drawer (CLEAN-2).

## IA objetivo

| Capa | Qué | Dónde |
|---|---|---|
| **Diario** | Mercados. Tarjetas de familia de la ficha activa (⏻ · −N · cobertura). | Aside, primer nivel |
| **Raro** | Otras familias plegado. Modal familia. «Volver a la ficha». Plantillas/nube/bases. Régimen. | Plegado / modal / ⋯ |
| **Enterrado** | Definición de etapa en Tendencia. Reglas de campo en modal. Auditoría. Cobertura intl. JSON audit. | Modal / ⋯ / Personalizar mercados |
| **Retirado** | Ajustes finos. Condiciones. Vista resultados mini. Todo activo. Ajustes de sesión. 2 contadores + 2 resets. | — |

## Kill list (aceptada)

Ver retorno Fable en chat 2026-09-03; resumen operativo: retirar árbol finos + condiciones sueltas → modal; plomería → ⋯; vista mini fuera; diagnóstico fuera del aside; promover tarjetas familia; borrar CSS con el JSX.

## Oleadas post-MIGRATE (aceptadas)

| ID | Título | Prio | Depende |
|---|---|---|---|
| **SHELL-A** | Un solo editor: retirar árbol finos/condiciones; MA→Tendencia; switches→familia; un reset | P0 | Gate modal completo |
| **SHELL-B** | Plomería a ⋯; retirar sesión header + viewLayerMini | P0 | Independiente de A |
| **SHELL-C** | Aside = Mercados + familias de ficha; quitar advancedOpen/contadores | P1 | A+B |
| **SHELL-D** | Laboratorio fuera + `ScreenerSidebar.jsx` + purga CSS | P2 | A+B+C |

Orden: A∥B → C → D. Sin tocar semántica settings/sesión v4/scoring/VCP/rail.

## Qué no tocar

Confirmado alineado con gobernanza: scoring, nocturno, hunt cards, capas v2 keys, FILTER_FIELDS keys, mesa de vistas, UX-FILTERS taxonomía/intensidad/−N, móvil ya medido, MIGRATE, `/stock`, tokens nuevos.

## LO QUE NO VERIFIQUÉ (del modelo)

Smoke propio; `FilterFamilyModal` línea a línea; líneas exactas CSS huérfanas; semántica Guardar ⋯ vs plantillas; localStorage real del dueño; coste −N × 13 familias.
