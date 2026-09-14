# SCANS-CHARTPREVIEW-1

**Estado:** hecho · `ae5e5d6`  
**Rama:** `codex/statsedge-ui-polish`

## Qué

Omit `chartPreview` del GET `/api/scans` compacto (`chartPreviewTransport: "deferred"`); POST `/api/scans/chart-preview` + hydrate cliente.

## Evidencia

- Probe: −44,7 % JSON (30,7→17,0 MB); gzip 4,9→2,9 MB. `research/scans-chartpreview-1/summary.json`
- API orch: US hydrateRs=0 → **20,5 MB**, transport `deferred`, **0** previews inline.
- Smoke `:3300` US Caza: sparks AVAH/ATAI/ATRC tras hydrate (`smoke-us.png`).
- Tests: 65/65.

## Residual

- Cliente hidrata **todo** `analyzedRows` (no solo página visible) → ~45–90 POSTs; algunos 500 bajo carga Global.
- No medido TTFB cold post-cambio en HTTP real del orch (sí bytes).
