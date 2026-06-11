import { fetchYahooProfile } from "@/lib/marketData";
import { findSimilarStocks } from "@/lib/peers";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "";
  const fallback = {
    symbol,
    name: searchParams.get("name") || "",
    sector: searchParams.get("sector") || "",
    industry: searchParams.get("industry") || "",
    theme: searchParams.get("theme") || "",
    country: searchParams.get("country") || "",
  };
  if (!symbol && !fallback.sector && !fallback.industry && !fallback.theme) {
    return Response.json({ error: "Missing symbol or classification" }, { status: 400 });
  }
  try {
    let target = fallback;
    if (symbol) {
      const profile = await fetchYahooProfile(symbol).catch(() => ({}));
      target = {
        ...fallback,
        name: profile.name || fallback.name,
        sector: profile.sector || fallback.sector,
        industry: profile.industry || fallback.industry,
        country: profile.country || fallback.country,
      };
    }
    return Response.json({ target, results: findSimilarStocks(target) });
  } catch (err) {
    return Response.json({ error: err.message || "Similar provider unavailable" }, { status: 502 });
  }
}
