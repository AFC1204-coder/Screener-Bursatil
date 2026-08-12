// lib/stageDisplay.js — cómo se ESCRIBE la etapa de Weinstein, en un solo sitio.
//
// La clasificación la calcula lib/weeklyStage.js y devuelve `state` +
// `label` largo ("Stage 2 probable", "Base / transicion"). La tabla del
// screener enseñaba la versión corta en español ("Etapa 2", "Base") y la ficha
// del valor el label largo en inglés a medias: el mismo símbolo, la misma
// clasificación, dos textos distintos. Dos textos distintos para el mismo
// estado se leen como dos datos distintos.
//
// Este módulo NO clasifica nada: solo traduce el `state` que ya calculó
// weeklyStage.js. Si aparece un estado nuevo, aquí no se inventa: devuelve
// null y la superficie muestra ausencia.

const STAGE_WORDS = {
  stage2: { word: "Etapa 2", tone: "stage2" },
  stage4: { word: "Etapa 4", tone: "stage4" },
  base: { word: "Base", tone: "base" },
  mixed: { word: "Mixta", tone: "mixed" },
};

// Filas de sesiones antiguas que solo guardaron la etiqueta larga. Se deriva
// del texto ya guardado, nunca de un cálculo nuevo.
function stateFromLabel(label = "") {
  const text = String(label || "").toLowerCase();
  if (/stage 2|etapa 2/.test(text)) return "stage2";
  if (/stage 4|etapa 4/.test(text)) return "stage4";
  if (/base/.test(text)) return "base";
  if (/mixta|debil|débil/.test(text)) return "mixed";
  return "";
}

/**
 * @param {string} state  `weeklyStageState` de lib/weeklyStage.js
 * @param {string} label  etiqueta larga, solo como respaldo para filas viejas
 * @returns {{word: string, tone: string}|null} null = mostrar ausencia
 */
export function stageWordForState(state = "", label = "") {
  if (STAGE_WORDS[state]) return STAGE_WORDS[state];
  if (state === "insufficient_history") return null;
  const derived = stateFromLabel(label);
  return derived ? STAGE_WORDS[derived] : null;
}

export const STAGE_MISSING_REASON = "Histórico semanal insuficiente para clasificar la etapa de este valor.";
