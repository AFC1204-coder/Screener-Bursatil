import { getUniverseEngineSnapshot } from "@/lib/universeEngine";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const marketParam = searchParams.get("market") || searchParams.get("markets") || "US";
  const markets = marketParam.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const refresh = searchParams.get("refresh") === "1";
  try {
    const snapshot = await getUniverseEngineSnapshot({ markets, refresh });
    return Response.json({
      market: snapshot.markets.join(","),
      count: snapshot.count,
      totalBeforeGate: snapshot.totalBeforeGate,
      excludedCount: snapshot.excludedCount,
      source: snapshot.source,
      qualityGate: snapshot.qualityGate,
      coverage: snapshot.coverage,
      coverageReadiness: snapshot.coverageReadiness,
      providerDiagnostics: snapshot.providerDiagnostics,
      cache: snapshot.cache,
      universe: snapshot.universe,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
