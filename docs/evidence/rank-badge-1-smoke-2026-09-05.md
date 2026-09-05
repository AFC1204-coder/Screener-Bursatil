# RANK-BADGE-1 / 1b — smoke Mini 2026-09-05

## Fix

1. `ScreenerShell`: badge solo si `percentileScope === "batch"` explícito.
2. `scanDecisionProjection`: ausente → `null` (no inventar `"batch"`).

## Verify

- vitest banner + projection + materializedProgress: 55 passed
- `./vfc`: 2685 passed · lint OK
- Deploy Mini: projection + shell · `npm run build` · kickstart · next=200
- Runtime Mini: `missingMetrics:null`, `restored:undefined`, `batch:"batch"`

## Smoke Browser Use `:13000`

- Mesa con líderes; badge **sí** visible.
- Tickers de DB con `percentileScope=batch` en vista: HNGE, DK, APGE, SOPH, NEO, NRIX, SB (entre otros).
- Residual **honesto**: ~83 filas US con batch explícito (sin finalize RPC en pg). No es el invento de ~3236 missing.
- Cierre de inventar batch: cubierto por tests + runtime projection; el badge ya no se dispara por ausentes.

## Fuera (mañana Mini)

- `finalize_scan_results` en modo pg → marcar `final` y vaciar el residual de 83.
