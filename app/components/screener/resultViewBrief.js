function resultBriefToneRank(tone = "") {
  if (tone === "bad") return 4;
  if (tone === "warn") return 3;
  if (tone === "watch") return 2;
  if (tone === "good") return 0;
  return 1;
}

function resultBriefIssue(key, verdict = null, okKeys = []) {
  if (!verdict?.key || okKeys.includes(verdict.key)) return null;
  return {
    key,
    label: verdict.label || key,
    detail: verdict.detail || "",
    tone: verdict.tone || "neutral",
    count: Number(verdict.count || 0),
  };
}

export function buildResultViewBrief({
  chips = [],
  visibleCount = 0,
  totalCount = 0,
  decisionBrief = null,
  dataHealthSummary = null,
  decisionEvidenceSummary = null,
  scoreAuditSummary = null,
  pendingDecisionWorkSummary = null,
} = {}) {
  if (!visibleCount) return null;
  const verdict = decisionBrief?.verdict || {
    label: "Vista de investigación",
    tone: "neutral",
    detail: `${visibleCount} resultados visibles.`,
  };
  const focus = chips.length
    ? chips.slice(0, 3).map((chip) => chip.label).join(" · ")
    : "Sin filtros activos";
  const blockers = [
    resultBriefIssue("evidence", decisionEvidenceSummary?.verdict, ["ready", "empty"]),
    resultBriefIssue("data", dataHealthSummary?.verdict, ["ready", "empty"]),
    resultBriefIssue("score", scoreAuditSummary?.verdict, ["clean", "empty"]),
    decisionBrief?.primaryIssue ? {
      key: `issue-${decisionBrief.primaryIssue.key}`,
      label: decisionBrief.primaryIssue.label,
      detail: [`${decisionBrief.primaryIssue.count || 0} filas`, decisionBrief.primaryIssue.share].filter(Boolean).join(" · "),
      tone: decisionBrief.primaryIssue.severity || "warn",
      count: Number(decisionBrief.primaryIssue.count || 0),
    } : null,
  ].filter(Boolean).sort((a, b) => resultBriefToneRank(b.tone) - resultBriefToneRank(a.tone) || b.count - a.count);
  const blocker = blockers[0] || null;
  const top = pendingDecisionWorkSummary?.top || null;
  const firstAction = top
    ? {
      value: top.symbol,
      detail: `Pri ${Math.round(top.priority || 0)} · ${top.confidenceLabel || "Confianza"}`,
      tone: top.confidenceKey === "high" ? "good" : "warn",
    }
    : decisionBrief?.actions?.[0]
      ? {
        value: decisionBrief.actions[0].label,
        detail: decisionBrief.actions[0].detail,
        tone: "warn",
      }
      : {
        value: "Revisar ranking",
        detail: `${visibleCount} resultados visibles`,
        tone: "neutral",
      };

  return {
    label: verdict.label,
    detail: verdict.detail,
    tone: blocker?.tone || verdict.tone || "neutral",
    primarySymbol: top?.symbol || "",
    sourceDetail: [
      `Brief vista: ${verdict.label}`,
      `Foco: ${focus}`,
      `Primero: ${firstAction.value}`,
      `Freno: ${blocker?.label || "Sin freno"}`,
    ].join(" · "),
    items: [
      {
        key: "focus",
        label: "Foco",
        value: focus,
        detail: `${visibleCount}/${totalCount || visibleCount} visibles`,
        tone: chips.length ? "warn" : "neutral",
      },
      {
        key: "first",
        label: "Primero",
        value: firstAction.value,
        detail: firstAction.detail,
        tone: firstAction.tone,
      },
      {
        key: "blocker",
        label: "Freno",
        value: blocker?.label || "Sin freno",
        detail: blocker?.detail || "La vista no concentra una alerta crítica.",
        tone: blocker?.tone || "good",
      },
    ],
  };
}
