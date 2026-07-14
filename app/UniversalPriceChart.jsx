// app/UniversalPriceChart.jsx — wrapper + vista declarativa del chart
// (ADR chart-controller-extraction §5.6, paso 7 de §9).
//
// Componente de presentación. Toda la orquestación vive en `useChartController`:
//   - fetch, aborto, generación (useChartDataModel);
//   - ciclo de vida del chart nativo (useChartController, vía chartNativeAdapter);
//   - viewport state + actions (useChartViewport);
//   - trendlines (useChartDrawings).
//
// Esta vista NO contiene:
//   - `useEffect`, `useMemo` de modelo, `useRef` nativas, import dinámico
//     de `lightweight-charts`;
//   - fetch, AbortController o selección local/remota;
//   - llamadas a `chart.timeScale()`;
//   - cálculo de MA/RS/markers/perfiles;
//   - guards `chartEstimated/dataQuality`;
//   - attach/detach de drawings.
//
// El controlador entrega `viewModel` (declarativo, listo para JSX) y
// `actions` (closures ya construidos).

"use client";

import { ChevronLeft, ChevronRight, Maximize2, SkipForward, TrendingUp, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";
import { useChartController } from "@/app/useChartController";

const fmt = (n) => Number.isFinite(n) ? n.toLocaleString("es-ES") : "Sin dato";
const pct = (n) => Number.isFinite(n) ? `${n.toFixed(1)}%` : "Sin dato";

/**
 * Vista declarativa. Recibe el output del controller. NO calcula nada por
 * su cuenta. Si necesita un controller falso para tests estáticos, basta
 * con pasar `canvasRef`, `rsBadgeRef`, `viewModel`, `actions` y
 * `drawingToolbar` como props.
 */
export function UniversalPriceChartView({
  canvasRef,
  rsBadgeRef,
  viewModel,
  actions,
  drawingToolbar,
}) {
  const {
    status,
    header,
    badges,
    viewportRail,
    patternDiagnostic,
    rsLegend,
    notes,
    rootClassName,
  } = viewModel;

  const { symbol, latestClose, changePct, positive, rangeLabel, interval } = header;
  const qualityNotice = notes?.quality || null;
  const expandingNotice = notes?.expanding || null;
  const expansionFailedNotice = notes?.expansionFailed || null;
  const renderError = notes?.renderError || null;

  if (status !== "ready") {
    return (
      <div className={`universalChart empty ${rootClassName}`}>
        {notes && (qualityNotice || notes.expanding || notes.expansionFailed || notes.renderError) ? (
          <span className="universalChartEstimatedNote" role="status" title={qualityNotice?.title || ""}>
            {qualityNotice?.text || notes.expanding?.text || notes.expansionFailed?.text || notes.renderError || "Sin dato"}
          </span>
        ) : (
          <span className="universalChartEstimatedNote" role="status">Sin dato</span>
        )}
      </div>
    );
  }

  const toolActive = drawingToolbar?.toolActive || false;
  const viewStateClass = viewportRail.key === "unknown" ? "" : viewportRail.key;

  return (
    <div className={`universalChart ${toolActive ? "drawing" : ""} ${rootClassName}`.trim()}>
      <div className="universalChartHead">
        <div className="universalChartIdentity">
          <span className="universalChartSymbol">{symbol}</span>
          <div className="universalChartQuote">
            <b>{fmt(latestClose)}</b>
            <em className={positive ? "positive" : "negative"}>{pct(changePct)}</em>
          </div>
        </div>
        {rsLegend?.enabled && (
          <div className={`universalChartBadges ${Number.isFinite(Number(badges?.rsMainScore)) ? "" : "muted"}`} title="RS global del snapshot activo. No cambia con el rango del grafico.">
            <span>RS global</span>
            <b>{Number.isFinite(Number(badges?.rsMainScore)) ? Number(badges.rsMainScore).toFixed(0) : "Sin dato"}</b>
          </div>
        )}
        {rsLegend?.enabled && rsLegend.intradayMuted && (
          <div className="universalChartBadges muted" title="La linea RS se calcula con cierre diario y se oculta en intradia">
            <span>RS</span>
            <b>D</b>
          </div>
        )}
        {badges?.pattern && (
          <div className={`universalChartPatternBadge ${badges.pattern.tone || ""}`} title={badges.pattern.reason || ""}>
            <span>{badges.pattern.shortLabel}</span>
            <b>{badges.pattern.evidence}</b>
          </div>
        )}
        <div className="universalChartScopeBadge" title="Rango e intervalo aplicados">
          <span>Vista</span>
          <b>{rangeLabel} · {interval}</b>
        </div>
        <div className="universalChartNavGroup" aria-label="Navegación del gráfico">
          <span className={`universalChartViewState ${viewportRail.manual ? "away" : ""}`} title={viewportRail.mode}>
            <em>{viewportRail.mode}</em>
            {viewportRail.bars ? <b>{viewportRail.bars}</b> : null}
          </span>
          <button type="button" className="universalChartNavButton icon" onClick={() => actions.pan(-1)} disabled={!viewportRail.manual} aria-label="Mover ventana hacia el historial" title="Mover ventana hacia el historial"><ChevronLeft size={15} aria-hidden="true" /></button>
          <button type="button" className="universalChartNavButton icon" onClick={() => actions.pan(1)} disabled={!viewportRail.manual} aria-label="Mover ventana hacia el último dato" title="Mover ventana hacia el último dato"><ChevronRight size={15} aria-hidden="true" /></button>
          <button type="button" className="universalChartNavButton icon" onClick={() => actions.zoom(0.72)} aria-label="Acercar gráfico" title="Acercar"><ZoomIn size={14} aria-hidden="true" /></button>
          <button type="button" className="universalChartNavButton icon" onClick={() => actions.zoom(1.38)} aria-label="Alejar gráfico" title="Alejar"><ZoomOut size={14} aria-hidden="true" /></button>
          <button type="button" className="universalChartNavButton icon" onClick={actions.reset} disabled={!viewportRail.manual} aria-label="Restaurar rango seleccionado" title="Restaurar el rango seleccionado"><Maximize2 size={14} aria-hidden="true" /></button>
          <button
            type="button"
            className={`universalChartNavButton icon ${toolActive ? "active" : ""}`.trim()}
            onClick={actions.toggleDrawing}
            aria-pressed={toolActive}
            aria-label="Dibujar línea de tendencia"
            title={toolActive ? "Salir de herramienta de dibujo" : "Dibujar línea de tendencia"}
          >
            <TrendingUp size={14} aria-hidden="true" />
          </button>
          {drawingToolbar?.hasSelection && (
            <button
              type="button"
              className="universalChartNavButton icon accent"
              onClick={actions.removeSelectedDrawing}
              aria-label="Borrar línea seleccionada"
              title="Borrar línea seleccionada"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
          {viewportRail.distance && (
            <button type="button" className="universalChartNavButton icon accent" onClick={actions.scrollToLatest} aria-label="Volver al último dato sin cambiar el zoom" title="Volver al último dato sin cambiar el zoom"><SkipForward size={14} aria-hidden="true" /></button>
          )}
        </div>
      </div>
      <div
        className={`universalChartViewportRail ${viewportRail.manual ? "manual" : "auto"} ${viewStateClass}`}
        aria-label="Estado del rango visible"
        aria-live="polite"
        data-view-mode={viewportRail.key}
        data-manual={viewportRail.manual ? "true" : "false"}
        data-window-label={viewportRail.window}
        title={viewportRail.manual ? "Ventana manual activa" : "Vista anclada al último dato"}
      >
        <span className="universalChartViewportChip mode">
          <em>Modo</em>
          <b>{viewportRail.manual ? viewportRail.mode : "Último dato"}</b>
        </span>
        <span className="universalChartViewportChip window">
          <em>Ventana</em>
          <b>{viewportRail.window}</b>
        </span>
        <span className="universalChartViewportChip bars">
          <em>Barras</em>
          <b>{viewportRail.bars ? `${viewportRail.bars}` : "Sin dato"}</b>
        </span>
        {viewportRail.distance ? (
          <span className="universalChartViewportChip distance">
            <em>Hasta último</em>
            <b>{viewportRail.distance}</b>
          </span>
        ) : null}
        {viewportRail.drawing ? (
          <span className="universalChartViewportChip drawing">
            <em>Dibujo</em>
            <b>{viewportRail.drawing}</b>
          </span>
        ) : null}
      </div>
      <div className="universalChartCanvas" ref={canvasRef} style={{ "--chart-target-height": "460px" }} />
      {patternDiagnostic && (
        <div className="vcpDiagnosticPanel" aria-label="Diagnóstico VCP" title={patternDiagnostic.objective?.detail || patternDiagnostic.reason || ""}>
          <div className="vcpDiagnosticHead">
            <span>Compresiones</span>
            <b>{patternDiagnostic.objective?.primary || patternDiagnostic.evidence}</b>
          </div>
          <div className="vcpDiagnosticGates">
            {patternDiagnostic.gates.map((item) => (
              <span key={item.key} className={`vcpGate ${item.state}`} title={[item.label, item.detail].filter(Boolean).join(" · ")}>
                <em>{item.label}</em>
                <b>{item.detail}</b>
                {item.mark ? <i aria-hidden="true">{item.mark}</i> : null}
              </span>
            ))}
          </div>
          {patternDiagnostic.contractions.length > 0 && (
            <div className="vcpDiagnosticContractions">
              {patternDiagnostic.contractions.map((item) => (
                <span key={`${item.label}-${item.toDate}`}>
                  <b>{item.label}</b>
                  <em>{item.depthPct != null ? `${item.depthPct.toFixed(1)}%` : "sin dato"}</em>
                  <small>{item.toDate}</small>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {Number.isFinite(Number(latestClose)) && (
        <div
          ref={rsBadgeRef}
          className="universalRsLineBadge"
          title={Number.isFinite(Number(changePct)) ? `RS del rango ${rangeLabel}: ${changePct.toFixed(1)}% vs benchmark.` : `RS del rango ${rangeLabel}`}
        >
          <span>RS {rangeLabel}</span>
          <b>{fmt(latestClose)}</b>
        </div>
      )}
      {rsLegend?.enabled && (
        <div className={`universalRsInlineLegend ${rsLegend.intradayMuted ? "muted" : ""}`}>
          <span>{rsLegend.intradayMuted ? "RS" : "RS línea"}</span>
          {rsLegend.intradayMuted && <em>Sin serie relativa suficiente</em>}
        </div>
      )}
      {qualityNotice && <p className="universalChartEstimatedNote" role="status" title={qualityNotice.title}>{qualityNotice.text}</p>}
      {expandingNotice && <p className="dataNote">{expandingNotice.text}</p>}
      {expansionFailedNotice && <p className="dataNote">{expansionFailedNotice.text}</p>}
      {renderError && <p className="dataNote">{renderError}</p>}
    </div>
  );
}

export default function UniversalPriceChart(props = {}) {
  const controller = useChartController(props);
  return (
    <UniversalPriceChartView
      canvasRef={controller.canvasRef}
      rsBadgeRef={controller.rsBadgeRef}
      viewModel={controller.viewModel}
      actions={controller.actions}
      drawingToolbar={controller.drawingToolbar}
    />
  );
}
