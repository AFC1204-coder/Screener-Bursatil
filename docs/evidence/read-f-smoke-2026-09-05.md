# READ-F — smoke Mini 2026-09-05

Deploy: `ChartIdentityCard.jsx` + `lib/chartIdentityCard.js` → Mini · build · kickstart · `next=200`.

## `/stock/AAPL`

| Check | Resultado |
|---|---|
| AuthGate | No |
| `.chartIdCardRsLabel` | `RS` |
| Fila | `RS 64 universo Máx. 52s…` |
| `\bFR\s+\d` en body | **No** |

## Tests (Mac)

`npm test -- tests/fichaRetiradas.test.js tests/descriptiveStrip.test.js` → 61 passed.
