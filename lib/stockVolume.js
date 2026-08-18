// lib/stockVolume.js — estado del volumen de un valor a partir de la serie
// diaria y de los campos que el screener calcula por fila, ambos ya en el
// payload de la ficha (/stock/[symbol]).
//
// Documento de origen: docs/diseno-indicadores-mercado-2026-08-17.md, C.3 #5.
// Las tres cifras que el briefing dice llevar en la ficha:
//
//   1. Reparto del volumen up/down (50 sesiones)
//   2. Volumen seco (10d/50d)
//   3. Impulso de volumen (5d/20d)
//
// Los tres campos ya están al 100 % de cobertura en el escaneo que alimenta
// la pantalla. Aquí se exponen en una forma coherente con la métrica del
// universo (lib/marketVolume.js), con disponibilidad explícita cuando un
// dato falta y un campo de hecho neutro para la UI.

// Ventanas del briefing. Documentadas para que la UI pueda declararlas
// cuando muestre el KPI: el usuario debe saber sobre qué ventana está
// midiendo cada cifra.
export const STOCK_VOLUME_WINDOWS = Object.freeze({
  upDown: 50,
  dryUpShort: 10,
  dryUpLong: 50,
  surgeShort: 5,
  surgeLong: 20,
});

// Filtra las entradas no finitas y devuelve la media. Defensivo: el contrato
// de barras llega en distinto orden según el caller (algunos descendente,
// algunos ascendente), pero la media no cambia. `Number(null) === 0` y
// `Number("") === 0`, así que primero descartamos null/undefined/strings no
// numéricos ANTES de convertir a número; de lo contrario null entraría como
// 0 y contaminaría la media.
function averageFinite(values) {
  const xs = [];
  for (const raw of values) {
    if (raw === null || raw === undefined) continue;
    const v = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(v)) xs.push(v);
  }
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Media de las últimas N barras de volumen. Acepta barras tanto
// descendentes (b[0] = última) como ascendentes (b[last] = última), y
// prefiere descendente por convención del módulo. Si no hay N barras,
// devuelve null.
export function averageVolume(bars = [], n = 20) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const rows = Array.isArray(bars) ? bars : [];
  if (rows.length < n) return null;
  // Asumimos descendente (contrato del módulo). Si el primer elemento trae
  // una fecha posterior al último, ya está bien; si no, cambiamos el orden.
  let head = rows.slice(0, n);
  if (rows[0]?.date && rows[n - 1]?.date && String(rows[0].date) < String(rows[n - 1].date)) {
    head = rows.slice(-n);
  }
  return averageFinite(head.map((bar) => bar?.volume));
}

// Devuelve el estado del volumen de un valor a partir de los campos que ya
// llegan en data.setupPattern y en la métrica del escaneo. La entrada es
// laxa: cualquier campo faltante produce un KPI declarado ausente
// (principio 3) en vez de un valor por defecto.
export function stockVolumeState({ setupPattern = {}, bars = [], scanVolume = {} } = {}) {
  const upDown50 = scanVolume?.upDownVolRatio ?? setupPattern?.upDownVolRatio ?? null;
  const dryUp = setupPattern?.volumeDryUpRatio ?? null;
  const avg5 = setupPattern?.avgVolume5 ?? null;
  const avg50 = setupPattern?.avgVolume50 ?? null;
  // El briefing fija el impulso en 5d vs 20d. setupPattern ya trae
  // avgVolume5 y avgVolume50; la media 20d hay que sacarla de las barras
  // locales. setupPattern.volumeSurgePct puede venir ya calculado.
  const surgePct = setupPattern?.volumeSurgePct ?? null;
  const avg20FromBars = Number.isFinite(avg5) ? averageVolume(bars, STOCK_VOLUME_WINDOWS.surgeLong) : null;
  const avg20 = Number.isFinite(avg20FromBars) ? avg20FromBars : null;
  const surgeComputed = Number.isFinite(avg5) && Number.isFinite(avg20) && avg20 > 0
    ? ((avg5 / avg20) - 1) * 100
    : null;
  const surgeFinal = Number.isFinite(surgePct) ? surgePct : surgeComputed;
  const latestVolume = setupPattern?.latestVolume ?? null;
  const latestVolumeRatio = setupPattern?.latestVolumeRatio ?? null;
  const valueOrReason = (value, label, window) => {
    if (Number.isFinite(value)) return { available: true, value, reason: null, window, label };
    return { available: false, value: null, reason: `Sin ${label} suficiente para calcular ${label}.`, window, label };
  };
  return {
    upDownVolumeRatio: {
      ...valueOrReason(upDown50, "reparto del volumen", "50 sesiones"),
      window: STOCK_VOLUME_WINDOWS.upDown,
    },
    volumeDryUp: {
      ...valueOrReason(dryUp, "volumen seco", "10 vs 50 sesiones"),
      window: `${STOCK_VOLUME_WINDOWS.dryUpShort} vs ${STOCK_VOLUME_WINDOWS.dryUpLong}`,
    },
    volumeSurge: {
      ...valueOrReason(surgeFinal, "impulso de volumen", "5 vs 20 sesiones"),
      window: `${STOCK_VOLUME_WINDOWS.surgeShort} vs ${STOCK_VOLUME_WINDOWS.surgeLong}`,
    },
    latestVolume: valueOrReason(latestVolume, "volumen de la última sesión", "última sesión"),
    relativeVolume: valueOrReason(latestVolumeRatio, "volumen relativo a su media de 50", "última sesión vs 50 sesiones"),
  };
}

// Fila de hecho única para mostrar el estado del volumen del valor en la
// ficha. Describe — no predice (principio 1).
export function stockVolumeFactLine(state) {
  if (!state) return null;
  const parts = [];
  if (state.upDownVolumeRatio.available) {
    const v = state.upDownVolumeRatio.value;
    parts.push(`reparto del volumen a 50 sesiones: ${v.toFixed(2)}×`);
  }
  if (state.volumeDryUp.available) {
    const v = state.volumeDryUp.value;
    parts.push(`volumen seco (10d/50d): ${v.toFixed(2)}×`);
  }
  if (state.volumeSurge.available) {
    const v = state.volumeSurge.value;
    const sign = v >= 0 ? "+" : "";
    parts.push(`impulso de volumen (5d/20d): ${sign}${v.toFixed(2)}%`);
  }
  if (!parts.length) return null;
  return parts.join(" · ");
}
