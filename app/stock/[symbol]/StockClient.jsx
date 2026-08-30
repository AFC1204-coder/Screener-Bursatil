"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScanSearch } from "lucide-react";
import ChartPreferences from "@/app/ChartPreferences";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import ChartIdentityCard from "./ChartIdentityCard";
import DescriptiveStrip from "./DescriptiveStrip";
import { compactDate } from "@/app/components/ui/QualityStrip";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { amount, dateShort, dateTime, num as sharedNum, pct as sharedPct, pctShare, priceMoney as sharedPriceMoney, signedPriceMoney as sharedSignedPriceMoney } from "@/lib/formatters";
import { DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from "@/lib/chartSettings";
import { getJson } from "@/lib/clientApi";
import { buildChartIdentityCard } from "@/lib/chartIdentityCard";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { persistReviewQueue } from "@/lib/screenerPipeline";
import StorageAlert from "@/app/components/StorageAlert";
import { metricShortLabel } from "@/lib/metricCatalog";
import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";
import { dataStatusLabel } from "@/lib/patternNarrative";
import { userFacingServiceError } from "@/lib/serviceErrors";
import { SCREENER_SESSION_VERSION } from "@/lib/screenerConfig";
import { setupPatternForBars } from "@/lib/setupPatterns";
import { udVol } from "@/lib/indicators";
import { stockVolumeState } from "@/lib/stockVolume";
import { STAGE_MISSING_REASON, stageConfirmationMark, stageWordForState } from "@/lib/stageDisplay";
import { buildReviewQueueNavigation } from "@/lib/reviewQueueNavigation";
import { buildReviewStockOpenContext } from "@/lib/reviewStockContext";
import { STOCK_DECISION_ACTIONS, applyStockDecisionResolution, decisionResolutionForSymbol, decisionResolutionHistory, reopenStockDecisionResolution } from "@/lib/stockDecisionResolution";
import { vcpObjectiveSummary } from "@/lib/vcpDiagnostics";
import { chartQualityFromBrief } from "@/lib/chartDataQuality";

/* ── Componentes de la jerarquía N0–N3 (spec FICHA-TICKER-IA.md) ──────── */

/* Texto del RS para el detalle auditable de N3 ("RS global"). Vivía también
   en la franja "Calidad de dato" de N0, retirada el 2026-08-22 — una sola
   función para las dos superficies evitaba que dijeran cosas distintas
   sobre el mismo dato; ahora queda un único consumidor pero el criterio
   sigue vigente: sin ranking semanal no hay fecha ni muestra que mostrar —
   la fecha caía a la del universo y la muestra a cero, que es exactamente lo
   que el principio 3 prohíbe. */
export function rsRankingStripValue(rsUniverse, freshness = {}) {
  if (!Number.isFinite(rsUniverse)) return "Sin ranking";
  if (!freshness?.rsGlobalAsOf) return "Sin snapshot";
  const date = compactDate(freshness.rsGlobalAsOf);
  const sample = Number(freshness.rsGlobalSample);
  if (!Number.isFinite(sample) || sample <= 0) return date;
  return `${date} · n=${sharedNum(Math.round(sample))}`;
}

/* Fila de tabla clave-valor de 2 columnas. Reemplaza a la píldora para
   cualquier par label-valor en N1 y N2. La fila crece verticalmente:
   nada de ellipsis en label ni en cifra. */
function KVRow({ label, value, state = "value", detail = "", source = null, suffix = "" }) {
  const valueState = !Number.isFinite(Number(value)) && value !== "—" && value !== ""
    ? "value"
    : state;
  const cls = `stockTechRow ${sourceClass(source)}`.trim();
  const valueCls = `stockTechRowValue ${valueState === "ghost" ? "" : valueState === "stale" ? "stale" : ""}`.trim();
  const sourceTitle = source?.title || detail || label;
  return (
    <div className={cls}>
      <span className="stockTechRowLabel">{label}</span>
      <b className={valueCls} title={sourceTitle}>
        {value}
        {suffix ? <span className="stockTechRowStaleSuffix">{suffix}</span> : null}
      </b>
    </div>
  );
}

/* Curva de etapa como glifo SVG. Geometría canónica de tokens-v2.
   El punto marca la FASE del ciclo que ya clasificó lib/weeklyStage.js, cada
   una sobre su tramo: etapa 1 → suelo inicial, etapa 2 → tramo ascendente,
   etapa 3 → techo, etapa 4 → tramo descendente.

   La etapa TENTATIVA se dibuja con el punto HUECO (mismo sitio, mismo color,
   sin relleno): el precio ha cruzado su media de 30 semanas pero la media
   sigue en la dirección anterior. Es la misma etapa con menos confirmación,
   no una etapa distinta, así que no cambia de posición ni de color — sólo de
   relleno. Ver docs/diseno-salud-y-cambio-2026-08-16.md (D.15).

   La posición se decide con el ESTADO, nunca buscando dígitos dentro de un
   texto: `/3/.test("Bajo MM30s")` es cierto por el 3 de "MM30s", y así es
   como la constelación acababa pintando en el techo un valor que estaba por
   debajo de su media (auditoría C-19).

   Los estados de la taxonomía anterior ("base"/"mixed") y la ausencia se
   dibujan SIN punto: situar el punto sería afirmar una posición en el ciclo
   que esa clasificación no da. */
const CURVE_DOT_BY_STAGE = {
  stage1: { x: 16, y: 34 },
  stage2: { x: 42, y: 21 },
  stage3: { x: 64, y: 10 },
  stage4: { x: 88, y: 27 },
};

function StockCurveSvg({ stage = "", confirmation = "", width = 96, height = 32 }) {
  const dot = CURVE_DOT_BY_STAGE[stage] || null;
  const hollow = confirmation === "tentative" || confirmation === "unknown_context";
  return (
    <svg className="stockCurveSvg" viewBox="0 0 120 44" width={width} height={height} aria-hidden="true">
      <path
        d="M4,34 L30,34 C40,34 42,10 54,10 L74,10 C84,10 86,34 96,34 L116,34"
        fill="none"
        stroke="var(--curve-track)"
        strokeWidth="var(--curve-stroke)"
        strokeLinecap="round"
      />
      {dot ? (
        <circle
          cx={dot.x}
          cy={dot.y}
          r="var(--curve-dot)"
          fill={hollow ? "none" : "var(--tiza)"}
          stroke={hollow ? "var(--tiza)" : "none"}
          strokeWidth={hollow ? 1.5 : 0}
          strokeDasharray={confirmation === "unknown_context" ? "2 2" : undefined}
        />
      ) : null}
    </svg>
  );
}

/* Chip-curva de etapa: EL ÚNICO chip que sobrevive en la ficha (spec §1,
   regla estructural nº1). Curva + etiqueta + etapa.
   Antes mostraba la decisión del sistema ("Vigilar/Auditar/Descartar") —
   el veredicto que la tabla del screener ya retiró y que el principio 1 de
   docs/principios-producto.md prohíbe. La etapa es clasificación técnica
   descriptiva (dónde está el precio respecto a sus medias, no qué hacer) y
   se escribe con la MISMA palabra que la columna "Etapa" de la tabla
   (lib/stageDisplay.js). */
function StageCurveChip({ stageTone = "", stageWord = "", confirmation = "", confirmationInfo = null, missingReason = "" }) {
  const word = stageWord || "Sin dato";
  const suffix = confirmationInfo?.suffix || "";
  return (
    <div className="stockDecisionChip" data-stage={stageTone || "none"} aria-label={`Etapa: ${word}${suffix ? ` (${suffix})` : ""}`}>
      <StockCurveSvg stage={stageTone} confirmation={confirmation} />
      <div className="stockDecisionChipBody">
        <span className="stockDecisionChipLabel">Etapa</span>
        <span className="stockDecisionChipDecision">
          {word}
          {suffix ? <span className="stockStageTentative"> · {suffix}<InfoHint text={confirmationInfo.title} /></span> : null}
          {!stageWord && missingReason ? <InfoHint text={missingReason} /> : null}
        </span>
      </div>
    </div>
  );
}

/* Estado vacío de la ficha: el símbolo no tiene serie de precios real ni
   identidad reconocible en ningún proveedor. No se pinta precio, ni etapa, ni
   decisión — no hay nada que el sistema pueda demostrar sobre este valor. */
function StockUnavailableBlock({ symbol = "" }) {
  return (
    <section className="stockPanel stockUnavailable" aria-label="Sin datos para este símbolo">
      <h1 className="stockIdentityTitle">{symbol}</h1>
      <p className="stockUnavailableLead">Sin datos de mercado para este símbolo.</p>
      <p className="stockUnavailableBody">
        No hay serie de precios ni ficha de empresa disponibles, así que no se
        muestra precio, etapa ni ninguna lectura técnica. Comprueba el ticker —
        puede estar mal escrito, pertenecer a un mercado fuera de cobertura o
        haber dejado de cotizar.
      </p>
      <a className="stockUnavailableBack" href="/">Volver al screener</a>
    </section>
  );
}

/* QualityStrip vivía aquí; ahora es compartida con Listas.
   Ver app/components/ui/QualityStrip.jsx. Su uso en N0 (franja "Calidad de
   dato": Cierre/Cobertura/RS·n=) se retiró el 2026-08-22 — ver el
   comentario junto a N0VerdictBlock. */

/* Bloque N0 (Cabecera). Estructura: identidad + precio + etapa. Única zona
   con color semántico.
   El veredicto del sistema (decisión Vigilar/Auditar/Descartar), el FRENO
   y el score de estructura se retiraron de aquí (principio 1: la
   herramienta clasifica, no recomienda). El score sigue calculándose y se
   lee en el desglose de N3; la etapa —clasificación descriptiva— ocupa el
   sitio del veredicto con la misma palabra que la tabla del screener.

   La franja "Calidad de dato" (Cierre/Cobertura/RS·n=) y el resumen de
   Setup se retiraron el 2026-08-22: cobertura y tamaño de muestra son
   diagnóstico interno, y el resumen de setup enumeraba condiciones que el
   detector no evalúa de forma fiable (base = constante 13 en el 100% de
   las filas; contracciones sin integrar en producción). El detalle
   auditable —Cierre, RS global, Cobertura, Histórico, Cotización— vive en
   N3 "Calidad de datos" (n3DataQualityDetail); la fecha de cierre, lo
   único que el usuario necesitaba sin abrir un desglose, queda aquí junto
   al precio. */
export function N0VerdictBlock({
  symbol,
  data,
  priceSnapshot,
  freshness,
  actions,
}) {
  const priceHas = Number.isFinite(priceSnapshot?.price);
  // Misma palabra que la tabla y que la fila "ETAPA" de esta misma ficha.
  const stageDisplay = stageWordForState(data?.stage?.weekly?.state || "", data?.stage?.label || "");
  // El guard acepta tanto un array de acciones como un único elemento. Antes
  // exigía `actions.length` sobre lo que le llegaba: con un fragmento JSX
  // (`.length === undefined`) el bloque de links desaparecía entero sin error
  // — los botones "Screener" y "Web oficial" no se renderizaban NUNCA.
  const actionList = (Array.isArray(actions) ? actions : [actions]).filter(Boolean);
  return (
    <section className="stockVerdict" data-stage={stageDisplay?.tone || "none"}>
      <div className="stockVerdictHead">
        <div className="stockVerdictIdentity">
          <div className="stockLogoPro">
            <span>{String(data?.visual?.initials || symbol.slice(0, 2)).toUpperCase()}</span>
          </div>
          <div className="stockIdentityBlock">
            <span className="stockIdentityKicker">{data?.sector || "Sector sin clasificar"}{data?.exchange ? ` · ${data.exchange}` : ""}</span>
            <h1 className="stockIdentityTitle">{symbol}</h1>
            <p className="stockIdentityCompany">{data?.name || symbol}</p>
          </div>
        </div>
        <div className="stockVerdictQuote">
          <span className="stockVerdictQuoteLabel">
            Cierre del gráfico
            {freshness?.priceDate ? <span className="stockVerdictQuoteDate">{compactDate(freshness.priceDate)}</span> : null}
          </span>
          <div className="stockVerdictQuoteValue">
            <span className="stockVerdictPrice" data-state={priceHas ? "value" : "ghost"}>
              {priceHas ? priceMoney(priceSnapshot.price) : "—"}
            </span>
            {data?.currency && <span className="stockVerdictCurrency">{data.currency}</span>}
            {Number.isFinite(priceSnapshot?.dayChangePct) && (
              <span className="stockVerdictChange">
                {signedPriceMoney(priceSnapshot.dayChange)} ({sharedPct(priceSnapshot.dayChangePct)})
              </span>
            )}
          </div>
        </div>
        <div className="stockVerdictActions">
          <StageCurveChip
            stageTone={stageDisplay?.tone || ""}
            stageWord={stageDisplay?.word || ""}
            confirmation={data?.stage?.weekly?.confirmation || ""}
            confirmationInfo={stageConfirmationMark(data?.stage?.weekly?.confirmation || "")}
            missingReason={STAGE_MISSING_REASON}
          />
        </div>
      </div>

      {actionList.length ? (
        <div className="stockVerdictActions stockVerdictLinks">
          {actionList}
        </div>
      ) : null}
    </section>
  );
}

/* N1TechTable («Lectura técnica») y N2ContextBlock («Contexto» +
   «Fundamentales operativos») vivían aquí. Retirados el 2026-08-21 — el
   comentario largo con qué contenía cada uno está en el punto del render
   donde se montaban, y el porqué completo en
   docs/analisis-ficha-cuadro-grafico-2026-08-21.md (Parte B). */

/* Bloque N3 (Auditoría). Tres sub-bloques colapsados por defecto:
   desglose del score, bloque empresa, detalle de calidad de datos. */
function N3AuditBlock({ scoreBreakdown = [], company = null, dataQualityDetail = [], methodology = null }) {
  return (
    <div className="stockAudit" aria-label="Auditoría">
      <details>
        <summary>Desglose del score</summary>
        <div className="stockAuditBody">
          {scoreBreakdown.length ? (
            <div className="stockScoreBreakdown">
              {scoreBreakdown.map((row, index) => (
                <div
                  key={`${row.label}-${index}`}
                  className="stockScoreRow"
                  data-dominant={row.dominant ? "true" : "false"}
                  data-tone={row.tone || "neutral"}
                >
                  <span className="stockScoreRowLabel">{row.label}</span>
                  <span className="stockScoreRowBar">
                    <span
                      className="stockScoreRowBarFill"
                      style={{ width: `${Math.min(100, Math.max(0, row.pct || 0))}%` }}
                    />
                  </span>
                  <span className="stockScoreRowValue">{row.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="stockNarrativeItemText">Sin desglose disponible.</p>
          )}
        </div>
      </details>
      <details>
        <summary>Bloque empresa</summary>
        <div className="stockAuditBody">
          <h3>Identidad</h3>
          {company ? (
            <>
              <div className="stockCompanyTable">
                {/* Mismos nombres que el cajón de filtros del screener
                    (Tema/Sector/Subsector): antes esta tabla llamaba
                    "Industria" al subsector del screener y "Subsector" al
                    tema — la taxonomía cruzada entre pantallas. */}
                <KVRow label="Sector" value={company.sector || "—"} state={company.sector ? "value" : "ghost"} />
                <KVRow label="Subsector" value={company.industry || "—"} state={company.industry ? "value" : "ghost"} />
                <KVRow label="Tema" value={company.subsector || "—"} state={company.subsector ? "value" : "ghost"} />
                <KVRow label="Empleados" value={fmt(company.employees)} state={Number.isFinite(company.employees) ? "value" : "ghost"} />
                <KVRow label="IPO" value={company.ipoDate ? dateShort(company.ipoDate) : "—"} state={company.ipoDate ? "value" : "ghost"} detail={company.listingDateSource} />
              </div>
              <p className="stockCompanyDescription">{company.description || "Sin descripción de negocio."}</p>
            </>
          ) : (
            <p className="stockNarrativeItemText">Sin bloque empresa disponible.</p>
          )}
        </div>
      </details>
      <details>
        <summary>Calidad de datos</summary>
        <div className="stockAuditBody">
          <div className="stockDataQualityDetail">
            {dataQualityDetail.length ? dataQualityDetail.map((row, index) => (
              <KVRow
                key={`${row.label}-${index}`}
                label={row.label}
                value={row.value}
                state={row.state}
                detail={row.detail}
                suffix={row.suffix}
                source={row.source}
              />
            )) : <p className="stockNarrativeItemText">Sin detalle de calidad disponible.</p>}
          </div>
        </div>
      </details>
      {methodology ? (
        <details>
          <summary>Metodología y gates</summary>
          <div className="stockAuditBody">
            {methodology}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/* Formato: TODO delega en la capa única es-ES (lib/formatters.js). Aquí solo
   quedan los envoltorios con la etiqueta de ausencia de la ficha ("Sin dato").
   Antes la ficha tenía su propio juego (coma en precios, punto en
   porcentajes: "490,99 USD · -0.7%" en la misma línea). rsFmt/scoreFmt (el
   clamp 0-99) se fueron el 2026-08-21 con el panel Fuerza relativa, su único
   consumidor. */
const fmt = (n) => Number.isFinite(n) ? sharedNum(n) : "Sin dato";
// Proporción sin signo (márgenes, volatilidad, cuotas); las VARIACIONES con
// signo usan sharedPct directamente en su sitio.
const pct = (n) => Number.isFinite(n) ? pctShare(n, 1) : "Sin dato";
const ratio = (n) => Number.isFinite(n) ? sharedNum(n, 2) : "Sin dato";
const margin = (numerator, denominator) => Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? pct((numerator / denominator) * 100) : "Sin dato";
const dateFmt = (value) => value ? dateShort(value) : "Sin dato";
const dateTimeFmt = (value) => {
  if (!value) return "";
  const label = dateTime(value);
  return label === "-" ? String(value).slice(0, 16) : label;
};
const money = (n, currency = "") => Number.isFinite(n) ? amount(n, currency) : "Sin dato";
const priceMoney = (n, currency = "") => Number.isFinite(n) ? sharedPriceMoney(n, currency) : "Sin dato";
const signedPriceMoney = (n, currency = "") => {
  if (!Number.isFinite(n)) return "";
  return sharedSignedPriceMoney(n, currency);
};
const sentimentClass = (label = "") => label === "alcista" ? "bullish" : label === "bajista" ? "bearish" : "neutral";
const compactTitle = (...parts) => parts.map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
const NEWS_PROVIDER_RE = /\b(Yahoo|FMP|SEC|X API v2|recent search)\b/i;

function displayNewsPublisher(publisher = "") {
  const text = String(publisher || "").replace(/\s+/g, " ").trim();
  if (!text) return "Fuente disponible";
  return NEWS_PROVIDER_RE.test(text) ? "Fuente de noticias" : text;
}

function metricSourceState(kind = "measured", label = "Métrica", detail = "") {
  const key = ["proxy", "review", "blocked", "measured"].includes(kind) ? kind : "measured";
  const suffix = {
    measured: "medida/trazable",
    proxy: "proxy/estimada",
    review: "revisar",
    blocked: "bloqueada",
  }[key];
  return {
    key,
    mark: key === "proxy" ? "p" : key === "review" ? "!" : key === "blocked" ? "x" : "",
    title: compactTitle(`${label}: ${suffix}`, detail),
  };
}

function metricSourceFromState(state = "pass", label = "Métrica", detail = "") {
  if (state === "fail" || state === "bad" || state === "blocked") return metricSourceState("blocked", label, detail);
  if (state === "warn" || state === "watch" || state === "partial") return metricSourceState("review", label, detail);
  return metricSourceState("measured", label, detail);
}

function sourceClass(source = null) {
  return source?.key ? `source-${source.key}` : "";
}

function MetricSourceMark({ source = null }) {
  if (!source?.mark) return null;
  return <i className={`metricSourceMark ${source.key}`} aria-hidden="true">{source.mark}</i>;
}

function trustTitle(label = "", value = "", detail = "", source = null) {
  const sourceTitle = String(source?.title || "").trim();
  const detailText = String(detail || "").trim();
  const extraDetail = detailText && !sourceTitle.includes(detailText) ? detailText : "";
  return compactTitle(`${label}: ${value}`, sourceTitle, extraDetail);
}

function withPatternHistoryCoverage(pattern = null, bars = []) {
  if (!pattern) return null;
  const existingBars = Number(pattern.patternBarsCount);
  if (Number.isFinite(existingBars)) return pattern;
  const barsCount = Array.isArray(bars) ? bars.length : 0;
  if (!barsCount) return pattern;
  const minBars = Number.isFinite(Number(pattern.patternMinBars)) ? Number(pattern.patternMinBars) : 90;
  return {
    ...pattern,
    patternBarsCount: barsCount,
    patternMinBars: minBars,
    patternCoveragePct: minBars > 0 ? Math.min(100, (barsCount / minBars) * 100) : null,
  };
}

function Metric({ label, value, tone = "", source = null, detail = "" }) {
  const title = trustTitle(label, value, detail, source);
  return <div className={`metric ${tone} ${sourceClass(source)}`.trim()} title={title} aria-label={title}>
    <span>{label}</span>
    <b>{value}<MetricSourceMark source={source} /></b>
  </div>;
}

/* scoreTone, riskTone, sampleText y metricSourceForValue se fueron el
   2026-08-21 con el panel Fuerza relativa, su último consumidor. La regla de
   sampleText («muestra cero es ausencia de muestra, no n=0») sigue vigente
   en rsRankingStripValue. */

function compactBusinessTeaser(data = {}) {
  data = data || {};
  const fallback = [data.sector, data.industry].filter(Boolean).join(" · ");
  const summary = String(data.summary || "").replace(/\s+/g, " ").trim();
  const usableSummary = summary && !/^Yahoo no ofrece/i.test(summary) ? summary : "";
  const raw = String(usableSummary || data.short || fallback || "").replace(/\s+/g, " ").trim();
  if (!raw || /^Yahoo no ofrece/i.test(raw)) return fallback || "Sin descripción disponible";
  if (raw.length <= 92) return raw;
  const clipped = raw.slice(0, 89).replace(/\s+\S*$/, "").trim();
  return clipped ? `${clipped}...` : raw.slice(0, 89);
}

function latestWeeklyRs(rs = {}) {
  return Array.isArray(rs.globalRsSeries) ? rs.globalRsSeries.at(-1) : null;
}

/* RsMetric, RsGroup, StockVolumePanel (con sus constantes KPI) y
   RelativeStrengthPanel vivían aquí. Retirados el 2026-08-21 — el comentario
   largo con qué contenía cada panel está en el punto del render donde se
   montaban, y el porqué completo en
   docs/analisis-ficha-cuadro-grafico-2026-08-21.md (Parte B). El cómputo del
   volumen (stockVolumeState) sigue vivo: alimenta las celdas de reparto e
   impulso de la franja descriptiva. */

function PeerLogo({ item }) {
  const [index, setIndex] = useState(0);
  const sources = [item.logoUrl, item.fallbackLogoUrl].filter(Boolean);
  const src = sources[index];
  return <span className="companyMark similarLogo">
    <b>{String(item.name || item.symbol).slice(0, 2).toUpperCase()}</b>
    {src ? <img src={src} alt="" loading="lazy" onError={() => setIndex((value) => value + 1)} /> : null}
  </span>;
}

/* El "Plan de operación" (pivot autogenerado, stop, objetivos 2R/3R y
   calculadora de posición) se retiró de la ficha: niveles de precio con
   nombre "Objetivo" y tamaño de posición sugerido son exactamente lo que
   el principio 1 prohíbe — el producto diciendo cuánto arriesgar. El
   cálculo (lib/tradePlan.js) sigue existiendo sin superficie. Los datos
   descriptivos que aquel panel duplicaba siguen a la vista dentro del
   desglose del patrón en N3 (rango y volumen seco de la ventana del
   detector); la distancia al pivote salió de N1 el 2026-08-15 por no ser un
   pivote, sino el máximo de esa misma ventana. */

function StockReviewFlowRail({ navigation = null, onOpenSymbol }) {
  if (!navigation?.totalRows) return null;
  const previousDisabled = !navigation.previousSymbol;
  const outOfFilter = !navigation.isCurrentVisible && navigation.hasFilters;
  const queueComplete = outOfFilter && (navigation.visibleCount || 0) <= 0;
  const nextDisabled = !navigation.nextSymbol && !queueComplete;
  const queueCompleteScope = navigation.resolutionFilter === "pending"
    ? "acciones pendientes"
    : navigation.filterLabel && navigation.filterLabel !== "Cola completa"
      ? `acciones del filtro ${navigation.filterLabel}`
      : "acciones en este filtro";
  const statusLine = navigation.isCurrentVisible
    ? `${navigation.sourceLabel} · ${navigation.visibleCount} acciones`
    : queueComplete
      ? `${navigation.sourceLabel} · cola completa`
      : `${navigation.sourceLabel} · acción resuelta fuera del filtro`;
  const statusCopy = queueComplete
    ? `Cola completa: no quedan ${queueCompleteScope}.`
    : outOfFilter
      ? "Resuelta: continúa con la siguiente acción pendiente."
      : statusLine;
  const nextLabel = navigation.isCurrentVisible ? "Siguiente" : queueComplete ? "Ver Review" : "Continuar cola";
  const nextHref = queueComplete ? navigation.reviewHref : (navigation.nextHref || navigation.reviewHref);
  const railClassName = [
    "stockReviewFlowRail",
    navigation.hasFilters ? "filtered" : "",
    outOfFilter ? "outOfFilter" : "",
    queueComplete ? "queueComplete" : "",
  ].filter(Boolean).join(" ");
  const nextClassName = ["primary", nextDisabled ? "disabled" : "", queueComplete ? "complete" : ""].filter(Boolean).join(" ");
  return <div className={railClassName} aria-label="Flujo Review de la ficha">
    <div className="stockReviewFlowMeta">
      <span>Review</span>
      <b>{navigation.positionLabel}</b>
      <em title={statusLine}>{navigation.filterLabel}</em>
    </div>
    <p title={statusLine}>{statusCopy}</p>
    <div className="stockReviewFlowActions">
      <a href={navigation.reviewHref}>Volver</a>
      <a
        href={navigation.previousHref || navigation.reviewHref}
        className={previousDisabled ? "disabled" : ""}
        aria-disabled={previousDisabled}
        onClick={(event) => {
          if (previousDisabled) event.preventDefault();
          else onOpenSymbol?.(navigation.previousSymbol);
        }}
      >
        Anterior
      </a>
      <a
        href={nextHref}
        className={nextClassName}
        aria-disabled={nextDisabled}
        onClick={(event) => {
          if (nextDisabled) event.preventDefault();
          else if (!queueComplete) onOpenSymbol?.(navigation.nextSymbol);
        }}
      >
        {nextLabel}
      </a>
    </div>
  </div>;
}

/* ── La «mesa de observación» (StockDecisionDesk) vivía aquí — retirada el
   2026-08-22, NO reponer sin releer docs/principios-producto.md (principio 1)
   y docs/analisis-ficha-2026-08-15.md (A2/B1) ──────────────────────────────

   Qué mostraba: la cabecera «OBSERVACIÓN: PENDIENTE · BEARISH» con contador
   de pruebas (7/9), el foco del motor, el brief tesis/riesgo/siguiente paso
   («tesis de deterioro», «tratar como riesgo», «Auditar antes»), las
   evidencias pendientes, la «coherencia gráfico» («RS overlay Oculto»,
   «VCP Apagado») y los presets de vista («D · 1A · RS/volumen»,
   «D · 3M · VCP»). Todo salía de buildStockDecisionDesk sobre el
   decisionTrace/readiness que viaja en lastOpenedStockContext, así que SOLO
   aparecía al entrar desde el screener/review: la ficha tenía dos caras
   según la ruta de entrada (análisis del 15, A2).

   Se retiró por tres motivos:
   1. Principio 1 (la herramienta clasifica, no recomienda): «tesis de
      deterioro», «tratar como riesgo» o «Auditar antes» son veredictos
      operativos del sistema — la retirada del chip de N0 se había hecho en
      el chip y no en la fuente, y el mismo veredicto resucitaba aquí.
   2. Coherencia entre rutas: por URL directa la ficha era descriptiva; desde
      el screener recuperaba el veredicto. Ahora se ve igual por ambas vías.
   3. Estado interno visible: «RS overlay oculto», «VCP apagado» o el nombre
      de las vistas son configuración de la aplicación, no información del
      valor. Y el veredicto («bearish») contradecía a la tarjeta de identidad
      pegada debajo (etapa 2, RS alto, cerca de máximos).

   lib/stockDecisionDesk.js y tests/stockDecisionDesk.test.js se fueron con
   el bloque. tests/fichaRetiradas.test.js vigila que no vuelva.

   Lo que SÍ era del usuario se conserva justo debajo, ahora en TODAS las
   entradas (por URL incluida — B2 del análisis del 15): la clasificación
   manual (Candidata/Vigilar/Descartar + Reabrir + nota), que escribe en
   la cola de Review (decisionResolutions) y alimenta el filtro «Resolución»
   del screener, y el rail de navegación de la cola de Review. El trío
   Validado/Pendiente/Bloquea se retiró con la mesa: calificaba «la prueba
   de foco» del motor, que ya no existe en la ficha. */

function StockUserClassification({
  resolution = null,
  resolutionHistory = [],
  reviewNavigation = null,
  note = "",
  onNoteChange,
  onOpenReviewSymbol,
  onResolveDecision,
  onReopenDecision,
}) {
  return <section className="stockUserClassification" aria-label="Clasificación manual del inversor">
    <StockReviewFlowRail navigation={reviewNavigation} onOpenSymbol={onOpenReviewSymbol} />
    <div className="stockDecisionResolveRail" aria-label="Clasificar el valor">
      <span>{resolution ? `Clasificación: ${resolution.label}` : "Tu clasificación"}</span>
      <label className="stockDecisionValidationNote">
        <span>Nota del inversor</span>
        <input
          value={note}
          maxLength={120}
          onChange={(event) => onNoteChange?.(event.target.value)}
          placeholder="Qué observas en la ficha"
        />
      </label>
      <div>
        <button
          type="button"
          className={`neutral ${!resolution ? "active" : ""}`.trim()}
          onClick={() => onReopenDecision?.()}
          title="Vuelve a pendiente"
          disabled={!resolution}
        >
          Reabrir
        </button>
        {STOCK_DECISION_ACTIONS.map((item) => <button
          type="button"
          key={item.key}
          className={`${item.tone || ""} ${resolution?.key === item.key ? "active" : ""}`.trim()}
          onClick={() => onResolveDecision?.(item.key)}
          title={item.detail}
        >
          {item.label}
        </button>)}
      </div>
    </div>
    {resolutionHistory.length ? <div className="stockDecisionHistory" aria-label="Historial manual de la ficha">
      <span>Historial manual</span>
      <div>
        {resolutionHistory.map((entry) => <article className={entry.tone || ""} key={`${entry.symbol}-${entry.key}-${entry.updatedAt}-${entry.note}`}>
          <b>{entry.label}</b>
          <em>{dateTimeFmt(entry.updatedAt) || entry.source}</em>
          <p>{entry.note || entry.detail}</p>
        </article>)}
      </div>
    </div> : null}
  </section>;
}

function HolderTable({ title, rows }) {
  return <section className="card">
    <h2>{title}</h2>
    <div className="tableWrap">
      <table className="table">
        <thead><tr>{["Nombre", "%", "Posicion", "Valor", "Fecha"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows?.length ? rows.map((r) => <tr key={`${title}-${r.name}`}><td>{r.name}</td><td>{pct(r.pctHeld)}</td><td>{fmt(r.position)}</td><td>{fmt(r.value)}</td><td>{r.reportDate ? dateShort(r.reportDate) : "Sin dato"}</td></tr>) : <tr><td colSpan="5">Sin dato</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

function EarningsSection({ calendar = {}, currency = "" }) {
  if (!calendar) return null;
  return <section className="card">
    <div className="sectionTitle">
      <h2>Resultados y calendario <InfoHint text={calendar.source || "Calendario y estimaciones según proveedor disponible."} /></h2>
    </div>
    <div className="calendarGrid">
      <Metric label="Proxima fecha resultados" value={calendar.earningsDate || (calendar.earningsStart && calendar.earningsEnd ? `${calendar.earningsStart} / ${calendar.earningsEnd}` : "Sin dato")} />
      <Metric label="EPS estimate" value={money(calendar.epsEstimate, currency)} source={metricSourceState("proxy", "EPS estimate", "estimación de proveedor")} />
      <Metric label="EPS growth est." value={pct(calendar.epsEstimateGrowth)} source={metricSourceState("proxy", "EPS growth est.", "estimación de proveedor")} />
      <Metric label="Revenue estimate" value={money(calendar.revenueEstimate, currency)} source={metricSourceState("proxy", "Revenue estimate", "estimación de proveedor")} />
      <Metric label="Revenue growth est." value={pct(calendar.revenueEstimateGrowth)} source={metricSourceState("proxy", "Revenue growth est.", "estimación de proveedor")} />
      <Metric label="Ex-dividend date" value={calendar.exDividendDate || "Sin dato"} />
    </div>
  </section>;
}

function ResultsSection({ results = {}, currency = "", embedded = false, snapshot = null }) {
  const [period, setPeriod] = useState("quarter");
  const [statement, setStatement] = useState("summary");
  const incomeQuarterly = results?.incomeQuarterly || [];
  const incomeAnnual = results?.incomeAnnual || [];
  const incomeRows = period === "quarter" ? incomeQuarterly : incomeAnnual;
  const balanceRows = period === "quarter" ? (results?.balanceQuarterly || []) : (results?.balanceAnnual || []);
  const cashflowRows = period === "quarter" ? (results?.cashflowQuarterly || []) : (results?.cashflowAnnual || []);
  const latestQuarter = incomeQuarterly[0] || incomeAnnual[0] || {};
  const latestAnnual = incomeAnnual[0] || {};
  const latest = results?.latest || {};
  const balance = results?.balanceQuarterly?.[0] || results?.balanceAnnual?.[0] || {};
  const cashflowQuarter = results?.cashflowQuarterly?.[0] || results?.cashflowAnnual?.[0] || {};
  const cashflowAnnual = results?.cashflowAnnual?.[0] || {};
  if (!results) return null;

  const findByDate = (rows, date, index) => rows.find((row) => row.date === date) || rows[index] || {};
  const count = Math.max(incomeRows.length, balanceRows.length, cashflowRows.length);
  const periods = Array.from({ length: count }).map((_, index) => {
    const income = incomeRows[index] || {};
    const date = income.date || balanceRows[index]?.date || cashflowRows[index]?.date || "";
    return {
      date,
      income,
      balance: findByDate(balanceRows, date, index),
      cashflow: findByDate(cashflowRows, date, index),
    };
  }).filter((row) => row.date).slice(0, period === "quarter" ? 8 : 6);

  const debtEquity = (row) => Number.isFinite(row.balance?.totalDebt) && Number.isFinite(row.balance?.equity) && row.balance.equity !== 0 ? row.balance.totalDebt / row.balance.equity : null;
  const fcfMargin = (row) => Number.isFinite(row.cashflow?.freeCashFlow) && Number.isFinite(row.income?.revenue) && row.income.revenue !== 0 ? (row.cashflow.freeCashFlow / row.income.revenue) * 100 : null;
  const formatValue = (value, type) => {
    if (type === "money") return money(value, currency);
    if (type === "pct") return pct(value);
    if (type === "ratio") return ratio(value);
    return fmt(value);
  };
  const valueTone = (value, tone) => {
    if (!tone || !Number.isFinite(value)) return "";
    return value > 0 ? "positive" : value < 0 ? "negative" : "";
  };
  const rowsByStatement = {
    summary: [
      { label: "Ventas", type: "money", get: (row) => row.income.revenue },
      { label: "Ventas YoY", type: "pct", tone: true, get: (row) => row.income.revenueGrowthYoY },
      { label: "Margen bruto", type: "pct", get: (row) => Number.isFinite(row.income.grossProfit) && Number.isFinite(row.income.revenue) && row.income.revenue !== 0 ? (row.income.grossProfit / row.income.revenue) * 100 : null },
      { label: "Margen operativo", type: "pct", get: (row) => Number.isFinite(row.income.operatingIncome) && Number.isFinite(row.income.revenue) && row.income.revenue !== 0 ? (row.income.operatingIncome / row.income.revenue) * 100 : null },
      { label: "Beneficio neto", type: "money", get: (row) => row.income.netIncome },
      { label: "Beneficio YoY", type: "pct", tone: true, get: (row) => row.income.netIncomeGrowthYoY },
      { label: "EPS", type: "ratio", get: (row) => row.income.eps },
      { label: "Free cash flow", type: "money", get: (row) => row.cashflow.freeCashFlow },
      { label: "Caja", type: "money", get: (row) => row.balance.cash },
      { label: "Deuda total", type: "money", get: (row) => row.balance.totalDebt },
    ],
    income: [
      { label: "Ventas", type: "money", get: (row) => row.income.revenue },
      { label: "Ventas YoY", type: "pct", tone: true, get: (row) => row.income.revenueGrowthYoY },
      { label: "Beneficio bruto", type: "money", get: (row) => row.income.grossProfit },
      { label: "Margen bruto", type: "pct", get: (row) => Number.isFinite(row.income.grossProfit) && Number.isFinite(row.income.revenue) && row.income.revenue !== 0 ? (row.income.grossProfit / row.income.revenue) * 100 : null },
      { label: "Resultado operativo", type: "money", get: (row) => row.income.operatingIncome },
      { label: "Margen operativo", type: "pct", get: (row) => Number.isFinite(row.income.operatingIncome) && Number.isFinite(row.income.revenue) && row.income.revenue !== 0 ? (row.income.operatingIncome / row.income.revenue) * 100 : null },
      { label: "EBITDA", type: "money", get: (row) => row.income.ebitda },
      { label: "Beneficio neto", type: "money", get: (row) => row.income.netIncome },
      { label: "Beneficio YoY", type: "pct", tone: true, get: (row) => row.income.netIncomeGrowthYoY },
      { label: "EPS", type: "ratio", get: (row) => row.income.eps },
    ],
    balance: [
      { label: "Caja", type: "money", get: (row) => row.balance.cash },
      { label: "Deuda total", type: "money", get: (row) => row.balance.totalDebt },
      { label: "Activos totales", type: "money", get: (row) => row.balance.totalAssets },
      { label: "Pasivos totales", type: "money", get: (row) => row.balance.totalLiabilities },
      { label: "Patrimonio", type: "money", get: (row) => row.balance.equity },
      { label: "Deuda / patrimonio", type: "ratio", get: debtEquity },
    ],
    cashflow: [
      { label: "Cash flow operativo", type: "money", get: (row) => row.cashflow.operatingCashFlow },
      { label: "Capex", type: "money", get: (row) => row.cashflow.capitalExpenditures },
      { label: "Free cash flow", type: "money", get: (row) => row.cashflow.freeCashFlow },
      { label: "Margen FCF", type: "pct", get: fcfMargin },
      { label: "Dividendos pagados", type: "money", get: (row) => row.cashflow.dividendsPaid },
      { label: "Recompras", type: "money", get: (row) => row.cashflow.repurchaseOfStock },
    ],
  };
  const isSnapshot = statement === "snapshot" && snapshot;
  const tableRows = isSnapshot ? [] : rowsByStatement[statement] || rowsByStatement.summary;
  const candidateRows = tableRows.filter((row) => periods.some((periodRow) => Number.isFinite(row.get(periodRow))));
  const minValuesByStatement = statement === "summary" ? 4 : statement === "income" ? 3 : 1;
  const visiblePeriods = periods.filter((periodRow) => candidateRows.reduce((count, row) => count + (Number.isFinite(row.get(periodRow)) ? 1 : 0), 0) >= minValuesByStatement);
  const visibleRows = candidateRows.filter((row) => visiblePeriods.some((periodRow) => Number.isFinite(row.get(periodRow))));

  return <section className={embedded ? "fundamentalHistory" : "card fundamentalCard"}>
    <div className="sectionTitle">
      <h2>{embedded ? "Histórico" : "Fundamentales históricos"} {!embedded && <InfoHint text="Vista inspirada en estados financieros históricos; no son datos normalizados propietarios. La cobertura puede variar por mercado, moneda y disponibilidad." />}</h2>
      <span className="fine">{currency || "Moneda no disponible"}</span>
    </div>
    <div className="fundamentalToolbar" aria-label="Selector de fundamentales">
      <div>
        <button type="button" className={period === "quarter" ? "active" : ""} onClick={() => setPeriod("quarter")}>Trimestres</button>
        <button type="button" className={period === "annual" ? "active" : ""} onClick={() => setPeriod("annual")}>Años</button>
      </div>
      <div>
        {snapshot && <button type="button" className={statement === "snapshot" ? "active" : ""} onClick={() => setStatement("snapshot")}>Métricas</button>}
        <button type="button" className={statement === "summary" ? "active" : ""} onClick={() => setStatement("summary")}>Resumen</button>
        <button type="button" className={statement === "income" ? "active" : ""} onClick={() => setStatement("income")}>Resultados</button>
        <button type="button" className={statement === "balance" ? "active" : ""} onClick={() => setStatement("balance")}>Balance</button>
        <button type="button" className={statement === "cashflow" ? "active" : ""} onClick={() => setStatement("cashflow")}>Cash flow</button>
      </div>
    </div>
    {isSnapshot ? <div className="fundamentalSnapshotPane">{snapshot}</div> : visiblePeriods.length && visibleRows.length ? <div className="tableWrap statementMatrix">
      <table className="table">
        <thead><tr><th>Magnitud</th>{visiblePeriods.map((row) => <th key={`${period}-${row.date}`}>{row.date ? dateShort(row.date) : "Sin dato"}</th>)}</tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={`${statement}-${row.label}`}>
          <td>{row.label}</td>
          {visiblePeriods.map((periodRow) => {
            const value = row.get(periodRow);
            return <td key={`${row.label}-${periodRow.date}`} className={valueTone(value, row.tone)}>{formatValue(value, row.type)}</td>;
          })}
        </tr>)}</tbody>
      </table>
    </div> : <div className="dataNote" style={{ marginTop: 12 }}>Histórico insuficiente del proveedor para esta vista. Se mantienen las métricas disponibles y el resto queda como Sin dato.</div>}
  </section>;
}

function MiniMetric({ label, value, tone = "", source = null, detail = "" }) {
  const title = trustTitle(label, value, detail, source);
  return <div className={`miniMetric ${tone} ${sourceClass(source)}`.trim()} title={title} aria-label={title}>
    <span>{label}</span>
    <b>{value}<MetricSourceMark source={source} /></b>
  </div>;
}

function HeroMetric({ label, value, tone = "", source = null, detail = "" }) {
  const title = trustTitle(label, value, detail, source);
  return <div className={sourceClass(source)} title={title} aria-label={title}>
    <span>{label}</span>
    <b className={tone}>{value}<MetricSourceMark source={source} /></b>
  </div>;
}

function FundamentalGroup({ title, children }) {
  return <div className="fundamentalGroup">
    <h3>{title}</h3>
    <div className="fundamentalGroupGrid">{children}</div>
  </div>;
}

function FundamentalSnapshot({ data = {}, growth = {}, valuation = {}, quote = {}, calendar = {}, currency = "" }) {
  const results = data.financialResults || {};
  const latest = results.latest || {};
  const balance = results.balanceQuarterly?.[0] || results.balanceAnnual?.[0] || {};
  const cashflow = results.cashflowQuarterly?.[0] || results.cashflowAnnual?.[0] || {};
  const displayCurrency = currency || data.currency || "Moneda no disponible";
  const rows = [
    ["Valoracion", "Capitalizacion", money(data.marketCap, data.marketCapCurrency || data.currency)],
    ["Valoracion", "P/E fwd", ratio(finiteValue(valuation.forwardPe, valuation.forwardPE))],
    ["Valoracion", "P/S", ratio(valuation.priceToSales)],
    ["Valoracion", "EV/EBITDA", ratio(valuation.enterpriseToEbitda)],
    ["Valoracion", "Div. yield", pct(valuation.dividendYield)],
    ["Rentabilidad", "Margen bruto", pct(growth.grossMargin)],
    ["Rentabilidad", "Margen operativo", pct(growth.operatingMargin)],
    ["Rentabilidad", "Margen neto", pct(growth.profitMargin)],
    ["Rentabilidad", "ROE", pct(growth.roe)],
    ["Balance", "Deuda/Equity", ratio(growth.debtToEquity)],
    ["Balance", "Current ratio", ratio(growth.currentRatio)],
    ["Balance", "Caja", money(balance.cash ?? latest.cash, displayCurrency)],
    ["Balance", "Deuda total", money(balance.totalDebt ?? latest.totalDebt, displayCurrency)],
    ["Balance", "Free cash flow", money(cashflow.freeCashFlow ?? latest.freeCashFlow, displayCurrency)],
    ["Estructura", "Acciones", fmt(valuation.sharesOutstanding || growth.sharesOutstanding)],
    ["Estructura", metricShortLabel("shortPercentOfFloat"), pct(growth.shortPercentOfFloat)],
  ];
  return <div className="tableWrap statementMatrix metricsStatementMatrix">
    <table className="table">
      <thead><tr><th>Métrica</th><th>Valor</th></tr></thead>
      <tbody>{rows.map(([group, label, value]) => <tr key={`${group}-${label}`}>
        <td>{label}</td>
        <td>{value}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function CompactHolderList({ title, rows = [] }) {
  const visibleRows = (rows || []).filter(Boolean).slice(0, 5);
  return <div className="compactHolderList">
    <h3>{title}</h3>
    <div>
      {visibleRows.length ? visibleRows.map((row) => <div className="compactHolderRow" key={`${title}-${row.name}`}>
        <span>{row.name || "Sin nombre"}</span>
        <b>{Number.isFinite(row.pctHeld) ? pct(row.pctHeld) : row.reportDate ? dateShort(row.reportDate) : ""}</b>
      </div>) : <div className="compactHolderEmpty">Sin dato</div>}
    </div>
  </div>;
}

function FundamentalsPanel({ data = {}, growth = {}, valuation = {}, quote = {}, calendar = {}, currency = "" }) {
  const results = data.financialResults || {};
  const displayCurrency = currency || data.currency || "Moneda no disponible";
  return <section className="card fundamentalsPanel">
    <ResultsSection results={results} currency={displayCurrency} embedded snapshot={<FundamentalSnapshot data={data} growth={growth} valuation={valuation} quote={quote} calendar={calendar} currency={displayCurrency} />} />

    <div className="fundamentalHoldersCompact">
      <CompactHolderList title="Top funds" rows={growth.topFunds} />
      <CompactHolderList title="Top institutions" rows={growth.topInstitutions} />
    </div>
  </section>;
}

function compactPeriodLabel(date = "", period = "annual") {
  const value = String(date || "");
  const year = value.slice(0, 4);
  if (!year) return "Sin dato";
  if (period === "annual") return year;
  const month = Number(value.slice(5, 7));
  const quarter = Number.isFinite(month) && month > 0 ? Math.ceil(month / 3) : "";
  return quarter ? `${year} T${quarter}` : year;
}

function finiteValue(...values) {
  return values.find(Number.isFinite);
}

function sortLatestFirst(rows = []) {
  return [...rows].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function calcGrowth(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current / previous) - 1) * 100;
}

function rowGrowth(row, sourceRows, index, valueKey, growthKey, compareOffset) {
  const providerGrowth = finiteValue(row?.[growthKey]);
  if (Number.isFinite(providerGrowth)) return providerGrowth;
  return calcGrowth(row?.[valueKey], sourceRows[index + compareOffset]?.[valueKey]);
}

function epsValue(row, sharesOutstanding) {
  if (Number.isFinite(row?.eps)) return { value: row.eps, derived: false };
  const rowShares = finiteValue(row?.weightedAverageShsOutDil, row?.weightedAverageShsOut, row?.sharesOutstanding, sharesOutstanding);
  if (Number.isFinite(row?.netIncome) && Number.isFinite(rowShares) && rowShares > 0) {
    return { value: row.netIncome / rowShares, derived: true };
  }
  return { value: null, derived: false };
}

function epsGrowth(row, sourceRows, index, compareOffset, sharesOutstanding) {
  const providerGrowth = finiteValue(row?.epsGrowthYoY);
  if (Number.isFinite(providerGrowth)) return providerGrowth;
  const current = epsValue(row, sharesOutstanding).value;
  const previous = epsValue(sourceRows[index + compareOffset], sharesOutstanding).value;
  return calcGrowth(current, previous);
}

function valueTone(value) {
  if (!Number.isFinite(value)) return "";
  return value > 0 ? "good" : value < 0 ? "bad" : "neutral";
}

function average(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function technicalSnapshotFromBars(bars = [], quote = {}) {
  const rows = [...(bars || [])]
    .map((bar) => ({
      date: bar.date,
      close: Number(bar.close),
      high: Number(bar.high),
      volume: Number(bar.volume),
    }))
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const latest = rows.at(-1) || {};
  const price = finiteValue(latest.close, quote.price);
  const last50 = rows.slice(-50);
  const last200 = rows.slice(-200);
  const last252 = rows.slice(-252);
  const sma50 = average(last50.map((row) => row.close));
  const sma200 = average(last200.map((row) => row.close));
  const avgVolume50 = average(last50.map((row) => row.volume));
  const high52w = Math.max(...last252.map((row) => row.high).filter(Number.isFinite), 0);
  return {
    price,
    sma50,
    sma200,
    distanceSma50: Number.isFinite(price) && Number.isFinite(sma50) && sma50 > 0 ? ((price / sma50) - 1) * 100 : null,
    distanceSma200: Number.isFinite(price) && Number.isFinite(sma200) && sma200 > 0 ? ((price / sma200) - 1) * 100 : null,
    relativeVolume50: Number.isFinite(latest.volume) && Number.isFinite(avgVolume50) && avgVolume50 > 0 ? latest.volume / avgVolume50 : null,
    distance52w: Number.isFinite(price) && high52w > 0 ? ((price / high52w) - 1) * 100 : null,
  };
}

function priceSnapshotFromBars(bars = [], quote = {}) {
  const rows = [...(bars || [])]
    .map((bar) => ({
      date: bar.date,
      close: Number(bar.close),
    }))
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const latest = rows.at(-1) || {};
  const previous = rows.at(-2) || {};
  const price = finiteValue(latest.close, quote.price);
  const dayChange = Number.isFinite(price) && Number.isFinite(previous.close) ? price - previous.close : quote.dayChange;
  const dayChangePct = Number.isFinite(price) && Number.isFinite(previous.close) && previous.close > 0 ? ((price / previous.close) - 1) * 100 : quote.dayChangePct;
  const quoteDriftPct = Number.isFinite(latest.close) && Number.isFinite(quote.price) && latest.close > 0
    ? Math.abs((quote.price / latest.close) - 1) * 100
    : null;
  return {
    price,
    date: latest.date || "",
    dayChange,
    dayChangePct,
    quoteDriftPct,
    coherent: !Number.isFinite(quoteDriftPct) || quoteDriftPct < 0.35,
  };
}

// Los benchmarks de índice US van por su ETF (decisión 2026-08-16): fuera
// ^GSPC y ^IXIC, que duplicaban SPY y QQQ con un símbolo que el sistema no
// acumula en daily_bars. Los cuatro últimos (^N225, ^HSI, ^STOXX50E, ^AXJO)
// son benchmarks extranjeros que no encajan con una versión solo-US; quedan
// señalados aquí pero su retirada es una decisión aparte.
const BENCHMARK_OPTIONS = ["SPY", "QQQ", "ACWI", "IWM", "DIA", "VTI", "^N225", "^HSI", "^STOXX50E", "^AXJO"];

function cleanBenchmarkSymbol(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 24);
}

function FundamentalMiniTable({ results = {}, currency = "", metrics = {}, sharesOutstanding = null }) {
  const annualSource = sortLatestFirst(results?.incomeAnnual || [])
    .filter((row) => row?.date && [row.revenue, row.netIncome, row.eps, row.revenueGrowthYoY, row.netIncomeGrowthYoY].some(Number.isFinite));
  const quarterSource = sortLatestFirst(results?.incomeQuarterly || [])
    .filter((row) => row?.date && [row.revenue, row.netIncome, row.eps, row.revenueGrowthYoY, row.netIncomeGrowthYoY].some(Number.isFinite));
  const useAnnual = annualSource.length >= 2;
  const sourceRows = useAnnual ? annualSource : quarterSource;
  const rows = sourceRows.slice(0, 5);
  const period = useAnnual ? "annual" : "quarter";
  const compareOffset = useAnnual ? 1 : 4;

  if (!rows.length) {
    return <div className="researchMetricGrid">
      <div className="researchMetric"><span>Ventas</span><b>{pct(metrics.revenueGrowth)}</b></div>
      <div className="researchMetric"><span>EPS YoY</span><b>{pct(metrics.earningsGrowth)}</b></div>
      <div className="researchMetric"><span>Margen op.</span><b>{pct(metrics.operatingMargin)}</b></div>
      <div className="researchMetric"><span>ROE</span><b>{pct(metrics.roe)}</b></div>
    </div>;
  }

  return <div className="fundamentalMiniTable" aria-label="Histórico fundamental compacto">
    <div className="fundamentalMiniRow head">
      <span>{useAnnual ? "Año" : "Per."}</span>
      <span>Ventas</span>
      <span>YoY</span>
      <span>EPS</span>
      <span>EPS YoY</span>
    </div>
    {rows.map((row, index) => {
      const revenueGrowth = rowGrowth(row, sourceRows, index, "revenue", "revenueGrowthYoY", compareOffset);
      const eps = epsValue(row, sharesOutstanding);
      const epsYoY = epsGrowth(row, sourceRows, index, compareOffset, sharesOutstanding);
      return <div className="fundamentalMiniRow" key={`${period}-${row.date}`}>
        <span>{compactPeriodLabel(row.date, period)}</span>
        <b>{money(row.revenue, currency)}</b>
        <b className={valueTone(revenueGrowth)}>{pct(revenueGrowth)}</b>
        <b title={eps.derived ? "EPS aproximado: beneficio neto / acciones emitidas actuales" : undefined}>
          {ratio(eps.value)}{eps.derived && <small>calc.</small>}
        </b>
        <b className={valueTone(epsYoY)}>{pct(epsYoY)}</b>
      </div>;
    })}
  </div>;
}

function NewsSection({ rows = [] }) {
  const cardContent = (item) => <>
    {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
    <span>
      <i className={`sentimentPill ${sentimentClass(item.sentimentLabel)}`}>{item.sentimentLabel || "neutral"}</i>
      <b>{item.title}</b>
      <em>{displayNewsPublisher(item.publisher)} · {dateFmt(item.publishedAt)}</em>
      <small>{item.relevanceReasons?.length ? `Relevancia: ${item.relevanceReasons.join(", ")}` : "Relevancia aproximada por ticker/nombre"}</small>
      <span className={`newsLinkCue ${item.link ? "" : "disabled"}`}>{item.link ? "Abrir noticia ->" : "Sin enlace disponible"}</span>
    </span>
  </>;
  return <section className="card">
    <div className="sectionTitle">
      <h2>Noticias relevantes <InfoHint text="Noticias recuperadas desde fuentes disponibles. La relevancia y el sesgo son heurísticas, no una clasificación editorial." /></h2>
      <span className="fine">sesgo heurístico</span>
    </div>
    <div className="newsGrid">
      {rows?.length ? rows.map((item, index) => {
        const className = `newsItem ${item.thumbnail ? "" : "newsItemNoThumb"} ${index === 0 ? "newsItemLead" : ""} ${item.link ? "" : "newsItemDisabled"}`;
        return item.link
          ? <a className={className} key={`${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer" aria-label={`Abrir noticia: ${item.title}`}>{cardContent(item)}</a>
          : <article className={className} key={`${item.title}-${item.publishedAt}`}>{cardContent(item)}</article>;
      }) : <div className="dataNote">Sin noticias recientes para este ticker.</div>}
    </div>
  </section>;
}

function SocialPulseSection({ social = null, loading = false, symbol = "" }) {
  // Integración opcional: si no está activada, la sección entera desaparece.
  // No se avisa de ello — que falte un token de despliegue no es información
  // sobre este valor. `loading` ya no la mantiene viva: mientras carga no
  // sabemos si existe, y aparecer para desaparecer es peor que no aparecer.
  if (!social || social.configured === false) return null;
  const hasSample = Number(social?.total) > 0;
  const bullish = hasSample ? Math.max(0, Math.min(100, social?.bullishPct || 0)) : 0;
  const neutral = hasSample ? Math.max(0, Math.min(100, social?.neutralPct || 0)) : 0;
  const bearish = hasSample ? Math.max(0, Math.min(100, social?.bearishPct || 0)) : 0;
  const hasRows = !!social?.rows?.length;
  return <section className="card">
    <div className="sectionTitle">
      <h2>Pulso X / cashtag <InfoHint text="Busca posts recientes con cashtag tipo $TICKER si hay integración social configurada. No se usa como fuente de precio." /></h2>
      <span className="fine">{loading ? "cargando" : hasRows ? "muestra reciente" : "sin datos"}</span>
    </div>
    {social?.error && <div className="dataNote" style={{ marginBottom: 12 }}>{social.error}</div>}
    {hasSample && <div className="sentimentBars" aria-label={`Distribucion social de ${symbol}`}>
      <span className="bearish" style={{ width: `${bearish}%` }} />
      <span className="neutral" style={{ width: `${neutral}%` }} />
      <span className="bullish" style={{ width: `${bullish}%` }} />
    </div>}
    <div className="metricGrid">
      <Metric label="Posts" value={fmt(social?.total)} />
      <Metric label="Alcistas" value={`${fmt(social?.bullish)} · ${pct(social?.bullishPct)}`} />
      <Metric label="Bajistas" value={`${fmt(social?.bearish)} · ${pct(social?.bearishPct)}`} />
      <Metric label="Pesimismo social" value={fmt(social?.pessimismIndex)} />
      <Metric label="Engagement" value={fmt(social?.totalEngagement)} />
      <Metric label="Score ponderado" value={Number.isFinite(social?.weightedAvgScore) ? social.weightedAvgScore.toFixed(1) : "Sin dato"} source={metricSourceState("proxy", "Score ponderado", "heurística social")} />
    </div>
    <div className="summaryRow"><span>Query</span><span className="summaryValue"><b>{social?.query || `"$${String(symbol).split(".")[0]}"`}</b></span></div>
    {hasRows ? <div className="newsGrid" style={{ marginTop: 14 }}>
      {social.rows.slice(0, 8).map((item) => <a className="newsItem newsTextOnly" key={item.id || `${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer">
        <span>
          <i className={`sentimentPill ${sentimentClass(item.sentimentLabel)}`}>{item.sentimentLabel || "neutral"}</i>
          <b>{item.title}</b>
          <em>{item.publisher || "X"} · {dateFmt(item.publishedAt)}</em>
          <small>{item.sentimentReasons?.length ? `${item.sentimentReasons.join(", ")} · engagement ${item.engagement || 0}` : `sin sesgo fuerte detectado · engagement ${item.engagement || 0}`}</small>
        </span>
      </a>)}
    </div> : <div className="dataNote" style={{ marginTop: 12 }}>{loading ? "Leyendo posts recientes..." : "Sin posts recientes disponibles para esta muestra."}</div>}
  </section>;
}

function SimilarStocks({ rows = [] }) {
  if (!rows.length) return null;
  return <section className="card">
    <div className="sectionTitle"><h2>Acciones similares</h2></div>
    <div className="similarGrid">
      {rows.map((item) => <a className="similarCard" key={item.symbol} href={`/stock/${encodeURIComponent(item.symbol)}`} aria-label={`Abrir ficha de ${item.symbol}`}>
        <div className="similarTop">
          <PeerLogo item={item} />
          <div>
            <strong className="ticker">{item.symbol}</strong>
            <p>{item.name || item.symbol}</p>
          </div>
        </div>
        <div className="similarMeta">
          <span>{item.theme || item.sector || "Sin clasificar"}</span>
          <span>{item.industry || item.country || "-"}</span>
        </div>
      </a>)}
    </div>
  </section>;
}

/* StructureSummary, DataConfidenceCell y patternClaimBlocked vivían aquí:
   solo los consumía ComparativeContext (retirado el 2026-08-21, ver el
   comentario en el render). */

function AuditCheck({ label, value, state = "neutral", detail = "" }) {
  const source = metricSourceFromState(state, label, detail);
  const title = trustTitle(label, value, detail, source);
  return <div className={`auditCheck ${state} ${sourceClass(source)}`.trim()} title={title} aria-label={title}>
    <span>{label}</span>
    <b>{value}<MetricSourceMark source={source} /></b>
  </div>;
}

function MethodologyAuditPanel({ pattern, verdict, stage }) {
  if (!pattern) return null;
  const display = methodologyDisplayForRow(pattern);
  const currentVerdict = verdict || display.verdict;
  const confidence = display.confidence;
  const objective = vcpObjectiveSummary(pattern);
  // Diccionario único de la etapa (lib/stageDisplay.js): el gate escribe la
  // MISMA palabra que la tabla y la cabecera, venga el label guardado en el
  // formato viejo ("Stage 2 probable") o en el nuevo.
  const stageGateInfo = stageWordForState(stage?.weekly?.state || "", stage?.label || "");
  const stageOk = stageGateInfo?.tone === "stage2";
  // El desglose numérico del score (Rango 65 sesiones, Compresiones, Última
  // comp., Rango 10d, Dist. techo 65 sesiones, Volumen seco, Score patrón)
  // vive ahora en stockScoreBreakdown
  // dentro de N3 — este panel solo conserva los gates que no son desglose del score
  // (Datos técnicos, Histórico, Etapa, Plan) más el veredicto y la confianza de
  // metodología. No duplica el breakdown.
  const planValid = display.actionable && display.tradePlanEligible && !display.blocksPatternClaim;
  const fullReason = display.reason || currentVerdict.reason || "Sin razón disponible.";
  const objectiveDetail = [objective.detail, `Veredicto: ${display.label}`, fullReason].filter(Boolean).join(" · ");
  return <section className="card methodologyAuditPanel">
    <div className="sectionTitle methodologyAuditTitle">
      <div>
        <h2>Evidencia VCP <InfoHint text="Datos observables de la base actual: compresiones de precio, rango, pivot y volumen. El veredicto se mantiene como contexto, no como recomendación." /></h2>
      </div>
      <div className="methodologyBadgeStack">
        <span className={`methodologyVerdictBadge ${display.tone || ""}`.trim()} title={display.reason || ""}>{display.label}</span>
        <span className={`methodologyConfidenceBadge ${confidence.state}`.trim()} title={confidence.detail}>{confidence.label}</span>
      </div>
    </div>
    <p className="methodologyVerdictReason" title={objectiveDetail}>
      <span>{objective.primary}</span>
      <InfoHint text={objectiveDetail} />
    </p>
    <div className="auditGrid">
      <AuditCheck label="Datos técnicos" value={confidence.label} state={confidence.state} detail={confidence.detail || currentVerdict.dataLabel || dataStatusLabel(pattern.patternDataStatus)} />
      <AuditCheck label="Histórico" value={objective.history?.value || "Sin dato"} state={objective.history?.state || "neutral"} detail={objective.history?.detail || ""} />
      <AuditCheck label="Etapa" value={stageGateInfo?.word || "Sin dato"} state={stageOk ? "pass" : "warn"} />
      <AuditCheck label="Plan" value={planValid ? "Válido" : "No válido"} state={planValid ? "pass" : "fail"} detail={display.tradePlanReason || currentVerdict.tradePlanReason || display.reason || ""} />
    </div>
  </section>;
}

/* ContractionTape y ComparativeContext («Contexto comparativo», con su
   tabla Ticker/Relación/Estructura/Contracciones/Rango 65s/Vol. seco/
   RS grupo/Datos) vivían aquí. Retirados el 2026-08-21 junto con su fetch a
   /api/comparables — el comentario largo está en el punto del render donde
   se montaba, y el porqué completo en
   docs/analisis-ficha-cuadro-grafico-2026-08-21.md (Parte B): la tabla era
   una cadena de «No validado» para casi cualquier valor; vuelve cuando el
   detector valide estructura de verdad. */

export default function StockClient({ initialSymbol = "", initialData = null, initialError = "" }) {
  const symbol = String(initialSymbol || "").toUpperCase();
  const [data, setData] = useState(initialData || null);
  const [error, setError] = useState(initialError || "");
  const [loading, setLoading] = useState(false);
  const [logoIndex, setLogoIndex] = useState(0);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [similar, setSimilar] = useState([]);
  const [social, setSocial] = useState(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [chartSettings, setChartSettings] = useState(DEFAULT_CHART_SETTINGS);
  const [chartScope, setChartScope] = useState("global");
  const [benchmarkDraft, setBenchmarkDraft] = useState("");
  const [companyBriefExpanded, setCompanyBriefExpanded] = useState(false);
  const [reviewNavigation, setReviewNavigation] = useState(null);
  const [decisionResolution, setDecisionResolution] = useState(null);
  const [decisionResolutionHistoryItems, setDecisionResolutionHistoryItems] = useState([]);
  const [decisionValidationNote, setDecisionValidationNote] = useState("");
  const [showVcpDiagnostics, setShowVcpDiagnostics] = useState(false);
  // Pliegue del cuadro de identidad del lienzo. DELIBERADAMENTE efímero:
  // estado de React, sin localStorage ni preferencia global, y se reabre al
  // cambiar de símbolo (ver el useEffect [symbol]). El cuadro existe para que
  // una captura del gráfico lleve la identidad sin componer nada; un pliegue
  // recordado convertiría «lo oculté una vez en este valor» en «todas mis
  // capturas futuras salen sin identidad» (análisis 2026-08-21, A3). Además
  // la persistencia local ya opera al borde de la cuota (análisis del 15,
  // C9) y este estado ni siquiera queremos recordarlo.
  const [identityCardCollapsed, setIdentityCardCollapsed] = useState(false);

  function updateChartSettings(nextSettings) {
    setChartSettings(writeChartSettings(nextSettings, { scope: chartScope, symbol }));
  }

  function updateChartScope(nextScope) {
    setChartScope(nextScope);
    setChartSettings(readChartSettings({ scope: nextScope, symbol }));
  }

  function syncReviewNavigation(reviewState = safeRead(STORAGE_KEYS.review, {}), activeSymbol = symbol) {
    const navigation = buildReviewQueueNavigation(reviewState || {}, activeSymbol);
    setReviewNavigation(navigation);
    return navigation;
  }

  function loadSimilarFor(payload) {
    if (!symbol || !payload) return;
    const qs = new URLSearchParams({
      symbol,
      name: payload.name || symbol,
      sector: payload.sector || "",
      industry: payload.industry || "",
      theme: payload.theme || "",
      country: payload.country || "",
    });
    getJson(`/api/similar?${qs.toString()}`)
      .then((result) => setSimilar(result.results || []))
      .catch(() => setSimilar([]));
  }

  /* loadComparablesFor (fetch a /api/comparables) vivía aquí: alimentaba el
     «Contexto comparativo», retirado el 2026-08-21 (ver el comentario en el
     render). Se retira también la petición: sin bloque no hay motivo para
     el viaje al servidor. */

  function loadSocialFor(payload) {
    if (!symbol) return;
    setSocialLoading(true);
    const qs = new URLSearchParams({
      symbol,
      name: payload?.name || symbol,
    });
    getJson(`/api/social-sentiment?${qs.toString()}`)
      .then((result) => setSocial(result))
      .catch((error) => {
        console.error("[ficha] pulso social no disponible:", error);
        setSocial({ error: userFacingServiceError(error?.message, "El pulso social no está disponible ahora mismo."), rows: [] });
      })
      .finally(() => setSocialLoading(false));
  }

  async function load({ benchmarkSymbol = "" } = {}) {
    if (!symbol) return;
    setLoading(true); setError("");
    setSimilar([]);
    try {
      const qs = new URLSearchParams({ symbol });
      const benchmark = cleanBenchmarkSymbol(benchmarkSymbol);
      if (benchmark) qs.set("benchmark", benchmark);
      const d = await getJson(`/api/company-brief?${qs.toString()}`);
      setData(d);
      loadSimilarFor(d);
      loadSocialFor(d);
    } catch (e) {
      // El detalle técnico va a consola; la ficha enseña lenguaje de producto.
      console.error("[ficha] no se pudo cargar la ficha del valor:", e);
      setError(userFacingServiceError(e?.message, "No se ha podido cargar la ficha de este valor. Inténtalo de nuevo en unos minutos."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const nextSettings = readChartSettings({ scope: chartScope, symbol });
    const reviewState = safeRead(STORAGE_KEYS.review, {});
    setChartSettings(nextSettings);
    syncReviewNavigation(reviewState, symbol);
    setDecisionResolution(decisionResolutionForSymbol(reviewState, symbol));
    setDecisionResolutionHistoryItems(decisionResolutionHistory(reviewState, { symbol, limit: 4 }));
    setDecisionValidationNote("");
    setLogoIndex(0);
    setLogoLoaded(false);
    setCompanyBriefExpanded(false);
    setShowVcpDiagnostics(false);
    // Cada valor entra con el cuadro de identidad visible: el pliegue es una
    // corrección puntual para UN gráfico donde tapa precio, no una
    // preferencia (análisis 2026-08-21, A3).
    setIdentityCardCollapsed(false);
    const savedBenchmark = cleanBenchmarkSymbol(nextSettings.benchmarks?.[symbol]);
    if (initialData) {
      loadSimilarFor(initialData);
      loadSocialFor(initialData);
      if (savedBenchmark && savedBenchmark !== cleanBenchmarkSymbol(initialData.relativeStrength?.benchmarkSymbol)) {
        load({ benchmarkSymbol: savedBenchmark });
      }
      return;
    }
    if (!initialError) load({ benchmarkSymbol: savedBenchmark });
  }, [symbol]);
  const logoCandidates = [data?.visual?.logoUrl, data?.visual?.clearbitLogoUrl].filter(Boolean);
  const logo = logoCandidates[logoIndex] || "";
  const g = data?.growthMetrics || {};
  const v = data?.valuationMetrics || {};
  const q = data?.quoteSnapshot || {};
  const rs = data?.relativeStrength || {};
  const benchmarkOverride = cleanBenchmarkSymbol(chartSettings?.benchmarks?.[symbol]);
  const activeBenchmark = benchmarkOverride || cleanBenchmarkSymbol(rs.benchmarkSymbol);
  const weeklyGlobalRs = latestWeeklyRs(rs);
  // El RS de la ficha es el del ranking semanal del universo y nada más: el
  // mismo número que la tabla del screener, la vista rápida y salud de
  // mercado (lib/rsCanonical.js). Antes caía a rs.rsGlobalPct —el percentil
  // del último lote— y ahí nacía la contradicción entre pantallas. Sin
  // semanal se muestra ausente con motivo, no un número de otro ranking.
  const rsUniverse = finiteValue(weeklyGlobalRs?.rsRating, rs.rating);
  // rsBenchmark (benchmarkRating) alimentaba solo el panel Fuerza relativa,
  // retirado el 2026-08-21; la comparación vs. benchmark vive en el gráfico.
  // La tarjeta de identidad del lienzo (variante 2c encogida: raíl de etapa,
  // identidad, FR, estructura, crecimiento y pie de marcas) — modelo en
  // lib/chartIdentityCard.js, vista en ChartIdentityCard.jsx. Sustituye al
  // sello de tres líneas de la primera iteración de este mismo día.
  const identityCardModel = buildChartIdentityCard({ symbol, data, rsUniverse });
  const priceSnapshot = priceSnapshotFromBars(data?.chartBars || [], q);
  const technical = technicalSnapshotFromBars(data?.chartBars || [], q);
  const statementCurrency = data?.financialResults?.currency || g.financialCurrency || data?.currency || "";
  const stageTone = /etapa 2|stage 2/i.test(data?.stage?.label || "") ? "good" : /etapa 4|stage 4/i.test(data?.stage?.label || "") ? "bad" : "neutral";
  const dayTone = (priceSnapshot.dayChangePct || 0) >= 0 ? "up" : "down";
  const nextEarnings = data?.earningsCalendar?.earningsDate || data?.earningsCalendar?.earningsStart || "Sin dato";
  const listingDate = data?.ipoDate || data?.listingDate || "";
  const listingLabel = data?.ipoDate ? "IPO" : data?.listingDate ? "Cotiza desde" : "IPO";
  const freshness = data?.dataQuality?.freshness || {};
  const coverage = data?.dataQuality?.coverage || {};
  // ADR §3.2 — una sola clasificación local canónica. Encapsula los
  // predicados históricos (`freshness.priceEstimated`, `freshness.chartEstimated`,
  // `dataQuality.estimatedChart` y provider con patrón estimado) en
  // `chartQualityFromBrief`; esta pieza NO decide si el chart puede pintar
  // barras (eso vive en el data model). La usamos tanto para las
  // etiquetas de confianza en `N0VerdictBlock` como para el prop canónico
  // `localQuality` que hoy recibe `UniversalPriceChart` (ADR §9, cierre de
  // la migración).
  const localQuality = useMemo(
    () => chartQualityFromBrief({
      bars: data?.chartBars || [],
      dataQuality: data?.dataQuality || null,
      chartProvider: data?.chartProvider || "",
    }),
    [data?.chartBars, data?.dataQuality, data?.chartProvider],
  );
  // "missing" (ausencia declarada) y "estimated" (serie sintética) son estados
  // distintos: el primero se muestra como hueco explícito, el segundo ya no se
  // emite. chartEstimated conserva su significado histórico —serie no
  // decision-grade— para no cambiar el resto de la ficha.
  const chartUnavailable = localQuality.status === "missing";
  const chartEstimated = localQuality.status !== "real";
  const chartSourceDetail = chartUnavailable
    ? "sin serie de precios real"
    : chartEstimated ? "histórico estimado por fallback operativo" : "calculada desde barras";
  const compactProfile = data ? [data.sector, data.industry, data.country].filter(Boolean).join(" · ") : "";
  const setupPattern = useMemo(() => {
    const pattern = data?.setupPattern || (data?.chartBars?.length ? setupPatternForBars(data.chartBars) : null);
    return withPatternHistoryCoverage(pattern, data?.chartBars || []);
  }, [data?.setupPattern, data?.chartBars]);
  // Reparto up/down del valor a 50 sesiones. setupPattern ya trae el resto
  // de campos de volumen del briefing; este se calcula localmente sobre la
  // serie que llega en data.chartBars (mismo cómputo que lib/indicators.js:154).
  const upDown50 = useMemo(() => {
    const bars = Array.isArray(data?.chartBars) ? data.chartBars : [];
    return bars.length >= 50 ? udVol(bars, 50) : null;
  }, [data?.chartBars]);
  const stockVolume = useMemo(
    () => stockVolumeState({ setupPattern, bars: data?.chartBars || [], scanVolume: { upDownVolRatio: upDown50 } }),
    [setupPattern, data?.chartBars, upDown50],
  );
  const setupDisplay = useMemo(() => methodologyDisplayForRow(setupPattern || {}), [setupPattern]);
  const setupVerdict = setupDisplay.verdict;
  const setupTradePlanEligible = setupDisplay.actionable && setupDisplay.tradePlanEligible && !setupDisplay.blocksPatternClaim;
  const actionableSetupPattern = setupTradePlanEligible ? setupPattern : null;

  useEffect(() => {
    setBenchmarkDraft(activeBenchmark);
  }, [activeBenchmark]);

  function resolveStockDecision(actionKey) {
    if (!symbol) return;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    // La nota es SOLO lo que escribió el inversor: sin el prefijo
    // «Validado: <foco del motor>» que componía la mesa retirada.
    const nextReview = applyStockDecisionResolution(previousReview, {
      symbol,
      actionKey,
      source: "stock",
      note: decisionValidationNote.trim(),
    });
    persistReviewQueue(nextReview);
    syncReviewNavigation(nextReview, symbol);
    setDecisionResolution(decisionResolutionForSymbol(nextReview, symbol));
    setDecisionResolutionHistoryItems(decisionResolutionHistory(nextReview, { symbol, limit: 4 }));
  }

  function reopenStockDecision() {
    if (!symbol) return;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const nextReview = reopenStockDecisionResolution(previousReview, {
      symbol,
      source: "stock",
      note: decisionResolution?.label ? `Antes: ${decisionResolution.label}` : "",
    });
    persistReviewQueue(nextReview);
    syncReviewNavigation(nextReview, symbol);
    setDecisionResolution(decisionResolutionForSymbol(nextReview, symbol));
    setDecisionResolutionHistoryItems(decisionResolutionHistory(nextReview, { symbol, limit: 4 }));
  }

  function openReviewFlowSymbol(targetSymbol = "") {
    const cleanTarget = String(targetSymbol || "").trim().toUpperCase();
    if (!cleanTarget) return;
    const reviewState = safeRead(STORAGE_KEYS.review, {});
    const navigation = buildReviewQueueNavigation(reviewState, cleanTarget);
    const targetItem = navigation.items.find((item) => item.symbol === cleanTarget);
    if (!targetItem?.row) return;
    const openedAt = new Date().toISOString();
    const previousSession = safeRead(STORAGE_KEYS.screenerSession, {}) || {};
    const nextReview = {
      ...(reviewState || {}),
      selectedSymbol: cleanTarget,
      currentIndex: targetItem.index,
      updatedAt: openedAt,
    };
    const context = buildReviewStockOpenContext(targetItem.row, {
      settings: navigation.settings,
      source: navigation.source,
      sourceLabel: navigation.sourceLabel,
      sourceDetail: navigation.sourceDetail || "",
      queueMode: navigation.queueMode || "",
      digestFilter: navigation.digestFilter,
      resolutionFilter: navigation.resolutionFilter,
      rank: targetItem.index + 1,
      queueSize: navigation.visibleCount,
      rowsCount: navigation.totalRows,
      visibleCount: navigation.visibleCount,
      hiddenCount: Math.max(0, navigation.totalRows - navigation.visibleCount),
      openedAt,
    });
    persistReviewQueue(nextReview);
    safeWrite(STORAGE_KEYS.screenerSession, {
      ...previousSession,
      version: previousSession.version || SCREENER_SESSION_VERSION,
      lastOpenedStockSymbol: cleanTarget,
      lastOpenedStockAt: openedAt,
      lastOpenedStockContext: context,
    });
    syncReviewNavigation(nextReview, cleanTarget);
  }

  function updateBenchmark(value) {
    const nextBenchmark = cleanBenchmarkSymbol(value);
    const benchmarks = { ...(chartSettings.benchmarks || {}) };
    if (nextBenchmark) benchmarks[symbol] = nextBenchmark;
    else delete benchmarks[symbol];
    const nextSettings = writeChartSettings({ ...chartSettings, benchmarks }, { scope: chartScope, symbol });
    setChartSettings(nextSettings);
    load({ benchmarkSymbol: nextBenchmark });
  }

  /* El bloque hero-EPS (annualRowsForHero → heroEpsYoY → heroEpsSource) y los
     locals de etapa (stageState/stageDisplay/stageShortLabel) alimentaban las
     filas EPS YOY de N2 y ETAPA de N1, retiradas el 2026-08-21 (ver el
     comentario en el render). La palabra canónica de etapa sigue saliendo de
     lib/stageDisplay.js allí donde se pinta (N0, franja, cuadro, gate de N3);
     el EPS YoY por trimestre vive en la banda de crecimiento de la franja. */
  const businessTeaser = compactBusinessTeaser(data);
  const companySummary = data?.summary || "Sin descripción de negocio disponible.";
  const companySummaryId = `hero-company-summary-${symbol || "stock"}`;
  const canExpandCompanyBrief = companySummary.length > 80;
  const rsUniverseSource = Number.isFinite(rsUniverse)
    ? Number.isFinite(rs.rsGlobalSample) && rs.rsGlobalSample >= 20
      ? metricSourceState("measured", "RS", `n=${sharedNum(Math.round(rs.rsGlobalSample))}`)
      : metricSourceState("review", "RS", "muestra insuficiente o snapshot sin muestra")
    : metricSourceState("review", "RS", "sin ranking semanal para este símbolo");

  /* ── Cálculos para N0–N3 (jerarquía FICHA-TICKER-IA.md) ─────────── */

  // La "decisión" (vigilar/auditar/descartar) y el "freno" del sistema ya no
  // se calculan para la cabecera: el veredicto se retiró de N0 (principio 1).
  // La resolución del USUARIO (candidata/vigilar/descartar) sigue viva en la
  // mesa de decisión y en la cola de Review — esa sí es suya.

  /* El resumen de setup ("3/5 condiciones · falta: base, contracciones…")
     vivía aquí y se retiró de N0 el 2026-08-22: enumeraba condiciones que
     el detector no evalúa de forma fiable hoy — `base` es la ventana fija
     del detector (13.0 semanas en el 100% de las filas, no una base
     medida; ver docs/analisis-ficha-2026-08-15.md, A3) y `contracciones`
     está en calibración sin integrar en producción (ver
     research/contracciones/). Una checklist con apariencia de precisión
     sobre datos que no la tienen es justo lo que el principio 7 advierte.
     El cálculo del patrón (setupPattern) sigue existiendo y alimenta el
     desglose auditable de N3 (n3ScoreBreakdown); vuelve a N0 cuando el
     detector esté validado. */

  /* Aquí vivían `narrative`/`narrativeString` (la narrativa de N2), `n1Rows`
     (las 6 filas de la Lectura técnica: RS, RS QUALITY, ETAPA, MA50, MA200,
     MÁX 52S — con las notas sobre BASE/PIVOT y el renombrado de «ATH» del
     2026-08-15) y `n2Fundamentals` (VENTAS YOY, EPS YOY, CAP.). Retirados el
     2026-08-21 con sus bloques: ver el comentario en el render y
     docs/analisis-ficha-cuadro-grafico-2026-08-21.md (Parte B). MA50/MA200
     bajan a la franja vía `technical`; CAP. vive en el cuadro de identidad;
     la regla BASE/PIVOT («un número falso con aspecto de preciso es peor que
     no tenerlo») sigue documentada en lib/setupPatterns.js y en el propio
     doc. */

  // N3 desglose del score (barras de razón estilo Decisiones)
  const n3ScoreBreakdown = setupPattern
    ? [
        /* Etiquetas con la ventana del detector explícita: ambos números se
           miden sobre las últimas ~65 sesiones (lib/setupPatterns.js), no
           sobre una base ni un pivote detectados. Aquí, dentro de la
           auditoría del patrón, el dato tiene sentido con su nombre real; en
           la lectura técnica (N1) no lo tenía y salió. */
        { label: "Rango 65 sesiones", value: Number.isFinite(setupPattern.baseDepthPct) ? pct(setupPattern.baseDepthPct) : "—", pct: Number.isFinite(setupPattern.baseDepthPct) ? Math.min(100, setupPattern.baseDepthPct) : 0, dominant: setupPattern.consolidationCandidate === true, tone: setupPattern.consolidationCandidate === true ? "ok" : "risk" },
        { label: "Compresiones", value: Number.isFinite(setupPattern.contractionCount) ? `${setupPattern.contractionCount} · ${setupPattern.contractionsDecreasing ? "decrecientes" : "no decrecientes"}` : "—", pct: Number.isFinite(setupPattern.contractionCount) ? Math.min(100, setupPattern.contractionCount * 25) : 0, dominant: setupPattern.contractionsDecreasing === true, tone: setupPattern.contractionsDecreasing === true ? "ok" : "risk" },
        { label: "Última comp.", value: Number.isFinite(setupPattern.lastContractionDepthPct) ? pct(setupPattern.lastContractionDepthPct) : "—", pct: Number.isFinite(setupPattern.lastContractionDepthPct) ? Math.max(0, 100 - setupPattern.lastContractionDepthPct * 4) : 0, dominant: Number.isFinite(setupPattern.lastContractionDepthPct) && setupPattern.lastContractionDepthPct <= 8, tone: "neutral" },
        { label: "Rango 10d", value: Number.isFinite(setupPattern.tightness10dPct) ? pct(setupPattern.tightness10dPct) : "—", pct: Number.isFinite(setupPattern.tightness10dPct) ? Math.max(0, 100 - setupPattern.tightness10dPct * 4) : 0, dominant: Number.isFinite(setupPattern.tightness10dPct) && setupPattern.tightness10dPct <= 12, tone: "neutral" },
        { label: "Dist. techo 65 sesiones", value: Number.isFinite(setupPattern.distanceToPivotPct) ? pct(setupPattern.distanceToPivotPct) : "—", pct: Number.isFinite(setupPattern.distanceToPivotPct) ? Math.max(0, 100 - Math.abs(setupPattern.distanceToPivotPct) * 8) : 0, dominant: Number.isFinite(setupPattern.distanceToPivotPct) && Math.abs(setupPattern.distanceToPivotPct) <= 6, tone: "neutral" },
        { label: "Volumen seco", value: Number.isFinite(setupPattern.volumeDryUpRatio) ? `${setupPattern.volumeDryUpRatio.toFixed(2)}x` : "—", pct: Number.isFinite(setupPattern.volumeDryUpRatio) ? Math.max(0, 100 - setupPattern.volumeDryUpRatio * 60) : 0, dominant: Number.isFinite(setupPattern.volumeDryUpRatio) && setupPattern.volumeDryUpRatio <= 0.9, tone: "neutral" },
        { label: "Score patrón", value: Number.isFinite(setupPattern.patternQualityScore) ? Math.round(setupPattern.patternQualityScore) : "—", pct: Number.isFinite(setupPattern.patternQualityScore) ? setupPattern.patternQualityScore : 0, dominant: Number.isFinite(setupPattern.patternQualityScore) && setupPattern.patternQualityScore >= 65, tone: Number.isFinite(setupPattern.patternQualityScore) && setupPattern.patternQualityScore >= 65 ? "ok" : "risk" },
      ]
    : [];

  // N3 bloque empresa
  const n3Company = data ? {
    sector: data.sector,
    industry: data.industry,
    subsector: data.subsector || data.theme || "",
    employees: data.employees,
    ipoDate: data.ipoDate || data.listingDate || "",
    listingDateSource: data.listingDateSource || "",
    description: data.summary || data.description || "Sin descripción de negocio.",
  } : null;

  // N3 detalle de calidad de datos por fuente. Único sitio de la ficha para
  // cobertura, tamaño de muestra del RS y estado del histórico desde el
  // 2026-08-22 (franja "Calidad de dato" de N0 retirada — diagnóstico
  // interno, no información del valor; ver el comentario junto a
  // N0VerdictBlock). La fecha de cierre se queda también en N0 (junto al
  // precio) porque esa sí la necesita el usuario sin abrir este desglose.
  const n3DataQualityDetail = data ? [
    { label: "Cierre", value: freshness.priceDate ? compactDate(freshness.priceDate) : "—", state: freshness.priceDate ? (chartEstimated ? "stale" : "value") : "ghost", suffix: chartEstimated && freshness.priceDate ? "est" : "", source: metricSourceState(chartEstimated ? "proxy" : "measured", "Cierre", "cierre del proveedor") },
    { label: "RS global", value: rsRankingStripValue(rsUniverse, freshness), state: Number.isFinite(rsUniverse) && freshness.rsGlobalAsOf ? "value" : "ghost", source: rsUniverseSource },
    { label: "Cobertura", value: coverage.label || "Completa", state: coverage.label ? "value" : "ghost", source: coverage.label ? metricSourceState("measured", "Cobertura", "auditoría interna") : metricSourceState("review", "Cobertura", "sin dato") },
    { label: "Histórico", value: chartUnavailable ? "Sin serie de precios" : chartEstimated ? "Histórico estimado" : "Histórico en vivo", state: chartUnavailable ? "ghost" : "value", source: chartEstimated ? metricSourceState("review", "Histórico", chartSourceDetail) : metricSourceState("measured", "Histórico", "live") },
    // Antes solo aparecía en la franja de N0, y solo cuando había desvío
    // (principio 3 lo prohíbe: mostrar un dato solo cuando es "malo" oculta
    // el caso bueno). Aquí, como el resto del desglose, se muestra siempre.
    { label: "Cotización", value: priceSnapshot?.coherent === false ? "Distinta del cierre" : "Coincide con el cierre", state: priceSnapshot?.coherent === false ? "stale" : "value", detail: "cotización intradía frente al cierre dibujado en el gráfico", source: priceSnapshot?.coherent === false ? metricSourceState("review", "Cotización", "cotización intradía distinta del cierre dibujado") : metricSourceState("measured", "Cotización", "cotización intradía coincide con el cierre dibujado") },
    { label: "Fundamentales", value: freshness.fundamentalsAgeDays != null ? `${freshness.fundamentalsAgeDays} días` : "Sin fecha", state: freshness.fundamentalsAgeDays != null ? "value" : "ghost", source: freshness.fundamentalsAgeDays != null ? metricSourceState("measured", "Fundamentales", "estado financiero del proveedor") : metricSourceState("review", "Fundamentales", "sin fecha") },
  ] : [];

  // Acciones rápidas de la cabecera (links) — se renderizan dentro de N0.
  // Van como ARRAY, no como fragmento: el guard de N0 cuenta elementos y un
  // fragmento no tiene longitud (era el bug que los borraba de la ficha).
  const n0Actions = [
    <a key="screener" className="stockHeroLink stockBackLink" href="/">Screener</a>,
    data?.links?.official
      ? <a key="official" className="stockHeroLink" href={data.links.official} target="_blank" rel="noreferrer">Web oficial</a>
      : null,
  ].filter(Boolean);

  // Símbolo sin datos: la ficha entera se sustituye por el estado vacío. No se
  // renderiza N0 (precio + decisión) ni ningún bloque derivado de barras.
  if (data?.notFound) {
    return <main className="page stockPage">
      <StockUnavailableBlock symbol={symbol} />
    </main>;
  }

  return <main className="page stockPage">
    <StorageAlert />
    {/* N0 — Cabecera: identidad + precio + etapa (siempre visible, sin scroll) */}
    <N0VerdictBlock
      symbol={symbol}
      data={data}
      priceSnapshot={priceSnapshot}
      freshness={freshness}
      actions={n0Actions}
    />

    {/* Aquí vivía la mesa de observación (StockDecisionDesk), que solo
        aparecía al entrar desde el screener y reimprimía el veredicto del
        motor — retirada el 2026-08-22; el porqué completo está en el
        comentario largo junto a StockUserClassification. Queda lo que era
        del usuario, ahora por CUALQUIER ruta de entrada: su clasificación
        manual y la navegación de la cola de Review. */}
    <StockUserClassification
      resolution={decisionResolution}
      resolutionHistory={decisionResolutionHistoryItems}
      reviewNavigation={reviewNavigation}
      note={decisionValidationNote}
      onNoteChange={setDecisionValidationNote}
      onOpenReviewSymbol={openReviewFlowSymbol}
      onResolveDecision={resolveStockDecision}
      onReopenDecision={reopenStockDecision}
    />


    {error && <p className="stockPageError" role="alert">{error}</p>}

    {data && <>
      {/* Gráfico: zona de visualización entre N0 (veredicto) y N1 (lectura
          técnica). El usuario pidió que el gráfico sea lo segundo que aparece
          tras el precio/decisión, antes de la tabla técnica. */}
      <section className="stockChartPanel" aria-label="Gráfico de la ficha">
        <h2 className="stockChartTitle">Gráfico</h2>
        <div className="stockChartBenchmarkControl">
          <label htmlFor={`benchmark-${symbol}`}>Comparar vs</label>
          <input id={`benchmark-${symbol}`} list={`benchmark-options-${symbol}`} value={benchmarkDraft} onChange={(event) => setBenchmarkDraft(cleanBenchmarkSymbol(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") updateBenchmark(benchmarkDraft); }} placeholder={rs.benchmarkSymbol || "SPY"} disabled={loading} />
          <datalist id={`benchmark-options-${symbol}`}>
            {BENCHMARK_OPTIONS.map((item) => <option key={item} value={item} />)}
          </datalist>
          <button type="button" onClick={() => updateBenchmark(benchmarkDraft)} disabled={loading || !benchmarkDraft}>Aplicar</button>
          <button type="button" onClick={() => updateBenchmark("")} disabled={loading || !benchmarkOverride}>Auto</button>
          <button
            type="button"
            className={`chartToolButton ${showVcpDiagnostics ? "active" : ""}`.trim()}
            onClick={() => setShowVcpDiagnostics((value) => !value)}
            disabled={!setupPattern}
            aria-pressed={showVcpDiagnostics}
            title="Mostrar contracciones VCP, pivot y motivo de bloqueo en el gráfico."
          >
            <ScanSearch aria-hidden="true" size={14} />
            VCP
          </button>
          <InfoHint text="Activa C1/C2/C3, pivot y gates mínimos de diagnóstico. No cambia filtros ni verdictos." />
        </div>
        <ChartPreferences settings={chartSettings} onChange={updateChartSettings} symbol={symbol} scope={chartScope} onScopeChange={updateChartScope} compact />
        <UniversalPriceChart
          bars={data.chartBars}
          symbol={symbol}
          currency={data.currency}
          tradingViewUrl={data.links?.tradingView}
          settings={chartSettings}
          relativeStrength={rs.series}
          rsMainScore={rsUniverse}
          rsRatingSeries={rs.globalRsSeries}
          rsCountrySeries={rs.countryRsSeries}
          rsCountryMainScore={rs.countryRsRating}
          benchmarkSymbol={rs.benchmarkSymbol}
          patternOverlay={showVcpDiagnostics ? setupPattern : actionableSetupPattern}
          showPatternDiagnostics={showVcpDiagnostics}
          localQuality={localQuality}
          height={600}
          identityCard={identityCardModel ? <ChartIdentityCard card={identityCardModel} /> : null}
          identityCollapsed={identityCardCollapsed}
          onToggleIdentity={() => setIdentityCardCollapsed((value) => !value)}
        />
        {/* Franja descriptiva (diseño "Ficha StatsEdge", variante 2a):
            identidad, etapa, fuerza relativa, estructura y crecimiento,
            pegada al gráfico. Los campos sin dato demostrable se muestran
            ausentes con su motivo (ver lib/descriptiveStrip.js). */}
        <DescriptiveStrip
          data={data}
          setupPattern={setupPattern}
          technical={technical}
          stockVolume={stockVolume}
        />
        {/* Convención para añadir un bloque nuevo bajo el gráfico (p. ej.
            detector de contracciones, salud de corto plazo): renderízalo
            aquí como un <section>/<div> hermano más, DESPUÉS de
            DescriptiveStrip. `.stockChartPanel` no es grid ni flex —es
            flujo normal—, así que cada hermano se apila con su alto real
            (auto) sin que nadie tenga que recalcular nada. El único deber
            del bloque nuevo es declarar su propia separación con
            `margin-top` (ver `.stockDescStrip` en styles/stock.css), igual
            que hace la franja. NUNCA reservar alto fijo por adelantado
            (min-height ni grid-template-rows con un track fijo para un
            hijo condicional): esa fue la causa del hueco vacío bajo el
            gráfico que se corrigió en `.universalChart`
            (styles/components.css) el 2026-08-21 —una tercera fila de
            grid de 300px reservada para un panel que no siempre existe. */}
      </section>

      {/* ── Bloques retirados el 2026-08-21 (docs/analisis-ficha-cuadro-
          grafico-2026-08-21.md, Parte B) — NO reponer sin releer ese doc ──

          N1 «Lectura técnica» (N1TechTable): 6 filas — RS, RS QUALITY,
          ETAPA, MA50, MA200, MÁX 52S. Se retiró por repetición: RS, ETAPA y
          MÁX 52S ya estaban en la franja descriptiva a 300 px; MA50 y MA200
          eran los únicos datos propios y viven ahora como celdas «Media 50d»
          y «Media 200d» de la banda de estructura de la franja. RS QUALITY
          (score compuesto) queda sin superficie hasta decidir su cajón en
          N3 — está en el brief (relativeStrength.rsQualityScore).

          N2 «Contexto» (N2ContextBlock): narrativa tesis/riesgo/siguiente
          paso + fundamentales operativos (VENTAS YOY, EPS YOY, CAP.). Se
          retiró porque la narrativa por URL directa era la razón interna del
          detector disfrazada de riesgo (análisis del 15) y los operativos
          eran el último punto de la serie que la franja ya muestra con seis
          trimestres. CAP., el único dato único, vive ahora en el cuadro de
          identidad del lienzo (lib/chartIdentityCard.js).

          tests/fichaRetiradas.test.js vigila que ninguno vuelva por
          accidente. */}

      {/* N3 — Auditoría (colapsado por defecto). Incluye ahora dentro de un
          cuarto <details> ("Metodología y gates") el antiguo
          MethodologyAuditPanel: verdict/confianza + 4 gates no-score (Datos
          técnicos, Histórico, Etapa, Plan). El desglose del score vive
          únicamente en stockScoreBreakdown (primer <details>). */}
      <N3AuditBlock
        scoreBreakdown={n3ScoreBreakdown}
        company={n3Company}
        dataQualityDetail={n3DataQualityDetail}
        methodology={
          setupPattern ? (
            <MethodologyAuditPanel
              pattern={setupPattern}
              verdict={setupVerdict}
              stage={data.stage}
            />
          ) : null
        }
      />

      {/* Comparativos y contexto: viven al final, fuera de la jerarquía
          N0–N3, como soporte secundario. */}
      <SimilarStocks rows={similar} />
      {/* ── Bloques retirados el 2026-08-21 (docs/analisis-ficha-cuadro-
          grafico-2026-08-21.md, Parte B) — NO reponer sin releer ese doc ──

          «Contexto comparativo» (ComparativeContext + /api/comparables):
          tabla de referencias del mismo grupo con Estructura/Contracciones/
          Rango 65s/Vol. seco/RS grupo. Se retiró porque para casi cualquier
          valor era una cadena de «No validado» (la tabla de negaciones de
          los análisis del 14 y el 15): vuelve cuando el detector valide
          estructura de verdad. Con el bloque se retiró también su fetch.

          «Estado del volumen» (StockVolumePanel): reparto up/down 50d,
          volumen seco 10d/50d, impulso 5d/20d. El volumen seco era el mismo
          cociente que la celda «Volumen 10d/50d» de la franja en otro
          formato (0,88× ≡ −12%); reparto e impulso, los dos datos propios,
          viven ahora como celdas de la banda de estructura de la franja
          (stockVolume sigue calculándose aquí y baja como prop).

          «Fuerza relativa» (RelativeStrengthPanel): RS global (su quinta
          aparición en la ficha), RS país y grupo (percentiles del LOTE del
          escaneo que contradecían la ausencia declarada con motivo por la
          franja — principio 3), benchmark 3M/6M/12M (la comparación vive en
          el propio gráfico: línea RS + «Comparar vs»), y los scores
          compuestos RS quality / riesgo técnico / volatilidad / drawdown,
          que quedan sin superficie hasta decidir su cajón en N3 (siguen en
          el brief: relativeStrength.*).

          tests/fichaRetiradas.test.js vigila que ninguno vuelva por
          accidente. */}
      <FundamentalsPanel data={data} growth={g} valuation={v} quote={q} calendar={data.earningsCalendar} currency={statementCurrency} />
      <NewsSection rows={data.news} />
      <SocialPulseSection social={social} loading={socialLoading} symbol={symbol} />
    </>}

    {!data && !error && <p className="stockPageLoading">Cargando ficha de {symbol}…</p>}
  </main>;
}
