function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function pct(value) {
  const n = finite(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "sin dato";
}

function signedPct(value) {
  const n = finite(value);
  if (!Number.isFinite(n)) return "sin dato";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function ratio(value) {
  const n = finite(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}x` : "sin dato";
}

function dataStatusLabel(status = "") {
  const map = {
    ok: "Datos técnicos OK",
    partial_volume: "Volumen parcial",
    insufficient_history: "Histórico insuficiente",
    missing_latest_date: "Fecha no disponible",
    stale_price: "Precio no reciente",
    sparse_ohlc: "OHLC incompleto",
    missing_volume: "Volumen no fiable",
    "sin dato": "Datos sin validar",
  };
  return map[String(status || "").trim()] || "Datos sin validar";
}

function technicalConfidenceForPattern(row = {}) {
  const status = String(row.patternDataStatus || "").trim();
  const statusLabel = dataStatusLabel(status || "sin dato");
  const hardBlocked = row.patternEligible === false || [
    "insufficient_history",
    "missing_latest_date",
    "stale_price",
    "sparse_ohlc",
  ].includes(status);

  if (hardBlocked) {
    return {
      key: "blocked",
      label: "Dato no usable",
      shortLabel: "No usable",
      detail: statusLabel,
      state: "fail",
      tone: "muted",
      observable: false,
      blocksAction: true,
    };
  }

  if (status === "partial_volume" || status === "missing_volume") {
    return {
      key: "partial",
      label: "Dato parcial",
      shortLabel: "Parcial",
      detail: "Volumen incompleto: la estructura se puede observar, pero no habilita plan automático.",
      state: "warn",
      tone: "warn",
      observable: true,
      blocksAction: true,
    };
  }

  if (status === "ok") {
    return {
      key: "ok",
      label: "Dato usable",
      shortLabel: "OK",
      detail: "OHLCV suficiente para validar la metodología técnica.",
      state: "pass",
      tone: "good",
      observable: true,
      blocksAction: false,
    };
  }

  return {
    key: "unknown",
    label: "Dato sin validar",
    shortLabel: "Sin validar",
    detail: statusLabel,
    state: "warn",
    tone: "warn",
    observable: true,
    blocksAction: true,
  };
}

function rawContractionDepths(row = {}) {
  return (Array.isArray(row.contractionDepths) ? row.contractionDepths : [])
    .map(finite)
    .filter(Number.isFinite);
}

function contractionDepths(row = {}) {
  const depths = rawContractionDepths(row);
  const status = String(row.contractionStructureStatus || "");
  if (!depths.length) return depths;
  if (status === "depth_reexpansion" || row.contractionsDecreasing === false) {
    for (let index = 1; index < depths.length; index++) {
      const current = depths[index];
      const previous = depths[index - 1];
      const usefulReduction = current <= previous * 0.98 || current <= previous - 0.5;
      if (!usefulReduction) return depths.slice(0, index);
    }
  }
  if (["pivot_noise", "ceiling_break", "lower_low_drift", "depth_reexpansion"].includes(status) && depths.length > 1) return depths.slice(0, -1);
  return depths;
}

function contractionStructureRejectReason(row = {}) {
  switch (String(row.contractionStructureStatus || "")) {
    case "lower_low_drift":
      return "mínimos no sostienen la base";
    case "ceiling_break":
      return "techo de base inestable";
    case "pivot_noise":
      return "pivots demasiado cercanos";
    case "depth_reexpansion":
      return "última contracción se re-expande";
    default:
      return "";
  }
}

function strictVcpRejectReason(row = {}) {
  const rawDepths = rawContractionDepths(row);
  const depths = contractionDepths(row);
  const count = finite(row.contractionCount) ?? rawDepths.length;
  const quality = finite(row.patternQualityScore);
  const c1 = finite(row.contraction1DepthPct) ?? depths[0];
  const c2 = finite(row.contraction2DepthPct) ?? depths[1];
  const c3 = finite(row.contraction3DepthPct) ?? depths[2];
  const last = finite(row.lastContractionDepthPct) ?? depths.at(-1);
  const base = finite(row.baseDepthPct);
  const distanceToPivot = finite(row.distanceToPivotPct);
  const pivotPrice = finite(row.pivotPrice);
  const absPivot = finite(row.absDistanceToPivotPct) ?? Math.abs(distanceToPivot ?? NaN);
  const pivotClarity = finite(row.pivotClarityScore);
  const pivotTouchCount = finite(row.pivotTouchCount);
  const baseNearPivotDays = finite(row.baseNearPivotDays);
  const baseContextScore = finite(row.baseContextScore);
  const latestCloseLocation = finite(row.latestCloseLocationPct);
  const volumeDry = finite(row.volumeDryUpRatio);
  const tight10 = finite(row.tightness10dPct);

  if (row.patternEligible === false || (row.patternDataStatus && row.patternDataStatus !== "ok" && row.patternDataStatus !== "partial_volume")) return dataStatusLabel(row.patternDataStatus);
  if (row.consolidationCandidate === false || row.patternFamily === "trend_no_base") return row.baseContextStatus === "persistent_advance" ? "subida persistente sin base clara" : "base reciente no confirmada";
  const structureReason = contractionStructureRejectReason(row);
  if (structureReason) return structureReason;
  if (!Number.isFinite(pivotPrice) && !Number.isFinite(distanceToPivot)) return "pivot técnico sin dato";
  if (count < 3) {
    const label = Number.isFinite(count) && count === 1 ? "1 contracción útil" : `${Number.isFinite(count) ? count.toFixed(0) : 0} contracciones útiles`;
    return label;
  }
  if (row.contractionsDecreasing !== true) {
    if (rawDepths.length >= 2 && rawDepths.at(-1) > rawDepths.at(-2)) return "última contracción se re-expande";
    return "contracciones no decrecientes";
  }
  if (Number.isFinite(quality) && quality < 65) return `calidad ${quality.toFixed(0)} < 65`;
  if (Number.isFinite(baseContextScore) && baseContextScore < 45) return `contexto de base ${baseContextScore.toFixed(0)} < 45`;
  if (Number.isFinite(pivotClarity) && pivotClarity < 55) return `claridad de pivot ${pivotClarity.toFixed(0)} < 55`;
  if (Number.isFinite(pivotTouchCount) && pivotTouchCount < 2 && Number.isFinite(baseNearPivotDays) && baseNearPivotDays < 8) return "pivot con pocos toques confirmados";
  if (Number.isFinite(c1) && c1 > 25) return `C1 ${pct(c1)} > 25%`;
  if (Number.isFinite(c2) && c2 > 16) return `C2 ${pct(c2)} > 16%`;
  if (Number.isFinite(c3) && c3 > 8) return `C3 ${pct(c3)} > 8%`;
  if (Number.isFinite(last) && last > 8) return `última ${pct(last)} > 8%`;
  if (Number.isFinite(base) && base > 35) return `base ${pct(base)} > 35%`;
  if (Number.isFinite(distanceToPivot) && distanceToPivot > 3) return `precio extendido ${signedPct(distanceToPivot)} sobre pivot`;
  if (Number.isFinite(distanceToPivot) && distanceToPivot < -5) return `pivot a ${signedPct(distanceToPivot)}`;
  if (Number.isFinite(absPivot) && absPivot > 6) return `pivot a ${signedPct(row.distanceToPivotPct)}`;
  if (Number.isFinite(volumeDry) && volumeDry > .9) return `volumen seco ${ratio(volumeDry)} > 0.90x`;
  if (Number.isFinite(tight10) && tight10 > 12) return `rango 10d ${pct(tight10)} > 12%`;
  if (Number.isFinite(latestCloseLocation) && latestCloseLocation < 45) return `cierre débil ${pct(latestCloseLocation)} del rango`;
  if (!Number.isFinite(volumeDry)) return "volumen seco sin dato";
  return "";
}

function evidenceLine(row = {}) {
  const depths = contractionDepths(row).slice(0, 4);
  if (depths.length) return depths.map((value) => pct(value)).join(" -> ");
  if (Number.isFinite(finite(row.baseDepthPct))) return `Base ${pct(row.baseDepthPct)}`;
  if (row.patternDataStatus && row.patternDataStatus !== "ok") return dataStatusLabel(row.patternDataStatus);
  return "Estructura sin dato";
}

function strictVcpPass(row = {}) {
  return !strictVcpRejectReason(row);
}

function pivotSqueezePass(row = {}) {
  const quality = finite(row.patternQualityScore);
  const count = finite(row.contractionCount) ?? contractionDepths(row).length;
  const pivot = finite(row.distanceToPivotPct);
  const baseDepth = finite(row.baseDepthPct);
  const tight10 = finite(row.tightness10dPct);
  const pivotClarity = finite(row.pivotClarityScore);
  const volumeDry = finite(row.volumeDryUpRatio);
  const nearPivot = Number.isFinite(pivot) && pivot >= -5 && pivot <= 3;
  const tight = row.rightSideTight === true || Number.isFinite(tight10) && tight10 <= 12;

  return row.consolidationCandidate !== false
    && nearPivot
    && tight
    && count >= 2
    && row.contractionsDecreasing !== false
    && Number.isFinite(quality)
    && quality >= 60
    && (!Number.isFinite(baseDepth) || baseDepth <= 32)
    && (!Number.isFinite(pivotClarity) || pivotClarity >= 55)
    && Number.isFinite(volumeDry)
    && volumeDry <= 1.15;
}

function setupStructureForRow(row = {}) {
  const family = String(row.patternFamily || "").trim();
  const depths = contractionDepths(row);
  const count = finite(row.contractionCount) ?? depths.length;
  const quality = finite(row.patternQualityScore);
  const reject = strictVcpRejectReason(row);
  const dataStatus = row.patternDataStatus || "sin dato";
  const volumeDry = finite(row.volumeDryUpRatio);

  if (row.patternEligible === false || family === "insufficient_data") {
    return {
      key: "data",
      label: "No elegible por datos",
      shortLabel: "Datos incompletos",
      tone: "muted",
      reason: dataStatusLabel(dataStatus),
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  if (strictVcpPass(row)) {
    return {
      key: "vcp_strict",
      label: "VCP estricto",
      shortLabel: "VCP estricto",
      tone: "good",
      reason: `3+ contracciones decrecientes, pivot ${signedPct(row.distanceToPivotPct)}, volumen ${ratio(row.volumeDryUpRatio)}`,
      evidence: evidenceLine(row),
      strict: true,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  if (family === "failed_breakout" || row.failedBreakout) {
    return {
      key: "failed_breakout",
      label: "Fallo de ruptura",
      shortLabel: "Fallo ruptura",
      tone: "warn",
      reason: "pierde zona de pivot tras superarla",
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  if (family === "breakout_observed" || row.breakoutAttempt) {
    return {
      key: "breakout_observed",
      label: "Ruptura observada",
      shortLabel: "Ruptura",
      tone: "good",
      reason: "precio sobre pivot con volumen relativo",
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  const hasStructureReject = Boolean(contractionStructureRejectReason(row));
  const watchCandidate = !hasStructureReject
    && row.consolidationCandidate !== false
    && row.contractionsDecreasing === true
    && count >= 3
    && Number.isFinite(volumeDry)
    && volumeDry <= 1.15
    && (family === "progressive_contraction" || row.vcpCandidate || (quality ?? 0) >= 50);
  if (watchCandidate) {
    return {
      key: "vcp_watch",
      label: "Base en vigilancia",
      shortLabel: "Base en vigilancia",
      tone: "watch",
      reason: reject || "estructura progresiva, pendiente de confirmación estricta",
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  if (!hasStructureReject && (row.pivotSqueeze || family === "pivot_squeeze") && pivotSqueezePass(row)) {
    return {
      key: "pivot_squeeze",
      label: "Compresión de pivot",
      shortLabel: "Compresión de pivot",
      tone: "watch",
      reason: `rango estrecho cerca de pivot ${signedPct(row.distanceToPivotPct)}`,
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  if (family === "trend_no_base" || row.consolidationCandidate === false) {
    return {
      key: "trend_no_base",
      label: "Tendencia sin base",
      shortLabel: "Sin base",
      tone: "muted",
      reason: reject || "no hay consolidación reciente validada",
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  if (hasStructureReject) {
    return {
      key: "not_vcp",
      label: "No VCP claro",
      shortLabel: "No VCP",
      tone: "muted",
      reason: reject || "estructura de contracciones rechazada",
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  if (count >= 2 && row.contractionsDecreasing !== true) {
    return {
      key: "not_vcp",
      label: "No VCP claro",
      shortLabel: "No VCP",
      tone: "muted",
      reason: reject || "secuencia de contracciones irregular",
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  if (family === "tight_base" || family === "pivot_zone" || family === "base_structure" || row.consolidationCandidate === true) {
    return {
      key: "constructive_base",
      label: "Base constructiva",
      shortLabel: "Base constructiva",
      tone: "neutral",
      reason: reject || "base medible sin VCP completo",
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  return {
    key: "unknown",
    label: "Estructura sin validar",
    shortLabel: "Sin validar",
    tone: "muted",
    reason: reject || "sin evidencia técnica suficiente",
    evidence: evidenceLine(row),
    strict: false,
    dataLabel: dataStatusLabel(dataStatus),
  };
}

export {
  dataStatusLabel,
  evidenceLine as patternEvidenceLine,
  setupStructureForRow,
  strictVcpPass,
  strictVcpRejectReason,
  technicalConfidenceForPattern,
};
