function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pct(count, total) {
  if (!total) return 0;
  return (count / total) * 100;
}

function pctLabel(count, total) {
  return `${pct(count, total).toFixed(0)}%`;
}

function countFrom(source = {}, key = "") {
  return Number(source?.[key] || 0);
}

function confidenceCount(audit = {}, key = "") {
  return Number((audit?.decisionQuality?.confidence || []).find((item) => item.key === key)?.count || 0);
}

function firstIssue(audit = {}) {
  return (audit?.decisionQuality?.topIssues || []).find((item) => item?.key) || null;
}

function action(key, label, detail, filter = null) {
  return { key, label, detail, filter };
}

export function buildScreenerDecisionBrief({ audit = null, rows = [] } = {}) {
  const rowCount = finite(audit?.rows) ?? (Array.isArray(rows) ? rows.length : 0);
  if (!rowCount) {
    return {
      rows: 0,
      verdict: {
        key: "empty",
        label: "Sin lectura",
        tone: "neutral",
        detail: "Ejecuta o restaura un scan para evaluar calidad de decisión.",
      },
      metrics: [],
      primaryIssue: null,
      actions: [],
    };
  }

  const decisions = audit?.decisions || {};
  const quality = audit?.decisionQuality || {};
  const operable = countFrom(decisions, "operable");
  const watch = countFrom(decisions, "watch");
  const auditCount = countFrom(decisions, "audit");
  const reject = countFrom(decisions, "reject") + countFrom(decisions, "bearish");
  const highConfidence = confidenceCount(audit, "high");
  const mediumConfidence = confidenceCount(audit, "medium");
  const usableConfidence = highConfidence + mediumConfidence;
  const primaryIssue = firstIssue(audit);
  const primaryIssueCount = Number(primaryIssue?.count || 0);
  const fragileOperable = Number(quality.operableConfidenceRiskCount || 0);
  const longRisk = Number(quality.longCandidateRiskCount || 0);
  const badIssue = (quality.topIssues || []).find((issue) => issue?.severity === "bad");

  const highShare = pct(highConfidence, rowCount);
  const auditShare = pct(auditCount, rowCount);
  const issueShare = pct(primaryIssueCount, rowCount);
  const fragileShare = pct(fragileOperable + longRisk, rowCount);

  let verdict = {
    key: "mixed",
    label: "Lectura mixta",
    tone: "warn",
    detail: `${usableConfidence} de ${rowCount} con confianza media/alta; prioriza filtros de decisión antes de revisar.`,
  };
  if (highShare >= 45 && auditShare <= 15 && fragileShare <= 20 && !badIssue) {
    verdict = {
      key: "reliable",
      label: "Lectura fiable",
      tone: "good",
      detail: `${highConfidence} de ${rowCount} con confianza alta y pocos bloqueos de datos visibles.`,
    };
  } else if (auditShare >= 35 || issueShare >= 35 || highShare < 15 || badIssue) {
    verdict = {
      key: "fragile",
      label: "Lectura frágil",
      tone: "bad",
      detail: primaryIssue
        ? `${primaryIssue.label}: ${primaryIssue.count} filas afectadas. Audita antes de convertir ranking en cola.`
        : "La confianza alta es baja para este scope; trata el ranking como preselección.",
    };
  }

  const metrics = [
    {
      key: "operable",
      label: "operables",
      value: operable,
      share: pctLabel(operable, rowCount),
      tone: operable ? "good" : "neutral",
      filter: { type: "readiness", value: "operable" },
    },
    {
      key: "confidence",
      label: "confianza alta",
      value: highConfidence,
      share: pctLabel(highConfidence, rowCount),
      tone: highConfidence ? "good" : "warn",
      filter: { type: "confidence", value: "high" },
    },
    {
      key: "audit",
      label: "auditar",
      value: auditCount,
      share: pctLabel(auditCount, rowCount),
      tone: auditCount ? "warn" : "good",
      filter: { type: "readiness", value: "audit" },
    },
    {
      key: "reject",
      label: "descartar/bearish",
      value: reject,
      share: pctLabel(reject, rowCount),
      tone: reject ? "bad" : "neutral",
      filter: { type: "readiness", value: reject && countFrom(decisions, "reject") >= countFrom(decisions, "bearish") ? "reject" : "bearish" },
    },
  ];

  const actions = [];
  if (auditCount) actions.push(action("audit", "Auditar datos", `${auditCount} filas requieren validación antes de priorizar.`, { type: "readiness", value: "audit" }));
  if (primaryIssue) actions.push(action("primary-issue", `Filtrar ${primaryIssue.label}`, `${primaryIssue.count} filas · ${primaryIssue.share || pctLabel(primaryIssue.count, rowCount)}`, { type: "issue", value: primaryIssue.key }));
  if (highConfidence) actions.push(action("high-confidence", "Priorizar alta confianza", `${highConfidence} filas para revisar primero.`, { type: "confidence", value: "high" }));
  if (operable || watch) actions.push(action("review", "Abrir Review", `${operable || watch} filas con tesis o vigilancia accionable.`, { type: "review" }));

  return {
    rows: rowCount,
    verdict,
    metrics,
    primaryIssue,
    actions: actions.slice(0, 4),
  };
}
