import { readGlobalRsSeriesForSymbol } from "@/lib/globalRs";

function numberParam(searchParams, key, fallback, min, max) {
  const raw = searchParams.get(key);
  const n = raw === null || raw === "" ? fallback : Number(raw);
  const value = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(value, min), max);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return Response.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  try {
    const data = await readGlobalRsSeriesForSymbol(symbol, {
      limit: numberParam(searchParams, "limit", 180, 1, 260),
    });
    return Response.json({ ok: true, ...data });
  } catch (error) {
    return Response.json({
      ok: true,
      configured: false,
      series: [],
      latest: null,
      error: error.message || "Weekly RS unavailable",
    });
  }
}
