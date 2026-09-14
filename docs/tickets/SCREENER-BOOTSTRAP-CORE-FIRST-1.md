# SCREENER-BOOTSTRAP-CORE-FIRST-1

**Estado:** hecho · `61cf593`  
**Rama:** `codex/statsedge-ui-polish`

## Qué

Arranque/load mercados con `hydrateRs=0` → pintar mesa; `hydrateRs=1` en background merge RS país/tema sin wipe.

## Evidencia orch

- Tests 26/26.
- Smoke `:3300` US: primera GET `hydrateRs=0`, luego `=1`; `first_pasan` **558 de 3574**; `wipedAfterCore: false`; marks `T_extended_after_core` ~2,8 s tras core.
- Mesa visible con filas/sparks (`smoke-orch.png`).
- `research/screener-bootstrap-core-first-1/smoke-orch.json`

## Residual

- T_core absoluto sigue ruidoso (túnel; ~19 s en esta smoke hasta pasan).
- Varios GET core (nightly + markets) — posible consolidar después.
- `weekly-changes` timeout aparte (banner naranja).
