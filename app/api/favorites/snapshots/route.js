// GET /api/favorites/snapshots?days=120 — series históricas de favorite_snapshots
// agrupadas por símbolo, para la sparkline favorito-vs-benchmark de research-desk.
import { disabledPayload, requirePersistenceAuth, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json({ ...disabledPayload(), snapshots: {} });
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get("days") || 120), 1), 730);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  try {
    const rows = await supabaseRequest("favorite_snapshots", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&captured_at=gte.${encodeURIComponent(since)}&select=symbol,captured_at,price,benchmark_symbol,benchmark_price,metrics&order=captured_at.asc&limit=10000`,
    });
    const snapshots = {};
    for (const row of rows) {
      const symbol = String(row.symbol || "").toUpperCase();
      if (!symbol) continue;
      (snapshots[symbol] ??= []).push({
        capturedAt: row.captured_at,
        price: Number.isFinite(Number(row.price)) ? Number(row.price) : null,
        benchmarkSymbol: row.benchmark_symbol || "",
        benchmarkPrice: Number.isFinite(Number(row.benchmark_price)) ? Number(row.benchmark_price) : null,
        alpha: Number.isFinite(Number(row.metrics?.alpha)) ? Number(row.metrics.alpha) : null,
      });
    }
    return Response.json({ ok: true, configured: true, days, snapshots });
  } catch (error) {
    return Response.json({ ok: false, configured: true, error: error.message, snapshots: {} }, { status: 500 });
  }
}
