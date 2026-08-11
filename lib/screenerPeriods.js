// lib/screenerPeriods.js — periodos de la columna de rendimiento del screener.
//
// Módulo sin JSX a propósito: lo consumen tanto la UI (lib/screenerColumns.jsx,
// que lo re-exporta para que la tabla tenga una única puerta de entrada) como
// la lógica pura de ordenación (lib/screenerPipeline.js), que no debe arrastrar
// React ni next/link.
//
// Solo periodos que la fila ya calcula en lib/researchRow.js: aquí no se
// inventa ninguno, y añadir uno nuevo exige que exista el campo en la fila.

export const PERFORMANCE_PERIODS = [
  { key: "perf3m", label: "3M", columnLabel: "Rend. 3M", sortLabel: "Rendimiento 3M", months: 3 },
  { key: "perf6m", label: "6M", columnLabel: "Rend. 6M", sortLabel: "Rendimiento 6M", months: 6 },
  { key: "perf12m", label: "12M", columnLabel: "Rend. 12M", sortLabel: "Rendimiento 12M", months: 12 },
];

export const DEFAULT_PERFORMANCE_PERIOD = "perf3m";

export function normalizePerformancePeriod(value) {
  return PERFORMANCE_PERIODS.some((item) => item.key === value) ? value : DEFAULT_PERFORMANCE_PERIOD;
}

export function performancePeriod(value) {
  const key = normalizePerformancePeriod(value);
  return PERFORMANCE_PERIODS.find((item) => item.key === key);
}
