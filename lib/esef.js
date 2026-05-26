import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

function canonicalSymbol(symbol = "") {
  return String(symbol || "").trim().toUpperCase();
}

/**
 * Resolves the Legal Entity Identifier (LEI) for a given Yahoo symbol by:
 * 1. Querying symbol_resolutions to find the associated ISIN.
 * 2. Querying shadow_instruments to find the issuer_lei by ISIN.
 */
export async function resolveLeiForSymbol(symbol) {
  const config = supabaseConfig();
  if (!config.configured) return null;
  const normalized = canonicalSymbol(symbol);
  if (!normalized) return null;

  try {
    const resolutions = await supabaseRequest("symbol_resolutions", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&symbol=eq.${encodeURIComponent(normalized)}&select=isin`,
    });
    const isin = resolutions?.[0]?.isin;
    if (!isin) return null;

    const instruments = await supabaseRequest("shadow_instruments", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&isin=eq.${encodeURIComponent(isin)}&select=issuer_lei`,
    });
    return instruments?.[0]?.issuer_lei || null;
  } catch (error) {
    console.error(`[ESEF] Error resolving LEI for symbol ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Fetches the list of Inline XBRL filings from filings.xbrl.org for a given LEI.
 * Returns filings containing non-null JSON URLs sorted by period_end descending.
 */
export async function fetchEsefFilings(lei) {
  if (!lei) return [];
  const url = `https://filings.xbrl.org/api/filings?filter[entity.identifier]=${encodeURIComponent(lei)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "StatsEdge/0.1 esef-refresh",
      },
    });
    if (!res.ok) {
      throw new Error(`ESEF Filings API HTTP ${res.status}`);
    }
    const payload = await res.json();
    const filings = payload?.data || [];
    return filings
      .filter((f) => f?.attributes?.json_url && f?.attributes?.period_end)
      .sort((a, b) => new Date(b.attributes.period_end) - new Date(a.attributes.period_end));
  } catch (error) {
    console.error(`[ESEF] Error fetching filings for LEI ${lei}:`, error.message);
    throw error;
  }
}

/**
 * Internal helper to parse xBRL-JSON facts and extract 6 core annual metrics + EPS.
 * Employs core dimensions count heuristic (=== 4) to isolate consolidated numbers.
 */
function extractMetricsFromFacts(facts, periodEnd) {
  const yearMatch = periodEnd.match(/^(\d{4})/);
  if (!yearMatch) return null;
  const year = yearMatch[1];

  function isFlowPeriodForYear(pStr, targetYear) {
    if (!pStr) return false;
    const parts = pStr.split("/");
    if (parts.length !== 2) return false;
    const start = parts[0].trim();
    const end = parts[1].trim();
    const nextYear = String(parseInt(targetYear) + 1);

    // Flow period should start in targetYear (Jan/Feb) and end in targetYear Dec or nextYear Jan/Feb
    const startOk = start.startsWith(`${targetYear}-01`) || start.startsWith(`${targetYear}-02`);
    const endOk = end.startsWith(`${targetYear}-12`) || end.startsWith(`${nextYear}-01`) || end.startsWith(`${nextYear}-02`);
    return startOk && endOk;
  }

  function isInstantPeriodForYear(pStr, targetYear) {
    if (!pStr) return false;
    const nextYear = String(parseInt(targetYear) + 1);
    const cleanStr = pStr.trim();

    // Instant period should represent end of targetYear state (e.g. Dec 30/31 or nextYear Jan 1/2)
    return cleanStr.startsWith(`${targetYear}-12-31`) ||
           cleanStr.startsWith(`${targetYear}-12-30`) ||
           cleanStr.startsWith(`${nextYear}-01-01`) ||
           cleanStr.startsWith(`${nextYear}-01-02`);
  }

  const extracted = {
    revenue: null,
    netIncome: null,
    totalAssets: null,
    equity: null,
    totalLiabilities: null,
    cash: null,
    eps: null,
  };

  const candidates = {
    revenue: [],
    netIncome: [],
    totalAssets: [],
    equity: [],
    totalLiabilities: [],
    cash: [],
    eps: [],
  };

  for (const factKey in facts) {
    const fact = facts[factKey];
    if (!fact || !fact.dimensions) continue;
    const dims = fact.dimensions;
    const concept = dims.concept;
    if (!concept) continue;

    const cleanConcept = concept.includes(":") ? concept.split(":")[1] : concept;
    let category = null;
    let isFlow = false;

    // Map IFRS Core Taxonomy elements for ESEF filings
    if (cleanConcept === "Revenue" || cleanConcept === "OperatingRevenue" || cleanConcept === "RevenueFromOrdinaryActivities" || cleanConcept === "RevenueFromContractsWithCustomers") {
      category = "revenue";
      isFlow = true;
    } else if (cleanConcept === "ProfitLoss" || cleanConcept === "ProfitLossFromContinuingOperations" || cleanConcept === "ProfitLossFromOrdinaryActivities") {
      category = "netIncome";
      isFlow = true;
    } else if (cleanConcept === "Assets") {
      category = "totalAssets";
      isFlow = false;
    } else if (cleanConcept === "Equity") {
      category = "equity";
      isFlow = false;
    } else if (cleanConcept === "Liabilities") {
      category = "totalLiabilities";
      isFlow = false;
    } else if (cleanConcept === "CashAndCashEquivalents") {
      category = "cash";
      isFlow = false;
    } else if (cleanConcept === "BasicEarningsLossPerShare") {
      category = "eps";
      isFlow = true;
    }

    if (!category) continue;

    const period = dims.period;
    const isPeriodOk = isFlow
      ? isFlowPeriodForYear(period, year)
      : isInstantPeriodForYear(period, year);

    if (!isPeriodOk) continue;

    const val = parseFloat(fact.value);
    if (!Number.isFinite(val)) continue;

    candidates[category].push({
      value: val,
      dims: dims,
      extraDimsCount: Object.keys(dims).length - 4, // core dimensions count is concept, entity, period, unit
      unit: dims.unit ? (dims.unit.includes(":") ? dims.unit.split(":")[1] : dims.unit) : null,
    });
  }

  // Pick candidate with lowest extra dimensions count (most consolidated/clean)
  for (const cat in candidates) {
    const list = candidates[cat];
    if (!list.length) continue;
    list.sort((a, b) => a.extraDimsCount - b.extraDimsCount);
    extracted[cat] = list[0].value;
  }

  // Mathematical backfill for Liabilities = Assets - Equity
  if (extracted.totalLiabilities === null && extracted.totalAssets !== null && extracted.equity !== null) {
    extracted.totalLiabilities = extracted.totalAssets - extracted.equity;
  }

  // Currency extraction from unit dims
  let foundCurrency = null;
  const currencyPriority = ["revenue", "totalAssets", "equity", "netIncome", "cash", "totalLiabilities"];
  for (const cat of currencyPriority) {
    const list = candidates[cat];
    if (list && list.length) {
      list.sort((a, b) => a.extraDimsCount - b.extraDimsCount);
      const bestUnit = list[0].unit;
      if (bestUnit && bestUnit.length === 3) {
        foundCurrency = bestUnit.toUpperCase();
        break;
      }
    }
  }

  // Calculate coverage score out of 6 core metrics
  const coreValues = [
    extracted.revenue,
    extracted.netIncome,
    extracted.totalAssets,
    extracted.equity,
    extracted.totalLiabilities,
    extracted.cash,
  ];
  const maxMetrics = 6;
  const counted = coreValues.filter((val) => val !== null).length;
  const coverageScore = Math.round((counted / maxMetrics) * 100);

  return {
    metrics: extracted,
    coverageScore,
    currency: foundCurrency,
  };
}

/**
 * Downloads and parses an Inline XBRL JSON facts report from filings.xbrl.org.
 */
export async function fetchAndParseEsefFilingFacts(jsonUrl, periodEnd) {
  if (!jsonUrl) return null;
  const url = `https://filings.xbrl.org${jsonUrl}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "StatsEdge/0.1 esef-refresh",
      },
    });
    if (!res.ok) {
      throw new Error(`ESEF Filing JSON facts HTTP ${res.status}`);
    }
    const data = await res.json();
    const facts = data?.facts || {};
    return extractMetricsFromFacts(facts, periodEnd);
  } catch (error) {
    console.error(`[ESEF] Error downloading facts from ${url}:`, error.message);
    throw error;
  }
}

/**
 * Saves ESEF extracted fundamentals snapshot to the fundamental_snapshots table.
 */
export async function writeEsefFundamentals(symbol, periodEnd, results) {
  const config = supabaseConfig();
  if (!config.configured) return { written: false, status: "supabase-disabled" };
  const normalized = canonicalSymbol(symbol);
  if (!normalized) return { written: false, status: "missing-symbol" };

  const metrics = {
    revenue: results.metrics.revenue,
    netIncome: results.metrics.netIncome,
    totalAssets: results.metrics.totalAssets,
    equity: results.metrics.equity,
    totalLiabilities: results.metrics.totalLiabilities,
    cash: results.metrics.cash,
    eps: results.metrics.eps,
    coverageScore: results.coverageScore,
    sourceUrl: `https://filings.xbrl.org${results.sourceUrl}`,
  };

  const row = {
    owner_id: config.ownerId,
    symbol: normalized,
    period_end: periodEnd,
    period_type: "annual",
    provider: "esef-filings",
    currency: results.currency || null,
    market_cap: null,
    metrics,
    raw: results.raw || {},
    updated_at: new Date().toISOString(),
  };

  try {
    await supabaseRequest("fundamental_snapshots", {
      method: "POST",
      query: "on_conflict=owner_id,symbol,period_end,period_type,provider",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [row],
    });
    return { written: true, status: "supabase", periodEnd };
  } catch (error) {
    console.error(`[ESEF] Supabase write failed for ${symbol} on period ${periodEnd}:`, error.message);
    throw error;
  }
}

/**
 * Core orchestrator to resolve symbols to LEIs, fetch filings, parse, and persist ESEF fundamentals.
 */
export async function updateEsefFundamentalsForSymbol(symbol, options = {}) {
  const maxFilings = Math.min(Math.max(Number(options.limit || 3), 1), 10);
  const normalized = canonicalSymbol(symbol);
  if (!normalized) return { ok: false, symbol, reason: "missing-symbol" };

  // 1. Resolve LEI
  const lei = await resolveLeiForSymbol(normalized);
  if (!lei) {
    return { ok: false, symbol: normalized, reason: "no-lei-found" };
  }

  // 2. Fetch filings
  let filings = [];
  try {
    filings = await fetchEsefFilings(lei);
  } catch (err) {
    return { ok: false, symbol: normalized, lei, reason: `filings-fetch-failed: ${err.message}` };
  }

  if (!filings.length) {
    return { ok: false, symbol: normalized, lei, reason: "no-filings-found" };
  }

  // 3. Process filings up to the specified limit
  const processed = [];
  const targetFilings = filings.slice(0, maxFilings);

  for (const filing of targetFilings) {
    const jsonUrl = filing.attributes?.json_url;
    const periodEnd = filing.attributes?.period_end;
    if (!jsonUrl || !periodEnd) continue;

    try {
      const parsed = await fetchAndParseEsefFilingFacts(jsonUrl, periodEnd);
      if (parsed) {
        const saveRes = await writeEsefFundamentals(normalized, periodEnd, {
          ...parsed,
          sourceUrl: jsonUrl,
          raw: {
            dateAdded: filing.attributes.date_added,
            processedAt: filing.attributes.processed,
            fxoId: filing.attributes.fxo_id,
            sha256: filing.attributes.sha256,
          },
        });
        processed.push({
          periodEnd,
          coverageScore: parsed.coverageScore,
          currency: parsed.currency,
          written: saveRes.written,
        });
      }
    } catch (err) {
      processed.push({
        periodEnd,
        error: err.message || "Failed to process filing facts",
      });
    }
  }

  return {
    ok: true,
    symbol: normalized,
    lei,
    filingsTotal: filings.length,
    processed,
  };
}
