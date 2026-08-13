import { disabledPayload, finiteOrNull, requirePersistenceAuth, supabaseConfig, supabaseRequest, supabaseRpc, textOrNull, toDate, toTimestamp } from "@/lib/supabaseServer";

function favoritePayload(favorite = {}, ownerId) {
  const performance = {
    perfSinceAdd: favorite.perfSinceAdd ?? null,
    benchmarkEntry: favorite.benchmarkEntry ?? null,
    benchmarkLast: favorite.benchmarkLast ?? null,
    benchmarkPerf: favorite.benchmarkPerf ?? null,
    alpha: favorite.alpha ?? null,
  };
  return {
    owner_id: ownerId,
    local_id: textOrNull(favorite.id) || crypto.randomUUID(),
    symbol: textOrNull(favorite.symbol) || "-",
    company_name: textOrNull(favorite.companyName || favorite.symbol),
    country: textOrNull(favorite.country),
    sector: textOrNull(favorite.sector),
    industry: textOrNull(favorite.industry),
    added_at: toTimestamp(favorite.addedAt),
    entry_price: finiteOrNull(favorite.entryPrice),
    last_price: finiteOrNull(favorite.lastPrice),
    last_date: toDate(favorite.lastDate),
    source: textOrNull(favorite.source) || "manual",
    notes: favorite.notes || "",
    market_score: finiteOrNull(favorite.marketScore),
    market_regime: textOrNull(favorite.marketRegime),
    snapshot: favorite.snapshot || {},
    benchmark_symbol: textOrNull(favorite.benchmarkSymbol || favorite.snapshot?.benchmarkSymbol),
    performance,
    current_state: textOrNull(favorite.currentState),
    error: textOrNull(favorite.error),
    updated_at: toTimestamp(favorite.updatedAt || favorite.updated_at || favorite.addedAt || favorite.added_at),
  };
}

function favoriteFromDb(row = {}) {
  return {
    id: row.local_id || row.id,
    cloudId: row.id,
    symbol: row.symbol,
    companyName: row.company_name || row.symbol,
    country: row.country,
    sector: row.sector,
    industry: row.industry,
    addedAt: row.added_at,
    entryPrice: finiteOrNull(row.entry_price),
    lastPrice: finiteOrNull(row.last_price),
    lastDate: row.last_date,
    source: row.source,
    notes: row.notes || "",
    marketScore: finiteOrNull(row.market_score),
    marketRegime: row.market_regime || "sin dato",
    snapshot: row.snapshot || {},
    benchmarkSymbol: row.benchmark_symbol,
    perfSinceAdd: finiteOrNull(row.performance?.perfSinceAdd),
    benchmarkEntry: finiteOrNull(row.performance?.benchmarkEntry),
    benchmarkLast: finiteOrNull(row.performance?.benchmarkLast),
    benchmarkPerf: finiteOrNull(row.performance?.benchmarkPerf),
    alpha: finiteOrNull(row.performance?.alpha),
    currentState: row.current_state,
    error: row.error,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function favoriteTombstoneFromDb(row = {}) {
  return {
    id: row.local_id || row.id,
    cloudId: row.id,
    symbol: row.symbol,
    deletedAt: row.deleted_at || row.updated_at,
    updatedAt: row.updated_at || row.deleted_at,
  };
}

function timestampValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function favoriteSyncSummary(rows = [], payloads = []) {
  const incomingBySymbol = new Map();
  for (const payload of payloads) {
    const symbol = String(payload?.symbol || "").trim().toUpperCase();
    if (!symbol) continue;
    const incomingTime = timestampValue(payload?.updated_at);
    const currentTime = incomingBySymbol.get(symbol) || 0;
    if (incomingTime >= currentTime) incomingBySymbol.set(symbol, incomingTime);
  }

  const skippedStale = rows.reduce((count, row) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (!incomingBySymbol.has(symbol)) return count;
    return timestampValue(row?.updated_at) > incomingBySymbol.get(symbol) ? count + 1 : count;
  }, 0);
  return {
    saved: Math.max(rows.length - skippedStale, 0),
    returned: rows.length,
    skippedStale,
  };
}

export function favoriteDeleteSummary(rows = [], tombstones = []) {
  const incomingBySymbol = new Map();
  const incomingByLocalId = new Map();
  for (const tombstone of tombstones) {
    const deletedAt = timestampValue(tombstone?.deletedAt || tombstone?.deleted_at || tombstone?.updatedAt || tombstone?.updated_at);
    const symbol = String(tombstone?.symbol || "").trim().toUpperCase();
    const localId = String(tombstone?.id || tombstone?.localId || tombstone?.local_id || "").trim();
    if (symbol) incomingBySymbol.set(symbol, Math.max(incomingBySymbol.get(symbol) || 0, deletedAt));
    if (localId) incomingByLocalId.set(localId, Math.max(incomingByLocalId.get(localId) || 0, deletedAt));
  }

  const skippedStale = rows.reduce((count, row) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    const localId = String(row?.local_id || row?.localId || row?.id || "").trim();
    const incomingTime = incomingBySymbol.get(symbol) || incomingByLocalId.get(localId) || 0;
    if (!incomingTime) return count;
    const rowTime = timestampValue(row?.updated_at || row?.updatedAt);
    return !row?.deleted_at && rowTime > incomingTime ? count + 1 : count;
  }, 0);

  return {
    deleted: Math.max(rows.length - skippedStale, 0),
    returned: rows.length,
    skippedStale,
  };
}

function favoriteSyncError(error = {}) {
  const code = error.details?.code;
  const message = error.message || "";
  if (code === "PGRST202" || /(upsert_favorites_newer_wins|delete_favorite_newer_wins)/i.test(message)) {
    return "La sincronización de favoritos no está disponible en este entorno.";
  }
  return message || "No se pudieron sincronizar favoritos";
}

function favoriteTombstonePayload(input = {}, fallback = {}) {
  return {
    symbol: textOrNull(input.symbol || fallback.symbol),
    localId: textOrNull(input.localId || input.local_id || input.id || fallback.localId || fallback.local_id || fallback.id),
    deletedAt: toTimestamp(input.deletedAt || input.deleted_at || input.updatedAt || input.updated_at || fallback.deletedAt || fallback.deleted_at),
  };
}

async function deleteFavoriteRows(tombstones = [], ownerId) {
  const rows = [];
  for (const tombstone of tombstones) {
    const savedRows = await supabaseRpc("delete_favorite_newer_wins", {
      p_owner_id: ownerId,
      p_symbol: tombstone.symbol || null,
      p_local_id: tombstone.localId || null,
      p_deleted_at: tombstone.deletedAt,
    });
    if (Array.isArray(savedRows)) rows.push(...savedRows);
  }
  return rows;
}

export async function GET(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json({ ...disabledPayload(), favorites: [] });
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || 250), 500);
  const includeDeleted = searchParams.get("includeDeleted") === "1";
  try {
    const rows = await supabaseRequest("favorites", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}${includeDeleted ? "" : "&deleted_at=is.null"}&select=*&order=added_at.desc&limit=${limit}`,
    });
    const activeRows = rows.filter((row) => !row.deleted_at);
    const deletedRows = rows.filter((row) => row.deleted_at);
    return Response.json({
      configured: true,
      ok: true,
      favorites: activeRows.map(favoriteFromDb),
      favoriteTombstones: includeDeleted ? deletedRows.map(favoriteTombstoneFromDb) : [],
    });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}

export async function POST(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  try {
    const body = await req.json();
    const favorites = body.favorites || (body.favorite ? [body.favorite] : []);
    const payloads = favorites.map((favorite) => favoritePayload(favorite, config.ownerId));
    const savedRows = await supabaseRpc("upsert_favorites_newer_wins", {
      p_owner_id: config.ownerId,
      p_favorites: payloads,
    });
    const saved = Array.isArray(savedRows) ? savedRows : [];
    const summary = favoriteSyncSummary(saved, payloads);
    return Response.json({ configured: true, ok: true, ...summary, favorites: saved.filter((row) => !row.deleted_at).map(favoriteFromDb) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: favoriteSyncError(error), details: error.details || null }, { status: 500 });
  }
}

export async function DELETE(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const symbol = searchParams.get("symbol");
  try {
    const body = await req.json().catch(() => ({}));
    const tombstones = Array.isArray(body?.tombstones) && body.tombstones.length
      ? body.tombstones.map((item) => favoriteTombstonePayload(item))
      : [favoriteTombstonePayload({ id, symbol, deletedAt: searchParams.get("deletedAt") })];
    const validTombstones = tombstones.filter((item) => item.symbol || item.localId);
    if (!validTombstones.length) return Response.json({ error: "Falta id o symbol" }, { status: 400 });
    const rows = await deleteFavoriteRows(validTombstones, config.ownerId);
    const summary = favoriteDeleteSummary(rows, validTombstones);
    return Response.json({
      configured: true,
      ok: true,
      ...summary,
      favorites: rows.filter((row) => !row.deleted_at).map(favoriteFromDb),
      favoriteTombstones: rows.filter((row) => row.deleted_at).map(favoriteTombstoneFromDb),
    });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: favoriteSyncError(error), details: error.details || null }, { status: 500 });
  }
}
