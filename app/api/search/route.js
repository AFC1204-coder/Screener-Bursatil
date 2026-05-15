import { searchYahooCompanies } from "@/lib/yahoo";
import { searchCuratedCompanies } from "@/lib/universes";

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
    if (!curatedResults.length && !yahooResults.length && yahoo.status === "rejected") throw yahoo.reason;
    const results = mergeResults(curatedResults, yahooResults);
    return Response.json({ query, results });
  } catch (err) {
    return Response.json({ error: err.message || "Search provider unavailable" }, { status: 502 });
  }
}
