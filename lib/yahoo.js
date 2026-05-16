import { analyzeNewsItem } from "@/lib/newsSentiment";
import { fetchAlphaVantageChart } from "@/lib/dataProviders";
import { countryCode } from "@/lib/symbols";
import { CURATED_NAMES, exchangeLabel } from "@/lib/universes";

const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const PROVIDER_NOTE = "Datos aproximados segun proveedor disponible; no equivalen a ratings propietarios de MarketSurge.";
const STOOQ_API_KEY = process.env.STOOQ_API_KEY || "";

let yahooAuthCache = null;

function raw(value) {
  if (value && typeof value === "object" && "raw" in value) return Number(value.raw);
  return Number(value);
}

function safeNumber(value) {
  const n = raw(value);
  return Number.isFinite(n) ? n : null;
}

function percentValue(value) {
  const n = safeNumber(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

function returnPercentValue(value) {
  const n = safeNumber(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 2 ? n * 100 : n;
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current / previous) - 1) * 100;
}

function ratioPct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function cleanText(value = "") {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function baseSymbol(symbol = "") {
  return String(symbol || "").toUpperCase().split(".")[0].split("-")[0].trim();
}

function canonicalYahooSymbol(symbol = "") {
  const s = String(symbol || "").trim().toUpperCase();
  const hk = s.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return s;
}

function stooqSymbol(symbol = "") {
  const s = canonicalYahooSymbol(symbol);
  const base = s.split(".")[0].toLowerCase();
  const suffix = s.includes(".") ? s.split(".").pop() : "";
  const map = {
    HK: "hk",
    MC: "es",
    DE: "de",
    F: "de",
    PA: "fr",
    AS: "nl",
    BR: "be",
    LS: "pt",
    MI: "it",
    L: "uk",
    SW: "ch",
    ST: "se",
    OL: "no",
    CO: "dk",
    HE: "fi",
    IR: "ie",
    T: "jp",
    TW: "tw",
    KS: "kr",
    KQ: "kr",
    NS: "in",
    BO: "in",
    SS: "cn",
    SZ: "cn",
    AX: "au",
    SI: "sg",
    TO: "ca",
    V: "ca",
    MX: "mx",
    SA: "br",
  };
  if (!suffix) return `${base}.us`;
  return map[suffix] ? `${base}.${map[suffix]}` : "";
}

function parseStooqCsv(csv = "") {
  const lines = String(csv || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1 || /No data/i.test(csv)) return [];
  return lines.slice(1).map((line) => {
    const [date, open, high, low, close, volume] = line.split(",");
    return {
      date,
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume || 0),
    };
  }).filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function domainRoot(url = "") {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
    return host.split(".")[0] || "";
  } catch {
    return "";
  }
}

function companyKeywords(company = {}) {
  const name = cleanText(company.name || company.companyName || "");
  const websiteRoot = cleanText(domainRoot(company.website || ""));
  const stop = new Set(["inc", "corp", "corporation", "company", "limited", "ltd", "plc", "sa", "s", "a", "group", "holdings", "holding", "the", "and", "de", "del", "la", "el", "industria", "diseno", "textil"]);
  const words = name.split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !stop.has(word));
  return [...new Set([websiteRoot, ...words].filter(Boolean))].slice(0, 8);
}

function ownerName(row = {}) {
  const org = row.organization;
  if (org && typeof org === "object") return org.fmt || org.longFmt || org.raw || "";
  return org || row.name || "";
}

function ownershipRows(rows = []) {
  return Array.isArray(rows)
    ? rows.slice(0, 8).map((row) => ({
        name: ownerName(row),
        pctHeld: percentValue(row.pctHeld),
        position: safeNumber(row.position),
        value: safeNumber(row.value),
        reportDate: row.reportDate?.fmt || (row.reportDate?.raw ? new Date(row.reportDate.raw * 1000).toISOString().slice(0, 10) : ""),
      })).filter((row) => row.name)
    : [];
}

function blankGrowthMetrics(source = "") {
  return {
    revenueGrowth: null,
    earningsGrowth: null,
    grossMargin: null,
    operatingMargin: null,
    profitMargin: null,
    ebitdaMargin: null,
    roe: null,
    roa: null,
    debtToEquity: null,
    currentRatio: null,
    institutionalOwnership: null,
    insiderOwnership: null,
    shortPercentOfFloat: null,
    sharesPercentSharesOut: null,
    shortRatio: null,
    sharesShort: null,
    sharesShortPriorMonth: null,
    floatShares: null,
    sharesOutstanding: null,
    fundsCountApprox: null,
    institutionsCountApprox: null,
    topFunds: [],
    topInstitutions: [],
    insiderHolders: [],
    providerNote: PROVIDER_NOTE,
    source,
  };
}

function growthFromQuoteFallback(quote = {}) {
  return {
    ...blankGrowthMetrics("Yahoo finance/quote"),
    sharesOutstanding: safeNumber(quote.sharesOutstanding),
    floatShares: safeNumber(quote.floatShares),
  };
}

function valuationMetricsFromSources({ quote = {}, summaryDetail = {}, stats = {}, financial = {}, price = {} } = {}) {
  return {
    trailingPe: firstFinite(safeNumber(quote.trailingPE), safeNumber(summaryDetail.trailingPE), safeNumber(stats.trailingPE)),
    forwardPe: firstFinite(safeNumber(quote.forwardPE), safeNumber(summaryDetail.forwardPE), safeNumber(stats.forwardPE)),
    pegRatio: firstFinite(safeNumber(quote.trailingPegRatio), safeNumber(stats.pegRatio), safeNumber(stats.trailingPegRatio)),
    priceToSales: firstFinite(safeNumber(quote.priceToSalesTrailing12Months), safeNumber(summaryDetail.priceToSalesTrailing12Months)),
    priceToBook: firstFinite(safeNumber(quote.priceToBook), safeNumber(stats.priceToBook)),
    enterpriseValue: firstFinite(safeNumber(stats.enterpriseValue), safeNumber(financial.enterpriseValue)),
    enterpriseToRevenue: firstFinite(safeNumber(stats.enterpriseToRevenue), safeNumber(financial.enterpriseToRevenue)),
    enterpriseToEbitda: firstFinite(safeNumber(stats.enterpriseToEbitda), safeNumber(financial.enterpriseToEbitda)),
    beta: firstFinite(safeNumber(quote.beta), safeNumber(summaryDetail.beta), safeNumber(stats.beta)),
    dividendYield: firstFinite(percentValue(quote.trailingAnnualDividendYield), percentValue(summaryDetail.dividendYield)),
    payoutRatio: firstFinite(percentValue(summaryDetail.payoutRatio), percentValue(stats.payoutRatio)),
    bookValue: firstFinite(safeNumber(quote.bookValue), safeNumber(stats.bookValue)),
    epsTrailingTwelveMonths: firstFinite(safeNumber(quote.epsTrailingTwelveMonths), safeNumber(stats.trailingEps)),
    epsForward: firstFinite(safeNumber(quote.epsForward), safeNumber(stats.forwardEps)),
    averageVolume10d: firstFinite(safeNumber(quote.averageDailyVolume10Day), safeNumber(summaryDetail.averageDailyVolume10Day)),
    averageVolume3m: firstFinite(safeNumber(quote.averageDailyVolume3Month), safeNumber(summaryDetail.averageVolume)),
    sharesOutstanding: firstFinite(safeNumber(quote.sharesOutstanding), safeNumber(price.sharesOutstanding), safeNumber(stats.sharesOutstanding)),
    source: "Yahoo finance/quote + quoteSummary",
  };
}

function quoteSnapshotFromSources(quote = {}, price = {}) {
  const marketTime = safeNumber(quote.regularMarketTime || price.regularMarketTime);
  return {
    price: firstFinite(safeNumber(quote.regularMarketPrice), safeNumber(price.regularMarketPrice)),
    previousClose: firstFinite(safeNumber(quote.regularMarketPreviousClose), safeNumber(price.regularMarketPreviousClose)),
    dayChange: safeNumber(quote.regularMarketChange),
    dayChangePct: safeNumber(quote.regularMarketChangePercent),
    marketCap: firstFinite(safeNumber(quote.marketCap), safeNumber(price.marketCap)),
    fiftyTwoWeekHigh: safeNumber(quote.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: safeNumber(quote.fiftyTwoWeekLow),
    averageVolume10d: safeNumber(quote.averageDailyVolume10Day),
    averageVolume3m: safeNumber(quote.averageDailyVolume3Month),
    marketState: quote.marketState || "",
    exchangeTimezoneName: quote.exchangeTimezoneName || price.exchangeTimezoneName || "",
    marketTime: marketTime ? new Date(marketTime * 1000).toISOString() : "",
    source: "Yahoo finance/quote",
  };
}

function fallbackProfile(symbol = "", quote = {}, search = {}) {
  const clean = canonicalYahooSymbol(symbol);
  const code = countryCode(clean);
  const curatedName = CURATED_NAMES[clean] || "";
  return {
    name: firstText(quote.longName, quote.shortName, search.name, curatedName, clean),
    marketCap: firstFinite(safeNumber(quote.marketCap), search.marketCap) || 0,
    sector: firstText(search.sector, "Sin sector"),
    industry: firstText(search.industry, "Sin industria"),
    exchange: firstText(quote.fullExchangeName, quote.exchange, search.exchange, exchangeLabel(clean, code), "-"),
    currency: firstText(quote.currency, search.currency, ""),
  };
}

function cookieHeaderFrom(headers) {
  const cookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (headers.get("set-cookie") ? [headers.get("set-cookie")] : []);
  return cookies.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
}

async function getYahooAuth() {
  if (yahooAuthCache?.crumb && yahooAuthCache.expiresAt > Date.now()) return yahooAuthCache;
  const seedUrls = ["https://fc.yahoo.com", "https://finance.yahoo.com", "https://www.yahoo.com"];
  let cookie = "";
  for (const seedUrl of seedUrls) {
    const seed = await fetch(seedUrl, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,*/*" }, cache: "no-store", redirect: "manual" }).catch(() => null);
    cookie = seed?.headers ? cookieHeaderFrom(seed.headers) : "";
    if (cookie) break;
  }
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/plain,*/*", ...(cookie ? { Cookie: cookie } : {}) },
    cache: "no-store",
  });
  if (!crumbRes.ok) throw new Error(`Yahoo ownership auth HTTP ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Yahoo ownership auth no valido");
  yahooAuthCache = { crumb, cookie, expiresAt: Date.now() + 60 * 60 * 1000 };
  return yahooAuthCache;
}

async function fetchYahooQuoteSummary(symbol, extraModules = []) {
  const yahooSymbol = canonicalYahooSymbol(symbol);
  const modules = Array.from(new Set([
    "price",
    "summaryProfile",
    "assetProfile",
    "defaultKeyStatistics",
    "financialData",
    "summaryDetail",
    "majorHoldersBreakdown",
    "fundOwnership",
    "institutionOwnership",
    "insiderHolders",
    ...extraModules,
  ])).join(",");
  const auth = await getYahooAuth();
  const params = new URLSearchParams({ modules, crumb: auth.crumb });
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { ...YAHOO_HEADERS, ...(auth.cookie ? { Cookie: auth.cookie } : {}) },
    next: { revalidate: 86400 },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) yahooAuthCache = null;
    throw new Error(`Yahoo profile HTTP ${res.status}`);
  }
  const data = await res.json();
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error(data?.quoteSummary?.error?.description || "Yahoo profile sin resultado");
  return result;
}

async function fetchYahooQuote(symbol) {
  const yahooSymbol = canonicalYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooSymbol)}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`Yahoo quote HTTP ${res.status}`);
  const data = await res.json();
  const quote = data?.quoteResponse?.result?.[0];
  if (!quote?.symbol) throw new Error("Yahoo quote sin resultado");
  return quote;
}

function dateValue(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const rawDate = rawValue?.raw ?? rawValue;
  if (!rawDate) return "";
  const d = new Date(Number(rawDate) * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}

function rowDate(row = {}) {
  return dateValue(row.endDate);
}

function valueOf(row = {}, key) {
  return safeNumber(row?.[key]);
}
function statementValueOf(row = {}, key) {
  const value = valueOf(row, key);
  return value === 0 ? null : value;
}

function statementRows(rows = [], period = "quarter") {
  const sorted = [...rows].map((row) => ({
    period,
    date: rowDate(row),
    revenue: valueOf(row, "totalRevenue"),
    grossProfit: statementValueOf(row, "grossProfit"),
    operatingIncome: statementValueOf(row, "operatingIncome"),
    ebit: statementValueOf(row, "ebit"),
    ebitda: statementValueOf(row, "ebitda"),
    netIncome: valueOf(row, "netIncome"),
    eps: firstFinite(statementValueOf(row, "dilutedEPS"), statementValueOf(row, "basicEPS")),
  })).filter((row) => row.date).sort((a, b) => new Date(b.date) - new Date(a.date));
  return sorted.map((row, index) => ({
    ...row,
    revenueGrowthYoY: period === "quarter" ? pctChange(row.revenue, sorted[index + 4]?.revenue) : pctChange(row.revenue, sorted[index + 1]?.revenue),
    netIncomeGrowthYoY: period === "quarter" ? pctChange(row.netIncome, sorted[index + 4]?.netIncome) : pctChange(row.netIncome, sorted[index + 1]?.netIncome),
  }));
}

function balanceRows(rows = [], period = "quarter") {
  return [...rows].map((row) => ({
    period,
    date: rowDate(row),
    cash: firstFinite(valueOf(row, "cash"), valueOf(row, "cashAndCashEquivalents"), valueOf(row, "cashAndShortTermInvestments")),
    totalDebt: valueOf(row, "totalDebt"),
    totalAssets: valueOf(row, "totalAssets"),
    totalLiabilities: firstFinite(valueOf(row, "totalLiab"), valueOf(row, "totalLiabilities")),
    equity: firstFinite(valueOf(row, "totalStockholderEquity"), valueOf(row, "stockholdersEquity")),
    workingCapital: valueOf(row, "netTangibleAssets"),
  })).filter((row) => row.date).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function cashflowRows(rows = [], period = "quarter") {
  return [...rows].map((row) => {
    const operatingCashFlow = firstFinite(valueOf(row, "totalCashFromOperatingActivities"), valueOf(row, "operatingCashFlow"));
    const capex = valueOf(row, "capitalExpenditures");
    const freeCashFlow = firstFinite(valueOf(row, "freeCashflow"), Number.isFinite(operatingCashFlow) && Number.isFinite(capex) ? operatingCashFlow + capex : null);
    return {
      period,
      date: rowDate(row),
      operatingCashFlow,
      capitalExpenditures: capex,
      freeCashFlow,
      dividendsPaid: valueOf(row, "dividendsPaid"),
      repurchaseOfStock: valueOf(row, "repurchaseOfStock"),
    };
  }).filter((row) => row.date).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function hasUsefulNumbers(row = {}, keys = []) {
  return keys.some((key) => Number.isFinite(row[key]));
}

function mergeMissingValues(row = {}, fallback = {}) {
  const out = { ...row };
  for (const [key, value] of Object.entries(fallback)) {
    if (key === "period" || key === "date") continue;
    if (!Number.isFinite(out[key]) && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function enrichFirstRow(rows = [], fallback = {}, period = "quarter", options = {}) {
  if (!hasUsefulNumbers(fallback, Object.keys(fallback))) return rows;
  if (rows.length) {
    if (options.allowDateMismatch || !fallback.date || rows[0].date === fallback.date) {
      return [mergeMissingValues(rows[0], fallback), ...rows.slice(1)];
    }
    return rows;
  }
  const date = fallback.date || new Date().toISOString().slice(0, 10);
  return [{ period, date, ...fallback }];
}

function buildCalendar(summary = {}) {
  const calendar = summary.calendarEvents || {};
  const earnings = calendar.earnings || {};
  const trend = summary.earningsTrend?.trend || [];
  const currentQuarter = trend.find((row) => row.period === "0q") || trend[0] || {};
  return {
    earningsDate: dateValue(earnings.earningsDate),
    earningsStart: dateValue(earnings.earningsDate?.[0]),
    earningsEnd: dateValue(earnings.earningsDate?.[1]),
    earningsAverage: safeNumber(earnings.earningsAverage),
    earningsLow: safeNumber(earnings.earningsLow),
    earningsHigh: safeNumber(earnings.earningsHigh),
    revenueAverage: safeNumber(earnings.revenueAverage),
    revenueLow: safeNumber(earnings.revenueLow),
    revenueHigh: safeNumber(earnings.revenueHigh),
    exDividendDate: dateValue(calendar.exDividendDate),
    dividendDate: dateValue(calendar.dividendDate),
    estimatePeriod: currentQuarter.period || "",
    epsEstimate: safeNumber(currentQuarter.earningsEstimate?.avg),
    epsEstimateGrowth: percentValue(currentQuarter.earningsEstimate?.growth),
    revenueEstimate: safeNumber(currentQuarter.revenueEstimate?.avg),
    revenueEstimateGrowth: percentValue(currentQuarter.revenueEstimate?.growth),
    source: "Yahoo calendarEvents / earningsTrend",
  };
}

function buildFinancialResults(summary = {}) {
  const quarterlyIncome = statementRows(summary.incomeStatementHistoryQuarterly?.incomeStatementHistory || [], "quarter").slice(0, 8);
  const annualIncome = statementRows(summary.incomeStatementHistory?.incomeStatementHistory || [], "annual").slice(0, 6);
  const financial = summary.financialData || {};
  const snapshotDate = quarterlyIncome[0]?.date || annualIncome[0]?.date || new Date().toISOString().slice(0, 10);
  const balanceSnapshot = {
    date: snapshotDate,
    cash: safeNumber(financial.totalCash),
    totalDebt: safeNumber(financial.totalDebt),
  };
  const cashflowSnapshot = {
    date: snapshotDate,
    operatingCashFlow: safeNumber(financial.operatingCashflow),
    freeCashFlow: safeNumber(financial.freeCashflow),
  };
  const quarterlyBalance = enrichFirstRow(balanceRows(summary.balanceSheetHistoryQuarterly?.balanceSheetStatements || [], "quarter").slice(0, 8), balanceSnapshot, "quarter");
  const annualBalance = enrichFirstRow(balanceRows(summary.balanceSheetHistory?.balanceSheetStatements || [], "annual").slice(0, 6), balanceSnapshot, "annual");
  const quarterlyCashflow = enrichFirstRow(cashflowRows(summary.cashflowStatementHistoryQuarterly?.cashflowStatements || [], "quarter").slice(0, 8), cashflowSnapshot, "quarter");
  const annualCashflow = enrichFirstRow(cashflowRows(summary.cashflowStatementHistory?.cashflowStatements || [], "annual").slice(0, 6), cashflowSnapshot, "annual");
  const latestIncome = quarterlyIncome[0] || annualIncome[0] || {};
  const latestBalance = quarterlyBalance[0] || annualBalance[0] || {};
  const latestCashflow = quarterlyCashflow[0] || annualCashflow[0] || {};
  const hasSnapshot = hasUsefulNumbers(balanceSnapshot, ["cash", "totalDebt"]) || hasUsefulNumbers(cashflowSnapshot, ["operatingCashFlow", "freeCashFlow"]);
  return {
    currency: summary.price?.currency || "",
    source: hasSnapshot ? "Yahoo quoteSummary statements + financialData snapshot" : "Yahoo quoteSummary statements",
    incomeQuarterly: quarterlyIncome,
    incomeAnnual: annualIncome,
    balanceQuarterly: quarterlyBalance,
    balanceAnnual: annualBalance,
    cashflowQuarterly: quarterlyCashflow,
    cashflowAnnual: annualCashflow,
    latest: {
      date: latestIncome.date || latestBalance.date || latestCashflow.date || "",
      revenue: latestIncome.revenue,
      revenueGrowthYoY: latestIncome.revenueGrowthYoY,
      grossProfit: latestIncome.grossProfit,
      operatingIncome: latestIncome.operatingIncome,
      ebitda: latestIncome.ebitda,
      netIncome: latestIncome.netIncome,
      netIncomeGrowthYoY: latestIncome.netIncomeGrowthYoY,
      eps: latestIncome.eps,
      cash: latestBalance.cash,
      totalDebt: latestBalance.totalDebt,
      totalAssets: latestBalance.totalAssets,
      equity: latestBalance.equity,
      operatingCashFlow: latestCashflow.operatingCashFlow,
      freeCashFlow: latestCashflow.freeCashFlow,
    },
  };
}

function newsRows(rows = []) {
  return rows.slice(0, 10).map((row) => ({
    title: row.title || "",
    publisher: row.publisher || "",
    link: row.link || "",
    publishedAt: row.providerPublishTime ? new Date(row.providerPublishTime * 1000).toISOString() : "",
    type: row.type || "STORY",
    relatedTickers: row.relatedTickers || [],
    thumbnail: row.thumbnail?.resolutions?.[0]?.url || "",
  })).filter((row) => row.title && row.link);
}

function decodeXml(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .trim();
}

function rssValue(block = "", tag = "") {
  const match = String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "");
}

function stripPublisherSuffix(title = "", publisher = "") {
  const cleanTitle = decodeXml(title);
  const cleanPublisher = decodeXml(publisher);
  if (!cleanPublisher) return cleanTitle;
  return cleanTitle.replace(new RegExp(`\\s+-\\s+${escapeRegExp(cleanPublisher)}$`, "i"), "").trim();
}

function isRecentNews(row = {}, days = 45) {
  if (!row.publishedAt) return true;
  const ts = new Date(row.publishedAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts <= days * 24 * 60 * 60 * 1000;
}

function googleNewsRows(xml = [], newsCount = 10) {
  return [...String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .slice(0, newsCount * 2)
    .map(([block]) => {
      const publisher = rssValue(block, "source") || "Google News";
      const pubDate = rssValue(block, "pubDate");
      const publishedAt = pubDate && Number.isFinite(new Date(pubDate).getTime()) ? new Date(pubDate).toISOString() : "";
      return {
        title: stripPublisherSuffix(rssValue(block, "title"), publisher),
        publisher,
        link: rssValue(block, "link"),
        publishedAt,
        type: "STORY",
        relatedTickers: [],
        thumbnail: "",
        source: "Google News RSS",
      };
    })
    .filter((row) => row.title && row.link && isRecentNews(row, 45))
    .slice(0, newsCount);
}

async function fetchYahooNewsQuery(query, newsCount = 10) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${newsCount}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`Yahoo news HTTP ${res.status}`);
  const data = await res.json();
  return newsRows(data?.news || []);
}

async function fetchGoogleNewsQuery(query, newsCount = 10) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { ...YAHOO_HEADERS, Accept: "application/rss+xml,text/xml,*/*" },
    next: { revalidate: 1800 },
  });
  if (!res.ok) throw new Error(`Google News RSS HTTP ${res.status}`);
  return googleNewsRows(await res.text(), newsCount);
}

function dedupeNews(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = row.link || row.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function scoreCompanyNews(row = {}, symbol = "", company = {}) {
  const title = cleanText(row.title);
  const related = (row.relatedTickers || []).map((ticker) => String(ticker || "").toUpperCase());
  const exactSymbol = String(symbol || "").toUpperCase();
  const base = baseSymbol(symbol);
  const keywords = companyKeywords(company);
  let score = 0;
  const reasons = [];
  let directTitleHit = false;
  if (related.includes(exactSymbol) || related.includes(base)) {
    score += 35;
    reasons.push("ticker relacionado");
  }
  if (base && base.length >= 2 && new RegExp(`\\b${escapeRegExp(base.toLowerCase())}\\b`, "i").test(title)) {
    directTitleHit = true;
    score += 45;
    reasons.push("ticker en titular");
  }
  for (const keyword of keywords) {
    if (keyword.length >= 4 && title.includes(keyword)) {
      directTitleHit = true;
      score += keyword === domainRoot(company.website || "") ? 55 : 18;
      reasons.push(keyword);
    }
  }
  if ((related.includes(exactSymbol) || related.includes(base)) && directTitleHit) score += 30;
  if (!directTitleHit && /earnings call summary|announces first quarter|announces quarterly|conference call/i.test(row.title || "")) {
    score -= 45;
  }
  if (!directTitleHit && related.length > 2) score -= 10;
  return { score, reasons: [...new Set(reasons)].slice(0, 4) };
}

function scoreMarketNews(row = {}) {
  const title = cleanText(row.title);
  const related = (row.relatedTickers || []).map((ticker) => String(ticker || "").toUpperCase());
  const marketTickers = new Set(["^GSPC", "^SPX", "^IXIC", "^DJI", "^RUT", "SPY", "QQQ", "DIA", "IWM", "VTI", "ACWI", "VOO", "IVV"]);
  const marketRules = [
    [/\bstock market\b|\bwall street\b|\bu\.s\. stocks\b|\bglobal stocks\b|\bequity indexes\b|\bfutures\b/, 34, "mercado amplio"],
    [/\bs&p 500\b|\bnasdaq\b|\bdow jones\b|\brussell 2000\b|\bmsci\b|\bindexes\b|\bindices\b/, 30, "indices"],
    [/\bfed\b|\bfederal reserve\b|\binflation\b|\bcpi\b|\bppi\b|\brates\b|\brate cut\b|\brate hike\b|\byields\b|\btreasury\b/, 28, "macro/tipos"],
    [/\brecession\b|\bslowdown\b|\bsoft landing\b|\bhard landing\b|\beconomy\b|\bjobs\b|\bunemployment\b|\bgdp\b/, 24, "ciclo economico"],
    [/\brally\b|\bsell-?off\b|\bcorrection\b|\bbreakout\b|\bnew highs\b|\bvolatility\b|\bvix\b|\brisk-on\b|\brisk-off\b/, 24, "tono de mercado"],
    [/\bearnings season\b|\bprofit outlook\b|\bguidance\b|\bmega cap\b|\btech stocks\b|\bai stocks\b|\bsemiconductor stocks\b/, 18, "liderazgo/beneficios"],
  ];
  let score = related.some((ticker) => marketTickers.has(ticker)) ? 26 : 0;
  const reasons = score ? ["ticker indice/ETF"] : [];
  for (const [rule, weight, reason] of marketRules) {
    if (rule.test(title)) {
      score += weight;
      reasons.push(reason);
    }
  }
  if (/announces|launches|appoints|award|facility|study|clinical|phase \d|earnings call summary|quarterly results/i.test(row.title || "") && score < 42) {
    score -= 28;
  }
  return { score, reasons: [...new Set(reasons)].slice(0, 4) };
}

function companyNewsQueries(symbol = "", company = {}) {
  const queries = [symbol, baseSymbol(symbol), company.name, domainRoot(company.website || "")].filter(Boolean);
  return [...new Set(queries.map((query) => String(query).trim()).filter((query) => query.length >= 2))].slice(0, 4);
}

function googleCompanyNewsQueries(symbol = "", company = {}) {
  const queries = [];
  const root = domainRoot(company.website || "");
  if (root) queries.push(`${root} stock earnings`);
  if (company.name) queries.push(`"${company.name}" stock earnings`);
  if (baseSymbol(symbol)) queries.push(`${baseSymbol(symbol)} stock earnings`);
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 3);
}

export async function fetchYahooNews(query, newsCount = 10) {
  return fetchYahooNewsQuery(query, newsCount);
}

export async function fetchYahooCompanyNews(symbol, company = {}) {
  const queries = companyNewsQueries(symbol, company);
  const settled = await Promise.allSettled(queries.map((query) => fetchYahooNewsQuery(query, 10)));
  const rows = dedupeNews(settled.flatMap((result) => result.status === "fulfilled" ? result.value : []));
  const scored = rows.map((row) => {
    const relevance = scoreCompanyNews(row, symbol, company);
    return {
      ...analyzeNewsItem(row),
      relevanceScore: relevance.score,
      relevanceReasons: relevance.reasons,
    };
  });
  const relevant = scored
    .filter((row) => row.relevanceScore >= 45)
    .sort((a, b) => (b.relevanceScore - a.relevanceScore) || (new Date(b.publishedAt) - new Date(a.publishedAt)))
    .slice(0, 10);
  if (relevant.length >= 4) return relevant;
  const googleSettled = await Promise.allSettled(googleCompanyNewsQueries(symbol, company).map((query) => fetchGoogleNewsQuery(query, 8)));
  const googleRows = dedupeNews(googleSettled.flatMap((result) => result.status === "fulfilled" ? result.value : []))
    .map((row) => {
      const relevance = scoreCompanyNews(row, symbol, company);
      return {
        ...analyzeNewsItem(row),
        relevanceScore: relevance.score,
        relevanceReasons: relevance.reasons,
      };
    })
    .filter((row) => row.relevanceScore >= 45);
  return dedupeNews([...relevant, ...googleRows])
    .sort((a, b) => (b.relevanceScore - a.relevanceScore) || (new Date(b.publishedAt) - new Date(a.publishedAt)))
    .slice(0, 10);
}

export async function fetchYahooMarketNews() {
  const queries = ["stock market today", "S&P 500 Nasdaq Dow Jones", "Federal Reserve inflation stock market", "market rally selloff yields", "earnings season stock market outlook"];
  const googleQueries = ["stock market today S&P 500 Nasdaq Fed", "Wall Street stocks inflation rates yields", "market rally selloff S&P 500 Nasdaq", "earnings season stock market outlook"];
  const [yahooSettled, googleSettled] = await Promise.all([
    Promise.allSettled(queries.map((query) => fetchYahooNewsQuery(query, 12))),
    Promise.allSettled(googleQueries.map((query) => fetchGoogleNewsQuery(query, 10))),
  ]);
  const scored = dedupeNews([
    ...yahooSettled.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    ...googleSettled.flatMap((result) => result.status === "fulfilled" ? result.value : []),
  ])
    .map((row) => {
      const relevance = scoreMarketNews(row);
      return {
        ...analyzeNewsItem(row),
        marketRelevanceScore: relevance.score,
        marketRelevanceReasons: relevance.reasons,
      };
    })
    .filter((row) => row.marketRelevanceScore > 0)
    .sort((a, b) => (b.marketRelevanceScore - a.marketRelevanceScore) || (new Date(b.publishedAt) - new Date(a.publishedAt)));
  const relevant = scored.filter((row) => row.marketRelevanceScore >= 28);
  return (relevant.length ? relevant : scored)
    .sort((a, b) => (new Date(b.publishedAt) - new Date(a.publishedAt)) || (b.marketRelevanceScore - a.marketRelevanceScore))
    .slice(0, 24);
}

export async function fetchYahooCompanyExtras(symbol, company = {}) {
  const modules = [
    "calendarEvents",
    "earnings",
    "earningsTrend",
    "incomeStatementHistory",
    "incomeStatementHistoryQuarterly",
    "balanceSheetHistory",
    "balanceSheetHistoryQuarterly",
    "cashflowStatementHistory",
    "cashflowStatementHistoryQuarterly",
  ];
  const [summaryResult, newsResult] = await Promise.allSettled([
    fetchYahooQuoteSummary(symbol, modules),
    fetchYahooCompanyNews(symbol, company),
  ]);
  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : {};
  return {
    earningsCalendar: buildCalendar(summary),
    financialResults: buildFinancialResults(summary),
    news: newsResult.status === "fulfilled" ? newsResult.value : [],
    extrasProviderError: [summaryResult, newsResult].filter((x) => x.status === "rejected").map((x) => x.reason?.message).filter(Boolean).join(" · ") || null,
  };
}

async function fetchYahooSearchProfile(symbol) {
  const yahooSymbol = canonicalYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooSymbol)}&quotesCount=4&newsCount=0`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`Yahoo search HTTP ${res.status}`);
  const data = await res.json();
  const quotes = data?.quotes || [];
  const exact = quotes.find((q) => String(q.symbol).toUpperCase() === yahooSymbol) || quotes.find((q) => q.quoteType === "EQUITY") || {};
  return {
    name: exact.longname || exact.shortname || yahooSymbol,
    sector: exact.sector || "Sin sector",
    industry: exact.industry || "Sin industria",
    exchange: exact.exchDisp || exact.exchange || "-",
    currency: "",
    marketCap: 0,
  };
}

function searchRank(query, quote = {}) {
  const q = String(query || "").trim().toLowerCase();
  const symbol = String(quote.symbol || "").toLowerCase();
  const name = String(quote.longname || quote.shortname || "").toLowerCase();
  let score = 0;
  if (symbol === q) score += 120;
  if (symbol.startsWith(q)) score += 60;
  if (name === q) score += 90;
  if (name.startsWith(q)) score += 55;
  if (name.includes(q)) score += 34;
  if (quote.quoteType === "EQUITY") score += 25;
  if (quote.isYahooFinance) score += 8;
  if (quote.marketCap) score += Math.min(18, Math.log10(Math.max(quote.marketCap, 1)));
  return score;
}

export async function searchYahooCompanies(query) {
  const q = canonicalYahooSymbol(String(query || "").trim());
  if (!q) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`Yahoo search HTTP ${res.status}`);
  const data = await res.json();
  const seen = new Set();
  return (data?.quotes || [])
    .filter((quote) => quote?.symbol && ["EQUITY", "ETF"].includes(quote.quoteType))
    .map((quote) => ({
      symbol: String(quote.symbol || "").toUpperCase(),
      name: quote.longname || quote.shortname || quote.symbol,
      exchange: quote.exchDisp || quote.exchange || "-",
      exchangeCode: quote.exchange || "",
      quoteType: quote.quoteType || "",
      type: quote.typeDisp || quote.quoteType || "",
      sector: quote.sector || "",
      industry: quote.industry || "",
      country: quote.country || "",
      currency: quote.currency || "",
      marketCap: safeNumber(quote.marketCap),
      score: searchRank(q, quote),
    }))
    .filter((quote) => {
      if (seen.has(quote.symbol)) return false;
      seen.add(quote.symbol);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function normalizeSeries(rawResult = {}) {
  const out = {};
  for (const block of rawResult?.timeseries?.result || []) {
    for (const [key, value] of Object.entries(block)) {
      if (key === "meta" || key === "timestamp" || !Array.isArray(value)) continue;
      out[key] = value.map((row) => ({
        date: row.asOfDate || "",
        value: safeNumber(row.reportedValue),
        currency: row.currencyCode || "",
      })).filter((row) => Number.isFinite(row.value)).sort((a, b) => new Date(a.date) - new Date(b.date));
    }
  }
  return out;
}

function latest(series = []) {
  return series.length ? series[series.length - 1] : null;
}

function previous(series = []) {
  return series.length > 1 ? series[series.length - 2] : null;
}

function sameQuarterLastYear(series = []) {
  return series.length >= 5 ? series[series.length - 5] : previous(series);
}

function latestValue(series = []) {
  return latest(series)?.value ?? null;
}

function previousValue(series = []) {
  return previous(series)?.value ?? null;
}

function seriesCurrency(...seriesList) {
  for (const series of seriesList) {
    const currency = latest(series || [])?.currency;
    if (currency) return currency;
  }
  return "";
}

function valueAt(series = [], date = "") {
  return series.find((row) => row.date === date)?.value ?? null;
}

function unionDates(...seriesList) {
  const dates = new Set();
  for (const series of seriesList) {
    for (const row of series || []) {
      if (row?.date) dates.add(row.date);
    }
  }
  return [...dates].sort((a, b) => new Date(b) - new Date(a));
}

function rowsWithGrowth(rows = [], period = "quarter") {
  return rows.map((row, index) => ({
    ...row,
    revenueGrowthYoY: period === "quarter" ? pctChange(row.revenue, rows[index + 4]?.revenue) : pctChange(row.revenue, rows[index + 1]?.revenue),
    netIncomeGrowthYoY: period === "quarter" ? pctChange(row.netIncome, rows[index + 4]?.netIncome) : pctChange(row.netIncome, rows[index + 1]?.netIncome),
  }));
}

function incomeRowsFromSeries({ revenue = [], gross = [], operating = [], ebitda = [], netIncome = [] }, period = "quarter") {
  const dates = unionDates(revenue, gross, operating, ebitda, netIncome).slice(0, period === "quarter" ? 8 : 6);
  return rowsWithGrowth(dates.map((date) => ({
    period,
    date,
    revenue: valueAt(revenue, date),
    grossProfit: valueAt(gross, date),
    operatingIncome: valueAt(operating, date),
    ebitda: valueAt(ebitda, date),
    netIncome: valueAt(netIncome, date),
    eps: null,
  })), period);
}

function balanceRowsFromSeries({ cash = [], debt = [], assets = [], equity = [], currentAssets = [], currentLiabilities = [] }, period = "quarter") {
  return unionDates(cash, debt, assets, equity, currentAssets, currentLiabilities)
    .slice(0, period === "quarter" ? 8 : 6)
    .map((date) => ({
      period,
      date,
      cash: valueAt(cash, date),
      totalDebt: valueAt(debt, date),
      totalAssets: valueAt(assets, date),
      totalLiabilities: null,
      equity: valueAt(equity, date),
      currentAssets: valueAt(currentAssets, date),
      currentLiabilities: valueAt(currentLiabilities, date),
    }));
}

function cashflowRowsFromSeries({ operating = [], capex = [], freeCashFlow = [] }, period = "quarter") {
  return unionDates(operating, capex, freeCashFlow)
    .slice(0, period === "quarter" ? 8 : 6)
    .map((date) => {
      const operatingCashFlow = valueAt(operating, date);
      const capitalExpenditures = valueAt(capex, date);
      return {
        period,
        date,
        operatingCashFlow,
        capitalExpenditures,
        freeCashFlow: firstFinite(valueAt(freeCashFlow, date), Number.isFinite(operatingCashFlow) && Number.isFinite(capitalExpenditures) ? operatingCashFlow - Math.abs(capitalExpenditures) : null),
        dividendsPaid: null,
        repurchaseOfStock: null,
      };
    });
}

function buildFinancialResultsFromTimeseries(series) {
  const qRevenue = series.quarterlyTotalRevenue || [];
  const qNetIncome = series.quarterlyNetIncome || [];
  const qGrossProfit = series.quarterlyGrossProfit || [];
  const qOperatingIncome = series.quarterlyOperatingIncome || [];
  const qEbitda = series.quarterlyEBITDA || [];
  const aRevenue = series.annualTotalRevenue || [];
  const aNetIncome = series.annualNetIncome || [];
  const aGrossProfit = series.annualGrossProfit || [];
  const aOperatingIncome = series.annualOperatingIncome || [];
  const aEbitda = series.annualEBITDA || [];
  const qAssets = series.quarterlyTotalAssets || [];
  const qDebt = series.quarterlyTotalDebt || [];
  const qEquity = series.quarterlyStockholdersEquity || [];
  const qCurrentAssets = series.quarterlyCurrentAssets || [];
  const qCurrentLiabilities = series.quarterlyCurrentLiabilities || [];
  const qCash = series.quarterlyCashCashEquivalentsAndShortTermInvestments || series.quarterlyCashAndCashEquivalents || [];
  const aAssets = series.annualTotalAssets || [];
  const aDebt = series.annualTotalDebt || [];
  const aEquity = series.annualStockholdersEquity || [];
  const aCurrentAssets = series.annualCurrentAssets || [];
  const aCurrentLiabilities = series.annualCurrentLiabilities || [];
  const aCash = series.annualCashCashEquivalentsAndShortTermInvestments || series.annualCashAndCashEquivalents || [];
  const qOperatingCashFlow = series.quarterlyOperatingCashFlow || [];
  const qCapex = series.quarterlyCapitalExpenditure || [];
  const qFreeCashFlow = series.quarterlyFreeCashFlow || [];
  const aOperatingCashFlow = series.annualOperatingCashFlow || [];
  const aCapex = series.annualCapitalExpenditure || [];
  const aFreeCashFlow = series.annualFreeCashFlow || [];
  const incomeQuarterly = incomeRowsFromSeries({ revenue: qRevenue, gross: qGrossProfit, operating: qOperatingIncome, ebitda: qEbitda, netIncome: qNetIncome }, "quarter");
  const incomeAnnual = incomeRowsFromSeries({ revenue: aRevenue, gross: aGrossProfit, operating: aOperatingIncome, ebitda: aEbitda, netIncome: aNetIncome }, "annual");
  const balanceQuarterly = balanceRowsFromSeries({ cash: qCash, debt: qDebt, assets: qAssets, equity: qEquity, currentAssets: qCurrentAssets, currentLiabilities: qCurrentLiabilities }, "quarter");
  const balanceAnnual = balanceRowsFromSeries({ cash: aCash, debt: aDebt, assets: aAssets, equity: aEquity, currentAssets: aCurrentAssets, currentLiabilities: aCurrentLiabilities }, "annual");
  const cashflowQuarterly = cashflowRowsFromSeries({ operating: qOperatingCashFlow, capex: qCapex, freeCashFlow: qFreeCashFlow }, "quarter");
  const cashflowAnnual = cashflowRowsFromSeries({ operating: aOperatingCashFlow, capex: aCapex, freeCashFlow: aFreeCashFlow }, "annual");
  const latestIncome = incomeQuarterly[0] || incomeAnnual[0] || {};
  const latestBalance = balanceQuarterly[0] || balanceAnnual[0] || {};
  const latestCashflow = cashflowQuarterly[0] || cashflowAnnual[0] || {};
  if (![incomeQuarterly, incomeAnnual, balanceQuarterly, balanceAnnual, cashflowQuarterly, cashflowAnnual].some((rows) => rows.length)) return null;
  return {
    currency: seriesCurrency(qRevenue, aRevenue, qAssets, aAssets, qOperatingCashFlow, aOperatingCashFlow),
    source: "Yahoo fundamentals-timeseries",
    incomeQuarterly,
    incomeAnnual,
    balanceQuarterly,
    balanceAnnual,
    cashflowQuarterly,
    cashflowAnnual,
    latest: {
      date: latestIncome.date || latestBalance.date || latestCashflow.date || "",
      revenue: latestIncome.revenue,
      revenueGrowthYoY: latestIncome.revenueGrowthYoY,
      grossProfit: latestIncome.grossProfit,
      operatingIncome: latestIncome.operatingIncome,
      ebitda: latestIncome.ebitda,
      netIncome: latestIncome.netIncome,
      netIncomeGrowthYoY: latestIncome.netIncomeGrowthYoY,
      eps: latestIncome.eps,
      cash: latestBalance.cash,
      totalDebt: latestBalance.totalDebt,
      totalAssets: latestBalance.totalAssets,
      equity: latestBalance.equity,
      operatingCashFlow: latestCashflow.operatingCashFlow,
      freeCashFlow: latestCashflow.freeCashFlow,
    },
  };
}

function buildGrowthFromTimeseries(series) {
  const qRevenue = series.quarterlyTotalRevenue || [];
  const qNetIncome = series.quarterlyNetIncome || [];
  const qGrossProfit = series.quarterlyGrossProfit || [];
  const qOperatingIncome = series.quarterlyOperatingIncome || [];
  const qEbitda = series.quarterlyEBITDA || [];
  const aRevenue = series.annualTotalRevenue || [];
  const aNetIncome = series.annualNetIncome || [];
  const aGrossProfit = series.annualGrossProfit || [];
  const aOperatingIncome = series.annualOperatingIncome || [];
  const aEbitda = series.annualEBITDA || [];
  const equity = latestValue(series.annualStockholdersEquity || []);
  const assets = latestValue(series.annualTotalAssets || []);
  const debt = latestValue(series.annualTotalDebt || []);
  const currentAssets = latestValue(series.annualCurrentAssets || []);
  const currentLiabilities = latestValue(series.annualCurrentLiabilities || []);
  const trailingRevenue = latestValue(series.trailingTotalRevenue || []);
  const trailingNetIncome = latestValue(series.trailingNetIncome || []);
  const trailingEbitda = latestValue(series.trailingEBITDA || []);
  const latestQuarterRevenue = latestValue(qRevenue);
  const priorYearQuarterRevenue = sameQuarterLastYear(qRevenue)?.value ?? null;
  const latestQuarterNetIncome = latestValue(qNetIncome);
  const priorYearQuarterNetIncome = sameQuarterLastYear(qNetIncome)?.value ?? null;
  const revenue = firstFinite(latestQuarterRevenue, trailingRevenue, latestValue(aRevenue));
  const gross = firstFinite(latestValue(qGrossProfit), latestValue(aGrossProfit));
  const operating = firstFinite(latestValue(qOperatingIncome), latestValue(aOperatingIncome));
  const netIncome = firstFinite(latestQuarterNetIncome, trailingNetIncome, latestValue(aNetIncome));
  const ebitda = firstFinite(latestValue(qEbitda), trailingEbitda, latestValue(aEbitda));
  const annualRevenue = latestValue(aRevenue);
  const annualNetIncome = latestValue(aNetIncome);
  const financialResults = buildFinancialResultsFromTimeseries(series);

  return {
    revenueGrowth: firstFinite(pctChange(latestQuarterRevenue, priorYearQuarterRevenue), pctChange(annualRevenue, previousValue(aRevenue))),
    earningsGrowth: firstFinite(pctChange(latestQuarterNetIncome, priorYearQuarterNetIncome), pctChange(annualNetIncome, previousValue(aNetIncome))),
    grossMargin: ratioPct(gross, revenue),
    operatingMargin: ratioPct(operating, revenue),
    profitMargin: ratioPct(netIncome, revenue),
    ebitdaMargin: ratioPct(ebitda, revenue),
    roe: ratioPct(firstFinite(trailingNetIncome, annualNetIncome), equity),
    roa: ratioPct(firstFinite(trailingNetIncome, annualNetIncome), assets),
    debtToEquity: ratioPct(debt, equity),
    currentRatio: ratio(currentAssets, currentLiabilities),
    financialCurrency: latest(qRevenue)?.currency || latest(aRevenue)?.currency || "",
    fundamentalsAsOf: latest(qRevenue)?.date || latest(aRevenue)?.date || "",
    source: "Yahoo fundamentals-timeseries",
    financialResults,
  };
}

export async function fetchYahooFundamentals(symbol) {
  const yahooSymbol = canonicalYahooSymbol(symbol);
  const types = [
    "quarterlyTotalRevenue",
    "quarterlyNetIncome",
    "quarterlyGrossProfit",
    "quarterlyOperatingIncome",
    "quarterlyEBITDA",
    "quarterlyTotalDebt",
    "quarterlyTotalAssets",
    "quarterlyStockholdersEquity",
    "quarterlyCurrentAssets",
    "quarterlyCurrentLiabilities",
    "quarterlyCashCashEquivalentsAndShortTermInvestments",
    "quarterlyCashAndCashEquivalents",
    "quarterlyOperatingCashFlow",
    "quarterlyCapitalExpenditure",
    "quarterlyFreeCashFlow",
    "annualTotalRevenue",
    "annualNetIncome",
    "annualGrossProfit",
    "annualOperatingIncome",
    "annualEBITDA",
    "annualTotalDebt",
    "annualTotalAssets",
    "annualStockholdersEquity",
    "annualCurrentAssets",
    "annualCurrentLiabilities",
    "annualCashCashEquivalentsAndShortTermInvestments",
    "annualCashAndCashEquivalents",
    "annualOperatingCashFlow",
    "annualCapitalExpenditure",
    "annualFreeCashFlow",
    "trailingTotalRevenue",
    "trailingNetIncome",
    "trailingEBITDA",
  ].join(",");
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(yahooSymbol)}?symbol=${encodeURIComponent(yahooSymbol)}&type=${encodeURIComponent(types)}&period1=0&period2=2000000000`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`Yahoo fundamentals HTTP ${res.status}`);
  const data = await res.json();
  const series = normalizeSeries(data);
  return buildGrowthFromTimeseries(series);
}

function growthFromQuoteSummary(financial = {}, stats = {}, holders = {}, fundOwnership = [], institutionOwnership = [], insiderHolders = []) {
  return {
    revenueGrowth: percentValue(financial.revenueGrowth),
    earningsGrowth: percentValue(financial.earningsGrowth || stats.earningsQuarterlyGrowth),
    grossMargin: percentValue(financial.grossMargins),
    operatingMargin: percentValue(financial.operatingMargins),
    profitMargin: percentValue(financial.profitMargins || stats.profitMargins),
    ebitdaMargin: percentValue(financial.ebitdaMargins),
    roe: returnPercentValue(financial.returnOnEquity),
    roa: percentValue(financial.returnOnAssets),
    debtToEquity: safeNumber(financial.debtToEquity),
    currentRatio: safeNumber(financial.currentRatio),
    institutionalOwnership: percentValue(holders.institutionsPercentHeld || stats.heldPercentInstitutions),
    insiderOwnership: percentValue(holders.insidersPercentHeld || stats.heldPercentInsiders),
    shortPercentOfFloat: percentValue(stats.shortPercentOfFloat),
    sharesPercentSharesOut: percentValue(stats.sharesPercentSharesOut),
    shortRatio: safeNumber(stats.shortRatio),
    sharesShort: safeNumber(stats.sharesShort),
    sharesShortPriorMonth: safeNumber(stats.sharesShortPriorMonth),
    floatShares: safeNumber(stats.floatShares),
    sharesOutstanding: safeNumber(stats.sharesOutstanding),
    fundsCountApprox: Array.isArray(fundOwnership) ? fundOwnership.length : null,
    institutionsCountApprox: safeNumber(holders.institutionsCount) || (Array.isArray(institutionOwnership) ? institutionOwnership.length : null),
    topFunds: ownershipRows(fundOwnership),
    topInstitutions: ownershipRows(institutionOwnership),
    insiderHolders: Array.isArray(insiderHolders) ? insiderHolders.slice(0, 8) : [],
    source: "Yahoo quoteSummary",
  };
}

function mergeGrowthMetrics(timeseriesMetrics = {}, quoteMetrics = {}) {
  const merged = blankGrowthMetrics(quoteMetrics.source && timeseriesMetrics.source ? `${quoteMetrics.source} + ${timeseriesMetrics.source}` : quoteMetrics.source || timeseriesMetrics.source || "");
  for (const key of ["revenueGrowth", "earningsGrowth", "grossMargin", "operatingMargin", "profitMargin", "ebitdaMargin", "roe", "roa", "debtToEquity", "currentRatio"]) {
    merged[key] = firstFinite(quoteMetrics[key], timeseriesMetrics[key]);
  }
  merged.institutionalOwnership = firstFinite(quoteMetrics.institutionalOwnership, timeseriesMetrics.institutionalOwnership);
  merged.insiderOwnership = firstFinite(quoteMetrics.insiderOwnership, timeseriesMetrics.insiderOwnership);
  merged.shortPercentOfFloat = firstFinite(quoteMetrics.shortPercentOfFloat, timeseriesMetrics.shortPercentOfFloat);
  merged.sharesPercentSharesOut = firstFinite(quoteMetrics.sharesPercentSharesOut, timeseriesMetrics.sharesPercentSharesOut);
  merged.shortRatio = firstFinite(quoteMetrics.shortRatio, timeseriesMetrics.shortRatio);
  merged.sharesShort = firstFinite(quoteMetrics.sharesShort, timeseriesMetrics.sharesShort);
  merged.sharesShortPriorMonth = firstFinite(quoteMetrics.sharesShortPriorMonth, timeseriesMetrics.sharesShortPriorMonth);
  merged.floatShares = firstFinite(quoteMetrics.floatShares, timeseriesMetrics.floatShares);
  merged.sharesOutstanding = firstFinite(quoteMetrics.sharesOutstanding, timeseriesMetrics.sharesOutstanding);
  merged.fundsCountApprox = firstFinite(quoteMetrics.fundsCountApprox, timeseriesMetrics.fundsCountApprox);
  merged.institutionsCountApprox = firstFinite(quoteMetrics.institutionsCountApprox, timeseriesMetrics.institutionsCountApprox);
  merged.topFunds = quoteMetrics.topFunds?.length ? quoteMetrics.topFunds : (timeseriesMetrics.topFunds || []);
  merged.topInstitutions = quoteMetrics.topInstitutions?.length ? quoteMetrics.topInstitutions : (timeseriesMetrics.topInstitutions || []);
  merged.insiderHolders = quoteMetrics.insiderHolders?.length ? quoteMetrics.insiderHolders : (timeseriesMetrics.insiderHolders || []);
  merged.financialCurrency = quoteMetrics.financialCurrency || timeseriesMetrics.financialCurrency || "";
  merged.fundamentalsAsOf = quoteMetrics.fundamentalsAsOf || timeseriesMetrics.fundamentalsAsOf || "";
  return merged;
}

async function fetchStooqChart(symbol) {
  if (!STOOQ_API_KEY) throw new Error("Stooq fallback sin STOOQ_API_KEY");
  const stooq = stooqSymbol(symbol);
  if (!stooq) throw new Error("Stooq symbol no mapeado");
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooq)}&i=d&apikey=${encodeURIComponent(STOOQ_API_KEY)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv,*/*" }, next: { revalidate: 21600 } });
  if (!res.ok) throw new Error(`Stooq chart HTTP ${res.status}`);
  const text = await res.text();
  if (/get your apikey|apikey/i.test(text) && !/^date,/i.test(text.trim())) throw new Error("Stooq API key no valida o pendiente");
  const bars = parseStooqCsv(text);
  if (!bars.length) throw new Error("Stooq sin historico");
  return {
    bars,
    meta: {
      symbol: canonicalYahooSymbol(symbol),
      regularMarketPrice: bars[0]?.close,
      currency: "",
      dataProvider: "Stooq",
      stooqSymbol: stooq,
    },
  };
}

async function fetchYahooChartDirect(symbol) {
  const yahooSymbol = canonicalYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=2y&interval=1d&includePrePost=false&events=div%2Csplits`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, next: { revalidate: 21600 } });
  if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error("Sin historico Yahoo");
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const adj = r.indicators?.adjclose?.[0]?.adjclose || [];
  const bars = ts.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    close: Number(adj[i] ?? q.close?.[i]),
    high: Number(q.high?.[i] ?? q.close?.[i]),
    low: Number(q.low?.[i] ?? q.close?.[i]),
    volume: Number(q.volume?.[i] ?? 0),
  })).filter((x) => Number.isFinite(x.close) && x.close > 0).sort((a, b) => new Date(b.date) - new Date(a.date));
  return { bars, meta: { ...(r.meta || {}), dataProvider: "Yahoo Finance" } };
}

export async function fetchYahooChart(symbol) {
  const fallbackErrors = [];
  const runFallbacks = async (reason) => {
    try {
      const fallback = await fetchStooqChart(symbol);
      return { ...fallback, meta: { ...fallback.meta, fallbackReason: reason } };
    } catch (fallbackError) {
      fallbackErrors.push(fallbackError.message || "Stooq no disponible");
    }
    try {
      const fallback = await fetchAlphaVantageChart(symbol);
      return { ...fallback, meta: { ...fallback.meta, fallbackReason: reason } };
    } catch (fallbackError) {
      fallbackErrors.push(fallbackError.message || "Alpha Vantage no disponible");
    }
    throw new Error(`${reason || "Yahoo no disponible"} · ${fallbackErrors.join(" · ")}`);
  };
  try {
    const yahoo = await fetchYahooChartDirect(symbol);
    if ((yahoo.bars || []).length >= 20) return yahoo;
    return runFallbacks("Yahoo historico insuficiente");
  } catch (error) {
    return runFallbacks(error.message || "Yahoo no disponible");
  }
}

export async function fetchYahooProfile(symbol) {
  const yahooSymbol = canonicalYahooSymbol(symbol);
  const [summaryResult, fundamentalsResult, searchResult, quoteResult] = await Promise.allSettled([
    fetchYahooQuoteSummary(yahooSymbol),
    fetchYahooFundamentals(yahooSymbol),
    fetchYahooSearchProfile(yahooSymbol),
    fetchYahooQuote(yahooSymbol),
  ]);
  const r = summaryResult.status === "fulfilled" ? summaryResult.value : {};
  const search = searchResult.status === "fulfilled" ? searchResult.value : {};
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : {};
  const price = r.price || {};
  const profile = r.summaryProfile || r.assetProfile || {};
  const stats = r.defaultKeyStatistics || {};
  const financial = r.financialData || {};
  const summaryDetail = r.summaryDetail || {};
  const holders = r.majorHoldersBreakdown || {};
  const fundOwnership = r.fundOwnership?.ownershipList || [];
  const institutionOwnership = r.institutionOwnership?.ownershipList || [];
  const insiderHolders = r.insiderHolders?.holders || [];
  const firstTradeRaw = stats.firstTradeDateEpochUtc?.raw
    || (price.firstTradeDateMilliseconds ? Math.floor(price.firstTradeDateMilliseconds / 1000) : null)
    || (quote.firstTradeDateMilliseconds ? Math.floor(quote.firstTradeDateMilliseconds / 1000) : null);
  const quoteMetrics = summaryResult.status === "fulfilled" ? growthFromQuoteSummary(financial, stats, holders, fundOwnership, institutionOwnership, insiderHolders) : {};
  const quoteFallbackMetrics = quoteResult.status === "fulfilled" ? growthFromQuoteFallback(quote) : {};
  const mergedQuoteMetrics = mergeGrowthMetrics(quoteFallbackMetrics, quoteMetrics);
  const timeseriesMetrics = fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value : {};
  const growthMetrics = mergeGrowthMetrics(timeseriesMetrics, mergedQuoteMetrics);
  const fallback = fallbackProfile(yahooSymbol, quote, search);
  const sourceErrors = [
    summaryResult.status === "rejected" ? summaryResult.reason?.message : "",
    fundamentalsResult.status === "rejected" ? fundamentalsResult.reason?.message : "",
    searchResult.status === "rejected" ? searchResult.reason?.message : "",
    quoteResult.status === "rejected" ? quoteResult.reason?.message : "",
  ].filter(Boolean);
  const valuationMetrics = valuationMetricsFromSources({ quote, summaryDetail, stats, financial, price });
  const quoteSnapshot = quoteSnapshotFromSources(quote, price);

  return {
    name: firstText(price.longName, price.shortName, fallback.name, yahooSymbol),
    marketCap: firstFinite(safeNumber(price.marketCap), fallback.marketCap, quoteSnapshot.marketCap) || 0,
    sector: firstText(profile.sector, fallback.sector, "Sin sector"),
    industry: firstText(profile.industry, fallback.industry, "Sin industria"),
    exchange: firstText(price.exchangeName, price.exchange, fallback.exchange, "-"),
    currency: firstText(price.currency, fallback.currency, timeseriesMetrics.financialCurrency, ""),
    ipoDate: firstTradeRaw ? new Date(firstTradeRaw * 1000).toISOString().slice(0, 10) : "",
    website: profile.website || "",
    city: profile.city || "",
    country: profile.country || "",
    fullTimeEmployees: profile.fullTimeEmployees || null,
    businessSummary: profile.longBusinessSummary || profile.description || "",
    shortPercentOfFloat: growthMetrics.shortPercentOfFloat,
    sharesPercentSharesOut: growthMetrics.sharesPercentSharesOut,
    shortRatio: growthMetrics.shortRatio,
    sharesShort: growthMetrics.sharesShort,
    sharesShortPriorMonth: growthMetrics.sharesShortPriorMonth,
    floatShares: growthMetrics.floatShares,
    sharesOutstanding: growthMetrics.sharesOutstanding,
    valuationMetrics,
    quoteSnapshot,
    growthMetrics,
    fundamentalsFinancialResults: timeseriesMetrics.financialResults || null,
    profileProviderError: sourceErrors.length ? sourceErrors.join(" · ") : null,
  };
}
