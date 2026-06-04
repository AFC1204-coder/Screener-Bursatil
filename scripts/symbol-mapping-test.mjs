import assert from "node:assert/strict";
import { businessThemeKey } from "../lib/businessTheme.js";
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

assert.equal(businessThemeKey("Technology", "Consumer Electronics", "Designs smartphones, personal computers and accessories."), "Consumer tech / hardware");
assert.equal(businessThemeKey("Real Estate", "REIT - Retail", "Owns shopping mall properties."), "Inmobiliario / REIT");
assert.equal(businessThemeKey("Technology", "Semiconductors", "Designs integrated circuits and chips."), "Semis / fotonica");
assert.equal(businessThemeKey("Consumer Cyclical", "Auto Manufacturers", "Designs electric vehicles, sells and leases vehicles."), "Autos / movilidad");
assert.equal(businessThemeKey("Healthcare", "Drug Manufacturers - General", "Develops medicines, delivery devices and clinical therapies."), "Medtech / biotech");
assert.equal(businessThemeKey("Healthcare", "Medical Devices", "Develops robotic surgical systems and medical devices."), "Medtech / biotech");
assert.equal(businessThemeKey("Financial Services", "Banks - Diversified", "Offers commercial banking, digital platforms and payment rails."), "Finanzas");
assert.equal(businessThemeKey("Financial Services", "Insurance - Diversified", "Owns operating businesses and investment vehicles."), "Finanzas");
assert.equal(businessThemeKey("Energy", "Oil & Gas Integrated", "Produces fuels for vehicles, petrochemicals and natural gas."), "Energia / red");
assert.equal(businessThemeKey("Consumer Defensive", "Discount Stores", "Operates warehouse clubs with optical and pharmacy services."), "Consumo / marca");
assert.equal(businessThemeKey("Consumer Cyclical", "Apparel Retail", "Sells athletic apparel through stores and e-commerce platforms."), "Consumo / marca");
assert.equal(businessThemeKey("Industrials", "Aerospace & Defense", "Builds military vehicles, weapons systems and sensors."), "Defensa / aeroespacial");
assert.equal(businessThemeKey("Real Estate", "REIT - Healthcare Facilities", "Owns healthcare properties and investment vehicles."), "Inmobiliario / REIT");
assert.notEqual(businessThemeKey("Technology", "Consumer Electronics", "Protects intellectual property and sells devices."), "Inmobiliario / REIT");
assert.notEqual(businessThemeKey("Consumer Cyclical", "Auto Manufacturers", "Sells and leases vehicles."), "Inmobiliario / REIT");
assert.notEqual(businessThemeKey("Healthcare", "Medical Devices", "Develops medical devices and surgical systems."), "Consumer tech / hardware");
assert.notEqual(businessThemeKey("Consumer Defensive", "Discount Stores", "Offers optical services and consumer products."), "Semis / fotonica");
assert.notEqual(businessThemeKey("Financial Services", "Banks - Diversified", "Provides research, payments and digital platforms."), "Internet / plataformas");

console.log("Symbol mapping tests passed.");
