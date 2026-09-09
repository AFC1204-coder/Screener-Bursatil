// lib/marketLeadership.js — leadership pulse y filas regionales desde el
// escaneo nocturno publicable (scan_results), no desde localStorage.
//
// Misma población que lib/marketBreadth.js (nocturno estadounidense vía
// lib/nightlyUsScan.js). La agregación replica buildScanPulse de
// app/market-health/page.jsx para que todos los usuarios vean el mismo
// liderazgo aunque no tengan snapshot local.
import { canonicalRsValue } from "@/lib/rsCanonical";
import { nightlyAbsenceReasonText } from "@/lib/nightlyAbsence";
import { readNightlyUsScan } from "@/lib/nightlyUsScan";
import { finiteOrNull, supabaseConfig, supabaseRequestAll } from "@/lib/supabaseServer";
import { metricValue, rowRsBenchmark, rowTheme, weaknessScore } from "@/lib/stockRows";

const ROWS_TIMEOUT_MS = 20000;
const NIGHTLY_SCAN_COLUMNS = "id,local_id,created_at,row_count,preset,market_regime,settings";

const LEADERSHIP_ROW_SELECT = [
  "symbol",
  "companyName:metrics->>companyName",
  "country:metrics->>country",
  "sector:metrics->>sector",
  "theme:metrics->>theme",
  "industry:metrics->>industry",
  "businessSummary:metrics->>businessSummary",
  "summary:metrics->>summary",
  "weeklyRsRating:metrics->weeklyRsRating",
  "weeklyRsAvailable:metrics->weeklyRsAvailable",
  "weeklyRsReason:metrics->>weeklyRsReason",
  "objectiveScore:metrics->objectiveScore",
  "distance52w:metrics->distance52w",
  "failedBreakout:metrics->failedBreakout",
  "price:metrics->price",
  "sma50:metrics->sma50",
  "sma200:metrics->sma200",
  "sma200Slope:metrics->sma200Slope",
  "weaknessScore:metrics->weaknessScore",
  "rsRating:metrics->rsRating",
  "maxDrawdown63d:metrics->maxDrawdown63d",
  "upDownVolRatio:metrics->upDownVolRatio",
  "riskScore:metrics->riskScore",
  "speculationRiskScore:metrics->speculationRiskScore",
].join(",");

function rowObjectiveScore(row = {}) {
  return metricValue(row, "objectiveScore");
}

function isNearHigh(row = {}) {
  return Number.isFinite(row.distance52w) && row.distance52w >= -15;
}

function isStage2Like(row = {}) {
  return row.price > row.sma50 && row.price > row.sma200 && (row.sma200Slope ?? 0) >= 0;
}

function deteriorationReasons(row = {}) {
  const reasons = [];
  if (weaknessScore(row) >= 65) reasons.push("Deterioro alto");
  const rsCanonical = canonicalRsValue(row);
  const rsBenchmark = rowRsBenchmark(row);
  if (Number.isFinite(rsCanonical) && rsCanonical < 40) reasons.push("RS débil");
  else if (!Number.isFinite(rsCanonical) && Number.isFinite(rsBenchmark) && rsBenchmark < 45) reasons.push("RS Bench bajo");
  if (Number.isFinite(row.price) && Number.isFinite(row.sma50) && row.price < row.sma50) reasons.push("Bajo SMA50");
  if (Number.isFinite(row.price) && Number.isFinite(row.sma200) && row.price < row.sma200) reasons.push("Bajo SMA200");
  if (Number.isFinite(row.distance52w) && row.distance52w < -30) reasons.push("Lejos de máximos");
  if (Number.isFinite(row.maxDrawdown63d) && row.maxDrawdown63d > 32) reasons.push("Drawdown elevado");
  if (Number.isFinite(row.upDownVolRatio) && row.upDownVolRatio < 0.8) reasons.push("Presion volumen");
  if (Number.isFinite(row.riskScore) && row.riskScore < 35) reasons.push("Riesgo técnico");
  if (Number.isFinite(row.speculationRiskScore) && row.speculationRiskScore >= 70) reasons.push("Riesgo especulativo");
  return reasons;
}

function summarizeGroups(rows = [], keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row) || "Sin grupo";
    const bucket = map.get(key) || { name: key, count: 0, rs: 0, rsCount: 0, score: 0, nearHigh: 0, leaders: 0, top: null };
    const rs = canonicalRsValue(row);
    bucket.count += 1;
    if (Number.isFinite(rs)) {
      bucket.rs += rs;
      bucket.rsCount += 1;
    }
    const objectiveScore = rowObjectiveScore(row);
    bucket.score += objectiveScore || 0;
    if (isNearHigh(row)) bucket.nearHigh += 1;
    if ((rs || 0) >= 80 || (objectiveScore || 0) >= 75) bucket.leaders += 1;
    if (!bucket.top || (objectiveScore || 0) > (rowObjectiveScore(bucket.top) || 0)) bucket.top = row;
    map.set(key, bucket);
  });
  return [...map.values()]
    .map((x) => ({ ...x, rs: x.rsCount ? x.rs / x.rsCount : null, score: x.score / x.count, nearHighPct: (x.nearHigh / x.count) * 100 }))
    .sort((a, b) => (b.leaders - a.leaders) || ((b.rs ?? -1) - (a.rs ?? -1)) || (b.score - a.score))
    .slice(0, 8);
}

/**
 * Agregado puro equivalente al buildScanPulse de market-health.
 * @param {{ createdAt?: string, preset?: string, marketRegime?: string }} scanMeta
 * @param {object[]} rows
 */
export function buildScanPulse(scanMeta = {}, rows = []) {
  if (!scanMeta || !rows.length) return null;
  const leaders = rows
    .filter((row) => (canonicalRsValue(row) || 0) >= 80 || (rowObjectiveScore(row) || 0) >= 75 || (isStage2Like(row) && isNearHigh(row)))
    .sort((a, b) => ((canonicalRsValue(b) || 0) - (canonicalRsValue(a) || 0)) || ((rowObjectiveScore(b) || 0) - (rowObjectiveScore(a) || 0)))
    .slice(0, 8);
  const deterioration = rows
    .map((row) => ({ ...row, deteriorationReasons: deteriorationReasons(row) }))
    .filter((row) => row.deteriorationReasons.length)
    .sort((a, b) => (b.deteriorationReasons.length - a.deteriorationReasons.length)
      || ((canonicalRsValue(a) ?? Number.POSITIVE_INFINITY) - (canonicalRsValue(b) ?? Number.POSITIVE_INFINITY)))
    .slice(0, 8);
  const nearHigh = rows.filter(isNearHigh).length;
  const stage2 = rows.filter(isStage2Like).length;
  const rsLeader = rows.filter((row) => (canonicalRsValue(row) || 0) >= 80).length;
  const pressure = rows.filter((row) => deteriorationReasons(row).length >= 2).length;
  const leadersFailedBreakout = leaders.filter((row) => row.failedBreakout === true).length;
  const scan = {
    id: scanMeta.id,
    createdAt: scanMeta.createdAt,
    preset: scanMeta.preset || "-",
    marketRegime: scanMeta.marketRegime || "sin dato",
    rowCount: scanMeta.rowCount ?? rows.length,
  };
  return {
    scan,
    rows,
    count: rows.length,
    createdAt: scanMeta.createdAt,
    preset: scan.preset,
    marketRegime: scan.marketRegime,
    leaders,
    deterioration,
    nearHighPct: rows.length ? (nearHigh / rows.length) * 100 : null,
    stage2Pct: rows.length ? (stage2 / rows.length) * 100 : null,
    rsLeaderPct: rows.length ? (rsLeader / rows.length) * 100 : null,
    pressurePct: rows.length ? (pressure / rows.length) * 100 : null,
    // MH-FILL-4: fugas fallidas solo entre la lista de líderes (no reclasifica).
    leadersFailedBreakoutCount: leadersFailedBreakout,
    leadersFailedBreakoutPct: leaders.length ? (leadersFailedBreakout / leaders.length) * 100 : null,
    leadersCount: leaders.length,
    countries: summarizeGroups(rows, (row) => row.country),
    themes: summarizeGroups(rows, (row) => rowTheme(row) || row.sector),
  };
}

function normalizeLeadershipRow(row = {}) {
  const normalized = { ...row };
  for (const key of [
    "weeklyRsRating", "objectiveScore", "distance52w", "price", "sma50", "sma200",
    "sma200Slope", "weaknessScore", "rsRating", "maxDrawdown63d", "upDownVolRatio",
    "riskScore", "speculationRiskScore",
  ]) {
    const value = finiteOrNull(normalized[key]);
    if (value !== null) normalized[key] = value;
    else delete normalized[key];
  }
  if (normalized.weeklyRsAvailable === true || normalized.weeklyRsAvailable === false) {
    // booleano ya tipado por PostgREST
  } else if (normalized.weeklyRsAvailable != null) {
    normalized.weeklyRsAvailable = normalized.weeklyRsAvailable === true || normalized.weeklyRsAvailable === "true";
  } else {
    delete normalized.weeklyRsAvailable;
  }
  if (normalized.failedBreakout === true || normalized.failedBreakout === false) {
    // ok
  } else if (normalized.failedBreakout != null) {
    normalized.failedBreakout = normalized.failedBreakout === true || normalized.failedBreakout === "true";
  } else {
    delete normalized.failedBreakout;
  }
  normalized.country = String(normalized.country || "US").trim().toUpperCase() || "US";
  return normalized;
}

async function readLeadershipRows(config, scanId) {
  const rows = await supabaseRequestAll("scan_results", {
    query: {
      owner_id: `eq.${config.ownerId}`,
      scan_id: `eq.${scanId}`,
      select: LEADERSHIP_ROW_SELECT,
    },
    timeoutMs: ROWS_TIMEOUT_MS,
  }, { maxRows: 20000 });
  return (rows || []).map(normalizeLeadershipRow);
}

function scanMetaFromRow(row = {}) {
  return {
    id: row.id,
    localId: row.local_id,
    createdAt: row.created_at,
    preset: row.preset || "-",
    marketRegime: row.market_regime || "sin dato",
    rowCount: Number(row.row_count) || null,
  };
}

let memo = null;

export async function readMarketLeadership(options = {}) {
  const config = supabaseConfig();
  if (!config.configured) {
    return {
      configured: false,
      error: "La copia en la nube no está activada. El liderazgo de mercado se calcula en el servidor y necesita la base de datos.",
    };
  }
  const found = await readNightlyUsScan({
    timeoutMs: 8000,
    columns: NIGHTLY_SCAN_COLUMNS,
  });
  if (!found.scan?.id) {
    const reason = found.reason || "no-nightly-scan";
    return {
      configured: true,
      error: nightlyAbsenceReasonText({ reason, rejectedScan: found.rejectedScan }),
      nightly: { found: false, reason },
      pulse: null,
    };
  }
  const scanMeta = scanMetaFromRow(found.row);
  const memoKey = scanMeta.id;
  if (!options.refresh && memo?.key === memoKey) {
    return { ...memo.payload, servedAt: new Date().toISOString(), memoHit: true };
  }
  const rows = await readLeadershipRows(config, scanMeta.id);
  const pulse = buildScanPulse(scanMeta, rows);
  const payload = {
    configured: true,
    generatedAt: new Date().toISOString(),
    scan: scanMeta,
    pulse,
    nightly: { found: true, reason: null },
    ...(pulse ? {} : { error: rows.length ? "El escaneo nocturno no trae filas con las que calcular liderazgo." : "El escaneo nocturno no tiene filas publicadas." }),
  };
  memo = { key: memoKey, payload };
  return { ...payload, servedAt: payload.generatedAt, memoHit: false };
}
