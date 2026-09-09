// app/market-health/RegionalRegimeChips.jsx — veredictos paralelos US/EU/JP/HK (MH-FILL-5).
import { dateShort, num, pctShare } from "@/lib/formatters";
import { MissingValue } from "@/lib/screenerColumns";
import { stageDisplayForRow } from "@/lib/stageDisplay";
import { MARKET_REGION_KEYS } from "@/lib/marketRegions";

function stageLabel(snapshot = {}) {
  const display = stageDisplayForRow(snapshot);
  if (!display?.word) return snapshot.stage30w || "—";
  return display.qualifier ? `${display.word} · ${display.qualifier}` : display.word;
}

function breadthLabel(breadth, dataAsOf) {
  const above30w = breadth?.above30w;
  if (above30w?.available) {
    return {
      value: pctShare(above30w.pct),
      title: `${num(above30w.count)} de ${num(above30w.measured)} valores sobre MM30s${dataAsOf ? ` (cierre ${dateShort(dataAsOf)})` : ""}.`,
    };
  }
  const reason = above30w?.reason
    || (breadth?.population
      ? "Ningún valor de esta región trae la distancia a su media de 30 semanas en el escaneo nocturno."
      : "Sin valores de esta región en el escaneo nocturno.");
  return { missing: reason };
}

export default function RegionalRegimeChips({ regimes = {}, heroScope = "US" }) {
  const keys = MARKET_REGION_KEYS.filter((key) => regimes[key]);
  if (!keys.length) return null;

  return (
    <div className="marketRegionalRegimes" data-testid="regional-regime-chips">
      <div className="marketRegionalRegimesHead">
        <small>Régimen por región</small>
        <span className="fine">Hero = {heroScope} · veredictos en paralelo</span>
      </div>
      <div className="marketRegionalRegimesGrid">
        {keys.map((key) => {
          const row = regimes[key];
          const snapshot = row.etfSnapshot || {};
          const breadth = row.breadth || {};
          const amplitude = breadthLabel(breadth, breadth.dataAsOf);
          const isHero = key === heroScope;
          return (
            <article
              className="marketRegionalRegimeChip"
              key={key}
              data-region={key}
              data-hero={isHero || undefined}
            >
              <header className="marketRegionalRegimeChipHead">
                <span className="marketRegionFlag" aria-hidden="true">{row.flag}</span>
                <div>
                  <b>{row.name}</b>
                  <small>{row.benchmarkLabel}</small>
                </div>
                {isHero && <span className="marketRegionalRegimeHeroTag">Hero</span>}
              </header>
              <div className="marketRegionalRegimeChipBody">
                <div className="marketRegionalRegimeMetric">
                  <span>Etapa ETF</span>
                  {row.etfFailure
                    ? <b><MissingValue reason={row.etfFailure.reason || "ETF no disponible."} /></b>
                    : <b title={stageLabel(snapshot)}>{stageLabel(snapshot)}</b>}
                </div>
                <div className="marketRegionalRegimeMetric">
                  <span>Amplitud MM30s</span>
                  {amplitude.missing
                    ? <b><MissingValue reason={amplitude.missing} /></b>
                    : <b title={amplitude.title}>{amplitude.value}</b>}
                </div>
                <div className="marketRegionalRegimeMetric">
                  <span>Veredicto</span>
                  <b>{row.regime?.label || "—"}</b>
                </div>
              </div>
              <footer className="marketRegionalRegimeChipFoot">
                <span>{num(row.score)}</span>
                <span>{num(breadth.population)} en escaneo</span>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
