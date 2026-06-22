import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";

export const METHODOLOGY_EVIDENCE_CATEGORIES = [
  "setup",
  "leadership",
  "sector-context",
  "confluence",
  "demand",
  "risk",
  "freshness",
  "data",
  "contradictions",
];

const STATUS_META = {
  confirmed: { label: "Confirmado", tone: "good" },
  needed: { label: "Pendiente", tone: "warn" },
  blocked: { label: "Bloquea", tone: "bad" },
};

const REVIEW_PRIORITY = {
  risk: 90,
  contradictions: 86,
  data: 82,
  freshness: 78,
  setup: 72,
  confluence: 68,
  demand: 64,
  leadership: 58,
  "sector-context": 52,
};

const REVIEW_ACTIONS = {
  setup: "Revisar estructura, pivote y distancia al punto operativo.",
  leadership: "Comparar RS global y calidad relativa contra universo y grupo.",
  "sector-context": "Contrastar si el grupo acompana o si el caso esta aislado.",
  confluence: "Comprobar que liderazgo, confirmacion y ejecucion no dependan de un unico motor.",
  demand: "Validar acumulacion con volumen, A/D, RelVol o UD Vol antes de elevar confianza.",
  risk: "Revisar extension, drawdown y rentabilidad/riesgo antes de interpretar operabilidad.",
  freshness: "Actualizar precios o sello de frescura antes de interpretar la fila.",
  data: "Completar cobertura o fuente antes de confiar en el diagnostico.",
  contradictions: "Resolver contradicciones entre score, setup, liderazgo, riesgo y datos.",
};

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rowValue(row = {}, key = "") {
  return row?.[key] ?? row?.metrics?.[key] ?? row?.raw?.[key] ?? row?.snapshot?.[key];
}

function rowNumber(row = {}, key = "") {
  return finite(rowValue(row, key));
}

function rowText(row = {}, key = "", limit = 160) {
  return String(rowValue(row, key) ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanText(value = "", limit = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function score(value) {
  return Number.isFinite(value) ? value.toFixed(0) : "sin dato";
}

function pct(value, digits = 1) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : "sin dato";
}

function hasMetric(row = {}, keys = []) {
  return keys.some((key) => rowNumber(row, key) != null);
}

function countMetrics(row = {}, specs = []) {
  return specs.reduce((count, [key, threshold]) => {
    const value = rowNumber(row, key);
    return count + (value != null && value >= threshold ? 1 : 0);
  }, 0);
}

function demandSignalCount(row = {}) {
  const demand = rowNumber(row, "demandScore");
  const volume = rowNumber(row, "volumeEffectScore");
  const ad = rowNumber(row, "adProxyScore");
  const relVol = rowNumber(row, "relativeVolume");
  const upDown = rowNumber(row, "upDownVolRatio");
  return [
    demand != null && demand >= 64,
    volume != null && volume >= 68,
    ad != null && ad >= 68,
    relVol != null && relVol >= 1.5,
    upDown != null && upDown >= 1.2,
  ].filter(Boolean).length;
}

function driverKeys(explanation = {}) {
  return new Set((explanation.drivers || []).map((item) => item?.key).filter(Boolean));
}

function watchItems(explanation = {}) {
  const seen = new Set();
  return [...(explanation.displayWatch || []), ...(explanation.watch || [])].filter((item) => {
    const key = item?.key || item?.label;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function watchKeySet(explanation = {}) {
  return new Set(watchItems(explanation).map((item) => item.key || item.label).filter(Boolean));
}

function category({ key, evidenceKey = "", label, status = "needed", detail = "", metrics = [], critical = true, tone = "" }) {
  const meta = STATUS_META[status] || STATUS_META.needed;
  return {
    key,
    evidenceKey: evidenceKey || "",
    label,
    status,
    statusLabel: meta.label,
    tone: tone || meta.tone,
    detail: cleanText(detail),
    critical,
    metrics: metrics.filter((item) => item && (item.value !== null || item.detail || item.label)).slice(0, 5),
  };
}

function metric(key, label, value, { suffix = "", detail = "" } = {}) {
  return {
    key,
    label,
    value: Number.isFinite(value) ? Number(value.toFixed(2)) : null,
    display: Number.isFinite(value) ? `${Number(value.toFixed(1))}${suffix}` : "",
    detail: cleanText(detail),
  };
}

function reviewPriority(item = {}) {
  const statusScore = item.status === "blocked"
    ? 300
    : item.status === "needed"
      ? 200
      : item.tone === "warn"
        ? 120
        : item.tone === "neutral"
          ? 40
          : 0;
  return statusScore + (REVIEW_PRIORITY[item.key] || 0);
}

function buildReviewFocus(categories = []) {
  return categories
    .filter((item) => item?.critical !== false && (
      item.status !== "confirmed"
      || item.tone === "warn"
      || item.tone === "neutral"
    ))
    .map((item) => ({
      key: item.key,
      label: item.label,
      status: item.status,
      statusLabel: item.statusLabel,
      tone: item.tone,
      detail: cleanText(item.detail),
      action: REVIEW_ACTIONS[item.key] || "Revisar esta evidencia antes de elevar confianza.",
      priority: reviewPriority(item),
      requiresReview: item.status !== "confirmed" || item.tone === "warn",
    }))
    .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label))
    .slice(0, 5);
}

function setupCategory(row = {}, explanation = {}) {
  const setup = rowNumber(row, "setupQualityScore");
  const plan = rowValue(row, "setupDisplayPlanValid") === true;
  const strict = rowValue(row, "setupDisplayStrict") === true;
  const watch = rowValue(row, "setupDisplayWatch") === true;
  const reason = rowText(row, "setupDisplayReason") || rowText(row, "methodologyReliabilityReason");
  if (plan || strict || (setup != null && setup >= 68)) {
    return category({
      key: "setup",
      label: "Setup accionable",
      status: "confirmed",
      detail: reason || (plan || strict ? "Plan, pivote o estructura estricta detectada." : `Setup ${score(setup)} >= 68.`),
      metrics: [metric("setupQualityScore", "Setup", setup)],
    });
  }
  if (watch || (setup != null && setup >= 55)) {
    return category({
      key: "setup",
      label: "Setup accionable",
      status: "needed",
      detail: reason || `Setup observable pero sin punto operativo completo (${score(setup)}).`,
      metrics: [metric("setupQualityScore", "Setup", setup)],
    });
  }
  return category({
    key: "setup",
    label: "Setup accionable",
    status: explanation.readiness?.key === "reject" ? "blocked" : "needed",
    detail: setup == null ? "Falta score de setup o estructura accionable." : `Setup ${score(setup)} < 55.`,
    metrics: [metric("setupQualityScore", "Setup", setup)],
  });
}

function leadershipCategory(row = {}, explanation = {}) {
  const rs = rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating");
  const rsQuality = rowNumber(row, "rsQualityScore");
  const weinstein = rowNumber(row, "weinsteinScore");
  const minervini = rowNumber(row, "minerviniScore");
  const qualitySignals = [
    rsQuality != null && rsQuality >= 68,
    weinstein != null && weinstein >= 72,
    minervini != null && minervini >= 72,
  ].filter(Boolean).length;
  if (rs == null) {
    return category({
      key: "leadership",
      label: "Liderazgo global",
      status: "blocked",
      detail: "RS global no disponible.",
      metrics: [metric("rs", "RS", rs), metric("rsQualityScore", "RS calidad", rsQuality)],
    });
  }
  if (rs >= 72 && qualitySignals >= 1) {
    return category({
      key: "leadership",
      label: "Liderazgo global",
      status: "confirmed",
      detail: `RS ${score(rs)} con ${qualitySignals} senal(es) de calidad relativa.`,
      metrics: [metric("rs", "RS", rs), metric("rsQualityScore", "RS calidad", rsQuality), metric("weinsteinScore", "Weinstein", weinstein), metric("minerviniScore", "Minervini", minervini)],
    });
  }
  const neutral = rs >= 55;
  return category({
    key: "leadership",
    label: "Liderazgo global",
    status: "confirmed",
    tone: neutral ? "neutral" : "warn",
    detail: rs < 72
      ? `RS ${score(rs)} evaluado por debajo de liderazgo; limita la conviccion del caso.`
      : "RS suficiente, pero falta confirmar calidad de liderazgo relativo.",
    metrics: [metric("rs", "RS", rs), metric("rsQualityScore", "RS calidad", rsQuality), metric("weinsteinScore", "Weinstein", weinstein), metric("minerviniScore", "Minervini", minervini)],
  });
}

function sectorContextCategory(row = {}) {
  const sectorScore = rowNumber(row, "sectorScore") ?? rowNumber(row, "groupStrengthScore");
  const rsSector = rowNumber(row, "rsSectorPct");
  const rsSectorSample = rowNumber(row, "rsSectorSample");
  const sector = rowText(row, "sector", 80) || rowText(row, "industry", 80);
  const value = sectorScore ?? rsSector;
  const sampleDetail = Number.isFinite(rsSectorSample) ? ` · muestra ${score(rsSectorSample)}` : "";
  if (sectorScore == null && rsSector == null) {
    return category({
      key: "sector-context",
      label: "Contexto sectorial",
      status: "needed",
      detail: "Falta fuerza de grupo/sector para separar caso aislado de liderazgo grupal.",
      metrics: [metric("sectorScore", "Grupo", sectorScore), metric("rsSectorPct", "RS sector", rsSector)],
    });
  }
  const supportive = (sectorScore != null && sectorScore >= 65) || (rsSector != null && rsSector >= 70);
  const neutral = (sectorScore != null && sectorScore >= 50) || (rsSector != null && rsSector >= 55);
  return category({
    key: "sector-context",
    label: "Contexto sectorial",
    status: "confirmed",
    tone: supportive ? "good" : neutral ? "neutral" : "warn",
    detail: supportive
      ? `${sector || "Grupo"} con fuerza relativa suficiente.`
      : neutral
        ? `${sector || "Grupo"} evaluado como neutral (${score(value)}${sampleDetail}); no aporta viento de cola claro.`
        : `${sector || "Grupo"} evaluado debil (${score(value)}${sampleDetail}); limita la conviccion del caso.`,
    metrics: [metric("sectorScore", "Grupo", sectorScore), metric("rsSectorPct", "RS sector", rsSector), metric("rsSectorSample", "Muestra", rsSectorSample)],
  });
}

function confluenceCategory(row = {}, explanation = {}) {
  const keys = driverKeys(explanation);
  const leadership = [...["rs-global", "rs-group", "rs-quality", "weinstein", "minervini"]].reduce((sum, key) => sum + (keys.has(key) ? 1 : 0), 0);
  const confirmation = [...["rs-global", "rs-group", "weinstein", "minervini", "volume-effect", "ad-proxy", "growth", "eps", "risk-reward"]].reduce((sum, key) => sum + (keys.has(key) ? 1 : 0), 0);
  const setup = rowNumber(row, "setupQualityScore");
  const fallbackLeadership = countMetrics(row, [["rsGlobalPct", 72], ["rsSectorPct", 70], ["rsQualityScore", 68], ["weinsteinScore", 72], ["minerviniScore", 72]]);
  const fallbackConfirmation = countMetrics(row, [["rsGlobalPct", 72], ["rsSectorPct", 70], ["weinsteinScore", 72], ["minerviniScore", 72], ["volumeEffectScore", 68], ["adProxyScore", 68], ["growthScore", 64], ["epsGrowthProxyScore", 64], ["riskRewardScore", 68]]);
  const leadershipCount = Math.max(leadership, fallbackLeadership);
  const confirmationCount = Math.max(confirmation, fallbackConfirmation);
  const executionCount = countMetrics(row, [["volumeEffectScore", 68], ["adProxyScore", 68], ["growthScore", 64], ["epsGrowthProxyScore", 64], ["riskRewardScore", 68]]);
  const ready = leadershipCount >= 3 && confirmationCount >= 5 && executionCount >= 1;
  return category({
    key: "confluence",
    label: "Confluencia amplia",
    status: ready ? "confirmed" : "needed",
    detail: `liderazgo ${leadershipCount}/3 · confirmacion ${confirmationCount}/5 · ejecucion ${executionCount}/1`,
    metrics: [metric("setupQualityScore", "Setup", setup)],
  });
}

function demandCategory(row = {}) {
  const demand = rowNumber(row, "demandScore");
  const volume = rowNumber(row, "volumeEffectScore");
  const ad = rowNumber(row, "adProxyScore");
  const relVol = rowNumber(row, "relativeVolume");
  const upDown = rowNumber(row, "upDownVolRatio");
  const signals = demandSignalCount(row);
  if (signals >= 1) {
    return category({
      key: "demand",
      label: "Demanda/volumen",
      status: "confirmed",
      detail: `${signals} senal(es) de demanda: volumen efectivo, A/D, RelVol o UD Vol.`,
      metrics: [metric("demandScore", "Demanda", demand), metric("volumeEffectScore", "Volumen", volume), metric("adProxyScore", "A/D", ad), metric("relativeVolume", "RelVol", relVol, { suffix: "x" }), metric("upDownVolRatio", "UD Vol", upDown, { suffix: "x" })],
    });
  }
  return category({
    key: "demand",
    label: "Demanda/volumen",
    status: hasMetric(row, ["demandScore", "volumeEffectScore", "adProxyScore", "relativeVolume", "upDownVolRatio"]) ? "confirmed" : "blocked",
    tone: hasMetric(row, ["demandScore", "volumeEffectScore", "adProxyScore", "relativeVolume", "upDownVolRatio"]) ? "warn" : "bad",
    detail: hasMetric(row, ["demandScore", "volumeEffectScore", "adProxyScore", "relativeVolume", "upDownVolRatio"])
      ? "Demanda evaluada debil: no confirma acumulacion o volumen relativo suficiente."
      : "Faltan metricas para evaluar demanda/volumen.",
    metrics: [metric("demandScore", "Demanda", demand), metric("volumeEffectScore", "Volumen", volume), metric("adProxyScore", "A/D", ad), metric("relativeVolume", "RelVol", relVol, { suffix: "x" }), metric("upDownVolRatio", "UD Vol", upDown, { suffix: "x" })],
  });
}

function riskCategory(row = {}, explanation = {}) {
  const riskReward = rowNumber(row, "riskRewardScore");
  const extension = rowNumber(row, "extSma50");
  const drawdown = rowNumber(row, "maxDrawdown63d");
  const weakness = rowNumber(row, "weaknessScore");
  const keys = watchKeySet(explanation);
  const severe = [
    extension != null && extension > 32 ? `extension SMA50 ${pct(extension)}` : "",
    riskReward != null && riskReward < 40 ? `rent/riesgo ${score(riskReward)} < 40` : "",
    drawdown != null && drawdown > 35 ? `DD63 ${pct(drawdown)}` : "",
    weakness != null && weakness >= 78 ? `deterioro ${score(weakness)}` : "",
  ].filter(Boolean);
  const warnings = [
    keys.has("extension") || (extension != null && extension > 18) ? `extension SMA50 ${pct(extension)}` : "",
    keys.has("risk-reward-low") || (riskReward != null && riskReward < 55) ? `rent/riesgo ${score(riskReward)}` : "",
    drawdown != null && drawdown > 25 ? `DD63 ${pct(drawdown)}` : "",
    weakness != null && weakness >= 50 ? `deterioro ${score(weakness)}` : "",
  ].filter(Boolean);
  if (severe.length) {
    return category({
      key: "risk",
      evidenceKey: "precio-perseguible",
      label: "Riesgo operativo",
      status: "blocked",
      detail: severe.join(" · "),
      metrics: [metric("riskRewardScore", "Rent/riesgo", riskReward), metric("extSma50", "Ext SMA50", extension, { suffix: "%" }), metric("maxDrawdown63d", "DD63", drawdown, { suffix: "%" }), metric("weaknessScore", "Deterioro", weakness)],
    });
  }
  if (warnings.length) {
    return category({
      key: "risk",
      evidenceKey: "precio-perseguible",
      label: "Riesgo operativo",
      status: "needed",
      detail: warnings.join(" · "),
      metrics: [metric("riskRewardScore", "Rent/riesgo", riskReward), metric("extSma50", "Ext SMA50", extension, { suffix: "%" }), metric("maxDrawdown63d", "DD63", drawdown, { suffix: "%" }), metric("weaknessScore", "Deterioro", weakness)],
    });
  }
  if (!hasMetric(row, ["riskRewardScore", "extSma50", "maxDrawdown63d", "weaknessScore"])) {
    return category({
      key: "risk",
      evidenceKey: "precio-perseguible",
      label: "Riesgo operativo",
      status: "needed",
      detail: "Faltan metricas de extension, drawdown o rentabilidad/riesgo.",
      metrics: [metric("riskRewardScore", "Rent/riesgo", riskReward), metric("extSma50", "Ext SMA50", extension, { suffix: "%" }), metric("maxDrawdown63d", "DD63", drawdown, { suffix: "%" }), metric("weaknessScore", "Deterioro", weakness)],
    });
  }
  return category({
    key: "risk",
    evidenceKey: "precio-perseguible",
    label: "Riesgo operativo",
    status: "confirmed",
    detail: "Sin extension, deterioro ni rentabilidad/riesgo pobre en las alertas principales.",
    metrics: [metric("riskRewardScore", "Rent/riesgo", riskReward), metric("extSma50", "Ext SMA50", extension, { suffix: "%" }), metric("maxDrawdown63d", "DD63", drawdown, { suffix: "%" }), metric("weaknessScore", "Deterioro", weakness)],
  });
}

function freshnessCategory(row = {}, dataHealth = {}) {
  const freshness = dataHealth.freshness || {};
  const days = rowNumber(row, "priceFreshnessDays") ?? finite(freshness.days);
  const maxDays = rowNumber(row, "priceFreshnessMaxDays") ?? finite(freshness.maxDays);
  const ok = rowValue(row, "priceFreshnessOk") === true || freshness.ok === true || (days != null && maxDays != null && days <= maxDays);
  const stale = rowValue(row, "priceFreshnessOk") === false || freshness.stale === true;
  if (ok && !stale) {
    return category({
      key: "freshness",
      label: "Frescura de datos",
      status: "confirmed",
      detail: freshness.detail || (days != null ? `${score(days)}d/${score(maxDays)}d` : "precio fresco"),
      metrics: [metric("priceFreshnessDays", "Dias", days), metric("priceFreshnessMaxDays", "Max", maxDays)],
    });
  }
  if (stale) {
    return category({
      key: "freshness",
      label: "Frescura de datos",
      status: "needed",
      detail: freshness.label || rowText(row, "priceFreshnessIssue") || "precio no fresco",
      metrics: [metric("priceFreshnessDays", "Dias", days), metric("priceFreshnessMaxDays", "Max", maxDays)],
    });
  }
  return category({
    key: "freshness",
    label: "Frescura de datos",
    status: "needed",
    detail: "Falta sello de frescura de precio.",
    metrics: [metric("priceFreshnessDays", "Dias", days), metric("priceFreshnessMaxDays", "Max", maxDays)],
  });
}

function dataCategory(row = {}, dataHealth = {}) {
  const status = dataHealth.status?.key || "unknown";
  if (status === "ready") {
    return category({
      key: "data",
      label: "Datos fiables",
      status: "confirmed",
      detail: dataHealth.topLine || dataHealth.status?.detail || "Cobertura, frescura y metodologia sin bloqueo principal.",
      metrics: (dataHealth.metrics || []).map((item) => metric(item.key, item.label, finite(item.value), { detail: item.detail })),
    });
  }
  if (status === "blocked") {
    return category({
      key: "data",
      label: "Datos fiables",
      status: "blocked",
      detail: dataHealth.status?.detail || dataHealth.topLine || "datos base bloqueados",
      metrics: (dataHealth.metrics || []).map((item) => metric(item.key, item.label, finite(item.value), { detail: item.detail })),
    });
  }
  return category({
    key: "data",
    label: "Datos fiables",
    status: "needed",
    detail: dataHealth.status?.detail || dataHealth.topLine || "cobertura o frescura parcial",
    metrics: (dataHealth.metrics || []).map((item) => metric(item.key, item.label, finite(item.value), { detail: item.detail })),
  });
}

function contradictionItems(row = {}, explanation = {}, dataHealth = {}) {
  const items = [];
  const rs = rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating");
  const total = rowNumber(row, "totalScore") ?? rowNumber(row, "compositeScore");
  const setup = rowNumber(row, "setupQualityScore");
  const extension = rowNumber(row, "extSma50");
  const weakness = rowNumber(row, "weaknessScore");
  const riskReward = rowNumber(row, "riskRewardScore");
  const demandSignals = demandSignalCount(row);
  const actionKey = explanation.action?.key || "";
  const longBiased = ["candidate-long", "candidate-with-watch", "strong-profile", "watch-setup"].includes(actionKey);

  if (rowValue(row, "decisionProjectionPartial") === true) {
    items.push({ key: "projection-partial", severity: "bad", detail: "snapshot parcial" });
  }
  if (longBiased && dataHealth.status?.key === "blocked") {
    items.push({ key: "long-with-blocked-data", severity: "bad", detail: "tesis larga con datos bloqueados" });
  }
  if (longBiased && dataHealth.status?.key === "stale") {
    items.push({ key: "long-with-stale-price", severity: "warn", detail: "tesis larga con precio viejo" });
  }
  if (setup != null && setup >= 70 && rs != null && rs < 55) {
    items.push({ key: "setup-without-leadership", severity: "warn", detail: `setup ${score(setup)} pero RS ${score(rs)}` });
  }
  if (setup != null && setup >= 70 && extension != null && extension > 32) {
    items.push({ key: "setup-overextended", severity: "bad", detail: `setup ${score(setup)} pero extension ${pct(extension)}` });
  }
  if (total != null && total >= 72 && weakness != null && weakness >= 70) {
    items.push({ key: "high-score-with-weakness", severity: "warn", detail: `score ${score(total)} con deterioro ${score(weakness)}` });
  }
  if (total != null && total >= 72 && demandSignals < 1) {
    items.push({ key: "high-score-without-demand", severity: "warn", detail: `score ${score(total)} sin confirmacion de demanda` });
  }
  if (riskReward != null && riskReward < 40 && actionKey === "candidate-long") {
    items.push({ key: "entry-with-poor-risk", severity: "bad", detail: `entrada candidata con rent/riesgo ${score(riskReward)}` });
  }
  return items;
}

function contradictionsCategory(row = {}, explanation = {}, dataHealth = {}) {
  const items = contradictionItems(row, explanation, dataHealth);
  const severe = items.filter((item) => item.severity === "bad");
  if (severe.length) {
    return category({
      key: "contradictions",
      label: "Contradicciones",
      status: "blocked",
      detail: severe.map((item) => item.detail).slice(0, 2).join(" · "),
      metrics: items.map((item) => ({ key: item.key, label: item.key, value: null, detail: item.detail })),
    });
  }
  if (items.length) {
    return category({
      key: "contradictions",
      label: "Contradicciones",
      status: "needed",
      detail: items.map((item) => item.detail).slice(0, 2).join(" · "),
      metrics: items.map((item) => ({ key: item.key, label: item.key, value: null, detail: item.detail })),
    });
  }
  return category({
    key: "contradictions",
    label: "Contradicciones",
    status: "confirmed",
    detail: "No hay contradicciones internas severas entre score, setup, liderazgo, riesgo y datos.",
    metrics: [],
  });
}

export function buildRowMethodologyEvidence(row = {}, { explanation = {}, settings = {} } = {}) {
  const dataHealth = buildScreenerDataHealth(row, settings || {});
  const categories = [
    setupCategory(row, explanation),
    leadershipCategory(row, explanation),
    sectorContextCategory(row),
    confluenceCategory(row, explanation),
    demandCategory(row),
    riskCategory(row, explanation),
    freshnessCategory(row, dataHealth),
    dataCategory(row, dataHealth),
    contradictionsCategory(row, explanation, dataHealth),
  ];
  const pending = categories.filter((item) => item.status !== "confirmed");
  const blocked = pending.filter((item) => item.status === "blocked");
  const criticalPending = pending.filter((item) => item.critical !== false);
  const status = blocked.length ? "blocked" : criticalPending.length ? "needs-work" : "ready";
  const tone = status === "ready" ? "good" : status === "blocked" ? "bad" : "warn";
  const passedCount = categories.length - pending.length;
  const reviewFocus = buildReviewFocus(categories);
  const manualReviewRequired = reviewFocus.some((item) => item.requiresReview);
  return {
    schemaVersion: 1,
    status,
    tone,
    passedCount,
    totalCount: categories.length,
    readyShare: categories.length ? `${Math.round((passedCount / categories.length) * 100)}%` : "0%",
    summary: pending.length ? pending.slice(0, 2).map((item) => item.label).join(" · ") : "Pruebas metodologicas confirmadas",
    categories,
    pending,
    blocked,
    reviewFocus,
    manualReviewRequired,
    reviewSummary: manualReviewRequired
      ? reviewFocus.filter((item) => item.requiresReview).slice(0, 2).map((item) => item.label).join(" · ")
      : reviewFocus.length
        ? `Contexto a observar: ${reviewFocus.slice(0, 2).map((item) => item.label).join(" · ")}`
        : "Sin brecha metodologica principal.",
    dataHealthKey: dataHealth.status?.key || "unknown",
  };
}

export function compactRowMethodologyEvidence(evidence = null) {
  if (!evidence || typeof evidence !== "object") return null;
  const compactItem = (item = {}) => ({
    key: cleanText(item.key || item.label, 80),
    label: cleanText(item.label || item.key, 120),
    status: item.status || "needed",
    statusLabel: item.statusLabel || STATUS_META[item.status]?.label || "",
    tone: item.tone || STATUS_META[item.status]?.tone || "warn",
    detail: cleanText(item.detail, 180),
  });
  return {
    schemaVersion: evidence.schemaVersion || 1,
    status: evidence.status || "needs-work",
    tone: evidence.tone || "warn",
    passedCount: finite(evidence.passedCount) ?? 0,
    totalCount: finite(evidence.totalCount) ?? 0,
    readyShare: evidence.readyShare || "0%",
    summary: cleanText(evidence.summary, 180),
    categories: Array.isArray(evidence.categories) ? evidence.categories.map(compactItem).slice(0, 12) : [],
    pending: Array.isArray(evidence.pending) ? evidence.pending.map(compactItem).slice(0, 8) : [],
    blocked: Array.isArray(evidence.blocked) ? evidence.blocked.map(compactItem).slice(0, 8) : [],
    reviewFocus: Array.isArray(evidence.reviewFocus) ? evidence.reviewFocus.map((item) => ({
      ...compactItem(item),
      action: cleanText(item.action, 180),
      requiresReview: item.requiresReview === true,
    })).slice(0, 5) : [],
    manualReviewRequired: evidence.manualReviewRequired === true,
    reviewSummary: cleanText(evidence.reviewSummary, 180),
  };
}
