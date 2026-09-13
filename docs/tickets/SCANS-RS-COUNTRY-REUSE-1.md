# SCANS-RS-COUNTRY-REUSE-1

**Estado:** prep  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P0 (post SCANS-RS-HYDRATE-1)  
**MODE:** IMPLEMENTACIÓN acotada

## PROBLEM

En `hydrateRs=1`, `readCountryRsForSymbols` re-lee RS US vía `readGlobalRsForSymbols(..., { bulkSnapshot: false })` con el **mismo** `engine_version` que el RS global ya cargado en core (`US_COUNTRY_RS_ENGINE_VERSION === US_EQUITY_RS_ENGINE_VERSION`). Eso añade ~224 peticiones PostgREST (~11–19 s) al TTFB frío US sin ganar semántica nueva.

## EVIDENCE

- `SCANS_RS_HYDRATE_1_REPORT.md` + `research/scans-rs-hydrate-1/query-model.mjs` (3576 → +224 country US + +48 theme).
- Código: `lib/countryRsHydrate.js` L121–124; `lib/rsEngines.js` alias engines.
- TTFB frío MEASURED (SCANS-PAYLOAD-1): core 17,3 s vs extended 44,9 s.

## SCOPE

1. En `readScanRowHydration` (extended): pasar el mapa `weeklyRs` (o `bySymbol`) ya leído a `readCountryRsForSymbols` para símbolos US.
2. En `readCountryRsForSymbols`: si hay mapa reutilizable para US y engine coincide, **no** llamar `readGlobalRsForSymbols` de nuevo; remapear entradas a la forma que espera `attachWeeklyCountryRs`.
3. Tests: contrato hydrate existente + test de que US country no dispara N chunks cuando se pasa el mapa (mock PostgREST / spy).
4. Opcional mismo PR si trivial: incluir `rsHydrationMode` en `cacheKey` de `/api/scans` (hallazgo #4 del informe) — solo si no ensancha el diff; si duda, ticket aparte.

## MUST NOT TOUCH

- Writers / motores RS, `engine_version`, ranking, nocturno
- Semántica de exclusión / ausencia country RS intl
- Path intl `readEngineCountryRsForSymbols` (salvo no romperlo)
- Theme RS hydrate (fuera de este ticket)
- gzip transporte, FILTER-ANNOTATION, reviewSession

## PASS CRITERIA

- Con túnel `:15432` UP + `next start` aislado: cold `hydrateRs=1` US muestra **caída clara** vs baseline previo (objetivo orientativo: −≥10 s o −≥150 HTTP a `rs_weekly_items` en path US country). Documentar números before/after.
- Campos `weeklyCountryRs*` / motivos de ausencia **idénticos** a baseline para muestra US (test o comparación de N símbolos).
- `npx vitest run tests/scansApiRsHydrateDefer.test.js` + tests nuevos PASS.
- Diff centrado en `countryRsHydrate` + caller hydration (± cacheKey).

## TESTS

- `nc -zv 127.0.0.1 15432` (obligatorio antes de medir)
- `npx vitest run tests/scansApiRsHydrateDefer.test.js` (+ nuevos)
- `node research/scans-rs-hydrate-1/probe.mjs` o equivalente before/after
- Opcional: `node research/scans-rs-hydrate-1/query-model.mjs 3576` → countryUsDuplicateGlobal.totalHttp = 0 tras fix (si el modelo se actualiza)

## STOP CONDITION

- Si reutilizar el mapa cambia ratings/motivos vs re-read → STOP / NEEDS ASTRA (no “aproximar”).
- Si el fix requiere tocar writers o persistir RS en metrics → STOP (#6 del informe).
- Si túnel caído: no declarar PASS de perf; dejar patch + tests unitarios y marcar LO QUE NO VERIFIQUÉ.

## DEPENDENCIES

- SCANS-RS-HYDRATE-1 ACCEPT.
- Túnel Mini para gate de perf del orquestador.
