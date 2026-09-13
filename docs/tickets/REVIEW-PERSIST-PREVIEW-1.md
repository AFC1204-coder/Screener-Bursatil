# REVIEW-PERSIST-PREVIEW-1

**Estado:** hecho (ACCEPT · 2026-09-13)  
**OWNER:** Cursor / Grok 4.7 High o Composer 2.5 High  
**PRIORITY:** P1  
**MODE:** IMPLEMENTACIÓN acotada  
**Cierre:** `persistReviewQueue` conserva preview hasta fallo real de write; strip último recurso + `storageNote`. `mergeReviewRowChartPreviews` en Review/Vista rápida. Tests persistencia 37+ DEFER. Smoke parcial `:3300` reopen sin brief.

## PROBLEM

`persistReviewQueue` puede strippear `chartPreview` bajo cuota (`lib/screenerPipeline.js`), dejando la cola sin miniaturas. Tras DEFER ya no se hidrata desde brief; sin preview el chart parte más frío (solo línea vacía → `/api/chart`).

## EVIDENCE

- BRIEF-CRITICAL: strip por presupuesto / fallback write.  
- Astra A1-S: no recuperar preview vía brief.  
- DEFER: shell no depende de preview; UX de chart sí se beneficia.

## SCOPE

1. Medir cuándo se strippea (overBudget vs fallback) con cola realista.
2. Preferir **conservar `chartPreview`** en la cola review:
   - subir/aislar presupuesto review, o
   - strip solo como último recurso tras liberar otras claves, o
   - passthrough en RAM desde mesa al abrir Review sin re-persistir stripped si la sesión viva aún tiene previews.
3. No romper `reviewSession` identity / signature.
4. Si no cabe: degradación honesta (`storageNote`) sin forzar brief.

## MUST NOT TOUCH

- Contrato `lib/reviewSession.js` (salvo campos ajenos a preview)  
- company-brief / hydrate defer (no revertir)  
- scans API / RS  
- Quota de scans globales sin evidencia

## PASS CRITERIA

- Reabrir Review con cola que antes perdía previews: más filas conservan `chartPreview` **o** degradación documentada solo cuando el presupuesto es imposible.
- Tests de persistencia review PASS.
- Browser: reopen sesión → miniaturas o nota honesta; 0 company-brief.

## TESTS

```bash
npx vitest run tests/reviewSession.test.js
# + test persist preview / budget
```

## STOP CONDITION

- Cambiar semántica de sesión / filtros → STOP.  
- Reintroducir brief para recuperar preview → STOP.  
- Refactor amplio de storage → STOP.

## DEPENDENCIES

- Cerrar **REVIEW-CHART-PARALLEL-1** antes (evita ownership cruzado en Review UX).  
- DEFER-1 hecho.
