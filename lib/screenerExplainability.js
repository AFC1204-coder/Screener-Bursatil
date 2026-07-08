import { isDecisionTraceVersionCurrent } from "@/lib/decisionTraceVersion";
import { buildRowMethodologyEvidence } from "@/lib/screenerMethodologyEvidence";
import { qualityGateForResearchRow } from "@/lib/qualityGate";

const MAX_DRIVERS = 5;
const MAX_WATCH = 4;

export const RANK_ACTION_META = {
  "candidate-long": { label: "Candidato largo" },
  "strong-profile": { label: "Buen perfil" },
  "candidate-with-watch": { label: "Candidato" },
  "watch-setup": { label: "Vigilar setup" },
  watchlist: { label: "Vigilancia" },
  "high-risk": { label: "Riesgo alto" },
  "check-data": { label: "Revisar datos" },
  "avoid-long": { label: "Evitar largo" },
  "bearish-watch": { label: "Bearish" },
  unclear: { label: "Sin tesis clara" },
};

export const DECISION_READINESS_META = {
  operable: { label: "Operable" },
  watch: { label: "Vigilar" },
  audit: { label: "Auditar" },
  reject: { label: "Descartar" },
  bearish: { label: "Bearish" },
};

export const RANK_ACTION_ORDER = [
  "candidate-long",
  "strong-profile",
  "candidate-with-watch",
  "watch-setup",
  "watchlist",
  "high-risk",
  "check-data",
  "avoid-long",
  "bearish-watch",
  "unclear",
];

export const DECISION_READINESS_ORDER = [
  "operable",
  "watch",
  "audit",
  "reject",
  "bearish",
];

export const DECISION_QUEUE_GROUPS = [
  { key: "operable", label: "Entrada", tone: "good" },
  { key: "watch", label: "Esperar", tone: "warn" },
  { key: "audit", label: "Auditar", tone: "warn" },
  { key: "reject", label: "Descartar", tone: "bad" },
  { key: "bearish", label: "Bearish", tone: "bad" },
];

export const DECISION_QUEUE_DIGEST_FILTERS = [
  { key: "all", label: "Todas", tone: "neutral" },
  { key: "ready", label: "Pruebas OK", tone: "good" },
  { key: "needs-work", label: "Falta validar", tone: "warn" },
  { key: "blocked", label: "Bloqueadas", tone: "bad" },
];

export const DECISION_EVIDENCE_FILTER_ALL = "all";
export const DECISION_EVIDENCE_FILTERS = [
  { key: "ready", label: "Pruebas OK", shortLabel: "OK", tone: "good" },
  { key: "needs-work", label: "Falta validar", shortLabel: "Validar", tone: "warn" },
  { key: "blocked", label: "Bloqueadas", shortLabel: "Bloq.", tone: "bad" },
];
export const DECISION_EVIDENCE_FILTER_ORDER = DECISION_EVIDENCE_FILTERS.map((item) => item.key);
const DECISION_EVIDENCE_FILTER_META = new Map(DECISION_EVIDENCE_FILTERS.map((item) => [item.key, item]));

export function rankActionLabel(key, fallback = key) {
  return RANK_ACTION_META[key]?.label || fallback;
}

export function decisionReadinessLabel(key, fallback = key) {
  return DECISION_READINESS_META[key]?.label || fallback;
}

export function decisionEvidenceFilterLabel(key = DECISION_EVIDENCE_FILTER_ALL, { compact = false } = {}) {
  if (!key || key === DECISION_EVIDENCE_FILTER_ALL) return "Todas";
  const item = DECISION_EVIDENCE_FILTER_META.get(key);
  if (!item) return key;
  return compact ? item.shortLabel : item.label;
}

export function decisionEvidenceMatchesFilter(row = {}, filter = DECISION_EVIDENCE_FILTER_ALL, settingsOrExplanation = {}) {
  if (!filter || filter === DECISION_EVIDENCE_FILTER_ALL) return true;
  return buildDecisionEvidenceChecklist(row, settingsOrExplanation).status === filter;
}

function evidenceShare(count = 0, total = 0) {
  if (!total) return "0%";
  const value = (count / total) * 100;
  return `${value >= 10 || count === total ? value.toFixed(0) : value.toFixed(1)}%`;
}

function decisionEvidenceVerdict(counts = new Map(), total = 0) {
  const ready = counts.get("ready") || 0;
  const needsWork = counts.get("needs-work") || 0;
  const blocked = counts.get("blocked") || 0;
  if (!total) return { key: "empty", label: "Sin pruebas", tone: "muted", detail: "Ejecuta o restaura un scan para evaluar evidencia." };
  if (blocked) return { key: "blocked", label: "Pruebas bloqueadas", tone: "bad", detail: `${blocked} filas no deberian decidirse sin desbloquear datos.` };
  if (needsWork) return { key: "needs-work", label: "Validar antes", tone: "warn", detail: `${needsWork} filas tienen pruebas pendientes.` };
  return { key: "ready", label: "Pruebas listas", tone: "good", detail: `${ready} filas con checklist completo.` };
}

export function buildDecisionEvidenceSummary(rows = [], settingsOrExplanation = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const counts = new Map(DECISION_EVIDENCE_FILTER_ORDER.map((key) => [key, 0]));
  const pendingCounts = new Map();
  for (const row of list) {
    const evidence = buildDecisionEvidenceChecklist(row, settingsOrExplanation);
    const key = evidence.status || "needs-work";
    counts.set(key, (counts.get(key) || 0) + 1);
    for (const item of evidence.pending || []) {
      const itemKey = item.key || item.label;
      if (!itemKey) continue;
      const bucket = pendingCounts.get(itemKey) || {
        key: itemKey,
        label: item.label || itemKey,
        tone: item.tone || "warn",
        count: 0,
      };
      bucket.count += 1;
      pendingCounts.set(itemKey, bucket);
    }
  }
  const total = list.length;
  const readyCount = counts.get("ready") || 0;
  const attentionCount = Math.max(0, total - readyCount);
  return {
    schemaVersion: 1,
    rows: total,
    readyCount,
    attentionCount,
    readyShare: evidenceShare(readyCount, total),
    attentionShare: evidenceShare(attentionCount, total),
    counts: Object.fromEntries(counts.entries()),
    verdict: decisionEvidenceVerdict(counts, total),
    items: DECISION_EVIDENCE_FILTER_ORDER.map((key) => {
      const count = counts.get(key) || 0;
      return {
        key,
        label: decisionEvidenceFilterLabel(key, { compact: true }),
        fullLabel: decisionEvidenceFilterLabel(key),
        count,
        share: evidenceShare(count, total),
        tone: DECISION_EVIDENCE_FILTER_META.get(key)?.tone || "neutral",
      };
    }),
    topIssues: [...pendingCounts.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 4)
      .map((item) => ({ ...item, share: evidenceShare(item.count, total) })),
  };
}

export function decisionQueueGroupLabel(key, fallback = key) {
  return DECISION_QUEUE_GROUPS.find((item) => item.key === key)?.label || decisionReadinessLabel(key, fallback);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pct(value, digits = 0) {
  const number = finite(value);
  return number == null ? "" : `${number.toFixed(digits)}%`;
}

function score(value) {
  const number = finite(value);
  return number == null ? "" : number.toFixed(0);
}

function rowValue(row = {}, key) {
  return row?.[key] ?? row?.metrics?.[key] ?? row?.raw?.[key] ?? row?.snapshot?.[key];
}

function rowNumber(row = {}, key) {
  return finite(rowValue(row, key));
}

function rowText(row = {}, key) {
  return cleanText(rowValue(row, key));
}

function rowArray(row = {}, key) {
  const value = rowValue(row, key);
  return Array.isArray(value) ? value : [];
}

function addUnique(list, item) {
  const label = cleanText(item?.label);
  if (!label) return;
  const key = cleanText(item.key || label).toLowerCase();
  if (list.some((entry) => cleanText(entry.key || entry.label).toLowerCase() === key)) return;
  list.push({ ...item, key, label });
}

function addScoreDriver(list, key, label, value, threshold = 70, strong = 80) {
  const number = finite(value);
  if (number == null || number < threshold) return;
  addUnique(list, {
    key,
    label,
    value: score(number),
    tone: number >= strong ? "strong" : "ok",
    text: `${label} ${score(number)}`,
  });
}

function addWatchScore(list, key, label, value, threshold, tone = "warn") {
  const number = finite(value);
  if (number == null || number >= threshold) return;
  addUnique(list, {
    key,
    label,
    value: score(number),
    tone,
    text: `${label} ${score(number)} < ${threshold}`,
  });
}

function missingDecisionEvidence(row = {}) {
  return [
    ["dataCoverageScore", "cobertura datos"],
    ["technicalCoverageScore", "cobertura tecnica"],
    ["fundamentalCoverageScore", "cobertura fundamental"],
    ["rsQualityScore", "RS calidad"],
  ].filter(([key]) => rowNumber(row, key) == null).map(([, label]) => label);
}

function firstTexts(values = [], limit = 2) {
  return (Array.isArray(values) ? values : [])
    .map(cleanText)
    .filter(Boolean)
    .slice(0, limit);
}

function normalModeDrivers(row, drivers) {
  addScoreDriver(drivers, "setup-objective", "Setup objetivo", rowNumber(row, "objectiveSetupScore") ?? rowNumber(row, "setupQualityScore"), 68, 78);
  if (rowValue(row, "setupDisplayPlanValid") === true) {
    addUnique(drivers, { key: "setup-plan", label: "Plan valido", tone: "strong", text: rowText(row, "setupDisplayReason") || "Setup/VCP con plan valido" });
  } else if (rowValue(row, "setupDisplayStrict") === true) {
    addUnique(drivers, { key: "setup-strict", label: "VCP estricto", tone: "strong", text: rowText(row, "setupDisplayReason") || "Setup/VCP estricto" });
  } else if (rowValue(row, "setupDisplayWatch") === true) {
    addUnique(drivers, { key: "setup-watch", label: "Setup/VCP", tone: "ok", text: rowText(row, "setupDisplayReason") || "Setup observable" });
  }

  addScoreDriver(drivers, "rs-global", "RS universo", rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating"), 72, 82);
  addScoreDriver(drivers, "weinstein", "Weinstein", rowNumber(row, "weinsteinScore"), 72, 82);
  addScoreDriver(drivers, "minervini", "Minervini", rowNumber(row, "minerviniScore"), 72, 82);
  addScoreDriver(drivers, "rs-group", "RS grupo", rowNumber(row, "rsSectorPct"), 70, 80);
  addScoreDriver(drivers, "rs-quality", "RS calidad", rowNumber(row, "rsQualityScore"), 68, 78);
  addScoreDriver(drivers, "volume-effect", "Volumen", rowNumber(row, "volumeEffectScore"), 68, 78);
  addScoreDriver(drivers, "ad-proxy", "A/D", rowNumber(row, "adProxyScore"), 68, 78);
  addScoreDriver(drivers, "growth", "Growth", rowNumber(row, "growthScore"), 64, 76);
  addScoreDriver(drivers, "eps", "EPS proxy", rowNumber(row, "epsGrowthProxyScore"), 64, 76);
  addScoreDriver(drivers, "risk-reward", "Rent/riesgo", rowNumber(row, "riskRewardScore"), 68, 78);
  addScoreDriver(drivers, "group-strength", "Grupo fuerte", rowNumber(row, "groupStrengthScore") ?? rowNumber(row, "sectorScore"), 72, 82);

  const relativeVolume = rowNumber(row, "relativeVolume");
  if (relativeVolume != null && relativeVolume >= 1.5) {
    addUnique(drivers, {
      key: "relative-volume",
      label: "RelVol",
      value: `${relativeVolume.toFixed(2)}x`,
      tone: relativeVolume >= 2 ? "strong" : "ok",
      text: `Volumen relativo ${relativeVolume.toFixed(2)}x`,
    });
  }
  const distance52w = rowNumber(row, "distance52w");
  const extSma50 = rowNumber(row, "extSma50");
  if (distance52w != null && distance52w >= -12 && (extSma50 == null || extSma50 <= 18)) {
    addUnique(drivers, {
      key: "near-highs",
      label: "Cerca maximos",
      value: pct(Math.abs(distance52w)),
      tone: "ok",
      text: `A ${pct(Math.abs(distance52w))} de maximos 52w`,
    });
  }

  for (const reason of firstTexts(rowArray(row, "compositeReasons"), 3)) {
    addUnique(drivers, { key: `reason-${reason}`, label: reason, tone: "ok", text: reason });
  }
}

function weaknessModeDrivers(row, drivers) {
  addScoreDriver(drivers, "weakness", "Deterioro", rowNumber(row, "weaknessScore"), 45, 65);
  for (const reason of firstTexts(rowArray(row, "weaknessReasons"), 3)) {
    addUnique(drivers, { key: `weak-${reason}`, label: reason, tone: "warn", text: reason });
  }
  const perf3m = rowNumber(row, "perf3m");
  if (perf3m != null && perf3m <= -8) {
    addUnique(drivers, { key: "negative-momentum", label: "Momentum negativo", value: pct(perf3m), tone: "warn", text: `3M ${pct(perf3m)}` });
  }
  const distance52w = rowNumber(row, "distance52w");
  if (distance52w != null && distance52w <= -25) {
    addUnique(drivers, { key: "far-highs", label: "Lejos 52w", value: pct(distance52w), tone: "warn", text: `${pct(distance52w)} desde 52w` });
  }
}

function addBaseDataWatch(row, settings, watch) {
  if (rowValue(row, "decisionProjectionPartial") === true) {
    const missing = rowArray(row, "decisionProjectionMissing").slice(0, 4).join(", ");
    addUnique(watch, {
      key: "partial-projection",
      label: "Proyección parcial",
      value: missing,
      tone: "bad",
      text: missing ? `faltan campos críticos: ${missing}` : "fila reconstruida con campos críticos incompletos",
    });
  }
  const qualityGate = rowValue(row, "qualityGate");
  const gate = qualityGate && typeof qualityGate === "object"
    ? qualityGate
    : qualityGateForResearchRow(row, settings);
  if (gate?.passed === false) {
    addUnique(watch, {
      key: "quality-gate",
      label: "Datos base",
      value: firstTexts(gate.reasons, 2).join(" · "),
      tone: "bad",
      text: firstTexts(gate.reasons, 3).join("; ") || gate.label || "datos base insuficientes",
    });
  }
  if (rowValue(row, "priceFreshnessOk") === false || rowText(row, "priceFreshnessIssue")) {
    addUnique(watch, {
      key: "freshness",
      label: "Precio",
      value: rowText(row, "priceFreshnessIssue") || "no fresco",
      tone: "warn",
      text: rowText(row, "priceFreshnessIssue") || "precio no fresco",
    });
  }
}

function addCoverageWatch(row, watch, weaknessMode = false) {
  addWatchScore(watch, "coverage-data", "Cobertura", rowNumber(row, "dataCoverageScore"), 55, "warn");
  addWatchScore(watch, "coverage-technical", "Tecnico", rowNumber(row, "technicalCoverageScore"), 60, "warn");
  addWatchScore(watch, "coverage-fundamental", "Fundamental", rowNumber(row, "fundamentalCoverageScore"), 30, "muted");
  const missing = weaknessMode ? [] : missingDecisionEvidence(row);
  if (missing.length) {
    addUnique(watch, {
      key: "decision-evidence",
      label: "Evidencia incompleta",
      value: missing.slice(0, 2).join(" · "),
      tone: "warn",
      text: `faltan ${missing.join(", ")}`,
    });
  }
  if (rowValue(row, "setupDisplayDataLimited") === true || rowValue(row, "setupDisplayBlocksPatternClaim") === true || rowValue(row, "methodologyBlocksPatternClaim") === true) {
    addUnique(watch, {
      key: "methodology-limited",
      label: "Setup limitado",
      value: rowText(row, "methodologyReliabilityReason") || rowText(row, "setupDisplayReason"),
      tone: "warn",
      text: rowText(row, "methodologyReliabilityReason") || rowText(row, "setupDisplayReason") || "patron bloqueado por datos parciales",
    });
  }
}

function addRiskWatch(row, watch, weaknessMode) {
  if (!weaknessMode) {
    const weakness = rowNumber(row, "weaknessScore");
    if (weakness != null && weakness >= 50) {
      addUnique(watch, {
        key: "weakness",
        label: rowText(row, "weaknessLabel") || "Deterioro",
        value: score(weakness),
        tone: weakness >= 78 ? "bad" : "warn",
        text: firstTexts(rowArray(row, "weaknessReasons"), 2).join("; ") || `Deterioro ${score(weakness)}`,
      });
    }
  }
  const extension = rowNumber(row, "extSma50");
  if (extension != null && extension > 18) {
    addUnique(watch, { key: "extension", label: "Extendida SMA50", value: pct(extension, 1), tone: extension > 32 ? "bad" : "warn", text: `SMA50 ${pct(extension, 1)}` });
  }
  addWatchScore(watch, "risk-reward-low", "Rent/riesgo", rowNumber(row, "riskRewardScore"), 55, "warn");
  const drawdown = rowNumber(row, "maxDrawdown63d");
  if (drawdown != null && drawdown > 25) {
    addUnique(watch, { key: "drawdown", label: "DD63 alto", value: pct(drawdown, 1), tone: drawdown > 35 ? "bad" : "warn", text: `Drawdown 63d ${pct(drawdown, 1)}` });
  }
  const shortFloat = rowNumber(row, "shortPercentOfFloat");
  if (shortFloat != null && shortFloat > 10) {
    addUnique(watch, { key: "short-float", label: "Short float", value: pct(shortFloat, 1), tone: shortFloat > 18 ? "bad" : "warn", text: `Short float ${pct(shortFloat, 1)}` });
  }
  for (const risk of firstTexts(rowArray(row, "compositeRisks"), 2)) {
    addUnique(watch, { key: `risk-${risk}`, label: risk, tone: "warn", text: risk });
  }
}

function addFallbackDrivers(row, drivers) {
  if (drivers.length) return;
  const weakness = rowNumber(row, "weaknessScore");
  if (weakness != null && weakness >= 65) {
    addUnique(drivers, {
      key: "weakness-dominates",
      label: "Debilidad domina",
      value: score(weakness),
      tone: "warn",
      text: `Deterioro ${score(weakness)}: no hay tesis larga clara`,
    });
    return;
  }
  const perf12m = rowNumber(row, "perf12m");
  const perf6m = rowNumber(row, "perf6m");
  const perf3m = rowNumber(row, "perf3m");
  if (perf12m != null && perf12m >= 15) {
    addUnique(drivers, { key: "perf12m", label: "12M positivo", value: pct(perf12m), tone: "ok", text: `12M ${pct(perf12m)}` });
  }
  if (perf6m != null && perf6m >= 12) {
    addUnique(drivers, { key: "perf6m", label: "6M positivo", value: pct(perf6m), tone: "ok", text: `6M ${pct(perf6m)}` });
  }
  if (perf3m != null && perf3m >= 8) {
    addUnique(drivers, { key: "perf3m", label: "3M positivo", value: pct(perf3m), tone: "ok", text: `3M ${pct(perf3m)}` });
  }
  if (drivers.length) return;
  addScoreDriver(drivers, "risk", "Riesgo tecnico", rowNumber(row, "riskScore"), 78, 90);
  addScoreDriver(drivers, "momentum", "Momentum", rowNumber(row, "momentumScore"), 62, 76);
  addScoreDriver(drivers, "volume-base", "Volumen base", rowNumber(row, "volumeScore"), 68, 80);
  addScoreDriver(drivers, "liquidity", "Liquidez alta", rowNumber(row, "liquidityScore"), 90, 98);
}

function hasKey(list = [], key = "") {
  return list.some((item) => item.key === key);
}

function countKeys(list = [], keys = []) {
  return keys.reduce((count, key) => count + (hasKey(list, key) ? 1 : 0), 0);
}

function rankAction(key, tone, detail) {
  return { key, label: rankActionLabel(key), tone, detail };
}

function decisionReadiness(key, tone, detail) {
  return { key, label: decisionReadinessLabel(key), tone, detail };
}

function itemHeadline(item = {}) {
  if (!item?.label && !item?.key) return "";
  return item.value ? `${item.label || item.key} ${item.value}` : item.label || item.key;
}

function itemDetail(item = {}) {
  return cleanText(item.text || item.detail || item.value || item.label || item.key);
}

function explanationFromTrace(row = {}) {
  if (row?.decisionProjectionPartial === true) return null;
  const trace = row?.decisionTrace;
  if (!trace?.action || !trace?.readiness) return null;
  if (!isDecisionTraceVersionCurrent(trace)) return null;
  if (!trace.confidence?.key || !Number.isFinite(Number(trace.confidence.score))) return null;
  if (!trace.priority || !Number.isFinite(Number(trace.priority.score)) || !Array.isArray(trace.priority.components) || trace.priority.components.length < 3) return null;
  return {
    mode: trace.mode || "long",
    tone: trace.readiness.tone || trace.action.tone || "neutral",
    title: "Decision guardada",
    drivers: Array.isArray(trace.drivers) ? trace.drivers : [],
    watch: Array.isArray(trace.watch) ? trace.watch : [],
    displayWatch: Array.isArray(trace.watch) ? trace.watch : [],
    action: trace.action,
    readiness: trace.readiness,
    line: trace.line || "",
    text: trace.line || "",
    brief: trace.brief || null,
  };
}

function resolveExplanation(row = {}, settingsOrExplanation = {}) {
  if (settingsOrExplanation?.action && settingsOrExplanation?.readiness) return settingsOrExplanation;
  if (settingsOrExplanation && typeof settingsOrExplanation === "object" && Object.keys(settingsOrExplanation).length) {
    return explainScreenerRank(row, settingsOrExplanation);
  }
  return explanationFromTrace(row) || explainScreenerRank(row, settingsOrExplanation || {});
}

function evidenceStatus(label, status, detail = "", tone = "") {
  const meta = {
    confirmed: { label: "Confirmado", tone: "good" },
    needed: { label: "Pendiente", tone: "warn" },
    blocked: { label: "Bloquea", tone: "bad" },
  }[status] || { label: status || "Pendiente", tone: tone || "warn" };
  return {
    key: searchKey(label),
    label,
    status,
    statusLabel: meta.label,
    tone: tone || meta.tone,
    detail: cleanText(detail),
  };
}

function searchKey(label = "") {
  return cleanText(label).toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

function evidenceDriverKeys(row = {}, explanation = {}) {
  const keys = new Set((explanation.drivers || []).map((item) => item.key).filter(Boolean));
  const addScore = (key, metric, threshold) => {
    const number = rowNumber(row, metric);
    if (number != null && number >= threshold) keys.add(key);
  };
  if (rowValue(row, "setupDisplayPlanValid") === true) keys.add("setup-plan");
  if (rowValue(row, "setupDisplayStrict") === true) keys.add("setup-strict");
  if (rowValue(row, "setupDisplayWatch") === true) keys.add("setup-watch");
  const rs = rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating");
  if (rs != null && rs >= 72) keys.add("rs-global");
  addScore("rs-group", "rsSectorPct", 70);
  addScore("rs-quality", "rsQualityScore", 68);
  addScore("weinstein", "weinsteinScore", 72);
  addScore("minervini", "minerviniScore", 72);
  addScore("volume-effect", "volumeEffectScore", 68);
  addScore("ad-proxy", "adProxyScore", 68);
  addScore("growth", "growthScore", 64);
  addScore("eps", "epsGrowthProxyScore", 64);
  addScore("risk-reward", "riskRewardScore", 68);
  const relativeVolume = rowNumber(row, "relativeVolume");
  if (relativeVolume != null && relativeVolume >= 1.5) keys.add("relative-volume");
  return keys;
}

function evidenceWatchItems(explanation = {}) {
  const seen = new Set();
  return [...(explanation.displayWatch || []), ...(explanation.watch || [])].filter((item) => {
    const key = item?.key || item?.label;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const DECISION_EVIDENCE_STATUS_META = {
  confirmed: { label: "Confirmado", tone: "good" },
  needed: { label: "Pendiente", tone: "warn" },
  blocked: { label: "Bloquea", tone: "bad" },
};

function methodologyEvidenceItem(item = {}) {
  const label = item.label || item.key || "";
  const meta = DECISION_EVIDENCE_STATUS_META[item.status] || DECISION_EVIDENCE_STATUS_META.needed;
  return {
    key: item.evidenceKey || searchKey(label),
    methodologyKey: item.key || searchKey(label),
    label,
    status: item.status || "needed",
    statusLabel: item.statusLabel || meta.label,
    tone: item.tone || meta.tone,
    detail: cleanText(item.detail),
    critical: item.critical !== false,
    metrics: Array.isArray(item.metrics) ? item.metrics : [],
  };
}

export function buildDecisionEvidenceChecklist(row = {}, settingsOrExplanation = {}) {
  const explanation = resolveExplanation(row, settingsOrExplanation);
  const methodology = buildRowMethodologyEvidence(row, { explanation, settings: settingsOrExplanation });
  const items = (methodology.categories || []).map(methodologyEvidenceItem);
  const pending = items.filter((item) => item.status !== "confirmed");
  const blocked = pending.filter((item) => item.status === "blocked");
  const status = blocked.length ? "blocked" : pending.length ? "needs-work" : "ready";
  const tone = status === "ready" ? "good" : status === "blocked" ? "bad" : "warn";
  const passedCount = items.length - pending.length;
  return {
    schemaVersion: 2,
    status,
    tone,
    passedCount,
    totalCount: items.length,
    summary: pending.length ? pending.slice(0, 2).map((item) => item.label).join(" · ") : "Pruebas metodologicas confirmadas",
    items,
    pending,
    methodology,
    reviewFocus: methodology.reviewFocus || [],
    manualReviewRequired: methodology.manualReviewRequired === true,
    reviewSummary: methodology.reviewSummary || "",
  };
}

function buildRankAction({ weaknessMode, drivers, watch, displayWatch, tone }) {
  if (weaknessMode) {
    return rankAction("bearish-watch", "bad", "Modo deterioro: revisar debilidad o evitar largos.");
  }
  if (hasKey(watch, "quality-gate") || hasKey(watch, "freshness") || hasKey(watch, "methodology-limited") || hasKey(watch, "partial-projection")) {
    return rankAction("check-data", "warn", "La tesis depende de datos incompletos, viejos o limitados.");
  }
  if (hasKey(drivers, "weakness-dominates")) {
    return rankAction("avoid-long", "bad", "La debilidad tecnica domina y no hay tesis larga clara.");
  }
  if (watch.some((item) => item.tone === "bad")) {
    return rankAction("high-risk", "bad", "Hay una alerta severa antes de considerar entrada.");
  }
  if (hasKey(drivers, "setup-plan")) {
    return displayWatch.length
      ? rankAction("candidate-with-watch", "warn", "Buen setup, pero requiere revisar alertas.")
      : rankAction("candidate-long", "good", "Setup y drivers principales alineados.");
  }
  if (hasKey(drivers, "setup-strict") || hasKey(drivers, "setup-watch")) {
    return rankAction("watch-setup", displayWatch.length ? "warn" : "neutral", "Estructura observable; esperar confirmacion o mejor punto.");
  }
  if (tone === "good") {
    return rankAction("strong-profile", "good", "Drivers fuertes, aunque no necesariamente hay punto de entrada.");
  }
  if (displayWatch.length) {
    return rankAction("watchlist", "warn", "Hay tesis parcial, pero conviene revisar las alertas.");
  }
  return rankAction("unclear", "muted", "No destaca un driver operativo suficiente.");
}

function buildDecisionReadiness({ weaknessMode, action, drivers, displayWatch }) {
  if (weaknessMode || action.key === "bearish-watch") {
    return decisionReadiness("bearish", "bad", "Lista defensiva o bajista: no interpretar como oportunidad larga.");
  }
  if (action.key === "check-data") {
    return decisionReadiness("audit", "warn", "Antes de priorizarla hay que validar cobertura, frescura o fiabilidad del setup.");
  }
  if (action.key === "high-risk") {
    return decisionReadiness("audit", "bad", "Riesgo severo: requiere revisión manual antes de entrar en cola.");
  }
  if (action.key === "avoid-long") {
    return decisionReadiness("reject", "bad", "Descartada para largos mientras la debilidad domine.");
  }
  if (action.key === "unclear") {
    return decisionReadiness("reject", "muted", "Sin driver suficiente para ocupar la cola principal.");
  }
  if (action.key === "candidate-long" && !displayWatch.length) {
    if (!hasKey(drivers, "rs-global")) {
      return decisionReadiness("watch", "warn", "Setup válido, pero falta liderazgo relativo global suficiente.");
    }
    const leadershipDrivers = countKeys(drivers, ["rs-global", "rs-group", "rs-quality", "weinstein", "minervini"]);
    const confirmationDrivers = countKeys(drivers, ["rs-global", "rs-group", "weinstein", "minervini", "volume-effect", "ad-proxy", "growth", "eps", "risk-reward"]);
    const executionDrivers = countKeys(drivers, ["volume-effect", "ad-proxy", "relative-volume", "growth", "eps", "risk-reward"]);
    if (leadershipDrivers >= 2 && confirmationDrivers >= 3 && executionDrivers >= 1) {
      return decisionReadiness("operable", "good", "Setup accionable, liderazgo global confirmado y al menos una confirmación operativa.");
    }
    return decisionReadiness("watch", "warn", "Setup válido, pero falta confirmación suficiente de liderazgo, momentum o demanda.");
  }
  return decisionReadiness("watch", action.tone === "good" ? "warn" : action.tone, "Buen perfil o estructura parcial, pero no es entrada limpia.");
}

export function buildDecisionBrief(row = {}, settingsOrExplanation = {}) {
  const explanation = resolveExplanation(row, settingsOrExplanation);
  if (explanation.brief?.thesis || explanation.brief?.risk || explanation.brief?.nextAction) return explanation.brief;
  const drivers = Array.isArray(explanation.drivers) ? explanation.drivers : [];
  const watch = Array.isArray(explanation.displayWatch) && explanation.displayWatch.length
    ? explanation.displayWatch
    : Array.isArray(explanation.watch) ? explanation.watch : [];
  const primaryWatch = watch[0];
  const readiness = explanation.readiness || decisionReadiness("reject", "muted", "Sin lectura suficiente.");
  const action = explanation.action || rankAction("unclear", "muted", "Sin accion definida.");
  const primaryDriver = action.key === "candidate-long"
    ? drivers.find((item) => item?.key === "setup-plan") || drivers[0]
    : drivers[0];
  const secondaryDrivers = drivers
    .filter((item) => item !== primaryDriver)
    .slice(0, 2)
    .map(itemHeadline)
    .filter(Boolean);
  const thesisValue = action.key === "check-data"
    ? "Tesis pendiente de datos"
    : action.key === "avoid-long"
      ? "Sin tesis larga limpia"
      : action.key === "bearish-watch"
        ? "Tesis de deterioro"
        : itemHeadline(primaryDriver) || action.label;
  const thesisDetail = [
    itemDetail(primaryDriver),
    secondaryDrivers.length ? `Apoyos: ${secondaryDrivers.join(" · ")}` : "",
  ].filter(Boolean).join(" ");
  const riskValue = primaryWatch
    ? itemHeadline(primaryWatch)
    : readiness.key === "operable"
      ? "Sin alerta principal"
      : readiness.label;
  const riskDetail = primaryWatch
    ? itemDetail(primaryWatch)
    : readiness.key === "operable"
      ? "La cola no detecta bloqueos relevantes; validar precio y volumen en el grafico."
      : readiness.detail || action.detail;
  const nextByReadiness = {
    operable: {
      value: "Preparar entrada",
      detail: "Revisar pivot, stop y volumen antes de ejecutar; no perseguir si el precio se aleja.",
      tone: "good",
    },
    watch: {
      value: "Esperar confirmacion",
      detail: primaryWatch ? `Resolver o esperar: ${itemHeadline(primaryWatch)}.` : readiness.detail,
      tone: "warn",
    },
    audit: {
      value: "Auditar antes",
      detail: primaryWatch ? itemDetail(primaryWatch) : readiness.detail,
      tone: readiness.tone || "warn",
    },
    reject: {
      value: "Sacar de cola larga",
      detail: readiness.detail || action.detail,
      tone: readiness.tone || "bad",
    },
    bearish: {
      value: "Tratar como riesgo",
      detail: "Lista defensiva: revisar debilidad, stops o exclusión de candidatos largos.",
      tone: "bad",
    },
  };
  const next = nextByReadiness[readiness.key] || {
    value: action.label,
    detail: action.detail || readiness.detail,
    tone: action.tone || readiness.tone || "neutral",
  };
  return {
    schemaVersion: 1,
    tone: readiness.tone || explanation.tone || "neutral",
    thesis: {
      label: "Tesis",
      value: thesisValue,
      detail: thesisDetail || explanation.line || action.detail || "",
      tone: action.tone || explanation.tone || "neutral",
    },
    risk: {
      label: "Riesgo",
      value: riskValue,
      detail: riskDetail || "",
      tone: primaryWatch?.tone || (readiness.key === "operable" ? "good" : readiness.tone || "warn"),
    },
    nextAction: {
      label: "Siguiente",
      value: next.value,
      detail: next.detail || "",
      tone: next.tone || action.tone || readiness.tone || "neutral",
    },
  };
}

function compactMethodologyFocus(evidence = {}) {
  const focusItems = Array.isArray(evidence.reviewFocus) ? evidence.reviewFocus : [];
  const focus = focusItems.find((item) => item?.requiresReview) || focusItems[0];
  if (!focus) return null;
  const label = focus.label || focus.key || "Método";
  return {
    key: focus.key || label,
    label,
    shortLabel: focus.requiresReview ? label : `Contexto: ${label}`,
    status: focus.status || "confirmed",
    tone: focus.tone || (focus.requiresReview ? "warn" : "neutral"),
    detail: focus.action || focus.detail || "",
    requiresReview: focus.requiresReview === true,
  };
}

export function buildDecisionQueueItem(row = {}, settingsOrExplanation = {}) {
  const explanation = resolveExplanation(row, settingsOrExplanation);
  const brief = buildDecisionBrief(row, explanation);
  const evidence = buildDecisionEvidenceChecklist(row, explanation);
  const methodologyFocus = compactMethodologyFocus(evidence);
  const total = rowNumber(row, "objectiveScore") ?? rowNumber(row, "totalScore") ?? rowNumber(row, "compositeScore");
  return {
    schemaVersion: 1,
    symbol: cleanText(row.symbol).toUpperCase(),
    score: total == null ? null : Math.round(total),
    tone: brief.nextAction?.tone || explanation.readiness?.tone || explanation.action?.tone || "neutral",
    action: explanation.action,
    readiness: explanation.readiness,
    thesis: brief.thesis,
    risk: brief.risk,
    nextAction: brief.nextAction,
    evidence,
    methodologyFocus,
    label: brief.nextAction?.value || explanation.action?.label || "",
    detail: brief.risk?.value || explanation.readiness?.detail || explanation.line || "",
  };
}

function compactEvidenceForDigest(evidence = {}) {
  const pending = Array.isArray(evidence.pending) ? evidence.pending.filter((item) => item?.label || item?.key) : [];
  const confirmed = Array.isArray(evidence.items)
    ? evidence.items.filter((item) => item?.status === "confirmed" && (item.label || item.key))
    : [];
  return (pending.length ? pending : confirmed).slice(0, 3).map((item) => ({
    key: item.key || searchKey(item.label),
    label: item.label || item.key,
    tone: item.tone || (item.status === "confirmed" ? "good" : "warn"),
    detail: item.detail || item.statusLabel || "",
  }));
}

export function buildDecisionQueueDigest(itemOrRow = {}, settingsOrExplanation = {}) {
  const item = itemOrRow?.nextAction && itemOrRow?.readiness && itemOrRow?.evidence
    ? itemOrRow
    : buildDecisionQueueItem(itemOrRow, settingsOrExplanation);
  const evidence = item.evidence || {};
  const passed = finite(evidence.passedCount);
  const total = finite(evidence.totalCount);
  const ratio = passed != null && total != null ? `${passed}/${total}` : "";
  const checks = compactEvidenceForDigest(evidence);
  const state = evidence.status === "ready"
    ? "ready"
    : evidence.status === "blocked" ? "blocked" : "needs-work";
  const stateLabel = state === "ready"
    ? "Pruebas OK"
    : state === "blocked" ? "Bloqueada" : "Falta validar";
  const thesis = cleanText(item.thesis?.value || item.action?.label || item.symbol);
  const risk = cleanText(item.risk?.value || item.detail || "");
  const next = cleanText(item.nextAction?.value || item.label || item.readiness?.label || "");
  const checkLine = checks.map((check) => check.label).filter(Boolean).join(" · ");
  const actionDetail = cleanText(item.nextAction?.detail || item.readiness?.detail || "");
  const methodologyFocus = item.methodologyFocus || null;

  return {
    schemaVersion: 1,
    symbol: item.symbol || "",
    tone: item.tone || evidence.tone || "neutral",
    state,
    stateLabel,
    ratio,
    headline: next,
    thesis,
    risk,
    actionDetail,
    checkLine,
    methodologyFocus,
    checks,
    tooltip: [next, thesis, risk, checkLine || actionDetail].filter(Boolean).join(" · "),
  };
}

export function buildDecisionQueueDigestSummary(itemsOrRows = [], settingsOrExplanation = {}) {
  const groups = DECISION_QUEUE_DIGEST_FILTERS.map((meta) => ({
    ...meta,
    count: 0,
    firstIndex: -1,
    sampleSymbols: [],
  }));
  const groupMap = new Map(groups.map((group) => [group.key, group]));
  const digests = (Array.isArray(itemsOrRows) ? itemsOrRows : [])
    .filter(Boolean)
    .map((item) => item?.digest || buildDecisionQueueDigest(item, settingsOrExplanation));

  for (const [index, digest] of digests.entries()) {
    const state = groupMap.has(digest.state) ? digest.state : "needs-work";
    const all = groupMap.get("all");
    const group = groupMap.get(state);
    for (const item of [all, group]) {
      item.count += 1;
      if (item.firstIndex < 0) item.firstIndex = index;
      if (digest.symbol && item.sampleSymbols.length < 3) item.sampleSymbols.push(digest.symbol);
    }
  }

  return groups.filter((group) => group.key === "all" || group.count > 0);
}

export function buildDecisionQueueSummary(rowsOrItems = [], settingsOrExplanation = {}) {
  const items = (Array.isArray(rowsOrItems) ? rowsOrItems : [])
    .filter(Boolean)
    .map((item) => item?.nextAction && item?.readiness ? item : buildDecisionQueueItem(item, settingsOrExplanation));
  const groups = DECISION_QUEUE_GROUPS.map((meta) => ({
    ...meta,
    count: 0,
    firstIndex: -1,
    sampleSymbols: [],
  }));
  const groupMap = new Map(groups.map((group) => [group.key, group]));
  for (const [index, item] of items.entries()) {
    const key = item.readiness?.key || "unknown";
    if (!groupMap.has(key)) {
      const fallback = { key, label: decisionQueueGroupLabel(key, "Otros"), tone: item.tone || "neutral", count: 0, firstIndex: -1, sampleSymbols: [] };
      groups.push(fallback);
      groupMap.set(key, fallback);
    }
    const group = groupMap.get(key);
    group.count += 1;
    if (group.firstIndex < 0) group.firstIndex = index;
    if (item.symbol && group.sampleSymbols.length < 3) group.sampleSymbols.push(item.symbol);
  }
  const visibleGroups = groups.filter((group) => group.count > 0);
  const counts = Object.fromEntries(groups.map((group) => [group.key, group.count]));
  return {
    total: items.length,
    groups: visibleGroups,
    allGroups: groups,
    counts,
    actionableCount: counts.operable || 0,
    reviewCount: (counts.watch || 0) + (counts.audit || 0),
    blockedCount: (counts.reject || 0) + (counts.bearish || 0),
  };
}

export function explainScreenerRank(row = {}, settings = {}) {
  if (row?.__screenerAnnotation?.explanation) return row.__screenerAnnotation.explanation;
  const set = settings?.values || settings || {};
  const mode = cleanText(set.setupMode).toLowerCase();
  const weaknessMode = mode === "weakness";
  const drivers = [];
  const watch = [];
  if (weaknessMode) weaknessModeDrivers(row, drivers);
  else normalModeDrivers(row, drivers);
  addFallbackDrivers(row, drivers);
  addBaseDataWatch(row, set, watch);
  addRiskWatch(row, watch, weaknessMode);
  addCoverageWatch(row, watch, weaknessMode);

  const total = rowNumber(row, "objectiveScore") ?? rowNumber(row, "totalScore") ?? rowNumber(row, "compositeScore");
  if (!drivers.length && total != null) {
    addUnique(drivers, { key: "objective-score", label: "Score compuesto", value: score(total), tone: total >= 75 ? "ok" : "neutral", text: `Objetivo ${score(total)}` });
  }
  if (!drivers.length) addUnique(drivers, { key: "no-driver", label: "Sin tesis clara", tone: "muted", text: "Ranking sin driver dominante" });

  const severe = watch.some((item) => item.tone === "bad");
  const tone = severe ? "bad" : watch.length ? "warn" : drivers.some((item) => item.tone === "strong") ? "good" : "neutral";
  const title = weaknessMode ? "Por que aparece en deterioro" : "Por que rankea";
  const weaknessDominates = drivers.some((item) => item.key === "weakness-dominates");
  const displayWatch = weaknessDominates ? watch.filter((item) => item.key !== "weakness" && item.key !== "decision-evidence") : watch;
  const action = buildRankAction({ weaknessMode, drivers, watch, displayWatch, tone });
  const readiness = buildDecisionReadiness({ weaknessMode, action, drivers, displayWatch });
  const driverText = drivers.slice(0, 3).map((item) => item.value ? `${item.label} ${item.value}` : item.label).join(" · ");
  const watchText = displayWatch.slice(0, 2).map((item) => item.value ? `${item.label}: ${item.value}` : item.label).join(" · ");
  return {
    mode: weaknessMode ? "weakness" : "long",
    tone,
    title,
    drivers: drivers.slice(0, MAX_DRIVERS),
    watch: watch.slice(0, MAX_WATCH),
    displayWatch: displayWatch.slice(0, MAX_WATCH),
    action,
    readiness,
    line: watchText ? `${driverText} | Revisar: ${watchText}` : driverText,
    text: [
      driverText ? `Drivers: ${driverText}` : "",
      watchText ? `Revisar: ${watchText}` : "",
    ].filter(Boolean).join(" · "),
  };
}
