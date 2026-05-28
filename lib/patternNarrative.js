function finite(value) {
  const n = Number(value);
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
    ok: "Datos tecnicos OK",
    partial_volume: "Volumen parcial",
    insufficient_history: "Historico insuficiente",
    missing_latest_date: "Fecha no disponible",
    stale_price: "Precio no reciente",
    sparse_ohlc: "OHLC incompleto",
    missing_volume: "Volumen no fiable",
    "sin dato": "Datos sin validar",
  };
  return map[String(status || "").trim()] || "Datos sin validar";
}

function contractionDepths(row = {}) {
  return (Array.isArray(row.contractionDepths) ? row.contractionDepths : [])
    .map(finite)
    .filter(Number.isFinite);
}

function strictVcpRejectReason(row = {}) {
  const depths = contractionDepths(row);
  const count = finite(row.contractionCount) ?? depths.length;
  const c1 = finite(row.contraction1DepthPct) ?? depths[0];
  const c2 = finite(row.contraction2DepthPct) ?? depths[1];
  const c3 = finite(row.contraction3DepthPct) ?? depths[2];
  const last = finite(row.lastContractionDepthPct) ?? depths.at(-1);
  const base = finite(row.baseDepthPct);
  const absPivot = finite(row.absDistanceToPivotPct) ?? Math.abs(finite(row.distanceToPivotPct) ?? NaN);
  const volumeDry = finite(row.volumeDryUpRatio);
  const tight10 = finite(row.tightness10dPct);

  if (row.patternEligible === false || (row.patternDataStatus && row.patternDataStatus !== "ok" && row.patternDataStatus !== "partial_volume")) return dataStatusLabel(row.patternDataStatus);
  if (row.consolidationCandidate === false || row.patternFamily === "trend_no_base") return row.baseContextStatus === "persistent_advance" ? "subida persistente sin base clara" : "base reciente no confirmada";
  if (count < 3) return `solo ${Number.isFinite(count) ? count.toFixed(0) : 0} contracciones utiles`;
  if (row.contractionsDecreasing !== true) {
    if (depths.length >= 2 && depths.at(-1) > depths.at(-2)) return "ultima contraccion se re-expande";
    return "contracciones no decrecientes";
  }
  if (Number.isFinite(c1) && c1 > 25) return `C1 ${pct(c1)} > 25%`;
  if (Number.isFinite(c2) && c2 > 16) return `C2 ${pct(c2)} > 16%`;
  if (Number.isFinite(c3) && c3 > 8) return `C3 ${pct(c3)} > 8%`;
  if (Number.isFinite(last) && last > 8) return `ultima ${pct(last)} > 8%`;
  if (Number.isFinite(base) && base > 35) return `base ${pct(base)} > 35%`;
  if (Number.isFinite(absPivot) && absPivot > 6) return `pivot a ${signedPct(row.distanceToPivotPct)}`;
  if (Number.isFinite(volumeDry) && volumeDry > .9) return `volumen seco ${ratio(volumeDry)} > 0.90x`;
  if (Number.isFinite(tight10) && tight10 > 12) return `rango 10d ${pct(tight10)} > 12%`;
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

function setupStructureForRow(row = {}) {
  const family = String(row.patternFamily || "").trim();
  const depths = contractionDepths(row);
  const count = finite(row.contractionCount) ?? depths.length;
  const quality = finite(row.patternQualityScore);
  const reject = strictVcpRejectReason(row);
  const dataStatus = row.patternDataStatus || "sin dato";

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

  const watchCandidate = row.consolidationCandidate !== false
    && row.contractionsDecreasing === true
    && count >= 3
    && (family === "progressive_contraction" || row.vcpCandidate || (quality ?? 0) >= 50);
  if (watchCandidate) {
    return {
      key: "vcp_watch",
      label: "VCP en vigilancia",
      shortLabel: "VCP vigilancia",
      tone: "watch",
      reason: reject || "estructura progresiva, pendiente de confirmacion estricta",
      evidence: evidenceLine(row),
      strict: false,
      dataLabel: dataStatusLabel(dataStatus),
    };
  }

  if (row.pivotSqueeze || family === "pivot_squeeze") {
    return {
      key: "pivot_squeeze",
      label: "Compresion pivot",
      shortLabel: "Compresion pivot",
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
      reason: reject || "no hay consolidacion reciente validada",
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
    reason: reject || "sin evidencia tecnica suficiente",
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
};
