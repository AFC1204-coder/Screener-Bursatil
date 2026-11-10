// app/useChartController.js — compositor del chart controller.
//
// El controller es el ÚNICO dueño del ciclo de vida del chart nativo:
//   - crea y destruye el chart (transacción de creación §5.4 / §5.5 del ADR
//     chart-controller-extraction);
//   - compone las tres fronteras: data model, drawings/interaction, viewport;
//   - traduce la salida de las tres a un `viewModel` declarativo para la vista.
//
// Contrato de ventana (docs/analisis-grafico-2026-08-14.md, Parte C.1): el
// viewport es UNA instancia por montaje (`useChartViewport`); la ventana
// visible es el rango declarado entero salvo desviación manual explícita.
// Este controller no captura ni restaura ventanas: adjunta el chart y el
// lifecycle aplica el contrato.
//
// Reglas de la transacción:
//   - `chart.remove()` ocurre exactamente una vez por attachment, sólo aquí.
//   - `drawings.detach()` se llama ANTES de `viewport.detach()` y ANTES de
//     `chart.remove()` (orden inverso de creación).
//   - `controllerAttachmentId` invalida cualquier init en vuelo, incluido el
//     `await import("lightweight-charts")`. Una respuesta tardía no puede
//     instalar un chart después de que sus props hayan cambiado.
//   - Las series que entran como props (`rsRatingSeries`, `relativeStrength`,
//     `patternOverlay`) participan en las dependencias por HUELLA DE
//     CONTENIDO, no por identidad: un fetch que devuelve el mismo contenido
//     con arrays nuevos NO destruye el chart (antes, cada cambio de benchmark
//     recreaba el chart entero sin cambio visual — A9 del análisis).

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHART_RANGES, DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";
import { resolveChartViewportConfig } from "@/lib/chartViewportModel";
import { useChartDataModel } from "@/app/useChartDataModel";
import { useChartDrawings } from "@/app/useChartDrawings";
import { useChartViewport } from "@/app/useChartViewport";
import { chartReadoutText, createChartNativeAdapter, pointAtOrBefore, resolveCssTokensNative } from "@/app/chartNativeAdapter";
import { crosshairTimeFormatter } from "@/lib/chartViewportModel";
import { barsAreCandleGrade } from "@/lib/chartDataQuality";
import { RS_LINE_MIN_WEEKS, projectRsCountryRatingSeries, projectRsRatingSeries, projectRsThemeRatingSeries, rsLineHistory } from "@/lib/chartSeriesModel";
import { userFacingSearchError } from "@/lib/screenerFormat";
import { chartPatternBadgeForRow } from "@/lib/methodologyDisplay";
import { vcpDiagnosticSnapshot } from "@/lib/vcpDiagnostics";
import { scoreOrNull } from "@/lib/scoreValue";

// Defaults con IDENTIDAD ESTABLE. Un default `[]` en línea crea un array
// nuevo en cada render y convierte cualquier dependencia derivada en un
// invalidador permanente (histórico: "Maximum update depth exceeded").
const EMPTY_RS_RATING_SERIES = [];
const EMPTY_RS_COUNTRY_SERIES = [];
const EMPTY_RS_THEME_SERIES = [];

// Huella de contenido de una serie de puntos (array plano o `{ points }`).
// Barata a propósito: longitud + extremos + último valor. Un cambio interior
// que no toque longitud ni extremos no invalida — aceptable para series
// append-only como las que llegan aquí, y documentado como límite.
function seriesContentKey(series) {
  const list = Array.isArray(series) ? series : Array.isArray(series?.points) ? series.points : [];
  if (!list.length) return "0";
  const first = list[0] || {};
  const last = list[list.length - 1] || {};
  const timeOf = (p) => p?.time ?? p?.date ?? p?.snapshotDate ?? p?.snapshot_date ?? "";
  const valueOf = (p) => p?.rsRating ?? p?.rs_rating ?? p?.rating ?? p?.rsLine ?? p?.rs_line ?? p?.value ?? p?.close ?? "";
  return `${list.length}|${timeOf(first)}|${timeOf(last)}|${valueOf(last)}`;
}

// Huella del overlay de patrón: los campos que el adaptador dibuja
// (pivot + swings C1..C4).
function patternContentKey(overlay) {
  if (!overlay || typeof overlay !== "object") return "none";
  const swings = Array.isArray(overlay.contractionSwings) ? overlay.contractionSwings : [];
  const lastSwing = swings[swings.length - 1] || {};
  return `${overlay.pivotPrice ?? ""}|${swings.length}|${lastSwing.toDate ?? ""}`;
}

// Estilo efectivo de dibujo: preview close-only se pinta en línea al instante
// y pasa a velas solo cuando /api/chart devuelve OHLC real (no al contar barras
// locales suficientes en close-only).
export function resolveRenderConfig(config, preferredStyle, dataModel) {
  const targetStyle = preferredStyle || config.style;
  const remoteOhlcReady = dataModel.requestState === "settled"
    && dataModel.availability === "ready"
    && (dataModel.rows?.length || 0) > 0
    && barsAreCandleGrade(dataModel.rows);
  if (preferredStyle && remoteOhlcReady && targetStyle !== config.style) {
    return { ...config, style: targetStyle };
  }
  return config;
}

export function useChartController(props = {}) {
  const {
    bars = [],
    symbol = "",
    currency = "",
    settings = DEFAULT_CHART_SETTINGS,
    tradingViewUrl = "",
    relativeStrength = null,
    benchmarkSymbol = "",
    rsMainScore = null,
    rsRatingSeries = EMPTY_RS_RATING_SERIES,
    rsCountrySeries = EMPTY_RS_COUNTRY_SERIES,
    rsCountryMainScore = null,
    rsThemeSeries = EMPTY_RS_THEME_SERIES,
    rsThemeMainScore = null,
    patternOverlay = null,
    // Badge flotante: puede mostrar estructura aunque el overlay actionable sea null.
    // Si no se pasa, el badge sigue derivándose de patternOverlay (callers legacy).
    patternBadgeRow = undefined,
    showPatternDiagnostics = false,
    localQuality = null,
    preferredStyle = null,
    className = "",
    height = 460,
  } = props || {};

  // 1: config canónica. Depende de valores, no de la identidad del objeto
  // settings (el caller puede pasar literales nuevos cada render).
  const config = useMemo(
    () => resolveChartViewportConfig(settings || {}),
    [
      settings?.range,
      settings?.interval,
      settings?.style,
      settings?.scale,
      settings?.indicators?.volume,
      settings?.indicators?.rsLine,
      settings?.indicators?.rsCountryLine,
      settings?.indicators?.rsThemeLine,
      settings?.indicators?.maFast,
      settings?.indicators?.maFastLength,
      settings?.indicators?.maSlow,
      settings?.indicators?.maSlowLength,
    ],
  );

  // 2: data model (fetch, aborto, calidad P0).
  const dataModel = useChartDataModel({
    symbol,
    localSource: { bars, quality: localQuality },
    config: { dataRange: config.dataRange, interval: config.interval, style: config.style },
    preferredStyle,
  });

  // Tras el fetch remoto, el estilo de dibujo puede ser distinto al interino
  // (preview close-only en línea mientras llegan velas OHLC).
  const renderConfig = useMemo(
    () => resolveRenderConfig(config, preferredStyle, dataModel),
    [
      config,
      preferredStyle,
      dataModel.requestState,
      dataModel.availability,
      dataModel.rows,
    ],
  );

  const rows = dataModel.rows;
  const rowTimes = dataModel.rowTimes;
  const contextRows = dataModel.contextRows;
  const notice = dataModel.notice;

  // 3: drawings + interaction (frontera existente; retorno con identidad
  // estable — ver useChartDrawings).
  const drawings = useChartDrawings({ symbol, interval: config.interval });

  // 4: viewport — instancia única por montaje.
  const viewport = useChartViewport({
    symbol,
    config,
    rowTimes,
    requestedHeight: height,
    getInteractionState: drawings.getInteractionState,
  });

  const canvasRef = useRef(null);
  const chartHandleRef = useRef(null);
  const controllerAttachmentIdRef = useRef(0);
  const [renderError, setRenderError] = useState("");

  // Derivaciones puras.
  const latest = rows.at(-1);
  // Variación de la ÚLTIMA barra (vs. la anterior), no de toda la serie
  // servida: antes se medía contra rows[0] —la primera barra de TODO lo que
  // el proveedor entregó, ignorando el rango elegido— y la cabecera del
  // gráfico decía "+474,2%" (dos años de serie) mientras la de la ficha
  // decía "+1,5%" (el día) para el mismo valor. En intervalo D esto es la
  // variación de la última sesión, coherente con N0; en W/M, de la última
  // semana/mes. Ver docs/analisis-ficha-cuadro-grafico-2026-08-21.md (A0).
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  const change = previous?.close ? ((Number(latest?.close) / Number(previous.close)) - 1) * 100 : null;
  const positive = !Number.isFinite(change) || change >= 0;

  const intraday = config.intraday;
  const rangeLabel = (CHART_RANGES.find((item) => item.key === config.dataRange)?.label || config.dataRange || "").toUpperCase();

  // Huellas de contenido de las series-prop (ver cabecera).
  const rsRatingSeriesKey = useMemo(() => seriesContentKey(rsRatingSeries), [rsRatingSeries]);
  const rsCountrySeriesKey = useMemo(() => seriesContentKey(rsCountrySeries), [rsCountrySeries]);
  const rsThemeSeriesKey = useMemo(() => seriesContentKey(rsThemeSeries), [rsThemeSeries]);
  const relativeStrengthKey = useMemo(() => seriesContentKey(relativeStrength), [relativeStrength]);
  const patternOverlayKey = useMemo(() => patternContentKey(patternOverlay), [patternOverlay]);

  // Estado de la línea RS para la vista. MISMAS funciones puras que usa el
  // adaptador: lo declarado y lo dibujado no pueden discrepar.
  const rsLineState = useMemo(() => {
    if (!config.indicators.rsLine) return { enabled: false, rendered: false, weeks: 0 };
    if (intraday) return { enabled: true, rendered: false, weeks: 0, intradayMuted: true };
    const points = projectRsRatingSeries(rows, rsRatingSeries, config.indicators, config.interval);
    const history = rsLineHistory(points);
    const rendered = points.length > 1 && history.sufficient;
    return {
      enabled: true,
      rendered,
      weeks: history.weeks,
      intradayMuted: false,
      // Mismos puntos que dibuja el adaptador (y que lee la lectura del cursor).
      points: rendered ? points : [],
    };
  }, [config.indicators, config.interval, intraday, rows, rsRatingSeries]);

  // Lectura por defecto (última barra): la misma línea que escribe el cursor
  // —fecha · cierre · RS de ESA fecha—, para superficies sin ratón (ficha
  // móvil). En escritorio no se muestra: la lectura sigue oculta sin cursor.
  const readoutDefault = useMemo(() => {
    const last = rows.at(-1);
    if (!last || last.time == null) return "";
    const rsPoint = pointAtOrBefore(rsLineState.points || [], last.time);
    return chartReadoutText({
      dateText: crosshairTimeFormatter(config.interval)(last.time),
      close: last.close ?? last.value ?? null,
      rs: rsPoint ? rsPoint.value : null,
    });
  }, [rows, rsLineState, config.interval]);

  const rsCountryLineState = useMemo(() => {
    if (!config.indicators.rsCountryLine) return { enabled: false, rendered: false, weeks: 0 };
    if (intraday) return { enabled: true, rendered: false, weeks: 0, intradayMuted: true };
    const points = projectRsCountryRatingSeries(rows, rsCountrySeries, config.indicators, config.interval);
    const history = rsLineHistory(points);
    return {
      enabled: true,
      rendered: points.length > 1 && history.sufficient,
      weeks: history.weeks,
      intradayMuted: false,
    };
  }, [config.indicators, config.interval, intraday, rows, rsCountrySeries]);

  const rsThemeLineState = useMemo(() => {
    if (!config.indicators.rsThemeLine) return { enabled: false, rendered: false, weeks: 0 };
    if (intraday) return { enabled: true, rendered: false, weeks: 0, intradayMuted: true };
    const points = projectRsThemeRatingSeries(rows, rsThemeSeries, config.indicators, config.interval);
    const history = rsLineHistory(points);
    return {
      enabled: true,
      rendered: points.length > 1 && history.sufficient,
      weeks: history.weeks,
      intradayMuted: false,
    };
  }, [config.indicators, config.interval, intraday, rows, rsThemeSeries]);

  const patternBadgeSource = patternBadgeRow !== undefined ? patternBadgeRow : patternOverlay;
  const patternBadgeSourceKey = useMemo(() => patternContentKey(patternBadgeSource), [patternBadgeSource]);
  const patternSummary = useMemo(
    () => chartPatternBadgeForRow(patternBadgeSource),
    [patternBadgeSourceKey],
  );
  const patternDiagnostic = useMemo(
    () => showPatternDiagnostics && patternOverlay && !intraday ? vcpDiagnosticSnapshot(patternOverlay) : null,
    [showPatternDiagnostics, patternOverlay, intraday],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Lectura bajo el cursor (fecha · cierre · RS). Se escribe directamente en el
  // nodo (sin estado React): un setState por movimiento de ratón re-renderizaría
  // la ficha entera. Solo es visible mientras el cursor está sobre el lienzo.
  // ─────────────────────────────────────────────────────────────────────────
  const readoutRef = useRef(null);
  const writeReadoutRef = useRef((text) => {
    const node = readoutRef.current;
    if (!node) return;
    const next = String(text || "");
    if (node.textContent !== next) node.textContent = next;
    node.hidden = !next;
  });

  // Entradas de dibujo VIGENTES. La creación es asíncrona (import dinámico):
  // cuando termina, lee de aquí y no de un closure que pudo quedar viejo.
  const renderInputs = {
    renderConfig,
    rows,
    contextRows,
    patternOverlay,
    rsRatingSeries,
    rsCountrySeries,
    rsThemeSeries,
    relativeStrength,
    positive,
    height,
  };
  const renderInputsRef = useRef(renderInputs);
  renderInputsRef.current = renderInputs;

  function adapterOverrides(inputs) {
    return {
      patternOverlay: inputs.patternOverlay,
      rsRatingSeries: inputs.rsRatingSeries,
      rsCountrySeries: inputs.rsCountrySeries,
      rsThemeSeries: inputs.rsThemeSeries,
      benchmarkSeries: inputs.relativeStrength,
      contextRows: inputs.contextRows,
      requestedHeight: inputs.height,
      positive: inputs.positive,
    };
  }

  // Ficha de DATOS: cambia (identidad nueva) cuando cambia cualquier cosa que
  // el adaptador puede re-aplicar sobre el chart vivo. Las series-prop entran
  // por huella de contenido (rsRatingSeriesKey…), no por identidad.
  const dataToken = useMemo(() => ({}), [
    dataModel.rowTimes,
    dataModel.rows?.length,
    config.dataRange,
    config.interval,
    config.scale,
    patternOverlayKey,
    rsRatingSeriesKey,
    rsCountrySeriesKey,
    rsThemeSeriesKey,
    relativeStrengthKey,
    config.indicators.volume,
    config.indicators.rsLine,
    config.indicators.rsCountryLine,
    config.indicators.rsThemeLine,
    config.indicators.benchmarkLine,
    config.indicators.maFast,
    config.indicators.maFastLength,
    config.indicators.maSlow,
    config.indicators.maSlowLength,
    positive,
  ]);
  const dataTokenRef = useRef(dataToken);
  dataTokenRef.current = dataToken;

  // ─────────────────────────────────────────────────────────────────────────
  // Transacción de creación y destrucción del chart.
  //
  // Solo lo ESTRUCTURAL recrea el chart: disponibilidad, símbolo, tipo de
  // serie principal (velas/línea/área) y altura pedida. Rango, temporalidad,
  // escala, datos, overlays e indicadores se re-aplican sobre el chart vivo
  // (efecto siguiente). Antes cada cambio de rango hacía chart.remove() +
  // createChart 2-3 veces (auditoría 2026-11, H22).
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (dataModel.availability !== "ready") {
      // No se crea chart si la disponibilidad no es "ready".
      return undefined;
    }

    let cancelled = false;
    let adapter = null;

    // Incrementamos ANTES del await: cualquier respuesta tardía del import
    // dinámico se descarta al comparar myId con controllerAttachmentIdRef.
    controllerAttachmentIdRef.current += 1;
    const myId = controllerAttachmentIdRef.current;

    async function render() {
      if (cancelled) return;
      const container = canvasRef.current;
      if (!container) return;
      container.innerHTML = "";

      const lib = await import("lightweight-charts");
      if (cancelled || myId !== controllerAttachmentIdRef.current) return;

      const measured = viewport.prepare(container);
      const colors = resolveCssTokensNative();
      const inputs = renderInputsRef.current;

      adapter = createChartNativeAdapter({
        container,
        lib,
        profile: measured.profile,
        width: measured.width,
        height: measured.height,
        config: inputs.renderConfig,
        rows: inputs.rows,
        colors,
        onReadout: (text) => writeReadoutRef.current(text),
        overrides: adapterOverrides(inputs),
      });
      adapter.appliedToken = dataTokenRef.current;
      adapter.appliedRows = inputs.rows;
      adapter.appliedRange = inputs.renderConfig.dataRange;
      adapter.appliedInterval = inputs.renderConfig.interval;

      // setRowTimes ANTES de attach, para que la primitiva reciba los
      // tiempos coherentes desde el primer attach.
      drawings.setRowTimes(inputs.rows);

      // Viewport: el lifecycle aplica la ventana contractual (rango entero,
      // o la desviación manual vigente) y gestiona wheel/resize/suscripción.
      const handle = adapter;
      viewport.attach({
        chart: handle.chart,
        container,
        profile: measured.profile,
        onGeometryChange: ({ width: w, height: h, profile: p }) => {
          handle.updateGeometry({ width: w, height: h, profile: p });
        },
      });

      drawings.attach(adapter.chart, adapter.mainSeries, container);

      chartHandleRef.current = adapter;
      if (!cancelled) {
        setRenderError("");
      }
    }

    render().catch((error) => {
      if (cancelled) return;
      // Un error en createChart o en las series no muta dataModel.error;
      // se publica como renderError separado.
      const message = error?.message || "Grafico no disponible";
      setRenderError(message);
    });

    return () => {
      cancelled = true;
      // Orden inverso de creación.
      // 1. drawings.detach (interacción → DETACH → idle, separa primitiva).
      try { drawings.detach?.(); } catch { /* noop */ }
      // 2. viewport.detach (libera wheel/resize/suscripciones del attachment).
      try { viewport.detach?.(); } catch { /* noop */ }
      // 3. adapter.destroySeries (libera series, NO chart.remove).
      if (adapter && typeof adapter.destroySeries === "function") {
        try { adapter.destroySeries(); } catch { /* noop */ }
      }
      // 4. chart.remove — exactamente una vez por attachment.
      if (adapter && adapter.chart && typeof adapter.chart.remove === "function") {
        try { adapter.chart.remove(); } catch { /* noop */ }
      }
      // 5. limpiar handles.
      if (chartHandleRef.current === adapter) {
        chartHandleRef.current = null;
      }
      controllerAttachmentIdRef.current += 1;
    };
    // Las entradas de datos se leen de renderInputsRef al crear; sus cambios
    // posteriores los aplica el efecto de actualización.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataModel.availability,
    symbol,
    renderConfig.style,
    height,
  ]);

  // ─────────────────────────────────────────────────────────────────────────
  // Actualización en sitio: datos, rango, temporalidad, escala, overlays e
  // indicadores sobre el chart vivo (setData/applyOptions). Si el chart aún
  // se está creando, la creación ya leerá las entradas vigentes.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = chartHandleRef.current;
    if (!handle || typeof handle.update !== "function") return;
    if (handle.appliedToken === dataToken) return;
    if (dataModel.availability !== "ready") return;
    const container = canvasRef.current;
    if (!container) return;
    const inputs = renderInputsRef.current;
    const measured = viewport.prepare(container);
    const windowChanged = handle.appliedRows !== inputs.rows
      || handle.appliedRange !== inputs.renderConfig.dataRange
      || handle.appliedInterval !== inputs.renderConfig.interval;
    // Durante el setData la librería conserva el rango lógico anterior sobre
    // las filas nuevas; sin congelar la derivación, ese estado intermedio se
    // leía como desviación manual y el attach lo re-aplicaba (W tras D: 242
    // «barras» con 192 de hueco a la izquierda).
    if (windowChanged) viewport.beginDataSwap();
    try {
      handle.update({
        config: inputs.renderConfig,
        rows: inputs.rows,
        overrides: adapterOverrides(inputs),
        profile: measured?.profile,
      });
      handle.appliedToken = dataToken;
      setRenderError("");
    } catch (error) {
      setRenderError(error?.message || "Grafico no disponible");
    } finally {
      if (windowChanged) {
        // Re-adjuntar el viewport al MISMO chart: re-aplica el perfil del
        // eje (formato de ticks del nuevo rango/temporalidad), reanuda la
        // derivación y aplica la ventana contractual sobre los datos nuevos.
        // No crea ni destruye nada.
        viewport.attach({
          chart: handle.chart,
          container,
          profile: measured?.profile,
          onGeometryChange: ({ width: w, height: h, profile: p }) => {
            handle.updateGeometry({ width: w, height: h, profile: p });
          },
        });
      }
    }
    handle.appliedRows = inputs.rows;
    handle.appliedRange = inputs.renderConfig.dataRange;
    handle.appliedInterval = inputs.renderConfig.interval;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataToken]);

  // drawings.setRowTimes en cada cambio de filas.
  useEffect(() => {
    drawings.setRowTimes?.(rows);
  }, [rows, drawings]);

  // Unmount cleanup: red de seguridad para el chart nativo si el effect de
  // arriba no llegó a limpiar (p. ej. unmount a mitad de un init en vuelo).
  useEffect(() => () => {
    const handle = chartHandleRef.current;
    if (handle && handle.chart && typeof handle.chart.remove === "function") {
      try { handle.chart.remove(); } catch { /* noop */ }
    }
    chartHandleRef.current = null;
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // viewModel.
  // ─────────────────────────────────────────────────────────────────────────
  const status = dataModel.availability; // ready | empty | blocked
  const viewState = viewport.state.view || null;
  const manualActive = !!viewport.state.manual;
  const viewportRail = {
    mode: viewState?.isManual ? viewState.label : "Último dato",
    window: viewport.state.visibleWindowLabel || "Sin ventana",
    bars: viewState?.visibleBars || null,
    distance: viewState?.distanceFromLatest || null,
    drawing: drawings.toolbarProps?.modeLabel || null,
    manual: manualActive,
    // Pan/reset UI must follow the visible logical range, not only manualView.
    // Contract/reference windows can be zoomed while manualView is still null —
    // gating on `manual` left the chevrons dead (CHART-NAV / dueño 2026-08-29).
    canPanLeft: Boolean(viewState?.canPanLeft),
    canPanRight: Boolean(viewState?.canPanRight),
    // Full fit: pan-left still useful (lifecycle zooms then shifts).
    canEnterHistory: Boolean(viewState?.visibleBars > 16 && !viewState?.canPanLeft && !viewState?.isZoomed),
    key: viewState?.key || "unknown",
  };
  const notes = {
    quality: notice && notice.kind === "quality" ? notice : null,
    expanding: notice && notice.kind === "expanding" ? notice : null,
    expansionFailed: notice && notice.kind === "error" && notice.code === "history-expansion-failed" ? notice : null,
    info: notice && notice.kind === "info" ? notice : null,
    renderError: renderError || null,
  };
  const emptyFallback = useMemo(() => ({
    kind: notice?.kind || "empty",
    text: notice && notice.kind === "quality" ? notice.text
      : notice && notice.kind === "loading" ? notice.text
        : notice && notice.kind === "error" ? notice.text
          : notice && notice.kind === "empty" ? notice.text
            : userFacingSearchError("Historico insuficiente"),
    title: notice && notice.kind === "quality" ? notice.title : "",
  }), [notice]);
  const viewModel = useMemo(() => ({
    status,
    header: {
      symbol,
      latestClose: Number.isFinite(Number(latest?.close)) ? Number(latest.close) : null,
      changePct: Number.isFinite(change) ? change : null,
      positive,
      rangeLabel,
      interval: config.interval,
    },
    badges: {
      // scoreOrNull, no Number.isFinite(Number(x)): Number(null) es 0 y el
      // badge pintaba «RS global 0» en valores sin RS (móvil 2026-11, M3).
      rsMainScore: scoreOrNull(rsMainScore),
      countryRsScore: scoreOrNull(rsCountryMainScore),
      themeRsScore: scoreOrNull(rsThemeMainScore),
      pattern: patternSummary,
    },
    viewportRail,
    patternDiagnostic,
    rsLegend: {
      enabled: !!config.indicators.rsLine,
      intradayMuted: intraday,
      rendered: rsLineState.rendered,
      // Ausencia con motivo, en el sitio donde falta el dato
      // (docs/principios-producto.md §5, la excepción).
      absence: config.indicators.rsLine && !intraday && !rsLineState.rendered
        ? {
          weeks: rsLineState.weeks,
          text: rsLineState.weeks > 0
            ? `Sin línea RS: ${rsLineState.weeks} ${rsLineState.weeks === 1 ? "semana" : "semanas"} de histórico (mínimo ${RS_LINE_MIN_WEEKS})`
            : "Sin línea RS: este valor no tiene histórico del ranking semanal",
          title: `El RS es un percentil semanal. Con menos de ${RS_LINE_MIN_WEEKS} semanas la línea uniría lecturas contiguas y afirmaría una tendencia que no se ha medido.`,
        }
        : null,
    },
    rsCountryLegend: {
      enabled: !!config.indicators.rsCountryLine,
      intradayMuted: intraday,
      rendered: rsCountryLineState.rendered,
      absence: config.indicators.rsCountryLine && !intraday && !rsCountryLineState.rendered
        ? {
          weeks: rsCountryLineState.weeks,
          text: rsCountryLineState.weeks > 0
            ? `Sin línea RS país: ${rsCountryLineState.weeks} ${rsCountryLineState.weeks === 1 ? "semana" : "semanas"} de histórico (mínimo ${RS_LINE_MIN_WEEKS})`
            : "Sin línea RS país: este valor no tiene histórico del ranking semanal intra-mercado",
          title: `El RS país es un percentil semanal dentro del mercado del símbolo. Con menos de ${RS_LINE_MIN_WEEKS} semanas la línea uniría lecturas contiguas y afirmaría una tendencia que no se ha medido.`,
        }
        : null,
    },
    rsThemeLegend: {
      enabled: !!config.indicators.rsThemeLine,
      intradayMuted: intraday,
      rendered: rsThemeLineState.rendered,
      absence: config.indicators.rsThemeLine && !intraday && !rsThemeLineState.rendered
        ? {
          weeks: rsThemeLineState.weeks,
          text: rsThemeLineState.weeks > 0
            ? `Sin línea RS tema: ${rsThemeLineState.weeks} ${rsThemeLineState.weeks === 1 ? "semana" : "semanas"} de histórico (mínimo ${RS_LINE_MIN_WEEKS})`
            : "Sin línea RS tema: este valor no tiene histórico del ranking semanal intra-tema",
          title: `El RS tema es un percentil semanal dentro de la ocupación temática del símbolo. Con menos de ${RS_LINE_MIN_WEEKS} semanas la línea uniría lecturas contiguas y afirmaría una tendencia que no se ha medido.`,
        }
        : null,
    },
    notes,
    emptyFallback,
    readoutDefault,
    rootClassName: className,
  }), [status, symbol, latest, change, positive, rangeLabel, config.interval, config.indicators.rsLine, config.indicators.rsCountryLine, config.indicators.rsThemeLine, intraday, rsLineState, rsCountryLineState, rsThemeLineState, rsCountryMainScore, rsThemeMainScore, patternSummary, viewportRail, patternDiagnostic, notes, emptyFallback, readoutDefault, className, rsMainScore]);

  // ─────────────────────────────────────────────────────────────────────────
  // actions — closures estables de la instancia única del viewport.
  // ─────────────────────────────────────────────────────────────────────────
  const actions = useMemo(() => ({
    zoom: viewport.actions.zoom,
    pan: viewport.actions.pan,
    reset: viewport.actions.reset,
    scrollToLatest: viewport.actions.scrollToLatest,
    scrollToStart: viewport.actions.scrollToStart,
    toggleDrawing: drawings.toolbarProps?.toggleTool || (() => {}),
    removeSelectedDrawing: drawings.toolbarProps?.removeSelected || (() => {}),
  }), [viewport.actions, drawings.toolbarProps]);

  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    window.__chartViewportSnapshot = () => viewport.getSnapshot?.() || viewport.state;
    window.__chartViewportActions = actions;
  }

  return {
    canvasRef,
    readoutRef,
    viewModel,
    actions,
    drawingToolbar: drawings.toolbarProps,
    emptyFallback,
  };
}

export default useChartController;
