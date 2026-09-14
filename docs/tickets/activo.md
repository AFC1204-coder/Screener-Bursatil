# Ticket activo — REACT-COMMIT-PERF-1

**Estado:** prep  
**ID:** REACT-COMMIT-PERF-1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 High  
**Doc:** `docs/tickets/REACT-COMMIT-PERF-1.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md @docs/tickets/REACT-COMMIT-PERF-1.md @FILTER_CPU_1_REPORT.md

Eres programación StatsEdge (NO orquestador). Rama: codex/statsedge-ui-polish.
Modelo: Composer 2.5 High. SIN commit ni push.

Alcance:
1) Baseline :3300 + túnel :15432, US real: longtask/User Timing de un gesto
   (hunt switch o sort) separando commit React vs filterMs.
2) Si ROI claro (−≥20% longtask gesto o −≥30% commit marcado) → UN cambio
   acotado al render/commit (no FILTER-ANNOTATION, no workers).
3) Si no hay ROI → solo diag en research/react-commit-perf-1/.
4) Tests focalizados de lo que toques.

No tocar hydrateRs, chartPreview, theme, scoring, auth, writers.

Verifica: npx vitest run tests/screenerFilterFastPath.test.js (+ tests que toques)
Plantilla Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ. Sin commit ni push.
```

## Notas orquestador

- Prior: FILTER-CPU — annotate + React commit dominan el gesto; filtro ~20 ms.  
- Cerrado justo antes: SCANS-CHARTPREVIEW-1 `f420af6` (omit wire −45 % JSON; sparks OK US).  
- Residual chartPreview: hydrate usa todo `analyzedRows` (~45–90 POSTs); aparcar follow-up.
