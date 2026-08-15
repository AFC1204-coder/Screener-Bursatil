const SCORE_COMPONENTS = [
  { key: "setup", label: "Setup", field: "setupQualityScore", weight: .17 },
  // Auditoría de la COMPOSICIÓN del score: enseña las entradas reales de la
  // fórmula. La entrada de este término es el percentil del lote, no el RS
  // semanal del universo que enseña la interfaz — de ahí la etiqueta.
  { key: "rs", label: "Percentil lote", fields: ["rsGlobalPct", "rsRating"], weight: .16 },
  // rsQualityScore de la fila es la calidad DEL PERCENTIL DEL LOTE: se
  // calcula con rsGlobalPct como RS base. La ficha del valor calcula su propio
  // RS Quality sobre el RS semanal y da otro número. Nombres distintos para
  // cosas distintas.
  { key: "rs-quality", label: "Calidad lote", field: "rsQualityScore", weight: .06 },
  { key: "demand", label: "Demanda", field: "demandScore", weight: .10 },
  { key: "ad", label: "A/D", field: "adProxyScore", weight: .08 },
  { key: "growth", label: "Growth", field: "growthScore", weight: .08 },
  { key: "eps", label: "EPS proxy", fields: ["epsGrowthProxyScore", "growthScore"], weight: .08 },
  { key: "group", label: "Grupo", fields: ["sectorScore", "groupStrengthScore"], weight: .10 },
  { key: "risk-reward", label: "Rent/riesgo", field: "riskRewardScore", weight: .08 },
  { key: "risk", label: "Riesgo", field: "riskScore", weight: .05 },
  { key: "momentum", label: "Momentum", field: "momentumScore", weight: .02 },
  // El término IPO (peso .02, `optional: true`) salió del composite el
  // 2026-08-15 y por tanto sale de este desglose: enseñarlo aquí describiría
  // una fórmula que el motor ya no ejecuta. Ver COMPOSITE_WEIGHTS en
  // lib/scoringEngine.js.
];

// Los pesos declarados arriba suman 0.98 y el motor renormaliza sobre esa
// suma (lib/scoringEngine.js, computeCompositeDetailed). Este desglose hace lo
// mismo, para que `calculatedScore` sea comparable con el score mostrado en
// vez de quedar sistemáticamente un 2% por debajo.
const AUDIT_TOTAL_WEIGHT = SCORE_COMPONENTS.reduce((sum, item) => sum + item.weight, 0);

export const SCORE_AUDIT_FILTER_ALL = "all";
export const SCORE_AUDIT_FILTER_ORDER = ["clean", "attention", "mismatch", "missing"];

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fieldValue(row = {}, field = "") {
  return finite(row[field] ?? row.metrics?.[field] ?? row.raw?.[field] ?? row.snapshot?.[field]);
}

function firstFinite(row = {}, fields = []) {
  for (const field of fields) {
    const value = fieldValue(row, field);
    if (Number.isFinite(value)) return { field, value };
  }
  return { field: fields[0] || "", value: null };
}

function scoreTone(value) {
  if (!Number.isFinite(value)) return "muted";
  if (value >= 72) return "good";
  if (value >= 55) return "neutral";
  return "warn";
}

function cleanText(value = "", limit = 140) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function rounded(value, digits = 2) {
  const number = finite(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function pct(count = 0, total = 0) {
  if (!total) return "0%";
  const value = (count / total) * 100;
  return `${value >= 10 || count === total ? value.toFixed(0) : value.toFixed(1)}%`;
}

function compactAuditItem(item = null) {
  if (!item || typeof item !== "object") return null;
  const key = cleanText(item.key || item.label, 80);
  const label = cleanText(item.label || item.key, 100);
  if (!key && !label) return null;
  return {
    key: key || label,
    label: label || key,
    field: cleanText(item.field, 80),
    weight: rounded(item.weight, 4),
    value: rounded(item.value, 2),
    points: rounded(item.points, 2) ?? 0,
    tone: cleanText(item.tone, 24),
    missing: item.missing === true,
    optional: item.optional === true,
  };
}

function increment(map, key, label = key, tone = "warn") {
  if (!key) return;
  const bucket = map.get(key) || { key, label, tone, count: 0 };
  bucket.count += 1;
  map.set(key, bucket);
}

function rankedItems(map = new Map(), total = 0, limit = 6) {
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((item) => ({ ...item, share: pct(item.count, total) }));
}

function riskItems(row = {}) {
  const risks = [];
  for (const text of Array.isArray(row.compositeRisks) ? row.compositeRisks : []) {
    const label = cleanText(text);
    if (label) risks.push({ key: label.toLowerCase(), label, tone: "warn" });
  }
  const weakness = fieldValue(row, "weaknessScore");
  if (Number.isFinite(weakness) && weakness >= 55) risks.push({ key: "weakness", label: `Deterioro ${weakness.toFixed(0)}`, tone: weakness >= 75 ? "bad" : "warn" });
  const coverage = fieldValue(row, "dataCoverageScore");
  if (Number.isFinite(coverage) && coverage < 55) risks.push({ key: "coverage", label: `Cobertura ${coverage.toFixed(0)}`, tone: "warn" });
  if (row.priceFreshnessOk === false || row.priceFreshnessIssue) risks.push({ key: "freshness", label: cleanText(row.priceFreshnessIssue || "Precio no fresco", 80), tone: "warn" });
  return risks.slice(0, 4);
}

export function buildScreenerScoreAudit(row = {}) {
  const sources = SCORE_COMPONENTS.map((item) => ({
    item,
    source: Array.isArray(item.fields)
      ? firstFinite(row, item.fields)
      : { field: item.field, value: fieldValue(row, item.field) },
  }));
  // El peso de un término ausente se reparte entre los presentes, igual que en
  // el motor (computeCompositeDetailed). Antes este desglose imputaba 0 puntos
  // a lo que no encontraba mientras el motor renormalizaba, y la diferencia
  // —que el propio módulo llama `residual`— era de 21,8 puntos de mediana en
  // las filas ligeras del nocturno, contra un umbral de alarma de 4. Con los
  // términos presentes el reparto no cambia nada; con alguno ausente, ahora
  // las dos cuentas dicen lo mismo.
  const presentWeight = sources.reduce((sum, { item, source }) => sum + (Number.isFinite(source.value) ? item.weight : 0), 0);
  const scale = presentWeight > 0 ? presentWeight : AUDIT_TOTAL_WEIGHT;
  const components = sources.map(({ item, source }) => {
    const points = Number.isFinite(source.value) ? (source.value * item.weight) / scale : 0;
    return {
      key: item.key,
      label: item.label,
      field: source.field,
      weight: item.weight,
      value: Number.isFinite(source.value) ? Number(source.value.toFixed(2)) : null,
      points: Number(points.toFixed(2)),
      tone: scoreTone(source.value),
      missing: !Number.isFinite(source.value) && !item.optional,
      optional: Boolean(item.optional),
    };
  });
  const calculatedScore = components.reduce((sum, item) => sum + item.points, 0);
  const displayedScore = fieldValue(row, "totalScore") ?? fieldValue(row, "compositeScore");
  const residual = Number.isFinite(displayedScore) ? displayedScore - calculatedScore : null;
  const missing = components.filter((item) => item.missing);
  const positive = components
    .filter((item) => Number.isFinite(item.value) && item.value >= 55)
    .sort((a, b) => b.points - a.points)
    .slice(0, 4);
  const drags = components
    .filter((item) => Number.isFinite(item.value) && item.value < 55)
    .sort((a, b) => a.value - b.value || b.weight - a.weight)
    .slice(0, 4);
  const risks = riskItems(row);
  const topLine = positive.length
    ? positive.slice(0, 3).map((item) => `${item.label} +${item.points.toFixed(1)}`).join(" · ")
    : "Score sin motores claros";
  const integrityTone = missing.length || (Number.isFinite(residual) && Math.abs(residual) >= 4)
    ? "warn"
    : "good";

  return {
    schemaVersion: 1,
    formula: "setup .17 + RS .16 + RS calidad .06 + demanda .10 + A/D .08 + growth .08 + EPS .08 + grupo .10 + rent/riesgo .08 + riesgo .05 + momentum .02, repartido entre los presentes",
    displayedScore: Number.isFinite(displayedScore) ? Number(displayedScore.toFixed(2)) : null,
    calculatedScore: Number(calculatedScore.toFixed(2)),
    residual: Number.isFinite(residual) ? Number(residual.toFixed(2)) : null,
    integrityTone,
    components,
    positive,
    drags,
    risks,
    missing,
    topLine,
  };
}

export function compactScreenerScoreAudit(auditOrRow = null) {
  if (!auditOrRow || typeof auditOrRow !== "object") return null;
  const audit = Array.isArray(auditOrRow.components) ? auditOrRow : buildScreenerScoreAudit(auditOrRow);
  const components = Array.isArray(audit.components)
    ? audit.components.map(compactAuditItem).filter(Boolean)
    : [];
  const hasScore = Number.isFinite(finite(audit.displayedScore)) || components.some((item) => Number.isFinite(item.value));
  if (!hasScore) return null;
  return {
    schemaVersion: finite(audit.schemaVersion) || 1,
    formula: cleanText(audit.formula, 320),
    displayedScore: rounded(audit.displayedScore, 2),
    calculatedScore: rounded(audit.calculatedScore, 2) ?? 0,
    residual: rounded(audit.residual, 2),
    integrityTone: cleanText(audit.integrityTone || "neutral", 24),
    topLine: cleanText(audit.topLine, 220),
    components,
    positive: (audit.positive || []).map(compactAuditItem).filter(Boolean).slice(0, 4),
    drags: (audit.drags || []).map(compactAuditItem).filter(Boolean).slice(0, 4),
    risks: (audit.risks || []).map((item) => ({
      key: cleanText(item.key || item.label, 80),
      label: cleanText(item.label || item.key, 120),
      tone: cleanText(item.tone || "warn", 24),
    })).filter((item) => item.key && item.label).slice(0, 4),
    missing: (audit.missing || []).map(compactAuditItem).filter(Boolean).slice(0, 6),
  };
}

export function buildScreenerScoreAuditSummary(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const counts = new Map([["good", 0], ["warn", 0], ["bad", 0], ["neutral", 0]]);
  const missingCounts = new Map();
  const dragCounts = new Map();
  const riskCounts = new Map();
  let cleanCount = 0;
  let mismatchCount = 0;
  let missingRows = 0;

  for (const row of list) {
    const audit = buildScreenerScoreAudit(row);
    const tone = audit.integrityTone || "neutral";
    counts.set(tone, (counts.get(tone) || 0) + 1);
    const residualWarn = Number.isFinite(audit.residual) && Math.abs(audit.residual) >= 4;
    if (residualWarn) mismatchCount += 1;
    if (audit.missing.length) missingRows += 1;
    if (!residualWarn && !audit.missing.length && tone === "good") cleanCount += 1;
    for (const item of audit.missing) increment(missingCounts, item.key, item.label, "warn");
    for (const item of audit.drags) increment(dragCounts, item.key, item.label, item.tone || "warn");
    for (const item of audit.risks) increment(riskCounts, item.key, item.label, item.tone || "warn");
  }

  const total = list.length;
  const attentionCount = Math.max(0, total - cleanCount);
  const verdict = !total
    ? { key: "empty", label: "Sin resultados", tone: "muted", detail: "Ejecuta un scan para auditar score." }
    : mismatchCount
      ? { key: "residual", label: "Revisar fórmula", tone: "warn", detail: `${mismatchCount} filas con diferencia relevante vs score mostrado.` }
      : missingRows
        ? { key: "missing", label: "Score incompleto", tone: "warn", detail: `${missingRows} filas con componentes sin dato.` }
        : { key: "clean", label: "Score trazable", tone: "good", detail: `${cleanCount} filas con score reconciliado.` };

  return {
    schemaVersion: 1,
    rows: total,
    cleanCount,
    attentionCount,
    cleanShare: pct(cleanCount, total),
    attentionShare: pct(attentionCount, total),
    mismatchCount,
    missingRows,
    counts: Object.fromEntries(counts.entries()),
    verdict,
    topMissing: rankedItems(missingCounts, total),
    topDrags: rankedItems(dragCounts, total),
    topRisks: rankedItems(riskCounts, total),
  };
}

export function scoreAuditFilterLabel(key = SCORE_AUDIT_FILTER_ALL, { compact = false } = {}) {
  const labels = {
    [SCORE_AUDIT_FILTER_ALL]: compact ? "Todos" : "Score: Todos",
    clean: compact ? "Trazable" : "Score trazable",
    attention: compact ? "Revisar" : "Score a revisar",
    mismatch: compact ? "Descuadre" : "Score descuadrado",
    missing: compact ? "Incompleto" : "Score incompleto",
  };
  return labels[key] || key || labels[SCORE_AUDIT_FILTER_ALL];
}

export function scoreAuditStatusForRow(row = {}) {
  const audit = buildScreenerScoreAudit(row);
  const residualWarn = Number.isFinite(audit.residual) && Math.abs(audit.residual) >= 4;
  const missing = audit.missing.length > 0;
  const clean = !residualWarn && !missing && audit.integrityTone === "good";
  return {
    clean,
    attention: !clean,
    mismatch: residualWarn,
    missing,
    audit,
  };
}

export function scoreAuditReviewReasons(auditOrRow = null) {
  if (!auditOrRow || typeof auditOrRow !== "object") return [];
  const audit = Array.isArray(auditOrRow.components) ? auditOrRow : buildScreenerScoreAudit(auditOrRow);
  const reasons = [];
  const displayed = finite(audit.displayedScore);
  const calculated = finite(audit.calculatedScore);
  const residual = finite(audit.residual);
  if (Number.isFinite(residual) && Math.abs(residual) >= 4) {
    reasons.push({
      key: "mismatch",
      label: "Descuadre score",
      value: `Δ ${residual > 0 ? "+" : ""}${residual.toFixed(1)}`,
      detail: [
        Number.isFinite(displayed) ? `mostrado ${displayed.toFixed(1)}` : "",
        Number.isFinite(calculated) ? `calculado ${calculated.toFixed(1)}` : "",
      ].filter(Boolean).join(" · "),
      tone: "warn",
    });
  }
  const missing = Array.isArray(audit.missing) ? audit.missing : [];
  if (missing.length) {
    reasons.push({
      key: "missing",
      label: "Componentes sin dato",
      value: String(missing.length),
      detail: missing.map((item) => item.label || item.key).filter(Boolean).slice(0, 4).join(" · "),
      tone: "warn",
    });
  }
  const drags = Array.isArray(audit.drags) ? audit.drags : [];
  if (drags.length) {
    reasons.push({
      key: "drags",
      label: "Arrastres",
      value: drags.slice(0, 2).map((item) => item.label || item.key).filter(Boolean).join(" · "),
      detail: drags.slice(0, 3).map((item) => {
        const value = finite(item.value);
        return `${item.label || item.key}${Number.isFinite(value) ? ` ${value.toFixed(0)}` : ""}`;
      }).join(" · "),
      tone: "warn",
    });
  }
  const risks = Array.isArray(audit.risks) ? audit.risks : [];
  if (risks.length) {
    reasons.push({
      key: "risks",
      label: "Riesgos score",
      value: String(risks.length),
      detail: risks.map((item) => item.label || item.key).filter(Boolean).slice(0, 3).join(" · "),
      tone: risks.some((item) => item.tone === "bad") ? "bad" : "warn",
    });
  }
  if (!reasons.length) {
    reasons.push({
      key: "clean",
      label: "Score trazable",
      value: Number.isFinite(residual) ? `Δ ${residual.toFixed(1)}` : "OK",
      detail: audit.topLine || "Componentes reconciliados con el score mostrado.",
      tone: "good",
    });
  }
  return reasons;
}

export function scoreAuditMatchesFilter(row = {}, filter = SCORE_AUDIT_FILTER_ALL) {
  if (!filter || filter === SCORE_AUDIT_FILTER_ALL) return true;
  const status = scoreAuditStatusForRow(row);
  if (filter === "clean") return status.clean;
  if (filter === "attention") return status.attention;
  if (filter === "mismatch") return status.mismatch;
  if (filter === "missing") return status.missing;
  return true;
}
