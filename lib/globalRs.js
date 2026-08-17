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

const WEEKLY_RS_SELECT = "symbol,snapshot_date,week_key,engine_version,rank_index,rs_rating,rs_raw,sample_size";

// ── El techo de 1.000 filas de PostgREST, y por qué manda aquí ─────────────
// PostgREST no devuelve más de 1.000 filas por respuesta, diga lo que diga el
// `limit`. Medido contra producción el 2026-08-17: un lote de 50 símbolos
// pedía 50×60 = 3.000 filas históricas, recibía 1.000 y con ellas cubría solo
// 33 de los 50 símbolos (la media real es de 30 filas históricas por símbolo).
// Los 17 restantes —los que ordenan después alfabéticamente— se quedaban SIN
// RS semanal, marcados como "no está en el ranking" sin estarlo. Un tercio de
// las filas de cada lote perdía su RS en silencio, y con él la columna RS y
// cualquier filtro que la use.
const POSTGREST_MAX_ROWS = 1000;
const WEEKLY_RS_CONCURRENCY = 6;
// Por debajo de este número de símbolos no compensa leer el snapshot entero
// (~4.900 filas): sale más barato preguntar por los símbolos concretos.
const WEEKLY_RS_BULK_MIN_SYMBOLS = 200;

function weeklyRsEntry(row = {}) {
  const rsRating = finiteOrNull(row.rs_rating);
  if (!Number.isFinite(rsRating)) return null; // fila sin rating utilizable: se trata como no disponible
  return {
    available: true,
    rsRating,
    rsRaw: finiteOrNull(row.rs_raw),
    rank: Number.isFinite(Number(row.rank_index)) ? Number(row.rank_index) : null,
    sampleSize: Number.isFinite(Number(row.sample_size)) ? Number(row.sample_size) : null,
    asOf: toDate(row.snapshot_date),
    weekKey: row.week_key || "",
    engineVersion: row.engine_version || "",
  };
}

// Ruta rápida para lotes grandes: el ranking semanal más reciente entero, en
// páginas paralelas. Ningún símbolo puede tener una fila más nueva que la
// fecha del último snapshot, así que para todo símbolo que aparezca aquí ESTA
// es su fila más reciente — la misma que devolvería la consulta por símbolo,
// sin el corte de las 1.000 filas.
// Medido el 2026-08-17: 4.868 filas en 6 peticiones paralelas, 419 ms, y cubre
// 3.232 de los 3.312 símbolos del nocturno. Los 80 restantes caen al camino
// por símbolo de abajo, que resuelve su historia antigua si la tienen.
async function readLatestWeeklyRsSnapshot(ownerId) {
  const head = await supabaseRequest("rs_weekly_items", {
    query: `owner_id=eq.${encodeURIComponent(ownerId)}&select=snapshot_date&order=snapshot_date.desc&limit=1`,
  });
  const snapshotDate = head?.[0]?.snapshot_date || "";
  if (!snapshotDate) return new Map();
  const bySymbol = new Map();
  let offset = 0;
  for (;;) {
    const offsets = Array.from({ length: WEEKLY_RS_CONCURRENCY }, (_, index) => offset + index * POSTGREST_MAX_ROWS);
    const pages = await Promise.all(offsets.map((pageOffset) => supabaseRequest("rs_weekly_items", {
      query: `owner_id=eq.${encodeURIComponent(ownerId)}&snapshot_date=eq.${encodeURIComponent(snapshotDate)}&select=${WEEKLY_RS_SELECT}&order=symbol.asc&limit=${POSTGREST_MAX_ROWS}&offset=${pageOffset}`,
    })));
    for (const page of pages) {
      for (const row of page || []) {
        const symbol = cleanSymbol(row.symbol);
        if (!symbol || bySymbol.has(symbol)) continue;
        bySymbol.set(symbol, row);
      }
    }
    if (pages.some((page) => (page?.length || 0) < POSTGREST_MAX_ROWS)) break;
    offset += WEEKLY_RS_CONCURRENCY * POSTGREST_MAX_ROWS;
  }
  return bySymbol;
}

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
  const rowsPerSymbolCap = Math.min(Math.max(Number(options.rowsPerSymbolCap || 60), 1), 200);
  // El lote no puede pedir más filas de las que PostgREST devuelve, o vuelve
  // el corte silencioso: 50 símbolos × 60 filas = 3.000 pedidas, 1.000
  // servidas, 17 símbolos sin RS. Con el tope de 60, el lote máximo es 16.
  const maxChunkSize = Math.max(1, Math.floor(POSTGREST_MAX_ROWS / rowsPerSymbolCap));
  const chunkSize = Math.min(Math.max(Number(options.chunkSize || maxChunkSize), 1), maxChunkSize);

  let pending = cleanSymbols;
  if (cleanSymbols.length >= WEEKLY_RS_BULK_MIN_SYMBOLS && options.bulkSnapshot !== false) {
    const latest = await readLatestWeeklyRsSnapshot(config.ownerId).catch(() => new Map());
    if (latest.size) {
      pending = [];
      for (const symbol of cleanSymbols) {
        const row = latest.get(symbol);
        const entry = row ? weeklyRsEntry(row) : null;
        if (entry) bySymbol.set(symbol, entry);
        else if (!row) pending.push(symbol);
      }
    }
  }

  // Camino por símbolo: para lotes pequeños y para los símbolos que no están
  // en el último ranking pero pueden tener historia anterior.
  const chunks = [];
  for (let i = 0; i < pending.length; i += chunkSize) chunks.push(pending.slice(i, i + chunkSize));
  for (let i = 0; i < chunks.length; i += WEEKLY_RS_CONCURRENCY) {
    const pages = await Promise.all(chunks.slice(i, i + WEEKLY_RS_CONCURRENCY).map((chunk) => supabaseRequest("rs_weekly_items", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `symbol=in.(${chunk.map(encodeURIComponent).join(",")})`,
        `select=${WEEKLY_RS_SELECT}`,
        "order=symbol.asc,snapshot_date.desc",
        `limit=${Math.min(chunk.length * rowsPerSymbolCap, POSTGREST_MAX_ROWS)}`,
      ].join("&"),
    })));
    // rows viene ordenado symbol.asc,snapshot_date.desc — la primera fila
    // que veamos de cada símbolo es su más reciente. Igual que en
    // readGlobalRsSeriesForSymbol, esa primera fila fija el engine_version
    // a aceptar; cualquier fila posterior del mismo símbolo con un
    // engine_version distinto se ignora (no se mezcla).
    const latestBySymbol = new Map();
    for (const rows of pages) {
      for (const row of rows || []) {
        const symbol = cleanSymbol(row.symbol);
        if (!latestBySymbol.has(symbol)) latestBySymbol.set(symbol, row);
      }
    }
    for (const [symbol, row] of latestBySymbol) {
      const entry = weeklyRsEntry(row);
      if (entry) bySymbol.set(symbol, entry);
    }
  }
  return { configured: true, bySymbol };
}

// Adjunta el RS semanal a una fila ya construida. Deliberadamente NO toca
// rsGlobalPct: ese campo lo consumen decenas de sitios además de la
// tabla/filtro (scoringEngine, decisionAudit, signalContradictions,
// screenerMethodologyEvidence, leaderboards...) y sustituirlo aquí cambiaría
// esas superficies en silencio. Los campos weeklyRs* conviven junto a
// rsGlobalPct; el display lee SIEMPRE los primeros vía lib/rsCanonical.js.
//
// Vive aquí, y no en la ruta que lo estrenó (app/api/scans), porque el bug de
// agosto de 2026 fue precisamente que solo UNA de las tres rutas que producen
// filas lo aplicaba: /api/scans sí, /api/scan (polling del escaneo en vivo) y
// /api/leaderboards no. La tabla enseñaba "–" para símbolos que sí tenían RS
// semanal mientras la ficha del mismo símbolo enseñaba el número.
export function attachWeeklyRs(row, weeklyRsBySymbol) {
  const entry = weeklyRsBySymbol?.get(String(row?.symbol || "").trim().toUpperCase());
  if (entry?.available) {
    return {
      ...row,
      weeklyRsAvailable: true,
      weeklyRsRating: entry.rsRating,
      weeklyRsRaw: entry.rsRaw,
      weeklyRsRank: entry.rank,
      weeklyRsSampleSize: entry.sampleSize,
      weeklyRsAsOf: entry.asOf,
      weeklyRsWeekKey: entry.weekKey,
      weeklyRsEngineVersion: entry.engineVersion,
      weeklyRsReason: null,
    };
  }
  return {
    ...row,
    weeklyRsAvailable: false,
    weeklyRsRating: null,
    weeklyRsRaw: null,
    weeklyRsRank: null,
    weeklyRsSampleSize: null,
    weeklyRsAsOf: null,
    weeklyRsWeekKey: null,
    weeklyRsEngineVersion: null,
    weeklyRsReason: entry?.reason || null,
  };
}

// Lee el ranking y lo adjunta en una sola llamada. Para las rutas que sirven
// filas sueltas y no tienen ya un lote de símbolos a mano.
//
// Si la lectura falla (Supabase caído, engine no configurado) NO tumba la
// respuesta: las filas salen marcadas como no disponibles, que es exactamente
// lo que la interfaz debe enseñar en ese caso.
export async function hydrateRowsWithWeeklyRs(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const symbols = list.map((row) => row?.symbol).filter(Boolean);
  const weekly = await readGlobalRsForSymbols(symbols).catch(() => ({ configured: false, bySymbol: new Map() }));
  return list.map((row) => attachWeeklyRs(row, weekly.bySymbol));
}
