import { disabledPayload, finiteOrNull, supabaseConfig, supabaseRequest, textOrNull, toDate, toTimestamp } from "@/lib/supabaseServer";

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
    updated_at: new Date().toISOString(),
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
  };
}

export async function GET(req) {
  const config = supabaseConfig();
  if (!config.configured) return Response.json({ ...disabledPayload(), favorites: [] });
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || 250), 500);
  try {
    const rows = await supabaseRequest("favorites", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&select=*&order=added_at.desc&limit=${limit}`,
    });
    return Response.json({ configured: true, ok: true, favorites: rows.map(favoriteFromDb) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}

export async function POST(req) {
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  try {
    const body = await req.json();
    const favorites = body.favorites || (body.favorite ? [body.favorite] : []);
    const saved = await supabaseRequest("favorites", {
      method: "POST",
      query: "on_conflict=owner_id,symbol",
      prefer: "resolution=merge-duplicates,return=representation",
      body: favorites.map((favorite) => favoritePayload(favorite, config.ownerId)),
    });
    return Response.json({ configured: true, ok: true, saved: saved.length, favorites: saved.map(favoriteFromDb) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}

export async function DELETE(req) {
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const symbol = searchParams.get("symbol");
  if (!id && !symbol) return Response.json({ error: "Falta id o symbol" }, { status: 400 });
  const filter = id ? `local_id=eq.${encodeURIComponent(id)}` : `symbol=eq.${encodeURIComponent(symbol.toUpperCase())}`;
  try {
    await supabaseRequest("favorites", {
      method: "DELETE",
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&${filter}`,
    });
    return Response.json({ configured: true, ok: true });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}
