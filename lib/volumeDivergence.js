// lib/volumeDivergence.js — divergencia entre índice y participación con
// umbral del briefing (docs/diseno-indicadores-mercado-2026-08-17.md, C.3 #4).
//
// El briefing compara la frecuencia del baremo "índice > 0 % y participación
// < 0 pp" con la del umbral explícito "índice ≥ +2 % y participación ≤ −5 pp
// en 20 semanas". El primer baremo se dispara el 39 % de las sesiones (ruido);
// el segundo, el 10 % (frecuencia útil). Esta capa solo añade el umbral sobre
// el participationSummary() que ya calcula lib/marketBreadth.js:223-241, sin
// modificar la serie.
//
// El briefing pide describir — no predecir. La salida es un campo neutro
// (thresholdMet), no un semáforo. La UI lo enuncia como hecho.

export const DEFAULT_DIVERGENCE_THRESHOLD = Object.freeze({
  indexUpPct: 2,
  participationDownPp: -5,
  windowWeeks: 20,
});

// Sin umbral (modo por defecto, retrocompatible con tests existentes):
// la divergencia se mantiene cuando el índice sube y la participación baja
// cualquier valor. Cobertura del briefing: 39 % de las sesiones (ruido).
export function legacyDivergence(summary) {
  if (!summary) return null;
  return { ...summary, threshold: null, thresholdMet: summary.divergence };
}

// Con umbral del briefing: dispara solo si el índice ha subido al menos
// `indexUpPct` % y la participación ha caído al menos
// `participationDownPp` puntos porcentuales en la ventana pedida. Devuelve
// el mismo shape que participationSummary() más los metadatos del umbral.
export function divergenceWithThreshold(summary, overrides = {}) {
  if (!summary) return null;
  const threshold = {
    indexUpPct: Number.isFinite(overrides.indexUpPct) ? overrides.indexUpPct : DEFAULT_DIVERGENCE_THRESHOLD.indexUpPct,
    participationDownPp: Number.isFinite(overrides.participationDownPp)
      ? overrides.participationDownPp
      : DEFAULT_DIVERGENCE_THRESHOLD.participationDownPp,
    windowWeeks: Number.isFinite(overrides.windowWeeks) ? overrides.windowWeeks : DEFAULT_DIVERGENCE_THRESHOLD.windowWeeks,
  };
  const windowMatches = summary.weeks >= threshold.windowWeeks;
  const indexUp = summary.indexChangePct >= threshold.indexUpPct;
  const participationDown = summary.participationDeltaPp <= threshold.participationDownPp;
  const thresholdMet = windowMatches && indexUp && participationDown;
  return { ...summary, threshold, thresholdMet };
}

// Devuelve el componente (divergence / thresholdMet) aplicable a la
// participationSummary. Si hay resumen, lo devuelve con el umbral aplicado
// en la forma participation. Si no, devuelve null.
export function applyThreshold(summary, options = {}) {
  if (!summary) return null;
  if (options.threshold === false) return legacyDivergence(summary);
  return divergenceWithThreshold(summary, options.threshold || {});
}

// Texto que la UI muestra en el panel "Índice y participación". Describe
// el hecho: variación del índice y de la participación, y un veredicto
// binario claro (cúmple o no). Sin semáforo de color.
export function divergenceFactText(summary) {
  if (!summary || !summary.threshold) return null;
  const t = summary.threshold;
  const weeks = summary.weeks || 0;
  const indexPart = Number.isFinite(summary.indexChangePct)
    ? `${summary.indexChangePct >= 0 ? "+" : ""}${summary.indexChangePct.toFixed(2)}%`
    : "—";
  const partPart = Number.isFinite(summary.participationDeltaPp)
    ? `${summary.participationDeltaPp >= 0 ? "+" : ""}${summary.participationDeltaPp.toFixed(2)} pp`
    : "—";
  const meets = summary.thresholdMet;
  const verdict = meets
    ? `cumple el umbral: índice ≥ +${t.indexUpPct}% y participación ≤ ${t.participationDownPp} pp`
    : `no alcanza el umbral: índice ≥ +${t.indexUpPct}% y participación ≤ ${t.participationDownPp} pp`;
  return {
    text:
      `En las últimas ${weeks} semanas, el índice ${Number.isFinite(summary.indexChangePct) ? "varió" : "se movió"} ${indexPart} y la participación ${Number.isFinite(summary.participationDeltaPp) ? "cambió" : "se movió"} ${partPart}. ${verdict} (ventana ${t.windowWeeks} semanas).`,
    thresholdMet: meets,
    threshold: t,
  };
}
