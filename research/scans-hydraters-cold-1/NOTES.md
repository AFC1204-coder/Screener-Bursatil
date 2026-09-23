# SCANS-HYDRATERS-COLD-1 — notes

**HEAD (work):** `cursor/hydrate-rs-cold-a41e`  
**Baseline polish tip:** `dadcba1` / docs activate `63b1bc6`

## Palanca elegida

**Defer agresivo del GET `hydrateRs=1` post-core** (no recorte server):

1. `scheduleExtendedRsHydration` espera **post-paint (doble rAF) + `requestIdleCallback`** (timeout 600 ms) antes de llamar `fetchExtended`. Si se cancela durante el idle, no hay fetch.
2. Extended GETs en `cloudSyncClient` llevan `priority: "low"` (Fetch Priority) para no competir con paint/core.
3. Merge de columnas RS en `page.jsx` vía `startTransition` para no bloquear interacciones tras el paint de core.

Contrato BOOTSTRAP intacto: arranque sigue `hydrateRs=0` primero; `restoringScan` se baja en el `finally` del core (no espera extended).

## Baseline documentado (antes · backlog / REUSE)

| Métrica | Valor |
|---|---|
| cold extended TTFB | 17 861 ms (`f4695aa`, :3300, túnel UP) |
| cold core TTFB | 8 586 ms |
| **delta hydrateRs** | **+9 275 ms** |
| warm extended | ~203 ms |

Smoke BOOTSTRAP orch (`research/screener-bootstrap-core-first-1/smoke-orch.json`): `T_extended_after_core` ~2,8 s; **3 GET core + 2 GET extended** (residual de doble load nightly/markets — no tocado en este ticket).

## Remeasure live

**No ejecutado en este agent:** túnel `:15432` y `:3300`/`:3000` **DOWN** (connection refused).

Para orquestador / re-run:

```bash
# túnel Mini UP + next start aislado :3300
node research/screener-bootstrap-core-first-1/probe.mjs
# y/o
node research/wave5-remeasure-2026-09-14/probe.mjs
```

Esperado: **delta TTFB server core vs extended ≈ sin cambio** (esta palanca no recorta trabajo PostgREST). Beneficio = paint usable sin competencia del kickoff extended + merge no urgente en transición. Anotar `statsedge:T_extended_after_core` tras smoke Browser Use.
