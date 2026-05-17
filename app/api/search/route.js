import { searchYahooCompanies } from "@/lib/yahoo";
import { searchCuratedCompanies } from "@/lib/universes";
import { searchOpenFigiCompanies } from "@/lib/openfigi";

function mergeResults(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      const previous = map.get(item.symbol);
      map.set(item.symbol, previous ? { ...previous, ...item, score: Math.max(previous.score || 0, item.score || 0) } : item);
    }
  }
  return [...map.values()].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  if (!query) return Response.json({ error: "Missing query" }, { status: 400 });
  try {
    const [curated, yahoo] = await Promise.allSettled([
      Promise.resolve(searchCuratedCompanies(query)),
      searchYahooCompanies(query),
    ]);
    const curatedResults = curated.status === "fulfilled" ? curated.value : [];
    const yahooResults = yahoo.status === "fulfilled" ? yahoo.value : [];
    let results = mergeResults(curatedResults, yahooResults);
    const shouldResolve = !results.length || /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(String(query || "").trim());
    let openFigiResults = [];
    let openFigiError = "";
    if (shouldResolve) {
      try {
        openFigiResults = await searchOpenFigiCompanies(query);
        results = mergeResults(results, openFigiResults);
      } catch (error) {
        openFigiError = error.message || "OpenFIGI no disponible";
      }
    }
    if (!results.length && yahoo.status === "rejected" && !openFigiResults.length) throw yahoo.reason;
    return Response.json({
      query,
      results,
      providers: {
        curated: curatedResults.length,
        yahoo: yahooResults.length,
        openfigi: openFigiResults.length,
        openfigiError: openFigiError || null,
      },
    });
  } catch (err) {
    return Response.json({ error: err.message || "Search provider unavailable" }, { status: 502 });
  }
}
