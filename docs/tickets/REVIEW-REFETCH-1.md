# REVIEW-REFETCH-1

**Estado:** hecho (ACCEPT DIAGNÓSTICO · 2026-09-13)  
**OWNER:** Cursor / Grok 4.7 High  
**PRIORITY:** P1 (quick win Wave5)  
**MODE:** DIAGNÓSTICO → impl solo si causa inequívoca y localizada  
**Cierre:** 0 `/api/scans` en Review/reopen; residual = remount `app/page.jsx` (nightly-us + markets). Sin patch producto. Candado `tests/screenerReviewLaunch.test.js`. Futuro: SCREENER-REMOUNT-SCANS / keep-alive mesa.

## PROBLEM

Tras REVIEW-SESSION-1, reabrir Rapid Review conserva cola/foco/identidad, pero todavía se observan **1–2 llamadas residuales a `/api/scans`**. Hay que eliminar o justificar cada una.

## EVIDENCE

- REVIEW-SESSION-1 DONE (`734385d`…`a34707f`): sesión estable vía `lib/reviewSession.js` + `STORAGE_KEYS.review` + `scanSettingsSignature`.
- Browser gate: mismo tamaño/orden/foco/URL/`sessionIdentity`; residual = refetch scans al reabrir.
- No seguir “mejorando” el contrato de sesión en este ticket.

## SCOPE

1. Reproducir en browser (preferible instancia aislada bundle actual) reopen de sesión Review válida.
2. Listar cada request `/api/scans` (URL completa, initiator stack o caller en código, cold/warm).
3. Clasificar: necesario (datos ausentes/stale) vs redundante (sesión ya válida).
4. Si redundante y el call site es claro (p.ej. effect sin guard de sesión válida) → patch mínimo.
5. Si ambiguo o requiere cambiar cuándo se considera válida la sesión → solo diagnóstico.

## MUST NOT TOUCH

- Contrato `lib/reviewSession.js` (identidad, signature, restore semantics) salvo bug inequívoco de refetch **fuera** de ese contrato
- Scoring / RS / nocturno / company-brief payload
- `app/api/scans` hydrate/gzip
- FILTER-ANNOTATION

## PASS CRITERIA

- Inventario de las 1–2 llamadas con caller + justificación.
- Si impl: reopen sesión válida → **0** `/api/scans` innecesarios (o 1 documentado como obligatorio con motivo).
- Tests existentes `tests/reviewSession.test.js` (+ los que toques) PASS.
- Browser: cola/foco/`sessionIdentity` intactos (no regresión REVIEW-SESSION-1).

## TESTS

- `npx vitest run tests/reviewSession.test.js tests/screenerReviewLaunch.test.js`
- Browser reopen smoke (orquestador verificará si hay impl)

## STOP CONDITION

- Touch al contrato de identidad de sesión → STOP; devolver diagnóstico.
- “Aprovechar” para prefetch brief / chart → fuera de alcance.
- Si la causa vive en sync global del screener y el fix es amplio → diagnóstico + propuesta; no refactor.

## DEPENDENCIES

- REVIEW-SESSION-1 en HEAD.
- No solapar escritura con REVIEW-BRIEF-CRITICAL-1 sobre `app/review/*` hasta cerrar este ticket si BRIEF necesita instrumentar Review.

## PARALELISMO

- OK en paralelo con SCANS-RS-HYDRATE-1 (ownership distinto).
- BRIEF puede leer código Review en paralelo; **no** instrumentar/modificar `app/review/*` hasta cierre de este ticket.
