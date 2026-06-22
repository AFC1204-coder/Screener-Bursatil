import { isInternalRequest } from "@/lib/internalAuth";
import { normalizeMarketList } from "@/lib/markets";
import { fetchEsmaFirdsReferenceUniverse, fetchFcaFirdsReferenceUniverse, fetchFcaFirdsUniverse, fetchFirdsUniverse } from "@/lib/officialUniverses";
import { upsertShadowInstruments, upsertSymbolResolutions } from "@/lib/shadowUniverseStore";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";
import { getUniverseEngineSnapshot } from "@/lib/universeEngine";

const DEFAULT_MARKETS = ["DE", "FR", "IT", "FI", "SE", "DK", "NO", "NL", "ES"];
const ESMA_FIRDS_MARKETS = new Set(["AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE"]);
const FCA_FIRDS_MARKETS = new Set(["GB"]);
const ALL_FIRDS_MARKETS = new Set([...ESMA_FIRDS_MARKETS, ...FCA_FIRDS_MARKETS]);

function authorized(request) {
  return isInternalRequest(request, { allowCron: true });
}

function boolParam(searchParams, key, fallback = false) {
  const raw = searchParams.get(key);
  if (raw === null) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function numberParam(searchParams, key, fallback, min, max) {
  const raw = searchParams.get(key);
  const value = raw === null || raw === "" ? fallback : Number(raw);
  return Math.min(Math.max(Number.isFinite(value) ? value : fallback, min), max);
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sourceParam(searchParams) {
  const source = cleanText(searchParams.get("source") || searchParams.get("provider")).toLowerCase();
  return ["esma", "fca"].includes(source) ? source : "auto";
}

function allowedMarketForSource(market, source = "auto") {
  if (source === "esma") return ESMA_FIRDS_MARKETS.has(market);
  if (source === "fca") return FCA_FIRDS_MARKETS.has(market);
  return ALL_FIRDS_MARKETS.has(market);
}

function referenceProviderForMarket(market) {
  return market === "GB" ? "fca-firds" : "esma-firds";
}

function sourceLabelForMarket(market) {
  return market === "GB" ? "FCA FIRDS + OpenFIGI" : "ESMA FIRDS + OpenFIGI";
}

function defaultMarketsForSource(source = "auto") {
  return source === "fca" ? ["GB"] : DEFAULT_MARKETS;
}

function optionsFromRequest(request) {
  const { searchParams } = new URL(request.url);
  const source = sourceParam(searchParams);
  const fallback = defaultMarketsForSource(source);
  const markets = normalizeMarketList(searchParams.get("markets") || searchParams.get("market") || fallback, [])
    .filter((market) => allowedMarketForSource(market, source));
  return {
    source,
    markets: markets.length ? markets : fallback,
    dryRun: boolParam(searchParams, "dryRun", false),
    resolve: searchParams.get("resolve") !== "0",
    persist: !boolParam(searchParams, "dryRun", false) && searchParams.get("persist") !== "0",
    includeSymbols: boolParam(searchParams, "includeSymbols", false),
    maxFiles: numberParam(searchParams, "maxFiles", 1, 1, 2),
    scanLimit: numberParam(searchParams, "scanLimit", 750000, 1000, 2000000),
    referenceLimit: numberParam(searchParams, "referenceLimit", 5000, 1, 50000),
    referenceOffset: numberParam(searchParams, "referenceOffset", 0, 0, 500000),
    resolveLimit: numberParam(searchParams, "resolveLimit", 25, 0, 250),
    searchTimeoutMs: numberParam(searchParams, "searchTimeoutMs", 12000, 1000, 60000),
    downloadTimeoutMs: numberParam(searchParams, "downloadTimeoutMs", 90000, 1000, 120000),
  };
}

async function createRun(options) {
  const config = supabaseConfig();
  if (!config.configured) return null;
  try {
    const [run] = await supabaseRequest("provider_runs", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        owner_id: config.ownerId,
        provider: options.source === "fca" ? "fca-firds" : options.source === "esma" ? "esma-firds" : "firds",
        run_type: "shadow-firds-refresh",
        market: options.markets.join(","),
        status: "started",
        stats: options,
      }],
    });
    return run;
  } catch {
    return null;
  }
}

async function finishRun(run, status, payload = {}) {
  if (!run?.id) return;
  try {
    await supabaseRequest("provider_runs", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(run.id)}`,
      prefer: "return=minimal",
      body: {
        status,
        finished_at: new Date().toISOString(),
        stats: payload.stats || {},
        error: payload.error || null,
      },
    });
  } catch {
    // Provider run logs should never block the job.
  }
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const options = optionsFromRequest(request);
  const run = await createRun(options);
  try {
    const current = await getUniverseEngineSnapshot({ markets: options.markets, refresh: false, maxAgeHours: 24 }).catch(() => null);
    const currentByMarket = current?.coverage?.byMarket || {};
    const rows = [];
    const persistErrors = [];
    for (const market of options.markets) {
      const referenceProvider = referenceProviderForMarket(market);
      const fetchReferences = market === "GB" ? fetchFcaFirdsReferenceUniverse : fetchEsmaFirdsReferenceUniverse;
      const fetchResolved = market === "GB" ? fetchFcaFirdsUniverse : fetchFirdsUniverse;
      const references = await fetchReferences(market, {
        enabled: true,
        maxFiles: options.maxFiles,
        scanLimit: options.scanLimit,
        referenceLimit: options.referenceLimit,
        referenceOffset: options.referenceOffset,
        searchTimeoutMs: options.searchTimeoutMs,
        downloadTimeoutMs: options.downloadTimeoutMs,
      });
      const resolved = options.resolve
        ? await fetchResolved(market, {
          enabled: true,
          maxFiles: options.maxFiles,
          scanLimit: options.scanLimit,
          referenceLimit: options.referenceLimit,
          referenceOffset: options.referenceOffset,
          resolveLimit: options.resolveLimit,
          searchTimeoutMs: options.searchTimeoutMs,
          downloadTimeoutMs: options.downloadTimeoutMs,
        })
        : [];
      let referenceWrite = { status: options.persist ? "pending" : "skipped", written: 0 };
      let resolutionWrite = { status: options.persist ? "pending" : "skipped", written: 0 };
      if (options.persist) {
        try {
          referenceWrite = await upsertShadowInstruments(references, { provider: referenceProvider });
          resolutionWrite = options.resolve ? await upsertSymbolResolutions(resolved) : { status: "skipped", written: 0 };
        } catch (error) {
          const message = error.message || "Shadow persistence failed";
          persistErrors.push({ market, error: message });
          referenceWrite = { status: "error", written: 0, error: message };
          resolutionWrite = { status: "error", written: 0, error: message };
        }
      }
      const result = {
        market,
        currentScannable: Number(currentByMarket[market] || 0),
        hiddenReference: references.length,
        resolvedCandidates: resolved.length,
        persistedReference: Number(referenceWrite.written || 0),
        persistedResolutions: Number(resolutionWrite.written || 0),
        persistence: {
          enabled: options.persist,
          references: referenceWrite.status,
          resolutions: resolutionWrite.status,
          error: referenceWrite.error || resolutionWrite.error || null,
        },
        referenceProvider,
        source: sourceLabelForMarket(market),
      };
      if (options.includeSymbols) {
        result.resolvedSymbols = resolved.map((row) => ({ symbol: row.symbol, name: row.name, isin: row.isin })).slice(0, options.resolveLimit);
      }
      rows.push(result);
    }
    const stats = {
      dryRun: options.dryRun,
      persisted: options.persist,
      source: options.source,
      markets: options.markets,
      maxFiles: options.maxFiles,
      scanLimit: options.scanLimit,
      referenceLimit: options.referenceLimit,
      referenceOffset: options.referenceOffset,
      resolveLimit: options.resolveLimit,
      searchTimeoutMs: options.searchTimeoutMs,
      downloadTimeoutMs: options.downloadTimeoutMs,
      currentScannable: rows.reduce((sum, row) => sum + row.currentScannable, 0),
      hiddenReference: rows.reduce((sum, row) => sum + row.hiddenReference, 0),
      resolvedCandidates: rows.reduce((sum, row) => sum + row.resolvedCandidates, 0),
      persistedReference: rows.reduce((sum, row) => sum + row.persistedReference, 0),
      persistedResolutions: rows.reduce((sum, row) => sum + row.persistedResolutions, 0),
      persistErrors,
      legalMode: "internal-shadow-aggregate-only",
    };
    await finishRun(run, options.dryRun ? "dry-run" : persistErrors.length ? "completed-with-warnings" : "completed", { stats });
    return Response.json({
      ok: true,
      job: "shadow-firds-refresh",
      message: "FIRDS se ha ejecutado como universo oculto agregado. No expone directorios completos al usuario.",
      ...stats,
      rows,
    });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message, stats: { markets: options.markets } });
    return Response.json({ ok: false, error: error.message || "Shadow FIRDS refresh failed" }, { status: 502 });
  }
}

export const POST = GET;
