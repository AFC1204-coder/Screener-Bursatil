import { pct } from "@/lib/formatters";
import { MissingValue, PERFORMANCE_PERIODS } from "@/lib/screenerColumns";

// Tira de rendimiento de la vista rápida.
//
// Los periodos son los que la fila CALCULA de verdad (lib/screenerPeriods.js:
// 3M, 6M, 12M). Antes había seis cajas fijas —1S, 1M, 3M, 6M, YTD, 1A— y tres
// leían campos que el pipeline no produce en ninguna parte (perf1w, perf1m,
// perfYtd): con `|| 0` salían siempre como "+0.0%". El operador leía tres
// rendimientos nulos donde no había ningún dato.
//
// Un valor que de verdad rindió 0,0% en el periodo sigue mostrando "+0.0%": el
// corte lo hace Number.isFinite, no la falsedad del cero en JavaScript.
export function PerformanceStrip({ row = {} }) {
  return <div className="perfStrip">
    {PERFORMANCE_PERIODS.map((period) => {
      const value = row[period.key];
      return <div className="perfBox" key={period.key}>
        <span>{period.label}</span>
        {Number.isFinite(value)
          ? <b className={value >= 0 ? "up" : "down"}>{pct(value)}</b>
          : <MissingValue reason={`Sin histórico suficiente para calcular el rendimiento a ${period.months} meses de este valor.`} />}
      </div>;
    })}
  </div>;
}
