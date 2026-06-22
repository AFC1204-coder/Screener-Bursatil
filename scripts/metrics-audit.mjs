import { compactErrorMessage } from "@/lib/decisionAudit";
import { objectiveMetricAuditForRow, objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { percentileFromSorted, rsRawComposite, RS_GLOBAL_MIN_SAMPLE, RS_SCOPED_MIN_SAMPLE } from "@/lib/relativeStrength";

const baseUrl = process.env.METRICS_AUDIT_BASE_URL || "http://127.0.0.1:3000";
const limit = Number(process.env.METRICS_AUDIT_LIMIT || 1);
const rowsLimit = Number(process.env.METRICS_AUDIT_ROWS_LIMIT || 2000);
const token = process.env.STATSEDGE_ACCESS_TOKEN || process.env.STATSEDGE_API_TOKEN || process.env.STATSEDGE_ADMIN_TOKEN || "";
const allowLegacyMissing = process.env.METRICS_AUDIT_ALLOW_LEGACY === "1";

async function fetchScans({ full = false, decision = false } = {}) {
  const url = new URL("/api/scans", baseUrl);
  url.searchParams.set("includeRows", "1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("rowsLimit", String(rowsLimit));
  if (full) url.searchParams.set("full", "1");
  if (decision) url.searchParams.set("projection", "decision");
  const response = await fetch(url, {
    headers: token ? { "x-statsedge-token": token } : {},
    signal: AbortSignal.timeout(Number(process.env.METRICS_AUDIT_TIMEOUT_MS || 90000)),
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: compactErrorMessage(raw) || "Respuesta no JSON del endpoint de scans." };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(compactErrorMessage(data.error || data.message) || `HTTP ${response.status}`);
  }
  return data;
}

function bySymbol(rows = []) {
  return new Map(rows.map((row) => [String(row.symbol || "").toUpperCase(), row]).filter(([symbol]) => symbol));
}

function increment(map, key = "", label = "") {
  if (!key) return;
  const item = map.get(key) || { key, label: label || key, count: 0 };
  item.count += 1;
  map.set(key, item);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function metric(row = {}, key = "") {
  return finite(row[key] ?? row.metrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key]);
}

function scopeText(row = {}, key = "") {
  return String(row[key] ?? row.metrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key] ?? "").trim() || "Sin grupo";
}

function rsRaw(row = {}) {
  return metric(row, "rsCompositeRaw") ?? rsRawComposite(row);
}

function rsPercentileAudit(rows = [], fullRows = new Map()) {
  const withRaw = rows.map((row) => {
    const symbol = String(row.symbol || "").toUpperCase();
    const full = fullRows.get(symbol) || {};
    return {
      row,
      raw: metric(row, "rsCompositeRaw") ?? metric(full, "rsCompositeRaw") ?? rsRaw({ ...row, ...full }),
    };
  });
  const sortedGlobal = withRaw.map((item) => item.raw).filter(Number.isFinite).sort((a, b) => a - b);
  const scoped = (scopeFn) => {
    const groups = new Map();
    for (const item of withRaw) {
      const key = scopeFn(item.row);
      if (!groups.has(key)) groups.set(key, []);
      if (Number.isFinite(item.raw)) groups.get(key).push(item.raw);
    }
    for (const [key, values] of groups.entries()) groups.set(key, values.sort((a, b) => a - b));
    return groups;
  };
  const countryGroups = scoped((row) => scopeText(row, "country"));
  const sectorGroups = scoped((row) => scopeText(row, "theme") || scopeText(row, "sector"));
  const compare = (row, key, expected, sample, minSample) => {
    const actual = metric(row, key);
    if (sample < minSample) {
      return {
        key,
        status: Number.isFinite(actual) ? "unverified-value" : "insufficient-input",
        severity: Number.isFinite(actual) ? "bad" : "warn",
        actual,
        expected: null,
        sample,
        minSample,
      };
    }
    if (!Number.isFinite(expected)) {
      return {
        key,
        status: Number.isFinite(actual) ? "unverified-value" : "unavailable",
        severity: Number.isFinite(actual) ? "bad" : "neutral",
        actual,
        expected: null,
        sample,
        minSample,
      };
    }
    if (!Number.isFinite(actual)) {
      return { key, status: "missing", severity: "bad", actual: null, expected, sample, minSample };
    }
    const diff = Math.abs(actual - expected);
    return {
      key,
      status: diff <= 0.6 ? "verified" : "mismatch",
      severity: diff <= 0.6 ? "neutral" : "bad",
      actual,
      expected,
      sample,
      minSample,
      diff,
    };
  };
  return new Map(withRaw.map(({ row, raw }) => {
    const country = scopeText(row, "country");
    const sector = scopeText(row, "theme") || scopeText(row, "sector");
    const countryValues = countryGroups.get(country) || [];
    const sectorValues = sectorGroups.get(sector) || [];
    const checks = [
      compare(row, "rsGlobalPct", percentileFromSorted(raw, sortedGlobal, RS_GLOBAL_MIN_SAMPLE), sortedGlobal.length, RS_GLOBAL_MIN_SAMPLE),
      compare(row, "rsCountryPct", percentileFromSorted(raw, countryValues, RS_SCOPED_MIN_SAMPLE), countryValues.length, RS_SCOPED_MIN_SAMPLE),
      compare(row, "rsSectorPct", percentileFromSorted(raw, sectorValues, RS_SCOPED_MIN_SAMPLE), sectorValues.length, RS_SCOPED_MIN_SAMPLE),
    ];
    return [String(row.symbol || "").toUpperCase(), checks];
  }));
}

const [fullPayload, decisionPayload] = await Promise.all([
  fetchScans({ full: true }),
  fetchScans({ decision: true }),
]);

const fullScan = fullPayload.scans?.[0] || null;
const decisionScan = decisionPayload.scans?.[0] || null;
if (!decisionScan?.rows?.length) {
  throw new Error("No hay scan restaurado con filas para auditar metricas.");
}

const fullRows = bySymbol(fullScan?.rows || []);
const issueBuckets = new Map();
const contractLosses = [];
const rsAuditBySymbol = rsPercentileAudit(decisionScan.rows || [], fullRows);
const rows = decisionScan.rows.map((row) => {
  const symbol = String(row.symbol || "").toUpperCase();
  const audit = objectiveMetricAuditForRow(row);
  const fullAudit = objectiveMetricAuditForRow(fullRows.get(symbol) || {});
  const status = objectiveMetricAuditStatusForRow(row);
  const missingAudit = !audit;
  const auditIssueKeys = new Set((audit?.issues || []).map((item) => item.key));
  if (fullAudit && !audit) {
    contractLosses.push({
      symbol,
      reason: "La fila full tenia auditoria objetiva, pero la proyeccion decision la perdio.",
    });
  }
  for (const issue of audit?.issues || []) {
    increment(issueBuckets, issue.key, issue.label);
  }
  const rsChecks = rsAuditBySymbol.get(symbol) || [];
  for (const issue of rsChecks.filter((item) => ["bad", "warn"].includes(item.severity))) {
    if (!auditIssueKeys.has(issue.key)) increment(issueBuckets, issue.key, issue.key);
  }
  const extraRsIssues = rsChecks.filter((item) => ["bad", "warn"].includes(item.severity) && !auditIssueKeys.has(item.key));
  return {
    symbol,
    companyName: row.companyName || row.name || "",
    status: status.key,
    tone: status.tone,
    detail: status.detail,
    missingAudit,
    checkedCount: audit?.checkedCount ?? 0,
    verifiedCount: audit?.verifiedCount ?? 0,
    traceableCount: audit?.traceableCount ?? 0,
    issueCount: audit?.issueCount ?? 0,
    extraRsIssueCount: extraRsIssues.length,
    extraRsIssues,
    rsPercentiles: rsChecks.map((item) => ({
      key: item.key,
      status: item.status,
      severity: item.severity,
      actual: item.actual,
      expected: item.expected,
      sample: item.sample,
      minSample: item.minSample,
      diff: item.diff,
    })),
    issues: (audit?.issues || []).slice(0, 5).map((item) => ({
      key: item.key,
      label: item.label,
      status: item.status,
      severity: item.severity,
      value: item.value,
      expected: item.expected,
      source: item.source,
    })),
  };
});

const counts = rows.reduce((acc, row) => {
  acc.total += 1;
  if (row.status === "verified") acc.verifiedRows += 1;
  else if (row.status === "warn") acc.warnRows += 1;
  else if (row.status === "bad") acc.badRows += 1;
  else if (row.status === "missing") acc.missingRows += 1;
  if (row.missingAudit) acc.missingAudit += 1;
  if (row.tone === "bad") acc.badIssues += row.issueCount || 1;
  if (row.tone === "warn") acc.warnIssues += row.issueCount || 1;
  for (const rs of row.extraRsIssues || []) {
    if (rs.severity === "bad") acc.badIssues += 1;
    if (rs.severity === "warn") acc.warnIssues += 1;
  }
  return acc;
}, { total: 0, verifiedRows: 0, warnRows: 0, badRows: 0, missingRows: 0, missingAudit: 0, badIssues: 0, warnIssues: 0 });

const ok = contractLosses.length === 0
  && counts.badRows === 0
  && counts.badIssues === 0
  && (allowLegacyMissing || counts.missingAudit === 0);

const payload = {
  ok,
  source: {
    baseUrl,
    fullProjection: fullPayload.projection,
    decisionProjection: decisionPayload.projection,
    scanId: decisionScan.id,
    createdAt: decisionScan.createdAt,
    rows: decisionScan.rows.length,
  },
  counts,
  contractLosses,
  issueBuckets: [...issueBuckets.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  rows,
  note: "Veracidad numerica: las metricas objetivas deben ser recalculables, trazables o quedar marcadas como no verificables.",
};

console.log(JSON.stringify(payload, null, 2));

if (!ok) process.exitCode = 1;
