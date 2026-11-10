# FILTER-SESSION-BACK-1 — preservar filtros al back; cold más suave; chart modal

**Estado:** **hecho** · polish `d41edf4` (#57) + TDZ fix `cc60740` (#58)  
**Smoke:** PASS tip #58 `:3300` — mount OK · CORE v4×4 · back conserva custom · Vista rápida chart ~13 s

## Entregado

- B: `preserveCriteria` en restore sesión v4
- A: CORE v4 4 capas; Balanceado más suave; US primero
- C: prefetch/hydrate foco Vista rápida
- Fix: `chartSettings` useState antes de `useQuickReviewSession` (TDZ post-#57)
