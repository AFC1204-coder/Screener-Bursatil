"use client";
// Franja descriptiva de la ficha (heredera de la variante 2a del diseño
// "Ficha StatsEdge"). Con la tarjeta 2c DENSA sobre el lienzo (cuarta
// iteración del 2026-08-21) la franja queda en UNA banda: las medias y el
// volumen. Todo lo identitario y fundamental —resumen, tema·rango,
// capitalización, etapa, FR, Máx/mín/Base, crecimiento y pie de marcas—
// vive en la tarjeta (ChartIdentityCard.jsx); el comentario de reparto de
// abajo detalla qué va en cada superficie para que nada se repita.
//
// Qué NO pinta y por qué (auditoría 2026-08-21, principio 3):
//   - Base (semanas · profundidad): el campo disponible es una ventana fija
//     de 65 sesiones (13,0 semanas en el 100% de las filas). Ausente con
//     motivo hasta que el detector de bases entre en producción.
//   - RS de sector y de país: el ranking semanal (la única fuente que el
//     producto muestra como RS, lib/rsCanonical.js) no clasifica por sector
//     y su universo es solo EE. UU. Ausentes con motivo.
//   - Rango dentro del sector ("4/121"): no existe ranking por sector.
//
// La estética sale de tokens-v2 (pizarra y tiza): el lienzo del diseño
// muestreó estos mismos tonos del gráfico real, así que aquí se usan los
// tokens del producto, no copias en oklch (regla 6 de styles/tokens-v2.css).
import { InfoHint } from "@/app/components/ui/InfoHint";
import { num as sharedNum, pct as sharedPct } from "@/lib/formatters";
import {
  DESCRIPTIVE_ABSENCE,
  slopeWord,
  volumeDryUpDisplay,
} from "@/lib/descriptiveStrip";

function Missing({ reason = "" }) {
  return (
    <span className="stockDescMissing">
      <span aria-hidden="true">–</span>
      <span className="srOnly">Sin dato</span>
      {reason ? <InfoHint text={reason} /> : null}
    </span>
  );
}

function StructureCell({ label, value, word = "", reason = "" }) {
  return (
    <div className="stockDescStructCell">
      <span className="stockDescStructLabel">{label}</span>
      {value !== null && value !== undefined && value !== ""
        ? <b className="stockDescStructValue">{value}</b>
        : <Missing reason={reason} />}
      {word ? <span className="stockDescStructWord">{word}</span> : null}
    </div>
  );
}

// Exportada: la tarjeta 2c densa del lienzo (ChartIdentityCard.jsx) pinta
// el crecimiento trimestral con esta misma rejilla y su rampa; la franja ya
// no lo pinta (reparto de la cuarta iteración).
export function GrowthGrid({ cells }) {
  return (
    <div className="stockDescGrowthGrid" role="table" aria-label="Crecimiento trimestral, variación interanual">
      <span />
      {cells.map((cell, index) => (
        <span key={`h-${cell.date}`} className={`stockDescQuarterHead stockDescRamp${index + 1}`}>
          {cell.label || "–"}
        </span>
      ))}
      <span className="stockDescGrowthRowLabel">BPA</span>
      {cells.map((cell, index) => (
        <b key={`e-${cell.date}`} className={`stockDescGrowthValue stockDescRamp${index + 1}`}
          title={cell.epsDerived ? "BPA aproximado: beneficio neto / acciones emitidas" : undefined}>
          {Number.isFinite(cell.epsYoY) ? sharedPct(cell.epsYoY, 0) : <span className="stockDescGhost" aria-label="Sin dato">–</span>}
        </b>
      ))}
      <span className="stockDescGrowthRowLabel">Ventas</span>
      {cells.map((cell, index) => (
        <b key={`r-${cell.date}`} className={`stockDescGrowthValue stockDescRamp${index + 1}`}>
          {Number.isFinite(cell.revenueYoY) ? sharedPct(cell.revenueYoY, 0) : <span className="stockDescGhost" aria-label="Sin dato">–</span>}
        </b>
      ))}
    </div>
  );
}

export default function DescriptiveStrip({ data = null, setupPattern = null, technical = null, stockVolume = null }) {
  if (!data) return null;
  const weekly = data.stage?.weekly || {};

  /* Reparto con la tarjeta 2c del lienzo (cuarta iteración —densa—,
     2026-08-21 noche) — nada se repite entre las dos superficies:
       TARJETA: fila de ticker+precio, nombre · exchange, resumen de
       negocio, tema con el rango de sector (ausente con motivo) y la
       capitalización, raíl de etapa, fuerza relativa, Máx. 52s / Sobre
       mín. / Base (ausente con motivo), crecimiento trimestral y el pie de
       marcas.
       FRANJA (esto): la banda de medias y volumen — el análisis técnico
       que no cabe en la tarjeta sin romper su densidad.
     El aviso de RS antiguo (fecha >21 días) queda cubierto por la franja de
     calidad de N0, que siempre fecha el RS; la muestra (n=) también vive
     allí. La industria (el detalle bajo el tema) quedó sin superficie en la
     ficha compacta: sigue en el Bloque empresa de N3. */

  const maDistance = Number.isFinite(weekly.distanceSlowMaPct) ? weekly.distanceSlowMaPct : null;
  const maWord = slopeWord(weekly.slowMaSlopePct, Number.isFinite(weekly.flatPct) ? weekly.flatPct : 2);
  const volume = volumeDryUpDisplay(setupPattern?.volumeDryUpRatio ?? data.setupPattern?.volumeDryUpRatio);
  // Distancias a las medias diarias de 50 y 200 sesiones (heredadas de la
  // Lectura técnica N1, retirada el 2026-08-21) y los dos indicadores de
  // volumen propios del panel «Estado del volumen» (retirado ese mismo día):
  // reparto up/down a 50 sesiones e impulso 5 vs 20. El volumen seco NO se
  // duplica: ya es la celda «Volumen 10d/50d».
  const ma50Daily = Number.isFinite(technical?.distanceSma50) ? technical.distanceSma50 : null;
  const ma200Daily = Number.isFinite(technical?.distanceSma200) ? technical.distanceSma200 : null;
  const upDownVol = stockVolume?.upDownVolumeRatio || null;
  const volSurge = stockVolume?.volumeSurge || null;

  return (
    <section className="stockDescStrip" aria-label="Ficha descriptiva del valor">
      {/* Las bandas de identidad (resumen + tema·rango) y de crecimiento
          trimestral subieron a la tarjeta 2c densa del lienzo
          (ChartIdentityCard) — ver el comentario de reparto arriba. */}
      <div className="stockDescStructure">
        <StructureCell
          label="Media 30s"
          value={Number.isFinite(maDistance) ? sharedPct(maDistance) : null}
          word={Number.isFinite(maDistance) ? maWord : ""}
          reason={weekly.detail || DESCRIPTIVE_ABSENCE.stage}
        />
        <StructureCell
          label="Media 50d"
          value={Number.isFinite(ma50Daily) ? sharedPct(ma50Daily) : null}
          reason="Sin histórico diario suficiente para la media de 50 sesiones."
        />
        <StructureCell
          label="Media 200d"
          value={Number.isFinite(ma200Daily) ? sharedPct(ma200Daily) : null}
          reason="Sin histórico diario suficiente para la media de 200 sesiones."
        />
        {/* La celda «Base» (ausente con motivo) subió a la tarjeta 2c del
            lienzo — aquí duplicaría la misma ausencia. */}
        <StructureCell
          label="Volumen 10d/50d"
          value={Number.isFinite(volume.pct) ? sharedPct(volume.pct, 0) : null}
          word={Number.isFinite(volume.pct) ? volume.word : ""}
          reason="Sin volumen medio comparable en la serie."
        />
        <StructureCell
          label="Reparto vol. 50d"
          value={upDownVol?.available && Number.isFinite(upDownVol.value) ? `${sharedNum(upDownVol.value, 2)}×` : null}
          word={upDownVol?.available ? "up/down" : ""}
          reason={upDownVol?.reason || "Sin reparto de volumen al alza/a la baja en 50 sesiones."}
        />
        <StructureCell
          label="Impulso vol. 5/20d"
          value={volSurge?.available && Number.isFinite(volSurge.value) ? sharedPct(volSurge.value) : null}
          reason={volSurge?.reason || "Sin medias de volumen comparables a 5 y 20 sesiones."}
        />
      </div>
    </section>
  );
}
