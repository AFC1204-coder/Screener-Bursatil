# CHART-BADGE-2 — smoke Mini 2026-09-05

Host: `http://127.0.0.1:13000/stock/AAPL`  
Deploy: `useChartController.js` + `StockClient.jsx` · `npm run build` · kickstart · next=200.

## Smoke

| Check | Resultado |
|---|---|
| `.universalChartPatternBadge` | **1** |
| Texto | `BASE CONSTRUCTIVA 12.9% -> 4.9%` |
| Vacío «Sin validar / Estructura sin dato» | No |
| Canvas | OK (7) |

## Tests (Mac)

`npm test -- tests/chartController.test.js tests/methodologyDisplay.test.js` → 22 passed.
