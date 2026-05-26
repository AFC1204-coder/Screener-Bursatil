import { countryCode, countryName } from "@/lib/symbols";
import { envValue } from "@/lib/env";

const OPENFIGI_BASE = "https://api.openfigi.com/v3/mapping";
const OPENFIGI_API_KEY = envValue("OPENFIGI_API_KEY");
const OPENFIGI_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "StatsEdge/0.1",
  ...(OPENFIGI_API_KEY ? { "X-OPENFIGI-APIKEY": OPENFIGI_API_KEY } : {}),
};

const MIC_TO_YAHOO_SUFFIX = {
  XNAS: "",
  XNYS: "",
  ARCX: "",
  XASE: "",
  BATS: "",
  BMEX: ".MC",
  XMAD: ".MC",
  XETR: ".DE",
  XFRA: ".F",
  XPAR: ".PA",
  XAMS: ".AS",
  XLON: ".L",
  AIMX: ".L",
  XSWX: ".SW",
  XSTO: ".ST",
  XCSE: ".CO",
  XOSL: ".OL",
  XHEL: ".HE",
  XMIL: ".MI",
  MTAA: ".MI",
  XBRU: ".BR",
  XLIS: ".LS",
  XWBO: ".VI",
  XDUB: ".IR",
  XTSE: ".TO",
  XTKS: ".T",
  XHKG: ".HK",
  XSES: ".SI",
  XJSE: ".JO",
  XASX: ".AX",
  XTAI: ".TW",
  XTAE: ".TA",
  XKRX: ".KS",
  XKOS: ".KQ",
  XNSE: ".NS",
  XBOM: ".BO",
  XSHG: ".SS",
  XSHE: ".SZ",
  BVMF: ".SA",
  XMEX: ".MX",
};

const EXCH_TO_YAHOO_SUFFIX = {
  US: "",
  UW: "",
  UN: "",
  UA: "",
  UQ: "",
  SQ: ".MC",
  SM: ".MC",
  GY: ".DE",
  GR: ".F",
  FP: ".PA",
  NA: ".AS",
  LN: ".L",
  SW: ".SW",
  SS: ".ST",
  DC: ".CO",
  NO: ".OL",
  FH: ".HE",
  IM: ".MI",
  BB: ".BR",
  PL: ".LS",
  AV: ".VI",
  ID: ".IR",
  CN: ".TO",
  JP: ".T",
  JT: ".T",
  HK: ".HK",
  SP: ".SI",
  SJ: ".JO",
  AU: ".AX",
  TT: ".TW",
  IT: ".TA",
  KS: ".KS",
  KQ: ".KQ",
  IN: ".NS",
  IB: ".BO",
  CH: ".SS",
  C2: ".SZ",
  BZ: ".SA",
  MM: ".MX",
};

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isIsin(value = "") {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(String(value || "").trim());
}

function canonicalTicker(rawTicker = "", suffix = "") {
  const ticker = cleanText(rawTicker).toUpperCase().replace(/\s+/g, "-").replace(/\//g, "-").replace(/[^A-Z0-9.-]/g, "");
  if (!ticker) return "";
  if (!suffix) return ticker;
  if (suffix === ".HK" && /^\d+$/.test(ticker)) return `${ticker.padStart(4, "0")}${suffix}`;
  if (ticker.endsWith(suffix)) return ticker;
  return `${ticker}${suffix}`;
}

function suffixForRow(row = {}) {
  const mic = cleanText(row.micCode).toUpperCase();
  const exch = cleanText(row.exchCode).toUpperCase();
  if (Object.hasOwn(MIC_TO_YAHOO_SUFFIX, mic)) return MIC_TO_YAHOO_SUFFIX[mic];
  if (Object.hasOwn(EXCH_TO_YAHOO_SUFFIX, exch)) return EXCH_TO_YAHOO_SUFFIX[exch];
  return null;
}

function scoreRow(query = "", row = {}, symbol = "") {
  const q = cleanText(query).toUpperCase();
  const ticker = cleanText(row.ticker).toUpperCase();
  let score = 60;
  if (isIsin(q)) score += 80;
  if (ticker === q || symbol === q) score += 120;
  if (ticker.startsWith(q) || symbol.startsWith(q)) score += 35;
  if (row.marketSector === "Equity") score += 20;
  if (/common|ordinary|equity|shares?/i.test(row.securityType2 || row.securityType || "")) score += 15;
  if (row.compositeFIGI) score += 5;
  return score;
}

function mapOpenFigiRow(query = "", row = {}) {
  const suffix = suffixForRow(row);
  if (suffix === null) return null;
  const symbol = canonicalTicker(row.ticker, suffix);
  if (!symbol) return null;
  const country = countryCode(symbol);
  return {
    symbol,
    name: cleanText(row.name || row.securityDescription || symbol),
    exchange: cleanText(row.exchCode || row.micCode || "-"),
    exchangeCode: cleanText(row.micCode || row.exchCode),
    quoteType: "EQUITY",
    type: cleanText(row.securityType2 || row.securityType || "Equity"),
    sector: "",
    industry: "",
    country,
    countryName: countryName(country),
    currency: "",
    marketCap: null,
    figi: cleanText(row.figi),
    compositeFigi: cleanText(row.compositeFIGI),
    shareClassFigi: cleanText(row.shareClassFIGI),
    source: "openfigi",
    score: scoreRow(query, row, symbol),
  };
}

function buildJobs(query = "") {
  const clean = cleanText(query).toUpperCase();
  if (!clean) return [];
  if (isIsin(clean)) return [{ idType: "ID_ISIN", idValue: clean, marketSecDes: "Equity" }];
  if (!/^[A-Z0-9.\-]{1,18}$/.test(clean)) return [];
  return [{ idType: "TICKER", idValue: clean, marketSecDes: "Equity" }];
}

export function openFigiStatus() {
  return {
    configured: true,
    keyConfigured: Boolean(OPENFIGI_API_KEY),
    mode: OPENFIGI_API_KEY ? "api-key" : "anonymous",
  };
}

export async function searchOpenFigiCompanies(query) {
  const jobs = buildJobs(query);
  if (!jobs.length) return [];
  const res = await fetch(OPENFIGI_BASE, {
    method: "POST",
    headers: OPENFIGI_HEADERS,
    body: JSON.stringify(jobs),
    next: { revalidate: 7 * 86400 },
  });
  if (!res.ok) throw new Error(`OpenFIGI HTTP ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data) ? data.flatMap((item) => item?.data || []) : [];
  const seen = new Set();
  return rows
    .map((row) => mapOpenFigiRow(query, row))
    .filter((item) => {
      if (!item?.symbol || seen.has(item.symbol)) return false;
      seen.add(item.symbol);
      return true;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 8);
}

function chunk(values = [], size = 10) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function uniqueIsins(values = []) {
  return Array.from(new Set(values.map((value) => cleanText(value).toUpperCase()).filter(isIsin)));
}

export async function mapOpenFigiIsins(isins = [], { limit = 50 } = {}) {
  const max = Math.max(0, Number(limit || 0));
  if (!max) return [];
  const candidates = uniqueIsins(isins).slice(0, max);
  if (!candidates.length) return [];
  const batchSize = Math.max(1, Math.min(Number(envValue("OPENFIGI_BATCH_SIZE") || (OPENFIGI_API_KEY ? 100 : 10)), OPENFIGI_API_KEY ? 100 : 10));
  const mapped = [];
  const seen = new Set();
  for (const batch of chunk(candidates, batchSize)) {
    const jobs = batch.map((isin) => ({ idType: "ID_ISIN", idValue: isin, marketSecDes: "Equity" }));
    const res = await fetch(OPENFIGI_BASE, {
      method: "POST",
      headers: OPENFIGI_HEADERS,
      body: JSON.stringify(jobs),
      next: { revalidate: 7 * 86400 },
    });
    if (!res.ok) throw new Error(`OpenFIGI HTTP ${res.status}`);
    const data = await res.json();
    const payload = Array.isArray(data) ? data : [];
    payload.forEach((item, index) => {
      const isin = batch[index];
      for (const row of item?.data || []) {
        const result = mapOpenFigiRow(isin, row);
        if (!result?.symbol || seen.has(result.symbol)) continue;
        seen.add(result.symbol);
        mapped.push({ ...result, isin, source: "openfigi-isin" });
      }
    });
  }
  return mapped.sort((a, b) => (b.score || 0) - (a.score || 0));
}
