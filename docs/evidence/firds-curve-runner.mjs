import { performance } from "node:perf_hooks";

const market = String(process.env.MARKET || "DE").trim().toUpperCase();
// Mirrors FIRDS_MARKET_SUFFIX in lib/officialUniverses.js. Kept local so this
// evidence runner does not need to expose a new production API.
const marketSuffixes = {
  AT: ".VI", BE: ".BR", DE: ".DE", DK: ".CO", ES: ".MC", FI: ".HE", FR: ".PA",
  GB: ".L", IE: ".IR", IT: ".MI", NL: ".AS", NO: ".OL", PT: ".LS", SE: ".ST",
};
const investableTargets = {
  AT: 70, BE: 100, DE: 500, DK: 120, ES: 140, FI: 150, FR: 450,
  GB: 650, IE: 50, IT: 300, NL: 200, NO: 180, PT: 50, SE: 350,
};
const marketSuffix = marketSuffixes[market];
if (!marketSuffix) throw new Error(`Unsupported FIRDS evidence market: ${market}`);

const referenceLimit = Math.max(1, Math.min(Number(process.env.REFERENCE_LIMIT || 5000), 20000));
const limit = Math.max(1, Math.min(Number(process.env.RESOLVE_LIMIT || 100), referenceLimit, 20000));
const yahooConcurrency = Math.max(1, Math.min(Number(process.env.YAHOO_CONCURRENCY || 8), 16));
const pacedOpenFigi = /^(1|true|yes|on)$/i.test(String(process.env.OPENFIGI_PACED || ""));
const rawFetch = globalThis.fetch.bind(globalThis);
const network = {
  openfigi: [],
  yahoo: [],
};

globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === "string" ? input : input?.url || input);
  const kind = url.includes("api.openfigi.com")
    ? "openfigi"
    : url.includes("query1.finance.yahoo.com/v8/finance/chart/")
      ? "yahoo"
      : "";
  const started = performance.now();
  try {
    const response = await rawFetch(input, init);
    if (kind) {
      network[kind].push({
        status: response.status,
        durationMs: Math.round(performance.now() - started),
        rateLimit: response.headers.get("ratelimit-limit") || "",
        rateRemaining: response.headers.get("ratelimit-remaining") || "",
        rateReset: response.headers.get("ratelimit-reset") || "",
      });
    }
    return response;
  } catch (error) {
    if (kind) network[kind].push({ status: 0, durationMs: Math.round(performance.now() - started), error: error.message || "fetch failed" });
    throw error;
  }
};

const { fetchEsmaFirdsReferenceUniverse, fetchFcaFirdsReferenceUniverse } = await import("../../lib/officialUniverses.js");
const { mapOpenFigiIsins, openFigiStatus } = await import("../../lib/openfigi.js");
const { fetchYahooChart } = await import("../../lib/yahoo.js");
const { marketSymbols } = await import("../../lib/universes.js");

if (/^(1|true|yes|on)$/i.test(String(process.env.STATUS_ONLY || ""))) {
  console.log(JSON.stringify(openFigiStatus(), null, 2));
  process.exit(0);
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function networkSummary(rows = []) {
  const durations = rows.map((row) => row.durationMs);
  return {
    requests: rows.length,
    statuses: Object.fromEntries(Object.entries(rows.reduce((out, row) => {
      const key = String(row.status || 0);
      out[key] = (out[key] || 0) + 1;
      return out;
    }, {})).sort()),
    http429: rows.filter((row) => row.status === 429).length,
    durationMs: {
      total: durations.reduce((sum, value) => sum + Number(value || 0), 0),
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      max: durations.length ? Math.max(...durations) : null,
    },
    lastRateHeaders: rows.length ? rows.at(-1) : null,
  };
}

async function mapInChunks(values, concurrency, fn) {
  const out = [];
  for (let index = 0; index < values.length; index += concurrency) {
    const batch = values.slice(index, index + concurrency);
    out.push(...await Promise.all(batch.map(fn)));
  }
  return out;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapOpenFigiPaced(isins, { chunkSize }) {
  const mapped = [];
  const seen = new Set();
  const chunks = [];
  for (let index = 0; index < isins.length; index += chunkSize) chunks.push(isins.slice(index, index + chunkSize));
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        const rows = await mapOpenFigiIsins(chunk, { limit: chunk.length });
        for (const row of rows) {
          const key = `${row.isin}:${row.symbol}`;
          if (!seen.has(key)) {
            seen.add(key);
            mapped.push(row);
          }
        }
        break;
      } catch (error) {
        const last = network.openfigi.at(-1) || {};
        if (!/OpenFIGI HTTP 429/.test(error.message || "") || attempt >= 6) throw error;
        const resetSeconds = Math.max(1, Number(last.rateReset || 60));
        process.stderr.write(`[openfigi-progress] 429 chunk=${index + 1}/${chunks.length} attempt=${attempt} waitMs=${resetSeconds * 1000 + 500}\n`);
        await wait(resetSeconds * 1000 + 500);
      }
    }
    const last = network.openfigi.at(-1) || {};
    const remaining = Number(last.rateRemaining);
    if (index < chunks.length - 1 && Number.isFinite(remaining) && remaining <= 1) {
      const resetSeconds = Math.max(1, Number(last.rateReset || 60));
      process.stderr.write(`[openfigi-progress] quota chunk=${index + 1}/${chunks.length} mapped=${mapped.length} waitMs=${resetSeconds * 1000 + 500}\n`);
      await wait(resetSeconds * 1000 + 500);
    } else if ((index + 1) % 25 === 0 || index === chunks.length - 1) {
      process.stderr.write(`[openfigi-progress] chunk=${index + 1}/${chunks.length} mapped=${mapped.length} remaining=${last.rateRemaining || "?"}\n`);
    }
  }
  return mapped;
}

const startedAt = new Date().toISOString();
const totalStart = performance.now();
const referenceStart = performance.now();
const fetchReferenceUniverse = market === "GB" ? fetchFcaFirdsReferenceUniverse : fetchEsmaFirdsReferenceUniverse;
const references = await fetchReferenceUniverse(market, {
  enabled: true,
  maxFiles: 1,
  scanLimit: 750000,
  referenceLimit,
  downloadTimeoutMs: 120000,
  searchTimeoutMs: 12000,
});
const referenceMs = performance.now() - referenceStart;

const submitted = references.slice(0, limit);
const openfigiStart = performance.now();
let mappedAll = [];
let openfigiError = "";
try {
  const status = openFigiStatus();
  mappedAll = pacedOpenFigi
    ? await mapOpenFigiPaced(submitted.map((row) => row.isin), { chunkSize: status.keyConfigured ? 100 : 10 })
    : await mapOpenFigiIsins(submitted.map((row) => row.isin), { limit });
} catch (error) {
  openfigiError = error.message || "OpenFIGI failed";
}
const openfigiMs = performance.now() - openfigiStart;
const marketMatched = mappedAll.filter((row) => String(row.symbol || "").toUpperCase().endsWith(marketSuffix));

const yahooStart = performance.now();
const prices = openfigiError ? [] : await mapInChunks(marketMatched, yahooConcurrency, async (row) => {
  const started = performance.now();
  try {
    const chart = await fetchYahooChart(row.symbol, { range: "2A", interval: "D" });
    const bars = Array.isArray(chart.bars) ? chart.bars : [];
    const latestDate = bars[0]?.date || "";
    const freshnessDays = latestDate ? Math.max(0, Math.floor((Date.now() - Date.parse(latestDate)) / 86400000)) : null;
    const ok = bars.length >= 180 && freshnessDays !== null && freshnessDays <= 5;
    return {
      isin: row.isin,
      symbol: row.symbol,
      ok,
      bars: bars.length,
      latestDate,
      freshnessDays,
      provider: chart.meta?.dataProvider || "",
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      isin: row.isin,
      symbol: row.symbol,
      ok: false,
      error: error.message || "Yahoo failed",
      durationMs: Math.round(performance.now() - started),
    };
  }
});
const yahooMs = performance.now() - yahooStart;
const totalMs = performance.now() - totalStart;

const priceDurations = prices.map((row) => row.durationMs);
const passedUniqueSymbols = Array.from(new Set(prices.filter((row) => row.ok).map((row) => String(row.symbol || "").toUpperCase()).filter(Boolean)));
const curatedSymbols = marketSymbols(market).map((symbol) => String(symbol).toUpperCase());
const passedSet = new Set(passedUniqueSymbols);
const curatedOverlap = curatedSymbols.filter((symbol) => passedSet.has(symbol));
const combinedUniqueSymbols = new Set([...passedUniqueSymbols, ...curatedSymbols]).size;
const result = {
  study: `StatsEdge ${market} ${market === "GB" ? "FCA" : "ESMA"} FIRDS read-only run`,
  market,
  source: market === "GB" ? "FCA FIRDS" : "ESMA FIRDS",
  marketSuffix,
  startedAt,
  finishedAt: new Date().toISOString(),
  limitRequested: limit,
  adapterCapNote: limit > 500 ? "fetchFirdsUniverse caps at 500; this run calls mapOpenFigiIsins directly over the measured references" : "within fetchFirdsUniverse internal cap",
  keyConfigured: openFigiStatus().keyConfigured,
  pacedOpenFigi,
  yahooConcurrency,
  limits: { maxFiles: 1, scanRecordLimit: 750000, referenceLimit, resolveLimit: limit, minBars: 180, maxAgeDays: 5 },
  phasesMs: {
    referenceDownloadAndScan: Math.round(referenceMs),
    openfigi: Math.round(openfigiMs),
    ohlcvBatched: Math.round(yahooMs),
    total: Math.round(totalMs),
  },
  counts: {
    referencesIdentified: references.length,
    isinsSubmitted: submitted.length,
    openfigiRowsAllMarkets: mappedAll.length,
    openfigiUniqueIsinsWithAnyMappedRow: new Set(mappedAll.map((row) => row.isin)).size,
    marketMatchedMapped: marketMatched.length,
    marketMatchedUniqueIsins: new Set(marketMatched.map((row) => row.isin)).size,
    ohlcvChecked: prices.length,
    ohlcvPassed: prices.filter((row) => row.ok).length,
    ohlcvFailed: prices.filter((row) => !row.ok).length,
    ohlcvPassedUniqueSymbols: passedUniqueSymbols.length,
  },
  rates: {
    marketMatchedPerSubmittedPct: submitted.length ? Number((100 * marketMatched.length / submitted.length).toFixed(2)) : 0,
    ohlcvPassPerMatchedPct: prices.length ? Number((100 * prices.filter((row) => row.ok).length / prices.length).toFixed(2)) : 0,
    endToEndPassPerSubmittedPct: submitted.length ? Number((100 * prices.filter((row) => row.ok).length / submitted.length).toFixed(2)) : 0,
  },
  openfigiError,
  network: {
    openfigi: networkSummary(network.openfigi),
    yahoo: networkSummary(network.yahoo),
  },
  yahooLatencyMs: {
    p50: percentile(priceDurations, 50),
    p95: percentile(priceDurations, 95),
    max: priceDurations.length ? Math.max(...priceDurations) : null,
  },
  providers: Object.fromEntries(Object.entries(prices.reduce((out, row) => {
    const key = row.provider || (row.error ? "error" : "unknown");
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {})).sort((a, b) => b[1] - a[1])),
  errorGroups: Object.fromEntries(Object.entries(prices.filter((row) => row.error).reduce((out, row) => {
    const key = row.error;
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 12)),
  targetCoverage: {
    investableTarget: investableTargets[market],
    curatedCount: curatedSymbols.length,
    curatedOverlapCount: curatedOverlap.length,
    curatedOverlap,
    netNewFirdsSymbols: passedUniqueSymbols.length - curatedOverlap.length,
    combinedUniqueSymbols,
    deltaToTarget: combinedUniqueSymbols - investableTargets[market],
  },
  passedSample: prices.filter((row) => row.ok).slice(0, 10),
  failedSample: prices.filter((row) => !row.ok).slice(0, 15),
};

console.log(JSON.stringify(result, null, 2));
if (openfigiError) process.exitCode = 2;
