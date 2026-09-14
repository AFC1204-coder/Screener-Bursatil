# SCANS-CHARTPREVIEW-HYDRATE-STABLE-1

**Estado:** hecho · `921b9f5`  
**Rama:** `codex/statsedge-ui-polish`

## Qué

Cap Caza top 80 · apply `onChunk` · efecto por firma de símbolos (no cancel por identidad `rows`) · retry 1× por chunk.

## Evidencia orch

- Tests 16/16.
- Smoke US Caza `:3300`: **1** POST chart-preview (200); **80** SVG sparks; `missingEls: 0`; `558 de 3574`.
- `research/scans-chartpreview-hydrate-stable-1/smoke-orch-2.json`

## Residual

- Scroll profundo Caza &gt;80: aún sin hydrate por viewport de cinta.
