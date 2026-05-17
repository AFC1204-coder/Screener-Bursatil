import { openFigiStatus, searchOpenFigiCompanies } from "@/lib/openfigi";
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
    const [curated, openfigi] = await Promise.allSettled([
      Promise.resolve(searchCuratedCompanies(query)),
      searchOpenFigiCompanies(query),
    ]);
    const curatedResults = curated.status === "fulfilled" ? curated.value : [];
    const openFigiResults = openfigi.status === "fulfilled" ? openfigi.value : [];
    return Response.json({
      query,
      results: mergeResults(curatedResults, openFigiResults),
      providers: {
        curated: curatedResults.length,
        openfigi: openFigiResults.length,
        openfigiStatus: openFigiStatus(),
        openfigiError: openfigi.status === "rejected" ? openfigi.reason?.message || "OpenFIGI no disponible" : null,
      },
    });
  } catch (err) {
    return Response.json({ error: err.message || "Symbol resolver unavailable" }, { status: 502 });
  }
}
