import { fetchYahooChart } from "@/lib/yahoo";

const INDEXES = [
  { symbol: "^GSPC", name: "S&P 500", weight: 30 },
  { symbol: "^IXIC", name: "Nasdaq Composite", weight: 30 },
  { symbol: "^RUT", name: "Russell 2000", weight: 20 },
  { symbol: "^DJI", name: "Dow Jones", weight: 10 },
  { symbol: "ACWI", name: "MSCI ACWI ETF", weight: 10 },
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

function weekKey(date = "") {
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date;
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function weeklyBarsFromDaily(bars = []) {
  const buckets = new Map();
  [...bars]
    .filter((bar) => bar?.date && Number.isFinite(bar.close))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((bar) => {
      const key = weekKey(bar.date);
      const bucket = buckets.get(key) || {
        date: key,
        close: bar.close,
        high: bar.high || bar.close,
        low: bar.low || bar.close,
        volume: 0,
      };
      bucket.close = bar.close;
      bucket.high = Math.max(bucket.high, bar.high || bar.close);
      bucket.low = Math.min(bucket.low, bar.low || bar.close);
      bucket.volume += Number.isFinite(bar.volume) ? bar.volume : 0;
      buckets.set(key, bucket);
    });
  return [...buckets.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function stage30wLabel(x = {}) {
  if (!Number.isFinite(x.price) || !Number.isFinite(x.sma30w) || !Number.isFinite(x.sma30wSlope)) return "Histórico insuficiente";
  if (x.price > x.sma30w && x.sma30wSlope > 0) return "Etapa 2 probable";
  if (x.price > x.sma30w && x.sma30wSlope <= 0) return "Base / transición";
  if (x.price < x.sma30w && x.sma30wSlope >= 0) return "Bajo MM30s";
  if (x.price < x.sma30w && x.sma30wSlope < 0) return "Etapa 4 probable";
  return "Neutral";
}

function weeklyStage(bars = []) {
  const weeks = weeklyBarsFromDaily(bars);
  const s30 = sma(weeks, 30);
  const s30p = sma(weeks, 30, 10);
  const price = weeks[0]?.close ?? bars[0]?.close;
  const item = {
    weeklyBars: weeks.length,
    sma30w: s30,
    sma30wSlope: s30 && s30p ? ((s30 / s30p) - 1) * 100 : null,
    distanceSma30w: price && s30 ? ((price / s30) - 1) * 100 : null,
  };
  item.stage30w = stage30wLabel({ price, ...item });
  return item;
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
  if (x.price > x.sma30w) s += 25;
  if (x.sma30wSlope > 0) s += 25;
  if (x.stage30w === "Etapa 2 probable") s += 20;
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

function scoreIndex(x) {
  let s = 0;
  if (x.price > x.sma50) s += 15;
  if (x.price > x.sma200) s += 20;
  if (x.sma50 > x.sma200) s += 15;
  if (x.sma200Slope > 0) s += 20;
  if (x.perf1m > 0) s += 8;
  if (x.perf3m > 0) s += 10;
  if (x.distance52w >= -10) s += 7;
  if (x.distance52w >= -5) s += 5;
  return clamp(s);
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

async function analyzeIndex(meta) {
  const { bars } = await fetchYahooChart(meta.symbol);
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
  item.stage = stageLabel(item);
  item.score = scoreIndex(item);
  item.weinsteinScore = scoreWeinsteinTape(item);
  return item;
}

async function analyzeSector(meta, benchmarkBars = []) {
  const { bars } = await fetchYahooChart(meta.symbol);
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
  const indexAbove30w = indexes.filter((x) => x.price > x.sma30w).length;
  const sectorAbove30w = sectors.filter((x) => x.price > x.sma30w).length;
  const sectorStage2 = sectors.filter((x) => x.stage30w === "Etapa 2 probable").length;
  const sectorStage4 = sectors.filter((x) => x.stage30w === "Etapa 4 probable").length;
  const distributionAvg = avg(sectors.map((x) => x.distributionDays20).filter(Number.isFinite));
  const accumulationAvg = avg(sectors.map((x) => x.accumulationDays20).filter(Number.isFinite));
  const indexPct = pctPart(indexAbove30w, indexes.length);
  const sectorPct = pctPart(sectorAbove30w, sectors.length);
  const stage2Pct = pctPart(sectorStage2, sectors.length);
  const stage4Pct = pctPart(sectorStage4, sectors.length);
  const offensiveGroups = new Set(["Crecimiento", "Cíclico", "Valor / materias"]);
  const offensiveStage2 = sectors.filter((x) => offensiveGroups.has(x.group) && x.stage30w === "Etapa 2 probable").length;
  const defensiveStage2 = sectors.filter((x) => x.group === "Defensivo" && x.stage30w === "Etapa 2 probable").length;
  const leadingSectors = [...sectors]
    .filter((x) => x.stage30w === "Etapa 2 probable" && ((x.rs1m ?? -99) > 0 || (x.rs3m ?? -99) > 0))
    .sort((a, b) => (b.weinsteinScore - a.weinsteinScore) || (b.score - a.score))
    .slice(0, 5);
  const weakSectors = [...sectors]
    .filter((x) => x.stage30w === "Etapa 4 probable" || x.weinsteinScore < 35)
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
      "Sectores en Etapa 2 / Etapa 4 probable",
      "Días de distribución y acumulación en 20 sesiones",
      "Divergencias entre índices, sectores y tipo de liderazgo",
    ],
  };
}

export async function GET() {
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
  const totalWeight = results.reduce((a, x) => a + x.weight, 0) || 1;
  const marketScore = results.reduce((a, x) => a + x.score * x.weight, 0) / totalWeight;
  const above50 = results.filter((x) => x.price > x.sma50).length;
  const above200 = results.filter((x) => x.price > x.sma200).length;
  const above30w = results.filter((x) => x.price > x.sma30w).length;
  const positiveSlope = results.filter((x) => x.sma200Slope > 0).length;
  const nearHighs = results.filter((x) => x.distance52w >= -10).length;
  return Response.json({
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
  });
}
