const BASE_URL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const STRICT_PROVIDER = process.env.STRICT_PROVIDER === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

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
    check: (data) => data.priority === "free-first" && Array.isArray(data.providers) && data.providers.some((item) => item.id === "openfigi"),
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
    name: "Coverage report",
    path: "/api/coverage?markets=US,JP,HK,AU",
    provider: true,
    check: (data) => Number(data.summary?.current) > 100 && Array.isArray(data.markets) && data.markets.some((item) => item.market === "JP"),
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
  if (!text.includes("StatsEdge")) throw new Error(`${path} no contiene shell StatsEdge`);
  log("OK", label, path);
}

async function checkApi(item) {
  const res = await fetchWithTimeout(item.path);
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
