# REACT-COMMIT-PERF-1

**Estado:** hecho · `b7a6267`  
**Rama:** `codex/statsedge-ui-polish`

## Qué

Agregados de auditoría de vista diferidos con `useDeferredValue(viewFilteredRows)` + `viewAuditBundle` y `performance.measure("screener:viewAudit")`. Tabla/sort siguen síncronos.

## Evidencia

- Before LT max: hunt **1838 ms**, Momentum **1578 ms**
- After (1 rep): **989 ms** (−46 %), **941 ms** (−40 %); `viewAuditMs` 140–261 ms diferido
- `research/react-commit-perf-1/summary.json`
- Smoke orch: US `558 de 3574` → hunt Cerca de pivot `26 de 3574`; 0 pageerrors
- Tests: 11/11

## Residual

- A/B con `PERF_REPS=1`; conviene ≥3 reps
- Truth line ya no expone `filterMs`
