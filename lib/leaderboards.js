import { disabledPayload, finiteOrNull, supabaseConfig, supabaseRequest, textOrNull } from "@/lib/supabaseServer";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const DEFAULT_SCAN_ROWS = 5000;
const DEFAULT_MIN_COVERAGE = 40;

export const LEADERBOARD_STRATEGIES = {
  composite: {
    label: "Composite",
    description: "Mejor combinacion global de tendencia, RS, calidad, liquidez y riesgo.",
  },
  momentum: {
    label: "Momentum",
    description: "Fuerza relativa y rentabilidad reciente, con control de calidad minimo.",
  },
  return6m: {
    label: "Rentabilidad 6M",
    description: "Mayor avance a seis meses, penalizando baja calidad y baja cobertura.",
  },
  stage2: {
    label: "Weinstein Stage 2",
    description: "Tendencia alcista estructural segun medias y score Weinstein.",
  },
  nearPivot: {
    label: "Cerca de pivot",
    description: "Lideres fuertes cerca de maximos recientes y sin extension extrema.",
  },
  rs: {
    label: "RS Global",
    description: "Mayor fuerza relativa global disponible.",
  },
  growth: {
    label: "Growth Quality",
    description: "Crecimiento, margen y calidad fundamental cuando el proveedor lo cubre.",
  },
  liquidity: {
    label: "Liquidez",
    description: "Lideres con mayor importe negociado y score suficiente.",
  },
};

export const DEFAULT_LEADERBOARD_SPECS = [
  { key: "global-momentum", title: "Top Momentum Global", strategy: "momentum", scopeType: "global", scopeValue: "" },
  { key: "global-stage2", title: "Top Weinstein Stage 2 Global", strategy: "stage2", scopeType: "global", scopeValue: "" },
  { key: "global-near-pivot", title: "Cerca de Pivot Global", strategy: "nearPivot", scopeType: "global", scopeValue: "" },
  { key: "global-rs", title: "Top RS Global", strategy: "rs", scopeType: "global", scopeValue: "" },
  { key: "global-growth-quality", title: "Growth Quality Global", strategy: "growth", scopeType: "global", scopeValue: "" },
];

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lowerText(value = "") {
  return cleanText(value).toLowerCase();
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === "" || value === null || value === undefined) continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function metric(row = {}, key = "") {
  return firstFinite(row[key], row.metrics?.[key], row.growthMetrics?.[key]);
}

function metricText(row = {}, key = "") {
  return cleanText(row[key] || row.metrics?.[key] || row.growthMetrics?.[key] || "");
}

function scale(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || max === min) return 0;
  return clamp(((n - min) / (max - min)) * 100);
}

function logScale(value, min = 100000, max = 50000000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return scale(Math.log10(n), Math.log10(min), Math.log10(max));
}

function rsValue(row = {}) {
  return firstFinite(metric(row, "rsGlobalPct"), metric(row, "rsRating"), metric(row, "rsCountryPct"), metric(row, "rsSectorPct"));
}

function isStage2(row = {}) {
  const price = metric(row, "price");
  const sma50 = metric(row, "sma50");
  const sma150 = metric(row, "sma150");
  const sma200 = metric(row, "sma200");
  const slope = metric(row, "sma200Slope");
  if ([price, sma50, sma150, sma200, slope].every(Number.isFinite)) {
    return price > sma50 && price > sma150 && price > sma200 && sma50 > sma150 && sma150 > sma200 && slope > 0;
  }
  return (metric(row, "weinsteinScore") || 0) >= 75 && (metric(row, "minerviniScore") || 0) >= 60;
}

function normalizeStrategy(value = "") {
  const key = cleanText(value || "momentum");
  return LEADERBOARD_STRATEGIES[key] ? key : "momentum";
}

function normalizeScopeType(value = "") {
  const key = cleanText(value || "global");
  return ["global", "country", "sector", "industry", "theme"].includes(key) ? key : "global";
}

function scopeField(scopeType = "global") {
  if (scopeType === "country") return "country";
  if (scopeType === "sector") return "sector";
  if (scopeType === "industry") return "industry";
  if (scopeType === "theme") return "theme";
  return "";
}

function scopeMatches(row = {}, scopeType = "global", scopeValue = "") {
  if (scopeType === "global") return true;
  const field = scopeField(scopeType);
  if (!field) return true;
  const expected = lowerText(scopeValue);
  if (!expected) return true;
  if (scopeType === "country") return lowerText(row.country) === expected;
  return lowerText(row[field]).includes(expected);
}

function rowFromScanResult(item = {}) {
  const raw = item.raw && typeof item.raw === "object" ? item.raw : {};
  const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics : {};
  return {
    ...metrics,
    ...raw,
    symbol: cleanText(raw.symbol || item.symbol).toUpperCase(),
    companyName: cleanText(raw.companyName || raw.name || item.company_name || item.symbol),
    country: cleanText(raw.country || item.country),
    sector: cleanText(raw.sector || item.sector || "Sin sector"),
    industry: cleanText(raw.industry || item.industry || "Sin industria"),
    theme: cleanText(raw.theme || item.theme || ""),
    totalScore: firstFinite(raw.totalScore, item.total_score),
    weinsteinScore: firstFinite(raw.weinsteinScore, item.weinstein_score),
    minerviniScore: firstFinite(raw.minerviniScore, item.minervini_score),
    riskScore: firstFinite(raw.riskScore, item.risk_score),
    rsRating: firstFinite(raw.rsRating, item.rs_rating),
    sourceScanCreatedAt: item.created_at || raw.createdAt || "",
  };
}

function basePasses(row = {}, options = {}) {
  if (!row.symbol) return false;
  const minCoverage = Number.isFinite(options.minCoverageScore) ? options.minCoverageScore : DEFAULT_MIN_COVERAGE;
  const coverage = metric(row, "dataCoverageScore");
  if (Number.isFinite(coverage) && coverage < minCoverage) return false;
  if (Number.isFinite(options.minTotalScore) && (metric(row, "totalScore") || 0) < options.minTotalScore) return false;
  if (Number.isFinite(options.minRs) && (rsValue(row) || 0) < options.minRs) return false;
  if (Number.isFinite(options.minMarketCap) && (metric(row, "marketCap") || 0) < options.minMarketCap) return false;
  if (Number.isFinite(options.minAvgTurnover) && (metric(row, "avgTurnover") || 0) < options.minAvgTurnover) return false;
  return true;
}

function strategyPasses(row = {}, strategy = "momentum") {
  const total = metric(row, "totalScore") || 0;
  const rs = rsValue(row) || 0;
  const perf6m = metric(row, "perf6m");
  const distance20d = metric(row, "distance20d");
  const distance52w = metric(row, "distance52w");
  const extSma50 = metric(row, "extSma50");

  if (strategy === "stage2") return isStage2(row) && total >= 55;
  if (strategy === "nearPivot") return total >= 55 && rs >= 55 && Number.isFinite(distance20d) && distance20d >= -8 && (extSma50 || 0) <= 18;
  if (strategy === "rs") return rs >= 60;
  if (strategy === "growth") return (metric(row, "growthScore") || metric(row, "epsGrowthProxyScore") || 0) >= 50 && total >= 50;
  if (strategy === "liquidity") return (metric(row, "avgTurnover") || 0) > 0 && total >= 45;
  if (strategy === "return6m") return Number.isFinite(perf6m) && perf6m > 0 && total >= 45;
  if (strategy === "composite") return total >= 50;
  return total >= 45 && rs >= 45 && (!Number.isFinite(distance52w) || distance52w >= -45);
}

function strategyScore(row = {}, strategy = "momentum") {
  const total = metric(row, "totalScore") || 0;
  const rs = rsValue(row) || 0;
  const weinstein = metric(row, "weinsteinScore") || 0;
  const minervini = metric(row, "minerviniScore") || 0;
  const perf3m = metric(row, "perf3m");
  const perf6m = metric(row, "perf6m");
  const perf12m = metric(row, "perf12m");
  const extSma50 = metric(row, "extSma50");
  const distance20d = metric(row, "distance20d");
  const growth = firstFinite(metric(row, "growthScore"), metric(row, "epsGrowthProxyScore"), 0);

  if (strategy === "composite") return clamp(total);
  if (strategy === "rs") return clamp(rs);
  if (strategy === "return6m") return clamp(scale(perf6m, -10, 90) * 0.55 + rs * 0.25 + total * 0.2);
  if (strategy === "stage2") return clamp(total * 0.28 + weinstein * 0.28 + minervini * 0.2 + rs * 0.2 + scale(metric(row, "sma200Slope"), -2, 8) * 0.04);
  if (strategy === "nearPivot") {
    const proximity = Number.isFinite(distance20d) ? 100 - Math.min(100, Math.abs(distance20d) * 8) : 0;
    const extensionPenalty = Number.isFinite(extSma50) && extSma50 > 18 ? Math.min(25, extSma50 - 18) : 0;
    return clamp(total * 0.32 + rs * 0.26 + weinstein * 0.18 + proximity * 0.24 - extensionPenalty);
  }
  if (strategy === "growth") return clamp(growth * 0.4 + (metric(row, "epsGrowthProxyScore") || 0) * 0.2 + total * 0.25 + rs * 0.15);
  if (strategy === "liquidity") return clamp(logScale(metric(row, "avgTurnover")) * 0.45 + total * 0.35 + rs * 0.2);
  return clamp(total * 0.22 + rs * 0.25 + scale(perf6m, -15, 80) * 0.24 + scale(perf3m, -10, 40) * 0.16 + scale(perf12m, -25, 120) * 0.08 + weinstein * 0.05);
}

function publicItem(row = {}, rank, strategy = "momentum") {
  const score = strategyScore(row, strategy);
  return {
    rank,
    symbol: row.symbol,
    companyName: row.companyName || row.name || row.symbol,
    country: row.country || "",
    sector: row.sector || "",
    industry: row.industry || "",
    theme: row.theme || "",
    score: Math.round(score),
    totalScore: finiteOrNull(metric(row, "totalScore")),
    rsGlobalPct: finiteOrNull(rsValue(row)),
    weinsteinScore: finiteOrNull(metric(row, "weinsteinScore")),
    minerviniScore: finiteOrNull(metric(row, "minerviniScore")),
    dataCoverageScore: finiteOrNull(metric(row, "dataCoverageScore")),
    perf3m: finiteOrNull(metric(row, "perf3m")),
    perf6m: finiteOrNull(metric(row, "perf6m")),
    perf12m: finiteOrNull(metric(row, "perf12m")),
    distance20d: finiteOrNull(metric(row, "distance20d")),
    distance52w: finiteOrNull(metric(row, "distance52w")),
    avgTurnover: finiteOrNull(metric(row, "avgTurnover")),
    marketCap: finiteOrNull(metric(row, "marketCap")),
    currency: metricText(row, "currency"),
    chartProvider: metricText(row, "chartProvider"),
    sourceScanCreatedAt: row.sourceScanCreatedAt || "",
  };
}

function dedupeRows(rows = []) {
  const bySymbol = new Map();
  for (const row of rows) {
    if (!row.symbol) continue;
    const previous = bySymbol.get(row.symbol);
    if (!previous) {
      bySymbol.set(row.symbol, row);
      continue;
    }
    const prevTime = Date.parse(previous.sourceScanCreatedAt || "") || 0;
    const nextTime = Date.parse(row.sourceScanCreatedAt || "") || 0;
    if (nextTime > prevTime) bySymbol.set(row.symbol, row);
    else if (nextTime === prevTime && (metric(row, "totalScore") || 0) > (metric(previous, "totalScore") || 0)) bySymbol.set(row.symbol, row);
  }
  return [...bySymbol.values()];
}

export function buildLeaderboard(rows = [], params = {}) {
  const strategy = normalizeStrategy(params.strategy || params.type);
  const scopeType = normalizeScopeType(params.scopeType || params.scope || (params.country ? "country" : params.sector ? "sector" : "global"));
  const scopeValue = cleanText(params.scopeValue || params.country || params.sector || params.industry || params.theme || "");
  const limit = Math.min(Math.max(Number(params.limit || DEFAULT_LIMIT), 1), MAX_LIMIT);
  const options = {
    minCoverageScore: firstFinite(params.minCoverageScore),
    minTotalScore: firstFinite(params.minTotalScore),
    minRs: firstFinite(params.minRs),
    minMarketCap: firstFinite(params.minMarketCap),
    minAvgTurnover: firstFinite(params.minAvgTurnover),
  };
  const all = dedupeRows(rows.map(rowFromScanResult));
  const eligible = all
    .filter((row) => scopeMatches(row, scopeType, scopeValue))
    .filter((row) => basePasses(row, options))
    .filter((row) => strategyPasses(row, strategy));
  const ranked = eligible
    .map((row) => ({ row, score: strategyScore(row, strategy) }))
    .sort((a, b) => (b.score - a.score) || ((metric(b.row, "totalScore") || 0) - (metric(a.row, "totalScore") || 0)))
    .slice(0, limit)
    .map(({ row }, index) => publicItem(row, index + 1, strategy));

  const scopeLabel = scopeType === "global" ? "Global" : scopeValue || scopeType;
  const strategyMeta = LEADERBOARD_STRATEGIES[strategy];
  return {
    key: params.key || `${scopeType}:${scopeValue || "global"}:${strategy}`,
    title: params.title || `${strategyMeta.label} - ${scopeLabel}`,
    strategy,
    strategyLabel: strategyMeta.label,
    scopeType,
    scopeValue,
    criteria: {
      derivedOnly: true,
      minCoverageScore: options.minCoverageScore ?? DEFAULT_MIN_COVERAGE,
      minTotalScore: options.minTotalScore ?? null,
      minRs: options.minRs ?? null,
      minMarketCap: options.minMarketCap ?? null,
      minAvgTurnover: options.minAvgTurnover ?? null,
      description: strategyMeta.description,
    },
    source: "Supabase scan_results derived signals",
    input: {
      rowsRead: rows.length,
      deduped: all.length,
      eligible: eligible.length,
    },
    count: ranked.length,
    generatedAt: new Date().toISOString(),
    items: ranked,
  };
}

export function buildGroupedLeaderboards(rows = [], params = {}) {
  const groupBy = normalizeScopeType(params.groupBy || "country");
  const field = scopeField(groupBy);
  if (!field) return [buildLeaderboard(rows, params)];
  const limit = Math.min(Math.max(Number(params.limit || 10), 1), MAX_LIMIT);
  const groupsLimit = Math.min(Math.max(Number(params.groupsLimit || 20), 1), 100);
  const minGroupSize = Math.max(Number(params.minGroupSize || 2), 1);
  const baseRows = dedupeRows(rows.map(rowFromScanResult)).filter((row) => cleanText(row[field]));
  const groups = new Map();
  for (const row of baseRows) {
    const key = cleanText(row[field]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.entries()]
    .filter(([, groupRows]) => groupRows.length >= minGroupSize)
    .map(([value, groupRows]) => buildLeaderboard(groupRows.map((row) => ({ raw: row, created_at: row.sourceScanCreatedAt })), {
      ...params,
      groupBy: "",
      scopeType: groupBy,
      scopeValue: value,
      limit,
      key: `${groupBy}:${value}:${normalizeStrategy(params.strategy || params.type)}`,
      title: `${LEADERBOARD_STRATEGIES[normalizeStrategy(params.strategy || params.type)].label} - ${value}`,
    }))
    .filter((leaderboard) => leaderboard.count > 0)
    .sort((a, b) => ((b.items[0]?.score || 0) - (a.items[0]?.score || 0)) || (b.input.eligible - a.input.eligible))
    .slice(0, groupsLimit);
}

export async function readScanRows({ maxRows = DEFAULT_SCAN_ROWS, sinceDays = 45 } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, ...disabledPayload(), rows: [] };
  const limit = Math.min(Math.max(Number(maxRows || DEFAULT_SCAN_ROWS), 1), 10000);
  const since = new Date(Date.now() - Math.max(Number(sinceDays || 45), 1) * 86400 * 1000).toISOString();
  const rows = await supabaseRequest("scan_results", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&created_at=gte.${encodeURIComponent(since)}&select=*&order=created_at.desc&limit=${limit}`,
  });
  return { configured: true, rows: rows || [], ownerId: config.ownerId };
}

export async function readMaterializedLeaderboard(key = "") {
  const config = supabaseConfig();
  if (!config.configured || !key) return null;
  const snapshots = await supabaseRequest("leaderboard_snapshots", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&leaderboard_key=eq.${encodeURIComponent(key)}&select=*&order=generated_at.desc&limit=1`,
  });
  const snapshot = snapshots?.[0];
  if (!snapshot) return null;
  const items = await supabaseRequest("leaderboard_items", {
    query: `snapshot_id=eq.${encodeURIComponent(snapshot.id)}&select=*&order=rank_index.asc`,
  });
  return {
    key: snapshot.leaderboard_key,
    title: snapshot.title,
    strategy: snapshot.strategy,
    scopeType: snapshot.scope_type,
    scopeValue: snapshot.scope_value || "",
    criteria: snapshot.criteria || {},
    source: snapshot.source || "leaderboard_snapshots",
    count: Number(snapshot.item_count || items?.length || 0),
    generatedAt: snapshot.generated_at,
    items: (items || []).map((item) => ({
      rank: item.rank_index,
      symbol: item.symbol,
      companyName: item.company_name,
      country: item.country,
      sector: item.sector,
      industry: item.industry,
      theme: item.theme,
      score: finiteOrNull(item.score),
      ...(item.metrics || {}),
    })),
    cache: { hit: true, status: "supabase" },
  };
}

export async function writeMaterializedLeaderboards(leaderboards = []) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, saved: 0, ...disabledPayload() };
  const saved = [];
  for (const leaderboard of leaderboards) {
    const [snapshot] = await supabaseRequest("leaderboard_snapshots", {
      method: "POST",
      query: "on_conflict=owner_id,leaderboard_key",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [{
        owner_id: config.ownerId,
        leaderboard_key: leaderboard.key,
        scope_type: leaderboard.scopeType,
        scope_value: leaderboard.scopeValue || null,
        strategy: leaderboard.strategy,
        title: leaderboard.title,
        criteria: leaderboard.criteria || {},
        item_count: leaderboard.items?.length || 0,
        source: leaderboard.source,
        generated_at: new Date().toISOString(),
      }],
    });
    await supabaseRequest("leaderboard_items", {
      method: "DELETE",
      query: `snapshot_id=eq.${encodeURIComponent(snapshot.id)}`,
    });
    const items = leaderboard.items || [];
    if (items.length) {
      await supabaseRequest("leaderboard_items", {
        method: "POST",
        prefer: "return=minimal",
        body: items.map((item) => ({
          owner_id: config.ownerId,
          snapshot_id: snapshot.id,
          rank_index: item.rank,
          symbol: item.symbol,
          company_name: textOrNull(item.companyName),
          country: textOrNull(item.country),
          sector: textOrNull(item.sector),
          industry: textOrNull(item.industry),
          theme: textOrNull(item.theme),
          score: finiteOrNull(item.score),
          metrics: {
            totalScore: item.totalScore ?? null,
            rsGlobalPct: item.rsGlobalPct ?? null,
            weinsteinScore: item.weinsteinScore ?? null,
            minerviniScore: item.minerviniScore ?? null,
            dataCoverageScore: item.dataCoverageScore ?? null,
            perf3m: item.perf3m ?? null,
            perf6m: item.perf6m ?? null,
            perf12m: item.perf12m ?? null,
            distance20d: item.distance20d ?? null,
            distance52w: item.distance52w ?? null,
            avgTurnover: item.avgTurnover ?? null,
            marketCap: item.marketCap ?? null,
            currency: item.currency || "",
            chartProvider: item.chartProvider || "",
            sourceScanCreatedAt: item.sourceScanCreatedAt || "",
          },
        })),
      });
    }
    saved.push({ key: leaderboard.key, count: items.length, snapshotId: snapshot.id });
  }
  return { configured: true, ok: true, saved: saved.length, leaderboards: saved };
}
