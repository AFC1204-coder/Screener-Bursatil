"use client";

function priorityValue(trace = null) {
  const value = Number(trace?.priorityScore);
  return Number.isFinite(value) ? Math.round(value).toLocaleString("es-ES") : "";
}

function confidenceValue(trace = null) {
  const confidence = trace?.confidence;
  if (!confidence || typeof confidence !== "object") return "";
  const score = Number(confidence.score);
  const label = confidence.label || "";
  if (Number.isFinite(score) && label) return `${label} ${Math.round(score)}`;
  if (Number.isFinite(score)) return String(Math.round(score));
  return label;
}

function profileValue(profile = null) {
  if (!profile || typeof profile !== "object") return "";
  return profile.label || profile.key || "";
}

function originMeta(origin = {}) {
  const priority = priorityValue(origin.decisionTrace);
  const confidence = confidenceValue(origin.decisionTrace);
  const profile = profileValue(origin.decisionProfile);
  const items = [
    { key: "preset", label: "base", value: origin.presetName },
    { key: "setup", label: "modo", value: origin.setupName },
    origin.readiness?.label ? { key: "readiness", label: "decision", value: origin.readiness.label } : null,
    profile ? { key: "profile", label: "perfil", value: profile, tone: origin.decisionProfile?.tone || "" } : null,
    confidence ? { key: "confidence", label: "confianza", value: confidence } : null,
    priority ? { key: "priority", label: "prioridad", value: priority } : null,
    Number.isFinite(origin.rank) && Number.isFinite(origin.queueSize)
      ? { key: "rank", label: "cola", value: `${origin.rank}/${origin.queueSize}` }
      : null,
    origin.row?.score && origin.row.score !== "-" ? { key: "score", label: "score", value: origin.row.score } : null,
    origin.key === "bearish" && origin.row?.weakness && origin.row.weakness !== "-"
      ? { key: "weakness", label: "deterioro", value: origin.row.weakness }
      : null,
  ].filter(Boolean);
  return items.slice(0, 6);
}

function compactTraceItems(items = [], limit = 3) {
  return Array.isArray(items)
    ? items
      .filter((item) => item?.label || item?.key)
      .slice(0, limit)
      .map((item) => ({
        key: item.key || item.label,
        label: item.label || item.key,
        detail: item.value || item.detail || item.text || "",
      }))
    : [];
}

function compactPriorityItems(priority = null) {
  if (!priority || typeof priority !== "object") return [];
  const items = Array.isArray(priority.components) ? priority.components.slice(0, 5).map((item) => ({
    key: item.key || item.label,
    label: `${item.label || item.key} ${Number.isFinite(Number(item.value)) && item.value >= 0 ? "+" : ""}${Number.isFinite(Number(item.value)) ? Math.round(Number(item.value)) : "-"}`,
    detail: item.detail || "",
  })) : [];
  if (Number(priority.issuePenalty) > 0) {
    items.push({
      key: "issuePenalty",
      label: `Issues -${Math.round(Number(priority.issuePenalty))}`,
      detail: (priority.penalties || []).map((item) => item.label).filter(Boolean).slice(0, 3).join(" · "),
    });
  }
  return items.slice(0, 6);
}

function detailTitle(...parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" · ");
}

function briefCards(brief = null) {
  if (!brief || typeof brief !== "object") return [];
  return [
    brief.thesis ? { key: "thesis", ...brief.thesis } : null,
    brief.risk ? { key: "risk", ...brief.risk } : null,
    brief.nextAction ? { key: "nextAction", ...brief.nextAction } : null,
  ].filter((item) => item?.value || item?.detail);
}

function dataHealthView(dataHealth = null) {
  if (!dataHealth || typeof dataHealth !== "object") return null;
  const status = dataHealth.status && typeof dataHealth.status === "object" ? dataHealth.status : null;
  const issues = Array.isArray(dataHealth.issues)
    ? dataHealth.issues
      .filter((item) => item?.label || item?.key)
      .slice(0, 3)
      .map((item) => ({
        key: item.key || item.label,
        label: item.label || item.key,
        detail: item.detail || item.text || "",
        tone: item.tone || item.severity || "",
      }))
    : [];
  const coverage = Number(dataHealth.coverageScore);
  const coverageLabel = Number.isFinite(coverage) ? `Cob ${Math.round(coverage)}` : "";
  const label = status?.label || coverageLabel || "Datos";
  const detail = status?.detail || dataHealth.topLine || "";
  const topLine = dataHealth.topLine && dataHealth.topLine !== detail ? dataHealth.topLine : "";
  if (!label && !detail && !topLine && !issues.length) return null;
  return {
    label,
    detail,
    topLine,
    coverageLabel,
    tone: status?.tone || issues[0]?.tone || "neutral",
    issues,
  };
}

function metricTruthView(metricTruth = null) {
  if (!metricTruth || typeof metricTruth !== "object") return null;
  const label = metricTruth.label || metricTruth.shortLabel || "Métricas";
  const detail = metricTruth.detail || "";
  const measured = Number(metricTruth.measuredCount);
  const proxy = Number(metricTruth.proxyCount);
  const chips = [
    Number.isFinite(measured) && measured > 0 ? { key: "measured", label: `${Math.round(measured)} medidas`, tone: "good" } : null,
    Number.isFinite(proxy) && proxy > 0 ? { key: "proxy", label: `${Math.round(proxy)} proxy`, tone: "neutral" } : null,
    ...(Array.isArray(metricTruth.issues) ? metricTruth.issues.slice(0, 3).map((item) => ({
      key: item.key || item.label,
      label: item.label || item.key,
      detail: item.detail || "",
      tone: item.tone || item.severity || "warn",
    })) : []),
  ].filter(Boolean);
  if (!label && !detail && !chips.length) return null;
  return {
    label,
    shortLabel: metricTruth.shortLabel || "",
    detail,
    tone: metricTruth.tone || "neutral",
    chips,
  };
}

function finiteMetricValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metricValueLabel(value, digits = 0) {
  const number = finiteMetricValue(value);
  if (!Number.isFinite(number)) return "-";
  return digits > 0 ? number.toFixed(digits) : String(Math.round(number));
}

function metricSourceForItem(item = null, label = "") {
  if (!item) return null;
  const status = item.status || "";
  const severity = item.severity || "";
  const titleLabel = label || item.label || item.key || "Métrica";
  if (severity === "bad" || ["mismatch", "unverified-value", "missing-source"].includes(status)) {
    return { key: "blocked", mark: "x", title: `${titleLabel}: bloqueada` };
  }
  if (severity === "warn" || ["missing", "insufficient-input"].includes(status)) {
    return { key: "review", mark: "!", title: `${titleLabel}: revisar` };
  }
  if (item.proxy === true) {
    return { key: "proxy", mark: "p", title: `${titleLabel}: proxy/estimada` };
  }
  if (status === "verified" || status === "traceable") {
    return { key: "measured", mark: "", title: `${titleLabel}: medida/trazable` };
  }
  return null;
}

function firstMetricItem(byKey, keys = []) {
  return keys.map((key) => byKey.get(key)).find(Boolean) || null;
}

function snapshotMetricItems(origin = {}) {
  const items = Array.isArray(origin.metricAuditItems) ? origin.metricAuditItems : [];
  if (!items.length) return [];
  const byKey = new Map(items.map((item) => [item.key, item]));
  return [
    { key: "score", label: "Score", item: firstMetricItem(byKey, ["objectiveScore", "totalScore", "compositeScore"]) },
    { key: "rs", label: "RS", item: firstMetricItem(byKey, ["rsGlobalPct", "rsRating"]) },
    { key: "ad", label: "A/D", item: firstMetricItem(byKey, ["adProxyScore"]) },
    { key: "eps", label: "EPS", item: firstMetricItem(byKey, ["epsGrowthProxyScore"]) },
  ]
    .filter((entry) => entry.item)
    .map((entry) => ({
      ...entry,
      value: metricValueLabel(entry.item.value),
      source: metricSourceForItem(entry.item, entry.label),
    }))
    .slice(0, 4);
}

function scoreAuditView(scoreAudit = null) {
  if (!scoreAudit || typeof scoreAudit !== "object") return null;
  const displayed = Number(scoreAudit.displayedScore);
  const calculated = Number(scoreAudit.calculatedScore);
  const residual = Number(scoreAudit.residual);
  const label = Number.isFinite(displayed) ? `Score ${Math.round(displayed)}` : "Score audit";
  const calcLabel = Number.isFinite(calculated)
    ? `calc ${calculated.toFixed(1)}${Number.isFinite(residual) ? ` · Δ ${residual.toFixed(1)}` : ""}`
    : "";
  const drivers = Array.isArray(scoreAudit.positive) ? scoreAudit.positive.slice(0, 3) : [];
  const drags = Array.isArray(scoreAudit.drags) ? scoreAudit.drags.slice(0, 2) : [];
  const missing = Array.isArray(scoreAudit.missing) ? scoreAudit.missing.slice(0, 2) : [];
  const chips = [
    ...drivers.map((item) => ({ key: `p-${item.key}`, label: `${item.label} +${Number(item.points || 0).toFixed(1)}`, tone: item.tone || "good" })),
    ...drags.map((item) => ({ key: `d-${item.key}`, label: `${item.label} ${Number.isFinite(Number(item.value)) ? Math.round(Number(item.value)) : "-"}`, tone: "warn" })),
    ...missing.map((item) => ({ key: `m-${item.key}`, label: `${item.label} sin dato`, tone: "warn" })),
  ].filter((item) => item.label).slice(0, 5);
  if (!label && !calcLabel && !scoreAudit.topLine && !chips.length) return null;
  return {
    label,
    calcLabel,
    detail: scoreAudit.topLine || "",
    tone: scoreAudit.integrityTone || "neutral",
    chips,
  };
}

function evidenceView(evidence = null) {
  if (!evidence || typeof evidence !== "object") return null;
  const pending = Array.isArray(evidence.pending) ? evidence.pending.filter((item) => item?.label || item?.key) : [];
  const confirmed = Array.isArray(evidence.items) ? evidence.items.filter((item) => item?.status === "confirmed" && (item.label || item.key)) : [];
  const items = pending.length ? pending : confirmed;
  if (!items.length) return null;
  return {
    status: evidence.status || "",
    tone: evidence.tone || "",
    label: pending.length ? "Pendiente" : "Confirmado",
    ratio: Number.isFinite(Number(evidence.passedCount)) && Number.isFinite(Number(evidence.totalCount))
      ? `${Number(evidence.passedCount)}/${Number(evidence.totalCount)}`
      : "",
    summary: evidence.summary || "",
    items: items.slice(0, pending.length ? 4 : 3).map((item) => ({
      key: item.key || item.label,
      label: item.label || item.key,
      detail: item.detail || item.statusLabel || item.status || "",
      tone: item.tone || "",
      statusLabel: item.statusLabel || item.status || "",
    })),
  };
}

function methodologyFocusView(focus = null) {
  if (!focus || typeof focus !== "object") return null;
  const key = String(focus.key || focus.label || "").trim();
  const label = String(focus.shortLabel || focus.label || focus.key || "").trim();
  const detail = String(focus.detail || "").trim();
  if (!key && !label && !detail) return null;
  return {
    key: key || label || "methodology-focus",
    label: label || key || "Método",
    detail,
    tone: focus.tone || "neutral",
    requiresReview: focus.requiresReview === true,
  };
}

function reviewFocusView(focus = null) {
  if (!focus || typeof focus !== "object") return null;
  const key = String(focus.key || focus.label || "").trim();
  const label = String(focus.label || focus.key || "").trim();
  const detail = String(focus.detail || "").trim();
  if (!key && !label && !detail) return null;
  return {
    key: key || label || "review-focus",
    label: label || key || "Revisar",
    detail,
    tone: focus.tone || "warn",
  };
}

function decisionReadinessBlock({ origin = {}, dataHealth = null, metricTruth = null, scoreAudit = null, evidence = null, methodologyFocus = null, reviewFocus = null, issues = [] } = {}) {
  const trace = origin.decisionTrace && typeof origin.decisionTrace === "object" ? origin.decisionTrace : null;
  const nextAction = origin.decisionBrief?.nextAction || trace?.brief?.nextAction || null;
  const confidence = trace?.confidence && typeof trace.confidence === "object" ? trace.confidence : null;
  const confidenceScore = Number(confidence?.score);
  const confidenceValue = confidence?.label
    ? `${confidence.label}${Number.isFinite(confidenceScore) ? ` ${Math.round(confidenceScore)}` : ""}`
    : Number.isFinite(confidenceScore)
      ? `${Math.round(confidenceScore)}`
      : origin.decisionProfile?.label || origin.readiness?.label || "Sin confianza";

  const severeIssue = issues.find((item) => item?.severity === "bad") || null;
  const firstIssue = severeIssue || issues[0] || null;
  const dataIssue = dataHealth && !["good", "neutral"].includes(dataHealth.tone || "") ? dataHealth.issues?.[0] : null;
  const metricIssue = metricTruth && !["good", "neutral"].includes(metricTruth.tone || "")
    ? {
        label: metricTruth.label || "Métricas",
        detail: metricTruth.detail,
        tone: metricTruth.tone,
      }
    : null;
  const scoreIssue = scoreAudit && !["good", "neutral"].includes(scoreAudit.tone || "") ? scoreAudit.chips?.[0] : null;
  const evidenceIssue = evidence && evidence.status !== "ready" ? evidence.items?.[0] : null;
  const methodologyIssue = methodologyFocus?.requiresReview ? methodologyFocus : null;
  const reviewFocusIssue = reviewFocus
    ? {
        label: reviewFocus.label || "Foco",
        detail: reviewFocus.detail,
        tone: reviewFocus.tone,
      }
    : null;
  const frictionSource = reviewFocusIssue
    || severeIssue
    || dataIssue
    || metricIssue
    || scoreIssue
    || evidenceIssue
    || methodologyIssue
    || firstIssue
    || null;
  const friction = frictionSource
    ? {
        label: frictionSource.label || frictionSource.key || "Validar",
        detail: frictionSource.detail || dataHealth?.detail || scoreAudit?.detail || evidence?.summary || firstIssue?.detail || "",
        tone: frictionSource.severity || frictionSource.tone || dataHealth?.tone || scoreAudit?.tone || evidence?.tone || "warn",
      }
    : {
        label: "Sin freno crítico",
        detail: "No hay bloqueo principal visible en datos, score o pruebas.",
        tone: "good",
      };
  const actionTone = nextAction?.tone || origin.decisionProfile?.tone || origin.statusTone || origin.tone || "neutral";
  const confidenceTone = confidence?.tone || origin.decisionProfile?.tone || "neutral";
  const overallTone = friction.tone === "bad" ? "bad" : friction.tone === "warn" || friction.tone === "watch" ? "warn" : actionTone;

  return {
    tone: overallTone || "neutral",
    items: [
      {
        key: "action",
        label: "Acción",
        value: nextAction?.value || origin.readiness?.label || origin.statusText || origin.label || "Revisar",
        detail: nextAction?.detail || origin.readiness?.detail || trace?.line || origin.text || "",
        tone: actionTone,
      },
      {
        key: "confidence",
        label: "Confianza",
        value: confidenceValue,
        detail: confidence?.detail || origin.decisionProfile?.detail || origin.decisionProfile?.label || "",
        tone: confidenceTone,
      },
      {
        key: "friction",
        label: "Freno",
        value: friction.label,
        detail: friction.detail,
        tone: friction.tone,
      },
    ],
  };
}

export default function ScreenerOriginPanel({ origin, variant = "" }) {
  if (!origin) return null;
  const meta = originMeta(origin);
  const issues = Array.isArray(origin.decisionIssues) ? origin.decisionIssues.slice(0, 4) : [];
  const decisionCards = briefCards(origin.decisionBrief);
  const trace = origin.decisionTrace && typeof origin.decisionTrace === "object" ? origin.decisionTrace : null;
  const evidence = evidenceView(trace?.evidence || origin.decisionEvidence);
  const drivers = compactTraceItems(trace?.drivers, 3);
  const watch = compactTraceItems(trace?.watch, 3);
  const priorityItems = compactPriorityItems(trace?.priority);
  const traceLine = typeof trace?.line === "string" ? trace.line.trim() : "";
  const dataHealth = dataHealthView(origin.dataHealth);
  const metricTruth = metricTruthView(origin.metricTruth);
  const snapshotMetrics = snapshotMetricItems(origin);
  const scoreAudit = scoreAuditView(origin.scoreAudit);
  const methodologyFocus = methodologyFocusView(origin.methodologyFocus);
  const reviewFocus = reviewFocusView(origin.reviewFocus);
  const readinessBlock = decisionReadinessBlock({ origin, dataHealth, metricTruth, scoreAudit, evidence, methodologyFocus, reviewFocus, issues });
  const sourceDetail = typeof origin.sourceDetail === "string" ? origin.sourceDetail.trim() : "";
  return <section className={`screenerOriginPanel ${origin.tone || "exploratory"} ${variant}`.trim()} data-origin-contract={origin.key || ""}>
    <div className="screenerOriginIntro">
      <span>{origin.label || "Screener"}</span>
      <div>
        <h2>{origin.sourceLabel || "Origen Screener"}</h2>
        <p>{origin.title ? `${origin.title}. ` : ""}{origin.text || ""}</p>
        {sourceDetail ? <small className="screenerOriginSourceDetail" title={sourceDetail}>{sourceDetail}</small> : null}
      </div>
    </div>
    <div className={`screenerOriginDecisionRead ${readinessBlock.tone || "neutral"}`} aria-label="Lectura rápida de decisión del screener">
      {readinessBlock.items.map((item) => <span
        key={item.key}
        className={`${item.key} ${item.tone || "neutral"}`.trim()}
        title={detailTitle(item.label, item.value, item.detail)}
        aria-label={detailTitle(item.label, item.value, item.detail)}
      >
        <em>{item.label}</em>
        <b>{item.value}</b>
      </span>)}
    </div>
    {reviewFocus ? <div
      className={`screenerOriginReviewFocus ${reviewFocus.tone || "warn"} focus-${reviewFocus.key || "other"}`}
      aria-label={detailTitle("Foco de revisión del origen", reviewFocus.label, reviewFocus.detail)}
      title={detailTitle("Foco", reviewFocus.label, reviewFocus.detail)}
    >
      <span>Foco</span>
      <b title={reviewFocus.label}>{reviewFocus.label}</b>
    </div> : null}
    {meta.length ? <div className="screenerOriginMeta">
      {meta.map((item, index) => <span key={`${item.key || item.label}-${index}`} className={`${item.key ? `originMeta-${item.key}` : ""} ${item.tone || ""}`.trim()}><b>{item.value}</b><em>{item.label}</em></span>)}
    </div> : null}
    {origin.statusText ? <div className={`screenerOriginStatus ${origin.statusTone || "ok"}`}>
      {origin.statusText}
    </div> : null}
    {dataHealth ? <div
      className={`screenerOriginDataHealth ${dataHealth.tone || "neutral"}`}
      aria-label={detailTitle("Salud de datos del origen", dataHealth.label, dataHealth.detail || dataHealth.topLine)}
      title={detailTitle("Datos", dataHealth.label, dataHealth.detail || dataHealth.topLine)}
    >
      <div>
        <span>Datos</span>
        <b>{dataHealth.coverageLabel && dataHealth.coverageLabel !== dataHealth.label ? `${dataHealth.label} · ${dataHealth.coverageLabel}` : dataHealth.label}</b>
      </div>
      {dataHealth.issues.length ? <div>
        {dataHealth.issues.map((item, index) => <span key={`${item.key || item.label}-${index}`} className={item.tone || ""} title={item.detail || item.label}>{item.label}</span>)}
      </div> : null}
    </div> : null}
    {metricTruth ? <div
      className={`screenerOriginMetricTruth ${metricTruth.tone || "neutral"}`}
      aria-label={detailTitle("Trazabilidad de métricas del origen", metricTruth.label, metricTruth.shortLabel, metricTruth.detail)}
      title={detailTitle("Métricas", metricTruth.label, metricTruth.shortLabel, metricTruth.detail)}
    >
      <div>
        <span>Métricas</span>
        <b>{metricTruth.shortLabel ? `${metricTruth.label} · ${metricTruth.shortLabel}` : metricTruth.label}</b>
      </div>
      {metricTruth.chips.length ? <div>
        {metricTruth.chips.map((item, index) => <span key={`${item.key || item.label}-${index}`} className={item.tone || ""} title={item.detail || item.label}>{item.label}</span>)}
      </div> : null}
    </div> : null}
    {snapshotMetrics.length ? <div className="screenerOriginSnapshotMetrics" aria-label="Métricas del snapshot Screener">
      {snapshotMetrics.map((item, index) => {
        const sourceClass = item.source?.key ? `source-${item.source.key}` : "";
        return <span key={`${item.key || item.label}-${index}`} className={sourceClass} title={item.source?.title || item.label}>
          <em>{item.label}</em>
          <b>{item.value}</b>
          {item.source?.mark ? <i aria-hidden="true">{item.source.mark}</i> : null}
        </span>;
      })}
    </div> : null}
    {scoreAudit ? <div
      className={`screenerOriginScoreAudit ${scoreAudit.tone || "neutral"}`}
      aria-label={detailTitle("Auditoría del score del origen", scoreAudit.label, scoreAudit.calcLabel, scoreAudit.detail)}
      title={detailTitle("Score audit", scoreAudit.label, scoreAudit.calcLabel, scoreAudit.detail)}
    >
      <div>
        <span>Score audit</span>
        <b>{scoreAudit.calcLabel ? `${scoreAudit.label} · ${scoreAudit.calcLabel}` : scoreAudit.label}</b>
      </div>
      {scoreAudit.chips.length ? <div>
        {scoreAudit.chips.map((item, index) => <span key={`${item.key || item.label}-${index}`} className={item.tone || ""} title={item.label}>{item.label}</span>)}
      </div> : null}
    </div> : null}
    {methodologyFocus ? <div
      className={`screenerOriginMethodologyFocus ${methodologyFocus.tone || "neutral"} ${methodologyFocus.requiresReview ? "requiresReview" : ""}`.trim()}
      aria-label={detailTitle("Foco metodológico del origen", methodologyFocus.label, methodologyFocus.detail)}
      title={detailTitle(methodologyFocus.requiresReview ? "Método pendiente" : "Método", methodologyFocus.label, methodologyFocus.detail)}
    >
      <div>
        <span>{methodologyFocus.requiresReview ? "Método pendiente" : "Método"}</span>
        <b title={methodologyFocus.label}>{methodologyFocus.label}</b>
      </div>
      {methodologyFocus.requiresReview ? <strong>Validar</strong> : null}
    </div> : null}
    {decisionCards.length ? <div className="screenerOriginDecisionGrid" aria-label="Resumen accionable del screener">
      {decisionCards.map((item) => <div
        key={item.key}
        className={`screenerOriginDecisionItem ${item.tone || "neutral"}`}
        title={detailTitle(item.label || item.key, item.value, item.detail)}
        aria-label={detailTitle(item.label || item.key, item.value, item.detail)}
      >
        <span>{item.label || item.key}</span>
        <b title={item.value}>{item.value}</b>
      </div>)}
    </div> : null}
    {evidence ? <div
      className={`screenerOriginEvidence ${evidence.tone || ""}`}
      aria-label={detailTitle("Pruebas de decisión del screener", evidence.label, evidence.ratio || evidence.status, evidence.summary)}
      title={detailTitle("Pruebas", evidence.label, evidence.ratio || evidence.status, evidence.summary)}
    >
      <div>
        <span>{evidence.label}</span>
        <b>{evidence.ratio || evidence.status || "decision"}</b>
      </div>
      <div>
        {evidence.items.map((item, index) => <span key={`${item.key || item.label}-${index}`} className={item.tone || ""} title={item.detail || item.label}>
          <b>{item.label}</b>
          {item.statusLabel ? <em>{item.statusLabel}</em> : null}
        </span>)}
      </div>
    </div> : null}
    {issues.length ? <div className="screenerOriginIssues" aria-label="Alertas de decisión del screener">
      {issues.map((issue, index) => <span key={`${issue.key || issue.label}-${index}`} className={issue.severity || "warn"} title={issue.detail || issue.label}>
        <b>{issue.label}</b>
      </span>)}
    </div> : null}
    {drivers.length || watch.length || priorityItems.length || traceLine ? <div
      className="screenerOriginTrace"
      aria-label={detailTitle("Trazabilidad de decisión del screener", traceLine)}
      title={traceLine || undefined}
    >
      {priorityItems.length ? <div className="screenerOriginTraceGroup priority">
        <b>Ranking</b>
        {priorityItems.map((item, index) => <span key={`${item.key || item.label}-${index}`} title={item.detail || item.label}>{item.label}</span>)}
      </div> : null}
      {drivers.length ? <div className="screenerOriginTraceGroup">
        <b>Impulsa</b>
        {drivers.map((item, index) => <span key={`${item.key || item.label}-${index}`} title={item.detail || item.label}>{item.label}</span>)}
      </div> : null}
      {watch.length ? <div className="screenerOriginTraceGroup watch">
        <b>Vigilar</b>
        {watch.map((item, index) => <span key={`${item.key || item.label}-${index}`} title={item.detail || item.label}>{item.label}</span>)}
      </div> : null}
    </div> : null}
  </section>;
}
