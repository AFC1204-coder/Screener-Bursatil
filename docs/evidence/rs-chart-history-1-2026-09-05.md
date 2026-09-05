# Evidencia — RS-CHART-HISTORY-1 / 1b / 1c (2026-09-05)

## Problema

Mini: pin `statsedge-private-global-rs-usd-v1` con **1** semana; legacy `statsedge-global-rs-usd-v1` con **55**. El pin bloqueaba el overlay («Sin línea RS: 1 semana»). Tras fallback de serie, el FR de ficha seguía la cola legacy (72) en vez del pin (64).

## Cambio

1. `selectGlobalRsSeriesEngineVersion` — serie overlay cae a engine ≥8 semanas.
2. `ratingLatest` en `readGlobalRsSeriesForSymbol` + merge en company-brief.
3. `stockRsUniverse` en StockClient — FR = `rs.rating` antes que cola de serie.

## Verify

- Vitest: 83 tests RS/ficha; `./vfc` 2667 passed + lint OK.
- Smoke Mini `http://127.0.0.1:13000/stock/AAPL` (rebuild Next):
  - `company-brief`: rating **64**, seriesLen **54** (`statsedge-global-rs-usd-v1`), seriesLast 72.
  - DOM `.chartIdCardRsValue` = **64**; sin «Sin línea RS»; canvas 7; toggles RS/país/tema ON.
