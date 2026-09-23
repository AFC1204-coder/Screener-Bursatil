# CAZA-CHARTPREVIEW-VIEWPORT-1 — hydrate chartPreview solo viewport + buffer

**Estado:** cerrado (orquestador 2026-09-23) · squash `e83c41e` · [#51](https://github.com/AFC1204-coder/Screener-Bursatil/pull/51)  
**Verify:** 28 tests · CI Vercel SUCCESS · smoke Caza PASS (scroll 1×POST ×38 = viewport+buffer)

## Entregado

Ventana Caza = filas visibles + overscan×2 (techo 80). `HuntTapeView` emite `{ start, limit }`; default sin medida ≈25.

## Residual (nota smoke)

Al **entrar** a Caza aún puede haber un batch inicial de **80** (mezcla mesa/`pagedRows` o carrera antes de viewport medido). Scroll aislado confirma acote 38. No es la cola entera (504). Follow-up opcional: no unir mesa en el plan hunt-only.

## No tocado

Scoring, cold payload, Review brief, auth.
