// app/sectors/MarketSectorOverview.jsx — «Estado sectorial» de Sectores.
//
// Sale de /api/market-health (ETF sectoriales SPDR), NO del snapshot elegido
// en «Fuente»: por eso lleva su propia fecha en la cabecera. Con la caché
// caducada (auditoría 2026-11, D3) se rotula «Sin actualizar desde el …», se
// atenúa sin color y el régimen no se muestra; sin datos, «Sin datos de
// mercado». La regla vive en lib/marketRegimeFreshness.js.
import { num, pct } from "@/lib/formatters";
import { metricShortLabel } from "@/lib/metricCatalog";
import { assessMarketRegime, assessSectorTape, MARKET_NO_DATA_TEXT } from "@/lib/marketRegimeFreshness";

function listText(items = []) {
  return items?.length ? items.join(", ") : "-";
}

function sectorStateClass(value = "") {
  const text = String(value).toLowerCase();
  if (text.includes("bull") || text.includes("alc") || text.includes("construct")) return "bullish";
  if (text.includes("bear") || text.includes("baj") || text.includes("debil") || text.includes("deterior")) return "bearish";
  return "neutral";
}

export default function MarketSectorOverview({ data, error, now }) {
  const options = now ? { now } : undefined;
  const sectors = data?.sectorTape || [];
  const summary = data?.sectorSummary || {};
  const sorted = [...sectors].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const tape = assessSectorTape(data, options);
  const regime = assessMarketRegime(data, options);
  const stale = tape.status === "stale";
  const showTable = tape.status !== "missing" && sectors.length > 0;
  const subtitle = tape.dateText
    ? `${tape.dateText} · independiente de la fuente`
    : "Mercado · 1D / 1W / 1M / 3M";

  return <section className="sectorOverview" data-stale={stale || undefined}>
    <div className="sectionTitle">
      <h2>Estado sectorial</h2>
      <span className="fine">{subtitle}</span>
    </div>

    {!data && !error && <div className="dataNote">Cargando comparativa sectorial...</div>}
    {error && <div className="dataNote">{error}</div>}
    {data && !error && !showTable && <div className="dataNote">{MARKET_NO_DATA_TEXT}</div>}

    {showTable && <>
      <div className="kpis">
        <div className="kpi"><b>{regime.usable ? num(regime.marketScore) : "—"}</b><span>market score</span></div>
        <div className="kpi"><b>{regime.usable ? regime.regimeLabel : regime.status === "stale" ? "Sin actualizar" : "Sin dato"}</b><span>régimen</span></div>
        <div className="kpi"><b>{num(summary.avgScore)}</b><span>score medio</span></div>
        <div className="kpi"><b>{summary.above50 ?? "-"}/{summary.count ?? "-"}</b><span>sobre SMA50</span></div>
        <div className="kpi"><b>{summary.best1m || "-"}</b><span>mejor 1M</span></div>
        <div className="kpi"><b>{summary.worst1m || "-"}</b><span>peor 1M</span></div>
      </div>

      <div className="sectorPulse compact">
        <div><b>Lideres</b><span>{listText(summary.leaders)}</span></div>
        <div><b>Débiles</b><span>{listText(summary.laggards)}</span></div>
      </div>

      <div className="tableWrap sectorOverviewTable">
        <table className="table sectorTapeTable">
          <thead><tr>{["Sector", "ETF", "Estado", "Score", metricShortLabel("weinsteinScore"), metricShortLabel("stage"), "1D", "1W", "1M", "3M", "RS 1M", "SMA50", "SMA200", "Dist/Acc", "52w"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>{sorted.map((sector) => <tr key={sector.symbol}>
            <td><b>{sector.name}</b><br /><span className="fine">{sector.group}</span></td>
            <td className="ticker">{sector.symbol}</td>
            <td><i className={`sentimentPill ${stale ? "neutral" : sectorStateClass(sector.state?.bias || sector.state?.label)}`}>{sector.state?.label || "-"}</i></td>
            <td className="ticker">{num(sector.score)}</td>
            <td>{num(sector.weinsteinScore)}</td>
            <td>{sector.stage30w || "-"}</td>
            <td>{pct(sector.perf1d)}</td>
            <td>{pct(sector.perf1w)}</td>
            <td>{pct(sector.perf1m)}</td>
            <td>{pct(sector.perf3m)}</td>
            <td>{pct(sector.rs1m)}</td>
            <td>{sector.price > sector.sma50 ? "Sí" : "No"}</td>
            <td>{sector.price > sector.sma200 ? "Sí" : "No"}</td>
            <td>{Number.isFinite(sector.distributionDays20) ? `${sector.distributionDays20}/${sector.accumulationDays20}` : "-"}</td>
            <td>{pct(sector.distance52w)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="fine sectorCoverageNote">Proxy inicial mediante ETFs sectoriales USA. La capa por snapshot cubre Europa, Hong Kong, Japón y el resto de mercados cuando hay resultados guardados.</p>
    </>}
  </section>;
}
