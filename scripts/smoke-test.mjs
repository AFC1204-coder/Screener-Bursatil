const BASE_URL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const STRICT_PROVIDER = process.env.STRICT_PROVIDER === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);

const pages = [
  ["/", "Screener global"],
  ["/lists", "Listas"],
  ["/ipo-radar", "IPO Radar"],
  ["/sectors", "Sectores"],
  ["/research-desk", "Research Desk"],
  ["/review", "Vista rapida"],
  ["/market-health", "Estado general"],
  ["/stock/NVDA", "Ficha accion"],
];

const apiChecks = [
  {
    name: "Supabase status",
    path: "/api/supabase/status",
    provider: false,
    check: (data) => typeof data.configured === "boolean" && typeof data.schemaReady === "boolean" && Array.isArray(data.tables),
  },
  {
    name: "Data providers",
    path: "/api/data-providers",
    provider: false,
    check: (data) => data.priority === "free-first" && Array.isArray(data.providers) && data.providers.some((item) => item.id === "openfigi") && data.providers.some((item) => item.id === "esma-firds" && item.status === "active-when-enabled") && data.providers.some((item) => item.id === "fca-firds" && item.status === "active-when-enabled"),
  },
  {
    name: "J-Quants status",
    path: "/api/jquants",
    provider: false,
    check: (data) => data.ok === true && data.provider === "J-Quants" && typeof data.configured === "boolean",
  },
  {
    name: "Derived leaderboards",
    path: "/api/leaderboards?type=momentum&limit=5",
    provider: false,
    check: (data) => data.ok === true && data.legalMode === "derived-signals-only" && (data.leaderboard || Array.isArray(data.leaderboards)),
  },
  {
    name: "Alerts",
    path: "/api/alerts",
    provider: false,
    check: (data) => typeof data.configured === "boolean" && Array.isArray(data.alerts),
  },
  {
    name: "Search by company/ticker",
    path: "/api/search?q=nvda",
    provider: true,
    check: (data) => Array.isArray(data.results) && data.results.some((item) => item.symbol === "NVDA"),
  },
  {
    name: "Universe US",
    path: "/api/universe?market=US",
    provider: true,
    check: (data) => Number(data.count) > 100 && Array.isArray(data.universe),
  },
  {
    name: "Universe Engine AU",
    path: "/api/universe-engine?market=AU",
    provider: true,
    check: (data) => Number(data.count) > 100 && data.qualityGate?.enabled === true && data.coverage && Array.isArray(data.universe),
  },
  {
    name: "Universe AU",
    path: "/api/universe?market=AU",
    provider: true,
    check: (data) => Number(data.count) > 100 && Array.isArray(data.universe) && data.universe.some((item) => item.symbol === "CBA.AX"),
  },
  {
    name: "Universe HK official",
    path: "/api/universe-engine?market=HK&summary=1",
    provider: true,
    check: (data) => Number(data.count) > 500 && data.coverage?.bySource?.["HKEX Full List of Securities"] > 500,
  },
  {
    name: "Universe TW official",
    path: "/api/universe-engine?market=TW&summary=1",
    provider: true,
    check: (data) => Number(data.count) > 800 && data.coverage?.bySource?.["TWSE ISIN listed equities"] > 800,
  },
  {
    name: "Universe Europe alias",
    path: "/api/universe-engine?market=EU1&summary=1",
    provider: true,
    check: (data) => Number(data.count) > 100 && Array.isArray(data.markets) && data.markets.includes("GB") && data.markets.includes("DE"),
  },
  {
    name: "Universe Nordic curated core",
    path: "/api/universe-engine?markets=SE,DK,NO&summary=1",
    provider: false,
    check: (data) => Number(data.count) > 90 && data.coverage?.byMarket?.SE > 35 && data.coverage?.byMarket?.DK > 25 && data.coverage?.byMarket?.NO > 30,
  },
  {
    name: "Universe curated core CA/IN/IL",
    path: "/api/universe-engine?markets=CA,IN,IL&summary=1&refresh=1",
    provider: false,
    check: (data) => Number(data.count) > 280 && data.coverage?.byMarket?.CA > 200 && data.coverage?.byMarket?.IN > 70 && data.coverage?.byMarket?.IL > 20,
  },
  {
    name: "Universe curated core SG/ZA",
    path: "/api/universe-engine?markets=SG,ZA&summary=1",
    provider: false,
    check: (data) => Number(data.count) > 90 && data.coverage?.byMarket?.SG > 40 && data.coverage?.byMarket?.ZA > 50,
  },
  {
    name: "Coverage report",
    path: "/api/coverage?markets=US,EU1,JP,HK,AU",
    provider: true,
    check: (data) => Number(data.summary?.current) > 100 && Array.isArray(data.markets) && data.markets.some((item) => item.market === "JP") && data.markets.some((item) => item.market === "GB"),
  },
  {
    name: "Shadow universe aggregate",
    path: "/api/shadow-universe?markets=DE,FR,GB,IN,IL&maxAgeHours=1",
    provider: false,
    check: (data) => data.mode === "shadow-universe-aggregate-only" && Array.isArray(data.rows) && data.rows.some((item) => item.market === "IN" && item.priority === "deferred"),
  },
  {
    name: "Cron universe dry run",
    path: "/api/cron/universe-refresh?dryRun=1",
    provider: true,
    check: (data) => data.ok === true && data.dryRun === true && Array.isArray(data.markets) && data.markets.includes("US") && data.markets.includes("GB"),
  },
  {
    name: "Cron scan dry run",
    path: "/api/cron/scan-refresh?dryRun=1",
    provider: true,
    check: (data) => data.ok === true && data.dryRun === true && data.group?.key && Array.isArray(data.options?.markets) && data.options.markets.length > 0,
  },
  {
    name: "Cron shadow Europe dry run",
    path: "/api/cron/shadow-europe-refresh?dryRun=1",
    provider: true,
    check: (data) => data.ok === true && data.dryRun === true && data.job === "cron-shadow-europe-refresh" && data.group?.key && Array.isArray(data.options?.markets) && data.options.markets.length > 0,
  },
  {
    name: "Shadow symbol resolve dry run",
    path: "/api/jobs/shadow-symbol-resolve?markets=FI&dryRun=1&perMarket=3",
    provider: true,
    check: (data) => data.ok === true && data.job === "shadow-symbol-resolve" && data.dryRun === true && Array.isArray(data.rows),
  },
  {
    name: "Shadow UK resolve dry run",
    path: "/api/jobs/shadow-symbol-resolve?source=fca&markets=GB&dryRun=1&perMarket=3",
    provider: true,
    check: (data) => data.ok === true && data.job === "shadow-symbol-resolve" && data.dryRun === true && data.rows?.[0]?.referenceProvider === "fca-firds",
  },
  {
    name: "Shadow price freshness dry run",
    path: "/api/jobs/shadow-price-freshness?markets=FI&dryRun=1&perMarket=3",
    provider: true,
    check: (data) => data.ok === true && data.job === "shadow-price-freshness" && data.dryRun === true && Array.isArray(data.rows),
  },
  {
    name: "Shadow priced scan empty safe",
    path: "/api/jobs/scan-refresh?shadowPriced=1&markets=ZZ&perMarket=3&limit=3&leaderboards=0",
    provider: true,
    check: (data) => data.ok === true && data.skipped === true && data.shadowSource?.enabled === true && Number(data.stats?.selected || 0) === 0,
  },
  {
    name: "Chart NVDA",
    path: "/api/chart?symbol=NVDA",
    provider: true,
    check: (data) => Array.isArray(data.bars) && data.bars.length > 100,
  },
  {
    name: "Profile NVDA",
    path: "/api/profile?symbol=NVDA",
    provider: true,
    check: (data) => Boolean(data.name || data.sector || data.industry),
  },
  {
    name: "Short interest AU",
    path: "/api/short-interest?symbol=CBA.AX",
    provider: true,
    check: (data) => data.available === true && data.symbol === "CBA.AX" && Number.isFinite(data.shortPercentOfIssued),
  },
  {
    name: "Company brief NVDA",
    path: "/api/company-brief?symbol=NVDA",
    provider: true,
    check: (data) => data.symbol === "NVDA" && Boolean(data.name),
  },
  {
    name: "Market health",
    path: "/api/market-health",
    provider: true,
    check: (data) => Number.isFinite(data.marketScore) && Array.isArray(data.indexes),
  },
];

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function fetchWithTimeout(path) {
  const { signal, clear } = timeoutSignal(TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, { signal, cache: "no-store" });
  } finally {
    clear();
  }
}

function log(status, name, detail = "") {
  const suffix = detail ? ` - ${detail}` : "";
  console.log(`${status} ${name}${suffix}`);
}

async function checkPage(path, label) {
  const res = await fetchWithTimeout(path);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  if (!/text\/html/i.test(res.headers.get("content-type") || "")) throw new Error(`${path} no devuelve HTML`);
  if (!text.includes("StatsEdge") && !text.includes("StageRadar")) throw new Error(`${path} no contiene shell StatsEdge/StageRadar`);
  log("OK", label, path);
}

async function checkApi(item) {
  let res;
  try {
    res = await fetchWithTimeout(item.path);
  } catch (error) {
    if (item.provider && !STRICT_PROVIDER) {
      log("WARN", item.name, `${item.path} proveedor no disponible/timeout: ${error.message}`);
      return;
    }
    throw error;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${item.name} no devuelve JSON valido`);
  }
  const valid = res.ok && item.check(data);
  if (!valid) {
    const detail = data?.error || data?.message || `HTTP ${res.status}`;
    if (item.provider && !STRICT_PROVIDER) {
      log("WARN", item.name, `${item.path} proveedor/dato parcial: ${detail}`);
      return;
    }
    throw new Error(`${item.name} fallo: ${detail}`);
  }
  const providerNote = data?.configured === false ? data.message : "";
  log("OK", item.name, providerNote);
}

async function main() {
  console.log(`StatsEdge smoke test: ${BASE_URL}`);
  for (const [path, label] of pages) await checkPage(path, label);
  for (const item of apiChecks) await checkApi(item);
  console.log("Smoke test completado.");
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
