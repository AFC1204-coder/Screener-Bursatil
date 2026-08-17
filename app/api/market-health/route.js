import { fetchYahooChart } from "@/lib/marketData";
import { supabaseConfig, supabaseRequest, supabaseRpc } from "@/lib/supabaseServer";
import { weeklyStageForBars } from "@/lib/weeklyStage";

const MARKET_HEALTH_CACHE_TYPE = "market_health_cache";
const MARKET_HEALTH_CACHE_KEY = "default";
const DEFAULT_MARKET_HEALTH_MAX_AGE_HOURS = 4;
const MARKET_HEALTH_RESPONSE_TIMEOUT_MS = Number(process.env.MARKET_HEALTH_RESPONSE_TIMEOUT_MS || 7500);
const MARKET_HEALTH_CACHE_READ_TIMEOUT_MS = Number(process.env.MARKET_HEALTH_CACHE_READ_TIMEOUT_MS || 1500);

// Los índices de referencia son ETF, no símbolos con prefijo (^GSPC, ^IXIC...):
// los ETF se descargan y calculan como cualquier otro valor del sistema, y el
// nocturno puede acumularles histórico en daily_bars. Decisión 2026-08-16.
// QQQ replica el Nasdaq-100 (no el Composite) y DIA el Dow: el nombre lo dice.
const INDEXES = [
  { symbol: "SPY", name: "S&P 500", weight: 30 },
  { symbol: "QQQ", name: "Nasdaq 100", weight: 30 },
  { symbol: "IWM", name: "Russell 2000", weight: 20 },
  { symbol: "DIA", name: "Dow Jones", weight: 10 },
  { symbol: "ACWI", name: "MSCI ACWI", weight: 10 },
];

const SECTOR_ETFS = [
  { symbol: "XLK", name: "Tecnología", group: "Crecimiento" },
  { symbol: "XLC", name: "Comunicaciones", group: "Crecimiento" },
  { symbol: "XLY", name: "Consumo discrecional", group: "Cíclico" },
  { symbol: "XLF", name: "Financieras", group: "Cíclico" },
  { symbol: "XLI", name: "Industriales", group: "Cíclico" },
  { symbol: "XLB", name: "Materiales", group: "Cíclico" },
  { symbol: "XLE", name: "Energía", group: "Valor / materias" },
  { symbol: "XLV", name: "Salud", group: "Defensivo" },
  { symbol: "XLP", name: "Consumo defensivo", group: "Defensivo" },
  { symbol: "XLU", name: "Utilities", group: "Defensivo" },
  { symbol: "XLRE", name: "Real estate", group: "Sensibles a tipos" },
];

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function sma(bars, n, offset = 0) { return bars.length >= n + offset ? avg(bars.slice(offset, offset + n).map((x) => x.close)) : null; }
function perf(bars, n) { return bars.length > n && bars[0].close && bars[n].close ? ((bars[0].close / bars[n].close) - 1) * 100 : null; }
function pctPart(count, total) { return total ? count / total * 100 : null; }
function highLow(bars, n) {
  const s = bars.slice(0, Math.min(n, bars.length));
  return {
    hi: Math.max(...s.map((x) => x.high || x.close).filter(Number.isFinite)),
    lo: Math.min(...s.map((x) => x.low || x.close).filter(Number.isFinite)),
  };
}
function distHigh(bars, n) { const { hi } = highLow(bars, n); return hi && bars[0]?.close ? ((bars[0].close / hi) - 1) * 100 : null; }
function distLow(bars, n) { const { lo } = highLow(bars, n); return lo && bars[0]?.close ? ((bars[0].close / lo) - 1) * 100 : null; }
function clamp(n, a = 0, b = 100) { return Math.max(a, Math.min(b, n)); }

function ageHours(value = "") {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / 3600000);
}

function annotateCache(payload = {}, cache = {}) {
  const cachedAt = cache.cachedAt || payload.generatedAt || "";
  return {
    ...payload,
    servedAt: new Date().toISOString(),
    freshness: {
      ...(payload.freshness || {}),
      cacheHit: Boolean(cache.hit),
      cacheStale: Boolean(cache.stale),
      cachedAt,
      cacheAgeHours: ageHours(cachedAt),
      cacheMaxAgeHours: cache.maxAgeHours ?? DEFAULT_MARKET_HEALTH_MAX_AGE_HOURS,
      fallbackError: cache.fallbackError || "",
    },
  };
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), Math.max(500, Number(ms) || 0));
  });
}

function neutralMarketHealth(error = {}) {
  const indexes = INDEXES.map((index) => ({
    ...index,
    price: null,
    lastDate: "",
    sma50: null,
    sma200: null,
    sma200Slope: null,
    perf1m: null,
    perf3m: null,
    perf6m: null,
    distance52w: null,
    advanceFrom52wLow: null,
    weeklyBars: 0,
    // Sin proveedor no hay etapa: estado nulo y ausencia explícita, nunca una
    // etiqueta con aspecto de clasificación ni un score con aspecto de medida.
    stage30w: "Proveedor no disponible",
    stageState: null,
    stageConfirmation: null,
    priceAboveSlowMa: null,
    distanceSma30w: null,
    score: null,
    weinsteinScore: null,
  }));
  const marketScore = 50;
  return {
    generatedAt: new Date().toISOString(),
    marketScore,
    regime: regime(marketScore),
    breadthProxy: {
      indexes: indexes.length,
      above50: 0,
      above200: 0,
      above30w: 0,
      positiveSma200Slope: 0,
      near52wHigh: 0,
      pctAbove50: null,
      pctAbove200: null,
      pctAbove30w: null,
    },
    indexes,
    sectorTape: [],
    weinsteinTape: weinsteinTape(indexes, []),
    sectorSummary: sectorSummary([]),
    sectorTapeNote: "Proveedor de mercado no disponible dentro del presupuesto operativo; lectura neutral degradada.",
    failures: INDEXES.map((index) => ({ symbol: index.symbol, name: index.name, reason: error.message || "Proveedor no disponible" })),
    sectorFailures: SECTOR_ETFS.map((sector) => ({ symbol: sector.symbol, name: sector.name, reason: error.message || "Proveedor no disponible" })),
    degraded: true,
  };
}

async function readMarketHealthCache(options = {}) {
  const config = supabaseConfig();
  const maxAgeHours = Math.max(Number(options.maxAgeHours ?? DEFAULT_MARKET_HEALTH_MAX_AGE_HOURS), 0);
  if (!config.configured) return { hit: false, maxAgeHours };
  try {
    const rows = await supabaseRequest("app_settings", {
      query: {
        owner_id: `eq.${config.ownerId}`,
        setting_type: `eq.${MARKET_HEALTH_CACHE_TYPE}`,
        setting_key: `eq.${MARKET_HEALTH_CACHE_KEY}`,
        select: "value,updated_at",
        limit: "1",
      },
      timeoutMs: Number(options.timeoutMs || MARKET_HEALTH_CACHE_READ_TIMEOUT_MS),
    });
    const row = rows?.[0] || null;
    const payload = row?.value?.payload || null;
    const cachedAt = row?.value?.cachedAt || row?.updated_at || payload?.generatedAt || "";
    const hours = ageHours(cachedAt);
    const fresh = Boolean(payload && hours !== null && hours <= maxAgeHours);
    return {
      hit: fresh,
      stale: Boolean(payload && !fresh),
      payload,
      cachedAt,
      maxAgeHours,
    };
  } catch (error) {
    return { hit: false, maxAgeHours, error: error.message || "market health cache read failed" };
  }
}

async function writeMarketHealthCache(payload = {}) {
  const config = supabaseConfig();
  if (!config.configured || !payload?.generatedAt) return { written: false };
  const cachedAt = new Date().toISOString();
  try {
    await supabaseRpc("upsert_app_setting_newer_wins", {
      p_owner_id: config.ownerId,
      p_setting_type: MARKET_HEALTH_CACHE_TYPE,
      p_setting_key: MARKET_HEALTH_CACHE_KEY,
      p_value: {
        version: 1,
        cachedAt,
        payload,
      },
      p_updated_at: cachedAt,
    });
    return { written: true, cachedAt };
  } catch (error) {
    return { written: false, error: error.message || "market health cache write failed" };
  }
}

// La etapa de índices y sectores la decide lib/weeklyStage.js, el MISMO
// clasificador que la tabla y la ficha. Esta ruta tenía su propia versión
// («Etapa 2 probable» con umbrales fijos y sin banda muerta) y la constelación
// deducía la zona buscando dígitos en ese texto, con lo que «Bajo MM30s» caía
// en la zona de techo por el 3 de «MM30s» (auditoría 2026-08-16, C-19).
function weeklyStage(bars = []) {
  const stage = weeklyStageForBars(bars);
  return {
    weeklyBars: stage.weeklyBars,
    sma30w: stage.slowMa,
    sma30wSlope: stage.slowMaSlopePct,
    distanceSma30w: stage.distanceSlowMaPct,
    priceAboveSlowMa: stage.priceAboveSlowMa,
    stageState: stage.state,
    stageConfirmation: stage.confirmation,
    stageWeeks: stage.weekInStage,
    stage30w: stage.label,
  };
}

function volumeTape(bars = [], days = 20) {
  const sample = bars.slice(0, Math.min(days, bars.length - 1));
  if (sample.length < 8) return { distributionDays20: null, accumulationDays20: null, volumePressure20: null };
  let distribution = 0;
  let accumulation = 0;
  sample.forEach((bar, index) => {
    const previous = bars[index + 1];
    const priorVolumeAvg = avg(bars.slice(index + 1, index + 21).map((x) => x.volume).filter((x) => Number.isFinite(x) && x > 0));
    if (!previous || !Number.isFinite(bar.volume) || !bar.volume || !Number.isFinite(priorVolumeAvg)) return;
    const highVolume = bar.volume > priorVolumeAvg && bar.volume > (previous.volume || 0);
    if (highVolume && bar.close < previous.close) distribution += 1;
    if (highVolume && bar.close > previous.close) accumulation += 1;
  });
  return {
    distributionDays20: distribution,
    accumulationDays20: accumulation,
    volumePressure20: distribution - accumulation,
  };
}

function scoreWeinsteinTape(x = {}) {
  let s = 0;
  if (x.priceAboveSlowMa === true) s += 25;
  if (x.sma30wSlope > 0) s += 25;
  if (x.stageState === "stage2") s += 20;
  if (x.distance52w >= -10) s += 10;
  if (x.perf3m > 0) s += 10;
  if (Number.isFinite(x.volumePressure20)) {
    if (x.volumePressure20 <= 0) s += 10;
    else if (x.volumePressure20 <= 2) s += 5;
  }
  return clamp(s);
}

function stageLabel(x) {
  if (x.price > x.sma50 && x.price > x.sma200 && x.sma50 > x.sma200 && x.sma200Slope > 0) return "Etapa 2 / alcista";
  if (x.price > x.sma200 && x.sma200Slope <= 0) return "Base / transición";
  if (x.price < x.sma50 && x.price > x.sma200) return "Presión / corrección";
  if (x.price < x.sma200 && x.sma200Slope < 0) return "Etapa 4 / bajista";
  return "Neutral";
}

// El score de un índice es una proyección de su ETAPA a la escala 0-100 del
// termómetro — no una suma de umbrales diarios. Antes se puntuaba con
// SMA50/SMA200 y momentum (8 sumandos) y salía 97,6 sin mirar la etapa ni la
// amplitud; el número decía «100» por encima de la misma pantalla que
// enseñaba la divergencia. Los valores son decisión de producto, documentada:
// el centro de cada franja del régimen (E2 avance 90 · E1 suelo ~55 ·
// E3 techo ~40 · E4 declive 10), y la tentativa se acerca a la etapa de la
// que viene el precio (una E1 tentativa sigue siendo un declive hasta que la
// media se aplane; una E3 tentativa, un avance que se está perdiendo).
const STAGE_SCORE = {
  stage2: { confirmed: 90 },
  stage1: { confirmed: 55, tentative: 50, unknown_context: 50 },
  stage3: { confirmed: 35, tentative: 45, unknown_context: 40 },
  stage4: { confirmed: 10 },
};

function stageScore(stageState, stageConfirmation) {
  const byState = STAGE_SCORE[stageState];
  if (!byState) return null;
  return byState[stageConfirmation] ?? byState.confirmed ?? null;
}

function scoreSector(x) {
  let s = 0;
  if (x.price > x.sma50) s += 14;
  if (x.price > x.sma200) s += 16;
  if (x.sma50 > x.sma200) s += 12;
  if (x.sma200Slope > 0) s += 14;
  if (x.perf1w > 0) s += 7;
  if (x.perf1m > 0) s += 11;
  if (x.perf3m > 0) s += 11;
  if (x.rs1m > 0) s += 10;
  if (x.rs3m > 0) s += 10;
  if (x.distance52w >= -10) s += 5;
  return clamp(s);
}

function sectorState(score) {
  if (score >= 75) return { label: "Líder fuerte", bias: "alcista" };
  if (score >= 60) return { label: "Fuerte", bias: "alcista" };
  if (score >= 45) return { label: "Neutral", bias: "neutral" };
  if (score >= 30) return { label: "Débil", bias: "bajista" };
  return { label: "Muy débil", bias: "bajista" };
}

// Guard de identidad: si el proveedor eco-a un símbolo distinto del pedido, la
// serie es de OTRO instrumento (un fallback que remapeó el ticker, por
// ejemplo). Un índice de referencia que no está debe fallar visiblemente — la
// fila cae a `failures`, que la pantalla ya lista — nunca sustituirse en
// silencio. Los proveedores que no ecoan símbolo (Stooq no lo trae) no pueden
// validarse por esta vía; Yahoo, que es la principal, sí.
function assertServedSymbol(requested, chartMeta = {}) {
  const served = String(chartMeta.symbol || "").trim().toUpperCase();
  const asked = String(requested || "").trim().toUpperCase();
  if (served && asked && served !== asked) {
    throw new Error(`El proveedor sirvió ${served} en lugar de ${asked}`);
  }
}

async function analyzeIndex(meta) {
  const { bars, meta: chartMeta } = await fetchYahooChart(meta.symbol);
  assertServedSymbol(meta.symbol, chartMeta);
  if (!bars || bars.length < 220) throw new Error("Histórico insuficiente");
  const price = bars[0].close;
  const s50 = sma(bars, 50);
  const s200 = sma(bars, 200);
  const s200p = sma(bars, 200, 30);
  const item = {
    symbol: meta.symbol,
    name: meta.name,
    weight: meta.weight,
    price,
    lastDate: bars[0].date,
    sma50: s50,
    sma200: s200,
    sma200Slope: s200 && s200p ? ((s200 / s200p) - 1) * 100 : null,
    perf1m: perf(bars, 21),
    perf3m: perf(bars, 63),
    perf6m: perf(bars, 126),
    distance52w: distHigh(bars, 252),
    advanceFrom52wLow: distLow(bars, 252),
    ...weeklyStage(bars),
    ...volumeTape(bars),
  };
  item.score = stageScore(item.stageState, item.stageConfirmation);
  item.weinsteinScore = scoreWeinsteinTape(item);
  return item;
}

async function analyzeSector(meta, benchmarkBars = []) {
  const { bars, meta: chartMeta } = await fetchYahooChart(meta.symbol);
  assertServedSymbol(meta.symbol, chartMeta);
  if (!bars || bars.length < 220) throw new Error("Histórico insuficiente");
  const p1w = perf(bars, 5);
  const p1m = perf(bars, 21);
  const p3m = perf(bars, 63);
  const b1w = benchmarkBars?.length ? perf(benchmarkBars, 5) : null;
  const b1m = benchmarkBars?.length ? perf(benchmarkBars, 21) : null;
  const b3m = benchmarkBars?.length ? perf(benchmarkBars, 63) : null;
  const s50 = sma(bars, 50);
  const s200 = sma(bars, 200);
  const s200p = sma(bars, 200, 30);
  const item = {
    symbol: meta.symbol,
    name: meta.name,
    group: meta.group,
    price: bars[0].close,
    lastDate: bars[0].date,
    sma50: s50,
    sma200: s200,
    sma200Slope: s200 && s200p ? ((s200 / s200p) - 1) * 100 : null,
    perf1d: perf(bars, 1),
    perf1w: p1w,
    perf1m: p1m,
    perf3m: p3m,
    perf6m: perf(bars, 126),
    perf12m: perf(bars, 252),
    rs1w: Number.isFinite(p1w) && Number.isFinite(b1w) ? p1w - b1w : null,
    rs1m: Number.isFinite(p1m) && Number.isFinite(b1m) ? p1m - b1m : null,
    rs3m: Number.isFinite(p3m) && Number.isFinite(b3m) ? p3m - b3m : null,
    distance52w: distHigh(bars, 252),
    advanceFrom52wLow: distLow(bars, 252),
    ...weeklyStage(bars),
    ...volumeTape(bars),
  };
  item.stage = stageLabel(item);
  item.score = scoreSector(item);
  item.weinsteinScore = scoreWeinsteinTape(item);
  item.state = sectorState(item.score);
  return item;
}

function regime(score) {
  if (score >= 75) return { label: "Riesgo favorable / mercado alcista", color: "green", stance: "Índices mayoritariamente sobre medias clave y momentum positivo." };
  if (score >= 55) return { label: "Mercado constructivo pero selectivo", color: "lime", stance: "Estructura positiva, pero con dispersión suficiente para exigir selección." };
  if (score >= 40) return { label: "Mercado bajo presión", color: "amber", stance: "Medias y amplitud mixtas; la evidencia de liderazgo debe contrastarse con más cuidado." };
  return { label: "Mercado débil / defensivo", color: "red", stance: "Predominan índices bajo medias clave o con tendencia larga deteriorada." };
}

function sectorSummary(sectors = []) {
  const sorted = [...sectors].sort((a, b) => b.score - a.score);
  const byMonth = [...sectors].sort((a, b) => (b.perf1m ?? -999) - (a.perf1m ?? -999));
  return {
    count: sectors.length,
    avgScore: avg(sectors.map((x) => x.score).filter(Number.isFinite)),
    above50: sectors.filter((x) => x.price > x.sma50).length,
    above200: sectors.filter((x) => x.price > x.sma200).length,
    leaders: sorted.slice(0, 3).map((x) => x.name),
    laggards: sorted.slice(-3).reverse().map((x) => x.name),
    best1m: byMonth[0]?.name || "",
    worst1m: byMonth.at(-1)?.name || "",
  };
}

function weinsteinTape(indexes = [], sectors = []) {
  const indexAbove30w = indexes.filter((x) => x.priceAboveSlowMa === true).length;
  const sectorAbove30w = sectors.filter((x) => x.priceAboveSlowMa === true).length;
  const sectorStage2 = sectors.filter((x) => x.stageState === "stage2").length;
  const sectorStage4 = sectors.filter((x) => x.stageState === "stage4").length;
  const distributionAvg = avg(sectors.map((x) => x.distributionDays20).filter(Number.isFinite));
  const accumulationAvg = avg(sectors.map((x) => x.accumulationDays20).filter(Number.isFinite));
  const indexPct = pctPart(indexAbove30w, indexes.length);
  const sectorPct = pctPart(sectorAbove30w, sectors.length);
  const stage2Pct = pctPart(sectorStage2, sectors.length);
  const stage4Pct = pctPart(sectorStage4, sectors.length);
  const offensiveGroups = new Set(["Crecimiento", "Cíclico", "Valor / materias"]);
  const offensiveStage2 = sectors.filter((x) => offensiveGroups.has(x.group) && x.stageState === "stage2").length;
  const defensiveStage2 = sectors.filter((x) => x.group === "Defensivo" && x.stageState === "stage2").length;
  const leadingSectors = [...sectors]
    .filter((x) => x.stageState === "stage2" && ((x.rs1m ?? -99) > 0 || (x.rs3m ?? -99) > 0))
    .sort((a, b) => (b.weinsteinScore - a.weinsteinScore) || (b.score - a.score))
    .slice(0, 5);
  const weakSectors = [...sectors]
    .filter((x) => x.stageState === "stage4" || x.weinsteinScore < 35)
    .sort((a, b) => (a.weinsteinScore - b.weinsteinScore) || (a.score - b.score))
    .slice(0, 5);
  const divergences = [];
  if (Number.isFinite(indexPct) && Number.isFinite(sectorPct) && indexPct >= 60 && sectorPct < 45) {
    divergences.push("Índices sostienen la MM30s, pero la amplitud sectorial no confirma.");
  }
  if (Number.isFinite(indexPct) && Number.isFinite(stage2Pct) && indexPct < 50 && stage2Pct >= 35) {
    divergences.push("Sectores en Etapa 2 mejoran antes que los índices principales.");
  }
  if (Number.isFinite(distributionAvg) && Number.isFinite(accumulationAvg) && distributionAvg >= accumulationAvg + 2) {
    divergences.push("Presión de distribución supera acumulación en sectores.");
  }
  if (defensiveStage2 > offensiveStage2 && defensiveStage2 >= 2) {
    divergences.push("Liderazgo defensivo por encima del liderazgo ofensivo.");
  }
  let label = "Lectura mixta";
  if ((indexPct ?? 0) >= 60 && (stage2Pct ?? 0) >= 40 && (distributionAvg ?? 0) <= 3) label = "Confirmación interna positiva";
  else if ((indexPct ?? 0) >= 50 && (stage2Pct ?? 0) >= 25) label = "Mejora selectiva";
  else if ((sectorPct ?? 0) < 40 || (stage4Pct ?? 0) >= 35) label = "Deterioro interno";
  return {
    label,
    indexesAbove30w: indexAbove30w,
    indexesTotal: indexes.length,
    pctIndexesAbove30w: indexPct,
    sectorsAbove30w: sectorAbove30w,
    sectorsTotal: sectors.length,
    pctSectorsAbove30w: sectorPct,
    sectorsStage2: sectorStage2,
    pctSectorsStage2: stage2Pct,
    sectorsStage4: sectorStage4,
    pctSectorsStage4: stage4Pct,
    distributionDays20Avg: distributionAvg,
    accumulationDays20Avg: accumulationAvg,
    offensiveStage2,
    defensiveStage2,
    leadingSectors: leadingSectors.map((x) => ({ symbol: x.symbol, name: x.name, score: x.weinsteinScore, rs1m: x.rs1m, rs3m: x.rs3m })),
    weakSectors: weakSectors.map((x) => ({ symbol: x.symbol, name: x.name, score: x.weinsteinScore, rs1m: x.rs1m, rs3m: x.rs3m })),
    divergences,
    indicators: [
      "Índices principales respecto a MM30 semanas",
      "Porcentaje de sectores sobre MM30 semanas",
      "Sectores en etapa 2 / etapa 4",
      "Días de distribución y acumulación en 20 sesiones",
      "Divergencias entre índices, sectores y tipo de liderazgo",
    ],
  };
}

async function computeMarketHealth() {
  const indexResults = await Promise.allSettled(INDEXES.map((idx) => analyzeIndex(idx)));
  const results = indexResults.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failures = [];
  indexResults.forEach((result, index) => {
    if (result.status === "rejected") failures.push({ symbol: INDEXES[index].symbol, name: INDEXES[index].name, reason: result.reason?.message || "Proveedor no disponible" });
  });
  const benchmark = await fetchYahooChart("SPY").catch(() => ({ bars: [] }));
  const sectorResults = await Promise.allSettled(SECTOR_ETFS.map((sector) => analyzeSector(sector, benchmark.bars || [])));
  const sectorTape = sectorResults.filter((result) => result.status === "fulfilled").map((result) => result.value).sort((a, b) => b.score - a.score);
  const sectorFailures = sectorResults.map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, index }) => ({ symbol: SECTOR_ETFS[index].symbol, name: SECTOR_ETFS[index].name, reason: result.reason?.message || "Proveedor no disponible" }));
  // El score de mercado promedia los scores POR ETAPA de los índices que
  // clasifican; un índice sin etapa (histórico corto) queda fuera del promedio
  // en vez de entrar con un número inventado.
  const scored = results.filter((x) => Number.isFinite(x.score));
  const totalWeight = scored.reduce((a, x) => a + x.weight, 0) || 1;
  const marketScore = scored.length
    ? scored.reduce((a, x) => a + x.score * x.weight, 0) / totalWeight
    : 50;
  const above50 = results.filter((x) => x.price > x.sma50).length;
  const above200 = results.filter((x) => x.price > x.sma200).length;
  const above30w = results.filter((x) => x.priceAboveSlowMa === true).length;
  const positiveSlope = results.filter((x) => x.sma200Slope > 0).length;
  const nearHighs = results.filter((x) => x.distance52w >= -10).length;
  return {
    generatedAt: new Date().toISOString(),
    marketScore,
    regime: regime(marketScore),
    breadthProxy: {
      indexes: results.length,
      above50,
      above200,
      above30w,
      positiveSma200Slope: positiveSlope,
      near52wHigh: nearHighs,
      pctAbove50: results.length ? above50 / results.length * 100 : null,
      pctAbove200: results.length ? above200 / results.length * 100 : null,
      pctAbove30w: pctPart(above30w, results.length),
    },
    indexes: results,
    sectorTape,
    weinsteinTape: weinsteinTape(results, sectorTape),
    sectorSummary: sectorSummary(sectorTape),
    sectorTapeNote: "Proxy de sectores USA mediante ETFs SPDR. Es valoración técnica por precio, medias y fuerza relativa contra SPY; no es valoración fundamental.",
    failures,
    sectorFailures,
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get("refresh") === "1" || searchParams.get("cache") === "0";
  const maxAgeParam = searchParams.get("maxAgeHours");
  const maxAgeHours = maxAgeParam === null ? NaN : Number(maxAgeParam);
  const live = refresh || searchParams.get("live") === "1";
  let cached = null;
  if (!refresh) {
    cached = await readMarketHealthCache({
      maxAgeHours: Number.isFinite(maxAgeHours) ? maxAgeHours : undefined,
      timeoutMs: MARKET_HEALTH_CACHE_READ_TIMEOUT_MS,
    });
    if (cached.hit && cached.payload) return Response.json(annotateCache(cached.payload, cached));
    if (!live) {
      if (cached?.payload) {
        return Response.json(annotateCache(cached.payload, {
          ...cached,
          hit: false,
          stale: true,
          fallbackError: cached.error || "market health cache stale",
        }));
      }
      return Response.json(annotateCache(neutralMarketHealth({ message: cached?.error || "market health live skipped" }), {
        hit: false,
        stale: false,
        fallbackError: cached?.error || "market health live skipped",
        maxAgeHours: Number.isFinite(maxAgeHours) ? maxAgeHours : DEFAULT_MARKET_HEALTH_MAX_AGE_HOURS,
      }));
    }
  }
  try {
    const payload = await Promise.race([
      computeMarketHealth(),
      timeoutAfter(MARKET_HEALTH_RESPONSE_TIMEOUT_MS, "Market health provider timeout"),
    ]);
    const cacheWrite = await writeMarketHealthCache(payload);
    return Response.json(annotateCache(payload, {
      hit: false,
      stale: false,
      cachedAt: cacheWrite.cachedAt || payload.generatedAt,
      maxAgeHours: Number.isFinite(maxAgeHours) ? maxAgeHours : DEFAULT_MARKET_HEALTH_MAX_AGE_HOURS,
    }));
  } catch (error) {
    if (cached?.payload) {
      return Response.json(annotateCache(cached.payload, {
        ...cached,
        hit: false,
        stale: true,
        fallbackError: error.message || "live market health failed",
      }));
    }
    return Response.json(annotateCache(neutralMarketHealth(error), {
      hit: false,
      stale: false,
      fallbackError: error.message || "live market health failed",
      maxAgeHours: Number.isFinite(maxAgeHours) ? maxAgeHours : DEFAULT_MARKET_HEALTH_MAX_AGE_HOURS,
    }));
  }
}
