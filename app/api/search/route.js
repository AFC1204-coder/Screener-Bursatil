import { searchYahooCompanies } from "@/lib/yahoo";
import { searchCuratedCompanies } from "@/lib/universes";
import { searchOpenFigiCompanies } from "@/lib/openfigi";

const SEARCH_PROVIDER_TIMEOUT_MS = 3500;

function timeoutResult(provider) {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ status: "timeout", provider, value: [], reason: `${provider} timeout` }), SEARCH_PROVIDER_TIMEOUT_MS);
  });
}

async function settledWithTimeout(provider, promise) {
  return Promise.race([
    promise.then((value) => ({ status: "fulfilled", provider, value })).catch((reason) => ({ status: "rejected", provider, value: [], reason })),
    timeoutResult(provider),
  ]);
}

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
    const curatedResults = searchCuratedCompanies(query);
    const yahoo = await settledWithTimeout("yahoo", searchYahooCompanies(query));
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
        yahooStatus: yahoo.status,
        openfigi: openFigiResults.length,
        openfigiError: openFigiError || null,
      },
    });
  } catch (err) {
    return Response.json({ error: err.message || "Search provider unavailable" }, { status: 502 });
  }
}
