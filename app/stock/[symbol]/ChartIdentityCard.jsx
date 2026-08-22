"use client";
// Vista de la tarjeta de identidad del lienzo — variante 2c, cuarta
// iteración (2026-08-21 noche): DENSA, a la manera de MarketSmith. El error
// de las iteraciones anteriores fue quitar información para caber; lo que
// hace legible ese estilo es lo contrario — mucho dato junto, con
// tipografía pequeña y filas apretadas. Aquí vuelve TODO: resumen de
// negocio, sector·tema con rango, capitalización y crecimiento trimestral,
// junto al raíl de etapa, la FR, la estructura y el pie de marcas.
//
// El modelo lo construye lib/chartIdentityCard.js. La prop `quote`
// (ticker, precio, variación) la inyecta el contenedor en
// UniversalPriceChart.jsx con los datos del propio chart: la primera fila
// fusiona identidad y precio en una sola cabecera.
import { InfoHint } from "@/app/components/ui/InfoHint";
import { DESCRIPTIVE_ABSENCE } from "@/lib/descriptiveStrip";
import { num as sharedNum, pct as sharedPct } from "@/lib/formatters";
import { GrowthGrid } from "./DescriptiveStrip";

const STAGE_RAIL = ["4", "3", "2", "1"];

function Absent({ reason = "" }) {
  return (
    <span className="chartIdCardMissing">
      <span aria-hidden="true">–</span>
      <span className="srOnly">Sin dato</span>
      {reason ? <InfoHint text={reason} /> : null}
    </span>
  );
}

export default function ChartIdentityCard({ card = null, quote = null }) {
  if (!card) return null;
  const { stage, rs, structure, growth, foot } = card;
  return (
    <div className="chartIdCard">
      {/* Fila 1 — identidad y precio fusionados: ticker, cierre, variación
          y el nombre con su mercado. Una sola cabecera. */}
      <div className="chartIdCardQuoteRow">
        {quote ? (
          <>
            <b className="chartIdCardQuoteSymbol">{quote.symbol}</b>
            <span className="chartIdCardQuotePrice">{quote.priceText}</span>
            <em className={`chartIdCardQuoteChange ${quote.positive ? "positive" : "negative"}`}>{quote.changeText}</em>
          </>
        ) : null}
        <span className="chartIdCardName">
          {card.name}
          {card.exchange ? <em className="chartIdCardExchange"> · {card.exchange}</em> : null}
        </span>
      </div>

      <div className="chartIdCardMain">
        {/* Raíl vertical de etapa: dígito grande + semana + los 4 tramos. */}
        <div className="chartIdCardStageRail" aria-label={stage.digit ? `Etapa ${stage.digit}` : "Etapa sin dato"}>
          <span className="chartIdCardStageLabel">Etapa</span>
          {stage.digit ? (
            <b className="chartIdCardStageDigit">{stage.digit}</b>
          ) : (
            <b className="chartIdCardStageDigit ghost" aria-hidden="true">–</b>
          )}
          {stage.digit && stage.week !== null ? (
            <span className="chartIdCardStageWeek">sem. {sharedNum(stage.week)}</span>
          ) : null}
          {!stage.digit ? <Absent reason={stage.missingReason} /> : null}
          <div className="chartIdCardStageSteps" aria-hidden="true">
            {STAGE_RAIL.map((n) => (
              <div key={n} className={`chartIdCardStageStep${stage.digit === n ? " active" : ""}`}>
                <em>{n}</em>
                <i />
              </div>
            ))}
          </div>
        </div>

        <div className="chartIdCardBody">
          {/* Resumen de negocio: a qué se dedica, en dos líneas. */}
          {card.summary ? (
            <p className="chartIdCardSummary">{card.summary}</p>
          ) : (
            <p className="chartIdCardSummary ghost">
              Sin descripción de negocio del proveedor.
            </p>
          )}

          {/* Clasificación y tamaño: tema · rango (ausente con motivo) · cap. */}
          <div className="chartIdCardClassRow">
            {card.theme ? <span className="chartIdCardTheme">{card.theme}</span> : null}
            <span className="chartIdCardRank">
              rango <Absent reason={card.sectorRankReason} />
            </span>
            <span className="chartIdCardCap">
              Cap. {card.capText ? <b>{card.capText}</b> : <Absent reason="Sin capitalización de mercado del proveedor." />}
            </span>
          </div>

          {/* FR + estructura en una sola fila densa. */}
          <div className="chartIdCardRsRow">
            <span className="chartIdCardRsLabel">
              <i className="chartIdCardRsSwatch" aria-hidden="true" />
              FR
            </span>
            {rs.value !== null ? (
              <>
                <b className="chartIdCardRsValue">{rs.value}</b>
                <span className="chartIdCardRsCaption">
                  universo{rs.from !== null ? ` · desde ${rs.from}` : ""}
                </span>
              </>
            ) : (
              <Absent reason={rs.absenceReason} />
            )}
            <span className="chartIdCardStructCell">
              <em>Máx. 52s</em>
              {Number.isFinite(structure.distance52w)
                ? <b>{sharedPct(structure.distance52w)}</b>
                : <Absent reason="Sin distancia al máximo de 52 semanas." />}
            </span>
            <span className="chartIdCardStructCell">
              <em>Sobre mín.</em>
              {Number.isFinite(structure.lowAdvance)
                ? <b>{sharedPct(structure.lowAdvance, 0)}</b>
                : <Absent reason={DESCRIPTIVE_ABSENCE.lowAdvance} />}
            </span>
            <span className="chartIdCardStructCell">
              <em>Base</em>
              <Absent reason={structure.baseReason} />
            </span>
          </div>

          {/* Crecimiento trimestral, compactado (rampa de la franja). */}
          <div className="chartIdCardGrowth">
            <span className="chartIdCardGrowthLabel">Crecimiento trimestral · % interanual</span>
            {growth?.usable ? (
              <GrowthGrid cells={growth.cells} />
            ) : (
              <Absent reason={DESCRIPTIVE_ABSENCE.quarters} />
            )}
          </div>
        </div>
      </div>

      <div className="chartIdCardFoot">
        <span className="chartIdCardFootBrand">StatsEdge</span>
        <span className="chartIdCardFootRule" aria-hidden="true" />
        <span className="chartIdCardFootSources">
          Gráfico TradingView · Datos {foot.provider}{foot.dateLabel ? ` · ${foot.dateLabel}` : ""}
        </span>
      </div>
    </div>
  );
}
