"use client";
import "../../styles/market-health.css";
import { useEffect, useState } from "react";
import RowTrustSignature from "@/app/RowTrustSignature";
import StageStrip, { regimeTone } from "./StageStrip";
import UniverseBreadthCard from "./UniverseBreadth";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { TrustMetric } from "@/app/components/ui/MetricSource";
import { rowTrustSignatureForRow } from "@/app/components/ui/TrustSignals";
import { fetchJsonWithTimeout, logMarketHealthFetchFailure, marketHealthApiPath } from "@/lib/marketHealthFetch";
import { dateShort, dateTime, num, pct, pctShare } from "@/lib/formatters";
import { metricShortLabel } from "@/lib/metricCatalog";
import { canonicalRsValue } from "@/lib/rsCanonical";
// Mismo componente de ausencia que la tabla de resultados: guion + icono con el
// motivo (docs/principios-producto.md, principios 3 y 7).
import { MissingValue } from "@/lib/screenerColumns";
import { userFacingServiceError } from "@/lib/serviceErrors";
import { stageDisplayForRow } from "@/lib/stageDisplay";
import { metricValue, rowTheme } from "@/lib/stockRows";
import { stockUrl } from "@/lib/symbols";

const dateFmt = (value) => value ? dateTime(value) : "-";

const sentimentClass = (label = "") => label === "alcista" ? "bullish" : label === "bajista" ? "bearish" : "neutral";
const sentimentDirection = (label = "") => label === "alcista" ? "up" : label === "bajista" ? "down" : "flat";
const sentimentGlyph = (label = "") => label === "alcista" ? "▴" : label === "bajista" ? "▾" : "·";
const listText = (items = []) => items.length ? items.join(", ") : "-";

function marketStageCell(index = {}) {
  const display = stageDisplayForRow(index);
  if (!display) return index.stage30w || "—";
  const confirmation = display.confirmation;
  const text = display.qualifier ? `${display.word} · ${display.qualifier}` : display.word;
  const title = display.title || confirmation?.title || undefined;
  if (confirmation?.suffix) {
    return <span title={title}>{text} <small>{confirmation.suffix}</small></span>;
  }
  return <span title={title}>{text}</span>;
}


function MarketTrustMetric({ row, metricKey, label, value }) {
  return <TrustMetric row={row} metricKey={metricKey} label={label} value={value} baseClass="marketTrustMetric" valueTag="b" />;
}

function safePct(value, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

// El RS es SIEMPRE el del ranking semanal del universo (lib/rsCanonical.js),
// el mismo que la tabla del screener, la vista rápida y la ficha del valor.
// Antes esta pantalla caía al percentil del lote y luego al rating vs.
// benchmark, y los enseñaba a los tres bajo la etiqueta "RS": por eso salud de
// mercado decía 88 para un símbolo cuya ficha decía 66. Un dato ausente es
// preferible a un dato que contradice otra pantalla.
function rowRsDisplay(row = {}) {
  return canonicalRsValue(row);
}
function rowRsDisplayLabel() {
  return metricShortLabel("rsGlobalPct");
}
function rowObjectiveScore(row = {}) { return metricValue(row, "objectiveScore"); }

const COVERAGE_UNAVAILABLE = "El estado de cobertura por mercado no está disponible ahora mismo.";
// Faltaba: la constante se usaba en loadMethodologyHealth pero no existía, así
// que la llamada reventaba con un ReferenceError y el panel "Fiabilidad
// metodológica" enseñaba en pantalla el nombre de la variable de JavaScript.
const METHODOLOGY_HEALTH_PATH = "/api/methodology-health";
const CORE_COVERAGE_PATH = "/api/coverage?markets=US,JP,HK,AU,TW";
const FULL_COVERAGE_PATH = "/api/coverage?markets=US,EU1,JP,HK,AU,TW";

/* ─── Sentimiento fusionado (N2): un componente, dos filas ──────────
   Sin rojo/verde: la dirección la dan los extremos etiquetados + el glifo
   en el sentimentPill del item. La barra usa tonos de humo + un dot tiza
   como marcador de posición (no como semáforo). */
function SentimentRow({ data, title = "Lectura contraria", sampleLabel = "titulares" }) {
  // Sin muestra no hay distribución ni índice: las barras a 0% y el índice a 50
  // eran valores por defecto con aspecto de lectura real. Se pinta el estado
  // vacío, que dice justamente eso.
  const sampleSize = Number(data?.total);
  if (!data || data.error || !Number.isFinite(sampleSize) || sampleSize <= 0) {
    return (
      <div className="marketSentimentRow" data-empty="true">
        <div className="marketSentimentRowHead">
          <small>{title}</small>
          <span className="marketSentimentIndex">—</span>
        </div>
        <p className="marketSentimentRead">{`Sin muestra de ${sampleLabel} en esta pasada.`}</p>
      </div>
    );
  }
  const bearishPct = safePct(data?.bearishPct);
  const neutralPct = safePct(data?.neutralPct);
  const bullishPct = safePct(data?.bullishPct);
  // El índice se pinta solo si viene: el 50 de reserva es la posición del
  // marcador en la barra, no una lectura de pesimismo.
  const pessimismValue = Number.isFinite(Number(data?.pessimismIndex)) ? safePct(data.pessimismIndex) : null;
  const pessimism = pessimismValue ?? 50;
  // "neutral" es una lectura, no un valor por defecto: si el servidor no lo
  // trae, aquí no se inventa.
  const dominant = data?.dominantSentiment || "";
  return (
    <div className="marketSentimentRow">
      <div className="marketSentimentRowHead">
        <small>{title} · {data?.regime || "sin régimen"}</small>
        <span className="marketSentimentIndex">{pessimismValue === null
          ? <MissingValue reason="El servidor no ha devuelto índice de pesimismo para esta muestra." />
          : num(pessimismValue)}</span>
      </div>
      <div>
        <div className="marketSentimentBar" role="img" aria-label={`Distribución de ${sampleLabel}`}>
          <i data-segment="bearish" style={{ width: `${bearishPct}%` }} />
          <i data-segment="neutral" style={{ width: `${neutralPct}%` }} />
          <i data-segment="bullish" style={{ width: `${bullishPct}%` }} />
        </div>
        <div className="marketSentimentMarker" aria-hidden="true">
          <i style={{ left: `${pessimism}%` }} />
        </div>
      </div>
      <div className="marketSentimentLegend">
        <span>bajistas <b>{pctShare(bearishPct)}</b></span>
        <span>neutrales <b>{pctShare(neutralPct)}</b></span>
        <span>alcistas <b>{pctShare(bullishPct)}</b></span>
        <span>dominante <b>{dominant || <MissingValue reason="El servidor no ha devuelto sentimiento dominante para esta muestra." />}</b></span>
      </div>
      {data?.contrarianRead && <p className="marketSentimentRead">«{data.contrarianRead}»</p>}
    </div>
  );
}

function SentimentFeeds({ news, social }) {
  return (
    <div className="marketSentimentFeeds">
      {!!social?.rows?.length && (
        <details>
          <summary>Posts sociales recientes <b>{social.total || social.rows.length}</b></summary>
          <div className="newsGrid">
            {social.rows.slice(0, 12).map((item) => (
              <a className="newsItem newsTextOnly" key={item.id || `${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer">
                <span>
                  <i className={`sentimentPill ${sentimentClass(item.sentimentLabel)}`} data-direction={sentimentDirection(item.sentimentLabel)}>
                    <i aria-hidden="true">{sentimentGlyph(item.sentimentLabel)}</i>
                    {item.sentimentLabel}
                  </i>
                  <b>{item.title}</b>
                  <em>{item.publisher || "X"} · {dateFmt(item.publishedAt)}</em>
                  <small>{item.sentimentReasons?.length ? `${item.sentimentReasons.join(", ")} · engagement ${item.engagement || 0}` : `sin sesgo fuerte detectado · engagement ${item.engagement || 0}`}</small>
                </span>
              </a>
            ))}
          </div>
        </details>
      )}
      {!!news?.rows?.length && (
        <details>
          <summary>Titulares de mercado <b>{news.total || news.rows.length}</b></summary>
          <div className="newsGrid">
            {news.rows.slice(0, 12).map((item) => (
              <a className="newsItem" key={`${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer">
                {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
                <span>
                  <i className={`sentimentPill ${sentimentClass(item.sentimentLabel)}`} data-direction={sentimentDirection(item.sentimentLabel)}>
                    <i aria-hidden="true">{sentimentGlyph(item.sentimentLabel)}</i>
                    {item.sentimentLabel}
                  </i>
                  <b>{item.title}</b>
                  <em>{item.publisher || "Fuente"} · {dateFmt(item.publishedAt)}</em>
                  <small>{item.sentimentReasons?.length ? item.sentimentReasons.join(", ") : "sin sesgo fuerte detectado"}</small>
                </span>
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/* ─── Franja de infraestructura (debajo de la cabecera, sobre N0) ────
   Cobertura 5/6 mercados · metodología OK · 2 fallos [+] — todo en una
   línea, expandible al detalle. Receta de la ficha de ticker. */
function ReliabilityStrip({ coverage, methodologyHealth, coverageLoading, methodologyLoading }) {
  const summary = coverage?.summary || {};
  const markets = Array.isArray(coverage?.markets) ? coverage.markets : [];
  const rankingCoveragePct = summary.rankingEligibleCoveragePct ?? summary.actionableCoveragePct;
  const operational = markets.filter((row) => row.readiness?.operational).length;
  const issues = markets.filter((row) => row.readiness?.blocksCoverageClaim).length;
  const failures = (coverage?.failures?.length ?? 0) + (coverage?.sectorFailures?.length ?? 0);
  const coverageKnown = Boolean(coverage) && !coverage.error;
  const methodologyLabel = methodologyHealth?.label || "—";
  const methodologyOk = methodologyHealth?.status === "pass";

  return (
    <details className="marketReliabilityStrip" data-testid="market-reliability-strip">
      <summary className="marketReliabilityStripLabel">Datos · cobertura</summary>
      <div className="marketReliabilityStripItem">
        <span>cobertura</span>
        <b>{Number.isFinite(rankingCoveragePct) ? pctShare(rankingCoveragePct) : "—"}</b>
        <span>·</span>
        <span>{operational}/{markets.length || "—"} mercados operativos</span>
      </div>
      <div className="marketReliabilityStripItem">
        <span>metodología</span>
        <b>{methodologyOk ? "OK" : methodologyLabel}</b>
      </div>
      <div className="marketReliabilityStripItem">
        <span>fallos</span>
        {/* "0 fallos" solo se puede afirmar si la cobertura llegó a leerse. Sin
            respuesta, el recuento es desconocido, no cero. */}
        {coverageKnown
          ? <b>{issues || failures || 0}</b>
          : <b><MissingValue reason="Todavía no se ha podido leer el estado de cobertura, así que no se sabe cuántos fallos hay." /></b>}
      </div>
      <summary className="marketReliabilityStripToggle" data-action="toggle">[+]</summary>
      <div className="marketReliabilityStripDetail">
        <CoverageDetail coverage={coverage} loading={coverageLoading} />
        <MethodologyDetail health={methodologyHealth} loading={methodologyLoading} />
        {!!coverage?.failures?.length && (
          <div className="marketReliabilityBlock">
            <div className="marketReliabilityBlockHead">
              <h3>Fallos de datos</h3>
              <span>{coverage.failures.length} entradas</span>
            </div>
            <div className="marketReliabilityRows">
              {coverage.failures.slice(0, 6).map((f) => (
                <div className="marketReliabilityRow" key={f.symbol || f.name}>
                  <b>{f.symbol || "—"}</b>
                  <span>{f.name || "—"}</span>
                  <em>{f.reason || "—"}</em>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function CoverageDetail({ coverage, loading }) {
  const markets = Array.isArray(coverage?.markets) ? coverage.markets : [];
  if (coverage?.error) return <div className="dataNote">{coverage.error}</div>;
  return (
    <div className="marketReliabilityBlock">
      <div className="marketReliabilityBlockHead">
        <h3>Cobertura por mercado</h3>
        <span>{loading ? "actualizando" : markets.length ? `${markets.length} mercados` : "—"}</span>
      </div>
      {markets.length ? (
        <div className="marketReliabilityRows">
          {markets.slice(0, 6).map((row) => {
            const readiness = row.readiness || {};
            return (
              <div className="marketReliabilityRow" key={row.market}>
                <b>{row.market}</b>
                <span>{readiness.label || row.grade || "—"}</span>
                <em>{pctShare(readiness.activationPct) || "—"}</em>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="marketSentimentRead">Sin datos de cobertura disponibles.</p>
      )}
    </div>
  );
}

const METHODOLOGY_BUCKETS = [
  { key: "plan", label: "planes automáticos", detail: "debe permanecer en 0" },
  { key: "watch", label: "vigilancia", detail: "candidatas para mirar" },
  { key: "observe", label: "observables", detail: "fuera de zona" },
  { key: "block", label: "bloqueadas", detail: "estructura no pasa" },
];

function MethodologyDetail({ health, loading }) {
  const totals = health?.totals || {};
  const buckets = health?.calibration?.buckets || {};
  return (
    <div className="marketReliabilityBlock">
      <div className="marketReliabilityBlockHead">
        <h3>Fiabilidad metodológica</h3>
        <span>{loading ? "actualizando" : health?.label || "—"}</span>
      </div>
      {health?.error ? (
        <div className="dataNote">{health.error}</div>
      ) : (
        /* Un recuento ausente se muestra ausente: un 0 aquí se lee como
           "ninguna bloqueada", que es una afirmación sobre la metodología. */
        <div className="marketReliabilityRows">
          <div className="marketReliabilityRow"><b>{totals.passed ?? "—"}/{totals.cases ?? "—"}</b><span>casos validados</span><em>{Number.isFinite(totals.failed) ? `${totals.failed} fallos` : "sin recuento de fallos"}</em></div>
          {METHODOLOGY_BUCKETS.map((bucket) => (
            <div className="marketReliabilityRow" key={bucket.key}>
              {Number.isFinite(buckets[bucket.key])
                ? <b>{buckets[bucket.key]}</b>
                : <b><MissingValue reason={`Todavía no se ha podido leer la validación metodológica, así que no se sabe cuántas ${bucket.label} hay.`} /></b>}
              <span>{bucket.label}</span>
              <em>{bucket.detail}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Regiones (cards compactas; N1) ───────────────────────────────── */
// Amplitud y filas regionales salen del escaneo nocturno en el servidor
// (/api/market-breadth y /api/market-leadership): misma población para todos.
function regionBreadth(breadth, regionCountries, otherCountries, isGlobal) {
  if (!breadth || breadth.error) return null;
  let total = 0;
  let measured = 0;
  let above = 0;
  for (const [country, bucket] of Object.entries(breadth.countries || {})) {
    const inRegion = isGlobal ? !otherCountries.has(country) : regionCountries.includes(country);
    if (!inRegion) continue;
    total += bucket.total || 0;
    measured += bucket.sma50Measured || 0;
    above += bucket.sma50Above || 0;
  }
  return { total, measured, above, pct: measured ? (above / measured) * 100 : null };
}

function GlobalRegionsPanel({ rows = [], breadth = null }) {
  const REGIONS = [
    { key: "US", name: "Estados Unidos", flag: "🇺🇸", benchmark: "S&P 500 (SPY)", countries: ["US"] },
    { key: "EU", name: "Europa", flag: "🇪🇺", benchmark: "Euro Stoxx 50 (FEZ)", countries: ["ES", "DE", "FR", "NL", "CH", "SE", "IT", "BE", "PT", "AT", "IE", "GB"] },
    { key: "AS", name: "Asia / Pacífico", flag: "🇯🇵", benchmark: "Nikkei 225 (TSE)", countries: ["JP", "HK", "SG", "TW", "KR", "CN", "AU"] },
    { key: "Global", name: "Global / Emergentes", flag: "🌐", benchmark: "MSCI ACWI (ACWI)", countries: [] },
  ];

  const otherCountries = new Set([
    ...REGIONS[0].countries, ...REGIONS[1].countries, ...REGIONS[2].countries,
  ]);
  const regionCards = REGIONS.map((region) => {
    let filtered = [];
    if (region.key === "Global") {
      filtered = rows.filter((r) => !otherCountries.has(r.country || "US"));
    } else {
      filtered = rows.filter((r) => region.countries.includes(r.country || "US"));
    }

    const total = filtered.length;
    const amplitude = regionBreadth(breadth, region.countries, otherCountries, region.key === "Global");
    // Promedio del MISMO RS que el resto del producto. Los símbolos sin
    // ranking semanal quedan fuera del promedio en vez de entrar con el
    // percentil de su lote, que no es comparable entre valores.
    const validRs = total ? filtered.map((r) => canonicalRsValue(r)).filter(Number.isFinite) : [];
    const avgRs = validRs.length ? validRs.reduce((s, v) => s + v, 0) / validRs.length : null;

    const leaders = [...filtered]
      .sort((a, b) => (rowObjectiveScore(b) || 0) - (rowObjectiveScore(a) || 0))
      .slice(0, 3);

    let rsLabel = "Sin RS";
    if (Number.isFinite(avgRs)) rsLabel = avgRs >= 80 ? "Fuerte" : avgRs <= 45 ? "Débil" : "Neutral";

    return (
      <div className="marketRegionCard" key={region.key}>
        <div className="marketRegionCardHead">
          <div className="marketRegionCardTitle">
            <span className="marketRegionFlag" aria-hidden="true">{region.flag}</span>
            <div>
              <h3>{region.name}</h3>
              <small>{region.benchmark}</small>
            </div>
          </div>
          <span className="marketRegionTag">{rsLabel}</span>
        </div>
        <div className="marketRegionMetrics">
          <div
            className="marketRegionMetric"
            title={Number.isFinite(amplitude?.pct)
              ? `Sobre SMA50: ${amplitude.above} de ${amplitude.measured} valores del escaneo nocturno (cierre ${dateShort(breadth?.dataAsOf)})`
              : ""}
          >
            {/* Proporción, no variación: pctShare (sin signo). El "+67,7%" de
                antes usaba el formateador de variaciones para una amplitud. */}
            {Number.isFinite(amplitude?.pct)
              ? <b>{pctShare(amplitude.pct)}</b>
              : <b><MissingValue reason={!amplitude
                ? "La amplitud se calcula en el servidor sobre el escaneo nocturno y ahora mismo no está disponible."
                : amplitude.total
                  ? "Ningún valor de esta región trae la distancia a su SMA50 en el escaneo nocturno."
                  : "Sin valores de esta región en el universo del escaneo nocturno."} /></b>}
            <span>Amplitud (SMA50)</span>
          </div>
          <div className="marketRegionMetric" title={Number.isFinite(avgRs) ? `Media del RS semanal de ${validRs.length} de ${total} valores del escaneo nocturno` : ""}>
            {Number.isFinite(avgRs)
              ? <b>{avgRs.toFixed(0)}</b>
              : <b><MissingValue reason={total
                ? "Ningún valor de esta región está en el ranking semanal del universo, así que no hay RS que promediar."
                : "Sin valores de esta región en el escaneo nocturno: no hay RS que promediar."} /></b>}
            <span>RS promedio</span>
          </div>
          <div className="marketRegionMetric"><b>{total}</b><span>En escaneo nocturno</span></div>
        </div>
        <div className="marketRegionLeaders">
          {leaders.map((leader) => {
            const trustSignature = rowTrustSignatureForRow(leader);
            return (
              <a className="marketRegionLeaderRow" href={stockUrl(leader.symbol)} key={leader.symbol}>
                <span className="leaderTickerWrap">
                  <b>{leader.symbol}</b>
                  <small>{leader.companyName || leader.symbol}</small>
                  <RowTrustSignature signature={trustSignature} className="marketRowTrustSignature" />
                </span>
                <span className="marketRegionLeaderScores">
                  <span className="marketRegionLeaderScore">
                    <span>{metricShortLabel("objectiveScore")}</span>
                    <b>{rowObjectiveScore(leader)?.toFixed(0) || "-"}</b>
                  </span>
                  <span className="marketRegionLeaderScore">
                    <span>RS</span>
                    <b>{canonicalRsValue(leader)?.toFixed(0) || "-"}</b>
                  </span>
                </span>
              </a>
            );
          })}
          {!leaders.length && (
            <p className="marketSentimentRead marketRegionLeaderEmpty">
              Sin activos analizados en esta geografía.
            </p>
          )}
        </div>
      </div>
    );
  });

  return <div className="marketRegionsGrid">{regionCards}</div>;
}

export default function MarketHealthPage() {
  const [data, setData] = useState(null);
  const [breadth, setBreadth] = useState(null);
  const [news, setNews] = useState(null);
  const [social, setSocial] = useState(null);
  const [leadership, setLeadership] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [methodologyHealth, setMethodologyHealth] = useState(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [methodologyLoading, setMethodologyLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const scanPulse = leadership?.pulse || null;

  async function load({ refresh = false } = {}) {
    setLoading(true);
    setError("");
    try {
      const leadershipPath = refresh ? "/api/market-leadership?refresh=1" : "/api/market-leadership";
      const [marketResult, breadthResult, leadershipResult, newsResult, socialResult] = await Promise.allSettled([
        fetchJsonWithTimeout(marketHealthApiPath({ refresh }), 25000),
        fetchJsonWithTimeout("/api/market-breadth", 20000),
        fetchJsonWithTimeout(leadershipPath, 25000),
        fetchJsonWithTimeout("/api/market-news", 8000),
        fetchJsonWithTimeout("/api/social-sentiment", 8000),
      ]);
      // La amplitud del universo tiene su propio estado: si falla, su tarjeta
      // declara la ausencia sin tumbar el resto de la pantalla.
      if (breadthResult.status === "rejected") logMarketHealthFetchFailure("amplitud del universo no disponible", breadthResult.reason);
      setBreadth(breadthResult.status === "fulfilled"
        ? breadthResult.value
        : { error: userFacingServiceError(breadthResult.reason?.message, "La amplitud del universo no está disponible ahora mismo.") });
      if (leadershipResult.status === "rejected") logMarketHealthFetchFailure("liderazgo de mercado no disponible", leadershipResult.reason);
      setLeadership(leadershipResult.status === "fulfilled"
        ? leadershipResult.value
        : { error: userFacingServiceError(leadershipResult.reason?.message, "El liderazgo de mercado no está disponible ahora mismo."), pulse: null });
      if (newsResult.status === "rejected") logMarketHealthFetchFailure("titulares no disponibles", newsResult.reason);
      if (socialResult.status === "rejected") logMarketHealthFetchFailure("pulso social no disponible", socialResult.reason);
      setNews(newsResult.status === "fulfilled" ? newsResult.value : { error: userFacingServiceError(newsResult.reason?.message, "Los titulares de mercado no están disponibles ahora mismo."), rows: [] });
      setSocial(socialResult.status === "fulfilled" ? socialResult.value : { error: userFacingServiceError(socialResult.reason?.message, "El pulso social no está disponible ahora mismo."), rows: [] });
      if (marketResult.status === "rejected") throw marketResult.reason;
      setData(marketResult.value);
    } catch (e) {
      // El original a consola; a pantalla, lenguaje de producto. Este banner
      // llegó a enseñar el error crudo del proveedor con su nombre dentro.
      logMarketHealthFetchFailure("no se pudo cargar", e);
      setError(userFacingServiceError(e?.message, "No se ha podido cargar la salud de mercado ahora mismo. Inténtalo de nuevo en unos minutos."));
    } finally {
      setLoading(false);
    }
  }

  async function loadMethodologyHealth() {
    setMethodologyLoading(true);
    try {
      setMethodologyHealth(await fetchJsonWithTimeout(METHODOLOGY_HEALTH_PATH, 20000));
    } catch (e) {
      logMarketHealthFetchFailure("validación metodológica no disponible", e);
      setMethodologyHealth({ error: userFacingServiceError(e?.message, "La validación metodológica no está disponible ahora mismo.") });
    } finally {
      setMethodologyLoading(false);
    }
  }

  async function loadCoverage() {
    setCoverageLoading(true);
    try {
      const core = await fetchJsonWithTimeout(CORE_COVERAGE_PATH, 30000);
      setCoverage({ ...core, scope: "core" });
      setCoverageLoading(false);
      fetchJsonWithTimeout(FULL_COVERAGE_PATH, 45000)
        .then((full) => setCoverage((previous) => ({ ...previous, ...full, scope: "full" })))
        .catch((e) => {
          logMarketHealthFetchFailure("cobertura ampliada no disponible", e);
          const message = userFacingServiceError(e?.message, COVERAGE_UNAVAILABLE);
          setCoverage((previous) => previous && !previous.error
            ? { ...previous, secondaryError: message, scope: previous.scope || "core" }
            : { error: message });
        });
    } catch (e) {
      logMarketHealthFetchFailure("cobertura no disponible", e);
      setCoverage({ error: userFacingServiceError(e?.message, COVERAGE_UNAVAILABLE) });
      setCoverageLoading(false);
    }
  }

  function refreshAll() {
    load({ refresh: true });
    loadMethodologyHealth();
    loadCoverage();
  }

  useEffect(() => {
    load();
    loadMethodologyHealth();
    loadCoverage();
  }, []);

  const tone = data ? regimeTone(data.indexes, breadth) : "humo";
  // Amplitud del universo para el KPI del hero: el indicador «sobre su media
  // de 30 semanas» del escaneo nocturno (/api/market-breadth), con su
  // cobertura declarada. Sustituye al «5/5 sobre MM30s» de los cinco índices,
  // que decía 100% mientras la amplitud real del universo era del 68%.
  const universeAbove30w = breadth?.indicators?.find?.((item) => item.key === "above30w") || null;
  const participationSummary = breadth?.participation?.summary || null;
  // `configured: false` = la integración con X no está activada en este
  // entorno. Eso no es un dato del mercado ni un fallo que el usuario pueda
  // resolver: su sitio es el log del servidor, no la pantalla.
  const socialConfigured = social?.configured !== false;
  const newsAvailable = Boolean(news?.error || news?.rows?.length || Number(news?.total) > 0);
  const showSentimentCard = socialConfigured || newsAvailable;

  return (
    <main className="page marketHealthPage">
      <section className="marketHealthHeader">
        <div>
          <span className="eyebrow">StatsEdge · Market Health</span>
          <h1>Salud de mercado</h1>
          <p>¿Qué exposición tolera este mercado hoy — y si tolera alguna, dónde está el liderazgo?</p>
        </div>
        <div className="marketHealthActions">
          <a className="btn" href="/">Screener</a>
          <button className="btn btnPrimary" onClick={refreshAll} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</button>
        </div>
      </section>

      {error && <section className="card error">{error}</section>}

      {(coverage || methodologyHealth || coverageLoading || methodologyLoading) && (
        <ReliabilityStrip
          coverage={coverage}
          methodologyHealth={methodologyHealth}
          coverageLoading={coverageLoading}
          methodologyLoading={methodologyLoading}
        />
      )}

      {loading && !data && (
        <section className="card">
          <div className="sectionTitle"><h2>Cargando salud de mercado</h2><span className="fine">Índices, sectores y liderazgo</span></div>
          <div className="marketHealthSkeleton">
            <i /><i /><i />
          </div>
        </section>
      )}

      {data && (
        <>
          {/* ─── N0 Veredicto de mercado ─────────────────────────── */}
          <section className="marketRegimePanel" data-tone={tone}>
            <div className="marketRegimeLead">
              <div className="marketRegimeLabel">
                <small>Régimen</small>
                <h2>{data.regime?.label || "Sin dato"}</h2>
                <p>
                  {data.regime?.stance || "Lectura pendiente."}
                </p>
              </div>
              <StageStrip indexes={data.indexes} stages={breadth?.stages} tone={tone} />
            </div>
            <div className="marketRegimeKpis">
              <div className="marketRegimeKpi">
                <b>{num(data.marketScore)}</b>
                <span>Market score</span>
                <span className="marketRegimeKpiMeter"><i style={{ width: `${Math.min(100, Math.max(0, data.marketScore ?? 0))}%` }} /></span>
              </div>
              <div
                className="marketRegimeKpi"
                title={universeAbove30w?.available
                  ? `${num(universeAbove30w.count)} de ${num(universeAbove30w.measured)} valores del escaneo nocturno sobre su media de 30 semanas (cierre ${dateShort(breadth?.dataAsOf)}).`
                  : ""}
              >
                {universeAbove30w?.available
                  ? <b>{pctShare(universeAbove30w.pct)}</b>
                  : <b><MissingValue reason={universeAbove30w?.reason || breadth?.error || "La amplitud del universo no está disponible ahora mismo."} /></b>}
                <span>Universo sobre MM30s</span>
                {universeAbove30w?.available && (
                  <span className="marketRegimeKpiMeter"><i style={{ width: `${Math.min(100, Math.max(0, universeAbove30w.pct ?? 0))}%` }} /></span>
                )}
              </div>
              <div className="marketRegimeKpi">
                <b>{pctShare(data.weinsteinTape?.pctSectorsStage2)}</b>
                <span>Sectores en etapa 2</span>
                <span className="marketRegimeKpiMeter"><i style={{ width: `${Math.min(100, Math.max(0, data.weinsteinTape?.pctSectorsStage2 ?? 0))}%` }} /></span>
              </div>
              <div className="marketRegimeKpi">
                <b>{Number.isFinite(data.weinsteinTape?.distributionDays20Avg) && Number.isFinite(data.weinsteinTape?.accumulationDays20Avg) ? `${num(data.weinsteinTape.distributionDays20Avg, 1)}/${num(data.weinsteinTape.accumulationDays20Avg, 1)}` : "—"}</b>
                <span>Dist/Acc 20d</span>
              </div>
            </div>
            {participationSummary && (
              <p
                className="marketRegimeParticipation"
                title="Participación: valores del universo RS con retorno ponderado positivo esa semana. Serie completa en «Amplitud del universo»."
              >
                En las últimas {num(participationSummary.weeks)} semanas{" "}
                {breadth?.participation?.index?.symbol || "el índice"} varió {pct(participationSummary.indexChangePct)} y
                la participación pasó del {pctShare(participationSummary.participationStartPct)} al{" "}
                {pctShare(participationSummary.participationEndPct)}.
                {participationSummary.divergence && <b> El índice sube y cada vez menos valores lo acompañan.</b>}
              </p>
            )}
          </section>

          {/* ─── N1 Evidencia interna ─────────────────────────────── */}
          {data.weinsteinTape && (
            <section className="card marketTapeCard">
              <div className="sectionTitle">
                <h2>Estructura del mercado</h2>
                <span className="fine">MM30 semanas · amplitud · volumen</span>
              </div>
              <div className="marketTapeKpis">
                <div className="marketTapeKpi"><b>{data.weinsteinTape.indexesAbove30w ?? "—"}/{data.weinsteinTape.indexesTotal ?? data.indexes?.length ?? "—"}</b><span>Sobre MM30s</span></div>
                <div className="marketTapeKpi"><b>{pctShare(data.weinsteinTape.pctSectorsAbove30w)}</b><span>Sectores sobre MM30s</span></div>
                <div className="marketTapeKpi"><b>{pctShare(data.weinsteinTape.pctSectorsStage4)}</b><span>Sectores en etapa 4</span></div>
                {/* Conteo como conteo: `above50` son sectores (de 11), no un
                    porcentaje. Pintarlo con pctShare producía el «6%» del
                    análisis 2026-08-16 (B.1). Misma forma que su gemela de
                    «Amplitud sectorial». */}
                <div className="marketTapeKpi"><b>{data.sectorSummary?.above50 ?? "—"}/{data.sectorSummary?.count ?? "—"}</b><span>Sobre SMA50</span></div>
              </div>
              <div className="marketPulseEvidence">
                <div className="evidencePanel">
                  <h3>Sectores con confirmación</h3>
                  {data.weinsteinTape.leadingSectors?.map((sector) => (
                    <div className="evidenceRow" key={sector.symbol}>
                      <span><b>{sector.name}</b><small>{sector.symbol}</small></span>
                      <span><b>{num(sector.score)}</b><small>Estructura</small></span>
                      <span><b>{pct(sector.rs1m)}</b><small>RS 1M vs SPY</small></span>
                    </div>
                  ))}
                  {!data.weinsteinTape.leadingSectors?.length && (
                    <p className="fine evidencePanelEmpty">Sin sectores con confirmación suficiente.</p>
                  )}
                </div>
                <div className="evidencePanel">
                  <h3>Divergencias y presión</h3>
                  {data.weinsteinTape.divergences?.map((item) => (
                    <div className="evidenceRow" key={item}>
                      <span><b>{item}</b><small>Lectura interna</small></span>
                      <span><b>—</b><small>dato</small></span>
                      <span><b>Contexto</b><small>interno</small></span>
                    </div>
                  ))}
                  {!data.weinsteinTape.divergences?.length && (
                    <p className="fine evidencePanelEmpty">Sin divergencias internas relevantes en esta muestra.</p>
                  )}
                </div>
              </div>
              <div className="marketSectorTapeRow">
                <div>
                  <b>Tipo de liderazgo</b>
                  <span>Ofensivos en etapa 2: {data.weinsteinTape.offensiveStage2 ?? "—"} · Defensivos en etapa 2: {data.weinsteinTape.defensiveStage2 ?? "—"}</span>
                </div>
                <div>
                  <b>Sensores seleccionados</b>
                  <span>{listText(data.weinsteinTape.indicators?.slice(0, 3))}</span>
                </div>
              </div>
            </section>
          )}

          <UniverseBreadthCard breadth={breadth} loading={loading} />

          <section className="card">
            <div className="sectionTitle">
              <h2>Liderazgo y fuerza relativa global</h2>
              <span className="fine">Escaneo nocturno de Estados Unidos · amplitud y liderazgo compartidos</span>
            </div>
            <GlobalRegionsPanel rows={scanPulse?.rows || []} breadth={breadth} />
          </section>

          <section className="card">
            <div className="sectionTitle">
              <h2>Leadership pulse</h2>
              <span className="fine">{scanPulse
                ? `Escaneo nocturno · ${dateFmt(scanPulse.createdAt)} · ${scanPulse.count} valores`
                : (leadership?.error || "Sin escaneo nocturno publicable")}</span>
            </div>
            {scanPulse ? (
              <>
                <div className="marketPulseKpis">
                  <div className="marketPulseKpi"><b>{pctShare(scanPulse.rsLeaderPct)}</b><span>{metricShortLabel("rsGlobalPct")} ≥ 80</span></div>
                  <div className="marketPulseKpi"><b>{pctShare(scanPulse.nearHighPct)}</b><span>Cerca máximos 52s</span></div>
                  <div className="marketPulseKpi"><b>{pctShare(scanPulse.pressurePct)}</b><span>Deterioro 2+</span></div>
                  <div className="marketPulseKpi"><b>{num(data.sectorSummary?.avgScore)}</b><span>Score medio sectorial</span></div>
                </div>
                <div className="marketPulseEvidence">
                  <div className="evidencePanel">
                    <h3>Liderazgo observado</h3>
                    {scanPulse.leaders.map((row) => {
                      const rs = rowRsDisplay(row);
                      const rsKey = "rsGlobalPct";
                      const trustSignature = rowTrustSignatureForRow(row);
                      return (
                        <a className="evidenceRow" href={stockUrl(row.symbol)} key={row.symbol}>
                          <span><b>{row.symbol}</b><small>{row.companyName || rowTheme(row) || "-"}</small><RowTrustSignature signature={trustSignature} className="marketRowTrustSignature" /></span>
                          <span><MarketTrustMetric row={row} metricKey={rsKey} label={rowRsDisplayLabel()} value={Number.isFinite(rs) ? rs.toFixed(0) : "-"} /><small>{rowRsDisplayLabel()}</small></span>
                          <span><MarketTrustMetric row={row} metricKey="objectiveScore" label={metricShortLabel("objectiveScore")} value={rowObjectiveScore(row)?.toFixed(0) || "-"} /><small>{metricShortLabel("objectiveScore")}</small></span>
                        </a>
                      );
                    })}
                    {!scanPulse.leaders.length && <p className="fine">Sin liderazgo claro en el escaneo nocturno.</p>}
                  </div>
                  <div className="evidencePanel">
                    <h3>Deterioro a revisar</h3>
                    {scanPulse.deterioration.map((row) => {
                      const rs = rowRsDisplay(row);
                      const rsKey = "rsGlobalPct";
                      const trustSignature = rowTrustSignatureForRow(row);
                      return (
                        <a className="evidenceRow" href={stockUrl(row.symbol)} key={row.symbol}>
                          <span><b>{row.symbol}</b><small>{row.companyName || rowTheme(row) || "-"}</small><RowTrustSignature signature={trustSignature} className="marketRowTrustSignature" /></span>
                          <span><b>{row.deteriorationReasons.length}</b><small>evidencias</small></span>
                          <span><MarketTrustMetric row={row} metricKey={rsKey} label={rowRsDisplayLabel()} value={Number.isFinite(rs) ? rs.toFixed(0) : "-"} /><small>{row.deteriorationReasons.slice(0, 2).join(", ")}</small></span>
                        </a>
                      );
                    })}
                    {!scanPulse.deterioration.length && <p className="fine">Sin deterioro técnico relevante en el escaneo nocturno.</p>}
                  </div>
                </div>
                <div className="marketSectorTapeRow">
                  <div>
                    <b>Concentración por país</b>
                    <span>{scanPulse.countries.slice(0, 5).map((x) => `${x.name} ${x.leaders}/${x.count}`).join(" · ") || "—"}</span>
                  </div>
                  <div>
                    <b>Concentración por tema</b>
                    <span>{scanPulse.themes.slice(0, 5).map((x) => `${x.name} ${x.leaders}/${x.count}`).join(" · ") || "—"}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="fine">{leadership?.error || "Todavía no hay escaneo nocturno de Estados Unidos con el que calcular liderazgo, concentración por país/tema y deterioro observado."}</p>
            )}
          </section>

          {!!data.sectorTape?.length && (
            <section className="card">
              <div className="sectionTitle"><h2>Amplitud sectorial</h2><a className="btnSmall" href="/sectors">Ver sectores</a></div>
              <div className="marketTapeKpis">
                <div className="marketTapeKpi"><b>{num(data.sectorSummary?.avgScore)}</b><span>Score medio</span></div>
                <div className="marketTapeKpi"><b>{data.sectorSummary?.above50 ?? "—"}/{data.sectorSummary?.count ?? "—"}</b><span>Sobre SMA50</span></div>
              </div>
              <div className="marketSectorTapeRow">
                <div><b>1M</b><span>{data.sectorSummary?.best1m || "—"} lidera · {data.sectorSummary?.worst1m || "—"} rezaga</span></div>
                <div><b>Líderes / débiles</b><span>{listText(data.sectorSummary?.leaders)} · {listText(data.sectorSummary?.laggards)}</span></div>
              </div>
              {data.sectorTapeNote && <span className="fine">Detalle operativo en Sectores.</span>}
            </section>
          )}

          {/* ─── N2 Lectura contraria: Sentimiento fusionado ────── */}
          {/* La integración con X es opcional. Si no está activada, su fila no
              se muestra —ni con un aviso que nombre la integración, que es lo
              que dejaba en pantalla el nombre de una variable de entorno—, y
              si tampoco hay titulares la sección entera desaparece. */}
          {showSentimentCard && (
          <section className="card marketSentimentCard">
            <div className="sectionTitle">
              <h2>Sentimiento{news?.contrarianRead || social?.contrarianRead
                ? <> <InfoHint text={[news?.contrarianRead || social?.contrarianRead, news?.note].filter(Boolean).join(" ")} /></>
                : null}</h2>
              <span className="fine">{socialConfigured ? "Titulares + social · lectura contraria" : "Titulares · lectura contraria"}</span>
            </div>
            {(news?.error || (socialConfigured && social?.error)) && (
              <div className="dataNote marketSentimentCardNotice">
                {news?.error || social?.error}
              </div>
            )}
            <div className="marketSentimentGrid">
              <SentimentRow data={news} title="Titulares" sampleLabel="titulares" />
              {socialConfigured ? <SentimentRow data={social} title="Social" sampleLabel="posts" /> : null}
            </div>
            <SentimentFeeds news={news} social={social} />
          </section>
          )}

          {/* ─── N3 Auditoría (colapsado por defecto) ───────────── */}
          <section className="card">
            <details>
              <summary><h2 className="marketAuditSummary">Auditoría</h2></summary>

              <div className="marketAuditGrid marketAuditGridSpaced">
                <div>
                  <div className="sectionTitle"><h3>Amplitud aproximada (absolutos)</h3><span className="fine">Método</span></div>
                  <div className="marketAuditKv">
                    <div className="marketAuditKvRow"><span>Índices analizados</span><b>{data.breadthProxy?.indexes ?? "—"}</b></div>
                    <div className="marketAuditKvRow"><span>Sobre SMA50</span><b>{data.breadthProxy?.above50 ?? "—"}</b></div>
                    <div className="marketAuditKvRow"><span>Sobre SMA200</span><b>{data.breadthProxy?.above200 ?? "—"}</b></div>
                    <div className="marketAuditKvRow"><span>Sobre MM30 semanas</span><b>{data.breadthProxy?.above30w ?? "—"}</b></div>
                    <div className="marketAuditKvRow"><span>SMA200 subiendo</span><b>{data.breadthProxy?.positiveSma200Slope ?? "—"}</b></div>
                    <div className="marketAuditKvRow"><span>Cerca de máximo 52s</span><b>{data.breadthProxy?.near52wHigh ?? "—"}</b></div>
                    <div className="marketAuditKvRow"><span>Base</span><b>Medias / amplitud / liderazgo</b></div>
                    <div className="marketAuditKvRow"><span>Confirmación</span><b>Precio y snapshot</b></div>
                  </div>
                </div>

                <div>
                  <div className="sectionTitle"><h3>Índices principales</h3><span className="fine">{data.indexes?.length || 0} entradas</span></div>
                  <div className="tableWrap">
                    <div className="marketIndexesTableWrap">
                      <table className="marketIndexesTable">
                        <thead><tr>{["Índice", "Etapa", "Score", "Estructura", "1M", "3M", "6M", "52w", "Desde mín 52w", "MM30s", "SMA200 slope", "Dist/Acc", "Fecha"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                        <tbody>{data.indexes?.map((x) => (
                          <tr key={x.symbol}>
                            <td><b>{x.name}</b><small>{x.symbol}</small></td>
                            {/* Etapa canónica + calificador estructural (mismo
                                diccionario que la mesa: lib/stageDisplay.js). */}
                            <td data-col="stage">{marketStageCell(x)}</td>
                            <td data-col="data">{num(x.score)}</td>
                            <td data-col="data">{num(x.weinsteinScore)}</td>
                            <td data-col="data">{pct(x.perf1m)}</td>
                            <td data-col="data">{pct(x.perf3m)}</td>
                            <td data-col="data">{pct(x.perf6m)}</td>
                            <td data-col="data">{pct(x.distance52w)}</td>
                            <td data-col="data">{pct(x.advanceFrom52wLow)}</td>
                            <td data-col="data">{pct(x.distanceSma30w)}</td>
                            <td data-col="data">{pct(x.sma200Slope)}</td>
                            <td data-col="data">{Number.isFinite(x.distributionDays20) ? `${x.distributionDays20}/${x.accumulationDays20}` : "—"}</td>
                            <td data-col="data">{x.lastDate ? dateShort(x.lastDate) : "—"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {data.failures?.length > 0 && (
                  <div>
                    <div className="sectionTitle"><h3>Fallos de datos</h3><span className="fine">{data.failures.length} entradas</span></div>
                    <div className="marketAuditKv">
                      {data.failures.map((f) => (
                        <div className="marketAuditKvRow" key={f.symbol}>
                          <span>{f.symbol} · {f.name}</span>
                          <b>{f.reason}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          </section>
        </>
      )}
    </main>
  );
}
