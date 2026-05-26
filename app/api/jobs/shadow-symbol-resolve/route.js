import { envValue } from "@/lib/env";
import { normalizeMarketList } from "@/lib/markets";
import { mapOpenFigiIsins } from "@/lib/openfigi";
import {
  markShadowInstrumentsStatus,
  readCachedSymbolResolutions,
  readShadowInstrumentsForResolution,
  upsertSymbolResolutions,
} from "@/lib/shadowUniverseStore";
import { countryCode } from "@/lib/symbols";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_MARKETS = ["GB", "FI", "DK", "NO", "NL", "ES", "SE", "IT", "FR", "DE"];
const SUPPORTED_MARKETS = new Set(["GB", "AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE"]);

function authorized(request) {
  const secret = envValue("CRON_SECRET");
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
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

function referenceProviderForMarket(market, options = {}) {
  if (options.referenceProvider) return options.referenceProvider;
  return market === "GB" ? "fca-firds" : "esma-firds";
}

function optionsFromRequest(request) {
  const { searchParams } = new URL(request.url);
  const source = sourceParam(searchParams);
  const fallback = source === "fca" ? ["GB"] : source === "esma" ? DEFAULT_MARKETS.filter((market) => market !== "GB") : DEFAULT_MARKETS;
  const openFigiKeyConfigured = Boolean(envValue("OPENFIGI_API_KEY"));
  const perMarketMax = openFigiKeyConfigured ? 100 : 10;
  const markets = normalizeMarketList(searchParams.get("markets") || searchParams.get("market") || DEFAULT_MARKETS, [])
    .filter((market) => SUPPORTED_MARKETS.has(market))
    .filter((market) => source === "fca" ? market === "GB" : source === "esma" ? market !== "GB" : true);
  return {
    source,
    markets: markets.length ? markets : fallback,
    referenceProvider: cleanText(searchParams.get("referenceProvider")),
    dryRun: boolParam(searchParams, "dryRun", false),
    includeSymbols: boolParam(searchParams, "includeSymbols", false),
    status: cleanText(searchParams.get("status") || "reference"),
    perMarket: numberParam(searchParams, "perMarket", perMarketMax, 1, perMarketMax),
    maxMappedPerMarket: numberParam(searchParams, "maxMappedPerMarket", perMarketMax, 1, perMarketMax),
    openFigiMode: openFigiKeyConfigured ? "api-key" : "anonymous",
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
        provider: "openfigi",
        run_type: "shadow-symbol-resolve",
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
    // Run logging should never block the resolver.
  }
}

function enrichMappedRows(mapped = [], references = [], market = "") {
  const byIsin = new Map(references.map((row) => [row.isin, row]));
  return mapped
    .filter((row) => row?.isin && countryCode(row.symbol) === market)
    .map((row) => {
      const reference = byIsin.get(row.isin) || {};
      return {
        ...row,
        country: market,
        market,
        name: reference.name || row.name,
        currency: reference.currency || row.currency,
        cfiCode: reference.cfi_code || reference.cfiCode,
        tradingVenue: reference.trading_venue || reference.tradingVenue,
        relevantVenue: reference.relevant_venue || reference.relevantVenue,
        relevantAuthority: reference.relevant_authority || reference.relevantAuthority,
        source: "openfigi-isin",
      };
    });
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const options = optionsFromRequest(request);
  const run = await createRun(options);
  try {
    const rows = [];
    const errors = [];
    for (const market of options.markets) {
      const referenceProvider = referenceProviderForMarket(market, options);
      const candidates = await readShadowInstrumentsForResolution({
        market,
        provider: referenceProvider,
        status: options.status,
        limit: options.perMarket,
      });
      const references = candidates.rows || [];
      const isins = references.map((row) => row.isin).filter(Boolean);
      const cached = await readCachedSymbolResolutions({ market, isins });
      const cachedRows = cached.rows || [];
      const cachedIsins = Array.from(new Set(cachedRows.map((row) => row.isin).filter(Boolean)));
      const cachedSet = new Set(cachedIsins);
      const missingReferences = references.filter((row) => row.isin && !cachedSet.has(row.isin));
      const missingIsins = missingReferences.map((row) => row.isin).filter(Boolean);
      if (options.dryRun || !isins.length) {
        rows.push({
          market,
          referenceProvider,
          candidateStatus: candidates.status,
          candidates: isins.length,
          cached: cachedRows.length,
          openfigiRequested: options.dryRun ? missingIsins.length : 0,
          mapped: 0,
          markedResolved: 0,
          markedUnresolved: 0,
        });
        continue;
      }
      try {
        const mapped = await mapOpenFigiIsins(missingIsins, { limit: Math.min(missingIsins.length, options.maxMappedPerMarket) });
        const marketMapped = enrichMappedRows(mapped, missingReferences, market);
        const matchedIsins = Array.from(new Set(marketMapped.map((row) => row.isin)));
        const resolvedIsins = Array.from(new Set([...cachedIsins, ...matchedIsins]));
        const unresolvedIsins = missingIsins.filter((isin) => !matchedIsins.includes(isin));
        const write = await upsertSymbolResolutions(marketMapped);
        const resolvedMark = await markShadowInstrumentsStatus(resolvedIsins, {
          market,
          provider: referenceProvider,
          status: "resolved",
          raw: { stage: "openfigi-resolution", matched: true, provider: "openfigi", cacheHit: cachedIsins.length },
        });
        const unresolvedMark = await markShadowInstrumentsStatus(unresolvedIsins, {
          market,
          provider: referenceProvider,
          status: "unresolved",
          raw: { stage: "openfigi-resolution", matched: false, provider: "openfigi", reason: "no-market-symbol" },
        });
        const result = {
          market,
          referenceProvider,
          candidateStatus: candidates.status,
          candidates: isins.length,
          cached: cachedRows.length,
          openfigiRequested: missingIsins.length,
          mapped: marketMapped.length,
          persisted: Number(write.written || 0),
          markedResolved: Number(resolvedMark.written || 0),
          markedUnresolved: Number(unresolvedMark.written || 0),
        };
        if (options.includeSymbols) {
          result.symbols = [
            ...cachedRows.map((row) => ({ symbol: row.symbol, isin: row.isin, name: row.name, source: "cache" })),
            ...marketMapped.map((row) => ({ symbol: row.symbol, isin: row.isin, name: row.name, source: "openfigi" })),
          ].slice(0, 25);
        }
        rows.push(result);
      } catch (error) {
        errors.push({ market, referenceProvider, error: error.message || "OpenFIGI mapping failed" });
        rows.push({
          market,
          referenceProvider,
          candidateStatus: candidates.status,
          candidates: isins.length,
          cached: cachedRows.length,
          openfigiRequested: missingIsins.length,
          mapped: 0,
          markedResolved: 0,
          markedUnresolved: 0,
          error: error.message || "OpenFIGI mapping failed",
        });
      }
    }
    const stats = {
      dryRun: options.dryRun,
      markets: options.markets,
      source: options.source,
      status: options.status,
      perMarket: options.perMarket,
      openFigiMode: options.openFigiMode,
      candidates: rows.reduce((sum, row) => sum + Number(row.candidates || 0), 0),
      cached: rows.reduce((sum, row) => sum + Number(row.cached || 0), 0),
      openfigiRequested: rows.reduce((sum, row) => sum + Number(row.openfigiRequested || 0), 0),
      mapped: rows.reduce((sum, row) => sum + Number(row.mapped || 0), 0),
      persisted: rows.reduce((sum, row) => sum + Number(row.persisted || 0), 0),
      markedResolved: rows.reduce((sum, row) => sum + Number(row.markedResolved || 0), 0),
      markedUnresolved: rows.reduce((sum, row) => sum + Number(row.markedUnresolved || 0), 0),
      errors,
      legalMode: "internal-resolution-only",
    };
    await finishRun(run, options.dryRun ? "dry-run" : errors.length ? "completed-with-warnings" : "completed", { stats });
    return Response.json({
      ok: true,
      job: "shadow-symbol-resolve",
      message: "Resolucion interna de ISIN a ticker. No expone directorios completos.",
      ...stats,
      rows,
    });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message, stats: { markets: options.markets } });
    return Response.json({ ok: false, error: error.message || "Shadow symbol resolve failed" }, { status: 502 });
  }
}

export const POST = GET;
