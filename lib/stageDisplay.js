// lib/stageDisplay.js — cómo se ESCRIBE la etapa de Weinstein, en un solo sitio.
//
// La clasificación la calcula lib/weeklyStage.js y devuelve `state` +
// `confirmation` + `label` largo ("Etapa 2 confirmada", "Etapa 3 tentativa").
// La tabla del screener enseñaba la versión corta en español ("Etapa 2",
// "Base") y la ficha del valor el label largo: el mismo símbolo, la misma
// clasificación, dos textos distintos. Dos textos distintos para el mismo
// estado se leen como dos datos distintos.
//
// Este módulo NO clasifica nada: solo traduce el `state` que ya calculó
// weeklyStage.js. Si aparece un estado nuevo, aquí no se inventa: devuelve
// null y la superficie muestra ausencia.

const STAGE_WORDS = {
  stage1: { word: "Etapa 1", tone: "stage1" },
  stage2: { word: "Etapa 2", tone: "stage2" },
  stage3: { word: "Etapa 3", tone: "stage3" },
  stage4: { word: "Etapa 4", tone: "stage4" },
};

// Estados de la taxonomía ANTERIOR al criterio estricto (2026-08-16). Las
// filas ya guardadas por escaneos anteriores los llevan, y la retención
// conserva varias noches: sin esta tabla, el 42,5% del universo se quedaría
// sin etapa hasta que corra el próximo nocturno. Se muestran con su palabra
// de entonces y `legacy: true` para que la superficie pueda declarar que ese
// valor viene de un criterio distinto. NO se recalculan aquí: derivar la
// etapa nueva exigiría las barras, que esta capa no tiene.
const LEGACY_STAGE_WORDS = {
  base: { word: "Base", tone: "base", legacy: true },
  mixed: { word: "Mixta", tone: "mixed", legacy: true },
};

// Filas de sesiones antiguas que solo guardaron la etiqueta larga. Se deriva
// del texto ya guardado, nunca de un cálculo nuevo.
function stateFromLabel(label = "") {
  const text = String(label || "").toLowerCase();
  if (/stage 1|etapa 1/.test(text)) return "stage1";
  if (/stage 2|etapa 2/.test(text)) return "stage2";
  if (/stage 3|etapa 3/.test(text)) return "stage3";
  if (/stage 4|etapa 4/.test(text)) return "stage4";
  if (/base/.test(text)) return "base";
  if (/mixta|debil|débil/.test(text)) return "mixed";
  return "";
}

/**
 * @param {string} state  `weeklyStageState` de lib/weeklyStage.js
 * @param {string} label  etiqueta larga, solo como respaldo para filas viejas
 * @returns {{word: string, tone: string, legacy?: boolean}|null} null = mostrar ausencia
 */
export function stageWordForState(state = "", label = "") {
  if (STAGE_WORDS[state]) return STAGE_WORDS[state];
  if (LEGACY_STAGE_WORDS[state]) return LEGACY_STAGE_WORDS[state];
  if (state === "insufficient_history") return null;
  const derived = stateFromLabel(label);
  if (!derived) return null;
  return STAGE_WORDS[derived] || LEGACY_STAGE_WORDS[derived] || null;
}

// Una etapa 1 o 3 solo se confirma cuando la media YA se ha aplanado. Antes
// de eso el precio ha cruzado la media pero la media sigue en la dirección
// anterior: el hecho es real, la confirmación no ha llegado. Las etapas 2 y 4
// no tienen tentativa por construcción — precio y media apuntan al mismo
// sitio. Ver docs/diseno-salud-y-cambio-2026-08-16.md (D.15).
const CONFIRMATION_MARKS = {
  confirmed: { mark: "", suffix: "", title: "" },
  tentative: {
    mark: "·",
    suffix: "tentativa",
    title: "El precio ha cruzado su media de 30 semanas, pero la media sigue en la dirección anterior: todavía no lo confirma.",
  },
  unknown_context: {
    mark: "·",
    suffix: "sin contexto",
    title: "La media de 30 semanas está plana, pero falta histórico para saber si viene de una subida o de una caída.",
  },
};

/**
 * @param {string} confirmation `weeklyStageConfirmation` de lib/weeklyStage.js
 * @returns {{mark: string, suffix: string, title: string}|null}
 */
export function stageConfirmationMark(confirmation = "") {
  return CONFIRMATION_MARKS[confirmation] || null;
}

export const STAGE_MISSING_REASON = "Histórico semanal insuficiente para clasificar la etapa de este valor.";

export const STAGE_LEGACY_REASON = "Etapa calculada con el criterio anterior al 16 de agosto de 2026; se recalcula en el próximo escaneo.";
