// MIC canónico para el histórico. Nunca deriva la bolsa desde country/market:
// usa el MIC explícito del proveedor, el código exacto de Yahoo o el sufijo de
// cotización. Un "NASDAQ" genérico es deliberadamente irresoluble porque no
// distingue XNCM/XNGS/XNMS/XNAS.

const SUFFIX_TO_MIC = [
  [".TO", "XTSE"],
  [".V", "XTSX"],
  [".HK", "XHKG"],
  [".T", "XJPX"],
  [".L", "XLON"],
  [".DE", "XETR"],
  [".F", "XFRA"],
  [".PA", "XPAR"],
  [".MC", "XMAD"],
  [".MI", "XMIL"],
  [".AS", "XAMS"],
  [".BR", "XBRU"],
  [".LS", "XLIS"],
  [".SW", "XSWX"],
  [".ST", "XSTO"],
  [".CO", "XCSE"],
  [".OL", "XOSL"],
  [".HE", "XHEL"],
  [".VI", "XWBO"],
  [".TA", "XTAE"],
  [".AX", "XASX"],
  [".IR", "XDUB"],
  [".SI", "XSES"],
  [".JO", "XJSE"],
  [".TW", "XTAI"],
  [".KS", "XKRX"],
  [".KQ", "XKOS"],
  [".NS", "XNSE"],
  [".BO", "XBOM"],
  [".SS", "XSHG"],
  [".SZ", "XSHE"],
  [".SA", "BVMF"],
];

const EXCHANGE_TO_MIC = new Map([
  ["XNYS", "XNYS"],
  ["NYQ", "XNYS"],
  ["NYSE", "XNYS"],
  ["NEWYORKSTOCKEXCHANGE", "XNYS"],

  ["XASE", "XASE"],
  ["ASE", "XASE"],
  ["AMEX", "XASE"],
  ["NYSEAMERICAN", "XASE"],

  ["ARCX", "ARCX"],
  ["PCX", "ARCX"],
  ["NYSEARCA", "ARCX"],

  ["BATS", "BATS"],
  ["BTS", "BATS"],
  ["CBOEBZX", "BATS"],
  ["CBOEBZXEXCHANGE", "BATS"],

  ["XNGS", "XNGS"],
  ["NMS", "XNGS"],
  ["NASDAQGS", "XNGS"],
  ["NASDAQGLOBALSELECT", "XNGS"],
  ["NASDAQGLOBALSELECTMARKET", "XNGS"],

  ["XNMS", "XNMS"],
  ["NGM", "XNMS"],
  ["NASDAQGM", "XNMS"],
  ["NASDAQGLOBALMARKET", "XNMS"],

  ["XNCM", "XNCM"],
  ["NCM", "XNCM"],
  ["NASDAQCM", "XNCM"],
  ["NASDAQCAPITALMARKET", "XNCM"],

  ["XNAS", "XNAS"],
]);

const SCAN_MARKET_MIC_CODES = {
  US: ["XNYS", "XASE", "XNAS", "XNCM", "XNGS", "XNMS", "ARCX", "BATS"],
  CA: ["XTSE", "XTSX"],
  JP: ["XJPX"],
  HK: ["XHKG"],
  GB: ["XLON"],
  DE: ["XETR"],
  FR: ["XPAR"],
  ES: ["XMAD"],
  IT: ["XMIL"],
  NL: ["XAMS"],
  BE: ["XBRU"],
  PT: ["XLIS"],
  CH: ["XSWX"],
  SE: ["XSTO"],
  DK: ["XCSE"],
  NO: ["XOSL"],
  FI: ["XHEL"],
  PL: ["XWAR"],
  IL: ["XTAE"],
  AU: ["XASX"],
};

function clean(value = "") {
  return String(value || "").trim().toUpperCase();
}

function exchangeKey(value = "") {
  return clean(value).replace(/[^A-Z0-9]/g, "");
}

export function normalizeMicCode(value = "") {
  const mic = clean(value);
  return /^[A-Z0-9]{4}$/.test(mic) ? mic : "";
}

export function micCodeForSymbol(symbol = "", { micCode = "", exchange = "" } = {}) {
  const explicit = normalizeMicCode(micCode);
  if (explicit) return explicit;

  const normalizedSymbol = clean(symbol);
  const suffixMatch = SUFFIX_TO_MIC.find(([suffix]) => normalizedSymbol.endsWith(suffix));
  if (suffixMatch) return suffixMatch[1];

  return EXCHANGE_TO_MIC.get(exchangeKey(exchange)) || "";
}

export function micCodesForScanMarkets(markets = []) {
  return [...new Set(
    (Array.isArray(markets) ? markets : [])
      .flatMap((market) => SCAN_MARKET_MIC_CODES[clean(market)] || [])
      .filter(Boolean),
  )];
}

