import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { qualityGateForResearchRow } from "@/lib/qualityGate";

const DATA_HEALTH_FILTERS = [
  { key: "ready", label: "Datos aptos", shortLabel: "Aptos", tone: "good" },
  { key: "partial", label: "Datos parciales", shortLabel: "Parciales", tone: "warn" },
  { key: "stale", label: "Precio viejo", shortLabel: "Viejos", tone: "warn" },
  { key: "blocked", label: "Datos bloqueados", shortLabel: "Bloqueados", tone: "bad" },
  { key: "unknown", label: "Sin auditoría", shortLabel: "Sin audit", tone: "muted" },
];

export const DATA_HEALTH_FILTER_ALL = "Todos";
export const DATA_HEALTH_FILTER_ORDER = DATA_HEALTH_FILTERS.map((item) => item.key);

const DATA_HEALTH_LABELS = new Map(DATA_HEALTH_FILTERS.map((item) => [item.key, item]));

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rowValue(row = {}, field = "") {
  return row[field] ?? row.metrics?.[field] ?? row.raw?.[field] ?? row.snapshot?.[field];
}

function rowNumber(row = {}, field = "") {
  return finite(rowValue(row, field));
}

function cleanText(value = "", limit = 140) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function textValue(row = {}, fields = []) {
  for (const field of fields) {
    const value = cleanText(rowValue(row, field), 120);
    if (value) return value;
  }
  return "";
}

function scoreTone(value, good = 75, warn = 55) {
  if (!Number.isFinite(value)) return "muted";
  if (value >= good) return "good";
  if (value >= warn) return "neutral";
  return "warn";
}

function metricItem(key, label, value, { suffix = "", detail = "", good = 75, warn = 55 } = {}) {
  return {
    key,
    label,
    value: Number.isFinite(value) ? Number(value.toFixed(0)) : null,
    suffix,
    detail,
    tone: scoreTone(value, good, warn),
  };
}

function qualityGate(row = {}, settings = {}) {
  const stored = rowValue(row, "qualityGate");
  if (stored && typeof stored === "object") return stored;
  return qualityGateForResearchRow(row, settings);
}

function freshnessState(row = {}) {
  const days = rowNumber(row, "priceFreshnessDays");
  const maxDays = rowNumber(row, "priceFreshnessMaxDays");
  const label = cleanText(rowValue(row, "priceFreshnessLabel"), 60);
  const issue = cleanText(rowValue(row, "priceFreshnessIssue"), 100);
  const explicitOk = rowValue(row, "priceFreshnessOk");
  const ok = explicitOk === true || (explicitOk === undefined && Number.isFinite(days) && Number.isFinite(maxDays) && days <= maxDays);
  const stale = explicitOk === false || Boolean(issue) || /viejo|stale/i.test(label);
  const tone = stale ? "warn" : ok ? "good" : "muted";
  const display = issue || label || (ok ? "fresco" : "sin frescura");
  return {
    days: Number.isFinite(days) ? Number(days.toFixed(0)) : null,
    maxDays: Number.isFinite(maxDays) ? Number(maxDays.toFixed(0)) : null,
    ok,
    stale,
    label: display,
    tone,
    detail: Number.isFinite(days) ? `${days.toFixed(0)}d${Number.isFinite(maxDays) ? `/${maxDays.toFixed(0)}d` : ""}` : display,
  };
}

function providerState(row = {}) {
  const provider = textValue(row, ["chartProvider", "priceSource", "provider", "dataProvider"])
    || cleanText(row.providerMeta?.chartCache?.provider || row.providerMeta?.fundamentalsCache?.provider, 80)
    || "proveedor";
  const fallback = cleanText(rowValue(row, "chartFallbackReason"), 100);
  return {
    label: provider,
    tone: fallback ? "warn" : "neutral",
    detail: fallback || cleanText(row.providerMeta?.chartCache?.status || row.providerMeta?.fundamentalsCache?.status, 100),
  };
}

function issueItems(row = {}, gate = {}, freshness = {}) {
  const items = [];
  const missing = Array.isArray(rowValue(row, "decisionProjectionMissing")) ? rowValue(row, "decisionProjectionMissing") : [];
  if (rowValue(row, "decisionProjectionPartial") === true) {
    items.push({
      key: "projection-partial",
      label: "Snapshot parcial",
      tone: "bad",
      detail: missing.length ? missing.join(", ") : "faltan campos de decisión",
    });
  }
  if (gate?.passed === false) {
    items.push({
      key: "quality-gate",
      label: "Datos base",
      tone: "bad",
      detail: Array.isArray(gate.reasons) && gate.reasons.length ? gate.reasons.join(" · ") : gate.label || "gate no superado",
    });
  }
  if (freshness.stale) {
    items.push({
      key: "freshness",
      label: "Precio viejo",
      tone: "warn",
      detail: freshness.label,
    });
  }
  const coverageIssues = Array.isArray(rowValue(row, "dataCoverageIssues")) ? rowValue(row, "dataCoverageIssues") : [];
  for (const issue of coverageIssues.slice(0, 3)) {
    const label = cleanText(issue, 80);
    if (label) items.push({ key: `coverage-${label}`, label, tone: "warn", detail: "" });
  }
  const reliabilityState = cleanText(rowValue(row, "methodologyReliabilityState"), 60).toLowerCase();
  if (reliabilityState === "data_limited" || reliabilityState === "blocked") {
    items.push({
      key: "methodology-reliability",
      label: cleanText(rowValue(row, "methodologyReliabilityLabel"), 80) || "Fiabilidad limitada",
      tone: reliabilityState === "blocked" ? "bad" : "warn",
      detail: cleanText(rowValue(row, "methodologyReliabilityReason"), 120),
    });
  }
  const metricTruth = objectiveMetricAuditStatusForRow(row);
  if (metricTruth.key === "bad" || metricTruth.key === "warn") {
    items.push({
      key: "objective-metrics",
      label: metricTruth.label,
      tone: metricTruth.tone,
      detail: metricTruth.detail,
    });
  }
  return items.slice(0, 5);
}

function statusFor({ gate, freshness, coverage, technical, fundamental, issues }) {
  if (issues.some((item) => item.tone === "bad") || gate?.passed === false) {
    return {
      key: "blocked",
      label: "Bloqueado",
      tone: "bad",
      detail: "No usar como decisión sin revisar datos base.",
    };
  }
  if (freshness.stale) {
    return {
      key: "stale",
      label: "Precio viejo",
      tone: "warn",
      detail: freshness.label,
    };
  }
  if ((Number.isFinite(coverage) && coverage < 60) || (Number.isFinite(technical) && technical < 65) || (Number.isFinite(fundamental) && fundamental < 30) || issues.length) {
    return {
      key: "partial",
      label: "Parcial",
      tone: "warn",
      detail: "Cobertura suficiente para ranking, limitada para decisión final.",
    };
  }
  if (Number.isFinite(coverage) || freshness.ok || gate?.passed === true) {
    return {
      key: "ready",
      label: "Datos aptos",
      tone: "good",
      detail: "Base técnica fresca y cobertura útil.",
    };
  }
  return {
    key: "unknown",
    label: "Sin auditoría",
    tone: "muted",
    detail: "La fila no trae suficientes metadatos de salud.",
  };
}

export function buildScreenerDataHealth(row = {}, settings = {}) {
  if (row?.__screenerAnnotation?.dataHealth) return row.__screenerAnnotation.dataHealth;
  const coverage = rowNumber(row, "dataCoverageScore");
  const technical = rowNumber(row, "technicalCoverageScore");
  const fundamental = rowNumber(row, "fundamentalCoverageScore");
  const profile = rowNumber(row, "profileCoverageScore");
  const bars = rowNumber(row, "chartBarsCount");
  const gate = qualityGate(row, settings);
  const freshness = freshnessState(row);
  const provider = providerState(row);
  const issues = issueItems(row, gate, freshness);
  const status = statusFor({ gate, freshness, coverage, technical, fundamental, issues });
  const minBars = settings?.setupMode === "ipoRecent" ? 20 : 180;
  const metrics = [
    metricItem("coverage", "Cob", coverage, { detail: cleanText(rowValue(row, "dataCoverageLabel"), 60) || "cobertura total" }),
    metricItem("technical", "Tec", technical, { detail: "precio, gráfico, volumen y RS", good: 70, warn: 55 }),
    metricItem("fundamental", "Fund", fundamental, { detail: "fundamentales disponibles", good: 45, warn: 25 }),
    metricItem("bars", "Hist", bars, { detail: Number.isFinite(bars) ? `${bars.toFixed(0)}/${minBars}` : `0/${minBars}`, good: minBars, warn: Math.max(20, minBars * .6) }),
  ];
  if (Number.isFinite(profile)) metrics.splice(3, 0, metricItem("profile", "Perfil", profile, { detail: "metadata empresa", good: 70, warn: 50 }));

  const topLineParts = [
    Number.isFinite(coverage) ? `Cob ${coverage.toFixed(0)}` : "",
    freshness.detail,
    provider.label,
  ].filter(Boolean);

  return {
    schemaVersion: 1,
    status,
    coverageScore: Number.isFinite(coverage) ? Number(coverage.toFixed(0)) : null,
    metrics,
    freshness,
    provider,
    issues,
    gate,
    topLine: topLineParts.join(" · ") || status.detail,
  };
}

export function dataHealthFilterLabel(key = DATA_HEALTH_FILTER_ALL, { compact = false } = {}) {
  if (!key || key === DATA_HEALTH_FILTER_ALL) return "Todos";
  const item = DATA_HEALTH_LABELS.get(key);
  if (!item) return key;
  return compact ? item.shortLabel : item.label;
}

export function dataHealthMatchesFilter(row = {}, filter = DATA_HEALTH_FILTER_ALL, settings = {}) {
  if (!filter || filter === DATA_HEALTH_FILTER_ALL) return true;
  return buildScreenerDataHealth(row, settings).status.key === filter;
}

function pctLabel(count = 0, total = 0) {
  if (!total) return "0%";
  const value = (count / total) * 100;
  return `${value >= 10 || count === total ? value.toFixed(0) : value.toFixed(1)}%`;
}

function dataHealthTone(key = "") {
  return DATA_HEALTH_LABELS.get(key)?.tone || "neutral";
}

function dataHealthSummaryVerdict(counts = new Map(), total = 0) {
  const blocked = counts.get("blocked") || 0;
  const stale = counts.get("stale") || 0;
  const partial = counts.get("partial") || 0;
  const unknown = counts.get("unknown") || 0;
  const ready = counts.get("ready") || 0;
  if (!total) return { key: "empty", label: "Sin resultados", tone: "muted", detail: "Ejecuta un scan para medir la salud de datos." };
  if (blocked) return { key: "blocked", label: "Auditar datos", tone: "bad", detail: `${blocked} bloqueadas antes de decidir.` };
  if (stale) return { key: "stale", label: "Refrescar precios", tone: "warn", detail: `${stale} filas con precio viejo.` };
  if (partial || unknown) return { key: "partial", label: "Cobertura parcial", tone: "warn", detail: `${partial + unknown} filas necesitan contexto.` };
  return { key: "ready", label: "Base apta", tone: "good", detail: `${ready} filas listas para investigación.` };
}

export function buildScreenerDataHealthSummary(rows = [], settings = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const counts = new Map(DATA_HEALTH_FILTER_ORDER.map((key) => [key, 0]));
  const issueCounts = new Map();
  for (const row of list) {
    const health = buildScreenerDataHealth(row, settings);
    const key = health.status?.key || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
    for (const issue of health.issues || []) {
      const issueKey = issue.key || issue.label;
      if (!issueKey) continue;
      const bucket = issueCounts.get(issueKey) || { key: issueKey, label: issue.label, tone: issue.tone || "warn", count: 0 };
      bucket.count += 1;
      issueCounts.set(issueKey, bucket);
    }
  }
  const total = list.length;
  const items = DATA_HEALTH_FILTER_ORDER.map((key) => {
    const count = counts.get(key) || 0;
    return {
      key,
      label: dataHealthFilterLabel(key, { compact: true }),
      fullLabel: dataHealthFilterLabel(key),
      count,
      share: pctLabel(count, total),
      tone: dataHealthTone(key),
    };
  });
  const readyCount = counts.get("ready") || 0;
  const attentionCount = Math.max(0, total - readyCount);
  const topIssues = [...issueCounts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 4)
    .map((item) => ({ ...item, share: pctLabel(item.count, total) }));
  return {
    schemaVersion: 1,
    rows: total,
    readyCount,
    attentionCount,
    readyShare: pctLabel(readyCount, total),
    attentionShare: pctLabel(attentionCount, total),
    verdict: dataHealthSummaryVerdict(counts, total),
    counts: Object.fromEntries(counts.entries()),
    items,
    topIssues,
  };
}
