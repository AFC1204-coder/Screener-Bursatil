"use client";

// Vista rápida del screener, tras la limpieza del 2026-08-24
// (docs/analisis-vista-rapida-2026-08-24.md). Es la misma operación que se
// hizo en la ficha el 22 de agosto: el producto clasifica, no recomienda
// (docs/principios-producto.md §1), y el diagnóstico interno del programa no
// es un dato del valor (§2).
//
// RETIRADO de esta superficie, con su contenido:
//
//   - El panel de origen (ScreenerOriginPanel): contrato, «Acción / Confianza
//     / Freno», «prioridad N», «Métricas objetivas bloqueadas», «N proxy», el
//     snapshot con el percentil del lote bajo la etiqueta «RS», el desglose
//     del score con «Growth sin dato», y los avisos de revisión manual
//     («Riesgo severo: requiere revisión manual antes de entrar en cola»).
//     Era la mesa de observación retirada de la ficha el 22-08, resucitada
//     aquí por la otra dirección.
//   - La barra de tesis (acción + preparación del motor).
//   - La prioridad de investigación (ReviewPriorityPanel): «Decisión 260 ·
//     Acción −80 · Score objetivo 183» son constantes internas del motor de
//     ordenación (lib/decisionAudit.js), no datos del valor.
//   - El checklist de pruebas y el desglose del score (ScoreAuditPanel):
//     «pendiente 5/9», «bloqueadas», «arrastres», «componentes sin dato».
//     Su sitio auditable es N3 de la ficha, colapsado.
//   - Los rails de resumen de la cola (auditoría/prioridad/perfil/decisión) y
//     los nueve chips de veredicto por fila («Auditar antes», «Esperar
//     confirmación», foco, método, datos, métricas, score). La cola conserva
//     identidad, clasificación del inversor y RS canónico.
//   - De «Métricas técnicas», los siete scores compuestos (score, composite,
//     RS quality, A/D, EPS proxy, setup, growth, rent/riesgo) y las marcas de
//     procedencia proxy/bloqueada. Quedan los datos del valor: etapa, RS
//     canónico y capitalización.
//   - El bloque «Origen cola», que triplicaba el contador de la cabecera.
//
// El RS es ÚNICO en toda la superficie: el ranking semanal del universo
// (lib/rsCanonical.js). El percentil del lote no puede aparecer bajo esa
// etiqueta ni bajo ninguna otra en superficie de lectura.

import Link from "next/link";
import ChartPreferences from "@/app/ChartPreferences";
import { CompanyMark, RowPreviewChart } from "@/app/screenerPanels";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { amount, money, quickBusinessDescription, quickBusinessMarket, ratioLabel, shortBusiness } from "@/lib/screenerFormat";
import { pct, pctShare } from "@/lib/formatters";
import { PerformanceStrip } from "@/app/components/screener/PerformanceStrip";
import { canonicalRs } from "@/lib/rsCanonical";
import { stageDisplayForRow, stageWordForState } from "@/lib/stageDisplay";
import { stageLabel } from "@/lib/screenerPipeline";
import { externalLinks, stockUrl } from "@/lib/symbols";
import { STOCK_DECISION_ACTIONS, decisionResolutionForSymbol } from "@/lib/stockDecisionResolution";
import { buildTrendSupportLines, trendSupportInputFromScanRow } from "@/lib/trendSupport";

// La palabra de etapa sale del diccionario único (lib/stageDisplay.js): la
// misma que la columna «Etapa» de la tabla y que la ficha.
function stageWord(row = {}) {
  const display = stageDisplayForRow(row);
  if (display) {
    return display.qualifier ? `${display.word} · ${display.qualifier}` : display.word;
  }
  const rawStage = stageLabel(row);
  const stageInfo = stageWordForState(row.weeklyStageState || "", rawStage);
  return stageInfo?.word || (rawStage === "Sin dato" ? "Sin dato" : rawStage) || "Sin dato";
}

function TrendSupportMissing({ reason = "" }) {
  return (
    <span className="stockDescMissing">
      <span aria-hidden="true">–</span>
      <span className="srOnly">Sin dato</span>
      {reason ? <InfoHint text={reason} /> : null}
    </span>
  );
}

function TrendSupportLine({ line }) {
  return (
    <li className="stockDescTrendItem">
      {line.available
        ? <span>{line.text}</span>
        : <TrendSupportMissing reason={line.reason} />}
    </li>
  );
}

function QuickReviewTrendSupport({ row }) {
  const trendSupport = buildTrendSupportLines([], trendSupportInputFromScanRow(row));
  return (
    <div className="profileCard quickReviewTrendSupport" aria-label={trendSupport.title}>
      <div className="profileCardHeader">
        <h3>{trendSupport.title}</h3>
        <span>Lecturas</span>
      </div>
      <ul className="stockDescTrendList quickReviewTrendList">
        {trendSupport.lines.map((line) => (
          <TrendSupportLine key={line.key} line={line} />
        ))}
      </ul>
    </div>
  );
}

export default function QuickReviewModal({
  activeModalRow = null,
  chartListId = "",
  chartScope = "global",
  chartSettings = {},
  modalActiveResolution = null,
  modalDecisionResolutions = {},
  modalReviewPosition = 0,
  modalReviewRows = [],
  modalOriginLabel = "",
  closeQuickReview,
  moveQuickReview,
  reopenQuickReviewDecision,
  resolveQuickReviewDecision,
  saveQuickReviewStockOpen,
  updateChartScope,
  updateChartSettings,
}) {
  if (!activeModalRow) return null;

  // Lector único del RS (lib/rsCanonical.js). El mismo que usa la tabla del
  // screener, la ficha del valor y salud de mercado.
  const quickRs = canonicalRs(activeModalRow);

  return <dialog className="stockModal quickReviewModal" open onClick={(e) => { if (e.target === e.currentTarget) closeQuickReview(); }}>
    <div className="stockModalInner quickReviewInner">
      <div className="profileHeader quickReviewHeader">
        <div className="profileHeaderLeft quickReviewTitleBlock">
          <CompanyMark row={activeModalRow} size="lg" />
          <div>
            <div className="profileHeaderBreadcrumb">
              {modalOriginLabel || "Screener"} <span>/</span> Vista rápida <span>/</span> {modalReviewPosition + 1} de {modalReviewRows.length}
            </div>
            <div className="profileTitle">
              <h2>{activeModalRow.symbol}</h2>
              <span>{activeModalRow.companyName}</span>
            </div>
            <div className="profilePrice">
              <span className="price">{money(activeModalRow.price, activeModalRow.currency)}</span>
              {Number.isFinite(activeModalRow.perf3m) && (
                <span className={`change ${activeModalRow.perf3m >= 0 ? "up" : "down"}`}>
                  {pct(activeModalRow.perf3m)} 3M
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="profileHeaderRight quickReviewActions">
          <div className="quickReviewNavGroup" aria-label="Navegación de cola">
            <button className="btn" onClick={() => moveQuickReview(-1)} disabled={modalReviewRows.length < 2}>Anterior</button>
            <span className="quickReviewCounter">{modalReviewPosition + 1}/{modalReviewRows.length}</span>
            <button className="btn btnPrimary" onClick={() => moveQuickReview(1)} disabled={modalReviewRows.length < 2}>Siguiente</button>
          </div>
          <div className="quickReviewExitGroup" aria-label="Salida">
            <Link className="btn" href={stockUrl(activeModalRow.symbol)} onPointerDown={() => saveQuickReviewStockOpen(activeModalRow, modalReviewPosition)} onClick={() => saveQuickReviewStockOpen(activeModalRow, modalReviewPosition)}>Ficha</Link>
            <a className="btn" href={externalLinks(activeModalRow.symbol, activeModalRow.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
            <button className="btn" onClick={closeQuickReview}>Cerrar</button>
          </div>
        </div>
      </div>

      <div className="reviewResolveRail quickReviewResolveRail" aria-label="Clasificar desde Vista rápida">
        <span>{modalActiveResolution ? `Clasificación: ${modalActiveResolution.label}` : "Clasificar"}</span>
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
            onClick={() => resolveQuickReviewDecision(item.key, activeModalRow, modalReviewPosition)}
            title={item.detail}
          >
            {item.label}
          </button>)}
        </div>
      </div>

      <div className="screenerReviewLayout">
        <aside className="reviewQueue screenerReviewQueue" aria-label="Cola de acciones del screener">
          <div className="reviewQueueHead">
            <h2>Cola</h2>
            <span>{modalReviewRows.length}</span>
          </div>
          <div className="reviewQueueList">
            {modalReviewRows.map((row, index) => {
              const resolution = decisionResolutionForSymbol({ decisionResolutions: modalDecisionResolutions }, row.symbol);
              const rowRs = canonicalRs(row);
              return <Link
                key={`${row.symbol}-${index}`}
                href={stockUrl(row.symbol)}
                onPointerDown={() => saveQuickReviewStockOpen(row, index)}
                onClick={() => saveQuickReviewStockOpen(row, index)}
                className={`reviewQueueItem ${index === modalReviewPosition ? "active" : ""} ${resolution ? `resolved-${resolution.key}` : ""}`}
                aria-current={index === modalReviewPosition ? "true" : undefined}
                title={resolution ? `${resolution.label} · ${resolution.detail}` : row.companyName || row.symbol}
              >
                <CompanyMark row={row} size="sm" />
                <span className="reviewQueueBody">
                  <b>{row.symbol}</b>
                  <em>{row.companyName || row.name || row.symbol}</em>
                  {resolution ? <span className="reviewQueueDecisionLine">
                    <span className={`reviewQueueResolutionBadge ${resolution.tone || "neutral"}`}>{resolution.label}</span>
                  </span> : null}
                </span>
                <i title={rowRs.available ? "RS semanal del universo" : rowRs.reason}>{rowRs.available ? rowRs.value.toFixed(0) : "-"}</i>
              </Link>;
            })}
          </div>
        </aside>

        <div className="screenerReviewMain">
          <div className="profileGrid quickReviewGrid">
            <div className="profileChartArea">
              <ChartPreferences settings={chartSettings} onChange={updateChartSettings} symbol={activeModalRow.symbol} listId={chartListId} scope={chartScope} onScopeChange={updateChartScope} scopeLocked compact />
              <div className="quickReviewChart">
                <RowPreviewChart row={activeModalRow} chartSettings={chartSettings} />
              </div>
              <PerformanceStrip row={activeModalRow} />
            </div>

            <div className="profileSide">
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
                  <h3>El valor</h3>
                  <span>Clasificación</span>
                </div>
                <div className="profileRow"><span>Etapa</span><b title={stageDisplayForRow(activeModalRow)?.title || undefined}>{stageWord(activeModalRow)}</b></div>
                <div className="profileRow"><span>RS</span><b title={quickRs.available ? "RS semanal del universo" : quickRs.reason}>{quickRs.available ? quickRs.value.toFixed(0) : "-"}</b></div>
                <div className="profileRow"><span>Capitalización</span><b>{amount(activeModalRow.marketCap, activeModalRow.currency) || "-"}</b></div>
                <div className="profileRow"><span>Dist. máx 52s</span><b>{Number.isFinite(activeModalRow.distance52w) ? pct(activeModalRow.distance52w) : "-"}</b></div>
              </div>

              <QuickReviewTrendSupport row={activeModalRow} />

              <div className="profileCard">
                <div className="profileCardHeader">
                  <h3>Volumen y riesgo</h3>
                  <span>Datos</span>
                </div>
                <div className="profileRow"><span>Volumen sesión</span><b>{amount(activeModalRow.latestTurnover, activeModalRow.currency) || "-"}</b></div>
                <div className="profileRow"><span>Volumen 5d</span><b className={(activeModalRow.volumeSurgePct || 0) > 0 ? "up" : ""}>{pct(activeModalRow.volumeSurgePct)}</b></div>
                <div className="profileRow"><span>Up/down ratio</span><b>{ratioLabel(activeModalRow.upDownVolRatio)}</b></div>
                <div className="profileRow"><span>Short float</span><b>{pct(activeModalRow.shortPercentOfFloat)}</b></div>
                <div className="profileRow"><span>Drawdown 3M</span><b className="down">{Number.isFinite(activeModalRow.maxDrawdown63d) ? pctShare(activeModalRow.maxDrawdown63d, 1) : "-"}</b></div>
                <div className="profileRow"><span>Volatilidad</span><b>{Number.isFinite(activeModalRow.volatility63d) ? pctShare(activeModalRow.volatility63d, 1) : "-"}</b></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </dialog>;
}
