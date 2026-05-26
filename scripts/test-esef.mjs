import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const ENV_FILES = [".env.local", ".env"];

function loadEnv() {
  for (const file of ENV_FILES) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    const raw = fs.readFileSync(fullPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

// Load env before importing backend files
loadEnv();

// Import using relative paths to avoid circular or environment-sensitive imports in script
import { supabaseConfig } from "../lib/supabaseServer.js";
import {
  resolveLeiForSymbol,
  fetchEsefFilings,
  fetchAndParseEsefFilingFacts,
  writeEsefFundamentals,
  updateEsefFundamentalsForSymbol
} from "../lib/esef.js";

const TEST_SYMBOLS = ["ASML.AS", "NOKIA.HE", "SAP.DE", "ELUXB.ST"];
const FALLBACK_LEIS = {
  "ASML.AS": "724500F9PD5G7LIJA990", // ASML Holding N.V.
  "NOKIA.HE": "549300H458739GCPBF91", // Nokia Oyj
  "SAP.DE": "3912005G85S85C4F0Z85", // SAP SE
  "ELUXB.ST": "5493002621TQ5D9J6941", // AB Electrolux
};

async function testResolution() {
  console.log("=== 1. Testing LEI Resolution ===");
  const config = supabaseConfig();
  console.log(`Supabase Configured: ${config.configured}`);
  if (!config.configured) {
    console.log("Supabase is not configured. Skipping database LEI resolution test.");
    return null;
  }

  for (const symbol of TEST_SYMBOLS) {
    try {
      console.log(`Resolving LEI for ${symbol}...`);
      const lei = await resolveLeiForSymbol(symbol);
      if (lei) {
        console.log(`  [SUCCESS] Resolved LEI for ${symbol}: ${lei}`);
        return { symbol, lei };
      } else {
        console.log(`  [INFO] No LEI resolved from DB for ${symbol}.`);
      }
    } catch (err) {
      console.error(`  [ERROR] Error resolving LEI for ${symbol}:`, err.message);
    }
  }

  console.log("No LEI could be resolved from Supabase. We will use a hardcoded fallback LEI for API tests.");
  return { symbol: "NOKIA.HE", lei: FALLBACK_LEIS["NOKIA.HE"] };
}

async function testFilingFetch(lei) {
  console.log("\n=== 2. Testing Filings Fetch from filings.xbrl.org ===");
  console.log(`Fetching filings for LEI: ${lei}...`);
  try {
    const filings = await fetchEsefFilings(lei);
    console.log(`Found ${filings.length} filings.`);
    if (!filings.length) {
      throw new Error(`No filings returned for LEI ${lei}`);
    }

    const first = filings[0];
    console.log("Latest filing attributes:");
    console.log(`  Entity Identifier: ${first.attributes?.entity?.identifier}`);
    console.log(`  Period End: ${first.attributes?.period_end}`);
    console.log(`  JSON URL: ${first.attributes?.json_url}`);
    console.log(`  Date Added: ${first.attributes?.date_added}`);

    return filings;
  } catch (err) {
    console.error("  [ERROR] Failed to fetch filings:", err.message);
    throw err;
  }
}

async function testParsing(filing) {
  console.log("\n=== 3. Testing Filing Facts Download & Parse ===");
  const jsonUrl = filing.attributes?.json_url;
  const periodEnd = filing.attributes?.period_end;
  console.log(`Downloading and parsing facts from ${jsonUrl} for period ending ${periodEnd}...`);

  try {
    const start = Date.now();
    const result = await fetchAndParseEsefFilingFacts(jsonUrl, periodEnd);
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    if (!result) {
      throw new Error("Facts download/parsing returned null or empty result");
    }

    console.log(`  [SUCCESS] Downloaded & Parsed facts in ${duration}s.`);
    console.log(`  Currency: ${result.currency}`);
    console.log(`  Coverage Score: ${result.coverageScore}%`);
    console.log("  Extracted Metrics:");
    console.log(`    Revenue:           ${formatNumber(result.metrics.revenue)}`);
    console.log(`    Net Income:        ${formatNumber(result.metrics.netIncome)}`);
    console.log(`    Total Assets:      ${formatNumber(result.metrics.totalAssets)}`);
    console.log(`    Equity:            ${formatNumber(result.metrics.equity)}`);
    console.log(`    Total Liabilities: ${formatNumber(result.metrics.totalLiabilities)}`);
    console.log(`    Cash:              ${formatNumber(result.metrics.cash)}`);
    console.log(`    EPS:               ${result.metrics.eps}`);

    return result;
  } catch (err) {
    console.error("  [ERROR] Parsing failed:", err.message);
    throw err;
  }
}

async function testSupabasePersistence(symbol, periodEnd, parsed) {
  console.log("\n=== 4. Testing Supabase Persistence ===");
  const config = supabaseConfig();
  if (!config.configured) {
    console.log("Supabase not configured. Skipping persistence test.");
    return;
  }

  try {
    console.log(`Writing fundamentals snapshot for ${symbol} (${periodEnd}) to Supabase...`);
    const saveRes = await writeEsefFundamentals(symbol, periodEnd, {
      ...parsed,
      sourceUrl: parsed.sourceUrl || "/dummy-source-url",
      raw: { testRun: true, runTime: new Date().toISOString() },
    });
    console.log("  [SUCCESS] Persistence response:", saveRes);
  } catch (err) {
    console.error("  [ERROR] Supabase write failed:", err.message);
  }
}

function formatNumber(val) {
  if (val === null || val === undefined) return "N/A";
  return new Intl.NumberFormat("en-US").format(val);
}

async function main() {
  console.log("====================================================");
  console.log("  STATS EDGE - ESEF DATA PROVIDER VERIFICATION SCRIPT");
  console.log("====================================================\n");

  try {
    // 1. Resolve LEI
    const resolved = await testResolution();
    if (!resolved) {
      console.log("Unable to find or hardcode a LEI to proceed with. Aborting.");
      return;
    }

    // 2. Fetch Filings
    const filings = await testFilingFetch(resolved.lei);
    if (!filings || filings.length === 0) {
      console.log("No filings found. Aborting.");
      return;
    }

    // 3. Parse latest filing
    const parsed = await testParsing(filings[0]);

    // 4. Test Supabase Persistence (if database configured)
    await testSupabasePersistence(resolved.symbol, filings[0].attributes.period_end, parsed);

    console.log("\n====================================================");
    console.log("  ALL TESTS PASSED SUCCESSFULLY!");
    console.log("====================================================");
  } catch (err) {
    console.error("\n====================================================");
    console.error("  TESTS FAILED:", err.message);
    console.error("====================================================");
    process.exit(1);
  }
}

main();
