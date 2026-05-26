import { buildShadowUniverseReport } from "@/lib/shadowUniverse";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const marketParam = searchParams.get("markets") || searchParams.get("market") || "";
  const markets = marketParam ? marketParam.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) : [];
  const refresh = searchParams.get("refresh") === "1";
  const maxAgeHours = Math.max(1, Math.min(Number(searchParams.get("maxAgeHours") || 24), 168));
  try {
    return Response.json(await buildShadowUniverseReport({ markets, refresh, maxAgeHours }));
  } catch (error) {
    return Response.json({ error: error.message || "Shadow Universe unavailable" }, { status: 502 });
  }
}
