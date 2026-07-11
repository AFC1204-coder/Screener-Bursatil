const BASE_URL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const STRICT_PROVIDER = process.env.STRICT_PROVIDER === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const TOKEN = process.env.STATSEDGE_ACCESS_TOKEN || process.env.STATSEDGE_API_TOKEN || process.env.STATSEDGE_ADMIN_TOKEN || "";

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
    check: (data) => {
      const item = data.leaderboard?.items?.[0];
      return data.ok === true
        && data.legalMode === "derived-signals-only"
        && (data.leaderboard || Array.isArray(data.leaderboards))
        && (!item || (Boolean(item.methodologyReliabilityState)
          && Boolean(item.setupDisplayKey)
          && Boolean(item.setupDisplayLabel)
          && typeof item.setupDisplayBlocksPatternClaim === "boolean"));
    },
  },
  {
    name: "Discovery feed",
    path: "/api/discovery?limit=5&groupsLimit=5&minGroupSize=1",
    provider: false,
    check: (data) => data.ok === true
      && data.legalMode === "derived-signals-only"
      && typeof data.configured === "boolean"
      && Array.isArray(data.lists)
      && Array.isArray(data.rows)
      && data.groups && Array.isArray(data.groups.sector)
      && data.health && typeof data.health.state === "string"
      && (!data.configured || data.lists.some((item) => item.key === "leaders" && Array.isArray(item.items))),
  },
  {
    name: "Discovery refresh dry run",
    path: "/api/jobs/discovery-refresh?dryRun=1",
    provider: false,
    check: (data) => data.ok === true
      && data.dryRun === true
      && Array.isArray(data.stats?.snapshots)
      && data.stats.snapshots.some((item) => item.key === "discovery:interactive:v1"),
  },
  {
    name: "MVP operational health",
    path: "/api/mvp-health",
    provider: false,
    check: (data) => ["pass", "warn"].includes(data.status)
      && Array.isArray(data.checks)
      && data.checks.some((item) => item.area === "discovery-cache")
      && data.checks.some((item) => item.area === "leaderboards-cache"),
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
    name: "Universe TW official/readiness",
    path: "/api/universe-engine?market=TW&summary=1",
    provider: true,
    check: (data) => {
      const officialReady = Number(data.count) > 800 && data.coverage?.bySource?.["TWSE ISIN listed equities"] > 800;
      const declaredFallback = data.coverageReadiness?.byMarket?.TW?.state === "official_source_missing"
        && data.coverageReadiness?.byMarket?.TW?.blocksCoverageClaim === true;
      return officialReady || declaredFallback;
    },
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
    check: (data) => data.status === "complete"
      && data.degraded !== true
      && data.scanCoverage?.status === "supabase"
      && Number(data.summary?.current) > 100
      && Number.isFinite(data.summary?.rankingEligibleCoveragePct)
      && Array.isArray(data.markets)
      && data.markets.some((item) => item.market === "JP" && Number.isFinite(item.scan?.rankingEligible))
      && data.markets.some((item) => item.market === "GB"),
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
    // EU1/EU2 (FIRDS markets) are excluded from this cron: they are seeded by
    // app/api/jobs/shadow-firds-refresh and consumed from the DB snapshot, not
    // re-downloaded inline. Verify non-FIRDS markets are present and FIRDS
    // markets (GB, DE) are absent.
    check: (data) => data.ok === true && data.dryRun === true && Array.isArray(data.markets)
      && data.markets.includes("US") && data.markets.includes("JP")
      && !data.markets.includes("GB") && !data.markets.includes("DE"),
  },
  {
    name: "Cron scan dry run",
    path: "/api/cron/scan-refresh?dryRun=1",
    provider: true,
    check: (data) => data.ok === true && data.dryRun === true && data.group?.key && Array.isArray(data.options?.markets) && data.options.markets.length > 0,
  },
  {
    name: "Materialized scan plan dry run",
    path: "/api/jobs/scan-refresh?markets=US,HK&limit=4&perMarket=2&cursor=0&dryRun=1&leaderboards=0",
    provider: true,
    check: (data) => data.ok === true && data.dryRun === true && Array.isArray(data.plan?.symbols) && data.stats?.selection?.priorityMode,
  },
  {
    name: "Cron shadow Europe dry run",
    path: "/api/cron/shadow-europe-refresh?dryRun=1",
    provider: true,
    check: (data) => data.ok === true && data.dryRun === true && data.job === "cron-shadow-europe-refresh" && data.group?.key && Array.isArray(data.options?.markets) && data.options.markets.length > 0,
  },
  {
    name: "Cron shadow FIRDS dry run",
    path: "/api/cron/shadow-firds-refresh?dryRun=1",
    provider: true,
    check: (data) => data.ok === true && data.dryRun === true && data.job === "cron-shadow-firds-refresh" && data.group?.key && Array.isArray(data.options?.markets) && data.options.markets.length > 0 && !data.options.markets.includes("GB"),
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
  {
    name: "Methodology health",
    path: "/api/methodology-health",
    provider: false,
    check: (data) => data.configured === true
      && data.status === "pass"
      && data.totals?.failed === 0
      && data.calibration?.mismatches === 0
      && data.calibration?.guardrailsOk === true
      && data.calibration?.buckets?.plan === 0,
  },
];

const unauthenticatedApiChecks = [
  {
    name: "Auth guard job scan-refresh",
    path: "/api/jobs/scan-refresh?markets=US&limit=1&perMarket=1&dryRun=1&leaderboards=0",
  },
  {
    name: "Auth guard MVP health",
    path: "/api/mvp-health",
  },
  {
    name: "Auth guard scan coverage",
    path: "/api/scan-coverage",
  },
  {
    name: "Auth guard settings",
    path: "/api/settings",
  },
  {
    name: "Auth guard favorites",
    path: "/api/favorites",
  },
];

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function fetchWithTimeout(path, options = {}) {
  const { signal, clear } = timeoutSignal(TIMEOUT_MS);
  const includeAuth = options.includeAuth !== false;
  try {
    return await fetch(`${BASE_URL}${path}`, {
      signal,
      cache: "no-store",
      headers: includeAuth && TOKEN ? { "x-statsedge-token": TOKEN } : {},
    });
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

async function checkUnauthenticatedApi(item) {
  if (!TOKEN) {
    log("SKIP", item.name, "sin token configurado; modo dev fail-open");
    return;
  }
  const res = await fetchWithTimeout(item.path, { includeAuth: false });
  if (res.status !== 401) {
    const text = await res.text().catch(() => "");
    throw new Error(`${item.name} deberia devolver 401 sin token; obtuvo HTTP ${res.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
  }
  log("OK", item.name, "401 sin token");
}

async function main() {
  console.log(`StatsEdge smoke test: ${BASE_URL}`);
  for (const [path, label] of pages) await checkPage(path, label);
  for (const item of apiChecks) await checkApi(item);
  for (const item of unauthenticatedApiChecks) await checkUnauthenticatedApi(item);
  console.log("Smoke test completado.");
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
