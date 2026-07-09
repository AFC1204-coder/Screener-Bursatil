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

function chartFromCache(symbol, cache, options = {}, extras = {}) {
  const latest = cache.bars?.[0] || {};
  return {
    bars: cache.bars || [],
    meta: {
      symbol: canonicalSymbol(symbol),
      regularMarketPrice: latest.close ?? null,
      currency: latest.currency || cache.currency || "",
      dataProvider: cache.stale ? "StatsEdge daily_bars stale cache" : "StatsEdge daily_bars cache",
      sourceProvider: latest.provider || cache.provider || "",
      requestedInterval: normalizeChartInterval(options.interval),
      requestedRange: options.range || "2A",
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

  // Fecha de corte para la purga oportunista: la trade_date de la barra número
  // `writeCap` más reciente que se va a escribir. Si el payload trajo más de
  // `writeCap` barras, todo lo anterior a esta fecha (para ESE symbol+provider+
  // owner) se borra — mismo patrón que la purga oportunista de scan_results,
  // adaptado al índice daily_bars_symbol_date_idx. Toca SOLO filas de este
  // símbolo, nunca un barrido de tabla completa.
  const purgeBeforeDate = (chart.bars || []).length > writeCap
    ? rows[rows.length - 1]?.trade_date
    : null;

  try {
    for (let i = 0; i < rows.length; i += 500) {
      await supabaseRequest("daily_bars", {
        method: "POST",
        query: "on_conflict=owner_id,symbol,trade_date,provider",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: rows.slice(i, i + 500),
      });
    }

    // Purga oportunista por símbolo: borra filas viejas de este (owner, symbol,
    // provider) anteriores a la barra writeCap-ésima más reciente. Solo se
    // dispara si el payload original excedió el cap — si no hubo excedente, no
    // hay nada que purgar (el upsert ya dejó la caché consistente con el cap).
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
      status: "supabase",
      written: true,
      count: rows.length,
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
    const write = useCache ? await writeDailyBarsCache(symbol, live, options) : { status: cacheable ? "skipped-disabled" : "skipped-intraday", written: false, count: 0 };
    // Veredicto canónico del live: si el fetcher ya emitió un dataQuality
    // (p.ej. fallback estimado/missing), se respeta — es la fuente canónica.
    // Si trajo serie real sin dataQuality explícito, inyectamos el veredicto
    // "real"/"provider" para que el consumidor tenga siempre la forma canónica.
    const liveDq = live && live.dataQuality;
    const resolvedDataQuality = liveDq && liveDq.status
      ? liveDq
      : { status: "real", source: "provider" };
    return {
      ...live,
      meta: {
        ...(live.meta || {}),
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
