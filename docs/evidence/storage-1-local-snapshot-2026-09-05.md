# STORAGE-1 — evidencia (2026-09-05)

## Smoke orquestador (`:3000`, sesión)

| Check | Resultado |
|---|---|
| Hard-reload `/` | Sin banner «No cabe…» / copia local |
| Mesa US | **3315** analizadas · tabla 50 filas |
| `localStorage` `statsedge.scans.v1` | ~2,8 KB · `rows: []` · `rowsStoredRemotely: true` |
| `sessionStorage` remote flag | `1` |
| `/stock/AAPL` | h1 AAPL · página carga |

## Tests

`localScanPersistence` + `storageAlert` + `persistenciaNavegador` → **36 passed**.
