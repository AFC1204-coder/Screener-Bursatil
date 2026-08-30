import { finiteOrNull, supabaseConfig, supabaseRequest, toDate } from "@/lib/supabaseServer";
import { canonicalRsEngineVersion, CANONICAL_RS_BASE_CURRENCY, US_EQUITY_RS_ENGINE_VERSION } from "@/lib/rsEngines";

// GLOBAL_RS_ENGINE_VERSION apuntaba al motor europeo de mayo de 2026
// ("statsedge-global-rs-usd-v1"): escritor desconocido, datos congelados, cesta
// de 69 símbolos. Nunca fue el canónico, solo una etiqueta heredada. El motor
// que alimenta la etiqueta "RS" lo decide ahora el PIN de lib/rsEngines.js
// (MET-1b, spec pregunta 6). Se mantiene el nombre exportado para no romper
// importadores, apuntando al pin.
export const GLOBAL_RS_ENGINE_VERSION = canonicalRsEngineVersion();
export const GLOBAL_RS_BASE_CURRENCY = CANONICAL_RS_BASE_CURRENCY;

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
  // Serie de la FICHA: un solo engine_version por serie (mezclar dos
  // metodologías en una línea temporal afirma una continuidad de cálculo que no
  // existe). La regla de selección la fija ahora el PIN, no "la fila más
  // reciente": si el símbolo tiene historia bajo el motor canónico, se enseña
  // ESA. Sin ella, se cae al engine de la fila más reciente y se etiqueta con su
  // engineVersion — es el caso del símbolo que solo tiene historia US o del
  // motor europeo de mayo, y el spec pide enseñarla etiquetada, no ocultarla.
  const pinnedEngine = canonicalRsEngineVersion();
  const hasPinnedRows = (rows || []).some((row) => row.engine_version === pinnedEngine);
  const selectedEngineVersion = hasPinnedRows ? pinnedEngine : (rows?.[0]?.engine_version || "");
  const sameEngineRows = selectedEngineVersion
    ? rows.filter((row) => row.engine_version === selectedEngineVersion)
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
// sola consulta por lote de símbolos a rs_weekly_items, filtrada por el PIN de
// engine_version (lib/rsEngines.js) — nunca por "el engine más reciente".
//
// POR QUÉ EL PIN Y NO LATEST-WINS (spec pregunta 6): con dos motores
// escribiendo, "la fila más reciente por símbolo" haría que la primera corrida
// del motor global cambiara el RS visible de todos los símbolos US en silencio.
// Con el pin, el cutover es un cambio de constante/variable de entorno,
// revisable y reversible; una escritura nueva de un motor NO pinneado no mueve
// ninguna pantalla.
//
// Devuelve un Map<symbol, WeeklyRsResult> con tres casos para cada símbolo
// PEDIDO (no para cualquier símbolo que aparezca en la tabla):
//   - símbolo con RS: { available: true, rsRating, rsRaw, rank, sampleSize,
//     asOf, weekKey, engineVersion }
//   - símbolo sin RS: { available: false, reason } — desde MET-1b el motivo es
//     el EXACTO persistido por el motor cuando existe (metrics.exclusionReason:
//     barras insuficientes, serie discontinua, FX no apto...). El texto genérico
//     de abajo queda solo para el símbolo que ni siquiera aparece en el
//     snapshot, es decir, el que está fuera del universo del ranking.
//   - símbolo no consultado: no tiene entrada en el Map (el caller nunca lo
//     pidió, o config.configured es false).
const WEEKLY_RS_NOT_RANKED_REASON = "Sin RS semanal: este símbolo no entra en el universo del ranking.";

// Texto de usuario por motivo persistido. El motor guarda un código estable
// (metrics.exclusionReason); la traducción a lenguaje de trader vive aquí, no en
// la base, para poder mejorarla sin reescribir snapshots.
const EXCLUSION_REASON_TEXT = {
  "insufficient-bars": "Sin RS semanal: no hay suficiente histórico de precios (se necesitan 52 semanas).",
  "discontinuous": "Sin RS semanal: la serie de precios tiene un salto sin ajustar (posible split), así que el cálculo no sería fiable.",
  "fx-currency-unknown": "Sin RS semanal: no se reconoce la divisa de cotización, así que el precio no se puede pasar a dólares.",
  "fx-unavailable": "Sin RS semanal: no hay tipo de cambio disponible para pasar el precio a dólares.",
  "fx-stale": "Sin RS semanal: el tipo de cambio más reciente es demasiado antiguo para esta semana.",
  "fx-discontinuous": "Sin RS semanal: la serie del tipo de cambio tiene un salto anómalo, así que la conversión no sería fiable.",
};

export function exclusionReasonText(code = "") {
  return EXCLUSION_REASON_TEXT[String(code || "").trim()] || "";
}

// metrics entra en el select desde MET-1b: es donde el motor global persiste el
// motivo de exclusión (rs_weekly_items no tiene columna propia y el DDL no se
// toca en ese ticket).
const WEEKLY_RS_SELECT = "symbol,snapshot_date,week_key,engine_version,rank_index,rs_rating,rs_raw,sample_size,metrics";

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

// Una fila del snapshot puede ser de dos tipos, y la diferencia importa:
//   - rankeada: rs_rating finito → { available: true, ... }
//   - de EXCLUSIÓN: rs_rating null + metrics.exclusionReason → { available:
//     false, reason } con el motivo exacto. El motor global las escribe para que
//     la ausencia deje de ser muda (spec § Superficies).
// Una fila de exclusión NUNCA puede colarse como RS: la primera comprobación es
// que rs_rating sea finito, y esas filas lo tienen a null por construcción.
function weeklyRsEntry(row = {}) {
  const rsRating = finiteOrNull(row.rs_rating);
  if (!Number.isFinite(rsRating)) {
    const code = String(row?.metrics?.exclusionReason || "").trim();
    if (!code) return null;
    const detail = String(row?.metrics?.exclusionDetail || "").trim();
    return {
      available: false,
      reason: exclusionReasonText(code) || WEEKLY_RS_NOT_RANKED_REASON,
      exclusionReason: code,
      exclusionDetail: detail,
    };
  }
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
//
// Desde MET-1b la consulta filtra por el engine PINNEADO, y eso incluye la
// cabecera que resuelve la fecha: sin ese filtro, un snapshot más nuevo de un
// motor NO canónico (p. ej. una corrida de verificación del motor global antes
// de accionar el pin) fijaría una snapshot_date en la que el motor canónico no
// tiene filas, y el lote entero saldría vacío.
async function readLatestWeeklyRsSnapshot(ownerId, engineVersion) {
  const head = await supabaseRequest("rs_weekly_items", {
    query: `owner_id=eq.${encodeURIComponent(ownerId)}&engine_version=eq.${encodeURIComponent(engineVersion)}&select=snapshot_date&order=snapshot_date.desc&limit=1`,
  });
  const snapshotDate = head?.[0]?.snapshot_date || "";
  if (!snapshotDate) return new Map();
  const bySymbol = new Map();
  let offset = 0;
  for (;;) {
    const offsets = Array.from({ length: WEEKLY_RS_CONCURRENCY }, (_, index) => offset + index * POSTGREST_MAX_ROWS);
    const pages = await Promise.all(offsets.map((pageOffset) => supabaseRequest("rs_weekly_items", {
      query: `owner_id=eq.${encodeURIComponent(ownerId)}&engine_version=eq.${encodeURIComponent(engineVersion)}&snapshot_date=eq.${encodeURIComponent(snapshotDate)}&select=${WEEKLY_RS_SELECT}&order=symbol.asc&limit=${POSTGREST_MAX_ROWS}&offset=${pageOffset}`,
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

// Antes del primer snapshot del motor pinneado (p. ej. global privado sin --write),
// la tabla no puede quedarse muda: mismo criterio que readGlobalRsSeriesForSymbol
// en ficha — caer al motor US hasta que exista snapshot del pin.
async function latestSnapshotDateForEngine(ownerId, engineVersion) {
  if (!engineVersion) return "";
  const head = await supabaseRequest("rs_weekly_items", {
    query: `owner_id=eq.${encodeURIComponent(ownerId)}&engine_version=eq.${encodeURIComponent(engineVersion)}&select=snapshot_date&order=snapshot_date.desc&limit=1`,
  }).catch(() => []);
  return head?.[0]?.snapshot_date || "";
}

async function resolveReadingEngineVersion(ownerId) {
  const pinned = canonicalRsEngineVersion();
  if (await latestSnapshotDateForEngine(ownerId, pinned)) return pinned;
  if (pinned !== US_EQUITY_RS_ENGINE_VERSION) {
    if (await latestSnapshotDateForEngine(ownerId, US_EQUITY_RS_ENGINE_VERSION)) {
      return US_EQUITY_RS_ENGINE_VERSION;
    }
  }
  return pinned;
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
  const engineVersion = options.engineVersion || await resolveReadingEngineVersion(config.ownerId);
  if (cleanSymbols.length >= WEEKLY_RS_BULK_MIN_SYMBOLS && options.bulkSnapshot !== false) {
    const latest = await readLatestWeeklyRsSnapshot(config.ownerId, engineVersion).catch(() => new Map());
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
  // en el último ranking pero pueden tener historia anterior BAJO EL MISMO
  // ENGINE. El filtro por engine_version va en la consulta, no después: pedir
  // filas de otros motores para descartarlas consumiría el presupuesto de 1.000
  // filas de PostgREST y volvería a truncar el lote en silencio, que es el bug
  // de agosto de 2026 documentado más arriba.
  const chunks = [];
  for (let i = 0; i < pending.length; i += chunkSize) chunks.push(pending.slice(i, i + chunkSize));
  for (let i = 0; i < chunks.length; i += WEEKLY_RS_CONCURRENCY) {
    const pages = await Promise.all(chunks.slice(i, i + WEEKLY_RS_CONCURRENCY).map((chunk) => supabaseRequest("rs_weekly_items", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `engine_version=eq.${encodeURIComponent(engineVersion)}`,
        `symbol=in.(${chunk.map(encodeURIComponent).join(",")})`,
        `select=${WEEKLY_RS_SELECT}`,
        "order=symbol.asc,snapshot_date.desc",
        `limit=${Math.min(chunk.length * rowsPerSymbolCap, POSTGREST_MAX_ROWS)}`,
      ].join("&"),
    })));
    // rows viene ordenado symbol.asc,snapshot_date.desc y ya filtrado al engine
    // canónico, así que la primera fila de cada símbolo es su más reciente
    // dentro del motor pinneado.
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
  const { hydrateRowsWithWeeklyCountryRs } = await import("@/lib/countryRsHydrate");
  const weekly = await readGlobalRsForSymbols(symbols).catch(() => ({ configured: false, bySymbol: new Map() }));
  const withGlobal = list.map((row) => attachWeeklyRs(row, weekly.bySymbol));
  return hydrateRowsWithWeeklyCountryRs(withGlobal);
}
