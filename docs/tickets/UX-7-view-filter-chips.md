# UX-7 — Chips de vista activos + «+ Filtro»

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-producto-final-2026-08-27.md` · Día 3  
**Principio:** los recortes de **vista** (país/tema/sector/…) se leen como chips quitables con impacto; añadir filtro es un gesto claro («+ Filtro»), no un disclosure de laboratorio.

## Problema

`ResultFilterBar` ya tiene selects de resolución/orden, disclosure «Más filtros» y `ResultFilterChips`, pero:
- «Más filtros» + resumen «Vista de investigación / filtros / ocultas» suena a debug.
- Los chips muestran label + ×, sin impacto claro (cuántas filas quita / cuántas quedan en esa opción).
- No hay un CTA «+ Filtro» reconocible de producto.

## Objetivo

1. **CTA «+ Filtro»** (o «+ Más filtros» corto): abre el panel de capas de vista (país, tema, sector, subsector, fuerza grupo, IPO) que hoy vive en `viewLayerFilters`. Misma lógica; mejor naming/jerarquía. Si no hay capas de vista activas en `viewLayers`, el CTA puede ocultarse o quedar disabled con motivo.
2. **Chips activos** (país ≠ Todos, tema, etc. + resolución si aplica): compactos, × para quitar, y **impacto** visible — p. ej. conteo de la opción (`countryCounts`) o «−N ocultas» / `visible/total` por chip si ya hay dato en el modelo. Reutilizar counts existentes; no inventar motor nuevo.
3. **Resumen:** reducir jerga «Vista de investigación» o sustituir por una línea corta tipo «Vista: N/M · K filtros» alineada con la mesa de vistas. No reabrir filtros fantasma (UX-4).
4. Selects de **Resolución** y **Ordenar** pueden quedarse; no son el foco salvo alinear visualmente con «+ Filtro».

## Alcance

### Dentro

- `app/components/screener/ResultFilterBar.jsx`
- `ResultFilterChips` en `lib/screenerFiltersView.jsx` (y CSS)
- `useResultViewModel.js` solo si hace falta enriquecer `chips` con `impact`/`count`
- Tests de render/chips (nuevo o extensión)
- Sin commit ni push

### Fuera

- UX-P4 modal.
- UX-8 desglose bajo la verdad.
- Cambiar `applyResultViewFilters` / capas de ejecución.
- Sidebar advanced.

## Verificación (orquestador)

1. Tests del ticket + `./vfc` con alcance de archivos del diff.  
2. Browser Use: aplicar País o Tema → chip con × e impacto; «+ Filtro» abre selects; limpiar vista restaura.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
