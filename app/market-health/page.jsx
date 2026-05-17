"use client";
import { useEffect, useState } from "react";
import { num, pct, pctShare } from "@/lib/formatters";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
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
    <span>i</span>
    <em>{text}</em>
  </span>;
}

function safePct(value, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function rowRs(row = {}) {
  return Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : Number.isFinite(row.rsRating) ? row.rsRating : null;
}
function rowWeakness(row = {}) {
  if (Number.isFinite(row.weaknessScore)) return row.weaknessScore;
  let score = 0;
  const rs = rowRs(row) ?? 50;
  if (rs < 45) score += 16;
  if (Number.isFinite(row.distance52w) && row.distance52w < -30) score += 14;
  if (Number.isFinite(row.perf3m) && row.perf3m < 0) score += 12;
  if (Number.isFinite(row.extSma50) && row.extSma50 < -8) score += 10;
  if ((row.riskScore ?? 50) < 35) score += 10;
  return Math.max(0, Math.min(100, score));
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
  if (Number.isFinite(row.rsGlobalPct) && row.rsGlobalPct < 40) reasons.push("RS global débil");
  else if (!Number.isFinite(row.rsGlobalPct) && Number.isFinite(row.rsRating) && row.rsRating < 45) reasons.push("RS bajo");
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
    .sort((a, b) => ((b.rsGlobalPct || b.rsRating || 0) - (a.rsGlobalPct || a.rsRating || 0)) || ((b.totalScore || 0) - (a.totalScore || 0)))
    .slice(0, 8);
  const deterioration = rows
    .map((row) => ({ ...row, deteriorationReasons: deteriorationReasons(row) }))
    .filter((row) => row.deteriorationReasons.length)
    .sort((a, b) => (b.deteriorationReasons.length - a.deteriorationReasons.length) || ((a.rsGlobalPct || a.rsRating || 50) - (b.rsGlobalPct || b.rsRating || 50)))
    .slice(0, 8);
  const nearHigh = rows.filter(isNearHigh).length;
  const stage2 = rows.filter(isStage2Like).length;
  const rsLeader = rows.filter((row) => (rowRs(row) || 0) >= 80).length;
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
    themes: summarizeGroups(rows, (row) => row.theme || row.sector),
  };
}

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

  return <div className="newsMoodPanel">
    <div className="newsMoodTop">
      <div>
        <span className="eyebrow">{title}</span>
        <h3>{news?.regime || "Sin regimen de titulares"}</h3>
        <p>{total ? `${total} ${sampleLabel} · dominante: ${dominant}.` : `Sin muestra suficiente.`}</p>
      </div>
      <div className="moodDial" style={{ "--mood": pessimism }}>
        <b>{num(pessimism)}</b>
        <span>pesimismo</span>
      </div>
    </div>

    <div className="sentimentBars" aria-label="Distribucion de titulares por sentimiento">
      <span className="bearish" style={{ width: `${bearishPct}%` }} />
      <span className="neutral" style={{ width: `${neutralPct}%` }} />
      <span className="bullish" style={{ width: `${bullishPct}%` }} />
    </div>

    <div className="sentimentLegend">
      <span><i className="bearish" /> Bajistas <b>{pctShare(bearishPct)}</b></span>
      <span><i className="neutral" /> Neutrales <b>{pctShare(neutralPct)}</b></span>
      <span><i className="bullish" /> Alcistas <b>{pctShare(bullishPct)}</b></span>
    </div>

    <div className="contrarianGauge">
      <div className="gaugeTrack">
        <i style={{ left: markerLeft }} />
      </div>
      <div className="gaugeLabels">
        <span>Euforia</span>
        <span>Neutral</span>
        <span>Pesimismo</span>
      </div>
    </div>

    <div className="moodMetrics">
      <span><b>{num(optimism)}</b><small>Índice optimismo</small></span>
      <span><b>{pctShare(Math.abs(spread))}</b><small>{spread >= 0 ? "Ventaja alcista" : "Ventaja bajista"}</small></span>
      <span><b>{Number.isFinite(news?.avgScore) ? news.avgScore.toFixed(1) : "-"}</b><small>{scoreLabel}</small></span>
    </div>
  </div>;
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
      const [healthResult, newsResult, socialResult] = await Promise.allSettled([
        fetch("/api/market-health").then(async (r) => {
          const d = await r.json();
          if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
          return d;
        }),
        fetch("/api/market-news").then(async (r) => {
          const d = await r.json();
          if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
          return d;
        }),
        fetch("/api/social-sentiment").then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
          return d;
        }),
      ]);
      if (healthResult.status === "rejected") throw healthResult.reason;
      setData(healthResult.value);
      setNews(newsResult.status === "fulfilled" ? newsResult.value : { error: newsResult.reason?.message || "Noticias no disponibles", rows: [] });
      setSocial(socialResult.status === "fulfilled" ? socialResult.value : { error: socialResult.reason?.message || "Pulso social no disponible", rows: [] });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return <main className="page marketHealthPage">
    <section className="marketHealthHeader">
      <div>
        <span className="eyebrow">StatsEdge · Market Health</span>
        <h1>Salud de mercado</h1>
        <p>Índices, sectores, titulares y liderazgo del último snapshot.</p>
      </div>
      <div className="marketHealthActions">
        <a className="btn" href="/">Screener</a>
        <button className="btn btnPrimary" onClick={load} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</button>
      </div>
    </section>

    {error && <section className="card error">{error}</section>}
    {loading && !data && <section className="card">
      <div className="sectionTitle"><h2>Cargando salud de mercado</h2><span className="fine">Índices, sectores y titulares</span></div>
      <p className="fine">Actualizando lectura de mercado...</p>
    </section>}

    {data && <>
      <section className={`marketRegimePanel ${colorClass(data.regime?.color)}`}>
        <div className="regimeLead">
          <span>Régimen</span>
          <strong>{data.regime?.label || "-"}</strong>
          <p>{data.regime?.stance}</p>
        </div>
        <div className="regimeMetrics">
          <span><b>{num(data.marketScore)}</b><small>Market score</small></span>
          <span><b>{pct(data.breadthProxy?.pctAbove50)}</b><small>SMA50</small></span>
          <span><b>{pct(data.breadthProxy?.pctAbove200)}</b><small>SMA200</small></span>
          <span><b>{data.breadthProxy?.indexes ?? "-"}</b><small>Índices</small></span>
        </div>
      </section>

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
        <div className="sectionTitle"><h2>Leadership pulse</h2><span className="fine">{scanPulse ? `Último snapshot · ${dateFmt(scanPulse.createdAt)} · ${scanPulse.marketRegime}` : "Sin snapshot local"}</span></div>
        {scanPulse ? <>
          <div className="kpis">
            <div className="kpi"><b>{scanPulse.count}</b><span>acciones snapshot</span></div>
            <div className="kpi"><b>{pctShare(scanPulse.rsLeaderPct)}</b><span>RS global &gt;= 80</span></div>
            <div className="kpi"><b>{pctShare(scanPulse.nearHighPct)}</b><span>cerca de máximos 52s</span></div>
            <div className="kpi"><b>{pctShare(scanPulse.pressurePct)}</b><span>deterioro 2+ evidencias</span></div>
          </div>
          <div className="grid grid2" style={{ marginTop: 12 }}>
            <div className="evidencePanel">
              <h3>Liderazgo observado</h3>
              {scanPulse.leaders.map((row) => <a className="evidenceRow" href={stockUrl(row.symbol)} key={row.symbol}>
                <span><b>{row.symbol}</b><small>{row.companyName || row.theme || "-"}</small></span>
                <span><b>{row.rsGlobalPct?.toFixed(0) || row.rsRating?.toFixed(0) || "-"}</b><small>RS global</small></span>
                <span><b>{row.totalScore?.toFixed(0) || "-"}</b><small>Composite</small></span>
              </a>)}
              {!scanPulse.leaders.length && <p className="fine">Sin liderazgo claro en el último snapshot.</p>}
            </div>
            <div className="evidencePanel">
              <h3>Deterioro a revisar</h3>
              {scanPulse.deterioration.map((row) => <a className="evidenceRow" href={stockUrl(row.symbol)} key={row.symbol}>
                <span><b>{row.symbol}</b><small>{row.companyName || row.theme || "-"}</small></span>
                <span><b>{row.deteriorationReasons.length}</b><small>evidencias</small></span>
                <span><b>{row.rsGlobalPct?.toFixed(0) || row.rsRating?.toFixed(0) || "-"}</b><small>{row.deteriorationReasons.slice(0, 2).join(", ")}</small></span>
              </a>)}
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
          <div><b>Lideres</b><span>{listText(data.sectorSummary?.leaders)}</span></div>
          <div><b>Debiles</b><span>{listText(data.sectorSummary?.laggards)}</span></div>
        </div>
        {data.sectorTapeNote && <span className="fine">Detalle operativo en Sectores.</span>}
      </section>}

      <section className="card">
        <div className="sectionTitle"><h2>Pulso de noticias <InfoHint text={`${news?.contrarianRead || "Sin lectura contraria disponible."} ${news?.note || "La métrica solo lee titulares recientes; confirmar con precio, medias y amplitud."}`} /></h2><span className="fine">{news?.provider || "Yahoo Finance News"}</span></div>
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
              <em>{item.publisher || "Proveedor"} · {dateFmt(item.publishedAt)}</em>
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
