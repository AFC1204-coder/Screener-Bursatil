const SEC_BASE = "https://data.sec.gov";
const SEC_WWW = "https://www.sec.gov";
const SEC_HEADERS = {
  "User-Agent": process.env.SEC_USER_AGENT || "StatsEdge/0.1 personal research app",
  Accept: "application/json",
};

const PROVIDER_NOTE = "Datos aproximados según proveedor disponible; no equivalen a ratings propietarios de MarketSurge.";

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
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

function daysBetween(start, end) {
  if (!start || !end) return null;
  const a = new Date(start);
  const b = new Date(end);
  const days = (b.getTime() - a.getTime()) / 86400000;
  return Number.isFinite(days) ? days : null;
}

function isPlainUsTicker(symbol = "") {
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) && !symbol.includes(".");
}

function cik10(cik) {
  return String(cik || "").replace(/\D/g, "").padStart(10, "0");
}

async function secJson(url, revalidate = 86400, options = {}) {
  const cacheOptions = options.noStore ? { cache: "no-store" } : { next: { revalidate } };
  const res = await fetch(url, { headers: SEC_HEADERS, ...cacheOptions });
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
  return res.json();
}

export async function fetchSecTickerMap() {
  const data = await secJson(`${SEC_WWW}/files/company_tickers.json`, 7 * 86400);
  return Object.values(data || {}).map((row) => ({
    cik: cik10(row.cik_str),
    ticker: String(row.ticker || "").toUpperCase(),
    title: row.title || "",
  }));
}

export async function cikForTicker(symbol) {
  const clean = String(symbol || "").toUpperCase().trim();
  if (!isPlainUsTicker(clean)) return null;
  const rows = await fetchSecTickerMap();
  return rows.find((row) => row.ticker === clean) || null;
}

function unitsFor(facts, aliases, unit = "USD") {
  const usGaap = facts?.facts?.["us-gaap"] || {};
  const out = [];
  for (const tag of aliases) {
    const rows = usGaap[tag]?.units?.[unit];
    if (Array.isArray(rows) && rows.length) out.push(...rows.map((row) => ({ ...row, tag })));
  }
  return out;
}

function cleanFactRows(rows = []) {
  return rows
    .map((row) => ({
      tag: row.tag,
      start: row.start || "",
      end: row.end || "",
      filed: row.filed || "",
      form: row.form || "",
      fp: row.fp || "",
      fy: safeNumber(row.fy),
      frame: row.frame || "",
      val: safeNumber(row.val),
      days: daysBetween(row.start, row.end),
    }))
    .filter((row) => Number.isFinite(row.val) && row.end && ["10-K", "10-Q", "20-F", "40-F"].includes(row.form))
    .sort((a, b) => {
      const endDiff = new Date(a.end) - new Date(b.end);
      if (endDiff !== 0) return endDiff;
      return new Date(a.filed || 0) - new Date(b.filed || 0);
    });
}

function annualRows(facts, aliases, unit = "USD") {
  const rows = cleanFactRows(unitsFor(facts, aliases, unit)).filter((row) => (
    /^CY\d{4}$/.test(row.frame) ||
    row.fp === "FY" ||
    row.form === "10-K" ||
    (Number.isFinite(row.days) && row.days >= 320)
  ));
  return latestByPeriod(rows).sort((a, b) => {
    const endDiff = new Date(a.end) - new Date(b.end);
    if (endDiff !== 0) return endDiff;
    return new Date(a.filed || 0) - new Date(b.filed || 0);
  });
}

function quarterRows(facts, aliases, unit = "USD") {
  const rows = cleanFactRows(unitsFor(facts, aliases, unit));
  const framed = rows.filter((row) => /^CY\d{4}Q[1-4]$/.test(row.frame) && !row.frame.endsWith("I"));
  const discrete = rows.filter((row) => Number.isFinite(row.days) && row.days >= 70 && row.days <= 125);
  return latestByPeriod([...discrete, ...framed]).sort((a, b) => {
    const endDiff = new Date(a.end) - new Date(b.end);
    if (endDiff !== 0) return endDiff;
    return new Date(a.filed || 0) - new Date(b.filed || 0);
  });
}

function instantRows(facts, aliases, unit = "USD") {
  return cleanFactRows(unitsFor(facts, aliases, unit)).filter((row) => !row.start || row.days === 0 || row.frame.endsWith("I"));
}

function latest(rows = []) {
  return rows.length ? rows[rows.length - 1] : null;
}

function previous(rows = []) {
  return rows.length > 1 ? rows[rows.length - 2] : null;
}

function latestByPeriod(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = row.end || `${row.fy}-${row.fp}-${row.tag}`;
    const prev = map.get(key);
    if (!prev || new Date(row.filed || row.end) >= new Date(prev.filed || prev.end)) map.set(key, row);
  }
  return [...map.values()];
}

function maxDate(...values) {
  const dates = values.filter(Boolean).map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime()));
  if (!dates.length) return "";
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString().slice(0, 10);
}

function value(row) {
  return row?.val ?? null;
}

function sumLatest(facts, groups) {
  const parts = groups.map((aliases) => latest(instantRows(facts, aliases))).filter(Boolean);
  if (!parts.length) return null;
  const latestEnd = parts.map((row) => row.end).sort().at(-1);
  const closeParts = parts.filter((row) => row.end === latestEnd);
  if (!closeParts.length) return null;
  const total = closeParts.reduce((acc, row) => acc + (Number.isFinite(row.val) ? row.val : 0), 0);
  return Number.isFinite(total) && total !== 0 ? { val: total, end: latestEnd } : null;
}

const TAGS = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "SalesRevenueServicesNet",
  ],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  ebitda: [
    "EarningsBeforeInterestTaxesDepreciationAndAmortization",
    "EarningsBeforeInterestTaxesDepreciationDepletionAndAmortization",
  ],
  assets: ["Assets"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  totalDebt: [
    "DebtAndFinanceLeaseObligations",
    "LongTermDebtAndFinanceLeaseObligations",
    "LongTermDebt",
    "Debt",
  ],
  debtCurrent: ["LongTermDebtAndFinanceLeaseObligationsCurrent", "LongTermDebtCurrent", "ShortTermBorrowings"],
  debtNoncurrent: ["LongTermDebtAndFinanceLeaseObligationsNoncurrent", "LongTermDebtNoncurrent"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  epsDiluted: ["EarningsPerShareDiluted"],
};

function valueNear(rows = [], end = "") {
  if (!end) return null;
  const matches = rows.filter((row) => row.end === end);
  return value(matches.at(-1));
}

function statementResultRows({ revenue = [], gross = [], operating = [], ebitda = [], netIncome = [], eps = [] }, period = "quarter") {
  return revenue.slice(-8).reverse().map((row, index, sorted) => ({
    period,
    date: row.end,
    revenue: value(row),
    grossProfit: valueNear(gross, row.end),
    operatingIncome: valueNear(operating, row.end),
    ebitda: valueNear(ebitda, row.end),
    netIncome: valueNear(netIncome, row.end),
    eps: valueNear(eps, row.end),
    revenueGrowthYoY: period === "quarter" ? pctChange(value(row), value(sorted[index + 4])) : pctChange(value(row), value(sorted[index + 1])),
    netIncomeGrowthYoY: period === "quarter" ? pctChange(valueNear(netIncome, row.end), valueNear(netIncome, sorted[index + 4]?.end)) : pctChange(valueNear(netIncome, row.end), valueNear(netIncome, sorted[index + 1]?.end)),
  }));
}

function instantResultRows(rows = [], period = "quarter") {
  return rows.slice(-8).reverse().map((row) => ({ period, date: row.end, value: value(row) }));
}

function cashflowResultRows({ operating = [], capex = [] }, period = "quarter") {
  return operating.slice(-8).reverse().map((row) => {
    const operatingCashFlow = value(row);
    const capitalExpenditures = valueNear(capex, row.end);
    return {
      period,
      date: row.end,
      operatingCashFlow,
      capitalExpenditures,
      freeCashFlow: Number.isFinite(operatingCashFlow) && Number.isFinite(capitalExpenditures) ? operatingCashFlow - Math.abs(capitalExpenditures) : null,
    };
  });
}

function buildMetricsFromFacts(facts, entity = {}) {
  const qRevenue = quarterRows(facts, TAGS.revenue);
  const aRevenue = annualRows(facts, TAGS.revenue);
  const qNetIncome = quarterRows(facts, TAGS.netIncome);
  const aNetIncome = annualRows(facts, TAGS.netIncome);
  const qGross = quarterRows(facts, TAGS.grossProfit);
  const aGross = annualRows(facts, TAGS.grossProfit);
  const qOperating = quarterRows(facts, TAGS.operatingIncome);
  const aOperating = annualRows(facts, TAGS.operatingIncome);
  const qEbitda = quarterRows(facts, TAGS.ebitda);
  const aEbitda = annualRows(facts, TAGS.ebitda);
  const assets = latest(instantRows(facts, TAGS.assets));
  const equity = latest(instantRows(facts, TAGS.equity));
  const currentAssets = latest(instantRows(facts, TAGS.currentAssets));
  const currentLiabilities = latest(instantRows(facts, TAGS.currentLiabilities));
  const totalDebt = latest(instantRows(facts, TAGS.totalDebt)) || sumLatest(facts, [TAGS.debtCurrent, TAGS.debtNoncurrent]);
  const qOperatingCashFlow = quarterRows(facts, TAGS.operatingCashFlow);
  const aOperatingCashFlow = annualRows(facts, TAGS.operatingCashFlow);
  const qCapex = quarterRows(facts, TAGS.capex);
  const aCapex = annualRows(facts, TAGS.capex);
  const qEps = quarterRows(facts, TAGS.epsDiluted, "USD/shares");
  const aEps = annualRows(facts, TAGS.epsDiluted, "USD/shares");

  const revenue = firstFinite(value(latest(qRevenue)), value(latest(aRevenue)));
  const netIncome = firstFinite(value(latest(qNetIncome)), value(latest(aNetIncome)));
  const gross = firstFinite(value(latest(qGross)), value(latest(aGross)));
  const operating = firstFinite(value(latest(qOperating)), value(latest(aOperating)));
  const ebitda = firstFinite(value(latest(qEbitda)), value(latest(aEbitda)));
  const annualNetIncome = value(latest(aNetIncome));

  const hasAny = [qRevenue, aRevenue, qNetIncome, aNetIncome, assets, equity].some((rows) => Array.isArray(rows) && rows.length);
  if (!hasAny) throw new Error("SEC sin conceptos financieros utiles");

  return {
    revenueGrowth: firstFinite(
      pctChange(value(latest(qRevenue)), value(qRevenue.at(-5))),
      pctChange(value(latest(aRevenue)), value(previous(aRevenue)))
    ),
    earningsGrowth: firstFinite(
      pctChange(value(latest(qNetIncome)), value(qNetIncome.at(-5))),
      pctChange(value(latest(aNetIncome)), value(previous(aNetIncome)))
    ),
    grossMargin: ratioPct(gross, revenue),
    operatingMargin: ratioPct(operating, revenue),
    profitMargin: ratioPct(netIncome, revenue),
    ebitdaMargin: ratioPct(ebitda, revenue),
    roe: ratioPct(firstFinite(annualNetIncome, netIncome), value(equity)),
    roa: ratioPct(firstFinite(annualNetIncome, netIncome), value(assets)),
    debtToEquity: ratioPct(value(totalDebt), value(equity)),
    currentRatio: ratio(value(currentAssets), value(currentLiabilities)),
    financialCurrency: "USD",
    fundamentalsAsOf: maxDate(latest(qRevenue)?.end, latest(aRevenue)?.end, latest(assets)?.end, latest(equity)?.end),
    providerNote: PROVIDER_NOTE,
    source: "SEC EDGAR companyfacts",
    financialResults: {
      currency: "USD",
      source: "SEC EDGAR companyfacts",
      incomeQuarterly: statementResultRows({ revenue: qRevenue, gross: qGross, operating: qOperating, ebitda: qEbitda, netIncome: qNetIncome, eps: qEps }, "quarter"),
      incomeAnnual: statementResultRows({ revenue: aRevenue, gross: aGross, operating: aOperating, ebitda: aEbitda, netIncome: aNetIncome, eps: aEps }, "annual"),
      balanceQuarterly: [{
        period: "quarter",
        date: maxDate(latest(assets)?.end, latest(equity)?.end, totalDebt?.end, latest(currentAssets)?.end),
        cash: null,
        totalDebt: value(totalDebt),
        totalAssets: value(assets),
        totalLiabilities: null,
        equity: value(equity),
      }],
      balanceAnnual: [{
        period: "annual",
        date: maxDate(latest(assets)?.end, latest(equity)?.end, totalDebt?.end, latest(currentAssets)?.end),
        cash: null,
        totalDebt: value(totalDebt),
        totalAssets: value(assets),
        totalLiabilities: null,
        equity: value(equity),
      }],
      cashflowQuarterly: cashflowResultRows({ operating: qOperatingCashFlow, capex: qCapex }, "quarter"),
      cashflowAnnual: cashflowResultRows({ operating: aOperatingCashFlow, capex: aCapex }, "annual"),
    },
    sec: {
      cik: entity.cik || "",
      entityName: facts.entityName || entity.title || "",
      asOf: maxDate(latest(qRevenue)?.end, latest(aRevenue)?.end, latest(assets)?.end, latest(equity)?.end),
    },
  };
}

export function mergeSecGrowthMetrics(base = {}, secMetrics = null) {
  if (!secMetrics) return base;
  const out = { ...base };
  for (const key of [
    "revenueGrowth",
    "earningsGrowth",
    "grossMargin",
    "operatingMargin",
    "profitMargin",
    "ebitdaMargin",
    "roe",
    "roa",
    "debtToEquity",
    "currentRatio",
  ]) {
    out[key] = firstFinite(out[key], secMetrics[key]);
  }
  out.financialCurrency = out.financialCurrency || secMetrics.financialCurrency || "";
  out.fundamentalsAsOf = out.fundamentalsAsOf || secMetrics.fundamentalsAsOf || "";
  out.providerNote = out.providerNote || secMetrics.providerNote || PROVIDER_NOTE;
  out.source = [base.source, secMetrics.source].filter(Boolean).join(" + ") || secMetrics.source;
  out.sec = secMetrics.sec;
  return out;
}

export async function fetchSecFundamentals(symbol) {
  const entity = await cikForTicker(symbol);
  if (!entity?.cik) throw new Error("SEC EDGAR solo cubre tickers USA con CIK");
  const facts = await secJson(`${SEC_BASE}/api/xbrl/companyfacts/CIK${entity.cik}.json`, 86400, { noStore: true });
  return buildMetricsFromFacts(facts, entity);
}
