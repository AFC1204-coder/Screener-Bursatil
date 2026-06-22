import { DEFAULT_CHART_SETTINGS, normalizeChartInterval } from "./chartSettings.js";

const SHORT_RANGES = new Set(["1D", "5D", "1M"]);
const INTRADAY_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1H", "4H"]);

export const DECISION_CHART_PRESETS = [
  {
    key: "decision",
    label: "Vista método",
    detail: "D · 1A · RS/volumen",
    range: "1A",
    interval: "D",
    diagnostics: true,
    indicators: { volume: true, rsLine: true, maFast: true, maSlow: true },
  },
  {
    key: "entry",
    label: "Vista entrada",
    detail: "D · 3M · VCP",
    range: "3M",
    interval: "D",
    diagnostics: true,
    indicators: { volume: true, rsLine: true, maFast: true, maSlow: true },
  },
  {
    key: "context",
    label: "Vista contexto",
    detail: "W · 2A · RS",
    range: "2A",
    interval: "W",
    diagnostics: false,
    indicators: { volume: true, rsLine: true, maFast: true, maSlow: true },
  },
];

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lowerText(value = "") {
  return cleanText(value).toLowerCase();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pctValue(value) {
  const number = finite(value);
  return number == null ? "-" : `${number.toFixed(1)}%`;
}

function evidenceItems(evidence = null) {
  if (!evidence || typeof evidence !== "object") return { pending: [], confirmed: [] };
  const items = Array.isArray(evidence.items) ? evidence.items : [];
  const explicitPending = Array.isArray(evidence.pending) ? evidence.pending : [];
  const pending = explicitPending.length ? explicitPending : items.filter((item) => item?.status !== "confirmed");
  return {
    pending: pending.filter((item) => item?.label || item?.key),
    confirmed: items.filter((item) => item?.status === "confirmed" && (item.label || item.key)),
  };
}

function hasEvidence(items = [], terms = []) {
  return items.some((item) => {
    const text = lowerText([item.key, item.label, item.detail].filter(Boolean).join(" "));
    return terms.some((term) => text.includes(term));
  });
}

function briefItems(brief = null) {
  if (!brief || typeof brief !== "object") return [];
  return [
    brief.thesis ? { key: "thesis", ...brief.thesis } : null,
    brief.risk ? { key: "risk", ...brief.risk } : null,
    brief.nextAction ? { key: "nextAction", ...brief.nextAction } : null,
  ].filter((item) => item?.value || item?.detail);
}

function statusLabel(trace = null, evidence = null, origin = null) {
  if (evidence?.status === "ready") return "Listo";
  if (evidence?.status === "blocked") return "Bloqueado";
  if (evidence?.status === "needs-work") return "Pendiente";
  return trace?.readiness?.label || origin?.readiness?.label || "Decision";
}

function recommendedPresetKey({ pending = [], confirmed = [], evidence = null }) {
  if (evidence?.status === "ready") return "entry";
  if (hasEvidence(pending, ["setup accionable", "precio perseguible", "demanda/volumen"])) return "entry";
  if (hasEvidence(pending, ["datos fiables"])) return "decision";
  if (hasEvidence([...pending, ...confirmed], ["liderazgo global", "confluencia amplia"])) return "decision";
  return "context";
}

function activePresetKey(chartSettings = DEFAULT_CHART_SETTINGS) {
  const interval = normalizeChartInterval(chartSettings?.interval || DEFAULT_CHART_SETTINGS.interval);
  const range = chartSettings?.range || DEFAULT_CHART_SETTINGS.range;
  return DECISION_CHART_PRESETS.find((preset) => preset.range === range && preset.interval === interval)?.key || "";
}

function evidenceFocus(item = {}) {
  const text = lowerText([item.key, item.label, item.detail].filter(Boolean).join(" "));
  if (!text) return { presetKey: "decision", label: "Enfocar" };
  if (text.includes("setup") || text.includes("precio perseguible") || text.includes("pivot") || text.includes("entrada")) {
    return { presetKey: "entry", label: "Entrada", detail: "VCP, pivot y volumen en D · 3M" };
  }
  if (text.includes("demanda") || text.includes("volumen") || text.includes("ad") || text.includes("relvol")) {
    return { presetKey: "entry", label: "Demanda", detail: "Volumen y estructura en D · 3M" };
  }
  if (text.includes("liderazgo") || text.includes("confluencia") || text.includes("rs ")) {
    return { presetKey: "decision", label: "Liderazgo", detail: "RS, volumen y medias en D · 1A" };
  }
  if (text.includes("datos") || text.includes("cobertura") || text.includes("frescura")) {
    return { presetKey: "decision", label: "Datos", detail: "Marco diario para auditar cobertura y frescura" };
  }
  return { presetKey: "decision", label: "Enfocar", detail: "Vista metodologica del grafico" };
}

function evidenceChip(item = {}, fallbackTone = "") {
  const focus = evidenceFocus(item);
  return {
    key: item.key || item.label,
    label: item.label || item.key,
    detail: item.detail || item.statusLabel || "",
    tone: item.tone || fallbackTone,
    statusLabel: item.statusLabel || item.status || "",
    focusPresetKey: focus.presetKey,
    focusLabel: focus.label,
    focusDetail: focus.detail || "",
  };
}

function decisionFocus(origin = null, fallbackItem = null) {
  const sourceFocus = origin?.decisionFocus && typeof origin.decisionFocus === "object" ? origin.decisionFocus : null;
  const item = sourceFocus?.check || fallbackItem || null;
  if (!sourceFocus && !item) return null;
  const focus = evidenceFocus(item || sourceFocus);
  const label = sourceFocus?.label || item?.label || item?.key || sourceFocus?.headline || "";
  const detail = sourceFocus?.instruction || item?.detail || sourceFocus?.checkLine || sourceFocus?.risk || "";
  return {
    key: sourceFocus?.key || item?.key || label,
    label,
    detail,
    tone: sourceFocus?.tone || item?.tone || origin?.tone || "",
    state: sourceFocus?.state || "",
    stateLabel: sourceFocus?.stateLabel || "",
    filterLabel: sourceFocus?.filterLabel || "",
    resolutionFilterLabel: sourceFocus?.resolutionFilterLabel || "",
    queueFilterLabel: sourceFocus?.queueFilterLabel || "",
    ratio: sourceFocus?.ratio || "",
    headline: sourceFocus?.headline || "",
    thesis: sourceFocus?.thesis || "",
    risk: sourceFocus?.risk || "",
    checkLine: sourceFocus?.checkLine || "",
    focusPresetKey: focus.presetKey,
    focusLabel: focus.label,
    focusDetail: focus.detail || "",
  };
}

function chartReadItems({ pending, confirmed, chartSettings, showVcpDiagnostics, setupPattern, setupDisplay }) {
  const indicators = { ...DEFAULT_CHART_SETTINGS.indicators, ...(chartSettings?.indicators || {}) };
  const interval = normalizeChartInterval(chartSettings?.interval || DEFAULT_CHART_SETTINGS.interval);
  const range = chartSettings?.range || DEFAULT_CHART_SETTINGS.range;
  const allEvidence = [...pending, ...confirmed];
  const items = [];
  const needsRs = hasEvidence(allEvidence, ["liderazgo", "confluencia", "rs "]);
  const needsVolume = hasEvidence(allEvidence, ["demanda", "volumen"]);
  const needsSetup = hasEvidence(allEvidence, ["setup accionable"]);

  if (INTRADAY_INTERVALS.has(interval)) {
    items.push({ key: "interval", label: "Temporalidad", value: "D/W", detail: "Filtro validado en marco diario/semanal", tone: "warn" });
  }
  if (SHORT_RANGES.has(range)) {
    items.push({ key: "range", label: "Rango", value: "Corto", detail: "Falta contexto para base y liderazgo", tone: "warn" });
  }
  if (needsRs && !indicators.rsLine) {
    items.push({ key: "rs-line", label: "RS overlay", value: "Oculto", detail: "Liderazgo sin capa relativa visible", tone: "warn" });
  }
  if (needsVolume && !indicators.volume) {
    items.push({ key: "volume", label: "Volumen", value: "Oculto", detail: "Demanda sin volumen visible", tone: "warn" });
  }
  if (needsSetup && setupPattern && !showVcpDiagnostics) {
    items.push({ key: "vcp", label: "VCP", value: "Apagado", detail: "Pivot y contracciones fuera del grafico", tone: "warn" });
  }
  if (setupDisplay?.blocksPatternClaim || setupDisplay?.dataLimited) {
    items.push({ key: "methodology", label: "Estructura", value: "Limitada", detail: setupDisplay.reason || setupDisplay.line || "Datos tecnicos limitados", tone: "bad" });
  }

  if (!items.length) {
    items.push({ key: "aligned", label: "Lectura grafico", value: "Alineada", detail: "Marco y capas coherentes con la observacion", tone: "good" });
  }

  return items.slice(0, 5);
}

function observationChecklist({ activeFocus = null, evidence = null, pending = [], chartRead = [], sourceDetail = "" } = {}) {
  const firstPending = pending[0] || null;
  const chartFriction = chartRead.find((item) => item?.tone && item.tone !== "good") || chartRead[0] || null;
  return [
    {
      key: "method",
      label: "Criterio propio",
      value: "Obligatorio",
      detail: "Contrasta el foco con tus reglas antes de clasificar.",
      tone: "neutral",
    },
    {
      key: "focus",
      label: "Foco",
      value: activeFocus?.label || firstPending?.label || evidence?.stateLabel || "Observacion",
      detail: activeFocus?.detail || firstPending?.detail || evidence?.summary || sourceDetail || "",
      tone: activeFocus?.tone || firstPending?.tone || evidence?.tone || "neutral",
    },
    {
      key: "evidence",
      label: "Evidencia",
      value: pending.length ? `${pending.length} por validar` : evidence?.status === "ready" ? "Completa" : "Revisar",
      detail: firstPending?.detail || evidence?.summary || "No hay pruebas pendientes destacadas.",
      tone: pending.length ? "warn" : evidence?.tone || "neutral",
    },
    {
      key: "chart",
      label: "Grafico",
      value: chartFriction?.value || "Revisar",
      detail: chartFriction?.detail || "Comprueba temporalidad, volumen, RS y estructura.",
      tone: chartFriction?.tone || "neutral",
    },
  ];
}

export function buildStockDecisionDesk({
  origin = null,
  chartSettings = DEFAULT_CHART_SETTINGS,
  setupDisplay = null,
  setupPattern = null,
  technical = {},
  rsUniverse = null,
  activeBenchmark = "",
  showVcpDiagnostics = false,
} = {}) {
  const trace = origin?.decisionTrace && typeof origin.decisionTrace === "object" ? origin.decisionTrace : null;
  const brief = origin?.decisionBrief || trace?.brief || null;
  if (!origin) return null;

  const evidence = trace?.evidence || origin?.decisionEvidence || null;
  const { pending, confirmed } = evidenceItems(evidence);
  const presetKey = recommendedPresetKey({ pending, confirmed, evidence });
  const preset = DECISION_CHART_PRESETS.find((item) => item.key === presetKey) || DECISION_CHART_PRESETS[0];
  const status = statusLabel(trace, evidence, origin);
  const passed = finite(evidence?.passedCount);
  const total = finite(evidence?.totalCount);
  const ratio = passed != null && total != null ? `${passed}/${total}` : "";
  const focusItem = pending[0] || confirmed[0] || null;
  const activeFocus = decisionFocus(origin, focusItem);
  const focus = focusItem
    ? `${focusItem.label || focusItem.key}${focusItem.detail ? ` · ${focusItem.detail}` : ""}`
    : evidence?.summary || trace?.line || origin.statusText || origin.text || "";
  const chartRead = chartReadItems({ pending, confirmed, chartSettings, showVcpDiagnostics, setupPattern, setupDisplay });

  return {
    guardrail: {
      title: "Apoyo de observacion, no señal automatica",
      detail: "El screener ordena evidencias; la entrada, salida o descarte debe salir de tu metodo y revision manual.",
    },
    tone: evidence?.tone || origin?.decisionProfile?.tone || origin?.tone || "neutral",
    status,
    ratio,
    focus: activeFocus?.label ? `${activeFocus.label}${activeFocus.detail ? ` · ${activeFocus.detail}` : ""}` : focus,
    decisionFocus: activeFocus,
    sourceLabel: origin.sourceLabel || "Origen Screener",
    sourceDetail: origin.sourceDetail || "",
    profileLabel: origin.decisionProfile?.label || trace?.readiness?.label || origin?.readiness?.label || "",
    brief: briefItems(brief),
    pending: pending.slice(0, 4).map((item) => evidenceChip(item)),
    confirmed: confirmed.slice(0, 3).map((item) => evidenceChip(item, "good")),
    chartRead,
    observationChecklist: observationChecklist({ activeFocus, evidence, pending, chartRead, sourceDetail: origin.sourceDetail || "" }),
    presetKey,
    activePresetKey: activePresetKey(chartSettings),
    presetLabel: preset.label,
    presetDetail: preset.detail,
    metrics: [
      { key: "rs", label: "RS", value: finite(rsUniverse) != null ? String(Math.round(finite(rsUniverse))) : "Sin dato" },
      { key: "ma", label: "MA50/200", value: `${pctValue(technical?.distanceSma50)} / ${pctValue(technical?.distanceSma200)}` },
      { key: "bench", label: "Benchmark", value: activeBenchmark || "Auto" },
    ],
  };
}
