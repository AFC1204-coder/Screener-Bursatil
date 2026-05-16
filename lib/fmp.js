const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const FMP_API_KEY = process.env.FMP_API_KEY || "";

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current / previous) - 1) * 100;
}

function toPercent(value) {
  const n = safeNumber(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 2 ? n * 100 : n;
}

function canonicalSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const hk = clean.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return clean;
}

async function fmpJson(path, params = {}, revalidate = 86400) {
  if (!FMP_API_KEY) return null;
  const query = new URLSearchParams({ ...params, apikey: FMP_API_KEY });
  const res = await fetch(`${FMP_BASE}${path}?${query.toString()}`, {
    headers: { "User-Agent": "StatsEdge/0.1", Accept: "application/json" },
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
  const data = await res.json();
  if (data?.Error || data?.["Error Message"]) throw new Error(data.Error || data["Error Message"]);
  return data;
}

function rowsByDate(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .filter((row) => row?.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function incomeRows(rows = [], period = "quarter") {
  const sorted = rowsByDate(rows);
  return sorted.slice(0, 8).map((row, index) => ({
    period,
    date: row.date,
    revenue: safeNumber(row.revenue),
    grossProfit: safeNumber(row.grossProfit),
    operatingIncome: safeNumber(row.operatingIncome),
    ebitda: safeNumber(row.ebitda),
    netIncome: safeNumber(row.netIncome),
    eps: firstFinite(safeNumber(row.epsdiluted), safeNumber(row.eps)),
    revenueGrowthYoY: period === "quarter" ? pctChange(safeNumber(row.revenue), safeNumber(sorted[index + 4]?.revenue)) : pctChange(safeNumber(row.revenue), safeNumber(sorted[index + 1]?.revenue)),
    netIncomeGrowthYoY: period === "quarter" ? pctChange(safeNumber(row.netIncome), safeNumber(sorted[index + 4]?.netIncome)) : pctChange(safeNumber(row.netIncome), safeNumber(sorted[index + 1]?.netIncome)),
  }));
}

function balanceRows(rows = [], period = "quarter") {
  return rowsByDate(rows).slice(0, 8).map((row) => ({
    period,
    date: row.date,
    cash: firstFinite(safeNumber(row.cashAndCashEquivalents), safeNumber(row.cashAndShortTermInvestments)),
    totalDebt: safeNumber(row.totalDebt),
    totalAssets: safeNumber(row.totalAssets),
    totalLiabilities: safeNumber(row.totalLiabilities),
    equity: firstFinite(safeNumber(row.totalStockholdersEquity), safeNumber(row.totalEquity)),
    currentAssets: safeNumber(row.totalCurrentAssets),
    currentLiabilities: safeNumber(row.totalCurrentLiabilities),
  }));
}

function cashflowRows(rows = [], period = "quarter") {
  return rowsByDate(rows).slice(0, 8).map((row) => ({
    period,
    date: row.date,
    operatingCashFlow: safeNumber(row.operatingCashFlow),
    capitalExpenditures: safeNumber(row.capitalExpenditure),
    freeCashFlow: safeNumber(row.freeCashFlow),
    dividendsPaid: safeNumber(row.dividendsPaid),
    repurchaseOfStock: safeNumber(row.commonStockRepurchased),
  }));
}

function financialResultsFromFmp({ incomeQuarterly = [], incomeAnnual = [], balanceQuarterly = [], balanceAnnual = [], cashflowQuarterly = [], cashflowAnnual = [], profile = {} } = {}) {
  const iq = incomeRows(incomeQuarterly, "quarter");
  const ia = incomeRows(incomeAnnual, "annual");
  const bq = balanceRows(balanceQuarterly, "quarter");
  const ba = balanceRows(balanceAnnual, "annual");
  const cq = cashflowRows(cashflowQuarterly, "quarter");
  const ca = cashflowRows(cashflowAnnual, "annual");
  const latestIncome = iq[0] || ia[0] || {};
  const latestBalance = bq[0] || ba[0] || {};
  const latestCashflow = cq[0] || ca[0] || {};
  if (!iq.length && !ia.length && !bq.length && !ba.length && !cq.length && !ca.length) return null;
  return {
    currency: firstText(incomeQuarterly[0]?.reportedCurrency, incomeAnnual[0]?.reportedCurrency, profile.currency),
    source: "Financial Modeling Prep",
    incomeQuarterly: iq,
    incomeAnnual: ia,
    balanceQuarterly: bq,
    balanceAnnual: ba,
    cashflowQuarterly: cq,
    cashflowAnnual: ca,
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

function metricsFromFmp({ ratios = {}, metrics = {}, incomeQuarterly = [], profile = {} } = {}) {
  const latest = incomeRows(incomeQuarterly, "quarter")[0] || {};
  return {
    revenueGrowth: latest.revenueGrowthYoY,
    earningsGrowth: latest.netIncomeGrowthYoY,
    grossMargin: toPercent(firstFinite(safeNumber(ratios.grossProfitMarginTTM), safeNumber(metrics.grossProfitMarginTTM))),
    operatingMargin: toPercent(firstFinite(safeNumber(ratios.operatingProfitMarginTTM), safeNumber(metrics.operatingProfitMarginTTM))),
    profitMargin: toPercent(firstFinite(safeNumber(ratios.netProfitMarginTTM), safeNumber(metrics.netProfitMarginTTM))),
    ebitdaMargin: toPercent(firstFinite(safeNumber(ratios.ebitdaMarginTTM), safeNumber(metrics.ebitdaMarginTTM))),
    roe: toPercent(firstFinite(safeNumber(ratios.returnOnEquityTTM), safeNumber(metrics.roeTTM))),
    roa: toPercent(firstFinite(safeNumber(ratios.returnOnAssetsTTM), safeNumber(metrics.roaTTM))),
    debtToEquity: firstFinite(safeNumber(metrics.debtToEquityTTM), safeNumber(ratios.debtEquityRatioTTM)),
    currentRatio: firstFinite(safeNumber(metrics.currentRatioTTM), safeNumber(ratios.currentRatioTTM)),
    sharesOutstanding: safeNumber(profile.sharesOutstanding),
    financialCurrency: profile.currency || "",
    fundamentalsAsOf: latest.date || "",
    source: "Financial Modeling Prep",
  };
}

function valuationFromFmp({ profile = {}, ratios = {}, metrics = {} } = {}) {
  return {
    trailingPe: firstFinite(safeNumber(metrics.peRatioTTM), safeNumber(ratios.priceEarningsRatioTTM)),
    priceToSales: firstFinite(safeNumber(metrics.priceToSalesRatioTTM), safeNumber(ratios.priceToSalesRatioTTM)),
    priceToBook: firstFinite(safeNumber(metrics.pbRatioTTM), safeNumber(ratios.priceToBookRatioTTM)),
    enterpriseValue: safeNumber(metrics.enterpriseValueTTM),
    enterpriseToRevenue: safeNumber(metrics.evToSalesTTM),
    enterpriseToEbitda: safeNumber(metrics.enterpriseValueOverEBITDATTM),
    beta: safeNumber(profile.beta),
    dividendYield: toPercent(profile.lastDiv),
    epsTrailingTwelveMonths: firstFinite(safeNumber(profile.eps), safeNumber(metrics.netIncomePerShareTTM)),
    averageVolume3m: safeNumber(profile.volAvg),
    sharesOutstanding: safeNumber(profile.sharesOutstanding),
    source: "Financial Modeling Prep",
  };
}

export async function fetchFmpCompanyData(symbol) {
  if (!FMP_API_KEY) return { configured: false };
  const clean = canonicalSymbol(symbol);
  const [
    profileData,
    ratiosData,
    metricsData,
    incomeQuarterly,
    incomeAnnual,
    balanceQuarterly,
    balanceAnnual,
    cashflowQuarterly,
    cashflowAnnual,
  ] = await Promise.all([
    fmpJson(`/profile/${encodeURIComponent(clean)}`),
    fmpJson(`/ratios-ttm/${encodeURIComponent(clean)}`),
    fmpJson(`/key-metrics-ttm/${encodeURIComponent(clean)}`),
    fmpJson(`/income-statement/${encodeURIComponent(clean)}`, { period: "quarter", limit: "8" }),
    fmpJson(`/income-statement/${encodeURIComponent(clean)}`, { limit: "6" }),
    fmpJson(`/balance-sheet-statement/${encodeURIComponent(clean)}`, { period: "quarter", limit: "8" }),
    fmpJson(`/balance-sheet-statement/${encodeURIComponent(clean)}`, { limit: "6" }),
    fmpJson(`/cash-flow-statement/${encodeURIComponent(clean)}`, { period: "quarter", limit: "8" }),
    fmpJson(`/cash-flow-statement/${encodeURIComponent(clean)}`, { limit: "6" }),
  ]);
  const profile = Array.isArray(profileData) ? profileData[0] || {} : {};
  const ratios = Array.isArray(ratiosData) ? ratiosData[0] || {} : {};
  const metrics = Array.isArray(metricsData) ? metricsData[0] || {} : {};
  const profileOut = {
    name: firstText(profile.companyName, profile.symbol),
    marketCap: safeNumber(profile.mktCap),
    sector: firstText(profile.sector),
    industry: firstText(profile.industry),
    exchange: firstText(profile.exchangeShortName, profile.exchange),
    currency: firstText(profile.currency),
    ipoDate: firstText(profile.ipoDate),
    website: firstText(profile.website),
    country: firstText(profile.country),
    fullTimeEmployees: safeNumber(profile.fullTimeEmployees),
    businessSummary: firstText(profile.description),
    image: firstText(profile.image),
  };
  return {
    configured: true,
    profile: profileOut,
    growthMetrics: metricsFromFmp({ ratios, metrics, incomeQuarterly: incomeQuarterly || [], profile }),
    valuationMetrics: valuationFromFmp({ profile, ratios, metrics }),
    quoteSnapshot: {
      price: safeNumber(profile.price),
      marketCap: safeNumber(profile.mktCap),
      source: "Financial Modeling Prep",
    },
    financialResults: financialResultsFromFmp({
      incomeQuarterly,
      incomeAnnual,
      balanceQuarterly,
      balanceAnnual,
      cashflowQuarterly,
      cashflowAnnual,
      profile,
    }),
  };
}
