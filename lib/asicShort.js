const ASIC_INDEX_URL = "https://download.asic.gov.au/short-selling/short-selling-data.json";
const ASIC_BASE_URL = "https://download.asic.gov.au/short-selling/";
const CACHE_MS = 6 * 60 * 60 * 1000;

let asicShortCache = null;

function safeNumber(value) {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function yyyymmddToDate(value = "") {
  const s = String(value || "");
  if (!/^\d{8}$/.test(s)) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function lagDays(date = "") {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function normalizeAsxCode(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean.endsWith(".AX")) return "";
  return clean.replace(/\.AX$/, "");
}

function reportUrl(record = {}, ytd = false) {
  const date = String(record.date || "");
  const version = String(record.version || "").padStart(3, "0");
  const year = date.slice(0, 4);
  const month = date.slice(4, 6);
  const day = date.slice(6, 8);
  return `${ASIC_BASE_URL}RR${year}${month}${day}-${version}-SSDaily${ytd ? "YTD" : "AggShortPos"}.csv`;
}

function splitCsvLine(line = "") {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.map((value) => value.trim());
}

function parseAsicCsv(csv = "", report = {}) {
  const lines = String(csv || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
    const productCode = String(row["Product Code"] || "").trim().toUpperCase();
    const reportedShortPositions = safeNumber(row["Reported Short Positions"]);
    const totalProductInIssue = safeNumber(row["Total Product in Issue"]);
    const shortPercentOfIssued = safeNumber(row["% of Total Product in Issue Reported as Short Positions"]);
    return {
      symbol: productCode ? `${productCode}.AX` : "",
      productCode,
      productName: row.Product || "",
      reportedShortPositions,
      totalProductInIssue,
      shortPercentOfIssued,
      sharesPercentSharesOut: shortPercentOfIssued,
      reportDate: yyyymmddToDate(report.date),
      version: String(report.version || ""),
      lagDays: lagDays(yyyymmddToDate(report.date)),
      source: "ASIC short position reports",
      sourceUrl: reportUrl(report),
      methodology: "ASIC aggregated short positions as a percentage of total product in issue; not a US-style short-float field.",
    };
  }).filter((row) => row.productCode && Number.isFinite(row.shortPercentOfIssued));
}

async function fetchLatestReportRecord() {
  const res = await fetch(ASIC_INDEX_URL, {
    headers: { "User-Agent": "StatsEdge/0.1", Accept: "application/json" },
    next: { revalidate: 6 * 60 * 60 },
  });
  if (!res.ok) throw new Error(`ASIC short index HTTP ${res.status}`);
  const data = await res.json();
  const records = Array.isArray(data) ? data : [];
  const latest = records.sort((a, b) => {
    const dateDiff = Number(b.date || 0) - Number(a.date || 0);
    if (dateDiff) return dateDiff;
    return Number(b.version || 0) - Number(a.version || 0);
  })[0];
  if (!latest?.date || !latest?.version) throw new Error("ASIC short index sin reportes");
  return latest;
}

export async function fetchLatestAsicShortReport() {
  if (asicShortCache?.expiresAt > Date.now()) return asicShortCache.data;
  const report = await fetchLatestReportRecord();
  const url = reportUrl(report);
  const res = await fetch(url, {
    headers: { "User-Agent": "StatsEdge/0.1", Accept: "text/csv,*/*" },
    next: { revalidate: 6 * 60 * 60 },
  });
  if (!res.ok) throw new Error(`ASIC short report HTTP ${res.status}`);
  const rows = parseAsicCsv(await res.text(), report);
  const data = {
    reportDate: yyyymmddToDate(report.date),
    version: String(report.version || ""),
    lagDays: lagDays(yyyymmddToDate(report.date)),
    source: "ASIC short position reports",
    sourceUrl: url,
    rows,
    byCode: new Map(rows.map((row) => [row.productCode, row])),
  };
  asicShortCache = { expiresAt: Date.now() + CACHE_MS, data };
  return data;
}

export async function fetchAsicShortInterest(symbol = "") {
  const productCode = normalizeAsxCode(symbol);
  if (!productCode) return null;
  const report = await fetchLatestAsicShortReport();
  return report.byCode.get(productCode) || null;
}

export function mergeAsicShortInterest(profile = {}, asicShort = null) {
  if (!asicShort) return profile;
  const growthMetrics = { ...(profile.growthMetrics || {}) };
  const providerNote = "ASIC publica posiciones cortas agregadas sobre total emitido; no equivale exactamente a short float US.";
  growthMetrics.shortPercentOfFloat = Number.isFinite(growthMetrics.shortPercentOfFloat)
    ? growthMetrics.shortPercentOfFloat
    : asicShort.shortPercentOfIssued;
  growthMetrics.sharesPercentSharesOut = Number.isFinite(growthMetrics.sharesPercentSharesOut)
    ? growthMetrics.sharesPercentSharesOut
    : asicShort.sharesPercentSharesOut;
  growthMetrics.sharesShort = Number.isFinite(growthMetrics.sharesShort)
    ? growthMetrics.sharesShort
    : asicShort.reportedShortPositions;
  growthMetrics.sharesOutstanding = Number.isFinite(growthMetrics.sharesOutstanding)
    ? growthMetrics.sharesOutstanding
    : asicShort.totalProductInIssue;
  growthMetrics.shortInterestAsOf = asicShort.reportDate;
  growthMetrics.shortInterestLagDays = asicShort.lagDays;
  growthMetrics.shortInterestSource = asicShort.source;
  growthMetrics.shortInterestMethodology = asicShort.methodology;
  growthMetrics.providerNote = growthMetrics.providerNote
    ? `${growthMetrics.providerNote} ${providerNote}`
    : providerNote;
  return {
    ...profile,
    shortPercentOfFloat: Number.isFinite(profile.shortPercentOfFloat) ? profile.shortPercentOfFloat : asicShort.shortPercentOfIssued,
    sharesPercentSharesOut: Number.isFinite(profile.sharesPercentSharesOut) ? profile.sharesPercentSharesOut : asicShort.sharesPercentSharesOut,
    sharesShort: Number.isFinite(profile.sharesShort) ? profile.sharesShort : asicShort.reportedShortPositions,
    sharesOutstanding: Number.isFinite(profile.sharesOutstanding) ? profile.sharesOutstanding : asicShort.totalProductInIssue,
    growthMetrics,
    shortInterest: asicShort,
  };
}
