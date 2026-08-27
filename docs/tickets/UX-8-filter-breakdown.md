# UX-8 — Desglose «qué está filtrando ahora»

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-producto-final-2026-08-27.md` · Día 4 · P2  
**Principio:** bajo la línea de verdad, **una línea** (o disclosure de 1 clic) dice qué recorte pesa más — sin abrir «Auditoría de filtros» completa del sidebar.

## Problema

La verdad dice `N analizadas · M pasan «Ficha» · V visibles`, pero no explica *por qué* M≪N o V≪M. El embudo vive solo en `FilterDiagnosticsPanel` (advanced), jerga de laboratorio.

## Objetivo

1. **Micro-panel** colapsable **bajo** `.screenerTruthLine` (mismo bloque searchCard / main):
   - Cerrado por defecto; summary corto p. ej. `¿Qué recorta?` o `Desglose del filtro`.
   - Abierto: **1–3 líneas** en lenguaje de trader, p. ej.  
     `Preset «Líderes Etapa 2» deja 47 de 3321` · `Vista oculta 12 más (Tema: …)` · top rechazo del diagnostics si existe (`blocks[0]`).
2. Reutilizar datos ya cableados: `diagnostics` (si hay), `hiddenByView`, chips de vista activos, `huntDisplayName` / preset — **no** nuevo motor de scoring.
3. Si no hay diagnostics: mensaje honesto («Sin desglose del embudo; solo vista») en lugar de inventar números.
4. No duplicar el panel completo de auditoría del sidebar; enlace opcional «Ver auditoría» que abra advanced (nice-to-have, no bloqueante).

## Alcance

### Dentro

- Helper pequeño (p. ej. `lib/screenerFilterBreakdown.js`) + tests unitarios del texto
- `ScreenerShell.jsx` (montar bajo verdad; pasar diagnostics / hiddenByView / chips)
- CSS mínimo
- Sin commit ni push

### Fuera

- UX-P5 móvil (salvo que el breakdown no rompa 390px).
- Cambiar `applyScreenerFilters` / estructura de `diagnostics.blocks`.
- UX-9 copy general.

## Verificación (orquestador)

1. Tests + `./vfc`.  
2. Browser Use US: verdad visible; abrir desglose → cifras coherentes con 47/3321 (o estado actual); con chip de vista, menciona ocultas de vista.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
