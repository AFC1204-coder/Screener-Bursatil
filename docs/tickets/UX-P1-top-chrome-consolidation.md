# UX-P1 — Consolidar chrome superior (hero · estado · percentil · verdad)

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-ux-producto-final-2026-08-27.md` · Día 1  
**Principio:** una sola zona superior legible; la **línea de verdad (UX-2) no se pierde**; no reabrir banners de mercados stale (siguen 1 aviso + CTA).

## Problema

Antes de la primera fila se apilan: Hero → franja `Estado` (`scanStatusBar`) → disclosure `Muestra parcial · percentil por lote` → buscador → rail → verdad → (a veces) banner mercados. Sensación de panel de depuración; ~140px+ recuperables.

## Objetivo

1. **Eliminar o absorber** la franja completa `scanStatusBar` en estado OK: el mensaje de “datos cargados / N acciones” no merece una banda propia. Errores (`err` / incidencia) siguen visibles (pueden vivir en el hero, bajo el título, o un banner compacto de error).
2. **Percentil por lote:** dejar de ser un `<details>` de ancho completo tipo debug. Sustituir por **badge/tooltip/nota inline** discreta (p. ej. junto a la línea de verdad o al título de resultados) **solo** cuando haya filas `percentileScope === "batch"` (misma condición que hoy). Mantener la honestidad del copy, no silenciar el aviso.
3. **Hero + verdad:** título de ficha + mercados + verdad en un bloque compacto; no duplicar contadores. `WeeklyChangesLine` puede quedarse si no infla; si empuja demasiado, reducir a una línea secundaria.
4. Buscador + `HuntCardRail` + verdad: acercar verticalmente (márgenes), sin meter el rail dentro del sidebar.

## Alcance

### Dentro

- `app/components/screener/ScreenerShell.jsx` (orden del stack superior).
- `styles/screener.css` (compactación; sin look genérico nuevo).
- Actualizar tests que asumen `percentileScopeNotice` / `scanStatusBar` / copy «Muestra parcial» (`tests/screenerPercentileScopeBanner.test.js` y afines): deben reflejar el **nuevo** control (badge/clase), no borrar la garantía de aviso batch.
- Sin commit ni push.

### Fuera

- UX-P2 toolbar (siguiente ticket; no mezclar salvo 1 línea gratis).
- UX-6 sidebar / presets.
- UX-P3 mercados.
- Cambiar semántica de `percentileScope` o del motor.

## Verificación (orquestador)

1. Tests percentil + shell en verde.  
2. Browser Use hard-reload US: menos franjas; verdad visible; sin banda «Estado» verde/ocupando fila entera en OK; si hay batch, aviso discreto presente; banner mercados solo si stale.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
