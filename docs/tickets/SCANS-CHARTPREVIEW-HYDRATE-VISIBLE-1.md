# SCANS-CHARTPREVIEW-HYDRATE-VISIBLE-1

**Estado:** hecho · `c37c9f4`  
**Rama:** `codex/statsedge-ui-polish`

## Qué

Hydrate chartPreview solo desde `pagedRows` + `quickReviewRows` + cola Caza (`rows` filtradas); ya no `analyzedRows`. Evento de sync Caza/Auditoría.

## Evidencia orch (`:3300` + túnel)

- US `558 de 3574`; **3** POST `/api/scans/chart-preview` (200) en sesión (audit/paginación) vs baseline ~45–92 (−≥93 %).
- Tests 13/13.
- `research/scans-chartpreview-hydrate-visible-1/smoke-orch.json`

## Residual

- En Caza, `huntRowsForChartPreviewHydrate` devuelve **toda** la cola filtrada (p.ej. 558), no solo viewport; si molesta, cap a N visibles.
