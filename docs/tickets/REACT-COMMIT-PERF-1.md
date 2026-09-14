# REACT-COMMIT-PERF-1

**Estado:** prep  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 High  
**Prior art:** `FILTER_CPU_1_REPORT.md` · `SCREENER_PERF_REAL_1_REPORT.md` · `WAVE0_A_PERFORMANCE_FORENSICS.md`

## Problema

En gestos de mesa US (~3,5k filas), el long task browser (~250–470 ms) no es solo `filterAnalyzedRows` (~20 ms CPU). Tras FILTER-CPU-1:

| Capa | Aprox. en gesto |
|---|---|
| Reglas filtro | ~60–100 ms |
| Anotación O(pasan) | ~150–280 ms |
| **React render/commit** (cinta, truth, memos, tabla) | **~100–200 ms** resto |

Este ticket aísla **commit/render React**, no el pipeline de anotación (eso sería otro ticket si hace falta).

## Objetivo

1. **Baseline medible** en `:3300` + túnel `:15432`, US real: longtask / User Timing del gesto (hunt switch o sort) desglosando commit vs filterMs.
2. Si ROI claro (**−≥20 %** longtask del gesto o −≥30 % tiempo de commit marcado), aplicar **un** cambio acotado (p.ej. memo/virtualización ya existente, defer de audits de vista, evitar re-render de cinta/sparks, `startTransition` donde ya hay patrón).
3. Si no hay ROI → solo diag en `research/react-commit-perf-1/`.

## Debe

- Medir antes/después con la misma población (US, mismos hunts).
- No reintroducir FILTER-ANNOTATION (revertido; ROI browser insuficiente).
- Tests focalizados de lo que toques; no suite completa obligatoria.

## No debe

- Workers / off-thread del filtro (FILTER-CPU: NOT JUSTIFIED).
- hydrateRs / chartPreview / theme / scoring / auth.
- Rewrite grande de `app/page.jsx`.
- Commit / push.

## Verifica

```bash
# gestos + lo que toques; ejemplo mínimo:
npx vitest run tests/screenerFilterFastPath.test.js
# + tests de componentes/vista que modifiques
```

Plantilla retorno: Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ.
