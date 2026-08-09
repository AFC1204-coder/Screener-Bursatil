import { finiteOrNull, supabaseConfig, supabaseRequest, toDate } from "@/lib/supabaseServer";

export const GLOBAL_RS_ENGINE_VERSION = "statsedge-global-rs-usd-v1";
export const GLOBAL_RS_BASE_CURRENCY = "USD";

function cleanSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

function dateTime(value = "") {
  const time = Date.parse(String(value || "").length <= 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? time : 0;
}

export async function readGlobalRsSeriesForSymbol(symbol = "", options = {}) {
  const config = supabaseConfig();
  const clean = cleanSymbol(symbol);
  if (!config.configured || !clean) return { configured: config.configured, series: [], latest: null };
  const limit = Math.min(Math.max(Number(options.limit || 180), 1), 260);
  const rows = await supabaseRequest("rs_weekly_items", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `symbol=eq.${encodeURIComponent(clean)}`,
      "select=symbol,snapshot_date,week_key,base_currency,engine_version,rank_index,rs_rating,rs_raw,sample_size,metrics",
      "order=snapshot_date.desc",
      `limit=${limit}`,
    ].join("&"),
  });
  // rs_weekly_items puede tener filas de más de un engine_version para el
  // mismo símbolo (ej. el motor europeo de mayo de 2026 y
  // "statsedge-us-equity-rs-v1" de agosto de 2026) — mezclar dos
  // metodologías distintas en una sola serie temporal afirma una
  // continuidad de cálculo que no existe. Filtro de solo lectura: nos
  // quedamos con el engine_version de la fila más reciente (rows[0], ya
  // que la consulta ordena por snapshot_date desc) y descartamos el resto
  // — no se borra ni se toca nada en la base, solo en lo que esta función
  // devuelve. Un símbolo que solo exista en el motor antiguo sigue
  // devolviendo su serie completa sin cambios.
  const latestEngineVersion = rows?.[0]?.engine_version || "";
  const sameEngineRows = latestEngineVersion
    ? rows.filter((row) => row.engine_version === latestEngineVersion)
    : rows;
  const series = (sameEngineRows || [])
    .map((row) => ({
      date: toDate(row.snapshot_date),
      weekKey: row.week_key || "",
      rsRating: finiteOrNull(row.rs_rating),
      rsRaw: finiteOrNull(row.rs_raw),
      rank: Number.isFinite(Number(row.rank_index)) ? Number(row.rank_index) : null,
      sampleSize: Number.isFinite(Number(row.sample_size)) ? Number(row.sample_size) : null,
      baseCurrency: row.base_currency || GLOBAL_RS_BASE_CURRENCY,
      engineVersion: row.engine_version || "",
      metrics: row.metrics || {},
    }))
    .filter((row) => row.date && Number.isFinite(row.rsRating))
    .sort((a, b) => dateTime(a.date) - dateTime(b.date));
  return {
    configured: true,
    symbol: clean,
    series,
    latest: series.at(-1) || null,
  };
}

// Lectura por lotes: leer el RS semanal símbolo a símbolo (N peticiones) no es
// viable para un escaneo de cientos/miles de filas. Esta función hace una
// sola consulta por lote de símbolos a rs_weekly_items, filtrada igual que
// readGlobalRsSeriesForSymbol (nos quedamos con el engine_version más
// reciente por símbolo — nunca mezclamos metodologías).
//
// Devuelve un Map<symbol, WeeklyRsResult> donde WeeklyRsResult distingue tres
// casos para cada símbolo PEDIDO (no para cualquier símbolo que aparezca en
// la tabla):
//   - símbolo con RS: { available: true, rsRating, rsRaw, rank, sampleSize,
//     asOf, weekKey, engineVersion }
//   - símbolo sin RS por no estar en el ranking: { available: false,
//     reason: "no está en el ranking semanal (barras insuficientes o serie
//     discontinua)" } — no se puede distinguir CUÁL de los dos motivos fue,
//     porque scripts/rs-universe.mjs solo imprime esa razón por consola: no
//     la persiste en ninguna tabla. Sería necesario guardarla (otra tarea).
//   - símbolo no consultado: no tiene entrada en el Map (el caller nunca lo
//     pidió, o config.configured es false).
const WEEKLY_RS_NOT_RANKED_REASON = "no está en el ranking semanal (barras insuficientes o serie discontinua — el motivo exacto no está persistido)";

export async function readGlobalRsForSymbols(symbols = [], options = {}) {
  const config = supabaseConfig();
  const cleanSymbols = [...new Set((symbols || []).map(cleanSymbol).filter(Boolean))];
  const bySymbol = new Map();
  if (!config.configured || !cleanSymbols.length) {
    return { configured: config.configured, bySymbol };
  }
  for (const symbol of cleanSymbols) {
    bySymbol.set(symbol, { available: false, reason: WEEKLY_RS_NOT_RANKED_REASON });
  }
  // Tope conservador: hasta ~60 filas históricas por símbolo (el máximo
  // observado en producción para un símbolo con historia en ambos motores
  // es 55) para no truncar antes de llegar a los símbolos que ordenan
  // después alfabéticamente dentro de un mismo lote.
  const chunkSize = Math.min(Math.max(Number(options.chunkSize || 50), 1), 200);
  const rowsPerSymbolCap = Math.min(Math.max(Number(options.rowsPerSymbolCap || 60), 1), 200);
  for (let i = 0; i < cleanSymbols.length; i += chunkSize) {
    const chunk = cleanSymbols.slice(i, i + chunkSize);
    const rows = await supabaseRequest("rs_weekly_items", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `symbol=in.(${chunk.map(encodeURIComponent).join(",")})`,
        "select=symbol,snapshot_date,week_key,engine_version,rank_index,rs_rating,rs_raw,sample_size",
        "order=symbol.asc,snapshot_date.desc",
        `limit=${chunk.length * rowsPerSymbolCap}`,
      ].join("&"),
    });
    // rows viene ordenado symbol.asc,snapshot_date.desc — la primera fila
    // que veamos de cada símbolo es su más reciente. Igual que en
    // readGlobalRsSeriesForSymbol, esa primera fila fija el engine_version
    // a aceptar; cualquier fila posterior del mismo símbolo con un
    // engine_version distinto se ignora (no se mezcla).
    const latestBySymbol = new Map();
    for (const row of rows || []) {
      const symbol = cleanSymbol(row.symbol);
      if (!latestBySymbol.has(symbol)) latestBySymbol.set(symbol, row);
    }
    for (const [symbol, row] of latestBySymbol) {
      const rsRating = finiteOrNull(row.rs_rating);
      if (!Number.isFinite(rsRating)) continue; // fila sin rating utilizable: se trata como no disponible
      bySymbol.set(symbol, {
        available: true,
        rsRating,
        rsRaw: finiteOrNull(row.rs_raw),
        rank: Number.isFinite(Number(row.rank_index)) ? Number(row.rank_index) : null,
        sampleSize: Number.isFinite(Number(row.sample_size)) ? Number(row.sample_size) : null,
        asOf: toDate(row.snapshot_date),
        weekKey: row.week_key || "",
        engineVersion: row.engine_version || "",
      });
    }
  }
  return { configured: true, bySymbol };
}
