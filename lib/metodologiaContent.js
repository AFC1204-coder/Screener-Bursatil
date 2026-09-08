// lib/metodologiaContent.js — secciones de /metodologia desde constantes del motor.
// Principio 5: la metodología vive en un solo sitio; la UI solo publica lo ya decidido.

import {
  UP_DOWN_VOLUME_RATIO_BALANCED,
  UP_DOWN_VOLUME_THRESHOLD,
} from "@/lib/marketVolume";
import {
  STAGE_HEALTH_METHODOLOGY,
  STAGE_HEALTH_WEIGHTS,
} from "@/lib/stageHealth";
import {
  stageStructureQualifier,
  STAGE_CODE_VS_OPERATIVE_HINT,
} from "@/lib/stageDisplay";
import {
  ADVANCE_DEAD_BAND_PP,
  TREND_SUPPORT_MAX_WEEKS,
} from "@/lib/trendSupport";
import { DEFAULT_WEEKLY_STAGE_SETTINGS } from "@/lib/weeklyStage";
import {
  DEFAULT_WEEKLY_STAGE_STRUCTURE_SETTINGS,
  STRUCTURE_E2_MA_ONLY,
  STRUCTURE_E2_STRUCTURAL,
} from "@/lib/weeklyStageStructure";

function pctLabel(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n}%` : String(value ?? "");
}

function signedPctLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return n > 0 ? `+${n}%` : `${n}%`;
}

/** Secciones ordenadas para la página de metodología (MET-7). */
export function buildMetodologiaSections() {
  const stage = DEFAULT_WEEKLY_STAGE_SETTINGS;
  const structure = DEFAULT_WEEKLY_STAGE_STRUCTURE_SETTINGS;
  const preFuga = stageStructureQualifier(STRUCTURE_E2_MA_ONLY);
  const conFuga = stageStructureQualifier(STRUCTURE_E2_STRUCTURAL);
  const minHistoryWeeks = structure.lookbackWeeks + structure.rightWeeks;

  return [
    {
      id: "etapa-semanal",
      title: "Etapa semanal (Weinstein)",
      intro:
        "La etapa se decide solo con la relación del precio con su media de 30 semanas y la pendiente de esa media. No reclasifica por volumen ni por estructura de base.",
      bullets: [
        `Media lenta: ${stage.slowWeeks} semanas (SMA simple sobre cierres semanales).`,
        `Media rápida: ${stage.fastWeeks} semanas (referencia operativa; no entra en la clasificación de etapa).`,
        `Pendiente de la media lenta: ventana de ${stage.slopeWeeks} semanas; banda muerta |pendiente| ≤ ${pctLabel(stage.flatPct)} ⇒ media plana.`,
        "Etapa 1: precio bajo la media lenta y pendiente plana o descendente.",
        "Etapa 2: precio sobre la media lenta y pendiente ascendente.",
        "Etapa 3: precio sobre la media lenta y pendiente plana o descendente.",
        "Etapa 4: precio bajo la media lenta y pendiente descendente.",
        "Confirmada vs tentativa: la etapa 2 exige cierre semanal sobre la media lenta en la última semana cerrada; si no, queda tentativa con el motivo en la ficha.",
      ],
    },
    {
      id: "subestado",
      title: "Subestado estructural",
      intro: STAGE_CODE_VS_OPERATIVE_HINT,
      bullets: [
        `${preFuga?.word || "Pre-fuga"} (${STRUCTURE_E2_MA_ONLY}): etapa 1 o 2 con caja de 26 semanas ≤ ${pctLabel(structure.box26MaxPct)} sin ruptura del techo de ${structure.lookbackWeeks} semanas excluyendo las ${structure.rightWeeks} últimas.`,
        `${conFuga?.word || "Con fuga"} (${STRUCTURE_E2_STRUCTURAL}): cierre por encima del techo (${structure.lookbackWeeks}s − ${structure.rightWeeks}) o tendencia ancha (rango 26s ≥ ${pctLabel(structure.trend26MinPct)}) cerca del techo (${signedPctLabel(structure.shallowPullPct)} desde resistencia) con HH/HL en pivotes semanales (radio ${structure.pivotRadius}).`,
        `Histórico mínimo: ${minHistoryWeeks} semanas cerradas (${structure.lookbackWeeks}+${structure.rightWeeks}) para calcular el techo; por debajo, subestado n/a con motivo.`,
        "En etapas 3 y 4 el subestado no aplica.",
        "El subestado no reclasifica la etapa: es un calificador paralelo visible en mesa y ficha.",
      ],
      qualifiers: [
        { word: preFuga?.word, title: preFuga?.title },
        { word: conFuga?.word, title: conFuga?.title },
      ].filter((item) => item.word),
    },
    {
      id: "sosten",
      title: "Sostén de la tendencia",
      intro:
        "Tres lecturas descriptivas independientes. No son score ni semáforo; miden si la tendencia actual se sostiene.",
      bullets: [
        `Persistencia de medias: semanas consecutivas con el cierre del mismo lado de la media de ${stage.slowWeeks} y de ${stage.fastWeeks} semanas (mismas medias que la etapa). Tope de reporte: ${TREND_SUPPORT_MAX_WEEKS} semanas (≥${TREND_SUPPORT_MAX_WEEKS} si supera).`,
        `Aceleración: avance de los últimos 3 meses (63 sesiones) frente a los 3 meses previos (derivado de perf3m/perf6m). Banda muerta ±${ADVANCE_DEAD_BAND_PP} puntos porcentuales: «mantiene»; por encima «acelera»; por debajo «se frena».`,
        `Volumen: reparto up/down en 50 sesiones. ≥ ${UP_DOWN_VOLUME_THRESHOLD}× ⇒ «acompaña» · ${UP_DOWN_VOLUME_RATIO_BALANCED}–${UP_DOWN_VOLUME_THRESHOLD}× ⇒ «neutro» · < ${UP_DOWN_VOLUME_RATIO_BALANCED}× ⇒ «en contra».`,
      ],
    },
    {
      id: "salud",
      title: STAGE_HEALTH_METHODOLOGY.title,
      intro: STAGE_HEALTH_METHODOLOGY.question,
      scope: STAGE_HEALTH_METHODOLOGY.scope,
      formula: STAGE_HEALTH_METHODOLOGY.formula,
      components: STAGE_HEALTH_METHODOLOGY.components.map((component) => ({
        label: component.label,
        weight: component.weight,
        ramp: component.ramp,
      })),
      mirrorStage4: STAGE_HEALTH_METHODOLOGY.mirrorStage4,
      workedExample: STAGE_HEALTH_METHODOLOGY.workedExample,
      allOrNothing: STAGE_HEALTH_METHODOLOGY.allOrNothing,
      weightSum: Object.values(STAGE_HEALTH_WEIGHTS).reduce((sum, value) => sum + value, 0),
    },
  ];
}

export const METODOLOGIA_PAGE_TITLE = "Metodología";
