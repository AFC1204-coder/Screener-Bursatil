import { DOMParser } from "@xmldom/xmldom";
import { unzipSync } from "fflate";
import { envValue } from "@/lib/env";
import { mapOpenFigiIsins } from "@/lib/openfigi";

const DEFAULT_TIMEOUT_MS = 12000;
const HKEX_SECURITIES_LIST_URL = "https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx";
const TWSE_ISIN_LIST_URL = "https://isin.twse.com.tw/isin/e_C_public.jsp?strMode=2";
const JQUANTS_V2_BASE_URL = "https://api.jquants.com/v2";
const JQUANTS_V1_BASE_URL = "https://api.jquants.com/v1";
const ESMA_FIRDS_SEARCH_URL = "https://registers.esma.europa.eu/solr/esma_registers_firds_files/select";
const FCA_FIRDS_SEARCH_URL = "https://api.data.fca.org.uk/fca_data_firds_files";
const ESMA_FIRDS_SOURCE = "ESMA FIRDS reference data";
const FCA_FIRDS_SOURCE = "FCA FIRDS reference data";

const FIRDS_AUTHORITY_TO_MARKET = {
  AT: "AT",
  BE: "BE",
  DE: "DE",
  DK: "DK",
  ES: "ES",
  FI: "FI",
  FR: "FR",
  IE: "IE",
  IT: "IT",
  GB: "GB",
  NL: "NL",
  NO: "NO",
  PT: "PT",
  SE: "SE",
};

const FIRDS_MARKET_SUFFIX = {
  AT: ".VI",
  BE: ".BR",
  DE: ".DE",
  DK: ".CO",
  ES: ".MC",
  FI: ".HE",
  FR: ".PA",
  GB: ".L",
  IE: ".IR",
  IT: ".MI",
  NL: ".AS",
  NO: ".OL",
  PT: ".LS",
  SE: ".ST",
};

const FIRDS_PRIMARY_VENUES = {
  AT: ["XWBO"],
  BE: ["XBRU"],
  DE: ["XETR", "XFRA"],
  DK: ["XCSE"],
  ES: ["XMAD", "BMEX"],
  FI: ["XHEL"],
  FR: ["XPAR"],
  GB: ["XLON", "AIMX"],
  IE: ["XDUB"],
  IT: ["XMIL", "MTAA"],
  NL: ["XAMS"],
  NO: ["XOSL", "MERK"],
  PT: ["XLIS"],
  SE: ["XSTO"],
};

const FIRDS_DOMESTIC_ISIN_PREFIX = {
  AT: ["AT"],
  BE: ["BE"],
  DE: ["DE"],
  DK: ["DK"],
  ES: ["ES"],
  FI: ["FI"],
  FR: ["FR"],
  GB: ["GB", "JE", "GG", "IM"],
  IE: ["IE"],
  IT: ["IT"],
  NL: ["NL"],
  NO: ["NO"],
  PT: ["PT"],
  SE: ["SE"],
};

let esmaFirdsReferenceCache = new Map();
let esmaFirdsResolvedCache = new Map();
let fcaFirdsReferenceCache = new Map();
let fcaFirdsResolvedCache = new Map();

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(envValue(name));
}

function envNumber(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(envValue(name) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function withTimeout(ms = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function fetchArrayBuffer(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timeout = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "StatsEdge/0.1 universe-refresh",
        ...headers,
      },
      signal: timeout.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    timeout.clear();
  }
}

async function fetchJson(url, { headers = {}, method = "GET", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timeout = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "User-Agent": "StatsEdge/0.1 universe-refresh",
        ...headers,
      },
      signal: timeout.signal,
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
  } finally {
    timeout.clear();
  }
}

function isIsin(value = "") {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(cleanText(value));
}

function xmlText(node) {
  if (!node) return "";
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || "";
  return Array.from(node?.childNodes || []).map((child) => child.nodeValue || xmlText(child)).join("");
}

function parseXml(value = "") {
  return new DOMParser().parseFromString(value, "application/xml");
}

function decodeBuffer(buffer, preferredEncoding = "utf-8") {
  const encodings = Array.from(new Set([preferredEncoding, "utf-8"]));
  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      // Fall through to the next encoding.
    }
  }
  return Buffer.from(buffer).toString("utf8");
}

function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value = "") {
  return cleanText(decodeHtmlEntities(String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u00a0\u3000\ufffd]+/g, " ")));
}

function htmlTableRows(value = "") {
  return Array.from(String(value || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((row) => Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cell) => stripHtml(cell[1])))
    .filter((row) => row.length);
}

function elementsByName(node, name) {
  return Array.from(node.getElementsByTagName("*")).filter((item) => (item.localName || item.nodeName.split(":").pop()) === name);
}

function tagBlock(value = "", tag = "") {
  const match = String(value || "").match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"));
  return match?.[1] || "";
}

function tagText(value = "", tag = "") {
  return cleanText(decodeHtmlEntities(tagBlock(value, tag)));
}

function firdsMarketForRow(row = {}) {
  const authority = cleanText(row.relevantAuthority).toUpperCase();
  return FIRDS_AUTHORITY_TO_MARKET[authority] || "";
}

function firdsRowPriority(row = {}) {
  const preferred = FIRDS_PRIMARY_VENUES[row.country] || [];
  const domesticPrefixes = FIRDS_DOMESTIC_ISIN_PREFIX[row.country] || [];
  let score = 0;
  if (domesticPrefixes.some((prefix) => cleanText(row.isin).toUpperCase().startsWith(prefix))) score += 35;
  if (preferred.includes(row.tradingVenue)) score += 30;
  if (preferred.includes(row.relevantVenue)) score += 20;
  if (!row.terminationDate) score += 10;
  if (row.currency && !/XXX|XTS/i.test(row.currency)) score += 3;
  return score;
}

function isFirdsInvestableEquity(row = {}) {
  const cfi = cleanText(row.cfiCode).toUpperCase();
  const text = `${row.name || ""} ${row.shortName || ""}`.toUpperCase();
  if (!isIsin(row.isin)) return false;
  if (!cfi.startsWith("ES")) return false;
  if (row.hasDerivativeAttrs) return false;
  if (row.terminationDate) return false;
  if (/\b(ETF|ETN|ETC|UCITS|FUND|WARRANT|CERTIFICATE|ZERTIFIKAT|NOTE|BOND|TURBO|OPTION|FUTURE|RIGHT|PREFERENCE|PREFERRED)\b/.test(text)) return false;
  return true;
}

function parseFirdsRefDataBlock(block = "", { forcedMarket = "", source = ESMA_FIRDS_SOURCE } = {}) {
  const general = tagBlock(block, "FinInstrmGnlAttrbts");
  const venue = tagBlock(block, "TradgVnRltdAttrbts");
  const technical = tagBlock(block, "TechAttrbts");
  const row = {
    isin: tagText(general, "Id").toUpperCase(),
    name: tagText(general, "FullNm"),
    shortName: tagText(general, "ShrtNm"),
    cfiCode: tagText(general, "ClssfctnTp").toUpperCase(),
    currency: tagText(general, "NtnlCcy").toUpperCase(),
    issuerLei: tagText(block, "Issr"),
    tradingVenue: tagText(venue, "Id").toUpperCase(),
    firstTradeDate: tagText(venue, "FrstTradDt"),
    terminationDate: tagText(venue, "TermntnDt"),
    relevantAuthority: tagText(technical, "RlvntCmptntAuthrty").toUpperCase(),
    relevantVenue: tagText(technical, "RlvntTradgVn").toUpperCase(),
    publicationFrom: tagText(tagBlock(technical, "PblctnPrd"), "FrDt"),
    hasDerivativeAttrs: /<(?:\w+:)?DerivInstrmAttrbts\b/i.test(block),
  };
  row.country = cleanText(forcedMarket).toUpperCase() || firdsMarketForRow(row);
  row.source = cleanText(source) || ESMA_FIRDS_SOURCE;
  row._priority = firdsRowPriority(row);
  return row;
}

function firdsReferenceCollector({ market = "", scanLimit = 750000, limit = 5000, offset = 0, referenceOffset = 0, source = ESMA_FIRDS_SOURCE, forceMarket = false } = {}) {
  const target = cleanText(market).toUpperCase();
  const rows = new Map();
  let scanned = 0;
  let matched = 0;
  const maxScan = Math.max(0, Number(scanLimit || 0));
  const maxRows = Math.max(0, Number(limit || 0));
  const skipRows = Math.max(0, Number(referenceOffset || offset || 0));
  return {
    get scanned() {
      return scanned;
    },
    done() {
      return scanned >= maxScan || rows.size >= maxRows;
    },
    add(block = "") {
      if (this.done()) return true;
      scanned += 1;
      const row = parseFirdsRefDataBlock(block, {
        forcedMarket: forceMarket ? target : "",
        source,
      });
      if (!row.country || (target && row.country !== target)) return this.done();
      if (!isFirdsInvestableEquity(row)) return this.done();
      matched += 1;
      if (matched <= skipRows) return this.done();
      const key = `${row.country}:${row.isin}`;
      const existing = rows.get(key);
      if (!existing || row._priority > existing._priority) rows.set(key, row);
      return this.done();
    },
    values() {
      return Array.from(rows.values())
        .sort((a, b) => b._priority - a._priority || a.name.localeCompare(b.name))
        .slice(0, maxRows)
        .map(({ _priority, ...row }) => row);
    },
  };
}

export function parseFirdsReferenceXml(xml = "", options = {}) {
  const collector = firdsReferenceCollector(options);
  const closeTag = "</RefData>";
  let cursor = 0;
  while (cursor < xml.length && !collector.done()) {
    const start = xml.indexOf("<RefData>", cursor);
    if (start < 0) break;
    const end = xml.indexOf(closeTag, start);
    if (end < 0) break;
    cursor = end + closeTag.length;
    collector.add(xml.slice(start, cursor));
  }
  return collector.values();
}

function parseFirdsReferenceBytes(bytes, options = {}) {
  const collector = firdsReferenceCollector(options);
  const decoder = new TextDecoder("utf-8");
  const closeTag = "</RefData>";
  const chunkSize = Math.max(65536, Math.min(Number(options.decodeChunkSize || 1048576), 4 * 1048576));
  let carry = "";
  for (let offset = 0; offset < bytes.length && !collector.done(); offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    carry += decoder.decode(chunk, { stream: offset + chunkSize < bytes.length });
    while (!collector.done()) {
      const start = carry.indexOf("<RefData>");
      if (start < 0) {
        carry = carry.slice(Math.max(0, carry.length - 32));
        break;
      }
      const end = carry.indexOf(closeTag, start);
      if (end < 0) {
        carry = carry.slice(start);
        break;
      }
      const cursor = end + closeTag.length;
      collector.add(carry.slice(start, cursor));
      carry = carry.slice(cursor);
    }
  }
  return collector.values();
}

function unzipXlsx(buffer) {
  const decoder = new TextDecoder("utf-8");
  const files = unzipSync(new Uint8Array(buffer));
  return Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, decoder.decode(bytes)]));
}

function sharedStrings(files = {}) {
  const xml = files["xl/sharedStrings.xml"];
  if (!xml) return [];
  const doc = parseXml(xml);
  return elementsByName(doc, "si").map((si) => (
    elementsByName(si, "t").map((node) => xmlText(node)).join("")
  ));
}

function columnIndex(cellRef = "") {
  const letters = String(cellRef || "").match(/^[A-Z]+/)?.[0] || "A";
  return letters.split("").reduce((sum, char) => (sum * 26) + char.charCodeAt(0) - 64, 0) - 1;
}

function cellValue(cell, strings = []) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return xmlText(elementsByName(cell, "is")[0] || cell);
  const raw = xmlText(elementsByName(cell, "v")[0]);
  if (type === "s") return strings[Number(raw)] || "";
  return raw;
}

function worksheetRows(buffer) {
  const files = unzipXlsx(buffer);
  const sheetPath = files["xl/worksheets/sheet1.xml"] ? "xl/worksheets/sheet1.xml" : Object.keys(files).find((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
  if (!sheetPath) return [];
  const strings = sharedStrings(files);
  const doc = parseXml(files[sheetPath]);
  return elementsByName(doc, "row").map((row) => {
    const values = [];
    for (const cell of elementsByName(row, "c")) {
      values[columnIndex(cell.getAttribute("r"))] = cellValue(cell, strings);
    }
    return values;
  });
}

function tableFromRows(rows = []) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => cleanText(cell) === "Stock Code"));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map(cleanText);
  return rows.slice(headerIndex + 1).map((row) => Object.fromEntries(headers.map((header, index) => [header, cleanText(row[index])])));
}

function normalizeHkexSymbol(stockCode = "") {
  const digits = cleanText(stockCode).replace(/\D/g, "");
  if (!digits || digits.length < 4) return "";
  const yahooCode = digits.startsWith("0") ? digits.slice(-4) : digits;
  return `${yahooCode.padStart(4, "0")}.HK`;
}

function isHkexInvestable(row = {}) {
  const category = cleanText(row.Category);
  const subCategory = cleanText(row["Sub-Category"]);
  const currency = cleanText(row["Trading Currency"]).toUpperCase();
  const name = cleanText(row["Name of Securities"]).toUpperCase();
  if (currency !== "HKD") return false;
  if (category === "Real Estate Investment Trusts") return true;
  if (category !== "Equity") return false;
  if (!/Equity Securities \((Main Board|GEM)\)/i.test(subCategory)) return false;
  if (/\b(ETF|ETN|FUND|WARRANT|RIGHT|NOTE|BOND|PREFERENCE|PREF|DEPOSITARY RECEIPT)\b/.test(name)) return false;
  return true;
}

export function parseHkexSecuritiesWorkbook(buffer) {
  const rows = tableFromRows(worksheetRows(buffer));
  return rows
    .filter(isHkexInvestable)
    .map((row) => ({
      symbol: normalizeHkexSymbol(row["Stock Code"]),
      name: cleanText(row["Name of Securities"]),
      country: "HK",
      source: "HKEX Full List of Securities",
      isin: cleanText(row.ISIN),
      currency: cleanText(row["Trading Currency"]),
      exchangeCategory: cleanText(row.Category),
      exchangeSubCategory: cleanText(row["Sub-Category"]),
      shortSellEligible: cleanText(row["Shortsell Eligible"]) === "Y",
    }))
    .filter((row) => row.symbol && row.name);
}

export async function fetchHkexUniverse() {
  const url = envValue("HKEX_SECURITIES_LIST_URL") || HKEX_SECURITIES_LIST_URL;
  const buffer = await fetchArrayBuffer(url);
  return parseHkexSecuritiesWorkbook(buffer);
}

function parseTwseSymbolName(value = "") {
  const text = cleanText(String(value || "").replace(/[\u00a0\u3000\ufffd]+/g, " "));
  const match = text.match(/^(\d{4})\s+(.+)$/) || text.match(/^(\d{4})([^\d].+)$/);
  if (!match) return { code: "", name: "" };
  return { code: match[1], name: cleanText(match[2]) };
}

function isTwseInvestable(row = {}) {
  const name = cleanText(row.name).toUpperCase();
  const market = cleanText(row.market).toUpperCase();
  const cfi = cleanText(row.cfiCode).toUpperCase();
  const remarks = cleanText(row.remarks).toUpperCase();
  if (!/^\d{4}$/.test(row.code)) return false;
  if (!name) return false;
  if (!/TWSE LISTED/i.test(market)) return false;
  if (!cfi.startsWith("ES")) return false;
  if (/\b(ETF|ETN|FUND|WARRANT|RIGHT|BOND|PREFERRED|PREFERENCE)\b/.test(`${name} ${remarks}`)) return false;
  return true;
}

export function parseTwseIsinHtml(html = "") {
  const rows = htmlTableRows(html);
  const out = [];
  let section = "";
  for (const cells of rows) {
    const first = cleanText(cells[0]);
    if (!first || /^Security Code/i.test(first)) continue;
    if (cells.length === 1) {
      section = /^Stocks$/i.test(first) ? "stocks" : first.toLowerCase();
      continue;
    }
    if (section !== "stocks") continue;
    const { code, name } = parseTwseSymbolName(first);
    const row = {
      code,
      name,
      isin: cleanText(cells[1]),
      dateListed: cleanText(cells[2]),
      market: cleanText(cells[3]),
      industry: cleanText(cells[4]),
      cfiCode: cleanText(cells[5]),
      remarks: cleanText(cells[6]),
    };
    if (!isTwseInvestable(row)) continue;
    out.push({
      symbol: `${code}.TW`,
      name,
      country: "TW",
      source: "TWSE ISIN listed equities",
      isin: row.isin,
      currency: "TWD",
      industry: row.industry,
      marketSegment: row.market,
      cfiCode: row.cfiCode,
      dateListed: row.dateListed,
    });
  }
  return Array.from(new Map(out.map((row) => [row.symbol, row])).values());
}

export async function fetchTwseUniverse() {
  const url = envValue("TWSE_ISIN_LIST_URL") || TWSE_ISIN_LIST_URL;
  const timeoutMs = envNumber("TWSE_ISIN_TIMEOUT_MS", 6000, { min: 1000, max: 30000 });
  const buffer = await fetchArrayBuffer(url, { timeoutMs });
  return parseTwseIsinHtml(decodeBuffer(buffer, "big5"));
}

function normalizeJquantsSymbol(code = "") {
  const digits = cleanText(code).replace(/\D/g, "");
  if (!/^\d{5}$/.test(digits) || !digits.endsWith("0")) return "";
  return `${digits.slice(0, 4)}.T`;
}

function isJquantsInvestable(row = {}) {
  const code = cleanText(row.Code);
  const name = cleanText(row.CoNameEn || row.CompanyNameEnglish || row.CoName || row.CompanyName).toUpperCase();
  const market = cleanText(row.MktNm || row.MarketCodeName).toUpperCase();
  if (!normalizeJquantsSymbol(code)) return false;
  if (/\b(ETF|ETN|FUND|REIT|INFRASTRUCTURE|PREFERRED|PREFERENCE)\b/.test(name)) return false;
  if (market && /[A-Z]/.test(market) && !/(PRIME|STANDARD|GROWTH)/i.test(market)) return false;
  return true;
}

function normalizeJquantsRows(rows = [], source = "J-Quants") {
  return rows
    .filter(isJquantsInvestable)
    .map((row) => ({
      symbol: normalizeJquantsSymbol(row.Code),
      name: cleanText(row.CoNameEn || row.CompanyNameEnglish || row.CoName || row.CompanyName),
      country: "JP",
      source,
      sector: cleanText(row.S33Nm || row.Sector33CodeName),
      marketSegment: cleanText(row.MktNm || row.MarketCodeName),
      scaleCategory: cleanText(row.ScaleCat || row.ScaleCategory),
    }))
    .filter((row) => row.symbol && row.name);
}

async function fetchJquantsV2Universe(apiKey) {
  const baseUrl = envValue("JQUANTS_API_BASE_URL") || JQUANTS_V2_BASE_URL;
  const out = [];
  const query = new URLSearchParams();
  while (true) {
    const suffix = query.toString() ? `?${query}` : "";
    const payload = await fetchJson(`${baseUrl}/equities/master${suffix}`, {
      headers: { "x-api-key": apiKey },
    });
    if (Array.isArray(payload.data)) out.push(...payload.data);
    if (!payload.pagination_key) break;
    query.set("pagination_key", payload.pagination_key);
  }
  return normalizeJquantsRows(out, "J-Quants V2 equities/master");
}

async function jquantsV1IdToken() {
  if (envValue("JQUANTS_ID_TOKEN")) return envValue("JQUANTS_ID_TOKEN");
  if (!envValue("JQUANTS_REFRESH_TOKEN")) return "";
  const baseUrl = envValue("JQUANTS_V1_API_BASE_URL") || JQUANTS_V1_BASE_URL;
  const payload = await fetchJson(`${baseUrl}/token/auth_refresh?refreshtoken=${encodeURIComponent(envValue("JQUANTS_REFRESH_TOKEN"))}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  return cleanText(payload.idToken);
}

async function fetchJquantsV1Universe() {
  const idToken = await jquantsV1IdToken();
  if (!idToken) return [];
  const baseUrl = envValue("JQUANTS_V1_API_BASE_URL") || JQUANTS_V1_BASE_URL;
  const payload = await fetchJson(`${baseUrl}/listed/info`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return normalizeJquantsRows(payload.info || [], "J-Quants V1 listed/info");
}

export async function fetchJquantsUniverse() {
  if (envValue("JQUANTS_API_KEY")) {
    return fetchJquantsV2Universe(envValue("JQUANTS_API_KEY"));
  }
  return fetchJquantsV1Universe();
}

function esmaFirdsEnabled(options = {}) {
  if (Object.hasOwn(options, "enabled")) return Boolean(options.enabled);
  return envFlag("ESMA_FIRDS_ENABLED");
}

function fcaFirdsEnabled(options = {}) {
  if (Object.hasOwn(options, "enabled")) return Boolean(options.enabled);
  return envFlag("FCA_FIRDS_ENABLED");
}

function esmaFirdsCacheKey(kind, values = {}) {
  return JSON.stringify({ kind, ...values });
}

function firdsSearchDocs(payload = {}) {
  if (Array.isArray(payload?.response?.docs)) return payload.response.docs;
  if (Array.isArray(payload?.hits?.hits)) return payload.hits.hits.map((hit) => hit?._source || hit).filter(Boolean);
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function latestEsmaFirdsFiles(options = {}) {
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles || envNumber("ESMA_FIRDS_MAX_FILES", 1, { min: 1, max: 8 })), 8));
  const prefix = cleanText(options.filePrefix || envValue("ESMA_FIRDS_FILE_PREFIX") || "FULINS_E");
  const url = new URL(envValue("ESMA_FIRDS_SEARCH_URL") || ESMA_FIRDS_SEARCH_URL);
  url.searchParams.set("q", `file_name:${prefix}*`);
  url.searchParams.set("fq", "file_type:FULINS");
  url.searchParams.set("rows", String(Math.max(maxFiles, 4)));
  url.searchParams.set("sort", "publication_date desc,file_name asc");
  url.searchParams.set("wt", "json");
  const payload = await fetchJson(url.toString(), { timeoutMs: Math.max(1000, Math.min(Number(options.searchTimeoutMs || envNumber("ESMA_FIRDS_SEARCH_TIMEOUT_MS", 12000, { min: 1000, max: 60000 })), 60000)) });
  const docs = Array.isArray(payload?.response?.docs) ? payload.response.docs : [];
  const latestDate = docs[0]?.publication_date;
  return docs
    .filter((doc) => doc.download_link && (!latestDate || doc.publication_date === latestDate))
    .slice(0, maxFiles)
    .map((doc) => ({
      fileName: cleanText(doc.file_name),
      publicationDate: cleanText(doc.publication_date),
      downloadLink: cleanText(doc.download_link),
      checksum: cleanText(doc.checksum),
    }));
}

async function latestFcaFirdsFiles(options = {}) {
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles || envNumber("FCA_FIRDS_MAX_FILES", 1, { min: 1, max: 8 })), 8));
  const prefix = cleanText(options.filePrefix || envValue("FCA_FIRDS_FILE_PREFIX") || "FULINS_E");
  const url = new URL(envValue("FCA_FIRDS_SEARCH_URL") || FCA_FIRDS_SEARCH_URL);
  url.searchParams.set("q", `file_name:${prefix}*`);
  url.searchParams.set("from", "0");
  url.searchParams.set("size", String(Math.max(maxFiles, 4)));
  url.searchParams.set("sort", "publication_date:desc");
  const payload = await fetchJson(url.toString(), { timeoutMs: Math.max(1000, Math.min(Number(options.searchTimeoutMs || envNumber("FCA_FIRDS_SEARCH_TIMEOUT_MS", 12000, { min: 1000, max: 60000 })), 60000)) });
  const docs = firdsSearchDocs(payload);
  const latestDate = docs[0]?.publication_date;
  return docs
    .filter((doc) => {
      const fileName = cleanText(doc.file_name || doc.fileName || doc.filename);
      const fileType = cleanText(doc.file_type || doc.fileType);
      const publicationDate = cleanText(doc.publication_date || doc.publicationDate || doc.date);
      return cleanText(doc.download_link || doc.downloadLink || doc.url || doc.link)
        && /FULINS/i.test(fileType || fileName)
        && (!prefix || fileName.toUpperCase().startsWith(prefix.toUpperCase()))
        && (!latestDate || publicationDate === cleanText(latestDate));
    })
    .slice(0, maxFiles)
    .map((doc) => {
      const downloadLink = cleanText(doc.download_link || doc.downloadLink || doc.url || doc.link);
      return {
        fileName: cleanText(doc.file_name || doc.fileName || doc.filename),
        publicationDate: cleanText(doc.publication_date || doc.publicationDate || doc.date),
        downloadLink: downloadLink.startsWith("http") ? downloadLink : new URL(downloadLink, FCA_FIRDS_SEARCH_URL).toString(),
        checksum: cleanText(doc.checksum),
      };
    });
}

function unzipXmlTexts(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  return Object.entries(files)
    .filter(([path]) => /\.xml$/i.test(path))
    .map(([path, bytes]) => ({ path, text: decodeBuffer(bytes, "utf-8") }));
}

function unzipXmlBytes(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  return Object.entries(files)
    .filter(([path]) => /\.xml$/i.test(path))
    .map(([path, bytes]) => ({ path, bytes }));
}

function dedupeFirdsRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.country}:${row.isin}`;
    const existing = map.get(key);
    if (!existing || firdsRowPriority(row) > firdsRowPriority(existing)) map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchEsmaFirdsReferenceUniverse(market, options = {}) {
  const code = cleanText(market).toUpperCase();
  if (!esmaFirdsEnabled(options) || !FIRDS_MARKET_SUFFIX[code]) return [];
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles || envValue("ESMA_FIRDS_MAX_FILES") || 1), 8));
  const scanLimit = Math.max(1000, Math.min(Number(options.scanLimit || envValue("ESMA_FIRDS_SCAN_RECORD_LIMIT") || 750000), 2000000));
  const limit = Math.max(1, Math.min(Number(options.referenceLimit || envValue("ESMA_FIRDS_REFERENCE_LIMIT_PER_MARKET") || 5000), 50000));
  const referenceOffset = Math.max(0, Math.min(Number(options.referenceOffset || 0), 500000));
  const cacheKey = esmaFirdsCacheKey("reference", {
    code,
    files: maxFiles,
    scan: scanLimit,
    limit,
    offset: referenceOffset,
    prefix: options.filePrefix || envValue("ESMA_FIRDS_FILE_PREFIX") || "FULINS_E",
  });
  if (esmaFirdsReferenceCache.has(cacheKey)) return esmaFirdsReferenceCache.get(cacheKey);
  const files = await latestEsmaFirdsFiles({ ...options, maxFiles });
  const timeoutMs = Math.max(1000, Math.min(Number(options.downloadTimeoutMs || envNumber("ESMA_FIRDS_DOWNLOAD_TIMEOUT_MS", 30000, { min: 1000, max: 120000 })), 120000));
  const rows = [];
  for (const file of files) {
    const buffer = await fetchArrayBuffer(file.downloadLink, { timeoutMs });
    for (const xml of unzipXmlTexts(buffer)) {
      rows.push(...parseFirdsReferenceXml(xml.text, { market: code, scanLimit, limit, referenceOffset }));
    }
  }
  const deduped = dedupeFirdsRows(rows).slice(0, limit);
  esmaFirdsReferenceCache.set(cacheKey, deduped);
  return deduped;
}

export async function fetchFcaFirdsReferenceUniverse(market = "GB", options = {}) {
  const code = cleanText(market || "GB").toUpperCase();
  if (code !== "GB" || !fcaFirdsEnabled(options)) return [];
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles || envValue("FCA_FIRDS_MAX_FILES") || 1), 8));
  const scanLimit = Math.max(1000, Math.min(Number(options.scanLimit || envValue("FCA_FIRDS_SCAN_RECORD_LIMIT") || 750000), 2000000));
  const limit = Math.max(1, Math.min(Number(options.referenceLimit || envValue("FCA_FIRDS_REFERENCE_LIMIT_PER_MARKET") || 5000), 50000));
  const referenceOffset = Math.max(0, Math.min(Number(options.referenceOffset || 0), 500000));
  const cacheKey = esmaFirdsCacheKey("fca-reference", {
    code,
    files: maxFiles,
    scan: scanLimit,
    limit,
    offset: referenceOffset,
    prefix: options.filePrefix || envValue("FCA_FIRDS_FILE_PREFIX") || "FULINS_E",
  });
  if (fcaFirdsReferenceCache.has(cacheKey)) return fcaFirdsReferenceCache.get(cacheKey);
  const files = await latestFcaFirdsFiles({ ...options, maxFiles });
  const timeoutMs = Math.max(1000, Math.min(Number(options.downloadTimeoutMs || envNumber("FCA_FIRDS_DOWNLOAD_TIMEOUT_MS", 90000, { min: 1000, max: 120000 })), 120000));
  const rows = [];
  for (const file of files) {
    const buffer = await fetchArrayBuffer(file.downloadLink, { timeoutMs });
    for (const xml of unzipXmlBytes(buffer)) {
      rows.push(...parseFirdsReferenceBytes(xml.bytes, {
        market: code,
        scanLimit,
        limit,
        referenceOffset,
        source: FCA_FIRDS_SOURCE,
        forceMarket: false,
      }));
    }
  }
  const deduped = dedupeFirdsRows(rows).slice(0, limit);
  fcaFirdsReferenceCache.set(cacheKey, deduped);
  return deduped;
}

function firdsSymbolMatchesMarket(symbol = "", market = "") {
  const suffix = FIRDS_MARKET_SUFFIX[market];
  return Boolean(suffix && cleanText(symbol).toUpperCase().endsWith(suffix));
}

export async function fetchFirdsUniverse(market, options = {}) {
  const code = cleanText(market).toUpperCase();
  if (!esmaFirdsEnabled(options) || !FIRDS_MARKET_SUFFIX[code]) return [];
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles || envValue("ESMA_FIRDS_MAX_FILES") || 1), 8));
  const resolveRaw = Object.hasOwn(options, "resolveLimit") ? options.resolveLimit : (envValue("ESMA_FIRDS_RESOLVE_LIMIT_PER_MARKET") || 25);
  const resolveLimit = Math.max(0, Math.min(Number(resolveRaw), 500));
  if (!resolveLimit) return [];
  const cacheKey = esmaFirdsCacheKey("resolved", {
    code,
    files: maxFiles,
    resolveLimit,
    scan: options.scanLimit || envValue("ESMA_FIRDS_SCAN_RECORD_LIMIT") || "750000",
    offset: options.referenceOffset || "0",
    prefix: options.filePrefix || envValue("ESMA_FIRDS_FILE_PREFIX") || "FULINS_E",
  });
  if (esmaFirdsResolvedCache.has(cacheKey)) return esmaFirdsResolvedCache.get(cacheKey);
  const references = await fetchEsmaFirdsReferenceUniverse(code, { ...options, enabled: true, maxFiles });
  const byIsin = new Map(references.map((row) => [row.isin, row]));
  const mapped = await mapOpenFigiIsins(references.map((row) => row.isin), { limit: resolveLimit });
  const out = mapped
    .filter((row) => firdsSymbolMatchesMarket(row.symbol, code))
    .map((row) => {
      const reference = byIsin.get(row.isin) || {};
      return {
        symbol: row.symbol,
        name: reference.name || row.name,
        country: code,
        source: "ESMA FIRDS + OpenFIGI",
        isin: row.isin,
        currency: reference.currency || row.currency,
        cfiCode: reference.cfiCode,
        figi: row.figi,
        compositeFigi: row.compositeFigi,
        shareClassFigi: row.shareClassFigi,
        tradingVenue: reference.tradingVenue,
        relevantVenue: reference.relevantVenue,
        relevantAuthority: reference.relevantAuthority,
        firstTradeDate: reference.firstTradeDate,
      };
    });
  const deduped = Array.from(new Map(out.map((row) => [row.symbol, row])).values());
  esmaFirdsResolvedCache.set(cacheKey, deduped);
  return deduped;
}

export async function fetchFcaFirdsUniverse(market = "GB", options = {}) {
  const code = cleanText(market || "GB").toUpperCase();
  if (code !== "GB" || !fcaFirdsEnabled(options)) return [];
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles || envValue("FCA_FIRDS_MAX_FILES") || 1), 8));
  const resolveRaw = Object.hasOwn(options, "resolveLimit") ? options.resolveLimit : (envValue("FCA_FIRDS_RESOLVE_LIMIT_PER_MARKET") || 25);
  const resolveLimit = Math.max(0, Math.min(Number(resolveRaw), 500));
  if (!resolveLimit) return [];
  const cacheKey = esmaFirdsCacheKey("fca-resolved", {
    code,
    files: maxFiles,
    resolveLimit,
    scan: options.scanLimit || envValue("FCA_FIRDS_SCAN_RECORD_LIMIT") || "750000",
    offset: options.referenceOffset || "0",
    prefix: options.filePrefix || envValue("FCA_FIRDS_FILE_PREFIX") || "FULINS_E",
  });
  if (fcaFirdsResolvedCache.has(cacheKey)) return fcaFirdsResolvedCache.get(cacheKey);
  const references = await fetchFcaFirdsReferenceUniverse(code, { ...options, enabled: true, maxFiles });
  const byIsin = new Map(references.map((row) => [row.isin, row]));
  const mapped = await mapOpenFigiIsins(references.map((row) => row.isin), { limit: resolveLimit });
  const out = mapped
    .filter((row) => firdsSymbolMatchesMarket(row.symbol, code))
    .map((row) => {
      const reference = byIsin.get(row.isin) || {};
      return {
        symbol: row.symbol,
        name: reference.name || row.name,
        country: code,
        source: "FCA FIRDS + OpenFIGI",
        isin: row.isin,
        currency: reference.currency || row.currency,
        cfiCode: reference.cfiCode,
        figi: row.figi,
        compositeFigi: row.compositeFigi,
        shareClassFigi: row.shareClassFigi,
        tradingVenue: reference.tradingVenue,
        relevantVenue: reference.relevantVenue,
        relevantAuthority: reference.relevantAuthority,
        firstTradeDate: reference.firstTradeDate,
      };
    });
  const deduped = Array.from(new Map(out.map((row) => [row.symbol, row])).values());
  fcaFirdsResolvedCache.set(cacheKey, deduped);
  return deduped;
}
