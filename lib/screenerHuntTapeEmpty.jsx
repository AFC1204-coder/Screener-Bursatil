// lib/screenerHuntTapeEmpty.js — estado vacío contractual de la mesa
// (rediseño 2026-11, paso 8): UNA frase con la causa real + UNA salida.
// Sin tarjeta ni ilustración. Puro: ScreenerShell lo resuelve y la mesa pinta.
//
// Orden de causas (la primera que aplica gana):
//   1. pasiva — carga en frío, mercados desalineados, sin escaneo: la frase que
//      ya trae `emptyLabel` y ninguna salida (el aviso de arriba tiene la suya).
//   2. cola externa vacía (raíl «Esta noche», Favoritos) → «Volver a la ficha».
//   3. pasan N pero una capa de vista los oculta → «Quitar <la última capa>».
//      Antes la mesa decía «Ningún valor de los 3287 analizados pasa este
//      filtro» con 937 pasando: la causa era la vista, no el filtro.
//   4. todos fuera por precio atrasado → la frase de lib/dataAge.js
//      (screenerEmptyFilterText, sin tocar) + «Traer datos frescos».
//   5. etiqueta de familia (IPO / RS) → su frase; IPO trae ya su enlace a
//      IPO Radar, así que no se añade otra salida.
//   6. cero pasan el filtro → «Ningún valor de los N analizados pasa «X».» +
//      «Ajustar filtro» (abre el popover «+ Filtro», donde se afloja).

export const HUNT_EMPTY_ACTIONS = Object.freeze({
  CLEAR_CHIP: "clear-chip",
  CLOSE_QUEUE: "close-queue",
  REFRESH: "refresh",
  ADJUST_FILTER: "adjust-filter",
});

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function isIpoFamilyLabelWithCta(label) {
  const props = label && typeof label === "object" ? label.props : null;
  return Boolean(props && props.familyKey === "ipo" && props.showIpoRadarCta !== false);
}

/**
 * @returns {{ cause: any, action: null | { kind: string, label: string, chipKey?: string } }}
 */
export function resolveHuntEmptyState({
  emptyLabel = "",
  passive = false,
  analyzedCount = 0,
  passCount = 0,
  chips = [],
  queue = null,
  presetName = "",
  diagnostics = null,
} = {}) {
  const analyzed = count(analyzedCount);
  const passing = count(passCount);
  if (passive || !analyzed) return { cause: emptyLabel, action: null };

  if (queue?.label) {
    if (!passing) {
      const size = count(queue.symbols?.size ?? queue.count);
      return {
        cause: size
          ? `Ninguno de los ${size} valores de «${queue.label}» está en los datos cargados.`
          : `«${queue.label}» no tiene valores esta vez.`,
        action: { kind: HUNT_EMPTY_ACTIONS.CLOSE_QUEUE, label: "Volver a la ficha" },
      };
    }
  }

  const liveChips = (Array.isArray(chips) ? chips : []).filter((chip) => chip?.label);
  if (passing && liveChips.length) {
    const last = liveChips[liveChips.length - 1];
    const scope = queue?.label ? `«${queue.label}»` : (presetName ? `«${presetName}»` : "el filtro");
    const by = liveChips.map((chip) => chip.label).join(" + ");
    return {
      cause: `Pasan ${passing} de ${scope}, pero ninguno cumple ${by}.`,
      action: { kind: HUNT_EMPTY_ACTIONS.CLEAR_CHIP, label: `Quitar ${last.label}`, chipKey: last.key || "" },
    };
  }

  if (!passing) {
    const stale = count(diagnostics?.freshnessRejected);
    if (stale && stale >= analyzed) {
      return { cause: emptyLabel, action: { kind: HUNT_EMPTY_ACTIONS.REFRESH, label: "Traer datos frescos" } };
    }
    if (typeof emptyLabel !== "string") {
      return {
        cause: emptyLabel,
        action: isIpoFamilyLabelWithCta(emptyLabel)
          ? null
          : { kind: HUNT_EMPTY_ACTIONS.ADJUST_FILTER, label: "Ajustar filtro" },
      };
    }
    // Precio atrasado parcial: la frase de dataAge ya nombra las dos causas.
    const cause = stale
      ? emptyLabel
      : (presetName
        ? `Ningún valor de los ${analyzed} analizados pasa «${presetName}».`
        : emptyLabel);
    return { cause, action: { kind: HUNT_EMPTY_ACTIONS.ADJUST_FILTER, label: "Ajustar filtro" } };
  }

  return { cause: emptyLabel, action: { kind: HUNT_EMPTY_ACTIONS.ADJUST_FILTER, label: "Ajustar filtro" } };
}

/** Evento para abrir el popover «+ Filtro» desde fuera de la barra. */
export const OPEN_FILTER_POPOVER_EVENT = "statsedge:open-filter-popover";

/**
 * Estado vacío de la mesa: la frase con la causa y, como mucho, una salida.
 * Sin tarjeta ni ilustración. Lo usan Caza (HuntTapeView) y Auditoría.
 */
export function HuntTapeEmpty({ label = "", action = null }) {
  return (
    <div className="huntTapeEmpty" role="status">
      <p className="huntTapeEmptyCause">{label}</p>
      {action?.label && action.onClick ? (
        <button type="button" className="btn btnSmall" onClick={action.onClick} disabled={Boolean(action.disabled)}>{action.label}</button>
      ) : null}
    </div>
  );
}
