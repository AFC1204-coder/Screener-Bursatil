"use client";
import "../../styles/market-health.css";
import { useEffect, useState } from "react";
import RowTrustSignature from "@/app/RowTrustSignature";
import RegimeConstellation, { aggregatePosition, regimeTone } from "./RegimeConstellation";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { TrustMetric } from "@/app/components/ui/MetricSource";
import { rowTrustSignatureForRow } from "@/app/components/ui/TrustSignals";
import { getJson } from "@/lib/clientApi";
import { num, pct, pctShare } from "@/lib/formatters";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { metricValue, rowRsBenchmark, rowRsPrimary, rowRsUniverse, rowTheme, weaknessScore } from "@/lib/stockRows";
import { stockUrl } from "@/lib/symbols";

const dateFmt = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-ES", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";
};

const sentimentClass = (label = "") => label === "alcista" ? "bullish" : label === "bajista" ? "bearish" : "neutral";
const sentimentDirection = (label = "") => label === "alcista" ? "up" : label === "bajista" ? "down" : "flat";
const sentimentGlyph = (label = "") => label === "alcista" ? "▴" : label === "bajista" ? "▾" : "·";
const listText = (items = []) => items.length ? items.join(", ") : "-";


function MarketTrustMetric({ row, metricKey, label, value }) {
  return <TrustMetric row={row} metricKey={metricKey} label={label} value={value} baseClass="marketTrustMetric" valueTag="b" />;
}

function safePct(value, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function rowRs(row = {}) { return rowRsPrimary(row); }
function rowRsDisplay(row = {}) {
  return rowRsUniverse(row) ?? rowRsBenchmark(row) ?? null;
}
function rowRsDisplayLabel(row = {}) {
  return Number.isFinite(rowRsUniverse(row)) ? metricShortLabel("rsGlobalPct") : metricShortLabel("rsRating");
}
function rowWeakness(row = {}) { return weaknessScore(row); }
function rowObjectiveScore(row = {}) { return metricValue(row, "objectiveScore"); }
function isNearHigh(row = {}) {
  return Number.isFinite(row.distance52w) && row.distance52w >= -15;
}
function isStage2Like(row = {}) {
  return row.price > row.sma50 && row.price > row.sma200 && (row.sma200Slope ?? 0) >= 0;
}

function deteriorationReasons(row = {}) {
  const reasons = [];
  if (rowWeakness(row) >= 65) reasons.push("Deterioro alto");
  const rsUniverse = rowRsUniverse(row);
  const rsBenchmark = rowRsBenchmark(row);
  if (Number.isFinite(rsUniverse) && rsUniverse < 40) reasons.push("RS débil");
  else if (!Number.isFinite(rsUniverse) && Number.isFinite(rsBenchmark) && rsBenchmark < 45) reasons.push("RS Bench bajo");
  if (Number.isFinite(row.price) && Number.isFinite(row.sma50) && row.price < row.sma50) reasons.push("Bajo SMA50");
  if (Number.isFinite(row.price) && Number.isFinite(row.sma200) && row.price < row.sma200) reasons.push("Bajo SMA200");
  if (Number.isFinite(row.distance52w) && row.distance52w < -30) reasons.push("Lejos de máximos");
  if (Number.isFinite(row.maxDrawdown63d) && row.maxDrawdown63d > 32) reasons.push("Drawdown elevado");
  if (Number.isFinite(row.upDownVolRatio) && row.upDownVolRatio < .8) reasons.push("Presion volumen");
  if (Number.isFinite(row.riskScore) && row.riskScore < 35) reasons.push("Riesgo técnico");
  if (Number.isFinite(row.speculationRiskScore) && row.speculationRiskScore >= 70) reasons.push("Riesgo especulativo");
  return reasons;
}

function summarizeGroups(rows = [], keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row) || "Sin grupo";
    const bucket = map.get(key) || { name: key, count: 0, rs: 0, score: 0, nearHigh: 0, leaders: 0, top: null };
    const rs = rowRs(row);
    bucket.count += 1;
    bucket.rs += Number.isFinite(rs) ? rs : 50;
    const objectiveScore = rowObjectiveScore(row);
    bucket.score += objectiveScore || 0;
    if (isNearHigh(row)) bucket.nearHigh += 1;
    if ((rs || 0) >= 80 || (objectiveScore || 0) >= 75) bucket.leaders += 1;
    if (!bucket.top || (objectiveScore || 0) > (rowObjectiveScore(bucket.top) || 0)) bucket.top = row;
    map.set(key, bucket);
  });
  return [...map.values()]
    .map((x) => ({ ...x, rs: x.rs / x.count, score: x.score / x.count, nearHighPct: (x.nearHigh / x.count) * 100 }))
    .sort((a, b) => (b.leaders - a.leaders) || (b.rs - a.rs) || (b.score - a.score))
    .slice(0, 8);
}

function buildScanPulse(scans = []) {
  const scan = scans[0];
  const rows = Array.isArray(scan?.rows) ? scan.rows : [];
  if (!scan || !rows.length) return null;
  const leaders = rows
    .filter((row) => (rowRs(row) || 0) >= 80 || (rowObjectiveScore(row) || 0) >= 75 || (isStage2Like(row) && isNearHigh(row)))
    .sort((a, b) => ((rowRs(b) || 0) - (rowRs(a) || 0)) || ((rowObjectiveScore(b) || 0) - (rowObjectiveScore(a) || 0)))
    .slice(0, 8);
  const deterioration = rows
    .map((row) => ({ ...row, deteriorationReasons: deteriorationReasons(row) }))
    .filter((row) => row.deteriorationReasons.length)
    .sort((a, b) => (b.deteriorationReasons.length - a.deteriorationReasons.length) || ((rowRs(a) || 50) - (rowRs(b) || 50)))
    .slice(0, 8);
  const nearHigh = rows.filter(isNearHigh).length;
  const stage2 = rows.filter(isStage2Like).length;
  const rsLeader = rows.filter((row) => (rowRsUniverse(row) || 0) >= 80).length;
  const pressure = rows.filter((row) => deteriorationReasons(row).length >= 2).length;
  return {
    scan,
    rows,
    count: rows.length,
    createdAt: scan.createdAt,
    preset: scan.preset || "-",
    marketRegime: scan.marketRegime || "sin dato",
    leaders,
    deterioration,
    nearHighPct: rows.length ? (nearHigh / rows.length) * 100 : null,
    stage2Pct: rows.length ? (stage2 / rows.length) * 100 : null,
    rsLeaderPct: rows.length ? (rsLeader / rows.length) * 100 : null,
    pressurePct: rows.length ? (pressure / rows.length) * 100 : null,
    countries: summarizeGroups(rows, (row) => row.country),
    themes: summarizeGroups(rows, (row) => rowTheme(row) || row.sector),
  };
}

async function fetchJsonWithTimeout(path, timeoutMs = 12000) {
  try {
    return await getJson(path, { timeoutMs, cache: "no-store" });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${path} no respondió en ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  }
}

const CORE_COVERAGE_PATH = "/api/coverage?markets=US,JP,HK,AU,TW";
const FULL_COVERAGE_PATH = "/api/coverage?markets=US,EU1,JP,HK,AU,TW";

/* ─── Sentimiento fusionado (N2): un componente, dos filas ──────────
   Sin rojo/verde: la dirección la dan los extremos etiquetados + el glifo
   en el sentimentPill del item. La barra usa tonos de humo + un dot tiza
   como marcador de posición (no como semáforo). */
function SentimentRow({ data, title = "Lectura contraria", sampleLabel = "titulares" }) {
  if (!data || data.error) {
    return (
      <div className="marketSentimentRow" data-empty="true">
        <div className="marketSentimentRowHead">
          <small>{title}</small>
          <span className="marketSentimentIndex">—</span>
        </div>
        <p className="marketSentimentRead">{data?.error || `Sin muestra de ${sampleLabel}.`}</p>
      </div>
    );
  }
  const bearishPct = safePct(data?.bearishPct);
  const neutralPct = safePct(data?.neutralPct);
  const bullishPct = safePct(data?.bullishPct);
  const pessimism = safePct(data?.pessimismIndex, 50);
  const dominant = data?.dominantSentiment || "neutral";
  return (
    <div className="marketSentimentRow">
      <div className="marketSentimentRowHead">
        <small>{title} · {data?.regime || "sin regimen"}</small>
        <span className="marketSentimentIndex">{num(pessimism)}</span>
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
        <span>dominante <b>{dominant}</b></span>
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
        <b>{issues || failures || 0}</b>
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
        <div className="marketReliabilityRows">
          <div className="marketReliabilityRow"><b>{totals.passed ?? "—"}/{totals.cases ?? "—"}</b><span>casos validados</span><em>{totals.failed ?? 0} fallos</em></div>
          <div className="marketReliabilityRow"><b>{buckets.plan ?? 0}</b><span>planes automáticos</span><em>debe permanecer en 0</em></div>
          <div className="marketReliabilityRow"><b>{buckets.watch ?? 0}</b><span>vigilancia</span><em>candidatas para mirar</em></div>
          <div className="marketReliabilityRow"><b>{buckets.observe ?? 0}</b><span>observables</span><em>fuera de zona</em></div>
          <div className="marketReliabilityRow"><b>{buckets.block ?? 0}</b><span>bloqueadas</span><em>estructura no pasa</em></div>
        </div>
      )}
    </div>
  );
}

/* ─── Regiones (cards compactas; N1) ───────────────────────────────── */
function GlobalRegionsPanel({ rows = [] }) {
  const REGIONS = [
    { key: "US", name: "Estados Unidos", flag: "🇺🇸", benchmark: "S&P 500 (SPY)", countries: ["US"] },
    { key: "EU", name: "Europa", flag: "🇪🇺", benchmark: "Euro Stoxx 50 (FEZ)", countries: ["ES", "DE", "FR", "NL", "CH", "SE", "IT", "BE", "PT", "AT", "IE", "GB"] },
    { key: "AS", name: "Asia / Pacífico", flag: "🇯🇵", benchmark: "Nikkei 225 (TSE)", countries: ["JP", "HK", "SG", "TW", "KR", "CN", "AU"] },
    { key: "Global", name: "Global / Emergentes", flag: "🌐", benchmark: "MSCI ACWI (ACWI)", countries: [] },
  ];

  const regionCards = REGIONS.map((region) => {
    let filtered = [];
    if (region.key === "Global") {
      const otherCountries = new Set([
        ...REGIONS[0].countries, ...REGIONS[1].countries, ...REGIONS[2].countries,
      ]);
      filtered = rows.filter((r) => !otherCountries.has(r.country || "US"));
    } else {
      filtered = rows.filter((r) => region.countries.includes(r.country || "US"));
    }

    const total = filtered.length;
    const above50 = filtered.filter((r) => (r.extSma50 ?? 0) >= 0).length;
    const amplitudePct = total ? (above50 / total) * 100 : 0;
    const validRs = filtered.map((r) => rowRsPrimary(r)).filter(Number.isFinite);
    const avgRs = validRs.length ? validRs.reduce((s, v) => s + v, 0) / validRs.length : 50;

    const leaders = [...filtered]
      .sort((a, b) => (rowObjectiveScore(b) || 0) - (rowObjectiveScore(a) || 0))
      .slice(0, 3);

    let rsLabel = "Neutral";
    if (avgRs >= 80) rsLabel = "Fuerte";
    else if (avgRs <= 45) rsLabel = "Débil";

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
          <div className="marketRegionMetric"><b>{pct(amplitudePct)}</b><span>Amplitud (SMA50)</span></div>
          <div className="marketRegionMetric"><b>{avgRs.toFixed(0)}</b><span>RS promedio</span></div>
          <div className="marketRegionMetric"><b>{total}</b><span>En snapshot</span></div>
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
                    <b>{rowRsPrimary(leader)?.toFixed(0) || "-"}</b>
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
  const [news, setNews] = useState(null);
  const [social, setSocial] = useState(null);
  const [scanPulse, setScanPulse] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [methodologyHealth, setMethodologyHealth] = useState(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [methodologyLoading, setMethodologyLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function refreshScanPulse() {
    setScanPulse(buildScanPulse(safeRead(STORAGE_KEYS.scans, [])));
  }

  async function load() {
    setLoading(true);
    setError("");
    refreshScanPulse();
    try {
      const [marketResult, newsResult, socialResult] = await Promise.allSettled([
        fetchJsonWithTimeout("/api/market-health", 25000),
        fetchJsonWithTimeout("/api/market-news", 8000),
        fetchJsonWithTimeout("/api/social-sentiment", 8000),
      ]);
      setNews(newsResult.status === "fulfilled" ? newsResult.value : { error: newsResult.reason?.message || "Noticias no disponibles", rows: [] });
      setSocial(socialResult.status === "fulfilled" ? socialResult.value : { error: socialResult.reason?.message || "Pulso social no disponible", rows: [] });
      if (marketResult.status === "rejected") throw marketResult.reason;
      setData(marketResult.value);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadMethodologyHealth() {
    setMethodologyLoading(true);
    try {
      setMethodologyHealth(await fetchJsonWithTimeout(METHODOLOGY_HEALTH_PATH, 20000));
    } catch (e) {
      setMethodologyHealth({ error: e.message || String(e) });
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
          setCoverage((previous) => previous && !previous.error
            ? { ...previous, secondaryError: e.message || String(e), scope: previous.scope || "core" }
            : { error: e.message || String(e) });
        });
    } catch (e) {
      setCoverage({ error: e.message || String(e) });
      setCoverageLoading(false);
    }
  }

  function refreshAll() {
    load();
    loadMethodologyHealth();
    loadCoverage();
  }

  useEffect(() => {
    load();
    loadMethodologyHealth();
    loadCoverage();
  }, []);

  const tone = data ? regimeTone(data, data.indexes) : "humo";

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
              <RegimeConstellation indexes={data.indexes} />
            </div>
            <div className="marketRegimeKpis">
              <div className="marketRegimeKpi">
                <b>{num(data.marketScore)}</b>
                <span>Market score</span>
                <span className="marketRegimeKpiMeter"><i style={{ width: `${Math.min(100, Math.max(0, data.marketScore ?? 0))}%` }} /></span>
              </div>
              <div className="marketRegimeKpi">
                <b>{data.breadthProxy?.indexesAbove30w ?? data.breadthProxy?.above30w ?? "—"}/{data.indexes?.length ?? "—"}</b>
                <span>Sobre MM30s</span>
              </div>
              <div className="marketRegimeKpi">
                <b>{pctShare(data.weinsteinTape?.pctSectorsStage2)}</b>
                <span>Sectores E2</span>
                <span className="marketRegimeKpiMeter"><i style={{ width: `${Math.min(100, Math.max(0, data.weinsteinTape?.pctSectorsStage2 ?? 0))}%` }} /></span>
              </div>
              <div className="marketRegimeKpi">
                <b>{Number.isFinite(data.weinsteinTape?.distributionDays20Avg) && Number.isFinite(data.weinsteinTape?.accumulationDays20Avg) ? `${data.weinsteinTape.distributionDays20Avg.toFixed(1)}/${data.weinsteinTape.accumulationDays20Avg.toFixed(1)}` : "—"}</b>
                <span>Dist/Acc 20d</span>
              </div>
            </div>
          </section>

          {/* ─── N1 Evidencia interna ─────────────────────────────── */}
          {data.weinsteinTape && (
            <section className="card marketTapeCard">
              <div className="sectionTitle">
                <h2>Weinstein tape</h2>
                <span className="fine">MM30 semanas · amplitud · volumen</span>
              </div>
              <div className="marketTapeKpis">
                <div className="marketTapeKpi"><b>{data.weinsteinTape.indexesAbove30w ?? "—"}/{data.weinsteinTape.indexesTotal ?? data.indexes?.length ?? "—"}</b><span>Sobre MM30s</span></div>
                <div className="marketTapeKpi"><b>{pctShare(data.weinsteinTape.pctSectorsAbove30w)}</b><span>Sectores sobre MM30s</span></div>
                <div className="marketTapeKpi"><b>{pctShare(data.weinsteinTape.pctSectorsStage4)}</b><span>Sectores E4</span></div>
                <div className="marketTapeKpi"><b>{pctShare(data.weinsteinTape.pctSectorsAbove50 ?? data.sectorSummary?.above50)}</b><span>Sobre SMA50</span></div>
              </div>
              <div className="marketPulseEvidence">
                <div className="evidencePanel">
                  <h3>Sectores con confirmación</h3>
                  {data.weinsteinTape.leadingSectors?.map((sector) => (
                    <div className="evidenceRow" key={sector.symbol}>
                      <span><b>{sector.name}</b><small>{sector.symbol}</small></span>
                      <span><b>{num(sector.score)}</b><small>W tape</small></span>
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
                  <span>Ofensivo E2: {data.weinsteinTape.offensiveStage2 ?? "—"} · Defensivo E2: {data.weinsteinTape.defensiveStage2 ?? "—"}</span>
                </div>
                <div>
                  <b>Sensores seleccionados</b>
                  <span>{listText(data.weinsteinTape.indicators?.slice(0, 3))}</span>
                </div>
              </div>
            </section>
          )}

          <section className="card">
            <div className="sectionTitle">
              <h2>Liderazgo y fuerza relativa global</h2>
              <span className="fine">Amplitud y líderes por regiones principales</span>
            </div>
            <GlobalRegionsPanel rows={scanPulse?.rows || []} />
          </section>

          <section className="card">
            <div className="sectionTitle">
              <h2>Leadership pulse</h2>
              <span className="fine">{scanPulse ? `Último snapshot · ${dateFmt(scanPulse.createdAt)} · ${scanPulse.marketRegime}` : "Sin snapshot local"}</span>
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
                      const rsKey = Number.isFinite(rowRsUniverse(row)) ? "rsGlobalPct" : "rsRating";
                      const trustSignature = rowTrustSignatureForRow(row);
                      return (
                        <a className="evidenceRow" href={stockUrl(row.symbol)} key={row.symbol}>
                          <span><b>{row.symbol}</b><small>{row.companyName || rowTheme(row) || "-"}</small><RowTrustSignature signature={trustSignature} className="marketRowTrustSignature" /></span>
                          <span><MarketTrustMetric row={row} metricKey={rsKey} label={rowRsDisplayLabel(row)} value={Number.isFinite(rs) ? rs.toFixed(0) : "-"} /><small>{rowRsDisplayLabel(row)}</small></span>
                          <span><MarketTrustMetric row={row} metricKey="objectiveScore" label={metricShortLabel("objectiveScore")} value={rowObjectiveScore(row)?.toFixed(0) || "-"} /><small>{metricShortLabel("objectiveScore")}</small></span>
                        </a>
                      );
                    })}
                    {!scanPulse.leaders.length && <p className="fine">Sin liderazgo claro en el último snapshot.</p>}
                  </div>
                  <div className="evidencePanel">
                    <h3>Deterioro a revisar</h3>
                    {scanPulse.deterioration.map((row) => {
                      const rs = rowRsDisplay(row);
                      const rsKey = Number.isFinite(rowRsUniverse(row)) ? "rsGlobalPct" : "rsRating";
                      const trustSignature = rowTrustSignatureForRow(row);
                      return (
                        <a className="evidenceRow" href={stockUrl(row.symbol)} key={row.symbol}>
                          <span><b>{row.symbol}</b><small>{row.companyName || rowTheme(row) || "-"}</small><RowTrustSignature signature={trustSignature} className="marketRowTrustSignature" /></span>
                          <span><b>{row.deteriorationReasons.length}</b><small>evidencias</small></span>
                          <span><MarketTrustMetric row={row} metricKey={rsKey} label={rowRsDisplayLabel(row)} value={Number.isFinite(rs) ? rs.toFixed(0) : "-"} /><small>{row.deteriorationReasons.slice(0, 2).join(", ")}</small></span>
                        </a>
                      );
                    })}
                    {!scanPulse.deterioration.length && <p className="fine">Sin deterioro técnico relevante en el último snapshot.</p>}
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
              <p className="fine">Guarda un snapshot desde el screener para que esta sección muestre liderazgo, concentración por país/tema y deterioro observado.</p>
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
          <section className="card marketSentimentCard">
            <div className="sectionTitle">
              <h2>Sentimiento <InfoHint text={`${news?.contrarianRead || social?.contrarianRead || "Sin lectura contraria disponible."} ${news?.note || ""}`} /></h2>
              <span className="fine">Titulares + social · lectura contraria</span>
            </div>
            {(news?.error || social?.error) && (
              <div className="dataNote marketSentimentCardNotice">
                {news?.error || social?.error}
              </div>
            )}
            <div className="marketSentimentGrid">
              <SentimentRow data={news} title="Titulares" sampleLabel="titulares" />
              <SentimentRow data={social} title="Social" sampleLabel="posts" />
            </div>
            <SentimentFeeds news={news} social={social} />
          </section>

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
                        <thead><tr>{["Índice", "Etapa", "Etapa 30s", "Score", "W tape", "1M", "3M", "6M", "52w", "Desde mín 52w", "MM30s", "SMA200 slope", "Dist/Acc", "Fecha"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                        <tbody>{data.indexes?.map((x) => (
                          <tr key={x.symbol}>
                            <td><b>{x.name}</b><small>{x.symbol}</small></td>
                            <td data-col="stage">{x.stage || "—"}</td>
                            <td data-col="stage">{x.stage30w || "—"}</td>
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
                            <td data-col="data">{x.lastDate || "—"}</td>
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