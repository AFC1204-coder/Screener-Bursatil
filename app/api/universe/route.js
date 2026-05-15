import { getUniverse } from "@/lib/universes";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get("market") || "US";
  try {
    const universe = await getUniverse(market);
    return Response.json({
      market,
      count: universe.length,
      source: market.toUpperCase() === "US" ? "NasdaqTrader public symbol directories" : "Curated + expanded Yahoo-format universe",
      universe,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
