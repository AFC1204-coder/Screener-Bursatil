export const PROVIDER_PLAN = [
  {
    id: "yahoo-chart",
    name: "Yahoo Finance chart",
    role: "Histórico diario y precio",
    tier: "gratis no oficial",
    status: "primary",
    envKey: "",
    coverage: "Global amplia con sufijos Yahoo",
  },
  {
    id: "stooq-chart",
    name: "Stooq CSV",
    role: "Fallback de histórico diario",
    tier: "gratis con clave CSV",
    status: "fallback",
    envKey: "STOOQ_API_KEY",
    coverage: "EEUU, Europa y varios mercados internacionales segun simbolo Stooq",
  },
  {
    id: "nasdaq-trader",
    name: "NasdaqTrader Symbol Directory",
    role: "Universo EEUU",
    tier: "gratis publico",
    status: "active",
    envKey: "",
    coverage: "NYSE/Nasdaq/AMEX listadas en EEUU",
  },
  {
    id: "sec-edgar",
    name: "SEC EDGAR companyfacts",
    role: "Fundamentales historicos EEUU",
    tier: "gratis publico",
    status: "active",
    envKey: "SEC_USER_AGENT",
    coverage: "Empresas con reporting SEC",
  },
  {
    id: "alpha-vantage",
    name: "Alpha Vantage",
    role: "Fallback opcional de historico diario",
    tier: "gratis con cuota y API key",
    status: "active",
    envKey: "ALPHA_VANTAGE_API_KEY",
    coverage: "Acciones globales segun simbolo soportado por Alpha Vantage",
  },
  {
    id: "fmp",
    name: "Financial Modeling Prep",
    role: "Fundamentales, ratios y perfil opcionales",
    tier: "gratis limitado con API key",
    status: "active",
    envKey: "FMP_API_KEY",
    coverage: "Cobertura variable por plan y mercado",
  },
  {
    id: "finnhub",
    name: "Finnhub",
    role: "Noticias, eventos y perfiles opcionales",
    tier: "gratis limitado con API key",
    status: "planned",
    envKey: "FINNHUB_API_KEY",
    coverage: "Cobertura variable por mercado y tipo de dato",
  },
  {
    id: "twelve-data",
    name: "Twelve Data",
    role: "Fallback global de precio/historico",
    tier: "gratis limitado con API key",
    status: "planned",
    envKey: "TWELVE_DATA_API_KEY",
    coverage: "Acciones, ETFs y divisas segun mercado soportado",
  },
  {
    id: "marketstack",
    name: "Marketstack",
    role: "Historico EOD global opcional",
    tier: "gratis limitado con API key",
    status: "planned",
    envKey: "MARKETSTACK_API_KEY",
    coverage: "EOD global y metadatos de exchanges",
  },
  {
    id: "openfigi",
    name: "OpenFIGI",
    role: "Normalizacion de simbolos globales",
    tier: "gratis limitado con API key opcional",
    status: "planned",
    envKey: "OPENFIGI_API_KEY",
    coverage: "Mapeo de tickers, FIGI, exchange y mercado",
  },
];

export function providerStatus() {
  return PROVIDER_PLAN.map((provider) => ({
    ...provider,
    configured: provider.envKey ? Boolean(process.env[provider.envKey]) : true,
  }));
}

const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || "";

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function canonicalSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const hk = clean.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return clean;
}

function alphaVantageSymbolCandidates(symbol = "") {
  const clean = canonicalSymbol(symbol);
  if (!clean.includes(".")) return [clean];
  const [baseRaw, suffix] = clean.split(".");
  const base = baseRaw.toUpperCase();
  const map = {
    HK: ["HKG"],
    MC: ["MAD"],
    DE: ["DEX", "FRA"],
    F: ["FRA", "DEX"],
    PA: ["PAR"],
    AS: ["AMS"],
    BR: ["BRU"],
    LS: ["LIS"],
    MI: ["MIL"],
    L: ["LON"],
    SW: ["SWX"],
    ST: ["STO"],
    OL: ["OSL"],
    CO: ["CPH"],
    HE: ["HEL"],
    IR: ["DUB"],
    T: ["TSE"],
    TW: ["TAI"],
    KS: ["KSC"],
    KQ: ["KOS"],
    NS: ["NSE"],
    BO: ["BSE"],
    SS: ["SHH"],
    SZ: ["SHZ"],
    AX: ["ASX"],
    SI: ["SIN"],
    TO: ["TRT"],
    V: ["VAN"],
    MX: ["MEX"],
    SA: ["SAO"],
  };
  const exchangeCodes = map[suffix] || [];
  const bases = suffix === "HK" ? [base, String(Number(base)).replace(/^0+/, "") || base] : [base];
  return [...new Set(bases.flatMap((candidateBase) => exchangeCodes.map((code) => `${candidateBase}.${code}`)))];
}

function alphaVantageErrorMessage(data = {}) {
  return data["Error Message"] || data.Note || data.Information || "";
}

function parseAlphaDaily(data = {}, alphaSymbol = "", originalSymbol = "") {
  const error = alphaVantageErrorMessage(data);
  if (error) throw new Error(`Alpha Vantage: ${error}`);
  const seriesKey = Object.keys(data).find((key) => /time series.*daily/i.test(key));
  const series = seriesKey ? data[seriesKey] : null;
  if (!series || typeof series !== "object") throw new Error("Alpha Vantage sin serie diaria");
  const bars = Object.entries(series)
    .map(([date, row]) => {
      const rawClose = safeNumber(row["4. close"]);
      const close = safeNumber(row["5. adjusted close"] ?? row["4. close"]);
      const factor = Number.isFinite(close) && Number.isFinite(rawClose) && rawClose > 0 ? close / rawClose : 1;
      const scaled = (value, fallback = close) => {
        const n = safeNumber(value);
        return Number.isFinite(n) ? n * factor : fallback;
      };
      return {
        date,
        open: scaled(row["1. open"]),
        close,
        high: scaled(row["2. high"]),
        low: scaled(row["3. low"]),
        volume: safeNumber(row["6. volume"] ?? row["5. volume"]) ?? 0,
      };
    })
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!bars.length) throw new Error("Alpha Vantage sin historico util");
  return {
    bars,
    meta: {
      symbol: canonicalSymbol(originalSymbol),
      regularMarketPrice: bars[0]?.close,
      dataProvider: "Alpha Vantage",
      alphaVantageSymbol: alphaSymbol,
    },
  };
}

export async function fetchAlphaVantageChart(symbol) {
  if (!ALPHA_VANTAGE_API_KEY) throw new Error("Alpha Vantage sin ALPHA_VANTAGE_API_KEY");
  const candidates = alphaVantageSymbolCandidates(symbol);
  if (!candidates.length) throw new Error("Alpha Vantage symbol no mapeado");
  const errors = [];
  for (const candidate of candidates) {
    const params = new URLSearchParams({
      function: "TIME_SERIES_DAILY_ADJUSTED",
      symbol: candidate,
      outputsize: "full",
      apikey: ALPHA_VANTAGE_API_KEY,
    });
    const url = `https://www.alphavantage.co/query?${params.toString()}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "StatsEdge/0.1", Accept: "application/json" },
        next: { revalidate: 21600 },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseAlphaDaily(await res.json(), candidate, symbol);
    } catch (error) {
      errors.push(`${candidate}: ${error.message || "sin dato"}`);
    }
  }
  throw new Error(errors.join(" · ") || "Alpha Vantage no disponible");
}
