# Ticket activo — REVIEW-CHART-PARALLEL-1 (prep)

**Estado:** prep  
**Orden:** 1) CHART-PARALLEL → 2) PERSIST-PREVIEW  
**Ticket:** `docs/tickets/REVIEW-CHART-PARALLEL-1.md`  
**Siguiente:** `docs/tickets/REVIEW-PERSIST-PREVIEW-1.md` (no lanzar hasta cerrar #1)  
**Rama:** `codex/statsedge-ui-polish` @ ≥ `f6eae85`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/REVIEW-CHART-PARALLEL-1.md

Rama: codex/statsedge-ui-polish (HEAD ≥ f6eae85 DEFER).
Modelo: Composer 2.5 High.

Alcance: asegurar T1 chart (+ rs-weekly si hace falta) al cambiar símbolo en Rapid Review, en paralelo al shell. Astra A2-CHART: error OHLC explícito; 0 company-brief. Primero medir gap post-DEFER; si RowPriceChart ya basta, documentar y solo fijar dobles fetch / rs-weekly / error UI.

MUST NOT TOUCH: reviewSession, brief/hydrate, A1-S (no recalc métricas), persistReviewQueue (PERSIST-PREVIEW-1), chart-controller refactor grande.

PASS: evidencia de red + tests; smoke si hay diff producto. Sin commit ni push.

Devuelve plantilla de retorno del orquestador.
```
