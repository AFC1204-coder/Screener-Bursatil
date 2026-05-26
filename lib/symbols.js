export const SUFFIX_COUNTRIES = [
  [".TO", "CA", "Canada"],
  [".MC", "ES", "España"],
  [".DE", "DE", "Alemania"],
  [".F", "DE", "Alemania"],
  [".PA", "FR", "Francia"],
  [".AS", "NL", "Paises Bajos"],
  [".L", "GB", "Reino Unido"],
  [".SW", "CH", "Suiza"],
  [".ST", "SE", "Suecia"],
  [".CO", "DK", "Dinamarca"],
  [".OL", "NO", "Noruega"],
  [".HE", "FI", "Finlandia"],
  [".MI", "IT", "Italia"],
  [".BR", "BE", "Belgica"],
  [".LS", "PT", "Portugal"],
  [".VI", "AT", "Austria"],
  [".IR", "IE", "Irlanda"],
  [".T", "JP", "Japon"],
  [".HK", "HK", "Hong Kong"],
  [".SI", "SG", "Singapur"],
  [".JO", "ZA", "Sudafrica"],
  [".AX", "AU", "Australia"],
  [".TW", "TW", "Taiwan"],
  [".TA", "IL", "Israel"],
  [".KS", "KR", "Corea del Sur"],
  [".KQ", "KR", "Corea del Sur"],
  [".NS", "IN", "India"],
  [".BO", "IN", "India"],
  [".SS", "CN", "China"],
  [".SZ", "CN", "China"],
  [".SA", "BR", "Brasil"],
  [".MX", "MX", "Mexico"],
];

const TV_SUFFIXES = [
  [".MC", "BME"],
  [".DE", "XETR"],
  [".F", "FWB"],
  [".PA", "EURONEXT"],
  [".AS", "EURONEXT"],
  [".L", "LSE"],
  [".SW", "SIX"],
  [".ST", "OMXSTO"],
  [".CO", "OMXCOP"],
  [".OL", "OSL"],
  [".HE", "OMXHEX"],
  [".MI", "MIL"],
  [".BR", "EURONEXT"],
  [".LS", "EURONEXT"],
  [".VI", "VIE"],
  [".IR", "EURONEXT"],
  [".TO", "TSX"],
  [".T", "TSE"],
  [".HK", "HKEX"],
  [".SI", "SGX"],
  [".JO", "JSE"],
  [".AX", "ASX"],
  [".TW", "TWSE"],
  [".TA", "TASE"],
  [".KS", "KRX"],
  [".KQ", "KOSDAQ"],
  [".NS", "NSE"],
  [".BO", "BSE"],
  [".SS", "SSE"],
  [".SZ", "SZSE"],
  [".SA", "BMFBOVESPA"],
  [".MX", "BMV"],
];

export function cleanSymbol(symbol = "") {
  return String(symbol).trim().toUpperCase();
}

export function countryCode(symbol = "") {
  const s = cleanSymbol(symbol);
  return SUFFIX_COUNTRIES.find(([suffix]) => s.endsWith(suffix))?.[1] || "US";
}

export function countryName(code = "") {
  const clean = String(code || "").toUpperCase();
  if (clean === "US") return "Estados Unidos";
  return SUFFIX_COUNTRIES.find(([, country]) => country === clean)?.[2] || clean || "Sin país";
}

export function marketFlag(code = "") {
  const clean = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) return "◇";
  return String.fromCodePoint(...clean.split("").map((char) => 127397 + char.charCodeAt(0)));
}

export function stockUrl(symbol = "") {
  return `/stock/${encodeURIComponent(cleanSymbol(symbol))}`;
}

export function stripYahooSuffix(symbol = "", suffix = "") {
  return cleanSymbol(symbol).replace(suffix, "").replace("-", ".");
}

export function tradingViewBaseSymbol(symbol = "", suffix = "") {
  const base = stripYahooSuffix(symbol, suffix);
  if (suffix === ".HK" && /^\d+$/.test(base)) {
    return base.replace(/^0+(?=\d)/, "");
  }
  return base;
}

export function inferTradingViewSymbol(symbol = "", exchange = "") {
  const s = cleanSymbol(symbol);
  for (const [suffix, tvExchange] of TV_SUFFIXES) {
    if (s.endsWith(suffix)) return `${tvExchange}:${tradingViewBaseSymbol(s, suffix)}`;
  }

  const ex = String(exchange || "").toLowerCase();
  if (ex.includes("nyse")) return `NYSE:${s}`;
  if (ex.includes("amex") || ex.includes("american")) return `AMEX:${s}`;
  if (ex.includes("nasdaq")) return `NASDAQ:${s}`;
  return `NASDAQ:${s}`;
}

function googleFinanceQuote(symbol = "", exchange = "") {
  const s = cleanSymbol(symbol);
  const suffixMap = [
    [".HK", "HKG"],
    [".T", "TYO"],
    [".AX", "ASX"],
    [".MC", "BME"],
    [".DE", "ETR"],
    [".F", "FRA"],
    [".PA", "EPA"],
    [".AS", "AMS"],
    [".L", "LON"],
    [".SW", "SWX"],
    [".ST", "STO"],
    [".CO", "CPH"],
    [".OL", "OSL"],
    [".HE", "HEL"],
    [".MI", "BIT"],
    [".BR", "EBR"],
    [".LS", "ELI"],
    [".VI", "VIE"],
    [".IR", "DUB"],
    [".TO", "TSE"],
    [".SI", "SGX"],
    [".JO", "JSE"],
    [".TW", "TPE"],
    [".TA", "TLV"],
    [".KS", "KRX"],
    [".KQ", "KOSDAQ"],
  ];
  for (const [suffix, googleExchange] of suffixMap) {
    if (s.endsWith(suffix)) return `${tradingViewBaseSymbol(s, suffix)}:${googleExchange}`;
  }

  const ex = String(exchange || "").toLowerCase();
  if (ex.includes("nyse")) return `${s}:NYSE`;
  if (ex.includes("amex") || ex.includes("american")) return `${s}:NYSEAMERICAN`;
  return `${s}:NASDAQ`;
}

export function isTradingViewWidgetBlocked(symbol = "", tradingViewSymbol = "") {
  const s = cleanSymbol(symbol);
  const tv = String(tradingViewSymbol || "").trim().toUpperCase();
  const blockedSymbols = new Set(["6809.HK"]);
  if (blockedSymbols.has(s)) return true;
  if (s.endsWith(".T") || s.endsWith(".HK")) return true;
  return tv.startsWith("TSE:") || tv.startsWith("HKEX:");
}

export function externalLinks(symbol = "", exchange = "") {
  const s = cleanSymbol(symbol);
  const tv = inferTradingViewSymbol(s, exchange);
  return {
    tradingViewSymbol: tv,
    tradingView: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`,
    yahooFinance: `https://finance.yahoo.com/quote/${encodeURIComponent(s)}`,
    googleFinance: `https://www.google.com/finance/quote/${encodeURIComponent(googleFinanceQuote(s, exchange))}`,
  };
}

export function benchmarkForFavorite(favorite = {}) {
  const code = String(favorite.country || favorite.snapshot?.country || countryCode(favorite.symbol || "") || "").toUpperCase();
  const benchmarks = {
    US: "SPY",
    CA: "^GSPTSE",
    ES: "^IBEX",
    DE: "^GDAXI",
    FR: "^FCHI",
    NL: "^AEX",
    GB: "^FTSE",
    CH: "^SSMI",
    SE: "^OMX",
    DK: "^OMXC25",
    NO: "^OSEAX",
    FI: "^OMXH25",
    IT: "^FTSEMIB.MI",
    BE: "^BFX",
    PT: "PSI20.LS",
    AT: "^ATX",
    JP: "^N225",
    HK: "^HSI",
    SG: "^STI",
    ZA: "^J203.JO",
    AU: "^AXJO",
    TW: "^TWII",
    IL: "^TA125.TA",
    KR: "^KS11",
    IN: "^BSESN",
    CN: "000001.SS",
    BR: "^BVSP",
    MX: "^MXX",
  };
  return benchmarks[code] || "ACWI";
}
