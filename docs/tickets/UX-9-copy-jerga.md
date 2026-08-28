# UX-9 — Copy: menos jerga de laboratorio, mismo significado

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer fast  
**Origen:** `docs/analisis-ux-filtros-ia-2026-08-27.md` P2 · resto tras UX-P1…8  
**Principio:** el trader lee lenguaje de producto; la honestidad de datos (percentil incompleto, mercados stale) **no se silencia** — solo se dice en castellano claro.

## Problema

Tras la oleada producto-final quedan restos de jerga interna en superficies visibles:
- Badge `Muestra parcial · percentil por lote` (UX-P1 lo hizo discreto, el copy sigue de lab).
- Posibles restos: «scan …» en la línea de verdad, rótulos «MATERIALIZADO», duplicados menores de copy (lista en UX-1 P2).
- Singular/plural «1 mercado» ya corregido en `marketCountLabel` — **verificar**, no rehacer si está bien.

## Objetivo

1. **Badge de percentil batch:** etiqueta corta en lenguaje de trader, p. ej. `Ranking provisional` o `Percentil incompleto` (elige una y documéntala). El **tooltip / aria-label** conserva la explicación honesta actual (lote menor → puede cambiar al finalizar).
2. **Línea de verdad:** si el segmento `scan 27 ago…` suena a interno, pasar a `datos 27 ago…` o `corte 27 ago…` (una sola opción; actualizar tests de `screenerTruthLine`).
3. **Barrido menor** en superficies del screener (shell, banners de snapshot/materializado si el copy es gritado en mayúsculas innecesarias): sin cambiar lógica ni CTAs de UX-2.
4. Tests: `ortografiaUI`, `screenerPercentileScopeBanner`, `screenerTruthLine` + los que fijen el string antiguo.

## Alcance

### Dentro

- Strings en `ScreenerShell.jsx` (`PERCENTILE_BATCH_NOTE` / badge text), `lib/screenerTruthLine.js`, y copy de banners solo si es trivial.
- CSS solo si el label más corto cambia wrap (mínimo).
- Sin commit ni push.

### Fuera

- MET / RS / VCP.
- Rediseño visual.
- Cambiar semántica de `percentileScope`.
- Reabrir paneles retirados.

## Verificación (orquestador)

1. Tests del ticket + `./vfc` con alcance del diff.  
2. Browser Use: badge visible con nuevo copy + tooltip honesto; verdad con nuevo rótulo de fecha si aplica.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
