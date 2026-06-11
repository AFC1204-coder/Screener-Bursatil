// lib/scanStatus.js — estados del scan en servidor (scans.settings.progress.status).
// Compartido por /api/scan, /api/scan/cancel y el polling del cliente.

export const TERMINAL_SCAN_STATUSES = ["done", "error", "cancelled"];

// Decide si un estado de scan es terminal: no habrá más filas ni cambios de progreso,
// el polling puede parar y una cancelación ya no procede.
export function isTerminalScanStatus(status) {
  return TERMINAL_SCAN_STATUSES.includes(String(status || "").trim().toLowerCase());
}
