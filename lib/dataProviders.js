import { openFigiStatus } from "@/lib/openfigi";

export const PROVIDER_PLAN = [
  {
    id: "yahoo-chart",
    name: "Yahoo Finance chart",
    role: "Histórico diario y precio",
    tier: "gratis no oficial",
    status: "primary",
    envKey: "",
    coverage: "Global amplia con sufijos Yahoo",
    capabilities: ["price", "ohlcv", "profile", "fundamentals", "ownership", "short-interest"],
    regions: ["US", "Europa", "Hong Kong", "Japon", "Australia"],
    legalLimit: "Endpoint no oficial; no usar como base de redistribucion comercial.",
  },
  {
    id: "stooq-chart",
    name: "Stooq CSV",
    role: "Fallback de histórico diario",
    tier: "gratis con clave CSV",
    status: "fallback",
    envKey: "STOOQ_API_KEY",
    coverage: "EEUU, Europa y varios mercados internacionales segun simbolo Stooq",
    capabilities: ["ohlcv"],
    regions: ["US", "Europa", "Japon", "Hong Kong", "Australia"],
    legalLimit: "Uso personal/investigacion; validar licencia antes de redistribuir.",
  },
  {
    id: "nasdaq-trader",
    name: "NasdaqTrader Symbol Directory",
    role: "Universo EEUU",
    tier: "gratis publico",
    status: "active",
    envKey: "",
    coverage: "NYSE/Nasdaq/AMEX listadas en EEUU",
    capabilities: ["universe"],
    regions: ["US"],
    legalLimit: "Directorio publico; no contiene fundamentales ni historico.",
  },
  {
    id: "sec-edgar",
    name: "SEC EDGAR companyfacts",
    role: "Fundamentales historicos EEUU",
    tier: "gratis publico",
    status: "active",
    envKey: "SEC_USER_AGENT",
    coverage: "Empresas con reporting SEC",
    capabilities: ["fundamentals"],
    regions: ["US"],
    legalLimit: "Fuente publica oficial; respetar User-Agent y cache.",
  },
  {
    id: "alpha-vantage",
    name: "Alpha Vantage",
    role: "Fallback opcional de historico diario",
    tier: "gratis con cuota y API key",
    status: "active",
    envKey: "ALPHA_VANTAGE_API_KEY",
    coverage: "Acciones globales segun simbolo soportado por Alpha Vantage",
    capabilities: ["ohlcv"],
    regions: ["US", "Europa", "Hong Kong", "Japon", "Australia"],
    legalLimit: "Cuota gratuita muy baja; usar solo como fallback puntual.",
  },
  {
    id: "fmp",
    name: "Financial Modeling Prep",
    role: "Fundamentales, ratios y perfil opcionales",
    tier: "gratis limitado con API key",
    status: "active",
    envKey: "FMP_API_KEY",
    coverage: "Cobertura variable por plan y mercado",
    capabilities: ["profile", "fundamentals", "valuation"],
    regions: ["US", "Europa", "Canada"],
    legalLimit: "Cobertura global depende del plan; validar licencia si se publica.",
  },
  {
    id: "openfigi",
    name: "OpenFIGI",
    role: "Normalizacion de simbolos, ISIN, FIGI, MIC y exchange",
    tier: "gratis con cuota; API key opcional",
    status: "active",
    envKey: "OPENFIGI_API_KEY",
    optionalKey: true,
    coverage: "Mapeo global de identificadores, no datos de precio",
    capabilities: ["symbol-normalization", "isin", "figi", "exchange-mapping"],
    regions: ["US", "Europa", "Hong Kong", "Japon", "Australia"],
    legalLimit: "No es proveedor de mercado; guardar solo mapping necesario y respetar rate limits.",
  },
  {
    id: "esef-filings",
    name: "ESEF filings / filings.xbrl.org",
    role: "Fundamentales anuales europeos normalizables desde XBRL",
    tier: "gratis publico",
    status: "planned",
    envKey: "",
    coverage: "Europa: informes anuales ESEF; requiere parser XBRL",
    capabilities: ["fundamentals", "annual-reports"],
    regions: ["Europa"],
    legalLimit: "Fuente publica, pero los estados no vienen homogenizados para screener.",
  },
  {
    id: "asic-short",
    name: "ASIC short position reports",
    role: "Short interest agregado Australia",
    tier: "gratis publico",
    status: "active",
    envKey: "",
    coverage: "Australia: posiciones cortas agregadas publicadas con lag",
    capabilities: ["short-interest"],
    regions: ["Australia"],
    legalLimit: "Dato agregado y retrasado; no identifica vendedores en corto.",
  },
  {
    id: "universe-engine-cache",
    name: "StatsEdge Universe Engine",
    role: "Normalizacion, Quality Gate, Coverage Score y cache de universos",
    tier: "interno",
    status: "active",
    envKey: "SUPABASE_SERVICE_ROLE_KEY",
    optionalKey: true,
    coverage: "Todos los mercados soportados por universos publicos/curados actuales",
    capabilities: ["universe", "quality-gate", "coverage-score", "cache"],
    regions: ["US", "Europa", "Hong Kong", "Japon", "Australia"],
    legalLimit: "Cache interno de investigacion; no redistribuir datos de fuentes ni saltar limites de APIs/exchanges.",
  },
  {
    id: "sfc-hk-short",
    name: "SFC/HKEX short disclosures",
    role: "Short interest/turnover oficial Hong Kong",
    tier: "gratis publico",
    status: "planned",
    envKey: "",
    coverage: "Hong Kong: posiciones cortas agregadas y short-selling turnover",
    capabilities: ["short-interest", "short-turnover"],
    regions: ["Hong Kong"],
    legalLimit: "Series no equivalentes a short float US; requiere etiquetar metodologia.",
  },
  {
    id: "jquants",
    name: "J-Quants",
    role: "Universo, OHLCV, fundamentales y short-selling sectorial Japon",
    tier: "free/low-cost segun plan",
    status: "active-when-configured",
    envKey: "JQUANTS_API_KEY",
    coverage: "Japon/TSE; Universe Engine usa V2 /equities/master con API key o V1 listed/info con refresh token",
    capabilities: ["universe", "ohlcv", "fundamentals", "short-selling"],
    regions: ["Japon"],
    legalLimit: "Validar plan y redistribucion antes de publicar datos a terceros.",
  },
  {
    id: "hkex-securities-list",
    name: "HKEX Full List of Securities",
    role: "Universo Hong Kong",
    tier: "gratis publico",
    status: "active",
    envKey: "",
    coverage: "Hong Kong: lista oficial de securities; se filtran equities HKD y REITs, excluyendo ETFs, deuda, warrants y CBBCs",
    capabilities: ["universe", "isin", "short-sell-eligibility"],
    regions: ["Hong Kong"],
    legalLimit: "Fuente publica de referencia; usar como cache interno y revisar terminos antes de redistribuir listados completos.",
  },
  {
    id: "eodhd",
    name: "EODHD",
    role: "Backbone low-cost global para EOD, fundamentales y acciones corporativas",
    tier: "low-cost/premium",
    status: "planned-premium-candidate",
    envKey: "EODHD_API_KEY",
    coverage: "Global amplio; candidato premium para Europa, Hong Kong y Australia",
    capabilities: ["ohlcv", "fundamentals", "corporate-actions", "exchange-metadata"],
    regions: ["US", "Europa", "Hong Kong", "Japon", "Australia"],
    legalLimit: "Validar plan comercial/display antes de usar fuera de investigacion personal.",
  },
  {
    id: "finnhub",
    name: "Finnhub",
    role: "Noticias, eventos y perfiles opcionales",
    tier: "gratis limitado con API key",
    status: "planned-premium-candidate",
    envKey: "FINNHUB_API_KEY",
    coverage: "Cobertura variable por mercado y tipo de dato",
    capabilities: ["news", "profile", "events"],
    regions: ["US", "Europa"],
    legalLimit: "Free tier util para prototipo; revisar licencia si hay producto publico.",
  },
  {
    id: "twelve-data",
    name: "Twelve Data",
    role: "Fallback global de precio/historico",
    tier: "gratis limitado con API key",
    status: "planned-premium-candidate",
    envKey: "TWELVE_DATA_API_KEY",
    coverage: "Acciones, ETFs y divisas segun mercado soportado",
    capabilities: ["ohlcv", "quote"],
    regions: ["US", "Europa", "Hong Kong", "Japon", "Australia"],
    legalLimit: "La cuota gratuita no escala para scans globales amplios.",
  },
  {
    id: "marketstack",
    name: "Marketstack",
    role: "Historico EOD global opcional",
    tier: "gratis limitado con API key",
    status: "planned-premium-candidate",
    envKey: "MARKETSTACK_API_KEY",
    coverage: "EOD global y metadatos de exchanges",
    capabilities: ["ohlcv", "eod"],
    regions: ["US", "Europa", "Hong Kong", "Japon", "Australia"],
    legalLimit: "Revisar redistribucion/display; utilidad principal es EOD.",
  },
];

export function providerStatus() {
  return PROVIDER_PLAN.map((provider) => ({
    ...provider,
    configured: provider.optionalKey ? true : (provider.envKey ? Boolean(process.env[provider.envKey]) : true),
    keyConfigured: provider.envKey ? Boolean(process.env[provider.envKey]) : null,
    runtime: provider.id === "openfigi" ? openFigiStatus() : null,
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
