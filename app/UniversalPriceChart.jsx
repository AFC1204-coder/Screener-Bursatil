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
//   - guard de `dataQuality` (la calidad P0 se aplica en el data model,
//     no en esta vista);
//   - attach/detach de drawings.
//
// El controlador entrega `viewModel` (declarativo, listo para JSX) y
// `actions` (closures ya construidos).

"use client";

import { cloneElement, isValidElement } from "react";
import { BadgeInfo, ChevronLeft, ChevronRight, Maximize2, SkipForward, TrendingUp, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";
import { useChartController } from "@/app/useChartController";

const fmt = (n) => Number.isFinite(n) ? n.toLocaleString("es-ES") : "Sin dato";
const pct = (n) => Number.isFinite(n) ? `${n.toFixed(1)}%` : "Sin dato";

/**
 * Vista declarativa. Recibe el output del controller. NO calcula nada por
 * su cuenta. Si necesita un controller falso para tests estáticos, basta
 * con pasar `canvasRef`, `viewModel`, `actions` y
 * `drawingToolbar` como props.
 */
export function UniversalPriceChartView({
  canvasRef,
  viewModel,
  actions,
  drawingToolbar,
  // Cuadro de identidad del lienzo (solo la ficha lo pasa; el resto de
  // superficies del chart —previews del screener, quick review— no lo tienen).
  // El estado del pliegue vive en el caller: aquí solo se pinta.
  identityCard = null,
  identityCollapsed = false,
  onToggleIdentity = null,
}) {
  const {
    status,
    header,
    badges,
    viewportRail,
    patternDiagnostic,
    rsLegend,
    rsCountryLegend,
    rsThemeLegend,
    notes,
    emptyFallback,
    rootClassName,
  } = viewModel;

  // `header.rangeLabel` y `header.interval` siguen en el viewModel (contrato
  // público) pero ya no se rotulan aquí: los controles activos son la fuente.
  const { symbol, latestClose, changePct, positive } = header;
  const qualityNotice = notes?.quality || null;
  const expandingNotice = notes?.expanding || null;
  const expansionFailedNotice = notes?.expansionFailed || null;
  const renderError = notes?.renderError || null;

  if (status !== "ready") {
    const emptyText = String(emptyFallback?.text || "").trim() || "Sin dato";
    return (
      <div className={`universalChart empty ${rootClassName}`}>
        <span
          className="universalChartEstimatedNote"
          role="status"
          title={emptyFallback?.title || ""}
        >
          {emptyText}
        </span>
      </div>
    );
  }

  const toolActive = drawingToolbar?.toolActive || false;
  const viewStateClass = viewportRail.key === "unknown" ? "" : viewportRail.key;
  // Con la tarjeta de identidad VISIBLE, la fila del head desaparece: su
  // ticker/precio/badge de RS viven dentro de la tarjeta, y el badge de
  // patrón + la botonera flotan sobre la esquina superior derecha del lienzo
  // (cuarta iteración, 2026-08-21: la fila dejaba una banda muerta encima de
  // la tarjeta). Al plegar la tarjeta —o donde no la hay (previews del
  // screener)— el head vuelve como fila normal con todo dentro.
  const identityCardShown = Boolean(identityCard) && !identityCollapsed;
  const patternBadge = badges?.pattern ? (
    <div className={`universalChartPatternBadge ${badges.pattern.tone || ""}`} title={badges.pattern.reason || ""}>
      <span>{badges.pattern.shortLabel}</span>
      <b>{badges.pattern.evidence}</b>
    </div>
  ) : null;
  const intradayRsBadge = rsLegend?.enabled && rsLegend.intradayMuted ? (
    <div className="universalChartBadges muted" title="La linea RS se calcula con cierre diario y se oculta en intradia">
      <span>RS</span>
      <b>D</b>
    </div>
  ) : null;
  // Izquierda: en fit completo (!manual) siempre; con manual solo si queda historial.
  // Derecha: solo con hueco hacia el último dato tras haber desplazado.
  const panLeftOff = viewportRail.manual && !viewportRail.canPanLeft;
  const panRightOff = viewportRail.manual && !viewportRail.canPanRight;
  const resetDisabled = !viewportRail.manual;
  const navGroup = (
    <div className="universalChartNavGroup" aria-label="Navegación del gráfico">
          <button type="button" className="universalChartNavButton icon" onClick={() => actions.pan(-1)} disabled={panLeftOff} aria-label="Mover ventana hacia el historial" title={panLeftOff ? "No hay más historial en esta ventana" : "Mover ventana hacia el historial"}><ChevronLeft size={15} aria-hidden="true" /></button>
          <button type="button" className="universalChartNavButton icon" onClick={() => actions.pan(1)} disabled={panRightOff} aria-label="Mover ventana hacia el último dato" title={panRightOff ? "Ya estás en el extremo reciente" : "Mover ventana hacia el último dato"}><ChevronRight size={15} aria-hidden="true" /></button>
          <button type="button" className="universalChartNavButton icon" onClick={() => actions.zoom(0.72)} aria-label="Acercar gráfico" title="Acercar"><ZoomIn size={14} aria-hidden="true" /></button>
          <button type="button" className="universalChartNavButton icon" onClick={() => actions.zoom(1.38)} aria-label="Alejar gráfico" title="Alejar"><ZoomOut size={14} aria-hidden="true" /></button>
          <button type="button" className="universalChartNavButton icon" onClick={actions.reset} disabled={resetDisabled} aria-label="Restaurar rango seleccionado" title={resetDisabled ? "Sin ventana manual que restaurar" : "Restaurar el rango seleccionado"}><Maximize2 size={14} aria-hidden="true" /></button>
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
          {/* Toggle de la tarjeta de identidad. Vive AQUÍ, en la botonera
              —fuera del lienzo— a propósito: una captura del área de dibujo
              no debe llevar nunca el control de plegar (análisis 2026-08-21,
              A3). */}
          {identityCard && (
            <button
              type="button"
              className={`universalChartNavButton icon ${identityCollapsed ? "" : "active"}`.trim()}
              onClick={() => onToggleIdentity?.()}
              aria-pressed={!identityCollapsed}
              aria-label={identityCollapsed ? "Mostrar tarjeta de identidad" : "Plegar tarjeta de identidad"}
              title={identityCollapsed ? "Mostrar la tarjeta de identidad sobre el gráfico" : "Plegar la tarjeta de identidad (se vuelve a mostrar al cambiar de valor)"}
            >
              <BadgeInfo size={14} aria-hidden="true" />
            </button>
          )}
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
  );

  return (
    <div className={`universalChart ${toolActive ? "drawing" : ""} ${identityCardShown ? "identityCardShown" : ""} ${rootClassName}`.trim()}>
      {!identityCardShown && (
        <div className="universalChartHead">
          <div className="universalChartIdentity">
            <span className="universalChartSymbol">{symbol}</span>
            <div className="universalChartQuote">
              <b>{fmt(latestClose)}</b>
              <em
                className={positive ? "positive" : "negative"}
                title="Variación de la última barra del intervalo activo (en diario, la última sesión)"
              >
                {pct(changePct)}
              </em>
            </div>
          </div>
          {rsLegend?.enabled && (
            <div className={`universalChartBadges ${Number.isFinite(Number(badges?.rsMainScore)) ? "" : "muted"}`} title="RS global del snapshot activo. No cambia con el rango del grafico.">
              <span>RS global</span>
              <b>{Number.isFinite(Number(badges?.rsMainScore)) ? Number(badges.rsMainScore).toFixed(0) : "Sin dato"}</b>
            </div>
          )}
          {rsCountryLegend?.enabled && (
            <div className={`universalChartBadges ${Number.isFinite(Number(badges?.countryRsScore)) ? "" : "muted"}`} title="RS país · ranking semanal intra-mercado. No cambia con el rango del gráfico.">
              <span>RS país</span>
              <b>{Number.isFinite(Number(badges?.countryRsScore)) ? Number(badges.countryRsScore).toFixed(0) : "Sin dato"}</b>
            </div>
          )}
          {rsThemeLegend?.enabled && (
            <div className={`universalChartBadges ${Number.isFinite(Number(badges?.themeRsScore)) ? "" : "muted"}`} title="RS tema · ranking semanal intra-ocupación. No cambia con el rango del gráfico.">
              <span>RS tema</span>
              <b>{Number.isFinite(Number(badges?.themeRsScore)) ? Number(badges.themeRsScore).toFixed(0) : "Sin dato"}</b>
            </div>
          )}
          {intradayRsBadge}
          {patternBadge}
          {/* El badge «Vista rango·intervalo» y el chip de modo/barras se
              eliminaron (principio 2): duplicaban los controles activos de
              RANGO/TEMPORALIDAD —a un centímetro— y el raíl de ventana. */}
          {navGroup}
        </div>
      )}
      {/* Raíl de estado: solo existe cuando hay algo que NO cuentan ya los
          controles o el eje — una desviación manual de la ventana o la
          herramienta de dibujo activa. El estado por defecto («todo el rango,
          anclado al último dato») no se rotula: es el contrato. aria-live
          anuncia la transición a manual. */}
      {(viewportRail.manual || viewportRail.drawing) && (
        <div
          className={`universalChartViewportRail ${viewportRail.manual ? "manual" : "auto"} ${viewStateClass}`}
          aria-label="Estado del rango visible"
          aria-live="polite"
          data-view-mode={viewportRail.key}
          data-manual={viewportRail.manual ? "true" : "false"}
          data-window-label={viewportRail.window}
          title={viewportRail.manual ? "Ventana manual activa — «Restaurar» vuelve al rango completo" : "Herramienta de dibujo activa"}
        >
          {viewportRail.manual && (
            <>
              <span className="universalChartViewportChip mode">
                <em>{viewportRail.mode}</em>
                <b>{viewportRail.window}</b>
              </span>
              <span className="universalChartViewportChip bars">
                <em>Barras</em>
                <b>{viewportRail.bars ? `${viewportRail.bars}` : "Sin dato"}</b>
              </span>
            </>
          )}
          {viewportRail.drawing ? (
            <span className="universalChartViewportChip drawing">
              <em>Dibujo</em>
              <b>{viewportRail.drawing}</b>
            </span>
          ) : null}
        </div>
      )}
      {/* El wrapper existe solo para anclar el cuadro de identidad al área de
          dibujo (position:relative). No toca el comportamiento del chart: el
          div del ref sigue siendo el mismo y lightweight-charts monta dentro
          de él exactamente igual. */}
      <div className="universalChartCanvasWrap">
        <div className="universalChartCanvas" ref={canvasRef} style={{ "--chart-target-height": "460px" }} />
        {identityCardShown && (
          /* Con la tarjeta visible, el badge de patrón y la botonera flotan
             sobre la esquina superior derecha del lienzo: la fila del head
             que ocupaban era la banda muerta que impedía a la tarjeta llegar
             al borde superior real del panel. */
          <div className="universalChartFloatControls">
            {intradayRsBadge}
            {patternBadge}
            {navGroup}
          </div>
        )}
        {identityCard && !identityCollapsed && (
          /* Tarjeta de identidad sobre el lienzo (variante 2c encogida —
             ChartIdentityCard.jsx en la ficha construye el contenido; aquí
             solo se posiciona). Clic en la tarjeta = plegar (gesto
             secundario; el control primario está en la botonera, fuera del
             lienzo). Sin icono de cierre DENTRO: saldría en todas las
             capturas, que es lo que se quiere evitar. Los InfoHint de las
             ausencias son interactivos y no deben plegar. */
          <div
            className="chartIdentityCard"
            role="button"
            tabIndex={0}
            aria-label="Tarjeta de identidad del valor. Activar para plegarla; se vuelve a mostrar al cambiar de valor."
            title="Clic para plegar la tarjeta (el botón ⓘ de la botonera la devuelve)"
            onClick={(event) => {
              if (event.target.closest?.(".infoHint")) return;
              onToggleIdentity?.();
            }}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                event.preventDefault();
                onToggleIdentity?.();
              }
            }}
          >
            {/* La fila del ticker y el precio la pinta la propia tarjeta:
                se le inyecta aquí el `quote` con la misma fuente (el header
                del viewModel) que el head muestra cuando está plegada. */}
            {isValidElement(identityCard)
              ? cloneElement(identityCard, {
                  quote: {
                    symbol,
                    priceText: fmt(latestClose),
                    changeText: pct(changePct),
                    positive,
                  },
                })
              : identityCard}
          </div>
        )}
      </div>
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
      {/* La leyenda flotante rotulaba la línea RS sobre el lienzo del precio,
          que era donde la línea vivía. Ahora el RS tiene panel y eje propios,
          y el eje ya la identifica: repetirlo flotando encima solo tapa
          gráfico. Queda solo para intradía, donde no hay panel y hay que
          decir por qué. La ausencia por histórico va abajo, con las demás
          notas de dato, donde se lee. */}
      {rsLegend?.enabled && rsLegend.intradayMuted && (
        <div className="universalRsInlineLegend muted">
          <span>RS</span>
          <em>Sin serie relativa suficiente</em>
        </div>
      )}
      {rsLegend?.absence && (
        <p className="dataNote universalRsAbsenceNote" role="status" title={rsLegend.absence.title}>{rsLegend.absence.text}</p>
      )}
      {rsCountryLegend?.absence && (
        <p className="dataNote universalRsAbsenceNote" role="status" title={rsCountryLegend.absence.title}>{rsCountryLegend.absence.text}</p>
      )}
      {rsThemeLegend?.absence && (
        <p className="dataNote universalRsAbsenceNote" role="status" title={rsThemeLegend.absence.title}>{rsThemeLegend.absence.text}</p>
      )}
      {qualityNotice && <p className="universalChartEstimatedNote" role="status" title={qualityNotice.title}>{qualityNotice.text}</p>}
      {expandingNotice && <p className="dataNote">{expandingNotice.text}</p>}
      {expansionFailedNotice && <p className="dataNote">{expansionFailedNotice.text}</p>}
      {notes?.info && <p className="dataNote" role="status" title={notes.info.title}>{notes.info.text}</p>}
      {renderError && <p className="dataNote">{renderError}</p>}
    </div>
  );
}

export default function UniversalPriceChart(props = {}) {
  const controller = useChartController(props);
  return (
    <UniversalPriceChartView
      canvasRef={controller.canvasRef}
      viewModel={controller.viewModel}
      actions={controller.actions}
      drawingToolbar={controller.drawingToolbar}
      identityCard={props.identityCard}
      identityCollapsed={props.identityCollapsed}
      onToggleIdentity={props.onToggleIdentity}
    />
  );
}
