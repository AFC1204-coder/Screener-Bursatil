import { setupStructureForRow } from "@/lib/patternNarrative";

const VERSION = "statsedge-methodology-v1";

function finite(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = finite(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clamp(n, a = 0, b = 100) {
  return Math.max(a, Math.min(b, n));
}

function gt(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

function gte(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && a >= b;
}

function lte(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && a <= b;
}

function between(value, min, max) {
  return gte(value, min) && lte(value, max);
}

function rsValue(row = {}) {
  return firstFinite(row.rsGlobalPct, row.rsRating, row.snapshot?.rsGlobalPct, row.snapshot?.rsRating);
}

function field(row = {}, key) {
  return firstFinite(row[key], row.snapshot?.[key], row.methodology?.leadershipScores?.[key], row.methodology?.risk?.[key]);
}

function structureFor(row = {}) {
  return setupStructureForRow({ ...(row.snapshot || {}), ...row });
}

function cleanKeyPart(value = "") {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_.:,-]/g, "");
}

function normalizeKeyList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(cleanKeyPart).filter(Boolean).sort();
  if (value instanceof Set) return [...value].map(cleanKeyPart).filter(Boolean).sort();
  if (typeof value === "string") return value.split(",").map(cleanKeyPart).filter(Boolean).sort();
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, active]) => active === true || active?.active === true)
      .map(([key]) => cleanKeyPart(key))
      .filter(Boolean)
      .sort();
  }
  return [cleanKeyPart(value)].filter(Boolean);
}

export function snapshotCompatibilityKey(context = {}) {
  const settings = context.settings || {};
  const activeSettings = context.activeSettings || settings;
  const preset = cleanKeyPart(context.preset || context.presetKey || settings.preset || "manual");
  const markets = normalizeKeyList(context.markets || settings.markets || context.market || settings.market);
  const scanMode = cleanKeyPart(context.scanMode || settings.scanMode || "manual");
  const setupMode = cleanKeyPart(activeSettings.setupMode || settings.setupMode || "");
  const filterLayers = normalizeKeyList(context.filterLayers || settings.filterLayers);
  const fieldRules = normalizeKeyList(context.fieldRules || settings.fieldRules);
  const universeKey = cleanKeyPart(context.universeKey || settings.universeKey || "");
  return [
    `methodology:${VERSION}`,
    `preset:${preset || "manual"}`,
    `markets:${markets.join(",") || "manual"}`,
    `mode:${scanMode || "manual"}`,
    `setup:${setupMode || "default"}`,
    `filters:${filterLayers.join(",") || "default"}`,
    `fields:${fieldRules.join(",") || "default"}`,
    universeKey ? `universe:${universeKey}` : "",
  ].filter(Boolean).join("|");
}

export function scanCompatibilityKey(scan = {}) {
  return scan.snapshotCompatibilityKey || scan.settings?.snapshotCompatibilityKey || null;
}

export function findCompatiblePreviousScan(scans = [], context = {}) {
  const key = snapshotCompatibilityKey(context);
  return (scans || []).find((scan) => scanCompatibilityKey(scan) === key && Array.isArray(scan.rows) && scan.rows.length) || null;
}

export function stageStateForRow(row = {}) {
  if (row.weeklyStageState || row.weeklyStage?.state) {
    const key = row.weeklyStageState || row.weeklyStage?.state;
    const label = row.weeklyStageLabel || row.weeklyStage?.label || "Stage semanal";
    const detail = row.weeklyStage?.detail || `Clasificacion semanal con medias ${row.weeklyFastWeeks || row.weeklyStage?.fastWeeks || "-"}W/${row.weeklySlowWeeks || row.weeklyStage?.slowWeeks || "-"}W.`;
    return { key, label, detail };
  }
  const price = field(row, "price");
  const sma50 = field(row, "sma50");
  const sma150 = field(row, "sma150");
  const sma200 = field(row, "sma200");
  const sma200Slope = field(row, "sma200Slope");
  const bars = field(row, "chartBarsCount");
  if ((Number.isFinite(bars) && bars < 180) || !Number.isFinite(price) || !Number.isFinite(sma200)) {
    return { key: "insufficient_history", label: "Historico insuficiente", detail: "No hay suficiente precio/medias para clasificar etapa." };
  }
  if (gt(price, sma50) && gt(price, sma150) && gt(price, sma200) && gt(sma50, sma150) && gt(sma150, sma200) && gt(sma200Slope, 0)) {
    return { key: "stage2", label: "Stage 2 probable", detail: "Precio y medias 50/150/200 alineadas con SMA200 ascendente." };
  }
  if (gt(price, sma200) && !gt(sma200Slope, 0)) {
    return { key: "base", label: "Base / transicion", detail: "Precio sobre SMA200, pero tendencia larga aun no confirma." };
  }
  if (gt(price, sma200) || gt(price, sma50)) {
    return { key: "mixed", label: "Mixta / vigilancia", detail: "Estructura parcial sin confirmacion completa." };
  }
  if (!gt(price, sma200) && !gt(sma200Slope, 0)) {
    return { key: "stage4", label: "Stage 4 probable", detail: "Precio bajo SMA200 con tendencia larga deteriorada." };
  }
  return { key: "mixed", label: "Mixta / vigilancia", detail: "La evidencia de medias es incompleta o contradictoria." };
}

export function setupTagsForRow(row = {}) {
  const stage = stageStateForRow(row).key;
  const tags = [];
  const distance20d = field(row, "distance20d");
  const distance52w = field(row, "distance52w");
  const extSma50 = field(row, "extSma50");
  const highsSpreadPct = field(row, "highsSpreadPct");
  const momentumScore = field(row, "momentumScore");
  const perf3m = field(row, "perf3m");
  const perf6m = field(row, "perf6m");
  const price = field(row, "price");
  const sma200 = field(row, "sma200");
  const upDownVolRatio = field(row, "upDownVolRatio");
  const distanceToPivotPct = field(row, "distanceToPivotPct");
  const breakoutQualityScore = field(row, "breakoutQualityScore");
  const baseDepthPct = field(row, "baseDepthPct");
  const volumeDryUpRatio = field(row, "volumeDryUpRatio");
  const structure = structureFor(row);

  if (stage === "stage2") tags.push({ key: "stage2_confirmed", label: "Stage 2" });
  if (gte(distance20d, -5) && gte(distance52w, -15) && lte(extSma50, 15) && lte(highsSpreadPct, 10)) tags.push({ key: "near_pivot", label: "Near pivot" });
  if (Number.isFinite(distanceToPivotPct) && between(distanceToPivotPct, -5, 3)) tags.push({ key: "pivot_zone", label: "Zona de pivote" });
  if (structure.key === "vcp_strict") tags.push({ key: "vcp_strict", label: "VCP estricto" });
  else if (structure.key === "vcp_watch") tags.push({ key: "vcp_watch", label: "VCP vigilancia" });
  else if (structure.key === "pivot_squeeze") tags.push({ key: "pivot_squeeze", label: "Compresion pivot" });
  else if (structure.key === "constructive_base") tags.push({ key: "constructive_base", label: "Base constructiva" });
  if (Number.isFinite(row.patternQualityScore ?? row.snapshot?.patternQualityScore) && (row.patternQualityScore ?? row.snapshot?.patternQualityScore) >= 65) tags.push({ key: "pattern_quality", label: "Estructura definida" });
  if ((row.breakoutAttempt || row.snapshot?.breakoutAttempt) && gte(breakoutQualityScore, 55)) tags.push({ key: "breakout_quality", label: "Breakout con calidad" });
  if (Number.isFinite(volumeDryUpRatio) && volumeDryUpRatio <= .85 && lte(baseDepthPct, 35)) tags.push({ key: "volume_dry_up", label: "Volumen seco" });
  if (row.failedBreakout || row.snapshot?.failedBreakout) tags.push({ key: "failed_breakout", label: "Fallo breakout" });
  if (gt(price, sma200) && between(extSma50, -4, 9) && gte(distance52w, -30)) tags.push({ key: "pullback_sma50", label: "Pullback SMA50" });
  if (gte(extSma50, 18) && gte(momentumScore, 65) && gte(rsValue(row), 75)) tags.push({ key: "extended_strong", label: "Extendida fuerte" });
  if (gt(price, sma200) && stage !== "stage2" && gte(distance52w, -35) && gte(perf3m, 5) && gte(perf6m, 8)) tags.push({ key: "early_stage2", label: "Etapa 2 temprana" });
  if (gte(distance20d, -8) && Number.isFinite(upDownVolRatio) && upDownVolRatio < 0.8) tags.push({ key: "supply_pressure", label: "Presion de oferta" });
  if (!tags.length) tags.push({ key: "no_clear_setup", label: "Setup no claro" });
  return tags;
}

export function riskStateForRow(row = {}) {
  const volatility63d = field(row, "volatility63d");
  const maxDrawdown63d = field(row, "maxDrawdown63d");
  const returnToVol3m = field(row, "returnToVol3m");
  const returnToDrawdown3m = field(row, "returnToDrawdown3m");
  const extSma50 = field(row, "extSma50");
  const flags = [];

  if (gte(returnToVol3m, 0.8) && gte(returnToDrawdown3m, 1.5) && lte(maxDrawdown63d, 18)) flags.push({ key: "efficient_leadership", label: "Liderazgo eficiente" });
  if (gt(volatility63d, 70)) flags.push({ key: "high_volatility", label: "Volatilidad elevada" });
  if (gt(maxDrawdown63d, 32)) flags.push({ key: "drawdown_expanding", label: "Drawdown elevado" });
  if (gt(extSma50, 30)) flags.push({ key: "extended_risk", label: "Extension elevada" });
  if (!flags.length) flags.push({ key: "controlled", label: "Riesgo controlado/mixto" });

  return {
    flags,
    volatility63d,
    maxDrawdown63d,
    returnToVol3m,
    returnToDrawdown3m,
    score: field(row, "riskRewardScore"),
  };
}

export function dataQualityForRow(row = {}) {
  const technical = field(row, "technicalCoverageScore");
  const fundamental = field(row, "fundamentalCoverageScore");
  const total = field(row, "dataCoverageScore");
  const issues = row.dataCoverageIssues || row.snapshot?.dataCoverageIssues || [];
  const label = total >= 80 ? "ok" : total >= 60 ? "partial" : total >= 35 ? "limited" : "insufficient";
  return {
    label,
    total,
    technical,
    fundamental,
    issues,
  };
}

export function buildMethodologySnapshot(row = {}) {
  const stageState = stageStateForRow(row);
  const setupTags = setupTagsForRow(row);
  const risk = riskStateForRow(row);
  const dataQuality = dataQualityForRow(row);
  return {
    version: VERSION,
    stageState,
    setupTags,
    leadershipScores: {
      rsGlobal: rsValue(row),
      rsCountry: field(row, "rsCountryPct"),
      rsSector: field(row, "rsSectorPct"),
      groupStrength: field(row, "sectorScore"),
      totalScore: field(row, "totalScore"),
      weinsteinScore: field(row, "weinsteinScore"),
      minerviniScore: field(row, "minerviniScore"),
    },
    risk,
    dataQuality,
  };
}

function event(type, severity, label, detail, metric = "", current = null, previous = null) {
  return { type, severity, label, detail, metric, current, previous };
}

export function methodologyEvents(row = {}, previous = null) {
  const events = [];
  const currentMethodology = row.methodology || buildMethodologySnapshot(row);
  const previousMethodology = previous?.methodology || (previous ? buildMethodologySnapshot(previous) : null);
  const rs = rsValue(row);
  const prevRs = previous ? rsValue(previous) : null;
  const total = field(row, "totalScore");
  const prevTotal = previous ? field(previous, "totalScore") : null;
  const weakness = field(row, "weaknessScore");
  const prevWeakness = previous ? field(previous, "weaknessScore") : null;
  const sector = field(row, "sectorScore");
  const prevSector = previous ? field(previous, "sectorScore") : null;
  const price = field(row, "price");
  const sma50 = field(row, "sma50");
  const sma200 = field(row, "sma200");
  const prevPrice = previous ? field(previous, "price") : null;
  const prevSma50 = previous ? field(previous, "sma50") : null;
  const prevSma200 = previous ? field(previous, "sma200") : null;
  const relVol = field(row, "relativeVolume");
  const breakoutQualityScore = field(row, "breakoutQualityScore");
  const distanceToPivotPct = field(row, "distanceToPivotPct");
  const vcpCandidate = Boolean(row.vcpCandidate || row.snapshot?.vcpCandidate);
  const prevVcpCandidate = Boolean(previous?.vcpCandidate || previous?.snapshot?.vcpCandidate);
  const structure = structureFor(row);
  const prevStructure = previous ? structureFor(previous) : null;
  const breakoutAttempt = Boolean(row.breakoutAttempt || row.snapshot?.breakoutAttempt);
  const prevBreakoutAttempt = Boolean(previous?.breakoutAttempt || previous?.snapshot?.breakoutAttempt);
  const failedBreakout = Boolean(row.failedBreakout || row.snapshot?.failedBreakout);
  const prevFailedBreakout = Boolean(previous?.failedBreakout || previous?.snapshot?.failedBreakout);

  if (!previous) {
    if (currentMethodology.stageState.key === "stage2") events.push(event("stage2_observed", "positive", "Stage 2 observado", currentMethodology.stageState.detail));
    if (structure.key === "vcp_strict") events.push(event("vcp_strict", "neutral", "VCP estricto observado", structure.reason, "setupStructure", structure.key));
    else if (structure.key === "vcp_watch" || vcpCandidate) events.push(event("vcp_watch", "neutral", "VCP en vigilancia", structure.reason || "Base con contracciones decrecientes y volumen seco parcial.", "setupStructure", structure.key));
    if (breakoutAttempt && gte(breakoutQualityScore, 60)) events.push(event("breakout_attempt", "positive", "Breakout observado", "Precio sobre zona de pivote con volumen relativo elevado.", "breakoutQualityScore", breakoutQualityScore));
    if (failedBreakout) events.push(event("failed_breakout", "warning", "Fallo de breakout", "El precio ha perdido la zona de pivote tras haberla superado recientemente.", "distanceToPivotPct", distanceToPivotPct));
    if (rs >= 80) events.push(event("rs_leader", "positive", "RS lider", "Percentil/fuerza relativa alta dentro del universo analizado.", "rs", rs));
    if (weakness >= 65) events.push(event("deterioration_observed", "warning", "Deterioro observado", "La fila presenta varias evidencias de debilidad.", "weaknessScore", weakness));
    return events;
  }

  if (Number.isFinite(rs) && Number.isFinite(prevRs)) {
    const delta = rs - prevRs;
    if (delta >= 5) events.push(event("rs_improves", "positive", "RS mejora", `RS sube ${delta.toFixed(0)} puntos desde el snapshot anterior.`, "rs", rs, prevRs));
    if (delta <= -8) events.push(event("rs_weakens", "warning", "RS empeora", `RS cae ${Math.abs(delta).toFixed(0)} puntos desde el snapshot anterior.`, "rs", rs, prevRs));
  }
  if (Number.isFinite(total) && Number.isFinite(prevTotal)) {
    const delta = total - prevTotal;
    if (delta >= 8) events.push(event("score_improves", "positive", "Composite mejora", `Composite sube ${delta.toFixed(0)} puntos.`, "totalScore", total, prevTotal));
    if (delta <= -8) events.push(event("score_deteriorates", "warning", "Composite se deteriora", `Composite cae ${Math.abs(delta).toFixed(0)} puntos.`, "totalScore", total, prevTotal));
  }
  if (Number.isFinite(weakness) && Number.isFinite(prevWeakness) && weakness - prevWeakness >= 10) {
    events.push(event("deterioration_increases", "warning", "Deterioro aumenta", `Deterioro sube ${(weakness - prevWeakness).toFixed(0)} puntos.`, "weaknessScore", weakness, prevWeakness));
  }
  if (Number.isFinite(sector) && Number.isFinite(prevSector)) {
    const delta = sector - prevSector;
    if (delta >= 8) events.push(event("sector_rank_improves", "positive", "Grupo mejora", `Fuerza de grupo sube ${delta.toFixed(0)} puntos.`, "sectorScore", sector, prevSector));
    if (delta <= -8) events.push(event("sector_rank_weakens", "warning", "Grupo empeora", `Fuerza de grupo cae ${Math.abs(delta).toFixed(0)} puntos.`, "sectorScore", sector, prevSector));
  }
  if (previousMethodology && currentMethodology.stageState.key !== previousMethodology.stageState.key) {
    events.push(event("stage_changes", currentMethodology.stageState.key === "stage2" ? "positive" : "neutral", "Cambio de etapa", `${previousMethodology.stageState.label} -> ${currentMethodology.stageState.label}.`, "stageState", currentMethodology.stageState.key, previousMethodology.stageState.key));
  }
  if (structure.key !== prevStructure?.key && structure.key === "vcp_strict") events.push(event("vcp_strict", "neutral", "Pasa a VCP estricto", structure.reason, "setupStructure", structure.key, prevStructure?.key));
  else if (structure.key !== prevStructure?.key && structure.key === "vcp_watch") events.push(event("vcp_watch", "neutral", "Pasa a VCP vigilancia", structure.reason, "setupStructure", structure.key, prevStructure?.key));
  else if (vcpCandidate && !prevVcpCandidate) events.push(event("vcp_watch", "neutral", "VCP en vigilancia", "Aparece una base con contracciones decrecientes y volumen seco.", "vcpCandidate", true, false));
  if (breakoutAttempt && !prevBreakoutAttempt && gte(breakoutQualityScore, 60)) events.push(event("breakout_attempt", "positive", "Breakout observado", "Precio sobre zona de pivote con volumen relativo elevado.", "breakoutQualityScore", breakoutQualityScore));
  if (failedBreakout && !prevFailedBreakout) events.push(event("failed_breakout", "warning", "Fallo de breakout", "El precio pierde la zona de pivote tras haberla superado recientemente.", "distanceToPivotPct", distanceToPivotPct));
  if (gt(price, sma50) && Number.isFinite(prevPrice) && Number.isFinite(prevSma50) && prevPrice <= prevSma50) events.push(event("price_reclaims_sma50", "positive", "Recupera SMA50", "El precio vuelve a estar por encima de SMA50.", "price_vs_sma50", price, prevPrice));
  if (Number.isFinite(price) && Number.isFinite(sma50) && price < sma50 && gt(prevPrice, prevSma50)) events.push(event("price_loses_sma50", "warning", "Pierde SMA50", "El precio pasa a estar bajo SMA50.", "price_vs_sma50", price, prevPrice));
  if (Number.isFinite(price) && Number.isFinite(sma200) && price < sma200 && gt(prevPrice, prevSma200)) events.push(event("price_loses_sma200", "warning", "Pierde SMA200", "El precio pasa a estar bajo SMA200.", "price_vs_sma200", price, prevPrice));
  if (gte(relVol, 1.8)) events.push(event("relative_volume_spikes", "neutral", "Volumen relativo alto", "Actividad reciente por encima de la media 20d.", "relativeVolume", relVol));

  return events.slice(0, 8);
}

export function enrichRowsWithMethodology(rows = [], previousRows = []) {
  const previousBySymbol = new Map((previousRows || []).map((row) => [String(row.symbol || "").toUpperCase(), row]));
  return (rows || []).map((row) => {
    const key = String(row.symbol || "").toUpperCase();
    const methodology = buildMethodologySnapshot(row);
    const withMethodology = { ...row, methodology };
    const events = methodologyEvents(withMethodology, previousBySymbol.get(key));
    return {
      ...withMethodology,
      methodologyEvents: events,
      methodologyEventCount: events.length,
      methodologyTags: methodology.setupTags.map((tag) => tag.label),
      stageState: methodology.stageState.key,
      stageLabel: methodology.stageState.label,
      riskState: riskLabel(methodology.risk),
      dataQualityState: methodology.dataQuality.label,
    };
  });
}

function riskLabel(risk = {}) {
  return risk.flags?.[0]?.label || "Sin dato";
}

export function summarizeMethodology(rows = [], previousScan = null) {
  const counts = {};
  const severities = { positive: 0, warning: 0, neutral: 0 };
  const rowsWithEvents = [];
  for (const row of rows || []) {
    for (const item of row.methodologyEvents || []) {
      counts[item.type] = (counts[item.type] || 0) + 1;
      severities[item.severity] = (severities[item.severity] || 0) + 1;
    }
    if (row.methodologyEvents?.length) rowsWithEvents.push({
      symbol: row.symbol,
      companyName: row.companyName,
      events: row.methodologyEvents.slice(0, 4),
    });
  }
  const stageCounts = rows.reduce((map, row) => {
    const key = row.methodology?.stageState?.key || row.stageState || "unknown";
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  const tagCounts = rows.reduce((map, row) => {
    for (const tag of row.methodology?.setupTags || []) map[tag.key] = (map[tag.key] || 0) + 1;
    return map;
  }, {});
  return {
    version: VERSION,
    previousScanId: previousScan?.id || null,
    previousScanDate: previousScan?.createdAt || null,
    totalRows: rows.length,
    eventCounts: counts,
    severityCounts: severities,
    stageCounts,
    tagCounts,
    rowsWithEvents: rowsWithEvents.slice(0, 20),
    generatedAt: new Date().toISOString(),
  };
}

export function checklistForRow(row = {}) {
  const methodology = row.methodology || row.snapshot?.methodology || buildMethodologySnapshot(row.snapshot || row);
  const scores = methodology.leadershipScores || {};
  const risk = methodology.risk || {};
  const quality = methodology.dataQuality || {};
  const events = row.methodologyEvents || row.snapshot?.methodologyEvents || [];
  return [
    {
      key: "market_context",
      label: "Contexto",
      status: row.marketRegime || row.snapshot?.marketRegime || "sin dato",
      detail: "Usar como contexto, no como recomendacion.",
    },
    {
      key: "stage",
      label: "Etapa",
      status: methodology.stageState?.label || "Sin dato",
      detail: methodology.stageState?.detail || "",
    },
    {
      key: "setup",
      label: "Setup",
      status: methodology.setupTags?.map((tag) => tag.label).join(", ") || "Sin dato",
      detail: "Etiquetas objetivas de proximidad, pullback, extension o presion.",
    },
    {
      key: "leadership",
      label: "Liderazgo",
      status: Number.isFinite(scores.rsGlobal) ? `RS ${Math.round(scores.rsGlobal)}` : "Sin dato",
      detail: `Grupo ${Number.isFinite(scores.groupStrength) ? Math.round(scores.groupStrength) : "-"} · W ${Number.isFinite(scores.weinsteinScore) ? Math.round(scores.weinsteinScore) : "-"}`,
    },
    {
      key: "risk",
      label: "Riesgo",
      status: riskLabel(risk),
      detail: `Vol ${Number.isFinite(risk.volatility63d) ? Math.round(risk.volatility63d) : "-"} · DD ${Number.isFinite(risk.maxDrawdown63d) ? Math.round(risk.maxDrawdown63d) : "-"}`,
    },
    {
      key: "deltas",
      label: "Cambios",
      status: events.length ? `${events.length} evento(s)` : "Sin cambio registrado",
      detail: events.slice(0, 2).map((item) => item.label).join(" · ") || "Requiere snapshot previo comparable.",
    },
    {
      key: "data_quality",
      label: "Datos",
      status: quality.label || "Sin dato",
      detail: `Cobertura ${Number.isFinite(quality.total) ? Math.round(quality.total) : "-"} · tecnica ${Number.isFinite(quality.technical) ? Math.round(quality.technical) : "-"}`,
    },
  ];
}

export function compactMethodologySnapshot(row = {}) {
  const methodology = row.methodology || buildMethodologySnapshot(row);
  return {
    methodology,
    methodologyEvents: row.methodologyEvents || methodologyEvents({ ...row, methodology }),
    stageState: methodology.stageState.key,
    stageLabel: methodology.stageState.label,
    methodologyTags: methodology.setupTags.map((tag) => tag.label),
    riskState: riskLabel(methodology.risk),
    dataQualityState: methodology.dataQuality.label,
  };
}
