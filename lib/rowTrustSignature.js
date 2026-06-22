function finiteCount(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

function addTrustReason(map, key, label, detail = "", tone = "warn") {
  if (!key || map.has(key)) return;
  map.set(key, { key, label, detail, tone });
}

function scoreAuditCompactFilterKey(audit = null) {
  if (!audit) return "all";
  if (audit.key) return audit.key;
  const residualWarn = Number.isFinite(audit.residual) && Math.abs(audit.residual) >= 4;
  if (residualWarn) return "mismatch";
  if (Array.isArray(audit.missing) && audit.missing.length) return "missing";
  if (audit.integrityTone === "good") return "clean";
  return "attention";
}

function compactIssueLabel(label = "", key = "") {
  const text = String(label || key || "").toLowerCase();
  if (/\brs\b|liderazgo rs/.test(text)) return "RS";
  if (/\bscore\b/.test(text)) return "Score";
  if (/\bsma50\b/.test(text)) return "SMA50";
  if (/evidencia|prueba/.test(text)) return "Pruebas";
  if (/\bdatos?\b|\bprecio\b/.test(text)) return "Datos";
  if (/volumen|demanda/.test(text)) return "Demanda";
  if (/riesgo/.test(text)) return "Riesgo";
  if (/setup|vcp/.test(text)) return "Setup";
  if (/operable|candidato|confirmaci/.test(text)) return "Validar";
  return String(label || key || "Revisar").split(/\s+/).slice(0, 2).join(" ");
}

export function buildRowTrustSignature({ dataHealth = null, metricTruth = null, scoreAudit = null, evidence = null, vcpReliability = null, rowIssues = [] } = {}) {
  const review = new Map();
  const blocked = new Map();
  const dataKey = dataHealth?.status?.key || dataHealth?.key || "";
  const metricKey = metricTruth?.key || "";
  const scoreKey = scoreAuditCompactFilterKey(scoreAudit);
  const evidenceKey = evidence?.status || evidence?.key || "";
  const vcpKey = vcpReliability?.key || "";
  const measuredCount = finiteCount(metricTruth?.measuredCount);
  const proxyCount = finiteCount(metricTruth?.proxyCount);

  if (dataKey === "blocked") addTrustReason(blocked, "data", "Datos", dataHealth?.status?.detail || dataHealth?.detail || dataHealth?.topLine || "datos bloqueados", "bad");
  else if (dataKey && dataKey !== "ready") addTrustReason(review, "data", "Datos", dataHealth?.status?.detail || dataHealth?.detail || dataHealth?.topLine || dataHealth?.status?.label || dataHealth?.label, "warn");

  if (metricKey === "blocked") addTrustReason(blocked, "metrics", "Métricas", metricTruth?.title || metricTruth?.detail || "métricas bloqueadas", "bad");
  else if (["review", "missing"].includes(metricKey)) addTrustReason(review, "metrics", "Métricas", metricTruth?.title || metricTruth?.detail || "métricas a validar", "warn");

  if (scoreKey === "mismatch") addTrustReason(review, "score", "Score", scoreAudit?.topLine || scoreAudit?.detail || "score descuadrado", "warn");
  else if (scoreKey === "missing") addTrustReason(review, "score", "Score", scoreAudit?.topLine || scoreAudit?.detail || "score incompleto", "warn");
  else if (scoreKey === "attention") addTrustReason(review, "score", "Score", scoreAudit?.topLine || scoreAudit?.detail || "score a revisar", "warn");

  if (evidenceKey === "blocked") addTrustReason(blocked, "evidence", "Pruebas", evidence?.summary || evidence?.detail || "pruebas bloqueadas", "bad");
  else if (evidenceKey && evidenceKey !== "ready") addTrustReason(review, "evidence", "Pruebas", evidence?.summary || evidence?.detail || "pruebas pendientes", evidence?.tone || "warn");

  if (vcpKey === "blocked") addTrustReason(blocked, "vcp", "VCP", vcpReliability?.summary || vcpReliability?.note || "VCP bloqueado", "bad");
  else if (vcpKey && vcpKey !== "audit-ready") addTrustReason(review, "vcp", "VCP", vcpReliability?.summary || vcpReliability?.note || vcpReliability?.label, vcpReliability?.tone || "warn");

  for (const issue of Array.isArray(rowIssues) ? rowIssues : []) {
    const label = compactIssueLabel(issue?.label, issue?.key);
    if (issue?.severity === "bad") addTrustReason(blocked, `issue-${issue.key || label}`, label, issue.detail || issue.label, "bad");
    else addTrustReason(review, `issue-${issue?.key || label}`, label, issue?.detail || issue?.label, issue?.severity || "warn");
  }

  const reviewItems = [...review.values()];
  const blockedItems = [...blocked.values()];
  const reviewCount = reviewItems.length;
  const blockedCount = blockedItems.length;
  const detail = [
    `${measuredCount} medidas/trazables`,
    `${proxyCount} proxy/estimadas`,
    reviewCount ? `revisar: ${reviewItems.map((item) => item.label).slice(0, 4).join(", ")}` : "sin revisiones críticas",
    blockedCount ? `bloqueado: ${blockedItems.map((item) => item.label).slice(0, 4).join(", ")}` : "sin bloqueos",
  ];
  const tone = blockedCount ? "bad" : reviewCount ? "warn" : "good";

  return {
    tone,
    measuredCount,
    proxyCount,
    reviewCount,
    blockedCount,
    reviewItems,
    blockedItems,
    title: detail.join(" · "),
    ariaLabel: `Confianza de fila: ${detail.join(". ")}.`,
    items: [
      { key: "objective", label: "Obj", value: measuredCount, tone: measuredCount ? "good" : "warn", detail: `${measuredCount} métricas medidas o trazables` },
      { key: "proxy", label: "p", value: proxyCount, tone: proxyCount ? "neutral" : "muted", detail: `${proxyCount} métricas proxy o estimadas` },
      { key: "review", label: "!", value: reviewCount, tone: reviewCount ? "warn" : "good", detail: reviewCount ? reviewItems.map((item) => [item.label, item.detail].filter(Boolean).join(": ")).join(" · ") : "Sin revisiones críticas" },
      { key: "blocked", label: "x", value: blockedCount, tone: blockedCount ? "bad" : "muted", detail: blockedCount ? blockedItems.map((item) => [item.label, item.detail].filter(Boolean).join(": ")).join(" · ") : "Sin bloqueos" },
    ],
  };
}
