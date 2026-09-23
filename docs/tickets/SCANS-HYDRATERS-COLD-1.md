# SCANS-HYDRATERS-COLD-1 — residual cold hydrateRs (~+9 s)

**Estado:** cerrado (orquestador 2026-09-23) · squash `7922c58` · [#53](https://github.com/AFC1204-coder/Screener-Bursatil/pull/53)  
**Verify:** 24 tests · CI SUCCESS · smoke cold US PASS (paint ~19.8s → extended ~20.3s)

## Entregado

Defer agresivo GET `hydrateRs=1` (rAF×2 + idle 600ms) + `priority: low` + merge RS en `startTransition`. Core pinta primero.

## Residual

Sin remeasure TTFB numérico nuevo; dedupe residual 3×core / 2×extended GET sigue abierto.

## No tocado

FIRDS, Twelve Data, scoring, auth, semántica RS writers.
