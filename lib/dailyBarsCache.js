import { normalizeChartInterval } from "@/lib/chartSettings";
import { ESTIMATED_CHART_PROVIDER } from "@/lib/estimatedBars";
import { supabaseConfig, supabaseRequest, toDate } from "@/lib/supabaseServer";

const DEFAULT_MAX_AGE_DAYS = 5;
const DEFAULT_OWNER_PROVIDER = "StatsEdge normalized daily";
const DEFAULT_CACHE_READ_TIMEOUT_MS = Number(process.env.DAILY_BARS_CACHE_READ_TIMEOUT_MS || 1500);

// Cap de profundidad de escritura. writeDailyBarsCache ya no escribe la serie
// histórica completa que devuelve el proveedor (range=MAX podía traer décadas
// para símbolos viejos, hinchiendo daily_bars sin ningún consumer que necesite
// >253 barras). El cap por defecto retiene 400 barras (~1.6 años) — holgura
// sobre los 253 que necesita el scoring completo (perf12m/distance52w/SMA200).
// Si el símbolo está referenciado por el owner (favorito, nota o alerta
// activa), el cap sube a 1260 (~5 años) para preservar distanceATH/listingDate
// con precisión razonable sobre los símbolos que el usuario sigue activamente.
// Estos números son DELIBERADAMENTE más holgados que el mínimo estricto (253)
// para no degradar silenciosamente ningún cálculo al aplicar el cap.
const WRITE_CAP_DEFAULT = 400;
const WRITE_CAP_REFERENCED = 1260;

const INTRADAY_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1H", "4H"]);

// ── Guard de cadencia: daily_bars solo persiste barras DIARIAS ───────────
//
// EL AGUJERO, medido el 2026-08-18 sobre producción: la tabla contenía 1.840
// filas que no son sesiones diarias — barras MENSUALES y SEMANALES escritas
// por esta misma función. Origen: Yahoo IGNORA el `interval=1d` que pide
// fetchYahooChartDirect cuando el `range` es largo y devuelve una
// granularidad más gruesa, declarándolo en `meta.dataGranularity`. Con
// range=max, SPY/^FCHI/ACWI devuelven "1mo" y 360.AX/1810.HK devuelven "1wk".
// Los dos llamadores que piden rangos largos son /api/chart?range=MAX|5A y el
// brief (app/api/company-brief/route.js, fetchChartForBrief con range "MAX").
// Nada leía `dataGranularity`, así que esas barras entraban como si fueran
// diarias. Efecto medido: +40,7% en el avgVolume de SPY, +40,6% en el de NVDA.
//
// La comprobación va aquí, en la ESCRITURA, no en la lectura: el arreglo del
// gráfico del 14 de agosto (homogeneousDailyRowsImpl en lib/chartDataModel.js)
// recorta la serie al tramo de cadencia diaria al DIBUJAR, pero eso solo tapa
// el síntoma en una superficie — el scoring, el RS y los indicadores de
// volumen siguen leyendo la tabla cruda.
//
// Dos reglas, deliberadamente redundantes:
//   1. Granularidad DECLARADA por el proveedor (exacta, cierra el agujero real).
//   2. Cadencia ESTRUCTURAL del payload (agnóstica de proveedor: Stooq y Alpha
//      Vantage no declaran granularidad, y un proveedor futuro tampoco tiene
//      por qué). Mediana del hueco en días naturales entre barras consecutivas:
//      una serie diaria da 1 (los viernes dan 3, pero son minoría); una semanal
//      da 7 y una mensual ~30. El umbral en 6 deja fuera incluso a un valor
//      ilíquido que solo cotice dos veces por semana.
const DAILY_GRANULARITIES = new Set(["1d", "1day", "d", "daily", "1dia"]);
const NON_DAILY_MEDIAN_GAP_DAYS = 6;
const MIN_BARS_FOR_CADENCE_CHECK = 10;

function medianCalendarGapDays(bars = []) {
  const times = bars
    .map((bar) => dateMs(bar?.date))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  if (times.length < MIN_BARS_FOR_CADENCE_CHECK) return null;
  const gaps = [];
  for (let i = 1; i < times.length; i += 1) {
    const days = Math.round((times[i] - times[i - 1]) / 86400000);
    if (days > 0) gaps.push(days);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

// Devuelve el motivo por el que el payload NO es diario, o "" si lo es.
// Exportada para que el test pueda ejercitar la regla sin montar un upsert.
export function nonDailyCadenceReason(chart = {}) {
  const declared = String(chart?.meta?.dataGranularity || "").trim().toLowerCase();
  if (declared && !DAILY_GRANULARITIES.has(declared)) {
    return `granularidad declarada por el proveedor: ${declared}`;
  }
  const gap = medianCalendarGapDays(Array.isArray(chart?.bars) ? chart.bars : []);
  if (gap !== null && gap >= NON_DAILY_MEDIAN_GAP_DAYS) {
    return `cadencia del payload: mediana de ${gap} días naturales entre barras`;
  }
  return "";
}

function canonicalSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const hk = clean.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return clean;
}

function isIntraday(options = {}) {
  return INTRADAY_INTERVALS.has(normalizeChartInterval(options.interval));
}

function cacheLimitForRange(range = "") {
  const key = String(range || "2A").trim().toUpperCase();
  const map = {
    "1D": 10,
    "5D": 20,
    "1M": 45,
    "3M": 90,
    "6M": 160,
    "1A": 280,
    "2A": 560,
    "5A": 1350,
    MAX: 6000,
  };
  return map[key] || map["2A"];
}

function minBarsForRange(range = "") {
  const key = String(range || "").trim().toUpperCase();
  if (key === "1D") return 1;
  if (key === "5D") return 3;
  if (key === "1M") return 10;
  const map = {
    "3M": 30,
    "6M": 60,
    "1A": 120,
    "2A": 250,
    "5A": 500,
    MAX: 500,
  };
  return map[key] || 20;
}

function dateMs(date = "") {
  const clean = toDate(date);
  if (!clean) return NaN;
  return Date.parse(`${clean}T00:00:00Z`);
}

function freshnessDays(date = "") {
  const ms = dateMs(date);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeCachedBar(row = {}) {
  const close = numberOrNull(row.adj_close ?? row.close);
  const rawClose = numberOrNull(row.close);
  const date = toDate(row.trade_date);
  if (!date || !Number.isFinite(close) || close <= 0) return null;
  return {
    date,
    open: numberOrNull(row.open) ?? close,
    high: numberOrNull(row.high) ?? close,
    low: numberOrNull(row.low) ?? close,
    close,
    rawClose,
    adjClose: close,
    volume: numberOrNull(row.volume),
    currency: row.currency || "",
    provider: row.provider || "",
    updatedAt: row.updated_at || "",
  };
}

function dedupeBars(rows = []) {
  const byDate = new Map();
  for (const row of rows) {
    const bar = normalizeCachedBar(row);
    if (!bar) continue;
    const existing = byDate.get(bar.date);
    if (!existing || String(bar.updatedAt || "") > String(existing.updatedAt || "")) byDate.set(bar.date, bar);
  }
  return [...byDate.values()].sort((a, b) => dateMs(b.date) - dateMs(a.date));
}

function barsThroughAsOf(bars = [], asOfDate = "") {
  const asOf = toDate(asOfDate);
  if (!asOf) return bars;
  const cutoff = dateMs(asOf);
  if (!Number.isFinite(cutoff)) return bars;
  return bars.filter((bar) => {
    const ms = dateMs(bar.date);
    return Number.isFinite(ms) && ms <= cutoff;
  });
}

function cacheSummary(cache = {}) {
  if (!cache) return null;
  return {
    status: cache.status || "unknown",
    table: "daily_bars",
    hit: Boolean(cache.hit),
    stale: Boolean(cache.stale),
    rows: cache.bars?.length || cache.rows || 0,
    latestDate: cache.latestDate || "",
    freshnessDays: cache.freshnessDays ?? null,
    maxAgeDays: cache.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
    minBars: cache.minBars ?? null,
    asOfDate: cache.asOfDate || "",
    asOfRows: cache.asOfRows ?? null,
    provider: cache.provider || "",
    error: cache.error || "",
  };
}

// Resuelve el asOf efectivo (fecha YYYY-MM-DD válida) a partir de las opciones.
// Devuelve "" si no se pidió asOf o si el valor no parsea a fecha — en ese caso
// no hay recorte. Centraliza la lectura para que el recorte del payload y el
// eco en meta usen exactamente el mismo valor.
function effectiveAsOf(options = {}) {
  return toDate(options.asOfDate || options.asOf || "") || "";
}

function chartFromCache(symbol, cache, options = {}, extras = {}) {
  const latest = cache.bars?.[0] || {};
  // Recorte del PAYLOAD por asOf: hasta hoy barsThroughAsOf solo se usaba para
  // contar (asOfRows) y decidir el gating enough/fresh, pero el payload
  // devolvía cache.bars completas — entregando velas futuras a quien pedía un
  // replay. Ahora recortamos las barras que se devuelven al caller. El latest
  // para regularMarketPrice/dataProvider se recalcula sobre el subconjunto
  // post-recorte para no anclar el meta en una barra futura.
  const asOf = effectiveAsOf(options);
  const bars = asOf ? barsThroughAsOf(cache.bars || [], asOf) : (cache.bars || []);
  const effectiveLatest = bars[0] || latest;
  return {
    bars,
    meta: {
      symbol: canonicalSymbol(symbol),
      regularMarketPrice: effectiveLatest.close ?? null,
      currency: effectiveLatest.currency || cache.currency || "",
      dataProvider: cache.stale ? "StatsEdge daily_bars stale cache" : "StatsEdge daily_bars cache",
      sourceProvider: effectiveLatest.provider || cache.provider || "",
      requestedInterval: normalizeChartInterval(options.interval),
      requestedRange: options.range || "2A",
      // Eco del asOf efectivamente aplicado: un cliente puede verificar que el
      // servidor honró el replay inspeccionando meta.asOf. "" cuando no hubo
      // recorte (consulta normal, no de replay).
      asOf,
      cache: {
        ...cacheSummary(cache),
        fallbackError: extras.fallbackError || "",
      },
    },
    // Veredicto canónico: lo que vive en daily_bars es siempre mercado real
    // (la caché solo persiste datos de proveedor — el guard anti-estimados del
    // write lo garantiza). El caso stale-fallback sigue siendo "real": es
    // mercado viejo, no sintético, así que cuenta como decision-grade.
    dataQuality: {
      status: "real",
      source: "daily_bars_cache",
    },
  };
}

function providerFromChart(chart = {}) {
  return String(chart.meta?.dataProvider || chart.provider || DEFAULT_OWNER_PROVIDER).trim() || DEFAULT_OWNER_PROVIDER;
}

// Comprueba si un símbolo está "referenciado" por el owner: presente en
// favorites (no borrado), notes (con symbol no nulo) o alerts (status activo).
// Esto determina si writeDailyBarsCache aplica el cap holgado (1260) en vez
// del cap por defecto (400). Es una consulta EXISTS barata — no hace falta
// optimizar más allá: se ejecuta una vez por write, y el write ya es un batch
// upsert que cuesta órdenes de magnitud más.
//
// Cualquier error de red/config la trata como "no referenciado" — prefiero el
// cap estricto (400) antes que inflar la caché por un fallo transitorio de la
// consulta de referencia. El símbolo se recupera en el siguiente write.
async function isSymbolReferenced(ownerId = "", symbol = "", config = {}) {
  const normalized = canonicalSymbol(symbol);
  if (!ownerId || !normalized || !config.configured) return false;
  const tables = [
    // favorites.deleted_at is null — excluye favoritos borrados (tombstones).
    { table: "favorites", filter: `owner_id=eq.${ownerId}&symbol=eq.${normalized}&deleted_at=is.null&select=id&limit=1` },
    // notes.symbol — nullable; el filtro symbol=not.eq.null implícito en eq.
    { table: "notes", filter: `owner_id=eq.${ownerId}&symbol=eq.${normalized}&select=id&limit=1` },
    // alerts.status='active' — excluye alerts disparadas/pausadas.
    { table: "alerts", filter: `owner_id=eq.${ownerId}&symbol=eq.${normalized}&status=eq.active&select=id&limit=1` },
  ];
  try {
    for (const { table, filter } of tables) {
      const rows = await supabaseRequest(table, {
        query: filter,
        timeoutMs: DEFAULT_CACHE_READ_TIMEOUT_MS,
      });
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Delta de escritura (esta tarea) ─────────────────────────────────────
// writeDailyBarsCache escribía SIEMPRE la serie entera que recibía (hasta
// writeCap barras), aunque la base ya tuviera exactamente esos mismos
// valores — cada refresco de un símbolo reescribía ~400 filas para traer
// una sola sesión nueva (docs/rango-corto-escritura-2026-08-10.md). Con
// 5.605 símbolos, eso son ~2,24 millones de filas por noche, el triple de
// la carga que tumbó la instancia Supabase el 9 de agosto.
//
// El dato para evitarlo ya estaba disponible sin coste extra:
// withDailyBarsCache lee la caché (readDailyBarsCache) ANTES de descargar
// para decidir si hace falta descargar — esa lectura queda en la variable
// `cached`, y hasta ahora se descartaba al llamar a writeDailyBarsCache.
// Ahora se pasa como options.cachedBars (ver withDailyBarsCache más abajo)
// y writeDailyBarsCache compara cada barra candidata contra la barra
// cacheada de esa misma fecha antes de incluirla en el upsert.
//
// Tolerancia de coma flotante (no igualdad estricta): las columnas de
// daily_bars son `numeric` (supabase/schema.sql), así que el round-trip
// de guardado/lectura es exacto — el ruido de coma flotante NO viene de
// ahí. Pero dos descargas independientes del mismo dato pueden diferir en
// el último dígito por el propio pipeline (ver cleanWriteBar: el `close`
// efectivo depende de qué campo trajo esa respuesta concreta). Una
// tolerancia relativa de 1e-6 (una parte en un millón del precio) absorbe
// ese ruido sin poder confundir un cambio real: incluso en un valor de
// 0,01 USD (penny stock), el margen es de 1e-8 USD — muy por debajo de la
// resolución de cualquier proveedor de precios real. El volumen, al ser
// siempre un número entero de acciones, se compara con una tolerancia
// fija de 0,5 (equivalente a igualdad exacta, sin depender de la escala).
//
// Deliberadamente NO se compara `updated_at` (cambia en cada escritura, no
// es una propiedad de la barra) ni `currency`/`provider` (son atributos
// del chart completo, no por barra — ver cleanWriteBar y B.5 de
// docs/rango-corto-escritura-2026-08-10.md: los bars que devuelve
// fetchYahooChart no traen esos campos por barra).
const PRICE_RELATIVE_TOLERANCE = 1e-6;
const VOLUME_ABSOLUTE_TOLERANCE = 0.5;

function numbersMatch(a, b, tolerance) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) <= tolerance;
}

function pricesMatch(a, b) {
  const scale = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0), 1);
  return numbersMatch(a, b, PRICE_RELATIVE_TOLERANCE * scale);
}

// Compara una fila candidata (salida de cleanWriteBar: `close` es el close
// SIN ajustar, `adj_close` el ajustado) contra la barra ya cacheada para esa
// misma fecha (salida de normalizeCachedBar: `rawClose` es la columna `close`
// de la base, `adjClose`/`close` es la columna `adj_close`). Mismo par
// semántico en ambos lados — ver el comentario de arriba para la
// correspondencia exacta.
function barUnchanged(row, cachedBar) {
  if (!cachedBar) return false;
  return (
    pricesMatch(row.open, cachedBar.open) &&
    pricesMatch(row.high, cachedBar.high) &&
    pricesMatch(row.low, cachedBar.low) &&
    pricesMatch(row.close, cachedBar.rawClose) &&
    pricesMatch(row.adj_close, cachedBar.adjClose) &&
    numbersMatch(row.volume, cachedBar.volume, VOLUME_ABSOLUTE_TOLERANCE)
  );
}

function cleanWriteBar(symbol, bar = {}, chart = {}) {
  const tradeDate = toDate(bar.date);
  const close = numberOrNull(bar.close ?? bar.adjClose);
  if (!tradeDate || !Number.isFinite(close) || close <= 0) return null;
  const provider = String(bar.provider || providerFromChart(chart)).trim() || DEFAULT_OWNER_PROVIDER;
  return {
    symbol: canonicalSymbol(bar.symbol || chart.meta?.symbol || symbol),
    trade_date: tradeDate,
    open: numberOrNull(bar.open) ?? close,
    high: numberOrNull(bar.high) ?? close,
    low: numberOrNull(bar.low) ?? close,
    close: numberOrNull(bar.rawClose ?? bar.close) ?? close,
    adj_close: numberOrNull(bar.adjClose ?? bar.close) ?? close,
    volume: numberOrNull(bar.volume),
    currency: String(bar.currency || chart.meta?.currency || "").trim() || null,
    provider,
    updated_at: new Date().toISOString(),
  };
}

export async function readDailyBarsCache(symbol, options = {}) {
  const config = supabaseConfig();
  const normalized = canonicalSymbol(symbol);
  const limit = Math.min(Math.max(Number(options.limit || cacheLimitForRange(options.range)), 1), 6000);
  const maxAgeDays = Math.max(Number(options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS), 0);
  const minBars = Math.max(Number(options.minBars ?? minBarsForRange(options.range)), 1);
  const asOfDate = toDate(options.asOfDate || options.asOf || "");

  if (!config.configured) {
    return { status: "disabled", hit: false, bars: [], rows: 0, maxAgeDays, minBars, asOfDate, asOfRows: 0, error: config.missing.join(", ") };
  }
  if (!normalized) return { status: "missing-symbol", hit: false, bars: [], rows: 0, maxAgeDays, minBars, asOfDate, asOfRows: 0 };

  try {
    const rows = await supabaseRequest("daily_bars", {
      query: {
        select: "symbol,trade_date,open,high,low,close,adj_close,volume,currency,provider,updated_at",
        owner_id: `eq.${config.ownerId}`,
        symbol: `eq.${normalized}`,
        order: "trade_date.desc,updated_at.desc",
        limit: String(limit * 3),
      },
      timeoutMs: Number(options.timeoutMs || DEFAULT_CACHE_READ_TIMEOUT_MS),
    });
    const bars = dedupeBars(rows).slice(0, limit);
    const asOfBars = barsThroughAsOf(bars, asOfDate);
    const latest = bars[0] || {};
    const age = freshnessDays(latest.date);
    const enough = asOfBars.length >= minBars;
    const fresh = enough && age !== null && age <= maxAgeDays;
    return {
      status: fresh ? "hit" : (bars.length ? (enough ? "stale" : "miss") : "miss"),
      hit: fresh,
      stale: enough && age !== null && age > maxAgeDays,
      bars,
      rows: bars.length,
      latestDate: latest.date || "",
      freshnessDays: age,
      maxAgeDays,
      minBars,
      asOfDate,
      asOfRows: asOfBars.length,
      provider: latest.provider || "",
      currency: latest.currency || "",
    };
  } catch (error) {
    return {
      status: "error",
      hit: false,
      bars: [],
      rows: 0,
      maxAgeDays,
      minBars,
      asOfDate,
      asOfRows: 0,
      error: error.message || "daily_bars cache read failed",
    };
  }
}

export async function writeDailyBarsCache(symbol, chart = {}, options = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { status: "disabled", written: false, count: 0, error: config.missing.join(", ") };
  if (isIntraday(options)) return { status: "skipped-intraday", written: false, count: 0 };

  // Guard anti-estimados: daily_bars solo persiste mercado real. Si el payload
  // trae señales de "estimated" (dataQuality explícito, meta.estimated, alguna
  // barra con estimated:true, o provider === ESTIMATED_CHART_PROVIDER), se
  // rechaza la escritura COMPLETA sin escribir nada. Esto es lo que sostiene la
  // invariant "lo que sale de la caché es siempre decision-grade": garantiza
  // que chartFromCache pueda emitir status:"real" con seguridad.
  const bars = Array.isArray(chart.bars) ? chart.bars : [];
  const estimatedByDq = chart.dataQuality?.estimated === true;
  const estimatedByMeta = chart.meta?.estimated === true;
  const estimatedByBars = bars.some((bar) => bar && (bar.estimated === true || bar.provider === ESTIMATED_CHART_PROVIDER));
  if (estimatedByDq || estimatedByMeta || estimatedByBars) {
    return { status: "rejected-estimated", written: false, count: 0 };
  }

  // Guard de cadencia (ver el bloque de comentario junto a nonDailyCadenceReason):
  // si el payload no es diario se rechaza ENTERO, sin escribir ninguna fila y sin
  // purgar nada. Una serie mensual o semanal no es un subconjunto degradado de la
  // diaria: es otra cosa, y mezclarla es lo que produjo las 1.840 filas espurias.
  const nonDaily = nonDailyCadenceReason(chart);
  if (nonDaily) {
    return { status: "rejected-non-daily", written: false, count: 0, reason: nonDaily };
  }

  // Cap de profundidad: las N barras más recientes por (owner, symbol, provider).
  // Antes de construir filas, recortamos el payload al cap que corresponda.
  // El cap holgado (1260) aplica solo si el símbolo está referenciado por el
  // owner (favorito/nota/alerta activa); si no, 400. chart.bars ya viene
  // ordenado desc (más reciente primero) por convención del fetcher, así que
  // slice(0, cap) retiene exactamente las más recientes.
  const referenced = await isSymbolReferenced(config.ownerId, symbol, config);
  const writeCap = referenced ? WRITE_CAP_REFERENCED : WRITE_CAP_DEFAULT;
  const cappedBars = (chart.bars || []).slice(0, writeCap);

  const rows = cappedBars
    .map((bar) => cleanWriteBar(symbol, bar, chart))
    .filter(Boolean)
    .map((row) => ({ owner_id: config.ownerId, ...row }));

  if (!rows.length) return { status: "empty", written: false, count: 0 };

  // Delta: descarta del upsert las filas cuya fecha ya está en la caché con
  // los mismos valores (ver el bloque de comentario más arriba, junto a
  // barUnchanged). `rows` completo (sin filtrar) SIGUE siendo la base de la
  // purga de abajo — el delta decide solo qué se envía en el POST, nunca
  // qué cuenta como "dentro del cap" a efectos de purga.
  const cachedBars = Array.isArray(options.cachedBars) ? options.cachedBars : [];
  const cachedByDate = new Map(cachedBars.map((bar) => [bar.date, bar]));
  const rowsToWrite = rows.filter((row) => !barUnchanged(row, cachedByDate.get(row.trade_date)));

  // Fecha de corte para la purga oportunista: la trade_date de la barra número
  // `writeCap` más reciente que se va a escribir. Si el payload trajo más de
  // `writeCap` barras, todo lo anterior a esta fecha (para ESE symbol+provider+
  // owner) se borra — mismo patrón que la purga oportunista de scan_results,
  // adaptado al índice daily_bars_symbol_date_idx. Toca SOLO filas de este
  // símbolo, nunca un barrido de tabla completa. Calculada sobre `rows` (no
  // `rowsToWrite`): el cap y su purga son una propiedad del payload completo,
  // no del subconjunto que resultó tener cambios.
  const purgeBeforeDate = (chart.bars || []).length > writeCap
    ? rows[rows.length - 1]?.trade_date
    : null;

  try {
    // Si el delta no dejó nada que escribir, no se emite ningún POST — cero
    // peticiones de upsert a Supabase. La purga de abajo es independiente
    // (ver su comentario): sigue disparándose si el payload excedió el cap,
    // haya o no filas que escribir.
    for (let i = 0; i < rowsToWrite.length; i += 500) {
      await supabaseRequest("daily_bars", {
        method: "POST",
        query: "on_conflict=owner_id,symbol,trade_date,provider",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: rowsToWrite.slice(i, i + 500),
      });
    }

    // Purga oportunista por símbolo: borra filas viejas de este (owner, symbol,
    // provider) anteriores a la barra writeCap-ésima más reciente. Solo se
    // dispara si el payload original excedió el cap — si no hubo excedente, no
    // hay nada que purgar (el upsert ya dejó la caché consistente con el cap).
    // Deliberadamente NO condicionada a rowsToWrite.length: es una operación
    // de mantenimiento sobre el cap, no sobre el delta — si se gatiara solo
    // cuando hay escritura, un símbolo sin cambios de precio pero con
    // excedente heredado (p.ej. tras bajar de referenciado a no-referenciado)
    // dejaría de purgarse hasta su próximo cambio real, dependiendo solo del
    // backstop semanal de pg_cron para ese caso — innecesario, cuando ya es
    // una sola consulta barata que hoy se dispara siempre que el payload
    // excede el cap (independientemente de si hay delta).
    if (purgeBeforeDate) {
      const provider = rows[0]?.provider || "";
      const purgeQuery = [
        `owner_id=eq.${config.ownerId}`,
        `symbol=eq.${canonicalSymbol(symbol)}`,
        `trade_date=lt.${purgeBeforeDate}`,
        provider ? `provider=eq.${encodeURIComponent(provider)}` : "",
      ].filter(Boolean).join("&");
      try {
        await supabaseRequest("daily_bars", {
          method: "DELETE",
          query: purgeQuery,
          prefer: "return=minimal",
        });
      } catch {
        // La purga es best-effort: si falla, el upsert principal ya dejó la
        // caché utilizable (las barras viejas sobreviven hasta la próxima
        // escritura). No propagamos el error — lo mismo que hace el backstop
        // semanal de pg_cron, que eventualmente las atrapa.
      }
    }

    return {
      // "unchanged": el delta no encontró ninguna fila nueva ni distinta —
      // cero peticiones de escritura, solo (como mucho) la purga de arriba.
      status: rowsToWrite.length ? "supabase" : "unchanged",
      written: rowsToWrite.length > 0,
      count: rowsToWrite.length,
      candidates: rows.length,
      provider: rows[0]?.provider || "",
      writeCap,
      referenced,
      purgedBefore: purgeBeforeDate,
    };
  } catch (error) {
    return { status: "error", written: false, count: 0, error: error.message || "daily_bars cache write failed" };
  }
}

export async function withDailyBarsCache(symbol, options = {}, fetcher) {
  const cacheable = !isIntraday(options);
  const useCache = options.useCache !== false && cacheable;
  let cached = null;

  if (useCache && !options.refresh) {
    cached = await readDailyBarsCache(symbol, options);
    if (cached.hit) return chartFromCache(symbol, cached, options);
  }

  try {
    const live = await fetcher(symbol, options);
    // La caché SIEMPRE se escribe con la serie COMPLETA (sin recortar por asOf):
    // una consulta de replay no debe empobrecer la caché para consultas
    // posteriores. writeDailyBarsCache recibe el `live` intacto; el recorte por
    // asOf se aplica solo al payload que se devuelve al caller, más abajo.
    //
    // options.cachedBars: el `cached` de arriba (si se leyó) ya tiene en
    // memoria las barras que hoy viven en daily_bars — se lo pasamos a
    // writeDailyBarsCache para que compare antes de reescribir en vez de
    // volver a leerlo (esa sería una consulta redundante) o de escribir la
    // serie entera a ciegas. Si `cached` es null (options.refresh o
    // options.useCache===false saltaron la lectura), cachedBars queda
    // undefined y writeDailyBarsCache escribe todo, igual que hasta ahora.
    const write = useCache
      ? await writeDailyBarsCache(symbol, live, { ...options, cachedBars: cached?.bars })
      : { status: cacheable ? "skipped-disabled" : "skipped-intraday", written: false, count: 0 };
    // Veredicto canónico del live: si el fetcher ya emitió un dataQuality
    // (p.ej. fallback estimado/missing), se respeta — es la fuente canónica.
    // Si trajo serie real sin dataQuality explícito, inyectamos el veredicto
    // "real"/"provider" para que el consumidor tenga siempre la forma canónica.
    const liveDq = live && live.dataQuality;
    const resolvedDataQuality = liveDq && liveDq.status
      ? liveDq
      : { status: "real", source: "provider" };
    // Recorte por asOf sobre el payload devuelto (no sobre lo escrito a caché).
    // Si no hay asOf, live.bars pasa intacto. Si lo hay, ninguna barra del
    // retorno tendrá date > asOf. El eco meta.asOf permite al cliente auditar.
    const asOf = effectiveAsOf(options);
    const liveBars = Array.isArray(live.bars) ? live.bars : [];
    const resolvedBars = asOf ? barsThroughAsOf(liveBars, asOf) : liveBars;
    return {
      ...live,
      bars: resolvedBars,
      meta: {
        ...(live.meta || {}),
        asOf,
        cache: {
          read: cacheSummary(cached),
          write,
        },
      },
      dataQuality: resolvedDataQuality,
    };
  } catch (error) {
    if (cached?.bars?.length) {
      return chartFromCache(symbol, { ...cached, stale: true, status: cached.status === "hit" ? "stale-fallback" : cached.status }, options, {
        fallbackError: error.message || "live provider failed",
      });
    }
    throw error;
  }
}
