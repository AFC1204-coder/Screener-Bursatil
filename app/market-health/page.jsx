"use client";
import "../../styles/market-health.css";
import { useEffect, useState } from "react";
import { num, pct, pctShare } from "@/lib/formatters";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { rowRsBenchmark, rowRsPrimary, rowRsUniverse, rowTheme, weaknessScore } from "@/lib/stockRows";
import { stockUrl } from "@/lib/symbols";

const dateFmt = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-ES", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";
};
const sentimentClass = (label = "") => label === "alcista" ? "bullish" : label === "bajista" ? "bearish" : "neutral";
const listText = (items = []) => items.length ? items.join(", ") : "-";

function InfoHint({ text, tone = "" }) {
  if (!text) return null;
  return <span className={`infoHint ${tone}`} tabIndex="0" aria-label={text}>
    <span aria-hidden="true">i</span>
    <em aria-hidden="true">{text}</em>
  </span>;
}

function safePct(value, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function rowRs(row = {}) {
  return rowRsPrimary(row);
}
function rowRsDisplay(row = {}) {
  return rowRsUniverse(row) ?? rowRsBenchmark(row) ?? null;
}
function rowRsDisplayLabel(row = {}) {
  return Number.isFinite(rowRsUniverse(row)) ? metricShortLabel("rsGlobalPct") : metricShortLabel("rsRating");
}
function rowWeakness(row = {}) {
  return weaknessScore(row);
}

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
    bucket.score += row.totalScore || 0;
    if (isNearHigh(row)) bucket.nearHigh += 1;
    if ((rs || 0) >= 80 || (row.totalScore || 0) >= 75) bucket.leaders += 1;
    if (!bucket.top || (row.totalScore || 0) > (bucket.top.totalScore || 0)) bucket.top = row;
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
    .filter((row) => (rowRs(row) || 0) >= 80 || (row.totalScore || 0) >= 75 || (isStage2Like(row) && isNearHigh(row)))
    .sort((a, b) => ((rowRs(b) || 0) - (rowRs(a) || 0)) || ((b.totalScore || 0) - (a.totalScore || 0)))
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(path, { signal: controller.signal });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${path} no respondió en ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const CORE_COVERAGE_PATH = "/api/coverage?markets=US,JP,HK,AU,TW";
const FULL_COVERAGE_PATH = "/api/coverage?markets=US,EU1,JP,HK,AU,TW";
const METHODOLOGY_HEALTH_PATH = "/api/methodology-health";

function NewsSentimentIndex({ news, title = "News sentiment tape", sampleLabel = "titulares", scoreLabel = "Score medio titulares" }) {
  const total = news?.total || 0;
  const bearishPct = safePct(news?.bearishPct);
  const neutralPct = safePct(news?.neutralPct);
  const bullishPct = safePct(news?.bullishPct);
  const pessimism = safePct(news?.pessimismIndex, 50);
  const optimism = safePct(news?.optimismIndex, 50);
  const spread = Number.isFinite(news?.sentimentSpread) ? news.sentimentSpread : 0;
  const dominant = news?.dominantSentiment || "neutral";
  const markerLeft = `${pessimism}%`;

  return <div className="newsMoodPanel" style={{
    background: "linear-gradient(180deg, #0d0d11 0%, #060608 100%)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "10px",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
    padding: "20px",
    marginBottom: "16px"
  }}>
    <div className="newsMoodTop" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "14px", alignItems: "center" }}>
      <div>
        <span className="eyebrow" style={{ display: "block", color: "var(--muted)", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.1em" }}>{title}</span>
        <h3 style={{ margin: "6px 0 4px 0", color: "#ffffff", fontSize: "24px", fontWeight: "700" }}>{news?.regime || "Sin regimen de titulares"}</h3>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "12px" }}>{total ? `${total} ${sampleLabel} · dominante: ${dominant}.` : `Sin muestra suficiente.`}</p>
      </div>
      <div className="moodDial" style={{
        width: "96px",
        height: "96px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        background: `radial-gradient(circle at center, #060608 0% 57%, transparent 58%), conic-gradient(from -90deg, #ef4444 0% ${pessimism}%, rgba(255, 255, 255, 0.08) ${pessimism}% 100%)`,
        boxShadow: "0 0 15px rgba(239, 68, 68, 0.08)",
        flexShrink: 0
      }}>
        <b style={{ fontSize: "26px", color: "#ebebf2", fontFamily: "'JetBrains Mono', monospace" }}>{num(pessimism)}</b>
        <span style={{ fontSize: "9px", color: "rgba(235, 235, 242, 0.4)", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "2px" }}>pesimismo</span>
      </div>
    </div>

    <div className="sentimentBars" style={{
      display: "flex",
      height: "16px",
      margin: "18px 0 12px",
      overflow: "hidden",
      border: "1px solid rgba(255, 255, 255, 0.06)",
      borderRadius: "6px",
      background: "#09090b",
      boxShadow: "inset 0 1px 3px rgba(0,0,0,0.6)"
    }} aria-label="Distribucion de titulares por sentimiento">
      <span className="bearish" style={{ width: `${bearishPct}%`, background: "linear-gradient(90deg, #ef4444, #f87171)", transition: "width 0.4s ease" }} />
      <span className="neutral" style={{ width: `${neutralPct}%`, background: "linear-gradient(90deg, #4b5563, #9ca3af)", transition: "width 0.4s ease" }} />
      <span className="bullish" style={{ width: `${bullishPct}%`, background: "linear-gradient(90deg, #10b981, #34d399)", transition: "width 0.4s ease" }} />
    </div>

    <div className="sentimentLegend" style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", color: "var(--soft)", fontSize: "12px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><i className="bearish" style={{ width: "9px", height: "9px", borderRadius: "2px", background: "#ef4444" }} /> Bajistas <b style={{ color: "#ffffff" }}>{pctShare(bearishPct)}</b></span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><i className="neutral" style={{ width: "9px", height: "9px", borderRadius: "2px", background: "#6b7280" }} /> Neutrales <b style={{ color: "#ffffff" }}>{pctShare(neutralPct)}</b></span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><i className="bullish" style={{ width: "9px", height: "9px", borderRadius: "2px", background: "#10b981" }} /> Alcistas <b style={{ color: "#ffffff" }}>{pctShare(bullishPct)}</b></span>
    </div>

    <div className="contrarianGauge" style={{ marginTop: "18px" }}>
      <div className="gaugeTrack" style={{
        position: "relative",
        height: "8px",
        borderRadius: "999px",
        background: "linear-gradient(90deg, #10b981 0%, #4b5563 50%, #ef4444 100%)",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)"
      }}>
        <i style={{
          position: "absolute",
          top: "50%",
          left: markerLeft,
          width: "16px",
          height: "16px",
          border: "2px solid #09090b",
          borderRadius: "50%",
          background: "#ffffff",
          transform: "translate(-50%, -50%)",
          boxShadow: "0 0 8px rgba(255,255,255,0.8), 0 2px 4px rgba(0,0,0,0.5)",
          transition: "left 0.4s ease"
        }} />
      </div>
      <div className="gaugeLabels" style={{ display: "flex", justifyContent: "space-between", marginTop: "7px", color: "var(--muted)", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        <span>Euforia</span>
        <span>Neutral</span>
        <span>Pesimismo</span>
      </div>
    </div>

    <div className="moodMetrics" style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: "1px",
      marginTop: "18px",
      borderRadius: "6px",
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(255,255,255,0.02)"
    }}>
      <span style={{ display: "flex", flexDirection: "column", padding: "12px", background: "#0d0d11", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
        <b style={{ fontSize: "20px", color: "#ebebf2", fontFamily: "'JetBrains Mono', monospace" }}>{num(optimism)}</b>
        <small style={{ fontSize: "10px", color: "rgba(235,235,242,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "4px" }}>Índice optimismo</small>
      </span>
      <span style={{ display: "flex", flexDirection: "column", padding: "12px", background: "#0d0d11", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
        <b style={{ fontSize: "20px", color: "#ebebf2", fontFamily: "'JetBrains Mono', monospace" }}>{pctShare(Math.abs(spread))}</b>
        <small style={{ fontSize: "10px", color: "rgba(235,235,242,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "4px" }}>{spread >= 0 ? "Ventaja alcista" : "Ventaja bajista"}</small>
      </span>
      <span style={{ display: "flex", flexDirection: "column", padding: "12px", background: "#0d0d11" }}>
        <b style={{ fontSize: "20px", color: "#ebebf2", fontFamily: "'JetBrains Mono', monospace" }}>{Number.isFinite(news?.avgScore) ? news.avgScore.toFixed(1) : "-"}</b>
        <small style={{ fontSize: "10px", color: "rgba(235,235,242,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "4px" }}>{scoreLabel}</small>
      </span>
    </div>
  </div>;
}

function GlobalRegionsPanel({ rows = [] }) {
  const REGIONS = [
    {
      key: "US",
      name: "Estados Unidos",
      flag: "🇺🇸",
      benchmark: "S&P 500 (SPY)",
      countries: ["US"],
    },
    {
      key: "EU",
      name: "Europa",
      flag: "🇪🇺",
      benchmark: "Euro Stoxx 50 (FEZ)",
      countries: ["ES", "DE", "FR", "NL", "CH", "SE", "IT", "BE", "PT", "AT", "IE", "GB"],
    },
    {
      key: "AS",
      name: "Asia / Pacífico",
      flag: "🇯🇵",
      benchmark: "Nikkei 225 (TSE)",
      countries: ["JP", "HK", "SG", "TW", "KR", "CN", "AU"],
    },
    {
      key: "Global",
      name: "Global / Emergentes",
      flag: "🌐",
      benchmark: "MSCI ACWI (ACWI)",
      countries: [],
    }
  ];

  const regionCards = REGIONS.map((region) => {
    let filtered = [];
    if (region.key === "Global") {
      const otherCountries = new Set([
        ...REGIONS[0].countries,
        ...REGIONS[1].countries,
        ...REGIONS[2].countries
      ]);
      filtered = rows.filter((r) => {
        const code = r.country || "US";
        return !otherCountries.has(code);
      });
    } else {
      filtered = rows.filter((r) => region.countries.includes(r.country || "US"));
    }

    const total = filtered.length;
    const above50 = filtered.filter((r) => (r.extSma50 ?? 0) >= 0).length;
    const amplitudePct = total ? (above50 / total) * 100 : 0;
    const validRs = filtered.map((r) => rowRsPrimary(r)).filter(Number.isFinite);
    const avgRs = validRs.length ? validRs.reduce((s, v) => s + v, 0) / validRs.length : 50;

    const leaders = [...filtered]
      .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
      .slice(0, 3);

    let rsLabel = "Neutral";
    let rsClass = "neutral";
    if (avgRs >= 80) {
      rsLabel = "Fuerte";
      rsClass = "bullish";
    } else if (avgRs <= 45) {
      rsLabel = "Débil";
      rsClass = "bearish";
    }

    return (
      <div className="card regionCard" key={region.key} style={{
        background: "linear-gradient(180deg, #0e0e12 0%, #060609 100%)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        borderRadius: "10px",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.02)",
        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        padding: "20px",
        position: "relative",
        overflow: "hidden"
      }}>
        <div className="regionCardHead" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div className="regionTitleWrap" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="regionFlag" style={{ fontSize: "24px" }}>{region.flag}</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: "#ebebf2" }}>{region.name}</h3>
              <span className="fine muted" style={{ fontSize: "11px", color: "rgba(235, 235, 242, 0.45)" }}>{region.benchmark}</span>
            </div>
          </div>
          <span className={`sentimentPill ${rsClass}`} style={{ fontSize: "11px", padding: "2px 8px" }}>{rsLabel}</span>
        </div>

        <div className="regionMetricsGrid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "14px", marginBottom: "14px" }}>
          <div className="regionMetric" style={{ display: "flex", flexDirection: "column" }}>
            <b style={{ fontSize: "18px", color: "#ebebf2", fontFamily: "'JetBrains Mono', monospace" }}>{pct(amplitudePct)}</b>
            <span style={{ fontSize: "10px", color: "rgba(235,235,242,0.45)" }}>Amplitud (SMA50)</span>
          </div>
          <div className="regionMetric" style={{ display: "flex", flexDirection: "column" }}>
            <b style={{ fontSize: "18px", color: "#ebebf2", fontFamily: "'JetBrains Mono', monospace" }}>{avgRs.toFixed(0)}</b>
            <span style={{ fontSize: "10px", color: "rgba(235,235,242,0.45)" }}>RS Promedio</span>
          </div>
          <div className="regionMetric" style={{ display: "flex", flexDirection: "column" }}>
            <b style={{ fontSize: "18px", color: "#ebebf2", fontFamily: "'JetBrains Mono', monospace" }}>{total}</b>
            <span style={{ fontSize: "10px", color: "rgba(235,235,242,0.45)" }}>En snapshot</span>
          </div>
        </div>

        <div className="regionLeadersSection">
          <span className="eyebrow" style={{ display: "block", fontSize: "10px", fontWeight: "600", textTransform: "uppercase", color: "rgba(235,235,242,0.35)", letterSpacing: "0.05em", marginBottom: "8px" }}>Líderes de Mercado</span>
          <div className="regionLeadersList" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {leaders.map((leader) => (
              <a className="regionLeaderRow" href={stockUrl(leader.symbol)} key={leader.symbol} style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 10px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
                borderRadius: "6px",
                textDecoration: "none",
                transition: "all 0.2s ease",
                cursor: "pointer"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(37, 99, 235, 0.08)";
                e.currentTarget.style.borderColor = "rgba(37, 99, 235, 0.25)";
                e.currentTarget.style.transform = "translateX(2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)";
                e.currentTarget.style.transform = "none";
              }}
              >
                <span className="leaderTickerWrap" style={{ display: "flex", flexDirection: "column", gap: "2px", maxWidth: "60%" }}>
                  <b className="tickerLink" style={{ fontSize: "13px", color: "#2563eb" }}>{leader.symbol}</b>
                  <small className="muted textTruncate" style={{ fontSize: "11px", color: "rgba(235, 235, 242, 0.45)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{leader.companyName || leader.symbol}</small>
                </span>
                <span className="leaderScoresWrap" style={{ display: "flex", gap: "10px" }}>
                  <span className="leaderScore" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <small style={{ fontSize: "9px", color: "rgba(235,235,242,0.3)" }}>Comp</small>
                    <b style={{ fontSize: "12px", color: "#ebebf2", fontFamily: "'JetBrains Mono', monospace" }}>{leader.totalScore?.toFixed(0) || "-"}</b>
                  </span>
                  <span className="leaderScore" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <small style={{ fontSize: "9px", color: "rgba(235,235,242,0.3)" }}>RS</small>
                    <b style={{ fontSize: "12px", color: "#ebebf2", fontFamily: "'JetBrains Mono', monospace" }}>{rowRsPrimary(leader)?.toFixed(0) || "-"}</b>
                  </span>
                </span>
              </a>
            ))}
            {!leaders.length && (
              <p className="fine muted" style={{ textAlign: "center", padding: "8px 0", fontSize: "11px", color: "rgba(235,235,242,0.35)" }}>
                Sin activos analizados en esta geografía.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  });

  return (
    <div className="grid grid2 globalRegionsGrid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
      {regionCards}
    </div>
  );
}

function readinessWeight(row = {}) {
  const state = row.readiness?.state || "";
  if (state === "official_source_missing") return 0;
  if (state === "coverage_gap") return 1;
  if (state === "inventory_not_materialized") return 2;
  if (state === "partial_provider" || state === "curated_core") return 3;
  return 4;
}

function readinessClass(tone = "") {
  if (tone === "pass") return "pass";
  if (tone === "warn") return "warn";
  return "neutral";
}

function CoverageReadinessPanel({ coverage, loading = false }) {
  const rows = Array.isArray(coverage?.markets) ? coverage.markets : [];
  const visibleRows = [...rows]
    .sort((a, b) => readinessWeight(a) - readinessWeight(b) || a.priority - b.priority || b.gap - a.gap)
    .slice(0, 4);
  const hiddenRows = Math.max(0, rows.length - visibleRows.length);
  const issueCount = rows.filter((row) => row.readiness?.blocksCoverageClaim).length;
  const operational = rows.filter((row) => row.readiness?.operational).length;
  const summary = coverage?.summary || {};
  const rankingCoveragePct = summary.rankingEligibleCoveragePct ?? summary.actionableCoveragePct;
  const hasError = Boolean(coverage?.error);

  return <section className="card coverageReadinessPanel">
    <div className="sectionTitle">
      <div>
        <h2>Fiabilidad de cobertura</h2>
        <p className="fine">Inventario, fuente y materialización; cobertura de ranking no equivale a setup ni plan válido.</p>
      </div>
      <span className={`coverageReadinessStatus ${hasError || issueCount ? "warn" : "pass"}`}>
        {loading && !coverage ? "Cargando" : hasError ? "Sin dato" : issueCount ? `${issueCount} avisos` : "Operativo"}
      </span>
    </div>

    {coverage?.error ? <div className="dataNote error">{coverage.error}</div> : <>
      <div className="coverageReadinessKpis">
        <div><b>{num(summary.inventoryCandidates)}</b><span>Inventario</span></div>
        <div><b>{pctShare(summary.inventoryCoveragePct)}</b><span>Cobertura inventario</span></div>
        <div><b>{num(summary.scannedSymbols)}</b><span>Escaneados frescos</span></div>
        <div><b>{pctShare(rankingCoveragePct)}</b><span>Cobertura ranking</span></div>
        <div><b>{operational}/{rows.length || "-"}</b><span>Mercados operativos</span></div>
      </div>

      {loading && <p className="fine coverageReadinessLoading">Actualizando lectura de cobertura...</p>}

      <div className="coverageReadinessGrid">
        {visibleRows.map((row) => {
          const readiness = row.readiness || {};
          const provider = readiness.providerStatus || {};
          const providerBadge = provider.status === "not_configured"
            ? "no configurado"
            : ["error", "degraded"].includes(provider.status)
              ? provider.retryBlocked ? "fallo cacheado" : "degradado"
              : "";
          const sourceLine = [readiness.sourceClaim || row.activeSource, providerBadge].filter(Boolean).join(" · ");
          return <div className={`coverageReadinessItem ${readinessClass(readiness.tone)}`} key={row.market}>
            <div className="coverageReadinessHead">
              <b>{row.market}</b>
              <span>{readiness.label || row.grade}</span>
            </div>
            <p>{readiness.detail || row.nextAction}</p>
            <div className="coverageReadinessMeta">
              <span><b>{num(row.inventory?.candidates)}</b><small>inventario</small></span>
              <span><b>{num(row.scan?.fresh)}</b><small>fresco</small></span>
              <span><b>{num(row.scan?.rankingEligible ?? row.scan?.actionable)}</b><small>ranking</small></span>
              <span><b>{pctShare(readiness.activationPct)}</b><small>activación</small></span>
            </div>
            <em>{sourceLine}</em>
          </div>;
        })}
      </div>
      {hiddenRows > 0 && <p className="fine coverageReadinessLoading">Mostrando los {visibleRows.length} mercados más prioritarios; {hiddenRows} adicionales quedan resumidos en los KPIs.</p>}
    </>}
  </section>;
}

function methodologyStatusClass(status = "") {
  if (status === "pass") return "pass";
  if (status === "missing" || status === "warn" || status === "fail" || status === "error") return "warn";
  return "neutral";
}

function MethodologyHealthPanel({ health, loading = false }) {
  const totals = health?.totals || {};
  const calibration = health?.calibration || {};
  const buckets = calibration.buckets || {};
  const statusClass = methodologyStatusClass(health?.status);
  const bucketRows = [
    { key: "block", label: "Bloqueado", value: buckets.block, tone: "neutral", detail: "No reclama setup ni vigilancia cuando la estructura no pasa filtros." },
    { key: "observe", label: "Observable", value: buckets.observe, tone: "neutral", detail: "Base medible, pero fuera de zona o sin suficiente confirmación." },
    { key: "watch", label: "Vigilancia", value: buckets.watch, tone: "pass", detail: "Candidatas para mirar, todavía sin plan automático." },
    { key: "plan", label: "Plan válido", value: buckets.plan, tone: buckets.plan > 0 ? "warn" : "pass", detail: "Debe permanecer en 0 hasta que la detección sea realmente fiable." },
  ];

  return <section className="card coverageReadinessPanel methodologyHealthPanel">
    <div className="sectionTitle">
      <div>
        <h2>Fiabilidad metodológica</h2>
        <p className="fine">Regresión de VCP, buckets block/observe/watch/plan y bloqueo de plan válido.</p>
      </div>
      <span className={`coverageReadinessStatus ${statusClass}`}>
        {loading && !health ? "Cargando" : health?.label || "Sin dato"}
      </span>
    </div>

    {health?.error ? <div className="dataNote error">{health.error}</div> : <>
      <div className="coverageReadinessKpis">
        <div><b>{Number.isFinite(totals.passed) && Number.isFinite(totals.cases) ? `${totals.passed}/${totals.cases}` : "-"}</b><span>Casos validados</span></div>
        <div><b>{num(totals.failed)}</b><span>Fallos</span></div>
        <div><b>{num(calibration.mismatches)}</b><span>Desajustes bucket</span></div>
        <div><b>{num(buckets.plan)}</b><span>Planes automáticos</span></div>
        <div><b>{calibration.guardrailsOk ? "OK" : "Revisar"}</b><span>Guardrails</span></div>
      </div>

      {loading && <p className="fine coverageReadinessLoading">Actualizando lectura metodologica...</p>}
      {health?.detail && <p className="fine methodologyHealthNote">{health.detail}</p>}

      <div className="coverageReadinessGrid methodologyBucketGrid">
        {bucketRows.map((row) => <div className={`coverageReadinessItem ${row.tone}`} key={row.key}>
          <div className="coverageReadinessHead">
            <b>{row.label}</b>
            <span>{num(row.value)}</span>
          </div>
          <p>{row.detail}</p>
        </div>)}
      </div>
    </>}
  </section>;
}


function colorClass(color) {
  if (color === "green") return "btnActive";
  if (color === "lime") return "btnActive";
  if (color === "amber") return "btnGhost";
  if (color === "red") return "error";
  return "btnGhost";
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
        .then((full) => setCoverage({ ...full, scope: "full" }))
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

  return <main className="page marketHealthPage">
    <section className="marketHealthHeader">
      <div>
        <span className="eyebrow">StageRadar · Market Health</span>
        <h1>Salud de mercado</h1>
        <p>Índices, sectores, titulares y liderazgo del último snapshot.</p>
      </div>
      <div className="marketHealthActions">
        <a className="btn" href="/">Screener</a>
        <button className="btn btnPrimary" onClick={refreshAll} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</button>
      </div>
    </section>

    {error && <section className="card error">{error}</section>}
    {loading && !data && <section className="card">
      <div className="sectionTitle"><h2>Cargando salud de mercado</h2><span className="fine">Índices, sectores y titulares</span></div>
      <p className="fine">Actualizando lectura de mercado...</p>
    </section>}

    {!data && (coverage || methodologyHealth || coverageLoading || methodologyLoading) && <section className="marketHealthReliabilityGrid" aria-label="Fiabilidad de datos y metodología">
      <CoverageReadinessPanel coverage={coverage} loading={coverageLoading} />
      <MethodologyHealthPanel health={methodologyHealth} loading={methodologyLoading} />
    </section>}

    {data && <>
      <section className={`marketRegimePanel ${colorClass(data.regime?.color)}`} style={{
        background: "linear-gradient(135deg, #0a0a0d 0%, #121217 100%)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderLeft: `4px solid ${
          data.regime?.color === "green" || data.regime?.color === "lime"
            ? "#10b981"
            : data.regime?.color === "amber"
              ? "#f59e0b"
              : data.regime?.color === "red"
                ? "#ef4444"
                : "#2563eb"
        }`,
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255,255,255,0.05)",
        display: "grid",
        gridTemplateColumns: "minmax(280px, .82fr) minmax(0, 1.18fr)",
        gap: "1px",
        overflow: "hidden",
        borderRadius: "12px",
        position: "relative",
        marginBottom: "20px"
      }}>
        <div className="regimeLead" style={{
          display: "flex",
          alignItems: "center",
          gap: "24px",
          padding: "24px 20px",
          background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.005))"
        }}>
          <div className="speedometer" style={{ width: "120px", height: "70px", position: "relative", flexShrink: 0 }}>
            <svg viewBox="0 0 180 110" style={{ width: "100%", height: "100%" }}>
              <defs>
                <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="50%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>
              <path d="M 20,90 A 70,70 0 0,1 160,90" fill="none" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="12" strokeLinecap="round" />
              <path d="M 20,90 A 70,70 0 0,1 160,90" fill="none" stroke="url(#gaugeGradient)" strokeWidth="12" strokeLinecap="round" strokeDasharray="220" strokeDashoffset={220 - (Math.min(100, Math.max(0, data.marketScore ?? 50)) / 100) * 220} />
              <g transform={`translate(90, 90) rotate(${(Math.min(100, Math.max(0, data.marketScore ?? 50)) / 100) * 180 - 90})`}>
                <line x1="0" y1="0" x2="0" y2="-70" stroke="#2563eb" strokeWidth="5" strokeLinecap="round" filter="drop-shadow(0 0 4px rgba(37,99,235,0.6))" />
                <circle cx="0" cy="0" r="8" fill="#ebebf2" />
                <circle cx="0" cy="0" r="4" fill="#09090b" />
              </g>
              <text x="90" y="105" textAnchor="middle" fill="#ebebf2" fontSize="16" fontWeight="bold" fontFamily="'JetBrains Mono', monospace">{(data.marketScore ?? 50).toFixed(0)}</text>
            </svg>
          </div>
          <div>
            <span style={{
              display: "block",
              color: "var(--muted)",
              fontSize: "10px",
              fontWeight: "900",
              letterSpacing: "0.13em",
              textTransform: "uppercase"
            }}>Régimen</span>
            <strong style={{
              display: "block",
              marginTop: "4px",
              color: "#ffffff",
              fontSize: "26px",
              fontWeight: "800",
              lineHeight: "1.1",
              letterSpacing: "-0.02em"
            }}>{data.regime?.label || "-"}</strong>
            <p style={{
              margin: "6px 0 0 0",
              color: "var(--soft)",
              fontSize: "13px",
              lineHeight: "1.45"
            }}>{data.regime?.stance}</p>
          </div>
        </div>
        <div className="regimeMetrics" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "1px", background: "rgba(255,255,255,0.06)" }}>
          <span style={{
            minHeight: "112px",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.005))"
          }}>
            <b style={{ color: "#ffffff", fontSize: "32px", fontWeight: "800", letterSpacing: "-0.03em", fontFamily: "'JetBrains Mono', monospace" }}>{num(data.marketScore)}</b>
            <small style={{ display: "block", color: "var(--muted)", fontSize: "10px", fontWeight: "900", letterSpacing: "0.13em", textTransform: "uppercase", marginTop: "2px" }}>Market score</small>
            <div style={{ height: "4px", width: "100%", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden", marginTop: "8px" }}>
              <div style={{ width: `${Math.min(100, Math.max(0, data.marketScore ?? 0))}%`, height: "100%", background: "linear-gradient(90deg, #ef4444, #10b981)", borderRadius: "2px" }} />
            </div>
          </span>
          <span style={{
            minHeight: "112px",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.005))"
          }}>
            <b style={{ color: "#ffffff", fontSize: "32px", fontWeight: "800", letterSpacing: "-0.03em", fontFamily: "'JetBrains Mono', monospace" }}>{pct(data.breadthProxy?.pctAbove50)}</b>
            <small style={{ display: "block", color: "var(--muted)", fontSize: "10px", fontWeight: "900", letterSpacing: "0.13em", textTransform: "uppercase", marginTop: "2px" }}>SMA50</small>
            <div style={{ height: "4px", width: "100%", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden", marginTop: "8px" }}>
              <div style={{ width: `${data.breadthProxy?.pctAbove50 || 0}%`, height: "100%", background: "#2563eb", borderRadius: "2px" }} />
            </div>
          </span>
          <span style={{
            minHeight: "112px",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.005))"
          }}>
            <b style={{ color: "#ffffff", fontSize: "32px", fontWeight: "800", letterSpacing: "-0.03em", fontFamily: "'JetBrains Mono', monospace" }}>{pct(data.breadthProxy?.pctAbove200)}</b>
            <small style={{ display: "block", color: "var(--muted)", fontSize: "10px", fontWeight: "900", letterSpacing: "0.13em", textTransform: "uppercase", marginTop: "2px" }}>SMA200</small>
            <div style={{ height: "4px", width: "100%", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden", marginTop: "8px" }}>
              <div style={{ width: `${data.breadthProxy?.pctAbove200 || 0}%`, height: "100%", background: "#10b981", borderRadius: "2px" }} />
            </div>
          </span>
          <span style={{
            minHeight: "112px",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.005))"
          }}>
            <b style={{ color: "#ffffff", fontSize: "32px", fontWeight: "800", letterSpacing: "-0.03em", fontFamily: "'JetBrains Mono', monospace" }}>{data.breadthProxy?.indexes ?? "-"}</b>
            <small style={{ display: "block", color: "var(--muted)", fontSize: "10px", fontWeight: "900", letterSpacing: "0.13em", textTransform: "uppercase", marginTop: "2px" }}>Índices</small>
            <div style={{ height: "4px", width: "100%", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden", marginTop: "8px" }}>
              <div style={{ width: "100%", height: "100%", background: "#a855f7", borderRadius: "2px" }} />
            </div>
          </span>
        </div>
      </section>

      {(coverage || methodologyHealth || coverageLoading || methodologyLoading) && <section className="marketHealthReliabilityGrid" aria-label="Fiabilidad de datos y metodología">
        <CoverageReadinessPanel coverage={coverage} loading={coverageLoading} />
        <MethodologyHealthPanel health={methodologyHealth} loading={methodologyLoading} />
      </section>}

      {data.weinsteinTape && <section className="card marketTapeCard">
        <div className="sectionTitle">
          <h2>Weinstein tape</h2>
          <span className="fine">MM30 semanas · amplitud · volumen</span>
        </div>
        <div className="kpis">
          <div className="kpi"><b>{data.weinsteinTape.label || "-"}</b><span>Lectura interna</span></div>
          <div className="kpi"><b>{data.weinsteinTape.indexesAbove30w}/{data.weinsteinTape.indexesTotal}</b><span>Índices sobre MM30s</span></div>
          <div className="kpi"><b>{pctShare(data.weinsteinTape.pctSectorsAbove30w)}</b><span>Sectores sobre MM30s</span></div>
          <div className="kpi"><b>{pctShare(data.weinsteinTape.pctSectorsStage2)}</b><span>Sectores Etapa 2</span></div>
          <div className="kpi"><b>{pctShare(data.weinsteinTape.pctSectorsStage4)}</b><span>Sectores Etapa 4</span></div>
          <div className="kpi"><b>{Number.isFinite(data.weinsteinTape.distributionDays20Avg) ? `${data.weinsteinTape.distributionDays20Avg.toFixed(1)} / ${data.weinsteinTape.accumulationDays20Avg?.toFixed(1) ?? "-"}` : "-"}</b><span>Distribución / acumulación 20d</span></div>
        </div>
        <div className="grid grid2" style={{ marginTop: 12 }}>
          <div className="evidencePanel">
            <h3>Sectores con confirmación</h3>
            {data.weinsteinTape.leadingSectors?.map((sector) => <div className="evidenceRow" key={sector.symbol}>
              <span><b>{sector.name}</b><small>{sector.symbol}</small></span>
              <span><b>{num(sector.score)}</b><small>W tape</small></span>
              <span><b>{pct(sector.rs1m)}</b><small>RS 1M vs SPY</small></span>
            </div>)}
            {!data.weinsteinTape.leadingSectors?.length && <p className="fine" style={{ padding: 12 }}>Sin sectores con confirmación suficiente.</p>}
          </div>
          <div className="evidencePanel">
            <h3>Divergencias y presión</h3>
            {data.weinsteinTape.divergences?.map((item) => <div className="evidenceRow" key={item}>
              <span><b>{item}</b><small>Lectura interna</small></span>
              <span><b>-</b><small>dato</small></span>
              <span><b>Contexto</b><small>interno</small></span>
            </div>)}
            {!data.weinsteinTape.divergences?.length && <p className="fine" style={{ padding: 12 }}>Sin divergencias internas relevantes en esta muestra.</p>}
          </div>
        </div>
        <div className="sectorPulse">
          <div><b>Sensores seleccionados</b><span>{listText(data.weinsteinTape.indicators?.slice(0, 3))}</span></div>
          <div><b>Tipo de liderazgo</b><span>Ofensivo Etapa 2: {data.weinsteinTape.offensiveStage2 ?? "-"} · Defensivo Etapa 2: {data.weinsteinTape.defensiveStage2 ?? "-"}</span></div>
        </div>
      </section>}

      <section className="card">
        <div className="sectionTitle">
          <h2>Liderazgo y Fuerza Relativa Global</h2>
          <span className="fine">Desglose de amplitud y líderes por regiones principales</span>
        </div>
        <GlobalRegionsPanel rows={scanPulse?.rows || []} />
      </section>

      <section className="card">
        <div className="sectionTitle"><h2>Leadership pulse</h2><span className="fine">{scanPulse ? `Último snapshot · ${dateFmt(scanPulse.createdAt)} · ${scanPulse.marketRegime}` : "Sin snapshot local"}</span></div>
        {scanPulse ? <>
          <div className="kpis">
            <div className="kpi"><b>{scanPulse.count}</b><span>acciones snapshot</span></div>
            <div className="kpi"><b>{pctShare(scanPulse.rsLeaderPct)}</b><span>{metricShortLabel("rsGlobalPct")} &gt;= 80</span></div>
            <div className="kpi"><b>{pctShare(scanPulse.nearHighPct)}</b><span>cerca de máximos 52s</span></div>
            <div className="kpi"><b>{pctShare(scanPulse.pressurePct)}</b><span>deterioro 2+ evidencias</span></div>
          </div>
          <div className="grid grid2" style={{ marginTop: 12 }}>
            <div className="evidencePanel">
              <h3>Liderazgo observado</h3>
              {scanPulse.leaders.map((row) => {
                const rs = rowRsDisplay(row);
                return <a className="evidenceRow" href={stockUrl(row.symbol)} key={row.symbol}>
                  <span><b>{row.symbol}</b><small>{row.companyName || rowTheme(row) || "-"}</small></span>
                  <span><b>{Number.isFinite(rs) ? rs.toFixed(0) : "-"}</b><small>{rowRsDisplayLabel(row)}</small></span>
                  <span><b>{row.totalScore?.toFixed(0) || "-"}</b><small>{metricShortLabel("totalScore")}</small></span>
                </a>;
              })}
              {!scanPulse.leaders.length && <p className="fine">Sin liderazgo claro en el último snapshot.</p>}
            </div>
            <div className="evidencePanel">
              <h3>Deterioro a revisar</h3>
              {scanPulse.deterioration.map((row) => {
                const rs = rowRsDisplay(row);
                return <a className="evidenceRow" href={stockUrl(row.symbol)} key={row.symbol}>
                  <span><b>{row.symbol}</b><small>{row.companyName || rowTheme(row) || "-"}</small></span>
                  <span><b>{row.deteriorationReasons.length}</b><small>evidencias</small></span>
                  <span><b>{Number.isFinite(rs) ? rs.toFixed(0) : "-"}</b><small>{row.deteriorationReasons.slice(0, 2).join(", ")}</small></span>
                </a>;
              })}
              {!scanPulse.deterioration.length && <p className="fine">Sin deterioro técnico relevante en el último snapshot.</p>}
            </div>
          </div>
          <div className="sectorPulse">
            <div><b>Concentración por país</b><span>{scanPulse.countries.slice(0, 5).map((x) => `${x.name} ${x.leaders}/${x.count}`).join(" · ") || "-"}</span></div>
            <div><b>Concentración por tema</b><span>{scanPulse.themes.slice(0, 5).map((x) => `${x.name} ${x.leaders}/${x.count}`).join(" · ") || "-"}</span></div>
          </div>
        </> : <p className="fine">Guarda un snapshot desde el screener para que esta sección muestre liderazgo, concentración por país/tema y deterioro observado.</p>}
      </section>

      {!!data.sectorTape?.length && <section className="card">
        <div className="sectionTitle"><h2>Amplitud sectorial</h2><a className="btnSmall" href="/sectors">Ver sectores</a></div>
        <div className="kpis">
          <div className="kpi"><b>{num(data.sectorSummary?.avgScore)}</b><span>Score medio</span></div>
          <div className="kpi"><b>{data.sectorSummary?.above50 ?? "-"}/{data.sectorSummary?.count ?? "-"}</b><span>Sobre SMA50</span></div>
          <div className="kpi"><b>{data.sectorSummary?.best1m || "-"}</b><span>Mejor 1M</span></div>
          <div className="kpi"><b>{data.sectorSummary?.worst1m || "-"}</b><span>Peor 1M</span></div>
        </div>
        <div className="sectorPulse">
          <div><b>Líderes</b><span>{listText(data.sectorSummary?.leaders)}</span></div>
          <div><b>Débiles</b><span>{listText(data.sectorSummary?.laggards)}</span></div>
        </div>
        {data.sectorTapeNote && <span className="fine">Detalle operativo en Sectores.</span>}
      </section>}

      <section className="card">
        <div className="sectionTitle"><h2>Pulso de noticias <InfoHint text={`${news?.contrarianRead || "Sin lectura contraria disponible."} ${news?.note || "La métrica solo lee titulares recientes; confirmar con precio, medias y amplitud."}`} /></h2><span className="fine">fuentes recientes</span></div>
        {news?.error && <div className="dataNote error" style={{ marginBottom: 12 }}>{news.error}</div>}
        <NewsSentimentIndex news={news} />
        <div className="kpis">
          <div className="kpi"><b>{num(news?.pessimismIndex)}</b><span>Índice pesimismo</span></div>
          <div className="kpi"><b>{news?.regime || "-"}</b><span>Régimen titulares</span></div>
          <div className="kpi"><b>{news?.bearish ?? "-"} · {pctShare(news?.bearishPct)}</b><span>Titulares bajistas</span></div>
          <div className="kpi"><b>{news?.bullish ?? "-"} · {pctShare(news?.bullishPct)}</b><span>Titulares alcistas</span></div>
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle"><h2>Pulso social <InfoHint text={`${social?.contrarianRead || "Sin lectura social disponible."} ${social?.note || "Usa X API oficial cuando hay token disponible; sin token queda como panel preparado."}`} /></h2><span className="fine">{social?.provider || "X API v2 recent search"}</span></div>
        {social?.error && <div className="dataNote" style={{ marginBottom: 12 }}>{social.error}</div>}
        <NewsSentimentIndex news={social} title="X / social sentiment tape" sampleLabel="posts" scoreLabel="Score medio social" />
        <div className="kpis">
          <div className="kpi"><b>{num(social?.pessimismIndex)}</b><span>Índice pesimismo social</span></div>
          <div className="kpi"><b>{social?.regime || "-"}</b><span>Régimen social</span></div>
          <div className="kpi"><b>{social?.bearish ?? "-"} · {pctShare(social?.bearishPct)}</b><span>Posts bajistas</span></div>
          <div className="kpi"><b>{social?.bullish ?? "-"} · {pctShare(social?.bullishPct)}</b><span>Posts alcistas</span></div>
        </div>
        <div className="summaryRow"><span>Engagement total muestra</span><span>{num(social?.totalEngagement)}</span></div>
        <div className="summaryRow"><span>Query X</span><span className="summaryValue"><b>{social?.query || "Sin query"}</b></span></div>
      </section>

      {!!social?.rows?.length && <section className="card">
        <div className="sectionTitle"><h2>Posts sociales recientes</h2><span className="fine">{social.total} posts · score ponderado {Number.isFinite(social.weightedAvgScore) ? social.weightedAvgScore.toFixed(1) : "-"}</span></div>
        <div className="newsGrid">
          {social.rows.slice(0, 12).map((item) => <a className="newsItem newsTextOnly" key={item.id || `${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer">
            <span>
              <i className={`sentimentPill ${sentimentClass(item.sentimentLabel)}`}>{item.sentimentLabel}</i>
              <b>{item.title}</b>
              <em>{item.publisher || "X"} · {dateFmt(item.publishedAt)}</em>
              <small>{item.sentimentReasons?.length ? `${item.sentimentReasons.join(", ")} · engagement ${item.engagement || 0}` : `sin sesgo fuerte detectado · engagement ${item.engagement || 0}`}</small>
            </span>
          </a>)}
        </div>
      </section>}

      {!!news?.rows?.length && <section className="card">
        <div className="sectionTitle"><h2>Titulares de mercado</h2><span className="fine">{news.total} titulares · score medio {Number.isFinite(news.avgScore) ? news.avgScore.toFixed(1) : "-"}</span></div>
        <div className="newsGrid">
          {news.rows.slice(0, 12).map((item) => <a className="newsItem" key={`${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer">
            {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
            <span>
              <i className={`sentimentPill ${sentimentClass(item.sentimentLabel)}`}>{item.sentimentLabel}</i>
              <b>{item.title}</b>
              <em>{item.publisher || "Fuente"} · {dateFmt(item.publishedAt)}</em>
              <small>{item.sentimentReasons?.length ? item.sentimentReasons.join(", ") : "sin sesgo fuerte detectado"}</small>
            </span>
          </a>)}
        </div>
      </section>}

      <section className="grid grid2">
        <div className="card">
          <h2>Amplitud aproximada</h2>
          <div className="summaryRow"><span>Índices analizados</span><span>{data.breadthProxy?.indexes}</span></div>
          <div className="summaryRow"><span>Sobre SMA50</span><span>{data.breadthProxy?.above50}</span></div>
          <div className="summaryRow"><span>Sobre SMA200</span><span>{data.breadthProxy?.above200}</span></div>
          <div className="summaryRow"><span>Sobre MM30 semanas</span><span>{data.breadthProxy?.above30w ?? "-"}</span></div>
          <div className="summaryRow"><span>SMA200 subiendo</span><span>{data.breadthProxy?.positiveSma200Slope}</span></div>
          <div className="summaryRow"><span>Cerca de máximo 52s</span><span>{data.breadthProxy?.near52wHigh}</span></div>
        </div>
        <div className="card">
          <h2>Método <InfoHint text="La lectura de régimen combina índices sobre medias largas, pendiente de SMA200, momentum, amplitud aproximada y concentración de liderazgo. La página muestra evidencias, no instrucciones operativas." /></h2>
          <div className="summaryRow"><span>Base</span><span>Medias / amplitud / liderazgo</span></div>
          <div className="summaryRow"><span>Confirmacion</span><span>Precio y snapshot</span></div>
        </div>
      </section>

      <section className="card">
        <h2>Índices principales</h2>
        <div className="tableWrap">
          <table className="table">
            <thead><tr>{["Índice", "Etapa", "Etapa 30s", "Score", "W Tape", "1M", "3M", "6M", "52w", "Desde mínimo 52w", "MM30s", "SMA200 slope", "Dist/Acc", "Fecha"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{data.indexes?.map((x) => <tr key={x.symbol}>
              <td><b>{x.name}</b><br /><span className="fine">{x.symbol}</span></td>
              <td>{x.stage}</td>
              <td>{x.stage30w || "-"}</td>
              <td className="ticker">{num(x.score)}</td>
              <td className="ticker">{num(x.weinsteinScore)}</td>
              <td>{pct(x.perf1m)}</td>
              <td>{pct(x.perf3m)}</td>
              <td>{pct(x.perf6m)}</td>
              <td>{pct(x.distance52w)}</td>
              <td>{pct(x.advanceFrom52wLow)}</td>
              <td>{pct(x.distanceSma30w)}</td>
              <td>{pct(x.sma200Slope)}</td>
              <td>{Number.isFinite(x.distributionDays20) ? `${x.distributionDays20}/${x.accumulationDays20}` : "-"}</td>
              <td>{x.lastDate}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      {data.failures?.length > 0 && <section className="card">
        <h2>Fallos de datos</h2>
        {data.failures.map((f) => <div className="summaryRow" key={f.symbol}><span>{f.symbol} · {f.name}</span><span>{f.reason}</span></div>)}
      </section>}
    </>}
  </main>;
}
