# SCREENER-TRUTH-MARKET-PCT-1 — % / conteo por mercado en truth line

**Estado:** cerrado (orquestador 2026-09-22) · squash `807b283` · [#50](https://github.com/AFC1204-coder/Screener-Bursatil/pull/50)  
**Verify:** 106 tests (marketAvailability + screenerTruthLine) · CI Vercel SUCCESS

Cola encadenada (cold → sparks → ficha → Europa depth → truth %) **cerrada**.

## Alcance (entregado)

1. Cuando la mesa tiene **≥2 mercados**, truth line incluye **conteo por mercado** (filas analizadas vía `country` / `countryCode`).
2. **% selección→mesa** solo con selección multi-mercado y cobertura parcial (sin inventar universo FIRDS).
3. Reuso `screenerTruthLine` / `marketAvailability`; compact en móvil.
4. Tests focalizados OK.

## No tocado

FIRDS on, cold payload, ficha brief, nocturno US, scoring, auth.
