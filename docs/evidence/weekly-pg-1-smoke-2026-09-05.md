# WEEKLY-PG-1 — smoke Mini 2026-09-05

## Fix

1. Scans: `select=…,settings` + `scanProgressStatus()` (sin alias `progress_status:…`).
2. Rows: `LIGHT_ROW_SELECT=symbol,company_name,theme,metrics` + `normalizeRow` lee metrics.

## Verify

- vitest weeklyChanges* : 28 passed
- `./vfc`: 2695 passed · lint OK
- Deploy Mini + rebuild + kickstart

## Smoke

| Check | Resultado |
|---|---|
| `GET /api/weekly-changes?refresh=1` (sesión) | **200** · `state:ok` · 567 ms |
| stage2 | 51 entradas · 116 salidas |
| highs | 5 nuevos · 61 ya cerca |
| window | 2026-08-28 → 2026-09-01 |
| Franja `/` | `Desde el vie 28 ago · Etapa 2: 51 entradas, 116 salidas · Máximos… · ver detalle` |
| Error «no disponibles» | **No** |
