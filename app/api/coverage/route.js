import { buildCoverageReport, CORE_COVERAGE_MARKETS } from "@/lib/coveragePlan";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const marketParam = searchParams.get("markets") || searchParams.get("market") || "";
  const markets = marketParam ? marketParam.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) : CORE_COVERAGE_MARKETS;
  const refresh = searchParams.get("refresh") === "1";
  const maxAgeHours = Math.max(1, Math.min(Number(searchParams.get("maxAgeHours") || 24), 168));
  try {
    return Response.json(await buildCoverageReport({ markets, refresh, maxAgeHours }));
  } catch (error) {
    return Response.json({ error: error.message || "Coverage report unavailable" }, { status: 502 });
  }
}
