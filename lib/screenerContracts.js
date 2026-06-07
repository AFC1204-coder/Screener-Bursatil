const CONTRACTS = {
  long: {
    tone: "bullish",
    label: "Contrato largo",
    title: "Líderes con sesgo largo",
    text: "Resultados orientados a oportunidad larga: tendencia, momentum, fuerza relativa y cobertura deben sostener el filtro activo.",
    okText: "Coherencia larga activa: el modo actual no mezcla deterioro con listas de oportunidad.",
  },
  watch: {
    tone: "watch",
    label: "Vigilancia",
    title: "Candidato fuerte, timing pendiente",
    text: "Resultados para seguimiento: la acción puede ser fuerte, cercana a pivot, pullback, IPO o extendida; no implica plan automático.",
    okText: "Coherencia de vigilancia activa: el resultado queda separado de una lista de largos ejecutables.",
  },
  bearish: {
    tone: "bearish",
    label: "Deterioro",
    title: "Debilidad técnica",
    text: "Resultados defensivos o bajistas: este contrato no es una lista de largos y debe quedar separado de líderes.",
    okText: "Coherencia de deterioro activa: la salida queda etiquetada como debilidad, no como oportunidad larga.",
  },
  exploratory: {
    tone: "exploratory",
    label: "Exploratorio",
    title: "Diagnóstico amplio",
    text: "Resultados para exploración y auditoría: pueden aparecer estructuras mixtas; no deben leerse como Minervini, leaders o largos limpios.",
    okText: "Coherencia exploratoria activa: la salida queda marcada como diagnóstico, no como lista operativa.",
  },
};

const WATCH_MODES = new Set(["nearPivot", "pullback", "early", "ipoRecent", "extended"]);
const LAYER_LABELS = {
  trend: "Trend",
  momentum: "Momentum",
  relativeStrength: "RS",
  proximity: "Proximidad",
  coverage: "Cobertura",
  regime: "Regimen",
};

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ratioLabel(active, total) {
  const activeNumber = finiteNumber(active);
  const totalNumber = finiteNumber(total);
  if (!Number.isFinite(activeNumber) || !Number.isFinite(totalNumber) || totalNumber <= 0) return "-";
  return `${Math.round(activeNumber)}/${Math.round(totalNumber)}`;
}

function countLabel(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString("es-ES") : "-";
}

function cleanSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

function contractStatValue(contract = {}, key = "") {
  return (contract.stats || []).find((stat) => stat.key === key)?.value || "";
}

function compactScore(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) ? String(Math.round(number)) : "-";
}

function layerWarnings(filterLayers = {}, required = []) {
  const hasLayerShape = filterLayers && Object.keys(filterLayers).length > 0;
  if (!hasLayerShape) return [];
  return required
    .filter((key) => filterLayers[key] === false)
    .map((key) => LAYER_LABELS[key] || key);
}

function sampleStats(diagnostics = null, analyzedCount = 0) {
  const analyzed = finiteNumber(diagnostics?.analyzed) ?? finiteNumber(analyzedCount) ?? 0;
  const universe = finiteNumber(diagnostics?.universeTotal) ?? analyzed;
  const sampleRate = universe > 0 ? (analyzed / universe) * 100 : null;
  return { analyzed, universe, sampleRate };
}

export function screenerContractKeyForSettings(settings = {}, presetKey = "") {
  const mode = String(settings?.setupMode || "").trim();
  const preset = String(presetKey || "").trim();
  if (mode === "weakness" || preset === "weakness") return "bearish";
  if (mode === "any" || preset === "broad") return "exploratory";
  if (WATCH_MODES.has(mode)) return "watch";
  return "long";
}

export function isScreenerLongContract(settings = {}, presetKey = "") {
  return screenerContractKeyForSettings(settings, presetKey) === "long";
}

export function buildScreenerContract({
  settings = {},
  presetKey = "balanced",
  presetName = "Filtro",
  setupName = "Exploratorio",
  filterLayers = {},
  useRegimeFilter = true,
  executionRuleActive = null,
  executionRuleTotal = null,
  fineRuleActive = null,
  fineRuleTotal = null,
  rowsCount = 0,
  filteredCount = 0,
  analyzedCount = 0,
  diagnostics = null,
  pendingCount = 0,
  hiddenByView = 0,
  viewFiltersActive = 0,
} = {}) {
  const key = screenerContractKeyForSettings(settings, presetKey);
  const base = CONTRACTS[key] || CONTRACTS.exploratory;
  const warnings = [];
  const requiredLayers = key === "long"
    ? ["trend", "momentum", "relativeStrength", "coverage"]
    : key === "watch"
      ? ["momentum", "proximity", "coverage"]
      : [];
  const missingLayers = layerWarnings(filterLayers, requiredLayers);
  if (missingLayers.length) {
    warnings.push({
      key: "layers",
      text: `${base.label} degradado: ${missingLayers.join(", ")} off.`,
    });
  }
  if ((key === "long" || key === "watch") && useRegimeFilter === false) {
    warnings.push({ key: "regime", text: "Regimen off: los resultados no se adaptan a salud de mercado." });
  }
  if (finiteNumber(pendingCount) > 0) {
    warnings.push({ key: "pending", text: `${countLabel(pendingCount)} resultados pendientes sin mostrar.` });
  }
  if (finiteNumber(hiddenByView) > 0) {
    warnings.push({ key: "view", text: `${countLabel(hiddenByView)} acciones ocultas por filtros de vista.` });
  }
  const { analyzed, universe, sampleRate } = sampleStats(diagnostics, analyzedCount);
  if (Number.isFinite(sampleRate) && universe > analyzed && sampleRate < 25) {
    warnings.push({ key: "sample", text: `Muestra parcial: ${countLabel(analyzed)} de ${countLabel(universe)} acciones analizadas.` });
  }

  const stats = [
    { key: "preset", label: "base", value: presetName },
    { key: "setup", label: "modo", value: setupName },
    { key: "rules", label: "reglas", value: ratioLabel(executionRuleActive, executionRuleTotal) },
    { key: "fine", label: "finas", value: ratioLabel(fineRuleActive, fineRuleTotal) },
    { key: "results", label: "visibles", value: hiddenByView > 0 ? `${countLabel(filteredCount)}/${countLabel(rowsCount)}` : countLabel(filteredCount) },
    { key: "scope", label: "muestra", value: universe > analyzed ? `${countLabel(analyzed)}/${countLabel(universe)}` : countLabel(analyzed) },
    { key: "view", label: "vista", value: viewFiltersActive > 0 ? `${countLabel(viewFiltersActive)} activo` : "limpia" },
    { key: "regime", label: "regimen", value: useRegimeFilter ? "on" : "off" },
  ];

  return {
    ...base,
    key,
    presetKey,
    mode: settings?.setupMode || "leader",
    presetName,
    setupName,
    warnings,
    stats,
    sampleRate,
  };
}

export function buildScreenerStockContext(contract = null, {
  symbol = "",
  row = null,
  rank = null,
  queueSize = null,
  sourceLabel = "Screener",
  openedAt = "",
} = {}) {
  if (!contract) return null;
  const warnings = Array.isArray(contract.warnings) ? contract.warnings.slice(0, 3) : [];
  const statusText = warnings.length ? warnings.map((warning) => warning.text).join(" ") : (contract.okText || contract.text || "");
  const resolvedSymbol = cleanSymbol(symbol || row?.symbol);
  const score = finiteNumber(row?.totalScore ?? row?.compositeScore);
  const rs = finiteNumber(row?.rsGlobalPct);
  const weakness = finiteNumber(row?.weaknessScore);
  return {
    source: "screener",
    sourceLabel,
    symbol: resolvedSymbol,
    openedAt: openedAt || new Date().toISOString(),
    key: contract.key || "exploratory",
    tone: contract.tone || "exploratory",
    label: contract.label || "Screener",
    title: contract.title || "Contexto Screener",
    text: contract.text || "",
    okText: contract.okText || "",
    statusText,
    statusTone: warnings.length ? "warn" : "ok",
    presetName: contract.presetName || contractStatValue(contract, "preset") || "Filtro",
    setupName: contract.setupName || contractStatValue(contract, "setup") || "Modo",
    mode: contract.mode || "",
    rank: finiteNumber(rank),
    queueSize: finiteNumber(queueSize),
    row: {
      score: compactScore(score),
      rs: compactScore(rs),
      weakness: compactScore(weakness),
    },
    warnings,
  };
}

export function screenerStockContextFromSession(session = {}, symbol = "", { now = Date.now(), maxAgeMs = 12 * 60 * 60 * 1000 } = {}) {
  const context = session?.lastOpenedStockContext;
  if (!context) return null;
  const targetSymbol = cleanSymbol(symbol);
  const contextSymbol = cleanSymbol(context.symbol || session.lastOpenedStockSymbol);
  if (!targetSymbol || !contextSymbol || targetSymbol !== contextSymbol) return null;
  const openedAt = context.openedAt || session.lastOpenedStockAt || "";
  const openedTs = Date.parse(openedAt);
  if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && Number.isFinite(openedTs) && Number.isFinite(now) && now - openedTs > maxAgeMs) return null;
  return { ...context, openedAt };
}
