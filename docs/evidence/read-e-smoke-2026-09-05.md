# READ-E — smoke Mini 2026-09-05

Deploy: `lib/chartSettings.js` + `lib/chartViewportModel.js` → Mini · build · kickstart · `next=200`.

## `/stock/AAPL` (localStorage `statsedge.chartSettings.v1` vaciado)

| Check | Resultado |
|---|---|
| AuthGate | No |
| Botón `RS` | `btnActive` |
| Botón `RS país` | `btnGhost` |
| Botón `RS tema` | `btnGhost` |
| Opt-in: click `RS país` | pasa a `btnActive`; resto intacto |
| Click de nuevo | vuelve a OFF |

## Tests (Mac)

`npm test -- tests/chartSettingsScope.test.js tests/chartViewportModel.test.js` → 30 passed.
