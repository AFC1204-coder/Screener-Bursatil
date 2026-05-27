"use client";
import { useEffect, useMemo, useState } from "react";
import { num, pct } from "@/lib/formatters";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { favoriteToRow, isRecentIpo, metricValue, normalizeStockRows, shortBusiness, sortByMetric, uniqueRows, weaknessScore } from "@/lib/stockRows";
import { stockUrl } from "@/lib/symbols";

function chartPath(points, key, x, y) {
  let open = false;
  return points.map((p, i) => {
    const value = p[key];
    if (!Number.isFinite(value)) {
      open = false;
      return "";
    }
    const cmd = open ? "L" : "M";
    open = true;
    return `${cmd}${x(i).toFixed(1)},${y(value).toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

function chartPreviewBars(b, limit = 96) {
  const asc = [...b].filter((x) => Number.isFinite(x.close)).reverse();
  const enriched = asc.map((bar, i) => {
    const windowAvg = (n) => i >= n - 1 ? avg(asc.slice(i - n + 1, i + 1).map((x) => x.close)) : null;
    return {
      date: bar.date,
      open: Number.isFinite(bar.open) ? bar.open : bar.close,
      high: Number.isFinite(bar.high) ? bar.high : bar.close,
      low: Number.isFinite(bar.low) ? bar.low : bar.close,
      close: bar.close,
      volume: Number.isFinite(bar.volume) ? bar.volume : 0,
      sma50: windowAvg(50),
      sma200: windowAvg(200),
    };
  });
  return enriched.slice(-limit);
}

function MiniSparkline({ bars = [] }) {
  const points = bars.filter((x) => Number.isFinite(x.close));
  if (points.length < 2) return <div className="previewEmpty" style={{ height: "44px", display: "grid", placeItems: "center" }}>Sin dato</div>;
  const w = 260, h = 118, pad = 10;
  const values = points.flatMap((p) => [p.close, p.sma50, p.sma200].filter(Number.isFinite));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, max * 0.02);
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v) => pad + (1 - ((v - min) / range)) * (h - pad * 2);
  const first = points[0]?.close;
  const last = points[points.length - 1]?.close;
  const trendClass = last >= first ? "up" : "down";
  const volumeMax = Math.max(...points.map((p) => p.volume || 0), 1);
  const barW = Math.max(1.2, (w - pad * 2) / points.length - 1);
  return <svg className={`miniSparkline ${trendClass}`} style={{ width: "100%", height: "40px", display: "block" }} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Grafico tecnico compacto">
    <line x1={pad} x2={w - pad} y1={y(max)} y2={y(max)} className="sparkGuide" />
    <line x1={pad} x2={w - pad} y1={y(min)} y2={y(min)} className="sparkGuide" />
    {points.map((p, i) => {
      const vh = Math.max(1, ((p.volume || 0) / volumeMax) * 20);
      return <rect key={`${p.date}-${i}`} x={x(i) - barW / 2} y={h - pad - vh} width={barW} height={vh} className="sparkVolume" />;
    })}
    <path d={chartPath(points, "sma200", x, y)} className="sparkMa sparkMa200" />
    <path d={chartPath(points, "sma50", x, y)} className="sparkMa sparkMa50" />
    <path d={chartPath(points, "close", x, y)} className="sparkPrice" />
    <circle cx={x(points.length - 1)} cy={y(last)} r="3.4" className="sparkLast" />
  </svg>;
}

function ListSparkline({ row, chartsCache }) {
  if (Array.isArray(row.chartPreview) && row.chartPreview.length >= 2) {
    return <MiniSparkline bars={row.chartPreview} />;
  }
  const cachedBars = chartsCache[row.symbol];
  if (Array.isArray(cachedBars) && cachedBars.length >= 2) {
    return <MiniSparkline bars={cachedBars} />;
  }
  if (chartsCache[row.symbol] === null) {
    return <div className="previewEmpty" style={{ height: "44px", display: "grid", placeItems: "center" }}>Sin gráfico</div>;
  }
  return (
    <div className="sparklineSkeleton">
      <div className="skeletonPulse"></div>
    </div>
  );
}

function queryState() {
  if (typeof window === "undefined") return { groupType: "", group: "" };
  const p = new URLSearchParams(window.location.search);
  return { groupType: p.get("groupType") || "", group: p.get("group") || "" };
}
function applyGroupFilter(rows, groupType, group) {
  if (!groupType || !group) return rows;
  return rows.filter((r) => String(r[groupType] || "") === group);
}

function MiniTable({ title, desc, rows, chartsCache, scoreKey = "totalScore", collapsible = true, emptyLabel = "Sin datos todavia." }) {
  const table = <div className="tableWrap">
    <table className="table">
      <thead><tr>{["Ticker", "Empresa", "Gráfico", "Tema", "3M", "52w", "SMA50", metricShortLabel("weinsteinScore"), metricShortLabel("minerviniScore"), metricShortLabel("rsQualityScore"), metricShortLabel("weaknessScore"), metricShortLabel("riskScore"), metricShortLabel("totalScore")].map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 18).map((r) => <tr key={r.symbol}>
        <td><a className="ticker" href={stockUrl(r.symbol)}>{r.symbol}</a></td>
        <td>{r.companyName || r.symbol}<br /><span className="fine">{shortBusiness(r)}</span></td>
        <td className="compactSparkCell" style={{ width: "110px", minWidth: "110px", verticalAlign: "middle" }}>
          <ListSparkline row={r} chartsCache={chartsCache} />
        </td>
        <td><span className="pill">{r.theme || r.snapshot?.theme || "-"}</span></td>
        <td>{pct(r.perf3m ?? r.snapshot?.perf3m)}</td>
        <td>{pct(r.distance52w)}</td>
        <td>{pct(r.extSma50)}</td>
        <td>{num(r.weinsteinScore ?? r.snapshot?.weinsteinScore)}</td>
        <td>{num(r.minerviniScore ?? r.snapshot?.minerviniScore)}</td>
        <td>{num(r.rsQualityScore ?? r.snapshot?.rsQualityScore)}</td>
        <td>{num(weaknessScore(r))}</td>
        <td>{num(r.riskScore ?? r.snapshot?.riskScore)}</td>
        <td className="ticker">{num(Number.isFinite(metricValue(r, scoreKey)) ? metricValue(r, scoreKey) : r.snapshot?.totalScore)}</td>
      </tr>)}{!rows.length && <tr><td colSpan="13">{emptyLabel}</td></tr>}</tbody>
    </table>
  </div>;

  if (collapsible) {
    return <details className="card listDisclosure" open>
      <summary className="sectionTitle"><h2>{title}</h2><span className="fine">{desc}</span></summary>
      {table}
    </details>;
  }

  return <section className="card">
    <div className="sectionTitle"><h2>{title}</h2><span className="fine">{desc}</span></div>
    {table}
  </section>;
}

export default function ListsPage() {
  const [scans, setScans] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [filter, setFilter] = useState({ groupType: "", group: "" });
  const [chartsCache, setChartsCache] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const storedScans = safeRead(STORAGE_KEYS.scans, []);
    const loadedScans = (Array.isArray(storedScans) ? storedScans : []).filter((scan) => scan?.id !== "seed-scan-01");
    const loadedFavorites = safeRead(STORAGE_KEYS.favorites, []);

    setScans(loadedScans);
    safeWrite(STORAGE_KEYS.scans, loadedScans);
    setFavorites(loadedFavorites);
    setFilter(queryState());
    setLoaded(true);
  }, []);

  const latest = scans[0];
  const allRows = useMemo(() => normalizeStockRows(uniqueRows(latest?.rows || [])), [latest]);
  const rows = useMemo(() => applyGroupFilter(allRows, filter.groupType, filter.group), [allRows, filter]);
  const favoritesAsRows = useMemo(() => favorites.map(favoriteToRow), [favorites]);

  const leaders = useMemo(() => sortByMetric(rows, "totalScore"), [rows]);
  const rsQuality = useMemo(() => sortByMetric(rows, "rsQualityScore"), [rows]);
  const weakness = useMemo(() => sortByMetric(rows.filter((r) => weaknessScore(r) >= 45), "weaknessScore"), [rows]);
  const weinstein = useMemo(() => sortByMetric(rows, "weinsteinScore"), [rows]);
  const minervini = useMemo(() => sortByMetric(rows, "minerviniScore"), [rows]);
  const nearPivot = useMemo(() => rows.filter((r) => (r.distance20d ?? -999) >= -5 && (r.riskScore ?? 0) >= 50).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [rows]);
  const ipo = useMemo(() => rows.filter((r) => isRecentIpo(r, 60)).sort((a, b) => (b.ipoScore || 0) - (a.ipoScore || 0)), [rows]);
  const extended = useMemo(() => rows.filter((r) => (r.extSma50 ?? 0) >= 15 && (r.totalScore ?? 0) >= 70 && (r.distance52w ?? -99) >= -20).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [rows]);
  const pullback = useMemo(() => rows.filter((r) => (r.extSma50 ?? 99) >= -3 && (r.extSma50 ?? 99) <= 8 && (r.price ?? 0) > (r.sma200 ?? Infinity)).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [rows]);

  // Recolectar todos los tickers visibles únicos en pantalla (top 18 de cada lista)
  const visibleTickers = useMemo(() => {
    const set = new Set();
    const addRows = (list) => {
      if (!Array.isArray(list)) return;
      list.slice(0, 18).forEach((r) => {
        if (r && r.symbol) set.add(r.symbol);
      });
    };
    addRows(favoritesAsRows);
    addRows(leaders);
    addRows(rsQuality);
    addRows(weakness);
    addRows(weinstein);
    addRows(minervini);
    addRows(nearPivot);
    addRows(ipo);
    addRows(extended);
    addRows(pullback);
    return Array.from(set);
  }, [favoritesAsRows, leaders, rsQuality, weakness, weinstein, minervini, nearPivot, ipo, extended, pullback]);

  // useEffect para descargar secuencialmente en lotes los sparklines de la API real
  useEffect(() => {
    if (!visibleTickers.length) return;
    let active = true;

    const fetchRealCharts = async () => {
      const neededTickers = visibleTickers.filter((symbol) => {
        // Si ya tiene chartPreview real de base de datos/scan anterior
        const rowFromScans = allRows.find(r => r.symbol === symbol) || favoritesAsRows.find(r => r.symbol === symbol);
        if (rowFromScans && Array.isArray(rowFromScans.chartPreview) && rowFromScans.chartPreview.length >= 2) {
          return false;
        }
        // Si ya está en nuestra caché reactiva
        if (chartsCache[symbol]) {
          return false;
        }
        return true;
      });

      if (!neededTickers.length) return;

      const batchSize = 4;
      for (let i = 0; i < neededTickers.length; i += batchSize) {
        if (!active) break;
        const batch = neededTickers.slice(i, i + batchSize);

        await Promise.all(batch.map(async (symbol) => {
          try {
            const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}`);
            if (!res.ok) {
              if (active) {
                setChartsCache((prev) => ({ ...prev, [symbol]: null })); // Indicar error para usar fallback armónico
              }
              return;
            }
            const data = await res.json();
            const rawBars = data.bars || [];
            if (rawBars.length >= 2) {
              const preview = chartPreviewBars(rawBars);
              if (active) {
                setChartsCache((prev) => ({
                  ...prev,
                  [symbol]: preview
                }));
              }
            } else {
              if (active) {
                setChartsCache((prev) => ({ ...prev, [symbol]: null }));
              }
            }
          } catch (e) {
            console.error(`Error al cargar grafico real para ${symbol}:`, e);
            if (active) {
              setChartsCache((prev) => ({ ...prev, [symbol]: null }));
            }
          }
        }));
      }
    };

    fetchRealCharts();
    return () => {
      active = false;
    };
  }, [visibleTickers, allRows, favoritesAsRows]);

  return <main className="page listsPage">
    <style>{`
      @keyframes sparklinePulse {
        0% { opacity: 0.35; }
        50% { opacity: 0.75; }
        100% { opacity: 0.35; }
      }
      .sparklineSkeleton {
        height: 38px;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(13, 27, 42, 0.4);
        border-radius: 4px;
        border: 1px dashed rgba(0, 82, 204, 0.15);
      }
      .skeletonPulse {
        height: 10px;
        width: 65px;
        background: rgba(0, 82, 204, 0.22);
        border-radius: 2px;
        animation: sparklinePulse 1.4s infinite ease-in-out;
      }
    `}</style>

    <section className="card hero">
      <div className="heroTop">
        <div><div className="badge">STATS EDGE · Quick Lists</div><h1>Listas rapidas</h1><p className="muted">Lideres, favoritos y setups desde el ultimo snapshot.</p></div>
        <div className="mobileActions"><a className="btn" href="/">Screener</a><a className="btn" href="/review?source=latest">Vista rapida</a><a className="btn" href="/ipo-radar">IPO Radar</a><a className="btn" href="/research-desk">Research</a><a className="btn btnPrimary" href="/sectors">Sectores</a></div>
      </div>
    </section>
    <section className="card"><div className="kpis"><div className="kpi"><b>{loaded ? rows.length : "-"}</b><span>acciones visibles</span></div><div className="kpi"><b>{loaded ? favorites.length : "-"}</b><span>favoritos</span></div><div className="kpi"><b>{loaded ? scans.length : "-"}</b><span>snapshots</span></div><div className="kpi"><b>{loaded && latest ? new Date(latest.createdAt).toLocaleDateString() : "-"}</b><span>ultimo scan</span></div></div></section>
    {filter.group && <section className="card status">Filtro activo: <b>{filter.groupType} = {filter.group}</b> · <a className="ticker" href="/lists">limpiar</a></section>}
    <MiniTable title="Favoritos" desc="Tu watchlist curada" rows={favoritesAsRows} chartsCache={chartsCache} collapsible={false} emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
    <MiniTable title="Composite Leaders" desc="Ranking principal" rows={leaders} chartsCache={chartsCache} emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
    <MiniTable title="RS Quality Leaders" desc="RS alto con volatilidad/drawdown controlados" rows={rsQuality} chartsCache={chartsCache} scoreKey="rsQualityScore" emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
    <MiniTable title="Deterioro tecnico" desc="Debilidad observable para evitar largos o estudiar cortos" rows={weakness} chartsCache={chartsCache} scoreKey="weaknessScore" emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
    <MiniTable title="Weinstein Leaders" desc="Mejor estructura de etapa/tendencia" rows={weinstein} chartsCache={chartsCache} scoreKey="weinsteinScore" emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
    <MiniTable title="Minervini Leaders" desc="Trend template, momentum y maximos" rows={minervini} chartsCache={chartsCache} scoreKey="minerviniScore" emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
    <MiniTable title="Near Pivot" desc="Cerca de maximos y con riesgo controlado" rows={nearPivot} chartsCache={chartsCache} emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
    <MiniTable title="IPO / New Leaders" desc="Solo IPOs reales con fecha <= 5 años" rows={ipo} chartsCache={chartsCache} scoreKey="ipoScore" emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
    <MiniTable title="Extended but strong" desc="Muy fuertes, pero vigilar extension sobre SMA50" rows={extended} chartsCache={chartsCache} emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
    <MiniTable title="Pullback to SMA50" desc="Lideres cerca de SMA50 para vigilancia" rows={pullback} chartsCache={chartsCache} emptyLabel={loaded ? "Sin datos todavia." : "Cargando listas..."} />
  </main>;
}
