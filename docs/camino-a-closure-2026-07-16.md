# Cierre formal de Camino A — sesión 2026-07-16

> Estado: cierre humano explícito. **No** autoriza push, deploy, scans,
> llamadas a producción ni escrituras en Supabase.

## 1. Aprobación humana

El usuario aprobó explícitamente el cierre de Camino A en la sesión del
2026-07-16, con las siguientes condiciones, todas verificadas en este
commit:

- Cierre local (commits) sin push.
- Cero modificaciones fuera del alcance delimitado.
- Pruebas relevantes en verde antes de cada commit.
- Sin escrituras en producción.

Este documento registra esa aprobación, pero **no es ella**: la
aprobación fue otorgada por el usuario en el chat; este archivo es su
trazabilidad.

## 2. Divergencias

- **Divergencias pendientes:** 0.
- **Divergencias aceptadas:** 8 (recogidas y resueltas dentro de los 4
  commits previos del scope, ver §3).

## 3. Commits del scope (en orden)

1. `d577fa5` — `fix(scoring): harden pattern contribution override`.
2. `d425d83` — `fix(scan): enforce decision-grade materialized rows`.
3. `642774f` — `fix(leaderboards): disclose batch percentile scope`.
4. `b9ba723` — `test(audit): record scoring-pipeline coherence baseline`.

Los hashes anteriores son los del branch `codex/statsedge-ui-polish`
al cierre de esta sesión.

## 4. Referencias documentales

- **Contrato de auditoría:**
  [`docs/audit-score-coherence-contract.md`](audit-score-coherence-contract.md).
  Define las invariantes auditable del pipeline de scoring y deja
  explícito que *no* declara Camino A cerrado.
- **ADR del pipeline canónico:**
  [`docs/adr-scoring-pipeline-canon.md`](adr-scoring-pipeline-canon.md).
  Refleja el estado tras los 4 commits: `chartEstimated` ya forma
  parte del contrato, el guardrail de Ruta C vive en
  `materializedScanner.buildResearchRow` y los percentiles por lote
  son guardrail de fiabilidad (no señal de trading).

## 5. Verificación de prioridades

- **P1 — scoring coherente y endurecido:** verificado en
  `tests/scoringEngine.test.js` (161/161) y paridad engine↔golden en
  los 3 usos de producción del override.
- **P2 — filas materializadas decision-grade:** verificado en
  `tests/researchRowContract.test.js` (7/7) y
  `tests/researchRowDecisionGrade.test.js` (2/2).
- **P3 — disclosure del scope de percentil por lote:** verificado en
  `tests/leaderboardPercentileScope.test.js` (10/10) y
  `tests/screenerPercentileScopeBanner.test.js` (8/8), además de las
  cuatro capturas de evidencia visual real (§6).

## 6. Evidencia visual real P3

Cuatro capturas validadas, todas copiadas bit-a-bit desde el staging
de la sesión (`2026-07-16/ready-para-que-hagas-el-preflight/docs/`) a
`docs/` del repositorio:

- `docs/evidence-p3-preflight-batch50.png` — preflight muestra
  *Estados Unidos, 5864 tickers, filtro Balanceado, 50 tickers por
  lote*. Es el estado que activa los percentiles parciales.
- `docs/evidence-p3-before-reload.png` — la franja
  *"MUESTRA PARCIAL · PERCENTIL POR LOTE"* aparece en la lista visible
  antes del reload (estado fresco del scan).
- `docs/evidence-p3-post-reload.png` — tras un hard-reload, el estado
  lee *"Sesión restaurada: 7 acciones en el screener"* y la franja P3
  sigue presente.
- `docs/evidence-p3-expanded-post-reload.png` — la franja P3 está
  expandida y su texto es legible: *"Estas filas se conservan, pero
  sus percentiles se calcularon sobre un lote menor y pueden cambiar
  al finalizar el universo. En empates, las filas con percentil final
  aparecen primero."*

## 7. Lo que NO se hizo en este cierre

- **Camino B no se inició.** No hay commits de scaffolding, no hay
  ramas nuevas, no hay merges.
- **Replay UI no se implementó.** El snapshot sticky y el reset siguen
  funcionando como antes; este cierre solo documenta la evidencia que
  ya existía en producción.
- **No se introdujeron señales nuevas.** El registry tiene las mismas
  claves que antes de Camino A; el override endurecido es un cambio de
  contrato del compute, no una señal nueva.
- **El addendum de RS global** (`docs/addendum-rs-global-basecurrency-v3.2.md`)
  **es solo diseño.** Documenta un eventual RS global con moneda base,
  pero **no autoriza implementación**: queda pendiente de una sesión
  posterior y de una decisión humana separada.

## 8. Límite de este cierre

Este cierre formal de Camino A **no autoriza** ninguna de las
siguientes acciones, que requieren una aprobación humana explícita y
separada:

- `git push` del branch `codex/statsedge-ui-polish`.
- Despliegues o releases.
- Scans (`scan-refresh`, `shadow-europe-refresh`,
  `leaderboards-refresh`).
- Llamadas a producción o escrituras en Supabase.
- Cualquier modificación del entorno productivo.

Cualquiera de esas acciones cae fuera del scope de Camino A y debe
tramitarse como una sesión distinta.
