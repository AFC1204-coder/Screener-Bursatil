import { DOMParser } from "@xmldom/xmldom";
import { unzipSync } from "fflate";

const DEFAULT_TIMEOUT_MS = 12000;
const HKEX_SECURITIES_LIST_URL = "https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx";
const JQUANTS_V2_BASE_URL = "https://api.jquants.com/v2";
const JQUANTS_V1_BASE_URL = "https://api.jquants.com/v1";

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
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
      next: { revalidate: 86400 },
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

function xmlText(node) {
  if (!node) return "";
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || "";
  return Array.from(node?.childNodes || []).map((child) => child.nodeValue || xmlText(child)).join("");
}

function parseXml(value = "") {
  return new DOMParser().parseFromString(value, "application/xml");
}

function elementsByName(node, name) {
  return Array.from(node.getElementsByTagName("*")).filter((item) => (item.localName || item.nodeName.split(":").pop()) === name);
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
  const url = process.env.HKEX_SECURITIES_LIST_URL || HKEX_SECURITIES_LIST_URL;
  const buffer = await fetchArrayBuffer(url);
  return parseHkexSecuritiesWorkbook(buffer);
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
  const baseUrl = process.env.JQUANTS_API_BASE_URL || JQUANTS_V2_BASE_URL;
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
  if (process.env.JQUANTS_ID_TOKEN) return process.env.JQUANTS_ID_TOKEN;
  if (!process.env.JQUANTS_REFRESH_TOKEN) return "";
  const baseUrl = process.env.JQUANTS_V1_API_BASE_URL || JQUANTS_V1_BASE_URL;
  const payload = await fetchJson(`${baseUrl}/token/auth_refresh?refreshtoken=${encodeURIComponent(process.env.JQUANTS_REFRESH_TOKEN)}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  return cleanText(payload.idToken);
}

async function fetchJquantsV1Universe() {
  const idToken = await jquantsV1IdToken();
  if (!idToken) return [];
  const baseUrl = process.env.JQUANTS_V1_API_BASE_URL || JQUANTS_V1_BASE_URL;
  const payload = await fetchJson(`${baseUrl}/listed/info`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return normalizeJquantsRows(payload.info || [], "J-Quants V1 listed/info");
}

export async function fetchJquantsUniverse() {
  if (process.env.JQUANTS_API_KEY) {
    return fetchJquantsV2Universe(process.env.JQUANTS_API_KEY);
  }
  return fetchJquantsV1Universe();
}
