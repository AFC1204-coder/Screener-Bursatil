import { envValue } from "@/lib/env";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

const JQUANTS_V2_BASE_URL = "https://api.jquants.com/v2";
const JQUANTS_V1_BASE_URL = "https://api.jquants.com/v1";
const DEFAULT_TIMEOUT_MS = 15000;

let v1TokenCache = null;

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = safeNumber(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function ymd(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}

function daysAgo(days = 390) {
  return ymd(new Date(Date.now() - Math.max(Number(days || 390), 1) * 86400 * 1000));
}

function withTimeout(ms = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function v2BaseUrl() {
  return (envValue("JQUANTS_API_BASE_URL") || JQUANTS_V2_BASE_URL).replace(/\/+$/, "");
}

function v1BaseUrl() {
  return (envValue("JQUANTS_V1_API_BASE_URL") || JQUANTS_V1_BASE_URL).replace(/\/+$/, "");
}

function v2ApiKey() {
  return envValue("JQUANTS_API_KEY");
}

function hasV1Auth() {
  return Boolean(envValue("JQUANTS_ID_TOKEN") || envValue("JQUANTS_REFRESH_TOKEN"));
}

export function jquantsStatus() {
  const key = Boolean(v2ApiKey());
  const refresh = Boolean(envValue("JQUANTS_REFRESH_TOKEN"));
  const idToken = Boolean(envValue("JQUANTS_ID_TOKEN"));
  return {
    configured: key || refresh || idToken,
    mode: key ? "v2-api-key" : (idToken ? "v1-id-token" : (refresh ? "v1-refresh-token" : "missing")),
    v2Configured: key,
    v1Configured: refresh || idToken,
    endpoints: {
      universe: key ? `${v2BaseUrl()}/equities/master` : `${v1BaseUrl()}/listed/info`,
      dailyBars: key ? `${v2BaseUrl()}/equities/bars/daily` : `${v1BaseUrl()}/prices/daily_quotes`,
      fundamentals: key ? `${v2BaseUrl()}/fins/summary` : `${v1BaseUrl()}/fins/statements`,
    },
    legalMode: "internal-cache-derived-output",
  };
}

export function jquantsSymbolToCode(symbol = "") {
  const clean = cleanText(symbol).toUpperCase();
  const match = clean.match(/^(\d{4})(?:0)?(?:\.T)?$/);
  if (!match) return "";
  return `${match[1]}0`;
}

export function jquantsCodeToSymbol(code = "") {
  const digits = cleanText(code).replace(/\D/g, "");
  if (/^\d{5}$/.test(digits) && digits.endsWith("0")) return `${digits.slice(0, 4)}.T`;
  if (/^\d{4}$/.test(digits)) return `${digits}.T`;
  return "";
}

async function fetchJson(url, { headers = {}, method = "GET", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timeout = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "User-Agent": "StatsEdge/0.1 jquants-refresh",
        ...headers,
      },
      signal: timeout.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      const error = new Error(data?.message || `J-Quants HTTP ${res.status}`);
      error.status = res.status;
      error.details = data;
      throw error;
    }
    return data;
  } finally {
    timeout.clear();
  }
}

async function v1IdToken() {
  const explicit = envValue("JQUANTS_ID_TOKEN");
  if (explicit) return explicit;
  const refreshToken = envValue("JQUANTS_REFRESH_TOKEN");
  if (!refreshToken) return "";
  if (v1TokenCache?.token && Date.now() < v1TokenCache.expiresAt) return v1TokenCache.token;
  const payload = await fetchJson(`${v1BaseUrl()}/token/auth_refresh?refreshtoken=${encodeURIComponent(refreshToken)}`, {
    method: "POST",
  });
  const token = cleanText(payload.idToken);
  if (token) v1TokenCache = { token, expiresAt: Date.now() + 20 * 60 * 1000 };
  return token;
}

async function pagedRequest(baseUrl, params = {}, payloadKey = "") {
  const out = [];
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value !== null && value !== undefined));
  while (true) {
    const url = `${baseUrl}?${query.toString()}`;
    const data = await fetchJson(url, {
      headers: v2ApiKey()
        ? { "x-api-key": v2ApiKey() }
        : { Authorization: `Bearer ${await v1IdToken()}` },
    });
    const rows = Array.isArray(data[payloadKey]) ? data[payloadKey] : Object.values(data).find(Array.isArray);
    if (Array.isArray(rows)) out.push(...rows);
    if (!data.pagination_key) break;
    query.set("pagination_key", data.pagination_key);
  }
  return out;
}

function normalizeV2Bar(row = {}) {
  const symbol = jquantsCodeToSymbol(row.Code || row.LocalCode || row.code);
  const close = firstFinite(row.AdjustmentClose, row.Close);
  return {
    symbol,
    date: ymd(row.Date || row.date),
    open: firstFinite(row.AdjustmentOpen, row.Open),
    high: firstFinite(row.AdjustmentHigh, row.High),
    low: firstFinite(row.AdjustmentLow, row.Low),
    close,
    adjClose: firstFinite(row.AdjustmentClose, row.Close),
    volume: firstFinite(row.AdjustmentVolume, row.Volume),
    turnoverValue: safeNumber(row.TurnoverValue),
    provider: "J-Quants V2 equities/bars/daily",
    raw: row,
  };
}

function normalizeV1Bar(row = {}) {
  const symbol = jquantsCodeToSymbol(row.Code || row.LocalCode);
  return {
    symbol,
    date: ymd(row.Date),
    open: firstFinite(row.AdjustmentOpen, row.Open),
    high: firstFinite(row.AdjustmentHigh, row.High),
    low: firstFinite(row.AdjustmentLow, row.Low),
    close: firstFinite(row.AdjustmentClose, row.Close),
    adjClose: firstFinite(row.AdjustmentClose, row.Close),
    volume: firstFinite(row.AdjustmentVolume, row.Volume),
    turnoverValue: safeNumber(row.TurnoverValue),
    provider: "J-Quants V1 prices/daily_quotes",
    raw: row,
  };
}

function normalizeFinancialRow(row = {}) {
  const symbol = jquantsCodeToSymbol(row.LocalCode || row.Code || row.code);
  const periodEnd = ymd(row.CurrentPeriodEndDate || row.CurrentFiscalYearEndDate || row.FiscalYearEndDate || row.DisclosedDate);
  const revenue = firstFinite(row.NetSales, row.OperatingRevenue, row.OrdinaryRevenue);
  const operatingIncome = firstFinite(row.OperatingProfit, row.OperatingIncome);
  const ordinaryProfit = firstFinite(row.OrdinaryProfit);
  const netIncome = firstFinite(row.Profit, row.ProfitAttributableToOwnersOfParent, row.NetIncome);
  return {
    symbol,
    periodEnd,
    periodType: cleanText(row.TypeOfCurrentPeriod || row.TypeOfDocument || row.FiscalQuarter || "quarter"),
    provider: v2ApiKey() ? "J-Quants V2 fins/summary" : "J-Quants V1 fins/statements",
    currency: "JPY",
    metrics: {
      disclosedDate: ymd(row.DisclosedDate),
      disclosedTime: cleanText(row.DisclosedTime),
      revenue,
      operatingIncome,
      ordinaryProfit,
      netIncome,
      eps: firstFinite(row.EarningsPerShare, row.BasicEarningsPerShare),
      forecastEps: firstFinite(row.ForecastEarningsPerShare),
      bookValuePerShare: firstFinite(row.BookValuePerShare),
      totalAssets: firstFinite(row.TotalAssets),
      equity: firstFinite(row.Equity),
      equityToAssetRatio: firstFinite(row.EquityToAssetRatio),
      dividendAnnual: firstFinite(row.ResultDividendPerShareAnnual),
      forecastDividendAnnual: firstFinite(row.ForecastDividendPerShareAnnual),
      revenueGrowth: firstFinite(row.NetSalesChange, row.NetSalesChanges),
      operatingIncomeGrowth: firstFinite(row.OperatingProfitChange, row.OperatingProfitChanges),
      netIncomeGrowth: firstFinite(row.ProfitChange, row.ProfitChanges),
      fiscalYear: cleanText(row.FiscalYear || row.CurrentFiscalYearStartDate),
    },
    raw: row,
  };
}

export async function fetchJquantsDailyBars(symbol, { from = "", to = "", days = 390 } = {}) {
  if (!jquantsStatus().configured) {
    const error = new Error("J-Quants no configurado");
    error.code = "JQUANTS_DISABLED";
    throw error;
  }
  const code = jquantsSymbolToCode(symbol);
  if (!code) throw new Error(`Simbolo J-Quants no soportado: ${symbol}`);
  const start = from || daysAgo(days);
  const end = to || ymd(new Date());
  if (v2ApiKey()) {
    const rows = await pagedRequest(`${v2BaseUrl()}/equities/bars/daily`, { code, from: start, to: end }, "daily_quotes");
    return rows.map(normalizeV2Bar).filter((row) => row.symbol && row.date && Number.isFinite(row.close));
  }
  if (!hasV1Auth()) throw new Error("J-Quants V1 sin refresh/id token");
  const rows = await pagedRequest(`${v1BaseUrl()}/prices/daily_quotes`, { code, from: start, to: end }, "daily_quotes");
  return rows.map(normalizeV1Bar).filter((row) => row.symbol && row.date && Number.isFinite(row.close));
}

export async function fetchJquantsFundamentals(symbol) {
  if (!jquantsStatus().configured) {
    const error = new Error("J-Quants no configurado");
    error.code = "JQUANTS_DISABLED";
    throw error;
  }
  const code = jquantsSymbolToCode(symbol);
  if (!code) throw new Error(`Simbolo J-Quants no soportado: ${symbol}`);
  const base = v2ApiKey() ? `${v2BaseUrl()}/fins/summary` : `${v1BaseUrl()}/fins/statements`;
  const payloadKey = v2ApiKey() ? "summary" : "statements";
  const rows = await pagedRequest(base, { code }, payloadKey);
  return rows.map(normalizeFinancialRow).filter((row) => row.symbol && row.periodEnd);
}

export async function writeJquantsBars(symbol, bars = []) {
  const config = supabaseConfig();
  if (!config.configured || !bars.length) return { written: false, count: 0, status: config.configured ? "empty" : "supabase-disabled" };
  for (let i = 0; i < bars.length; i += 500) {
    await supabaseRequest("daily_bars", {
      method: "POST",
      query: "on_conflict=owner_id,symbol,trade_date,provider",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: bars.slice(i, i + 500).map((bar) => ({
        owner_id: config.ownerId,
        symbol: bar.symbol || symbol,
        trade_date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        adj_close: bar.adjClose,
        volume: bar.volume,
        currency: "JPY",
        provider: bar.provider || "J-Quants",
        raw: { ...bar.raw, turnoverValue: bar.turnoverValue ?? null },
        updated_at: new Date().toISOString(),
      })),
    });
  }
  return { written: true, count: bars.length, status: "supabase" };
}

export async function writeJquantsFundamentals(symbol, rows = []) {
  const config = supabaseConfig();
  if (!config.configured || !rows.length) return { written: false, count: 0, status: config.configured ? "empty" : "supabase-disabled" };
  await supabaseRequest("fundamental_snapshots", {
    method: "POST",
    query: "on_conflict=owner_id,symbol,period_end,period_type,provider",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: rows.map((row) => ({
      owner_id: config.ownerId,
      symbol: row.symbol || symbol,
      period_end: row.periodEnd,
      period_type: row.periodType,
      provider: row.provider || "J-Quants",
      currency: row.currency || "JPY",
      metrics: row.metrics || {},
      raw: row.raw || {},
      updated_at: new Date().toISOString(),
    })),
  });
  return { written: true, count: rows.length, status: "supabase" };
}
