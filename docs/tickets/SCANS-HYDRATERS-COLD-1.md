# SCANS-HYDRATERS-COLD-1 — residual cold hydrateRs (~+9 s)

**Estado:** prep · programación en Agent chat aparte  
**Rama base:** `codex/statsedge-ui-polish` @ `dadcba1`  
**Rama trabajo:** `cursor/hydrate-rs-cold-a41e`  
**Modelo:** Composer  
**Tamaño:** S–M (closable)  
**Cola fricción:** #2 (tras CAZA-CHARTPREVIEW-ENTRY-1 / #52)

## Problema

Tras REUSE (`SCANS-RS-COUNTRY-REUSE-1`) + THEME-HTTP + **BOOTSTRAP core-first** (`SCREENER-BOOTSTRAP-CORE-FIRST-1`), el overhead frío de `hydrateRs=1` bajó **+27,6 s → +9,3 s** (−66 %), pero en cold US la sensación sigue siendo «se queda pensando»: mesa/core ya pintan, columnas RS país/tema o el hilo siguen pesados varios segundos.

Baseline documentado (backlog · `f4695aa`, :3300, US ~3576, túnel UP):

| Métrica | Valor |
|---|---|
| cold extended TTFB | **17 861 ms** |
| cold core TTFB | **8 586 ms** |
| **delta hydrateRs** | **+9 275 ms** |
| warm extended | ~203 ms |

WAVE5 (`research/wave5-remeasure-2026-09-14/`): JSON deferred ~20,5 MB · gzip ~3,3 MB; TTFB ruidoso; **hydrateRs no debe bloquear el primer paint**. Residual BOOTSTRAP: varios GET core (nightly + markets); `T_core` absoluto ruidoso por túnel.

## Objetivo

1. **Primer paint / mesa usable** nunca espera `hydrateRs=1` (contrato BOOTSTRAP intacto o endurecido).  
2. **Recortar** trabajo server/cliente del path extended post-bootstrap **o diferir más agresivo** (idle / idle-after-paint / no competir con primer render).  
3. **Medir** TTFB cold core vs extended y delta hydrateRs con harness existente; documentar before/after.

## Alcance (S–M)

| # | Cambio |
|---|---|
| 1 | Auditar arranque: `getLatestScanFromCloud*` / `*Extended` + `scheduleExtendedRsHydration` — confirmar que `restoringScan` / primer paint no dependen del GET `hydrateRs=1` |
| 2 | Recorte **o** defer más agresivo del trabajo extended (p. ej. `requestIdleCallback` / micro-delay post-core, cancelar fetches duplicados nightly+markets, no re-merge masivo que trabe el hilo). Elegir **una** palanca closable con evidencia; no refactor RS |
| 3 | Remeasure: reutilizar probes en `research/screener-bootstrap-core-first-1/` y/o `research/wave5-remeasure-2026-09-14/` (o copia bajo `research/scans-hydraters-cold-1/`). Anotar TTFB core, TTFB extended, **delta**, warm |
| 4 | Tests: contrato bootstrap (`tests/screenerBootstrapCoreFirst.test.js`, `tests/cloudSyncClientStartupRequest.test.js`) + lo que toque el defer/recorte; no ensanchar suite |
| 5 | Nota smoke para orquestador (abajo) |

## Fuera de alcance

- FIRDS on · Twelve Data / Hito 1B  
- Semántica / writers / `engine_version` RS (country/theme/global)  
- Gzip transporte, cold payload omit fields (ya #46), chartPreview Caza  
- Scoring / nocturno US / auth / licencia / Mini V1  
- Merge a polish (orquestador tras smoke)

## Archivos / harnesses probables

- `lib/scansRsBootstrap.js` · `lib/cloudSyncClient.js` · `app/page.jsx` (beginExtendedRsHydration)  
- Server hydrate path solo si el remeasure apunta a trabajo post-REUSE/THEME aún caro (`lib/scansRsHydration.js`, theme/country hydrate) — **mínimo**  
- `research/screener-bootstrap-core-first-1/probe.mjs` · `research/wave5-remeasure-2026-09-14/probe.mjs` · `research/scans-rs-theme-http-1/`  
- Tests: `screenerBootstrapCoreFirst` · `cloudSyncClientStartupRequest` · `scansApiRsHydrateDefer` si toca API

## Verify (programación)

```bash
nc -zv 127.0.0.1 15432   # antes de medir live; si caído → unitarios + LO QUE NO VERIFIQUÉ
npx vitest run tests/screenerBootstrapCoreFirst.test.js \
  tests/cloudSyncClientStartupRequest.test.js
# + tests tocados (p.ej. scansApiRsHydrateDefer)
# Remeasure (túnel UP + :3300 preferido):
#   node research/screener-bootstrap-core-first-1/probe.mjs
#   y/o node research/wave5-remeasure-2026-09-14/probe.mjs
./vfc   # si toca paths del gate; no ampliar suite
```

Plantilla de retorno. **Sin merge a polish.** Commit+push solo en `cursor/hydrate-rs-cold-a41e` (+ PR draft si cloud).

## Smoke (orquestador, Browser Use · `:3300` preferido)

1. Hard-reload cold US (`/`).  
2. Mesa / truth visibles **antes** de que RS país/tema estén completos (sin wipe; sin «pensando» bloqueante en chrome).  
3. Tras merge extended: columnas RS coherentes; sin wipe de filas.  
4. Anotar: status/pasan, sensación T_core vs llegada RS, ms si hay marks `statsedge:T_*`.

## Criterio done

- Diff acotado a bootstrap/defer/recorte hydrateRs (+ tests + nota research).  
- Evidencia before/after delta o T_extended_after_core (o explicación honesta si túnel ruidoso).  
- Tests OK.  
- Smoke orch OK → orquestador merge/commit polish + actualizar residual hydrateRs en backlog.

## Precedencia

- Hecho: `SCANS-RS-HYDRATE-1` · `SCANS-RS-COUNTRY-REUSE-1` · `SCANS-RS-THEME-HTTP-1` · `SCREENER-BOOTSTRAP-CORE-FIRST-1` · `SCREENER-COLD-PAYLOAD-1`  
- Cola fricción #1 hecho: `CAZA-CHARTPREVIEW-ENTRY-1` (`dadcba1` / #52)
