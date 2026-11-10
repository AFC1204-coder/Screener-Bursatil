// app/market-health/MarketRegimeHeadline.jsx — veredicto del hero de Mercado
// con la fecha real de los índices (auditoría 2026-11, D3).
//
// La regla de caducidad vive en lib/marketRegimeFreshness.js. Aquí solo se
// pinta: vigente → etiqueta y postura con «Índices al 22 sep» al lado;
// caducado → «Régimen sin actualizar desde el 22 sep», sin adjetivo ni color;
// sin datos → «Sin datos de mercado», nunca un régimen por defecto.
import { assessMarketRegime } from "@/lib/marketRegimeFreshness";

export default function MarketRegimeHeadline({ data, scope = "US", now }) {
  const read = assessMarketRegime(data, now ? { now } : undefined);
  return (
    <div className="marketRegimeLabel" data-regime-status={read.status}>
      <small>
        Régimen · {scope}
        {read.dateText ? <span className="marketRegimeAsOf"> · {read.dateText}</span> : null}
      </small>
      <h2>{read.headline}</h2>
      <p>{read.stance || "Lectura pendiente."}</p>
    </div>
  );
}
