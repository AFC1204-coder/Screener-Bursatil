import assert from "node:assert/strict";
import { externalLinks, inferTradingViewSymbol } from "../lib/symbols.js";
import { normalizeChartInterval } from "../lib/chartSettings.js";

const cases = [
  ["0016.HK", "", "HKEX:16"],
  ["16.HK", "", "HKEX:16"],
  ["7203.T", "", "TSE:7203"],
  ["ASML.AS", "", "EURONEXT:ASML"],
  ["SAP.DE", "", "XETR:SAP"],
  ["BHP.AX", "", "ASX:BHP"],
  ["AAPL", "NasdaqGS", "NASDAQ:AAPL"],
  ["BRK-B", "NYSE", "NYSE:BRK-B"],
];

for (const [symbol, exchange, expected] of cases) {
  assert.equal(inferTradingViewSymbol(symbol, exchange), expected, `${symbol} TradingView mapping`);
}

assert.equal(normalizeChartInterval("1h"), "1H");
assert.equal(normalizeChartInterval("60m"), "1H");
assert.equal(normalizeChartInterval("4h"), "4H");
assert.equal(normalizeChartInterval("240m"), "4H");

const hkLinks = externalLinks("0016.HK");
assert.equal(hkLinks.tradingViewSymbol, "HKEX:16");
assert.ok(hkLinks.tradingView.includes("HKEX%3A16"), "HK TradingView URL strips leading zeros");
assert.ok(hkLinks.googleFinance.includes("16%3AHKG"), "HK Google Finance URL uses HKG code");

const auLinks = externalLinks("BHP.AX");
assert.equal(auLinks.tradingViewSymbol, "ASX:BHP");
assert.ok(auLinks.googleFinance.includes("BHP%3AASX"), "AU Google Finance URL uses ASX code");

console.log("Symbol mapping tests passed.");
