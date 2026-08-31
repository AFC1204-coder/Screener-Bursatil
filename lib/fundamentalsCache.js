import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

const DEFAULT_MAX_AGE_DAYS = 7;
const PROFILE_PERIOD_TYPE = "profile";
const PROFILE_PROVIDER = "StatsEdge normalized profile";
const DEFAULT_PROFILE_CACHE_READ_TIMEOUT_MS = Number(process.env.PROFILE_CACHE_READ_TIMEOUT_MS || 1500);

function canonicalSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const hk = clean.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return clean;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ageDays(value = "") {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasFiniteObjectValue(value = {}, depth = 0) {
  if (!value || typeof value !== "object" || depth > 2) return false;
  return Object.values(value).some((item) => (
    numberOrNull(item) !== null
      || (item && typeof item === "object" && hasFiniteObjectValue(item, depth + 1))
  ));
}

function usefulProfile(profile = {}) {
  const sector = String(profile.sector || "").trim();
  const industry = String(profile.industry || "").trim();
  return Boolean(
    numberOrNull(profile.marketCap)
      || (sector && sector !== "Sin sector")
      || (industry && industry !== "Sin industria")
      || String(profile.businessSummary || "").trim()
      || hasFiniteObjectValue(profile.growthMetrics)
      || hasFiniteObjectValue(profile.valuationMetrics)
  );
}

function sourceProviders(profile = {}) {
  return [...new Set([
    profile.valuationMetrics?.source,
    profile.growthMetrics?.source,
    profile.growthMetrics?.shortInterestSource,
    profile.quoteSnapshot?.source,
    profile.shortInterest?.source,
  ].map((item) => String(item || "").trim()).filter(Boolean))];
}

function profileMetrics(profile = {}) {
  return {
    name: profile.name || "",
    sector: profile.sector || "",
    industry: profile.industry || "",
    exchange: profile.exchange || "",
    currency: profile.currency || "",
    ipoDate: profile.ipoDate || "",
    // Procedencia de la fecha (lib/ipoDate.js · IPO_DATE_SOURCES). Viaja con
    // el dato porque las fuentes no son equivalentes: Yahoo da la primera
    // cotización, FMP la fecha de la operación, y saber cuál se guardó es lo
    // que permite auditar una discrepancia sin volver a pedir nada.
    ipoDateSource: profile.ipoDateSource || null,
    website: profile.website || "",
    city: profile.city || "",
    country: profile.country || "",
    fullTimeEmployees: profile.fullTimeEmployees ?? null,
    businessSummary: profile.businessSummary || "",
    marketCap: numberOrNull(profile.marketCap),
    shortPercentOfFloat: numberOrNull(profile.shortPercentOfFloat),
    sharesPercentSharesOut: numberOrNull(profile.sharesPercentSharesOut),
    shortRatio: numberOrNull(profile.shortRatio),
    sharesShort: numberOrNull(profile.sharesShort),
    sharesShortPriorMonth: numberOrNull(profile.sharesShortPriorMonth),
    floatShares: numberOrNull(profile.floatShares),
    sharesOutstanding: numberOrNull(profile.sharesOutstanding),
    valuationMetrics: profile.valuationMetrics || {},
    quoteSnapshot: profile.quoteSnapshot || {},
    growthMetrics: profile.growthMetrics || {},
    fundamentalsFinancialResults: profile.fundamentalsFinancialResults || null,
    shortInterest: profile.shortInterest || null,
    profileProviderError: profile.profileProviderError || null,
    sourceProviders: sourceProviders(profile),
  };
}

function rowToProfile(row = {}, cache = {}) {
  const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
  return {
    ...metrics,
    marketCap: numberOrNull(row.market_cap) ?? numberOrNull(metrics.marketCap),
    currency: row.currency || metrics.currency || "",
    fundamentalsCache: {
      status: cache.status || "hit",
      table: "fundamental_snapshots",
      hit: Boolean(cache.hit),
      stale: Boolean(cache.stale),
      latestDate: row.period_end || "",
      updatedAt: row.updated_at || "",
      freshnessDays: cache.freshnessDays ?? null,
      maxAgeDays: cache.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
      provider: row.provider || PROFILE_PROVIDER,
      sourceProviders: metrics.sourceProviders || [],
      fallbackError: cache.fallbackError || "",
    },
  };
}

function cacheSummary(cache = {}) {
  if (!cache) return null;
  return {
    status: cache.status || "unknown",
    table: "fundamental_snapshots",
    hit: Boolean(cache.hit),
    stale: Boolean(cache.stale),
    latestDate: cache.latestDate || "",
    updatedAt: cache.updatedAt || "",
    freshnessDays: cache.freshnessDays ?? null,
    maxAgeDays: cache.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
    provider: cache.provider || PROFILE_PROVIDER,
    error: cache.error || "",
  };
}

export async function readProfileCache(symbol, options = {}) {
  const config = supabaseConfig();
  const normalized = canonicalSymbol(symbol);
  const maxAgeDays = Math.max(Number(options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS), 0);

  if (!config.configured) {
    return { status: "disabled", hit: false, row: null, maxAgeDays, error: config.missing.join(", ") };
  }
  if (!normalized) return { status: "missing-symbol", hit: false, row: null, maxAgeDays };

  try {
    const rows = await supabaseRequest("fundamental_snapshots", {
      query: {
        select: "symbol,period_end,period_type,provider,currency,market_cap,metrics,updated_at",
        owner_id: `eq.${config.ownerId}`,
        symbol: `eq.${normalized}`,
        period_type: `eq.${PROFILE_PERIOD_TYPE}`,
        order: "updated_at.desc",
        limit: "1",
      },
      timeoutMs: Number(options.timeoutMs || DEFAULT_PROFILE_CACHE_READ_TIMEOUT_MS),
    });
    const row = rows?.[0] || null;
    const freshnessDays = row?.updated_at ? ageDays(row.updated_at) : null;
    const hit = Boolean(row && freshnessDays !== null && freshnessDays <= maxAgeDays);
    return {
      status: hit ? "hit" : (row ? "stale" : "miss"),
      hit,
      stale: Boolean(row && !hit),
      row,
      latestDate: row?.period_end || "",
      updatedAt: row?.updated_at || "",
      freshnessDays,
      maxAgeDays,
      provider: row?.provider || PROFILE_PROVIDER,
    };
  } catch (error) {
    return {
      status: "error",
      hit: false,
      row: null,
      maxAgeDays,
      error: error.message || "fundamental_snapshots cache read failed",
    };
  }
}

// Lectura por lotes de la capitalización guardada en fundamental_snapshots.
//
// Por qué existe: la ficha del valor lee la capitalización de ESTA tabla en
// vivo (withProfileCache), mientras que la tabla del screener enseña la copia
// que el escaneo congeló cuando se ejecutó. Misma fuente, momentos distintos:
// en agosto de 2026 el screener decía 95,2 B y la ficha del mismo símbolo
// 90,1 B en la misma sesión, sencillamente porque el snapshot del escaneo era
// de días antes. Rehidratando la fila desde la misma tabla al servirla, las
// dos pantallas leen SIEMPRE el mismo registro.
//
// Devuelve Map<symbol, {marketCap, currency, updatedAt}> solo con los símbolos
// que tienen fila. Nunca lanza: si la lectura falla, el Map viene vacío y cada
// fila conserva el valor de su snapshot (comportamiento anterior).
export async function readMarketCapForSymbols(symbols = [], options = {}) {
  const config = supabaseConfig();
  const clean = [...new Set((symbols || []).map(canonicalSymbol).filter(Boolean))];
  const bySymbol = new Map();
  if (!config.configured || !clean.length) return { configured: config.configured, bySymbol };
  const chunkSize = Math.min(Math.max(Number(options.chunkSize || 200), 1), 400);
  const chunks = [];
  for (let i = 0; i < clean.length; i += chunkSize) chunks.push(clean.slice(i, i + chunkSize));
  // Los lotes van en paralelo acotado, no en fila india. Con el universo
  // entero (3.312 símbolos) son 17 lotes: en serie se pagaban uno detrás de
  // otro dentro de la petición de arranque, que es la más cara de la app.
  // El tope de concurrencia evita abrir 17 conexiones a la vez contra
  // Supabase.
  const concurrency = Math.min(Math.max(Number(options.concurrency || 4), 1), 8);
  for (let i = 0; i < chunks.length; i += concurrency) {
    const pages = await Promise.all(chunks.slice(i, i + concurrency).map((chunk) => supabaseRequest("fundamental_snapshots", {
      query: {
        select: "symbol,market_cap,currency,updated_at",
        owner_id: `eq.${config.ownerId}`,
        symbol: `in.(${chunk.join(",")})`,
        period_type: `eq.${PROFILE_PERIOD_TYPE}`,
        order: "symbol.asc,updated_at.desc",
        limit: String(chunk.length * 8),
      },
      timeoutMs: Number(options.timeoutMs || DEFAULT_PROFILE_CACHE_READ_TIMEOUT_MS),
      // fail-open por lote, como antes: un lote que falla deja a sus filas con
      // la capitalización del snapshot, no tumba a los demás.
    }).catch(() => [])));
    // Orden symbol.asc,updated_at.desc: la primera fila de cada símbolo es la
    // más reciente, exactamente la que devolvería readProfileCache.
    for (const rows of pages) {
      for (const row of rows || []) {
        const symbol = canonicalSymbol(row.symbol);
        if (!symbol || bySymbol.has(symbol)) continue;
        const marketCap = numberOrNull(row.market_cap);
        if (marketCap === null) continue;
        bySymbol.set(symbol, { marketCap, currency: row.currency || "", updatedAt: row.updated_at || "" });
      }
    }
  }
  return { configured: true, bySymbol };
}

// Sustituye la capitalización congelada de la fila por la de la caché
// compartida. Si no hay entrada para el símbolo, la fila no se toca.
export function attachCachedMarketCap(row, marketCapBySymbol) {
  const entry = marketCapBySymbol?.get(canonicalSymbol(row?.symbol));
  if (!entry || !Number.isFinite(entry.marketCap)) return row;
  if (row.marketCap === entry.marketCap) return row;
  return {
    ...row,
    marketCap: entry.marketCap,
    marketCapAsOf: entry.updatedAt,
    marketCapSource: "fundamental_snapshots",
  };
}

// Lectura por lotes de sector/industria/summary para asignación de theme RS.
export async function readProfilesForSymbols(symbols = [], options = {}) {
  const config = supabaseConfig();
  const clean = [...new Set((symbols || []).map(canonicalSymbol).filter(Boolean))];
  const bySymbol = new Map();
  if (!config.configured || !clean.length) return { configured: config.configured, bySymbol };

  const chunkSize = Math.min(Math.max(Number(options.chunkSize || 200), 1), 400);
  const chunks = [];
  for (let i = 0; i < clean.length; i += chunkSize) chunks.push(clean.slice(i, i + chunkSize));
  const concurrency = Math.min(Math.max(Number(options.concurrency || 4), 1), 8);

  for (let i = 0; i < chunks.length; i += concurrency) {
    const pages = await Promise.all(chunks.slice(i, i + concurrency).map((chunk) => supabaseRequest("fundamental_snapshots", {
      query: {
        select: "symbol,metrics,updated_at",
        owner_id: `eq.${config.ownerId}`,
        symbol: `in.(${chunk.join(",")})`,
        period_type: `eq.${PROFILE_PERIOD_TYPE}`,
        order: "symbol.asc,updated_at.desc",
        limit: String(chunk.length * 8),
      },
      timeoutMs: Number(options.timeoutMs || DEFAULT_PROFILE_CACHE_READ_TIMEOUT_MS),
    }).catch(() => [])));

    for (const rows of pages) {
      for (const row of rows || []) {
        const symbol = canonicalSymbol(row.symbol);
        if (!symbol || bySymbol.has(symbol)) continue;
        const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
        bySymbol.set(symbol, {
          sector: String(metrics.sector || "").trim(),
          industry: String(metrics.industry || "").trim(),
          businessSummary: String(metrics.businessSummary || "").trim(),
          updatedAt: row.updated_at || "",
        });
      }
    }
  }

  return { configured: true, bySymbol };
}

export async function writeProfileCache(symbol, profile = {}) {
  const config = supabaseConfig();
  const normalized = canonicalSymbol(symbol);
  if (!config.configured) return { status: "disabled", written: false, count: 0, error: config.missing.join(", ") };
  if (!normalized) return { status: "missing-symbol", written: false, count: 0 };
  if (!usefulProfile(profile)) return { status: "skipped-low-signal", written: false, count: 0 };

  const metrics = profileMetrics(profile);
  const periodEnd = today();
  const row = {
    owner_id: config.ownerId,
    symbol: normalized,
    period_end: periodEnd,
    period_type: PROFILE_PERIOD_TYPE,
    provider: PROFILE_PROVIDER,
    currency: metrics.currency || null,
    market_cap: metrics.marketCap,
    metrics,
    raw: {
      cachedBy: "StatsEdge",
      normalizedOnly: true,
      sourceProviders: metrics.sourceProviders,
    },
    updated_at: new Date().toISOString(),
  };

  try {
    await supabaseRequest("fundamental_snapshots", {
      method: "POST",
      query: "on_conflict=owner_id,symbol,period_end,period_type,provider",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [row],
    });
    return { status: "supabase", written: true, count: 1, provider: PROFILE_PROVIDER, periodEnd };
  } catch (error) {
    return { status: "error", written: false, count: 0, error: error.message || "fundamental_snapshots cache write failed" };
  }
}

/**
 * Añade la fecha de salida a bolsa a la fila de perfil que YA existe, sin
 * tocar `updated_at` ni `period_end`.
 *
 * No usa writeProfileCache a propósito. Ese sella `period_end = hoy` y
 * `updated_at = ahora`, y readProfileCache decide el acierto de caché por
 * `ageDays(updated_at) <= maxAgeDays`: reescribir la fila con un perfil que
 * salió de la caché haría pasar por frescos unos fundamentales viejos y
 * aplazaría el refresco real de sector, industria y crecimiento hasta
 * `maxAgeDays` después. La fecha de la IPO es un dato inmutable que no
 * justifica reiniciar ese reloj.
 *
 * Devuelve un estado descriptivo en vez de lanzar: los dos llamadores (el
 * nocturno y scripts/backfill-ipo-date.mjs) lo tratan como best-effort.
 *
 * @param {string} symbol
 * @param {{ipoDate?: string, ipoDateSource?: string|null}} resolved
 */
export async function patchProfileCacheIpoDate(symbol, resolved = {}) {
  const config = supabaseConfig();
  const normalized = canonicalSymbol(symbol);
  const ipoDate = String(resolved.ipoDate || "").trim();
  if (!config.configured) return { status: "disabled", written: false };
  if (!normalized) return { status: "missing-symbol", written: false };
  if (!ipoDate) return { status: "sin-fecha", written: false };

  const rows = await supabaseRequest("fundamental_snapshots", {
    query: {
      select: "symbol,period_end,period_type,provider,metrics",
      owner_id: `eq.${config.ownerId}`,
      symbol: `eq.${normalized}`,
      period_type: `eq.${PROFILE_PERIOD_TYPE}`,
      order: "updated_at.desc",
      limit: "1",
    },
  });
  const row = rows?.[0];
  // Sin fila de perfil no se inventa una: la creará el propio escaneo cuando
  // pida el perfil en vivo, y entonces la fecha ya viaja dentro (lib/yahoo.js).
  if (!row) return { status: "sin-fila-de-perfil", written: false };

  const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
  if (String(metrics.ipoDate || "").trim() === ipoDate) return { status: "ya-estaba", written: false };

  await supabaseRequest("fundamental_snapshots", {
    method: "PATCH",
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `symbol=eq.${encodeURIComponent(row.symbol)}`,
      `period_end=eq.${encodeURIComponent(row.period_end)}`,
      `period_type=eq.${encodeURIComponent(row.period_type)}`,
      `provider=eq.${encodeURIComponent(row.provider)}`,
    ].join("&"),
    prefer: "return=minimal",
    body: { metrics: { ...metrics, ipoDate, ipoDateSource: resolved.ipoDateSource || null } },
  });
  return { status: "escrita", written: true };
}

export async function withProfileCache(symbol, options = {}, fetcher) {
  const useCache = options.useCache !== false;
  let cached = null;

  if (useCache && !options.refresh) {
    cached = await readProfileCache(symbol, options);
    if (cached.hit && cached.row) return rowToProfile(cached.row, cached);
  }

  try {
    const live = await fetcher(symbol, options);
    const write = useCache ? await writeProfileCache(symbol, live) : { status: "skipped-disabled", written: false, count: 0 };
    return {
      ...live,
      fundamentalsCache: {
        read: cacheSummary(cached),
        write,
      },
    };
  } catch (error) {
    if (cached?.row) {
      return rowToProfile(cached.row, {
        ...cached,
        stale: true,
        status: cached.status === "hit" ? "stale-fallback" : cached.status,
        fallbackError: error.message || "live fundamentals provider failed",
      });
    }
    throw error;
  }
}
