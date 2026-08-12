"use client";

import Link from "next/link";
import ChartPreferences from "@/app/ChartPreferences";
import RowTrustSignature from "@/app/RowTrustSignature";
import ScreenerOriginPanel from "@/app/ScreenerOriginPanel";
import {
  CompanyMark,
  DecisionEvidenceChecklist,
  ScoreAuditPanel,
  RowPreviewChart,
} from "@/app/screenerPanels";
import { amount, money, quickBusinessDescription, quickBusinessMarket, ratioLabel, shortBusiness } from "@/lib/screenerFormat";
import { QuickReviewMetricValue, ReviewPriorityPanel, ReviewQueueFocusBadge } from "@/app/components/screener/ReviewWidgets";
import { pct } from "@/lib/formatters";
import { metricShortLabel } from "@/lib/metricCatalog";
import { buildDecisionQueueItem } from "@/lib/screenerExplainability";
import { externalLinks, stockUrl } from "@/lib/symbols";
import { STOCK_DECISION_ACTIONS, decisionResolutionForSymbol } from "@/lib/stockDecisionResolution";

export default function QuickReviewModal({
  activeModalRow = null,
  activeSettings = {},
  chartListId = "",
  chartScope = "global",
  chartSettings = {},
  modalActiveResolution = null,
  modalActiveReviewPriority = null,
  modalDecisionEvidence = null,
  modalDecisionResolutions = {},
  modalRankExplain = null,
  modalReviewAuditSummary = [],
  modalReviewPosition = 0,
  modalReviewPrioritySummary = [],
  modalReviewProfileSummary = [],
  modalReviewQueueItems = [],
  modalReviewQueueMode = "",
  modalReviewQueueSummary = { groups: [] },
  modalReviewRows = [],
  modalReviewSourceDetail = "",
  modalOriginLabel = "",
  modalScoreAudit = null,
  quickReviewOrigin = null,
  closeQuickReview,
  moveQuickReview,
  reopenQuickReviewDecision,
  resolveQuickReviewDecision,
  saveQuickReviewStockOpen,
  selectQuickReview,
  updateChartScope,
  updateChartSettings,
}) {
  if (!activeModalRow) return null;

  return <dialog className="stockModal quickReviewModal" open onClick={(e) => { if (e.target === e.currentTarget) closeQuickReview(); }}>
    <div className="stockModalInner quickReviewInner">
      <div className="profileHeader quickReviewHeader">
        <div className="profileHeaderLeft quickReviewTitleBlock">
          <CompanyMark row={activeModalRow} size="lg" />
          <div>
            <div className="profileHeaderBreadcrumb">
              Screener <span>/</span> Vista rapida <span>/</span> {modalReviewPosition + 1} de {modalReviewRows.length}
            </div>
            <div className="profileTitle">
              <h2>{activeModalRow.symbol}</h2>
              <span>{activeModalRow.companyName}</span>
            </div>
            <div className="profilePrice">
              <span className="price">{money(activeModalRow.price, activeModalRow.currency)}</span>
              {Number.isFinite(activeModalRow.perf3m) && (
                <span className={`change ${activeModalRow.perf3m >= 0 ? "up" : "down"}`}>
                  {activeModalRow.perf3m >= 0 ? "+" : ""}{activeModalRow.perf3m.toFixed(2)}% 3M
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="profileHeaderRight quickReviewActions">
          <button className="btn" onClick={() => moveQuickReview(-1)} disabled={modalReviewRows.length < 2}>Anterior</button>
          <span className="quickReviewCounter">{modalReviewPosition + 1}/{modalReviewRows.length}</span>
          <button className="btn btnPrimary" onClick={() => moveQuickReview(1)} disabled={modalReviewRows.length < 2}>Siguiente</button>
          <Link className="btn" href={stockUrl(activeModalRow.symbol)} onPointerDown={() => saveQuickReviewStockOpen(activeModalRow, modalReviewPosition)} onClick={() => saveQuickReviewStockOpen(activeModalRow, modalReviewPosition)}>Ficha</Link>
          <a className="btn" href={externalLinks(activeModalRow.symbol, activeModalRow.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
          <button className="btn" onClick={closeQuickReview}>Cerrar</button>
        </div>
      </div>

      <div className={`quickReviewSourceBrief mode-${modalReviewQueueMode}`} aria-label="Origen de la cola Review">
        <span>
          <em>Origen cola</em>
          <b>{modalOriginLabel}</b>
        </span>
        {modalReviewSourceDetail ? <p>{modalReviewSourceDetail}</p> : <p>{modalReviewRows.length} acciones abiertas desde el Screener.</p>}
        <small>{modalReviewRows.length} acciones · {modalReviewPosition + 1}/{modalReviewRows.length}</small>
      </div>

      <ScreenerOriginPanel origin={quickReviewOrigin} variant="review" />
      <div className="reviewResolveRail quickReviewResolveRail" aria-label="Resolver decision desde Vista rápida">
        <span>{modalActiveResolution ? `Resolución: ${modalActiveResolution.label}` : "Resolver cola"}</span>
        <div>
          <button
            type="button"
            className={`neutral ${!modalActiveResolution ? "active" : ""}`.trim()}
            onClick={() => reopenQuickReviewDecision(activeModalRow, modalReviewPosition)}
            disabled={!modalActiveResolution}
            title="Vuelve a pendiente"
          >
            Reabrir
          </button>
          {STOCK_DECISION_ACTIONS.map((item) => <button
            type="button"
            key={item.key}
            className={`${item.tone || ""} ${modalActiveResolution?.key === item.key ? "active" : ""}`.trim()}
            onClick={() => resolveQuickReviewDecision(item.key, activeModalRow, modalReviewPosition, modalReviewQueueItems)}
            title={item.detail}
          >
            {item.label}
          </button>)}
        </div>
      </div>
      {!quickReviewOrigin?.decisionBrief && modalRankExplain ? <div className={`reviewThesisBar ${modalRankExplain.readiness.tone}`}>
        <span className="reviewDecisionPills">
          <span className={`rankActionBadge ${modalRankExplain.action.tone}`}>{modalRankExplain.action.label}</span>
          <span className={`rankDecisionBadge ${modalRankExplain.readiness.tone}`}>{modalRankExplain.readiness.label}</span>
        </span>
        <b>{modalRankExplain.line}</b>
        <small>{modalRankExplain.readiness.detail}</small>
      </div> : null}

      <div className="screenerReviewLayout">
        <aside className="reviewQueue screenerReviewQueue" aria-label="Cola de acciones del screener">
          <div className="reviewQueueHead">
            <h2>Cola</h2>
            <span>{modalReviewRows.length}</span>
          </div>
          {modalReviewAuditSummary.length ? <div className="reviewQueueSummary reviewQueueAuditSummary" aria-label="Resumen de auditoría de la cola">
            {modalReviewAuditSummary.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`reviewQueueSummaryChip audit-${item.key} ${item.tone || "neutral"} ${item.active ? "active" : ""}`}
                onClick={() => selectQuickReview(item.firstIndex, modalReviewRows)}
                disabled={!item.count}
                title={item.detail}
              >
                <b>{item.count}</b>
                <span>{item.label}</span>
              </button>
            ))}
          </div> : null}
          {modalReviewPrioritySummary.length ? <div className="reviewQueueSummary reviewPrioritySummary" aria-label="Prioridad de investigacion">
            {modalReviewPrioritySummary.map((group) => (
              <button
                type="button"
                key={group.key}
                className={`reviewQueueSummaryChip priority-${group.key} ${group.tone || "neutral"} ${modalReviewQueueItems[modalReviewPosition]?.reviewPriority?.key === group.key ? "active" : ""}`}
                onClick={() => selectQuickReview(group.firstIndex, modalReviewRows)}
                title={[group.topSymbol ? `${group.topSymbol} · ${Math.round(group.topScore || 0)}` : "", group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label].filter(Boolean).join(" · ")}
              >
                <b>{group.count}</b>
                <span>{group.shortLabel || group.label}</span>
              </button>
            ))}
          </div> : null}
          {modalReviewProfileSummary.length ? <div className="reviewQueueSummary reviewQueueProfileSummary" aria-label="Prioridad de cola por perfil">
            {modalReviewProfileSummary.map((group) => (
              <button
                type="button"
                key={group.key}
                className={`reviewQueueSummaryChip profile-${group.key} ${group.tone || "neutral"} ${modalReviewQueueItems[modalReviewPosition]?.profileKey === group.key ? "active" : ""}`}
                onClick={() => selectQuickReview(group.firstIndex, modalReviewRows)}
                title={group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label}
              >
                <b>{group.count}</b>
                <span>{group.label}</span>
              </button>
            ))}
          </div> : null}
          {modalReviewQueueSummary.groups.length ? <div className="reviewQueueSummary" aria-label="Resumen de cola por decision">
            {modalReviewQueueSummary.groups.map((group) => (
              <button
                type="button"
                key={group.key}
                className={`reviewQueueSummaryChip ${group.tone || "neutral"} ${modalReviewQueueItems[modalReviewPosition]?.readiness?.key === group.key ? "active" : ""}`}
                onClick={() => selectQuickReview(group.firstIndex, modalReviewRows)}
                title={group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label}
              >
                <b>{group.count}</b>
                <span>{group.label}</span>
              </button>
            ))}
          </div> : null}
          <div className="reviewQueueList">
            {modalReviewRows.map((row, index) => {
              const decision = modalReviewQueueItems[index] || buildDecisionQueueItem(row, activeSettings);
              const resolution = decisionResolutionForSymbol({ decisionResolutions: modalDecisionResolutions }, row.symbol);
              return <Link
                key={`${row.symbol}-${index}`}
                href={stockUrl(row.symbol)}
                onPointerDown={() => saveQuickReviewStockOpen(row, index)}
                onClick={() => saveQuickReviewStockOpen(row, index)}
                className={`reviewQueueItem ${index === modalReviewPosition ? "active" : ""} decision-${decision.readiness?.key || "unknown"} score-audit-${decision.scoreAudit?.key || "unknown"} data-health-${decision.dataHealth?.key || "unknown"} metric-truth-${decision.metricTruth?.key || "unknown"} focus-${decision.focus?.key || "none"} ${resolution ? `resolved-${resolution.key}` : ""}`}
                aria-current={index === modalReviewPosition ? "true" : undefined}
                title={resolution ? `${resolution.label} · ${resolution.detail}` : [decision.focus ? `Foco ${decision.focus.label}: ${decision.focus.detail || ""}` : "", `${decision.nextAction?.value || "Revisar"} · ${decision.risk?.value || row.symbol}`].filter(Boolean).join(" · ")}
              >
                <CompanyMark row={row} size="sm" />
                <span className="reviewQueueBody">
                  <b>{row.symbol}</b>
                  <em>{row.companyName || row.name || row.symbol}</em>
                  <RowTrustSignature signature={decision.trustSignature} className="reviewQueueTrustSignature" />
                  <span className="reviewQueueDecisionLine">
                    <span className={`reviewQueueDecisionBadge ${decision.tone || "neutral"}`}>{decision.nextAction?.value || decision.action?.label || "Revisar"}</span>
                    {resolution ? <span className={`reviewQueueResolutionBadge ${resolution.tone || "neutral"}`}>{resolution.label}</span> : null}
                    <ReviewQueueFocusBadge focus={decision.focus} />
                    {decision.reviewPriority ? <span className={`reviewQueuePriorityBadge ${decision.reviewPriority.tone || "neutral"}`} title={decision.reviewPriority.reason}>{decision.reviewPriority.shortLabel || decision.reviewPriority.label}</span> : null}
                    {decision.profileKey && decision.profileKey !== "other" ? <span className={`reviewQueueProfileBadge ${decision.profileTone || "neutral"}`}>{decision.profileLabel}</span> : null}
                    {decision.methodologyFocus ? <span className={`reviewQueueMethodologyBadge ${decision.methodologyFocus.tone || "neutral"}`} title={decision.methodologyFocus.detail || decision.methodologyFocus.label}>Método: {decision.methodologyFocus.shortLabel || decision.methodologyFocus.label}</span> : null}
                    {decision.dataHealth ? <span className={`reviewQueueDataHealthBadge ${decision.dataHealth.tone || "neutral"} data-${decision.dataHealth.key || "unknown"}`} title={decision.dataHealth.detail || decision.dataHealth.label}>{decision.dataHealth.label}</span> : null}
                    {decision.metricTruth ? <span className={`reviewQueueMetricTruthBadge ${decision.metricTruth.tone || "neutral"} metric-${decision.metricTruth.key || "unknown"}`} title={decision.metricTruth.detail || decision.metricTruth.label}>{decision.metricTruth.label}</span> : null}
                    {decision.scoreAudit ? <span className={`reviewQueueScoreAuditBadge ${decision.scoreAudit.tone || "neutral"} score-${decision.scoreAudit.key || "unknown"}`} title={decision.scoreAudit.detail || decision.scoreAudit.label}>{decision.scoreAudit.label}</span> : null}
                    {decision.risk?.value ? <small>{decision.risk.value}</small> : null}
                  </span>
                </span>
                <i>{decision.score ?? (Number.isFinite(row.objectiveScore) ? Math.round(row.objectiveScore) : Number.isFinite(row.totalScore) ? Math.round(row.totalScore) : "-")}</i>
              </Link>;
            })}
          </div>
        </aside>

        <div className="screenerReviewMain">
          <div className="profileGrid quickReviewGrid">
            <div className="profileChartArea">
              <ChartPreferences settings={chartSettings} onChange={updateChartSettings} symbol={activeModalRow.symbol} listId={chartListId} scope={chartScope} onScopeChange={updateChartScope} compact />
              <div className="quickReviewChart">
                <RowPreviewChart row={activeModalRow} chartSettings={chartSettings} />
              </div>
              <div className="perfStrip">
                <div className="perfBox"><span>1S</span><b className={(activeModalRow.perf1w || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf1w || 0)}</b></div>
                <div className="perfBox"><span>1M</span><b className={(activeModalRow.perf1m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf1m || 0)}</b></div>
                <div className="perfBox"><span>3M</span><b className={(activeModalRow.perf3m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf3m || 0)}</b></div>
                <div className="perfBox"><span>6M</span><b className={(activeModalRow.perf6m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf6m || 0)}</b></div>
                <div className="perfBox"><span>YTD</span><b className={(activeModalRow.perfYtd || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perfYtd || 0)}</b></div>
                <div className="perfBox"><span>1A</span><b className={(activeModalRow.perf12m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf12m || 0)}</b></div>
              </div>
            </div>

            <div className="profileSide">
              <ReviewPriorityPanel priority={modalActiveReviewPriority} compact />
              <DecisionEvidenceChecklist evidence={modalDecisionEvidence} compact />
              <ScoreAuditPanel audit={modalScoreAudit} />

              <div className="profileCard quickBusinessCard">
                <div className="profileCardHeader">
                  <h3>Negocio</h3>
                  <span>Resumen</span>
                </div>
                <div className="quickBusinessBody">
                  <p>{quickBusinessDescription(activeModalRow)}</p>
                </div>
                <div className="profileRow"><span>Actividad</span><b>{shortBusiness(activeModalRow) || "-"}</b></div>
                <div className="profileRow"><span>Mercado</span><b>{quickBusinessMarket(activeModalRow)}</b></div>
              </div>

              <div className="profileCard">
                <div className="profileCardHeader">
                  <h3>Métricas técnicas</h3>
                  <span>Score</span>
                </div>
                <div className="profileRow"><span>Capitalización</span><b>{amount(activeModalRow.marketCap, activeModalRow.currency) || "-"}</b></div>
                <div className="profileRow"><span>{metricShortLabel("objectiveScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="objectiveScore" label={metricShortLabel("objectiveScore")} value={activeModalRow.objectiveScore?.toFixed(0) || activeModalRow.totalScore?.toFixed(0) || "-"} className="up" /></div>
                <div className="profileRow"><span>{metricShortLabel("totalScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="totalScore" label={metricShortLabel("totalScore")} value={activeModalRow.totalScore?.toFixed(0) || "-"} /></div>
                <div className="profileRow"><span>{metricShortLabel("rsGlobalPct")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="rsGlobalPct" label={metricShortLabel("rsGlobalPct")} value={activeModalRow.weeklyRsAvailable === true ? activeModalRow.weeklyRsRating?.toFixed(0) : "-"} /></div>
                <div className="profileRow"><span>{metricShortLabel("rsQualityScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="rsQualityScore" label={metricShortLabel("rsQualityScore")} value={activeModalRow.rsQualityScore?.toFixed(0) || "-"} /></div>
                <div className="profileRow"><span>{metricShortLabel("adProxyScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="adProxyScore" label={metricShortLabel("adProxyScore")} value={activeModalRow.adProxyScore?.toFixed(0) || "-"} /></div>
                <div className="profileRow"><span>{metricShortLabel("epsGrowthProxyScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="epsGrowthProxyScore" label={metricShortLabel("epsGrowthProxyScore")} value={activeModalRow.epsGrowthProxyScore?.toFixed(0) || "-"} /></div>
                <div className="profileRow"><span>Setup quality</span><QuickReviewMetricValue row={activeModalRow} metricKey="setupQualityScore" label="Setup quality" value={activeModalRow.setupQualityScore?.toFixed(0) || "-"} /></div>
                <div className="profileRow"><span>Growth</span><QuickReviewMetricValue row={activeModalRow} metricKey="growthScore" label="Growth" value={activeModalRow.growthScore?.toFixed(0) || "-"} /></div>
                <div className="profileRow"><span>Rentabilidad/riesgo</span><QuickReviewMetricValue row={activeModalRow} metricKey="riskRewardScore" label="Rentabilidad/riesgo" value={activeModalRow.riskRewardScore?.toFixed(0) || "-"} /></div>
              </div>

              <div className="profileCard">
                <div className="profileCardHeader">
                  <h3>Volumen y riesgo</h3>
                  <span>Datos</span>
                </div>
                <div className="profileRow"><span>Volumen sesión</span><QuickReviewMetricValue row={activeModalRow} metricKey="latestTurnover" label="Volumen sesión" value={amount(activeModalRow.latestTurnover, activeModalRow.currency) || "-"} /></div>
                <div className="profileRow"><span>Volumen 5d</span><QuickReviewMetricValue row={activeModalRow} metricKey="volumeSurgePct" label="Volumen 5d" value={pct(activeModalRow.volumeSurgePct)} className={(activeModalRow.volumeSurgePct || 0) > 0 ? "up" : ""} /></div>
                <div className="profileRow"><span>Up/down ratio</span><QuickReviewMetricValue row={activeModalRow} metricKey="upDownVolRatio" label="Up/down ratio" value={ratioLabel(activeModalRow.upDownVolRatio)} /></div>
                <div className="profileRow"><span>{metricShortLabel("shortPercentOfFloat")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="shortPercentOfFloat" label={metricShortLabel("shortPercentOfFloat")} value={pct(activeModalRow.shortPercentOfFloat)} /></div>
                <div className="profileRow"><span>Drawdown 3M</span><QuickReviewMetricValue row={activeModalRow} metricKey="maxDrawdown63d" label="Drawdown 3M" value={Number.isFinite(activeModalRow.maxDrawdown63d) ? `${activeModalRow.maxDrawdown63d.toFixed(1)}%` : "-"} className="down" /></div>
                <div className="profileRow"><span>Volatilidad</span><QuickReviewMetricValue row={activeModalRow} metricKey="volatility63d" label="Volatilidad" value={Number.isFinite(activeModalRow.volatility63d) ? `${activeModalRow.volatility63d.toFixed(1)}%` : "-"} /></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </dialog>;
}
