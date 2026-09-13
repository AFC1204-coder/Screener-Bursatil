# SCANS-RS-HYDRATE-1

**Estado:** prep  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P0.5 (principal Wave5)  
**MODE:** INVESTIGATE ONLY (sin fix estructural salvo hallazgo trivial y localizado)

## PROBLEM

`hydrateRs=1` añade poco tamaño (~0,58 MB) pero puede añadir **decenas de segundos** al TTFB frío de `/api/scans`. Es el principal candidato de latencia de bootstrap del screener. Gzip (`91ae6e4`) ya reduce wire; **no** arregla este TTFB.

## EVIDENCE

- Mediciones Wave0–4 / SCANS-PAYLOAD-1: dataset US ~3576 filas; HTTP compact+hydrateRs ~34,7 MB lógico.
- Lectura jsonb por túnel observada ~6,2 s; stringify ~0,7 s; el resto del frío se atribuye en gran parte a hydrate RS extended.
- Producto usa `hydrateRs=1` desde `lib/cloudSyncClient.js` (mesa necesita RS país/tema MET-2/3).
- Contrato existente: `lib/scansRsHydration.js`, tests `tests/scansApiRsHydrateDefer.test.js`.

## SCOPE

1. Medir breakdown real (warm/cold) del path `/api/scans?...&hydrateRs=1` en entorno local con túnel Mini `:15432` UP.
2. Separar: DB read jsonb · hydrate RS (qué lecturas/joins) · stringify · gzip opcional · waiting on locks/cache.
3. Identificar si el coste es N× lookup, cache miss, serialización, o trabajo innecesario por fila.
4. Entregar hipótesis de fix **mínimo** rankeadas por riesgo; **no implementar** cambio de semántica RS.
5. Si aparece un fix trivial (p.ej. doble trabajo, await innecesario, log spam) y PASS criteria de no-regresión son claros → puede ser un patch ≤~30 líneas **solo tras** evidencia en el reporte; si hay duda → STOP y dejar para orquestador.

## MUST NOT TOUCH

- Readers / motor RS canónico (scoring, country/theme RS writers, `assertDecisionGrade`)
- Semántica / versionado de ratings RS
- `daily_bars` guards, nocturno US, frontera 04:00 UTC
- `91ae6e4` gzip path (no retocar transporte)
- REVIEW-SESSION / `lib/reviewSession.js`
- FILTER-ANNOTATION (revertido; no reintroducir)

## PASS CRITERIA

- Reporte con números reproducibles (comandos + timings) cold vs warm, con/sin `hydrateRs=1`.
- Atribución ≥70% del delta TTFB a fases concretas (no “parece lento”).
- Lista de intervenciones candidatas con: beneficio esperado · archivos · riesgo RS · necesita Astra sí/no.
- Cero cambios a semántica de campos `weekly*Rs*` expuestos al cliente, salvo bug inequívoco documentado.
- Si hubo patch trivial: tests de hydrate existentes PASS + diff ≤ alcance declarado.

## TESTS

- `npx vitest run tests/scansApiRsHydrateDefer.test.js` (y cualquier test tocado)
- Precheck: `nc -zv 127.0.0.1 15432`
- Medición propia documentada (script en `research/` OK si untracked o bajo `research/scans-rs-hydrate-1/`)

## STOP CONDITION

- Cualquier cambio que altere significado, engine_version, o ranking RS → **STOP / NEEDS ASTRA**.
- Refactor de proyecciones / nuevo motor de filtrado server → STOP.
- Si el cuello resulta ser PostgreSQL/túnel y no hydrate → documentar y STOP (no “optimizar a ciegas”).

## DEPENDENCIES

- Túnel Mini `:15432` UP; dataset materializado reciente.
- Baseline HEAD ≥ `1748738` (post revert annotation + gzip KEEP).

## LO QUE NO ES ESTE TICKET

- Eliminar `chartPreview` (SCANS-CHARTPREVIEW-1 aparcado).
- React commit perf.
- Integrar de nuevo FILTER-ANNOTATION.
