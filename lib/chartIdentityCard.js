// Tarjeta de identidad del lienzo — variante 2c del diseño «Ficha
// StatsEdge», cuarta iteración (2026-08-21 noche): DENSA. Las iteraciones
// anteriores fueron quitando información para caber (crecimiento, tema,
// resumen); el dueño pidió lo contrario — la esencia de MarketSmith es
// mucho dato en poco espacio con tipografía compacta, no poco dato aireado.
// Historia completa: docs/analisis-ficha-cuadro-grafico-2026-08-21.md.
//
// Contenido completo («lo imprescindible para conocer la empresa a simple
// vista»): identidad (la fila de ticker+precio la pinta el contenedor con
// los datos del propio chart), resumen de negocio, sector·tema con el rango
// (ausente con motivo) y la capitalización, raíl de etapa con semana,
// fuerza relativa con su valor de partida, estructura (máx. 52s, avance
// sobre mínimos, base ausente con motivo), crecimiento trimestral y el pie
// de tres marcas.
//
// Este módulo es el MODELO (puro, testeable). La vista es
// app/stock/[symbol]/ChartIdentityCard.jsx. El reparto con la franja está
// comentado en DescriptiveStrip.jsx — nada se repite: al subir aquí resumen,
// clasificación y crecimiento, la franja queda solo con la banda de medias
// y volumen.
//
// Ausencias (principio 3): cada campo sin dato viaja como null con su
// motivo, y la vista lo pinta como guion con InfoHint (rango de sector,
// base del detector, RS sin ranking, trimestres insuficientes).
import { compactDate } from "@/app/components/ui/QualityStrip";
import { amount } from "@/lib/formatters";
import {
  DESCRIPTIVE_ABSENCE,
  lowAdvance52wFromBars,
  quarterlyGrowthCells,
  rsWeeklyDeltaForIdentityCard,
} from "@/lib/descriptiveStrip";
import { stageDisplayForRow, stageWordForState } from "@/lib/stageDisplay";

export function buildChartIdentityCard({ symbol = "", data = null, rsUniverse = null } = {}) {
  if (!data || data.notFound) return null;

  const weekly = data.stage?.weekly || {};
  const stageDigit = weekly.state && weekly.state !== "insufficient_history"
    ? (weekly.state.match(/\d/) || [""])[0]
    : "";
  const stageInfo = stageWordForState(weekly.state || "", data.stage?.label || "");
  const stageDisplay = stageDisplayForRow({
    weeklyStageState: weekly.state || "",
    weeklyStageLabel: data.stage?.label || "",
    weeklyStageConfirmation: weekly.confirmation || "",
    weeklyStageStructure: weekly.structure || weekly.weeklyStageStructure || "",
  });
  // Fallback al diccionario canónico cuando el brief trae solo el label
  // legacy («Etapa 2 probable») sin estado semanal: mismo criterio que el
  // resto de superficies (lib/stageDisplay.js decide, aquí no se parsea).
  const digit = stageDigit || (stageInfo?.word?.match(/\d/) || [""])[0];
  const weekInStage = Number.isFinite(weekly.weekInStage) ? weekly.weekInStage : null;

  const rs = data.relativeStrength || {};
  const rsValue = Number.isFinite(rsUniverse) ? Math.round(rsUniverse) : null;
  const rsDelta = rsWeeklyDeltaForIdentityCard(rs, rsValue);

  const distance52w = [rs.distance52w].map(Number).find(Number.isFinite) ?? null;
  const lowAdvance = lowAdvance52wFromBars(data.chartBars || []);

  const growth = quarterlyGrowthCells(data.financialResults || {}, {
    quarters: 6,
    sharesOutstanding: data.valuationMetrics?.sharesOutstanding,
  });

  const summary = String(data.summary || "").replace(/\s+/g, " ").trim();
  const usableSummary = summary && !/^Yahoo no ofrece/i.test(summary) ? summary : "";

  const chartProvider = String(data.chartProvider || "").trim() || "Yahoo Finance";
  const priceDate = data.dataQuality?.freshness?.priceDate || "";

  return {
    name: data.name || symbol || "",
    exchange: data.exchange || "",
    // El resumen de a qué se dedica la empresa (dos líneas con clamp en la
    // vista). Sin descripción del proveedor: ausencia declarada.
    summary: usableSummary,
    theme: data.theme || data.sector || "",
    // Ranking sectorial: sin dato hoy — la celda no se pinta (STOCK-CARD-1).
    sectorRank: null,
    sectorRankReason: "",
    capText: Number.isFinite(data.marketCap)
      ? amount(data.marketCap, data.marketCapCurrency || data.currency || "")
      : null,
    stage: {
      digit,
      week: weekInStage,
      qualifier: stageDisplay?.qualifier || "",
      qualifierTitle: stageDisplay?.title || "",
      missingReason: digit ? "" : (weekly.detail || DESCRIPTIVE_ABSENCE.stage),
    },
    rs: {
      value: rsValue,
      from: rsValue !== null && Number.isFinite(rsDelta.from) ? Math.round(rsDelta.from) : null,
      absenceReason: rsValue === null ? DESCRIPTIVE_ABSENCE.rs : "",
    },
    countryRs: {
      value: Number.isFinite(rs.countryRsRating) ? Math.round(rs.countryRsRating) : null,
      sampleSize: Number.isFinite(rs.countryRsSampleSize) ? rs.countryRsSampleSize : null,
      weekKey: rs.countryRsWeekKey || "",
      absenceReason: Number.isFinite(rs.countryRsRating) ? "" : (rs.countryRsReason || DESCRIPTIVE_ABSENCE.rsCountry),
    },
    structure: {
      distance52w,
      lowAdvance: Number.isFinite(lowAdvance) ? lowAdvance : null,
      // Base del detector: sin dato hoy — la celda no se pinta (STOCK-CARD-1).
      base: null,
      baseReason: "",
    },
    growth,
    foot: {
      provider: chartProvider,
      dateLabel: priceDate ? compactDate(priceDate) : "",
    },
  };
}
