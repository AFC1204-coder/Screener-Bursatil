# SCREENER-COLD-PAYLOAD-1 — bajar fricción cold (parse·render residual)

**Estado:** prep → programación cloud  
**Rama base:** `codex/statsedge-ui-polish` @ `f1a59f0`  
**Modelo:** Composer 2.5 / Terra  
**Contexto:** WAVE5 ~20,5 MB JSON deferred / ~3,3 MB gzip; core-first + hydrateRs ya ayudaron; residual = parse/render cliente (“trompicones” post-paint).

## Objetivo

Reducir trabajo cold post-core sin romper primer paint de mesa US ni integridad de filas.

## Alcance (closable S–M)

1. **Medir** en código/tests o script de research: tamaño/shape del payload deferred actual (qué campos hinchan) — no inventar MB; basarse en `research/wave5-remeasure-2026-09-14/` + probe vivo si hay env.
2. **Cortar o diferir** al menos una fuente clara de peso (p. ej. campos no usados en primer paint, proyección más agresiva en wire light, chunking/parse incremental, o evitar JSON.parse monolítico del deferred) — una palanca medible, no refactor total.
3. **Preservar:** core-first paint; guards `dataQuality`/estimated; no bloquear truth con hydrateRs.
4. Tests focalizados + `./vfc` o vitest del ticket verde.
5. Nota breve de remasure (antes/después o “qué se diferió”) en `research/` o comentario en backlog.

## No tocar

- Nocturno / scoring / auth / FIRDS / Twelve Data.
- No fusionar chart-controller.
- No reescribir todo el pipeline scans.

## Verify orquestador

- Diff + tests; smoke cold US `:3300` si Mini UP (hard-reload; anotar TTFB/sensación). Gate: no merge si mesa 0/0 o rompe hydrate.
