"use client";
// Franja descriptiva de la ficha (variante 2a del diseño "Ficha StatsEdge":
// franja compacta pegada al gráfico). Cinco bandas: identidad, etapa + fuerza
// relativa, estructura de precio, crecimiento trimestral y pie de fuentes.
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
import { compactDate } from "@/app/components/ui/QualityStrip";
import { num as sharedNum, pct as sharedPct } from "@/lib/formatters";
import { stageConfirmationMark, stageWordForState } from "@/lib/stageDisplay";
import {
  DESCRIPTIVE_ABSENCE,
  lowAdvance52wFromBars,
  quarterlyGrowthCells,
  rsWeeklyDelta,
  slopeWord,
  volumeDryUpDisplay,
} from "@/lib/descriptiveStrip";

const STAGE_RAIL = ["1", "2", "3", "4"];

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

function GrowthGrid({ cells }) {
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

export default function DescriptiveStrip({ symbol = "", data = null, rsUniverse = null, freshness = {}, setupPattern = null }) {
  if (!data) return null;
  const weekly = data.stage?.weekly || {};
  const stageDigit = weekly.state && weekly.state !== "insufficient_history"
    ? (weekly.state.match(/\d/) || [""])[0]
    : "";
  const hasStage = Boolean(stageDigit);
  const stageWordInfo = stageWordForState(weekly.state || "", data.stage?.label || "");
  const confirmationInfo = stageConfirmationMark(weekly.confirmation || "");
  const weekInStage = Number.isFinite(weekly.weekInStage) ? weekly.weekInStage : null;

  const rs = data.relativeStrength || {};
  const rsValue = Number.isFinite(rsUniverse) ? Math.round(rsUniverse) : null;
  const rsDelta = rsWeeklyDelta(rs.globalRsSeries || []);
  const rsSample = Number((rs.globalRsSeries || []).at(-1)?.sampleSize);
  // Un ranking con corte anterior en más de 21 días al cierre del gráfico se
  // muestra con su fecha: la ficha puede servir la serie de un motor antiguo
  // (símbolos fuera del ranking vigente) y sin fecha parecería actual.
  const rsAsOf = String(rs.rsGlobalAsOf || "").slice(0, 10);
  const rsStale = rsAsOf && freshness?.priceDate
    ? (new Date(freshness.priceDate) - new Date(rsAsOf)) / 86400000 > 21
    : false;

  const distance52w = [rs.distance52w].map(Number).find(Number.isFinite) ?? null;
  const lowAdvance = lowAdvance52wFromBars(data.chartBars || []);
  const maDistance = Number.isFinite(weekly.distanceSlowMaPct) ? weekly.distanceSlowMaPct : null;
  const maWord = slopeWord(weekly.slowMaSlopePct, Number.isFinite(weekly.flatPct) ? weekly.flatPct : 2);
  const volume = volumeDryUpDisplay(setupPattern?.volumeDryUpRatio ?? data.setupPattern?.volumeDryUpRatio);

  const growth = quarterlyGrowthCells(data.financialResults || {}, {
    quarters: 6,
    sharesOutstanding: data.valuationMetrics?.sharesOutstanding,
  });

  const summary = String(data.summary || "").replace(/\s+/g, " ").trim();
  const showSummary = summary && !/^Yahoo no ofrece/i.test(summary);
  const sectorLine = [data.theme || data.sector, data.industry].filter(Boolean).join(" · ");

  const chartProvider = String(data.chartProvider || "").trim() || "Yahoo Finance";
  const fundamentalsSource = String(data.financialResults?.source || "").trim();
  const footSources = fundamentalsSource
    ? `Precios y perfil: ${chartProvider}. Fundamentales: ${fundamentalsSource}.`
    : `Precios y perfil: ${chartProvider}.`;
  const footDate = freshness?.priceDate ? compactDate(freshness.priceDate) : "";

  return (
    <section className="stockDescStrip" aria-label="Ficha descriptiva del valor">
      <div className="stockDescIdentity">
        <div className="stockDescIdentityMain">
          <div className="stockDescNameRow">
            <span className="stockDescName">{data.name || symbol}</span>
            <span className="stockDescTicker">{symbol}{data.exchange ? ` · ${data.exchange}` : ""}</span>
          </div>
          {showSummary ? <p className="stockDescSummary">{summary}</p> : null}
        </div>
        <div className="stockDescSectorSide">
          {sectorLine ? <span>{sectorLine}</span> : <Missing reason="Sin clasificación de negocio del proveedor." />}
          <span className="stockDescSectorRank">
            rango <Missing reason={DESCRIPTIVE_ABSENCE.sectorRank} />
          </span>
        </div>
      </div>

      <div className="stockDescMiddle">
        <div className="stockDescStage">
          {hasStage ? (
            <span className="stockDescStageDigit">{stageDigit}</span>
          ) : (
            <span className="stockDescStageDigit stockDescStageDigitGhost" aria-hidden="true">–</span>
          )}
          <div className="stockDescStageBody">
            <div className="stockDescStageHead">
              <span className="stockDescLabel">Etapa</span>
              {hasStage && weekInStage !== null ? (
                <span className="stockDescStageWeek">semana {sharedNum(weekInStage)}</span>
              ) : null}
              {!hasStage ? <Missing reason={weekly.detail || DESCRIPTIVE_ABSENCE.stage} /> : null}
            </div>
            <div className="stockDescStageRail" aria-hidden="true">
              {STAGE_RAIL.map((n) => (
                <div key={n} className={`stockDescStageRailStep${stageDigit === n ? " active" : ""}`} data-stage={n} />
              ))}
            </div>
            <div className="stockDescStageRailNumbers" aria-hidden="true">
              {STAGE_RAIL.map((n) => (
                <span key={n} className={stageDigit === n ? "active" : ""}>{n}</span>
              ))}
            </div>
            {hasStage ? (
              <span className="stockDescStageWord">
                {stageWordInfo?.word || ""}
                {confirmationInfo?.suffix ? ` · ${confirmationInfo.suffix}` : ""}
                {confirmationInfo?.title ? <InfoHint text={confirmationInfo.title} /> : null}
              </span>
            ) : null}
          </div>
        </div>

        <div className="stockDescRs">
          <div className="stockDescRsHead">
            <span className="stockDescRsSwatch" aria-hidden="true" />
            <span className="stockDescLabel">Fuerza relativa</span>
          </div>
          <div className="stockDescRsRow">
            <div className="stockDescRsItem">
              {rsValue !== null ? (
                <b className="stockDescRsValue">{rsValue}</b>
              ) : (
                <Missing reason={DESCRIPTIVE_ABSENCE.rs} />
              )}
              <span className="stockDescRsCaption">
                {rsValue !== null && Number.isFinite(rsDelta.from) ? `universo · desde ${Math.round(rsDelta.from)}` : "universo"}
                {rsValue !== null && Number.isFinite(rsSample) && rsSample > 0 ? ` · n=${sharedNum(rsSample)}` : ""}
                {rsValue !== null && rsStale ? ` · ${compactDate(rsAsOf)}` : ""}
              </span>
            </div>
            <span className="stockDescRsDivider" aria-hidden="true" />
            <div className="stockDescRsItem secondary">
              <Missing reason={DESCRIPTIVE_ABSENCE.rsSector} />
              <span className="stockDescRsCaption">sector</span>
            </div>
            <div className="stockDescRsItem secondary">
              <Missing reason={DESCRIPTIVE_ABSENCE.rsCountry} />
              <span className="stockDescRsCaption">país</span>
            </div>
          </div>
        </div>
      </div>

      <div className="stockDescStructure">
        <StructureCell
          label="Máx. 52s"
          value={Number.isFinite(distance52w) ? sharedPct(distance52w) : null}
          reason="Sin distancia al máximo de 52 semanas."
        />
        <StructureCell
          label="Sobre mín. 52s"
          value={Number.isFinite(lowAdvance) ? sharedPct(lowAdvance, 0) : null}
          reason={DESCRIPTIVE_ABSENCE.lowAdvance}
        />
        <StructureCell
          label="Media 30s"
          value={Number.isFinite(maDistance) ? sharedPct(maDistance) : null}
          word={Number.isFinite(maDistance) ? maWord : ""}
          reason={weekly.detail || DESCRIPTIVE_ABSENCE.stage}
        />
        <StructureCell label="Base" value={null} reason={DESCRIPTIVE_ABSENCE.base} />
        <StructureCell
          label="Volumen 10d/50d"
          value={Number.isFinite(volume.pct) ? sharedPct(volume.pct, 0) : null}
          word={Number.isFinite(volume.pct) ? volume.word : ""}
          reason="Sin volumen medio comparable en la serie."
        />
      </div>

      <div className="stockDescGrowth">
        <span className="stockDescLabel">Crecimiento trimestral · % interanual</span>
        {growth.usable ? (
          <GrowthGrid cells={growth.cells} />
        ) : (
          <span className="stockDescGrowthEmpty">
            <Missing reason={DESCRIPTIVE_ABSENCE.quarters} />
          </span>
        )}
      </div>

      <div className="stockDescFoot">
        <span className="stockDescFootBrand">StatsEdge</span>
        <span className="stockDescFootRule" aria-hidden="true" />
        <span className="stockDescFootSources">
          Gráfico TradingView · Datos {chartProvider}{footDate ? ` · ${footDate}` : ""}
          <InfoHint text={footSources} />
        </span>
      </div>
    </section>
  );
}
