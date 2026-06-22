// GET /api/cron/favorite-snapshots — snapshot diario de favoritos (Vercel Cron 22:30 UTC,
// tras el cierre US). Para cada favorito del owner obtiene precio actual y el del
// benchmark vía lib/marketData (caché TTL), inserta una fila en favorite_snapshots
// y actualiza last_price/last_date/performance en favorites.
// Auth: header x-statsedge-token (token de app) o authorization Bearer CRON_SECRET
// (Vercel Cron). El proxy deja pasar /api/cron/* y cada cron valida aquí.
// Para pruebas: ?capturedAt=<ISO> fuerza la fecha del snapshot.
import { sma } from "@/lib/indicators";
import { requireInternalAuth } from "@/lib/internalAuth";
import { fetchYahooChart } from "@/lib/marketData";
import { benchmarkForFavorite } from "@/lib/symbols";
import { disabledPayload, finiteOrNull, supabaseConfig, supabaseRequest, textOrNull } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// bars descendentes (bars[0] = última sesión): primer cierre con fecha <= objetivo.
function closeOnOrBefore(bars = [], isoDate) {
  const target = new Date(isoDate || Date.now()).toISOString().slice(0, 10);
  return bars.find((bar) => bar.date <= target && Number.isFinite(bar.close))?.close ?? bars.at(-1)?.close ?? null;
}

async function chartFor(symbol, cache) {
  if (!cache.has(symbol)) {
    cache.set(symbol, fetchYahooChart(symbol).catch(() => ({ bars: [] })));
  }
  return cache.get(symbol);
}

export async function GET(request) {
  const authError = requireInternalAuth(request, { allowCron: true });
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload(), { status: 503 });
  const { searchParams } = new URL(request.url);
  const capturedAtParam = Date.parse(searchParams.get("capturedAt") || "");
  const capturedAt = Number.isFinite(capturedAtParam) ? new Date(capturedAtParam).toISOString() : new Date().toISOString();
  try {
    const favorites = await supabaseRequest("favorites", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&deleted_at=is.null&select=id,symbol,company_name,country,added_at,entry_price,benchmark_symbol,snapshot&order=symbol.asc&limit=500`,
    });
    if (!favorites.length) return Response.json({ ok: true, favorites: 0, snapshots: 0, message: "Sin favoritos que snapshotear" });
    const chartCache = new Map();
    const snapshots = [];
    const favoritePatches = [];
    const errors = [];
    for (const favorite of favorites) {
      try {
        const benchmarkSymbol = textOrNull(favorite.benchmark_symbol) || benchmarkForFavorite({
          symbol: favorite.symbol,
          country: favorite.country,
          snapshot: favorite.snapshot || {},
        });
        const [chart, benchmarkChart] = await Promise.all([
          chartFor(favorite.symbol, chartCache),
          chartFor(benchmarkSymbol, chartCache),
        ]);
        const bars = chart.bars || [];
        if (!bars.length) throw new Error("Sin histórico de precios");
        const price = finiteOrNull(bars[0]?.close);
        if (!Number.isFinite(price)) throw new Error("Precio no disponible");
        const lastDate = bars[0]?.date || null;
        const benchmarkBars = benchmarkChart.bars || [];
        const benchmarkPrice = finiteOrNull(benchmarkBars[0]?.close);
        const entryPrice = finiteOrNull(favorite.entry_price) ?? closeOnOrBefore(bars, favorite.added_at);
        const benchmarkEntry = closeOnOrBefore(benchmarkBars, favorite.added_at);
        const perfSinceAdd = Number.isFinite(entryPrice) && entryPrice > 0 ? ((price / entryPrice) - 1) * 100 : null;
        const benchmarkPerf = Number.isFinite(benchmarkEntry) && benchmarkEntry > 0 && Number.isFinite(benchmarkPrice) ? ((benchmarkPrice / benchmarkEntry) - 1) * 100 : null;
        const alpha = Number.isFinite(perfSinceAdd) && Number.isFinite(benchmarkPerf) ? perfSinceAdd - benchmarkPerf : null;
        const sma50 = sma(bars, 50);
        const sma200 = sma(bars, 200);
        const metrics = {
          lastDate,
          entryPrice,
          benchmarkEntry,
          perfSinceAdd,
          benchmarkPerf,
          alpha,
          sma50,
          sma200,
          extSma50: Number.isFinite(sma50) && sma50 > 0 ? ((price / sma50) - 1) * 100 : null,
          aboveSma200: Number.isFinite(sma200) ? price > sma200 : null,
        };
        snapshots.push({
          owner_id: config.ownerId,
          favorite_id: favorite.id,
          symbol: favorite.symbol,
          captured_at: capturedAt,
          price,
          benchmark_symbol: benchmarkSymbol,
          benchmark_price: benchmarkPrice,
          metrics,
          raw: {},
        });
        favoritePatches.push({
          id: favorite.id,
          body: {
            last_price: price,
            last_date: lastDate,
            performance: { perfSinceAdd, benchmarkPerf, alpha, benchmarkSymbol, capturedAt },
            error: null,
            updated_at: new Date().toISOString(),
          },
        });
      } catch (error) {
        errors.push({ symbol: favorite.symbol, reason: error.message || "Proveedor no disponible" });
      }
    }
    if (snapshots.length) {
      await supabaseRequest("favorite_snapshots", { method: "POST", prefer: "return=minimal", body: snapshots });
    }
    for (const patch of favoritePatches) {
      await supabaseRequest("favorites", {
        method: "PATCH",
        query: `id=eq.${encodeURIComponent(patch.id)}&owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        prefer: "return=minimal",
        body: patch.body,
      });
    }
    return Response.json({
      ok: true,
      favorites: favorites.length,
      snapshots: snapshots.length,
      updated: favoritePatches.length,
      capturedAt,
      errors,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || "Cron favorite-snapshots falló" }, { status: 502 });
  }
}

export const POST = GET;
