// lib/screenerColdProgress.js — T9: una sola historia de progreso en cold start.
//
// Durante restoringScan la cabecera no debe parecer un panel de ops con cuatro
// mensajes de carga a la vez (weekly «comprobando…» + status bar + truth
// «cargando…» + empty «últimos datos guardados…»). El status bar del escaneo
// es el status primario; weekly/coverage se difieren; truth/empty no compiten.

/** Misma regla que ScreenerShell.showScanStatusBar — exportada para tests. */
export function isPrimaryScanProgressStatus(err, status = "") {
  if (err) return true;
  const text = String(status || "").trim();
  return /^(Cargando|Actualizando|Sincronizando|Descargando|Guardando|Importando|Subiendo)/i.test(text);
}

/**
 * Superficies de UI durante cold restore.
 * @returns {{
 *   cold: boolean,
 *   deferWeekly: boolean,
 *   deferCoverageFetch: boolean,
 *   primaryStatusBar: boolean,
 *   truthLineLoading: boolean,
 *   quietEmptyLabel: boolean,
 * }}
 */
export function resolveColdProgressSurfaces({
  restoringScan = false,
  status = "",
  err = null,
} = {}) {
  const cold = Boolean(restoringScan);
  const primaryStatusBar = cold && isPrimaryScanProgressStatus(err, status);
  return {
    cold,
    // Weekly y coverage no deben competir por red/atención hasta que la mesa
    // deje de restaurar (o el usuario abra cobertura a propósito).
    deferWeekly: cold,
    deferCoverageFetch: cold,
    primaryStatusBar,
    // Si el status bar ya cuenta la historia, la truth no dice «cargando…».
    // Sin status bar (edge / tests con status idle), la truth sigue siendo
    // el fallback para no afirmar 0·0·0.
    truthLineLoading: cold && !primaryStatusBar,
    quietEmptyLabel: cold,
  };
}

/** Empty de mesa en cold: silencioso; el status primario vive arriba. */
export function coldProgressEmptyLabel() {
  return "";
}
