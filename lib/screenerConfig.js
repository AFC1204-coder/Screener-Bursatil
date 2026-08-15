// lib/screenerConfig.js — constantes de configuración del screener (mercados, vistas,
// cinta de índices, paginación y claves de capas), extraídas verbatim de app/page.jsx.
const MARKET_META = {
  US: { name: "Estados Unidos", exchange: "NYSE / Nasdaq", region: "Norteamerica" },
  ES: { name: "España", exchange: "BME", region: "Europa" },
  DE: { name: "Alemania", exchange: "Xetra", region: "Europa" },
  FR: { name: "Francia", exchange: "Euronext Paris", region: "Europa" },
  NL: { name: "Países Bajos", exchange: "Euronext Amsterdam", region: "Europa" },
  GB: { name: "Reino Unido", exchange: "LSE", region: "Europa" },
  CH: { name: "Suiza", exchange: "SIX", region: "Europa" },
  SE: { name: "Suecia", exchange: "Nasdaq Stockholm", region: "Europa" },
  DK: { name: "Dinamarca", exchange: "Nasdaq Copenhagen", region: "Europa" },
  NO: { name: "Noruega", exchange: "Oslo Bors", region: "Europa" },
  FI: { name: "Finlandia", exchange: "Nasdaq Helsinki", region: "Europa" },
  IT: { name: "Italia", exchange: "Borsa Italiana", region: "Europa" },
  BE: { name: "Bélgica", exchange: "Euronext Brussels", region: "Europa" },
  PT: { name: "Portugal", exchange: "Euronext Lisbon", region: "Europa" },
  AT: { name: "Austria", exchange: "Vienna", region: "Europa" },
  IE: { name: "Irlanda", exchange: "Euronext Dublin", region: "Europa" },
  CA: { name: "Canadá", exchange: "TSX", region: "Norteamérica" },
  JP: { name: "Japón", exchange: "TSE", region: "Asia" },
  HK: { name: "Hong Kong", exchange: "HKEX", region: "Asia" },
  SG: { name: "Singapur", exchange: "SGX", region: "Asia" },
  AU: { name: "Australia", exchange: "ASX", region: "Oceania" },
  ZA: { name: "Sudáfrica", exchange: "JSE", region: "África" },
  TW: { name: "Taiwán", exchange: "TWSE", region: "Asia" },
  IL: { name: "Israel", exchange: "TASE", region: "Asia" },
  KR: { name: "Corea del Sur", exchange: "KRX / KOSDAQ", region: "Asia" },
  IN: { name: "India", exchange: "NSE / BSE", region: "Asia" },
  CN: { name: "China A", exchange: "Shanghai / Shenzhen", region: "Asia" },
  BR: { name: "Brasil", exchange: "B3", region: "LatAm" },
  MX: { name: "México", exchange: "BMV", region: "LatAm" },
};
const MARKET_ORDER = ["US", "ES", "DE", "FR", "NL", "GB", "CH", "SE", "DK", "NO", "FI", "IT", "BE", "PT", "AT", "IE", "CA", "JP", "HK", "SG", "TW", "KR", "IN", "IL", "CN", "AU", "ZA", "BR", "MX"];
const MARKETS = MARKET_ORDER.map((code) => [code, MARKET_META[code].name]);
const EUROPE = ["ES", "DE", "FR", "NL", "GB", "CH", "SE", "DK", "NO", "FI", "IT", "BE", "PT", "AT", "IE"];
const ASIA = ["JP", "HK", "SG", "TW", "KR", "IN", "IL", "CN"];
const DEFAULT_MARKETS = ["US", ...EUROPE, "CA", ...ASIA, "AU", "ZA", "BR", "MX"];
const SCREENER_SESSION_VERSION = 4;
const RESULT_PAGE_SIZES = [50, 100];
const DEFAULT_RESULT_PAGE_SIZE = 50;
const SCAN_BATCH_SIZES = [50, 100];
const DEFAULT_SCAN_BATCH_SIZE = 100;
const FULL_SCAN_PARTIAL_EVERY = 25;
const SERVER_SCAN_POLL_MS = 2000;
const DEFAULT_STATUS = "Listo · Universo por defecto: EEUU + Europa + Asia/HK + Canadá + Australia/África/LatAm";
const SCREENER_FILTER_SETTING = { type: "screener_filters", key: "default" };
const USER_TEMPLATE_LIMIT = 18;
const DEFAULT_VIEW_LAYERS = { country: true, theme: true, sector: true, industry: true, sectorStrength: true, ipo: true };
const VIEW_LAYERS = [
  { key: "country", label: "País", detail: "bolsa nacional" },
  { key: "theme", label: "Tema", detail: "grupo temático operativo" },
  { key: "sector", label: "Sector", detail: "sector proveedor" },
  { key: "industry", label: "Subsector", detail: "industria proveedor" },
  { key: "sectorStrength", label: "Fuerza sector", detail: "fuerte / débil" },
  { key: "ipo", label: "IPO", detail: "categoría IPO" },
];
const SECTOR_STRENGTH_OPTIONS = ["Todos", "Fuertes", "Constructivos", "Débiles", "Muy débiles"];
const SECTOR_STRENGTH_LABELS = {
  Debiles: "Débiles",
  "Muy débiles": "Muy débiles",
  Débiles: "Débiles",
  "Muy débiles": "Muy débiles",
};
function normalizeSectorStrength(value = "Todos") {
  if (value === "Débiles") return "Débiles";
  if (value === "Muy débiles") return "Muy débiles";
  return value || "Todos";
}
const GLOBAL_INDEX_TAPE = [
  { market: "Global", symbol: "ACWI", label: "MSCI ACWI" },
  { market: "US", symbol: "^GSPC", label: "S&P 500" },
  { market: "US", symbol: "^IXIC", label: "Nasdaq" },
  { market: "US", symbol: "^RUT", label: "Russell 2000" },
  { market: "CA", symbol: "^GSPTSE", label: "TSX" },
  { market: "EU", symbol: "^STOXX50E", label: "Euro Stoxx 50" },
  { market: "GB", symbol: "^FTSE", label: "FTSE 100" },
  { market: "DE", symbol: "^GDAXI", label: "DAX" },
  { market: "FR", symbol: "^FCHI", label: "CAC 40" },
  { market: "ES", symbol: "^IBEX", label: "IBEX 35" },
  { market: "IT", symbol: "FTSEMIB.MI", label: "FTSE MIB" },
  { market: "CH", symbol: "^SSMI", label: "SMI" },
  { market: "NL", symbol: "^AEX", label: "AEX" },
  { market: "SE", symbol: "^OMX", label: "OMX Stockholm" },
  { market: "DK", symbol: "OMXC25.CO", label: "OMX C25" },
  { market: "NO", symbol: "OSEBX.OL", label: "OSEBX" },
  { market: "FI", symbol: "OMXH25.HE", label: "OMX Helsinki" },
  { market: "JP", symbol: "^N225", label: "Nikkei 225" },
  { market: "HK", symbol: "^HSI", label: "Hang Seng" },
  { market: "AU", symbol: "^AXJO", label: "ASX 200" },
  { market: "SG", symbol: "^STI", label: "Straits Times" },
  { market: "TW", symbol: "^TWII", label: "Taiwán" },
  { market: "KR", symbol: "^KS11", label: "KOSPI" },
  { market: "IN", symbol: "^NSEI", label: "Nifty 50" },
  { market: "IL", symbol: "^TA125.TA", label: "TA-125" },
  { market: "CN", symbol: "000001.SS", label: "Shanghai" },
  { market: "ZA", symbol: "^J203.JO", label: "JSE Top 40" },
  { market: "BR", symbol: "^BVSP", label: "Bovespa" },
  { market: "MX", symbol: "^MXX", label: "IPC México" },
];
function marketName(code = "") { return MARKET_META[String(code || "").toUpperCase()]?.name || code || "Sin país"; }
function marketExchange(code = "") { return MARKET_META[String(code || "").toUpperCase()]?.exchange || "Bolsa nacional"; }
const SORT_LABELS = {
  // Criterios de las columnas visibles de la tabla (lib/screenerColumns.jsx).
  perf3m: "Rendimiento 3M",
  perf6m: "Rendimiento 6M",
  perf12m: "Rendimiento 12M",
  distance52w: "Dist. máx 52s",
  marketCap: "Capitaliz.",
  objectiveScore: "Score compuesto",
  decisionPriority: "Calidad decisión",
  totalScore: "Composite",
  rsGlobalPct: "RS",
  rsRating: "RS Benchmark",
  volumeEffectScore: "Volumen",
  avgTurnover: "Liquidez",
  shortPercentOfFloat: "Short %",
  dataCoverageScore: "Cobertura",
  weaknessScore: "Deterioro",
};
const CORE_LAYER_KEYS = ["liquidity", "trend", "momentum", "relativeStrength", "proximity", "volatility", "score", "coverage"];
const OPTIONAL_LAYER_KEYS = ["pattern", "volumeSurge", "riskReward", "shortInterest", "ipo"];

export {
  MARKET_META,
  MARKET_ORDER,
  MARKETS,
  EUROPE,
  ASIA,
  DEFAULT_MARKETS,
  SCREENER_SESSION_VERSION,
  RESULT_PAGE_SIZES,
  DEFAULT_RESULT_PAGE_SIZE,
  SCAN_BATCH_SIZES,
  DEFAULT_SCAN_BATCH_SIZE,
  FULL_SCAN_PARTIAL_EVERY,
  SERVER_SCAN_POLL_MS,
  DEFAULT_STATUS,
  SCREENER_FILTER_SETTING,
  USER_TEMPLATE_LIMIT,
  DEFAULT_VIEW_LAYERS,
  VIEW_LAYERS,
  SECTOR_STRENGTH_OPTIONS,
  SECTOR_STRENGTH_LABELS,
  normalizeSectorStrength,
  GLOBAL_INDEX_TAPE,
  marketName,
  marketExchange,
  SORT_LABELS,
  CORE_LAYER_KEYS,
  OPTIONAL_LAYER_KEYS,
};
