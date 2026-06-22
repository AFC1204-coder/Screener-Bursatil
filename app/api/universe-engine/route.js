import { getUniverseEngineSnapshot } from "@/lib/universeEngine";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const marketParam = searchParams.get("markets") || searchParams.get("market") || "US";
  const markets = marketParam.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const refresh = searchParams.get("refresh") === "1";
  const maxAgeHours = Math.max(1, Math.min(Number(searchParams.get("maxAgeHours") || 24), 168));
  const summary = searchParams.get("summary") === "1";
  try {
    const snapshot = await getUniverseEngineSnapshot({ markets, refresh, maxAgeHours, allowCuratedFallback: summary });
    if (summary) {
      const { universe, excluded, ...rest } = snapshot;
      return Response.json(rest);
    }
    return Response.json(snapshot);
  } catch (err) {
    return Response.json({ error: err.message || "Universe Engine unavailable" }, { status: 502 });
  }
}
