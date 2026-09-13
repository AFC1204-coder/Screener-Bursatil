# REVIEW-HYDRATE-DEFER-1

**Estado:** hecho (ACCEPT · 2026-09-13)  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P0 (post Astra T0/T1/T2)  
**MODE:** IMPLEMENTACIÓN  
**Cierre:** sin `hydrateReviewRow`/brief síncrono; fila = sesión; banner lateral retirado; chart T1 propio. Tests 44 PASS. Browser `:3300`: AAA→BBB, **0** `company-brief`, banner ausente, `/api/chart` sí.

## DECISIONES ASTRA (vinculantes · 2026-09-13)

| ID | Decisión | Implicación |
|---|---|---|
| **A1-S** | Métricas técnicas = **snapshot de sesión** | No recalcular desde `/api/chart` en este ticket. Conservar ausencias. |
| **A2-CHART** | Banner / «stable» = espera **OHLC T1** | Brief **nunca** bloquea. Error de chart → estado explícito, no «stable». |
| **A3-OMIT** | No RS Quality / speculationRisk del brief | No mostrar; **no mergear** desde brief. RS canónico = sesión (`weeklyRs*`). |
| **A5-ABSENT** | Sin `weeklyRs*` → «Sin dato» + motivo | No CTA obligatorio a Ficha. |

Fuente: respuesta Astra pegada al orquestador · doc `ASTRA-REVIEW-BRIEF-T0T1T2.md`.

## PROBLEM

`hydrateReviewRow` bloquea Rapid Review en `GET /api/company-brief` (2–6 s). El banner «Cargando histórico y métricas…» y el criterio de usable dependen del brief aunque RS/etapa/métricas ya están en la fila de sesión.

## EVIDENCE

- REVIEW-BRIEF-CRITICAL-1 ACCEPT DESIGN  
- Gate `alreadyUsable` + `activeHydrating` en `app/review/page.jsx`  
- `hydrateReviewRow` fetch brief + merge (incluye RS scores del brief — cortar)  
- REVIEW-REFETCH-1 cerrado (OK tocar `app/review/*`)

## SCOPE

1. Eliminar el path síncrono que espera `company-brief` para considerar la fila usable / quitar banner de brief.
2. Banner / loading de chart atado a carga OHLC T1 (`RowPriceChart` / `/api/chart`), no a brief.
3. Dejar de mergear desde brief: `rsRating`, `rsQualityScore`, `speculationRiskScore` y demás RS no-canónicos; no sobrescribir métricas de sesión con `deriveTechnicalFromBars` (A1-S).
4. T0: render con fila de sesión; ausencia RS vía `rsCanonical` / copy «Sin dato» (A5).
5. Brief: no disparar en el critical path. Si se mantiene fetch diferido en background para logo/nombre faltante, debe ser **opt-in mínimo** y **nunca** gatear banner/stable; preferible diferir enriquecimiento a ticket T2 / Ficha si ensancha el diff.
6. Tests: unit/contrato del gate (sin brief → usable con sesión; banner no ligado a hydration brief; no merge RS brief).

## MUST NOT TOUCH

- `lib/reviewSession.js` contrato de identidad  
- Scoring engine, writers RS, nocturno, `assertDecisionGrade`  
- Prefetch masivo de briefs  
- `REVIEW-PERSIST-PREVIEW-1` (presupuesto chartPreview) salvo lo mínimo para no forzar brief  
- Theme RS / scans hydrate  
- Recalc métricas desde chart (A1-C/H rechazados)

## PASS CRITERIA

- Cambiar ticker en Review: **0** `GET /api/company-brief` en el camino hasta shell usable + (banner solo si chart T1 pendiente).
- Shell muestra RS/etapa/métricas de sesión sin esperar brief.
- No se escriben en la fila campos RS del brief (`rsQualityScore`, `speculationRiskScore`, `rsRating` desde brief).
- Error `/api/chart` → mensaje explícito; no se reporta como stable.
- Tests nuevos/actualizados PASS.
- Browser smoke (orquestador): hard-reload `/review` con sesión; ticker nuevo sin brief bloqueante.

## TESTS

```bash
npx vitest run tests/reviewSession.test.js tests/screenerReviewLaunch.test.js
# + tests nuevos del defer / gate / no-merge RS
```

Browser: instancia aislada preferible (`:3300` si sigue arriba).

## STOP CONDITION

- Reintroducir espera de brief para «stable» → STOP.  
- Recalcular métricas desde barras → STOP (viola A1-S).  
- Tocar identidad de sesión Review → STOP.  
- «Ya que estoy» prefetch N+1 o split API brief → ticket aparte.

## DEPENDENCIES

- Astra A1–A5 arriba.  
- REVIEW-REFETCH-1 hecho.  
- HEAD ≥ `92927c9`.

## FUERA DE ESTE TICKET (siguiente)

- `REVIEW-CHART-PARALLEL-1` — si tras defer el chart aún no arranca al cambiar símbolo  
- `REVIEW-PERSIST-PREVIEW-1` — preservar miniaturas en cola  
- Prefetch N+1 solo chart  
- T2 brief / Ficha
