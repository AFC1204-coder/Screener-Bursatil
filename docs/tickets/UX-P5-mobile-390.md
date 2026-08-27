# UX-P5 — Móvil ~390px: primera tarjeta visible ya

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-producto-final-2026-08-27.md` · Día 4 · P2  
**Principio:** en viewport ~390px, el usuario ve **resultado** (tarjeta/lista) sin scrollear media pantalla de chrome; rail y filtros no se parten en caos.

## Problema

En móvil el stack (hero + buscador + hunt rail + verdad + banners) y el sidebar en drawer siguen ocupando casi todo el primer viewport; el rail de fichas se parte en varias líneas irregulares.

## Objetivo

1. **`HuntCardRail`:** scroll horizontal (nowrap + overflow-x) en `max-width: ~480px` / 390px; una fila, swipe; active visible.
2. **Chrome superior:** reducir padding/márgenes en móvil (hero, searchCard, truth line) sin romper UX-P1 (sin volver a inventar franjas).
3. **Drawer de filtros** (`showMobileFilters` / `sidebar.mobileOpen`): ya existe; pulir para que se sienta bottom-sheet o panel limpio (header «Filtros» + Listo ya están). No rehacer arquitectura.
4. **`mobileResearchHome`:** la primera tarjeta de resultado entra en viewport inicial en 390×844 (o similar) con datos cargados y sin banners stale (si hay banner, tras cerrarlo/en EE.UU. limpio).
5. Mercados: respetar UX-P3 (banderas colapsadas); en móvil el summary «Personalizar…» basta.

## Alcance

### Dentro

- `styles/screener.css` (y `components.css` solo si el rail móvil vive ahí)
- Ajustes mínimos JSX en `HuntCardRail.jsx` / `ScreenerShell.jsx` si hace falta clase wrapper
- Test de render opcional (clase scroll / snapshot HTML)
- Sin commit ni push

### Fuera

- UX-8 desglose bajo verdad (hermano).
- Rediseño completo de `MobileResultList`.
- Cambiar lógica de mercados/presets.

## Verificación (orquestador)

1. Tests + `./vfc` con alcance del diff.  
2. Browser Use: viewport 390×844, hard-reload US; rail en una fila scrollable; primera tarjeta visible (o casi); abrir Filtros drawer OK.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
