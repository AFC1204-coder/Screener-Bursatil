// Utilidades de GET /api/chart/batch (miniaturas de varios símbolos en una
// petición). Aparte de la ruta porque Next solo admite manejadores HTTP como
// exports de un route.js.

export const BATCH_MAX_SYMBOLS = 60;
// El cliente reordena y calcula SMA200 sobre las últimas 96 barras, que
// necesita ~295: con 300 el resultado es idéntico al de pedir /api/chart.
export const BATCH_BARS_KEPT = 300;

export function normalizeBatchSymbols(raw = "") {
  return [...new Set(
    String(raw || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean),
  )].slice(0, BATCH_MAX_SYMBOLS);
}

/** Barras más recientes primero (orden de /api/chart) → solo lo que pinta una miniatura. */
export function trimBarsForPreview(bars = []) {
  if (!Array.isArray(bars)) return [];
  return bars.slice(0, BATCH_BARS_KEPT).map((bar) => ({
    date: bar?.date,
    open: bar?.open,
    high: bar?.high,
    low: bar?.low,
    close: bar?.close,
    volume: bar?.volume,
  }));
}

export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
