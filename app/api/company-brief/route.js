import { fetchYahooProfile, fetchYahooChart, fetchYahooCompanyExtras } from "@/lib/yahoo";
import { fetchSecFundamentals, mergeSecGrowthMetrics } from "@/lib/sec";
import { fetchFmpCompanyData } from "@/lib/fmp";
import { externalLinks, inferTradingViewSymbol, isTradingViewWidgetBlocked } from "@/lib/symbols";

const THEME_RULES = [
  { key: "Semis / fotonica", re: /semiconductor|semiconductor equipment|integrated circuit|chip|wafer|photon|optic|laser|lithography|foundry/i, text: "Tiene exposicion a semiconductores, optica/fotonica, litografia, fabricacion de chips o infraestructura de computacion." },
  { key: "Internet / plataformas", re: /internet content|interactive media|communication services|online advertising|social network|social media|video game|gaming|multimedia|digital entertainment|streaming|e-commerce|marketplace|search|payments|fintech/i, text: "Opera en plataformas digitales, internet, publicidad online, gaming, contenidos, pagos digitales o ecosistemas de comercio y servicios." },
  { key: "Defensa / aeroespacial", re: /aerospace|defense|defence|military|missile|radar|satellite|space systems|aviation|homeland security/i, text: "Opera en defensa, aeroespacial, aviacion, satelites, sistemas criticos o ingenieria avanzada." },
  { key: "Software / IA", re: /\b(software|cloud|cyber|data|ai|artificial intelligence|analytics|platform|applications?|infrastructure|saas)\b/i, text: "Su negocio esta vinculado a software, cloud, datos, ciberseguridad, plataformas digitales, automatizacion o infraestructura de IA." },
  { key: "Energia / red", re: /electrical|power|grid|energy|uranium|nuclear|utility|solar|battery|renewable|transmission/i, text: "Esta expuesta a energia, electrificacion, red electrica, utilities, nuclear, renovables, baterias o infraestructura energetica." },
  { key: "Automatizacion", re: /robot|automation|machinery|industrial|factory|electrical equipment|sensors|controls/i, text: "Participa en automatizacion industrial, maquinaria, robotica, sensores, equipos electricos o productividad industrial." },
  { key: "Medtech / biotech", re: /medical|diagnostic|device|biotech|pharma|health|therapeutics|clinical|surgical/i, text: "Opera en salud, biotecnologia, diagnostico, dispositivos medicos, farmaceuticas, terapias o tecnologia medica." },
  { key: "Consumo / marca", re: /consumer|retail|apparel|restaurant|beverage|food|luxury|brand|e-commerce/i, text: "Su actividad esta vinculada a consumo, distribucion, retail, marcas, alimentacion, restauracion o comercio digital." },
  { key: "Finanzas", re: /bank|insurance|asset management|financial|broker|exchange|payments|fintech|credit/i, text: "Pertenece al area financiera: banca, seguros, gestion de activos, pagos, mercados, credito o fintech." },
];

function clean(s = "") { return String(s).replace(/\s+/g, " ").replace(/\([^)]*\)/g, "").trim(); }
function firstSentences(s = "", max = 2) {
  const cleaned = clean(s);
  if (!cleaned) return "";
  const parts = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, max).join(" ");
}
function inferTheme(sector = "", industry = "", summary = "") {
  const text = `${sector} ${industry} ${summary}`;
  return THEME_RULES.find((r) => r.re.test(text)) || { key: sector || "General", text: "Clasificacion tematica general." };
}
function countryFromSymbol(symbol, profileCountry = "") {
  if (profileCountry) return profileCountry;
  const s = symbol.toUpperCase();
  const map = [[".TO", "Canada"], [".MC", "España"], [".DE", "Alemania"], [".PA", "Francia"], [".AS", "Paises Bajos"], [".L", "Reino Unido"], [".SW", "Suiza"], [".ST", "Suecia"], [".CO", "Dinamarca"], [".OL", "Noruega"], [".HE", "Finlandia"], [".MI", "Italia"], [".BR", "Belgica"], [".LS", "Portugal"], [".VI", "Austria"], [".IR", "Irlanda"], [".T", "Japon"], [".HK", "Hong Kong"], [".SI", "Singapur"], [".AX", "Australia"], [".TW", "Taiwan"], [".KS", "Corea del Sur"], [".KQ", "Corea del Sur"], [".NS", "India"], [".BO", "India"], [".SS", "China"], [".SZ", "China"], [".SA", "Brasil"], [".MX", "Mexico"]];
  return map.find(([x]) => s.endsWith(x))?.[1] || "Estados Unidos";
}
function normalizeWebsite(url = "") {
  if (!url) return "";
  let u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).toString(); } catch { return ""; }
}
function domainFromUrl(url = "") { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
const COMPANY_ASSET_DOMAINS = {
  "0700.HK": "tencent.com",
  "3690.HK": "meituan.com",
  "9988.HK": "alibabagroup.com",
  "9618.HK": "jd.com",
  "1024.HK": "kuaishou.com",
  "9888.HK": "baidu.com",
  "9999.HK": "neteasegames.com",
  "1810.HK": "mi.com",
  "BILI": "bilibili.com",
  "PDD": "pinduoduo.com",
  "SE": "sea.com",
  "META": "meta.com",
  "GOOGL": "google.com",
  "NVDA": "nvidia.com",
  "AVGO": "broadcom.com",
  "AMD": "amd.com",
  "TSM": "tsmc.com",
  "2330.TW": "tsmc.com",
  "ASML.AS": "asml.com",
  "ARM": "arm.com",
  "ITX.MC": "inditex.com",
};
function assetDomainForSymbol(symbol = "", website = "") {
  return domainFromUrl(website) || COMPANY_ASSET_DOMAINS[String(symbol).toUpperCase()] || "";
}
function initials(name = "") { return clean(name).split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "SE"; }
function sizeLabel(marketCap) {
  if (!Number.isFinite(marketCap) || marketCap <= 0) return "capitalizacion no disponible";
  if (marketCap >= 200e9) return "mega capitalizacion";
  if (marketCap >= 10e9) return "gran capitalizacion";
  if (marketCap >= 2e9) return "mediana capitalizacion";
  if (marketCap >= 300e6) return "pequeña/mediana capitalizacion";
  return "micro/small cap";
}
function fmtCap(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} billones`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} mil M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} M`;
  return String(Math.round(n));
}
function normalizeCurrency(currency = "") {
  const code = String(currency || "").trim().toUpperCase();
  if (code === "GBP" || code === "GBX" || code === "GBP=X" || code === "GBp".toUpperCase()) return "GBP";
  return code;
}
function fxSymbolsToUsd(currency = "") {
  const code = normalizeCurrency(currency);
  if (!code || code === "USD") return [];
  return [`${code}USD=X`, `USD${code}=X`];
}
async function marketCapUsdInfo(marketCap, currency = "") {
  const code = normalizeCurrency(currency);
  if (!Number.isFinite(marketCap) || marketCap <= 0 || !code || code === "USD") return null;
  const [direct, inverse] = fxSymbolsToUsd(code);
  const directChart = await fetchYahooChart(direct).catch(() => ({ bars: [] }));
  const directRate = directChart.bars?.[0]?.close;
  if (Number.isFinite(directRate) && directRate > 0) {
    const value = marketCap * directRate;
    return { value, label: `${fmtCap(value)} USD`, rate: directRate, pair: direct, source: "Yahoo Finance FX" };
  }
  const inverseChart = await fetchYahooChart(inverse).catch(() => ({ bars: [] }));
  const inverseRate = inverseChart.bars?.[0]?.close;
  if (Number.isFinite(inverseRate) && inverseRate > 0) {
    const rate = 1 / inverseRate;
    const value = marketCap * rate;
    return { value, label: `${fmtCap(value)} USD`, rate, pair: inverse, source: "Yahoo Finance FX" };
  }
  return { value: null, label: "", rate: null, pair: direct || inverse || "", source: "Proveedor no disponible" };
}
function stageFromBars(bars = []) {
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const sma = (n, o = 0) => bars.length >= n + o ? avg(bars.slice(o, o + n).map((x) => x.close)) : null;
  if (bars.length < 210) return { label: "sin historico suficiente", detail: "No hay suficiente historico para estimar etapa con fiabilidad." };
  const price = bars[0].close, s50 = sma(50), s150 = sma(150), s200 = sma(200), s200p = sma(200, 30);
  const slope = s200 && s200p ? ((s200 / s200p) - 1) * 100 : null;
  if (price > s50 && price > s150 && price > s200 && s50 > s150 && s150 > s200 && slope > 0) return { label: "Etapa 2 probable", detail: "Precio por encima de medias clave y media larga ascendiendo." };
  if (price < s200 && slope < 0) return { label: "Etapa 4 probable", detail: "Precio bajo la media larga y media larga descendente." };
  if (price > s200 && slope <= 0) return { label: "Transicion/base", detail: "Precio sobre media larga, pero la pendiente aun no confirma tendencia fuerte." };
  return { label: "Neutral/mixta", detail: "La estructura de medias no confirma una etapa clara." };
}
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function sma(bars, n, offset = 0) { return bars.length >= n + offset ? avg(bars.slice(offset, offset + n).map((x) => x.close)) : null; }
function perf(bars, n) { return bars.length > n && bars[0].close && bars[n].close ? ((bars[0].close / bars[n].close) - 1) * 100 : null; }
function clamp(n, a = 0, b = 100) { return Math.max(a, Math.min(b, n)); }
function stdev(values = []) {
  const xs = values.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const mean = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - mean) ** 2)));
}
function dailyReturns(bars = [], n = 63) {
  const out = [];
  for (let i = 0; i < Math.min(n, bars.length - 1); i++) {
    const now = bars[i]?.close;
    const prev = bars[i + 1]?.close;
    if (Number.isFinite(now) && Number.isFinite(prev) && prev > 0) out.push((now / prev) - 1);
  }
  return out;
}
function annualizedVolatility(bars = [], n = 63) {
  const sd = stdev(dailyReturns(bars, n));
  return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}
function maxDrawdown(bars = [], n = 63) {
  const rows = bars.slice(0, Math.min(n, bars.length)).filter((x) => Number.isFinite(x.close)).reverse();
  if (rows.length < 2) return null;
  let peak = rows[0].close;
  let drawdown = 0;
  for (const row of rows) {
    peak = Math.max(peak, row.close);
    if (peak > 0) drawdown = Math.max(drawdown, ((peak - row.close) / peak) * 100);
  }
  return drawdown;
}
function hiLo(bars, n) {
  const slice = bars.slice(0, Math.min(n, bars.length));
  return {
    hi: Math.max(...slice.map((x) => x.high || x.close).filter(Number.isFinite)),
    lo: Math.min(...slice.map((x) => x.low || x.close).filter(Number.isFinite)),
  };
}
function highDist(bars, n) {
  if (bars.length < 20) return null;
  const hi = hiLo(bars, n).hi;
  return hi && bars[0]?.close ? ((bars[0].close / hi) - 1) * 100 : null;
}
function benchmarkForProfile(symbol, profile, themeKey) {
  const text = `${themeKey || ""} ${profile.sector || ""} ${profile.industry || ""}`.toLowerCase();
  if (/software|semis|fotonica|ia|ai|cloud|cyber|chip|technology/.test(text)) return "QQQ";
  if (countryFromSymbol(symbol, profile.country) !== "Estados Unidos") return "ACWI";
  return "SPY";
}
function relativeStrengthFromBars(bars = [], benchmarkBars = []) {
  const price = bars[0]?.close;
  const s50 = sma(bars, 50);
  const s200 = sma(bars, 200);
  const s200p = sma(bars, 200, 30);
  const slope = s200 && s200p ? ((s200 / s200p) - 1) * 100 : null;
  const p3 = perf(bars, 63), p6 = perf(bars, 126), p12 = perf(bars, 252);
  const b3 = perf(benchmarkBars, 63), b6 = perf(benchmarkBars, 126), b12 = perf(benchmarkBars, 252);
  const rs3m = Number.isFinite(p3) && Number.isFinite(b3) ? p3 - b3 : null;
  const rs6m = Number.isFinite(p6) && Number.isFinite(b6) ? p6 - b6 : null;
  const rs12m = Number.isFinite(p12) && Number.isFinite(b12) ? p12 - b12 : null;
  const distance52w = highDist(bars, 252);
  const nearHighBonus = distance52w >= -5 ? 8 : distance52w >= -15 ? 4 : distance52w >= -25 ? 1 : -6;
  const trendBonus = (price > s50 ? 4 : -4) + (slope > 0 ? 4 : -2);
  const raw = 50 + (rs3m || 0) * .9 + (rs6m || 0) * .45 + (rs12m || 0) * .22 + nearHighBonus + trendBonus;
  const rating = Math.round(Math.max(1, Math.min(99, raw)));
  const volatility63d = annualizedVolatility(bars, 63);
  const maxDrawdown63d = maxDrawdown(bars, 63);
  let stability = 72;
  if (Number.isFinite(volatility63d)) {
    if (volatility63d <= 28) stability += 14;
    else if (volatility63d <= 45) stability += 7;
    else if (volatility63d <= 70) stability -= 3;
    else if (volatility63d <= 105) stability -= 10;
    else stability -= 17;
  }
  if (Number.isFinite(maxDrawdown63d)) {
    if (maxDrawdown63d <= 10) stability += 10;
    else if (maxDrawdown63d <= 18) stability += 4;
    else if (maxDrawdown63d <= 32) stability -= 4;
    else stability -= 12;
  }
  const rsQualityScore = clamp(rating * .68 + clamp(stability) * .32);
  const speculationRiskScore = clamp(Math.max(0, (Number.isFinite(volatility63d) ? volatility63d : 35) - 35) * .62 + Math.max(0, Number.isFinite(maxDrawdown63d) ? maxDrawdown63d : 12) * .85);
  return {
    rating,
    rsQualityScore,
    rsStabilityScore: clamp(stability),
    speculationRiskScore,
    rsQualityLabel: rating >= 80 && rsQualityScore >= 72 ? "RS limpio" : rating >= 80 && speculationRiskScore >= 55 ? "RS volatil" : rating >= 75 && rsQualityScore >= 62 ? "RS eficiente" : speculationRiskScore >= 70 ? "Momentum especulativo" : rating >= 60 ? "RS constructivo" : "RS debil",
    volatility63d,
    maxDrawdown63d,
    rs3m,
    rs6m,
    rs12m,
    perf3m: p3,
    perf6m: p6,
    perf12m: p12,
    benchmarkPerf3m: b3,
    benchmarkPerf6m: b6,
    benchmarkPerf12m: b12,
    distance52w,
    note: "RS Rating aproximado calculado por StatsEdge; no equivale a ratings propietarios de MarketSurge.",
  };
}

function pctAt(rows = [], index = 0, lookback = 1, key = "close") {
  const now = rows[index]?.[key];
  const then = rows[index - lookback]?.[key];
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null;
  return ((now / then) - 1) * 100;
}

function avgAt(rows = [], index = 0, period = 50, key = "close") {
  if (index + 1 < period) return null;
  const values = rows.slice(index + 1 - period, index + 1).map((row) => row[key]).filter(Number.isFinite);
  return values.length === period ? values.reduce((sum, value) => sum + value, 0) / period : null;
}

function rollingHighDistance(rows = [], index = 0, lookback = 252) {
  const current = rows[index]?.close;
  if (!Number.isFinite(current)) return null;
  const slice = rows.slice(Math.max(0, index + 1 - lookback), index + 1);
  const high = Math.max(...slice.map((row) => row.high || row.close).filter(Number.isFinite));
  return Number.isFinite(high) && high > 0 ? ((current / high) - 1) * 100 : null;
}

function rollingRsRating(rows = [], index = 0) {
  const p3 = pctAt(rows, index, 63, "close");
  const p6 = pctAt(rows, index, 126, "close");
  const p12 = pctAt(rows, index, 252, "close");
  const b3 = pctAt(rows, index, 63, "benchmarkClose");
  const b6 = pctAt(rows, index, 126, "benchmarkClose");
  const b12 = pctAt(rows, index, 252, "benchmarkClose");
  const rs3m = Number.isFinite(p3) && Number.isFinite(b3) ? p3 - b3 : null;
  const rs6m = Number.isFinite(p6) && Number.isFinite(b6) ? p6 - b6 : null;
  const rs12m = Number.isFinite(p12) && Number.isFinite(b12) ? p12 - b12 : null;
  const s50 = avgAt(rows, index, 50, "close");
  const s200 = avgAt(rows, index, 200, "close");
  const s200Prev = index >= 30 ? avgAt(rows, index - 30, 200, "close") : null;
  const slope = Number.isFinite(s200) && Number.isFinite(s200Prev) && s200Prev !== 0 ? ((s200 / s200Prev) - 1) * 100 : null;
  const distance52w = rollingHighDistance(rows, index, 252);
  const nearHighBonus = distance52w >= -5 ? 8 : distance52w >= -15 ? 4 : distance52w >= -25 ? 1 : -6;
  const price = rows[index]?.close;
  const trendBonus = (Number.isFinite(price) && Number.isFinite(s50) && price > s50 ? 4 : -4) + (Number.isFinite(slope) && slope > 0 ? 4 : -2);
  const raw = 50 + (rs3m || 0) * .9 + (rs6m || 0) * .45 + (rs12m || 0) * .22 + nearHighBonus + trendBonus;
  return Number.isFinite(raw) ? Math.round(clamp(raw, 1, 99)) : null;
}

function relativeStrengthSeriesFromBars(bars = [], benchmarkBars = []) {
  const benchmarkByDate = new Map((benchmarkBars || [])
    .filter((bar) => bar.date && Number.isFinite(bar.close) && bar.close > 0)
    .map((bar) => [bar.date, bar.close]));
  const aligned = (bars || [])
    .filter((bar) => bar.date && Number.isFinite(bar.close) && bar.close > 0)
    .map((bar) => ({
      date: bar.date,
      close: bar.close,
      high: Number.isFinite(bar.high) ? bar.high : bar.close,
      benchmarkClose: benchmarkByDate.get(bar.date),
    }))
    .filter((bar) => Number.isFinite(bar.benchmarkClose) && bar.benchmarkClose > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (aligned.length < 20) {
    return {
      points: [],
      alignedDays: aligned.length,
      note: "Historico insuficiente para graficar RS vs benchmark.",
    };
  }

  const firstRatio = aligned[0].close / aligned[0].benchmarkClose;
  const full = aligned.map((bar, index) => {
    const ratio = bar.close / bar.benchmarkClose;
    const rsLine = firstRatio > 0 ? (ratio / firstRatio) * 100 : null;
    return {
      ...bar,
      rsLine,
      rsLineSma50: null,
      rsRating: rollingRsRating(aligned, index),
    };
  });
  const withSma = full.map((bar, index) => ({
    date: bar.date,
    rsLine: Number.isFinite(bar.rsLine) ? Number(bar.rsLine.toFixed(2)) : null,
    rsLineSma50: Number.isFinite(avgAt(full, index, 50, "rsLine")) ? Number(avgAt(full, index, 50, "rsLine").toFixed(2)) : null,
    rsRating: bar.rsRating,
  })).filter((bar) => Number.isFinite(bar.rsLine));
  const points = withSma.slice(-260);
  const latest = points.at(-1) || {};
  const previous21 = points.at(-22) || {};
  const recentHigh = Math.max(...points.slice(-252).map((bar) => bar.rsLine).filter(Number.isFinite));
  const trend21d = Number.isFinite(latest.rsLine) && Number.isFinite(previous21.rsLine) && previous21.rsLine !== 0
    ? ((latest.rsLine / previous21.rsLine) - 1) * 100
    : null;

  return {
    points,
    alignedDays: aligned.length,
    latestLine: latest.rsLine ?? null,
    latestRating: latest.rsRating ?? null,
    trend21d,
    newHigh52w: Number.isFinite(latest.rsLine) && Number.isFinite(recentHigh) ? latest.rsLine >= recentHigh * .995 : false,
    note: "Linea RS StatsEdge = precio relativo vs benchmark normalizado a 100. Es aproximada y no equivale a ratings propietarios.",
  };
}

function scoreCoverage(values = []) {
  if (!values.length) return 0;
  return Math.round((values.filter(usefulValue).length / values.length) * 100);
}

function companyCoverage({ profile = {}, chartBars = [], relativeStrength = {}, financialResults = null, growthMetrics = {}, news = [] }) {
  const latest = financialResults?.latest || {};
  const valuation = profile.valuationMetrics || {};
  const technical = scoreCoverage([
    chartBars?.[0]?.close,
    chartBars?.length >= 50 ? chartBars.length : null,
    chartBars?.length >= 200 ? chartBars.length : null,
    relativeStrength.rating,
    relativeStrength.rs3m,
    relativeStrength.rs6m,
    relativeStrength.rs12m,
    relativeStrength.distance52w,
    relativeStrength.volatility63d,
    relativeStrength.maxDrawdown63d,
    relativeStrength.series?.points?.length >= 20 ? relativeStrength.series.points.length : null,
  ]);
  const profileScore = scoreCoverage([
    profile.name,
    profile.sector && profile.sector !== "Sin sector" ? profile.sector : "",
    profile.industry && profile.industry !== "Sin industria" ? profile.industry : "",
    profile.marketCap,
    profile.currency,
    profile.country,
    profile.website,
    profile.businessSummary,
    valuation.trailingPe,
    valuation.priceToBook,
    valuation.averageVolume3m,
  ]);
  const fundamentals = scoreCoverage([
    growthMetrics.revenueGrowth,
    growthMetrics.earningsGrowth,
    growthMetrics.grossMargin,
    growthMetrics.operatingMargin,
    growthMetrics.profitMargin,
    growthMetrics.roe,
    growthMetrics.roa,
    growthMetrics.debtToEquity,
    growthMetrics.currentRatio,
    growthMetrics.shortPercentOfFloat,
    valuation.trailingPe,
    valuation.priceToSales,
    valuation.enterpriseToEbitda,
    latest.revenue,
    latest.netIncome,
    latest.freeCashFlow,
  ]);
  const newsCoverage = Array.isArray(news) && news.length ? 100 : 0;
  const total = Math.round(technical * .5 + profileScore * .22 + fundamentals * .23 + newsCoverage * .05);
  const issues = [];
  if (technical < 70) issues.push("historico tecnico parcial");
  if (profileScore < 60) issues.push("perfil incompleto");
  if (fundamentals < 40) issues.push("fundamentales limitados");
  if (!newsCoverage) issues.push("sin noticias recientes");
  return {
    total,
    technical,
    profile: profileScore,
    fundamentals,
    news: newsCoverage,
    label: total >= 80 ? "Cobertura alta" : total >= 60 ? "Cobertura util" : total >= 40 ? "Cobertura parcial" : "Cobertura baja",
    issues,
  };
}
function investorAngleFor({ stage = {}, rs = {}, theme = {} }) {
  const rating = Number.isFinite(rs.rating) ? rs.rating : null;
  const dist = Number.isFinite(rs.distance52w) ? rs.distance52w : null;
  const stageLabel = stage.label || "estructura no confirmada";
  const themeLabel = theme.key || "tematica general";
  if (/Etapa 2/i.test(stageLabel) && rating >= 75 && dist !== null && dist >= -15) {
    return `Etapa 2 probable · RS ${rating} · ${themeLabel} · precio cerca de maximos.`;
  }
  if (/Etapa 2/i.test(stageLabel)) {
    return `Etapa 2 probable · ${themeLabel} · confirmar fuerza relativa y volumen.`;
  }
  if (/Etapa 4/i.test(stageLabel)) {
    return `Etapa 4 probable · precio bajo medias clave · RS pendiente de recuperacion.`;
  }
  if (rating !== null && rating >= 80) {
    return `RS alto (${rating}) · etapa todavia no limpia.`;
  }
  if (rating !== null && rating < 45) {
    return `RS bajo (${rating}) · liderazgo tecnico no confirmado.`;
  }
  return `Estructura mixta · ${themeLabel} · tendencia y demanda pendientes de confirmacion.`;
}
function compactChartBars(bars = []) {
  return (bars || []).slice(0, 520).reverse().map((bar) => ({
    date: bar.date,
    close: Number.isFinite(bar.close) ? bar.close : null,
    high: Number.isFinite(bar.high) ? bar.high : null,
    low: Number.isFinite(bar.low) ? bar.low : null,
    volume: Number.isFinite(bar.volume) ? bar.volume : null,
  }));
}
function tradingViewEmbedInfo(symbol = "", tradingViewSymbol = "") {
  if (isTradingViewWidgetBlocked(symbol, tradingViewSymbol)) {
    return {
      supported: false,
      reason: "TradingView permite consultar este simbolo en su web, pero bloquea el widget embebido para este mercado/simbolo. Se muestra grafico interno con datos de Yahoo.",
    };
  }
  return { supported: true, reason: "" };
}
function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}
function ratioPct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}
function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}
function dateTime(value) {
  const date = new Date(value || "");
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}
function daysApart(a, b) {
  const left = dateTime(a);
  const right = dateTime(b);
  if (!left || !right) return Infinity;
  return Math.abs(left - right) / 86400000;
}
function usefulValue(value) {
  if (Number.isFinite(value)) return value !== 0;
  return value !== undefined && value !== null && value !== "";
}
function richerRow(row = {}) {
  return [
    "revenue",
    "revenueGrowthYoY",
    "grossProfit",
    "operatingIncome",
    "ebitda",
    "netIncome",
    "netIncomeGrowthYoY",
    "eps",
    "cash",
    "totalDebt",
    "totalAssets",
    "equity",
    "operatingCashFlow",
    "freeCashFlow",
  ].reduce((score, key) => score + (usefulValue(row[key]) ? 1 : 0), 0);
}
function bestFieldValue(current, incoming) {
  if (usefulValue(incoming)) return incoming;
  if (usefulValue(current)) return current;
  if (Number.isFinite(incoming)) return incoming;
  if (Number.isFinite(current)) return current;
  return incoming ?? current ?? null;
}
function mergeNearRows(current = {}, incoming = {}) {
  const merged = { ...current, ...incoming };
  const newestDate = dateTime(incoming.date) >= dateTime(current.date) ? incoming.date : current.date;
  const keys = new Set([...Object.keys(current), ...Object.keys(incoming)]);
  for (const key of keys) {
    if (key === "date") {
      merged.date = newestDate || incoming.date || current.date || "";
    } else if (key === "period") {
      merged.period = incoming.period || current.period || "";
    } else {
      merged[key] = bestFieldValue(current[key], incoming[key]);
    }
  }
  return merged;
}
function mergeRows(primary = [], fallback = []) {
  const rows = [];
  for (const row of [...(fallback || []), ...(primary || [])]) {
    if (!row?.date) continue;
    const index = rows.findIndex((existing) => daysApart(existing.date, row.date) <= 10);
    if (index === -1) {
      rows.push(row);
    } else {
      rows[index] = mergeNearRows(rows[index], row);
    }
  }
  return rows
    .sort((a, b) => (dateTime(b.date) - dateTime(a.date)) || (richerRow(b) - richerRow(a)))
    .slice(0, 8);
}
function mergeFinancialResults(yahooResults = null, secResults = null) {
  if (!yahooResults && !secResults) return null;
  if (!yahooResults) return secResults;
  if (!secResults) return yahooResults;
  const incomeQuarterly = mergeRows(yahooResults.incomeQuarterly, secResults.incomeQuarterly);
  const incomeAnnual = mergeRows(yahooResults.incomeAnnual, secResults.incomeAnnual);
  const balanceQuarterly = mergeRows(yahooResults.balanceQuarterly, secResults.balanceQuarterly);
  const balanceAnnual = mergeRows(yahooResults.balanceAnnual, secResults.balanceAnnual);
  const cashflowQuarterly = mergeRows(yahooResults.cashflowQuarterly, secResults.cashflowQuarterly);
  const cashflowAnnual = mergeRows(yahooResults.cashflowAnnual, secResults.cashflowAnnual);
  const latestIncome = incomeQuarterly[0] || incomeAnnual[0] || {};
  const latestBalance = balanceQuarterly[0] || balanceAnnual[0] || {};
  const latestCashflow = cashflowQuarterly[0] || cashflowAnnual[0] || {};
  return {
    ...yahooResults,
    currency: yahooResults.currency || secResults.currency || "",
    source: [yahooResults.source, secResults.source].filter(Boolean).join(" + "),
    incomeQuarterly,
    incomeAnnual,
    balanceQuarterly,
    balanceAnnual,
    cashflowQuarterly,
    cashflowAnnual,
    latest: {
      ...(yahooResults.latest || {}),
      date: latestIncome.date || latestBalance.date || latestCashflow.date || yahooResults.latest?.date || "",
      revenue: firstFinite(latestIncome.revenue, yahooResults.latest?.revenue),
      revenueGrowthYoY: firstFinite(latestIncome.revenueGrowthYoY, yahooResults.latest?.revenueGrowthYoY),
      grossProfit: firstFinite(latestIncome.grossProfit, yahooResults.latest?.grossProfit),
      operatingIncome: firstFinite(latestIncome.operatingIncome, yahooResults.latest?.operatingIncome),
      ebitda: firstFinite(latestIncome.ebitda, yahooResults.latest?.ebitda),
      netIncome: firstFinite(latestIncome.netIncome, yahooResults.latest?.netIncome),
      netIncomeGrowthYoY: firstFinite(latestIncome.netIncomeGrowthYoY, yahooResults.latest?.netIncomeGrowthYoY),
      eps: firstFinite(latestIncome.eps, yahooResults.latest?.eps),
      cash: firstFinite(latestBalance.cash, yahooResults.latest?.cash),
      totalDebt: firstFinite(latestBalance.totalDebt, yahooResults.latest?.totalDebt),
      totalAssets: firstFinite(latestBalance.totalAssets, yahooResults.latest?.totalAssets),
      equity: firstFinite(latestBalance.equity, yahooResults.latest?.equity),
      operatingCashFlow: firstFinite(latestCashflow.operatingCashFlow, yahooResults.latest?.operatingCashFlow),
      freeCashFlow: firstFinite(latestCashflow.freeCashFlow, yahooResults.latest?.freeCashFlow),
    },
  };
}

function deriveGrowthFromFinancialResults(results = null) {
  if (!results) return {};
  const income = results.incomeQuarterly?.[0] || results.incomeAnnual?.[0] || results.latest || {};
  const annualIncome = results.incomeAnnual?.[0] || income;
  const balance = results.balanceQuarterly?.[0] || results.balanceAnnual?.[0] || {};
  const latest = results.latest || {};
  const revenue = firstFinite(income.revenue, annualIncome.revenue, latest.revenue);
  const netIncome = firstFinite(income.netIncome, annualIncome.netIncome, latest.netIncome);
  const grossProfit = firstFinite(income.grossProfit, annualIncome.grossProfit, latest.grossProfit);
  const operatingIncome = firstFinite(income.operatingIncome, annualIncome.operatingIncome, latest.operatingIncome);
  const ebitda = firstFinite(income.ebitda, annualIncome.ebitda, latest.ebitda);
  const equity = firstFinite(balance.equity, latest.equity);
  const assets = firstFinite(balance.totalAssets, latest.totalAssets);
  const debt = firstFinite(balance.totalDebt, latest.totalDebt);
  return {
    revenueGrowth: income.revenueGrowthYoY,
    earningsGrowth: income.netIncomeGrowthYoY,
    grossMargin: ratioPct(grossProfit, revenue),
    operatingMargin: ratioPct(operatingIncome, revenue),
    profitMargin: ratioPct(netIncome, revenue),
    ebitdaMargin: ratioPct(ebitda, revenue),
    roe: ratioPct(firstFinite(annualIncome.netIncome, netIncome), equity),
    roa: ratioPct(firstFinite(annualIncome.netIncome, netIncome), assets),
    debtToEquity: ratioPct(debt, equity),
    currentRatio: ratio(balance.currentAssets, balance.currentLiabilities),
    financialCurrency: results.currency || "",
    fundamentalsAsOf: income.date || balance.date || latest.date || "",
    source: results.source ? `${results.source} derivado` : "Estados financieros derivados",
  };
}

function mergeDerivedGrowthMetrics(base = {}, derived = {}) {
  const out = { ...base };
  for (const key of ["revenueGrowth", "earningsGrowth", "grossMargin", "operatingMargin", "profitMargin", "ebitdaMargin", "roe", "roa", "debtToEquity", "currentRatio"]) {
    out[key] = firstFinite(out[key], derived[key]);
  }
  out.financialCurrency = out.financialCurrency || derived.financialCurrency || "";
  out.fundamentalsAsOf = out.fundamentalsAsOf || derived.fundamentalsAsOf || "";
  out.source = [base.source, derived.source].filter(Boolean).join(" + ") || base.source || derived.source || "";
  return out;
}

function genericText(value = "") {
  return ["", "-", "sin sector", "sin industria", "sin dato"].includes(String(value || "").trim().toLowerCase());
}

function mergeProfileFallback(profile = {}, fallback = {}) {
  const out = { ...profile };
  for (const key of ["name", "sector", "industry", "exchange", "currency", "ipoDate", "website", "country", "city", "businessSummary"]) {
    if (genericText(out[key]) && !genericText(fallback[key])) out[key] = fallback[key];
  }
  for (const key of ["marketCap", "fullTimeEmployees"]) {
    if (!Number.isFinite(out[key]) && Number.isFinite(fallback[key])) out[key] = fallback[key];
    if (key === "marketCap" && (!out[key] || out[key] <= 0) && Number.isFinite(fallback[key])) out[key] = fallback[key];
  }
  return out;
}

function mergeObjectFallback(base = {}, fallback = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(fallback || {})) {
    if (key === "source") continue;
    if (Array.isArray(value)) {
      if (!Array.isArray(out[key]) || !out[key].length) out[key] = value;
    } else if (Number.isFinite(value)) {
      if (!Number.isFinite(out[key])) out[key] = value;
    } else if ((out[key] === undefined || out[key] === null || out[key] === "") && value !== undefined && value !== null && value !== "") {
      out[key] = value;
    }
  }
  out.source = [base.source, fallback?.source].filter(Boolean).join(" + ") || base.source || fallback?.source || "";
  return out;
}

export async function getCompanyBrief(symbol) {
  if (!symbol) throw new Error("Falta symbol");
  try {
    const [profileResult, chart] = await Promise.all([
      fetchYahooProfile(symbol).catch((error) => ({ profileProviderError: error.message || "Proveedor no disponible" })),
      fetchYahooChart(symbol).catch(() => ({ bars: [] })),
    ]);
    const profile = {
      name: chart.meta?.longName || chart.meta?.shortName || symbol,
      marketCap: 0,
      sector: "Sin sector",
      industry: "Sin industria",
      exchange: chart.meta?.fullExchangeName || chart.meta?.exchangeName || "-",
      currency: chart.meta?.currency || "",
      ipoDate: "",
      website: "",
      city: "",
      country: "",
      fullTimeEmployees: null,
      businessSummary: "",
      growthMetrics: {
        revenueGrowth: null,
        earningsGrowth: null,
        grossMargin: null,
        operatingMargin: null,
        profitMargin: null,
        ebitdaMargin: null,
        roe: null,
        roa: null,
        debtToEquity: null,
        currentRatio: null,
        institutionalOwnership: null,
        insiderOwnership: null,
        shortPercentOfFloat: null,
        sharesPercentSharesOut: null,
        shortRatio: null,
        sharesShort: null,
        sharesShortPriorMonth: null,
        floatShares: null,
        sharesOutstanding: null,
        fundsCountApprox: null,
        institutionsCountApprox: null,
        topFunds: [],
        topInstitutions: [],
        providerNote: "Datos aproximados segun proveedor disponible; no equivalen a ratings propietarios de MarketSurge.",
      },
      valuationMetrics: {},
      quoteSnapshot: {},
      ...profileResult,
    };
    const [extrasResult, secResult, fmpResult] = await Promise.all([
      fetchYahooCompanyExtras(symbol, profile).catch((error) => ({ extrasProviderError: error.message || "Proveedor no disponible" })),
      fetchSecFundamentals(symbol).catch((error) => ({ error: error.message || "SEC no disponible" })),
      fetchFmpCompanyData(symbol).catch((error) => ({ fmpProviderError: error.message || "FMP no disponible" })),
    ]);
    if (fmpResult.profile) {
      Object.assign(profile, mergeProfileFallback(profile, fmpResult.profile));
      if (fmpResult.profile.image) profile.fmpImage = fmpResult.profile.image;
    }
    if (fmpResult.growthMetrics) profile.growthMetrics = mergeObjectFallback(profile.growthMetrics, fmpResult.growthMetrics);
    if (fmpResult.valuationMetrics) profile.valuationMetrics = mergeObjectFallback(profile.valuationMetrics, fmpResult.valuationMetrics);
    if (fmpResult.quoteSnapshot) profile.quoteSnapshot = mergeObjectFallback(profile.quoteSnapshot, fmpResult.quoteSnapshot);
    if (!secResult.error) profile.growthMetrics = mergeSecGrowthMetrics(profile.growthMetrics, secResult);
    const yahooFinancialResults = mergeFinancialResults(profile.fundamentalsFinancialResults || profile.growthMetrics?.financialResults, extrasResult.financialResults);
    const secFinancialResults = mergeFinancialResults(yahooFinancialResults, secResult.financialResults);
    const financialResults = mergeFinancialResults(secFinancialResults, fmpResult.financialResults);
    profile.growthMetrics = mergeDerivedGrowthMetrics(profile.growthMetrics, deriveGrowthFromFinancialResults(financialResults));
    const theme = inferTheme(profile.sector, profile.industry, profile.businessSummary);
    const country = countryFromSymbol(symbol, profile.country);
    const summary = firstSentences(profile.businessSummary, 2);
    const cap = fmtCap(profile.marketCap);
    const marketCapCurrency = normalizeCurrency(profile.currency);
    const marketCapUsd = await marketCapUsdInfo(profile.marketCap, marketCapCurrency).catch(() => null);
    const stage = stageFromBars(chart.bars || []);
    const benchmarkSymbol = benchmarkForProfile(symbol, profile, theme.key);
    const benchmarkChart = await fetchYahooChart(benchmarkSymbol).catch(() => ({ bars: [] }));
    const relativeStrength = {
      benchmarkSymbol,
      ...relativeStrengthFromBars(chart.bars || [], benchmarkChart.bars || []),
    };
    relativeStrength.series = relativeStrengthSeriesFromBars(chart.bars || [], benchmarkChart.bars || []);
    const website = normalizeWebsite(profile.website);
    const domain = assetDomainForSymbol(symbol, website);
    const links = {
      official: website || null,
      ...externalLinks(symbol, profile.exchange),
    };
    const tradingViewSymbol = inferTradingViewSymbol(symbol, profile.exchange);
    const chartEmbed = tradingViewEmbedInfo(symbol, tradingViewSymbol);
    const visual = {
      initials: initials(profile.name),
      domain,
      logoUrl: domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null,
      clearbitLogoUrl: domain ? `https://logo.clearbit.com/${domain}` : null,
    };
    const short = `${profile.name} es una compañía de ${country} del sector ${profile.sector || "sin clasificar"}, en la industria ${profile.industry || "no especificada"}. ${theme.text}`;
    const investorAngle = investorAngleFor({ stage, rs: relativeStrength, theme });
    const coverage = companyCoverage({
      profile,
      chartBars: chart.bars || [],
      relativeStrength,
      financialResults,
      growthMetrics: profile.growthMetrics || {},
      news: extrasResult.news || [],
    });
    return {
      symbol,
      name: profile.name,
      sector: profile.sector,
      industry: profile.industry,
      exchange: profile.exchange,
      currency: profile.currency,
      marketCap: profile.marketCap,
      marketCapCurrency,
      marketCapLabel: `${sizeLabel(profile.marketCap)}${cap ? ` (~${cap}${marketCapCurrency ? ` ${marketCapCurrency}` : ""})` : ""}`,
      marketCapUsd: marketCapUsd?.value ?? null,
      marketCapUsdLabel: marketCapUsd?.label || "",
      marketCapFx: marketCapUsd ? {
        rate: marketCapUsd.rate,
        pair: marketCapUsd.pair,
        source: marketCapUsd.source,
      } : null,
      ipoDate: profile.ipoDate,
      country,
      city: profile.city,
      employees: profile.fullTimeEmployees,
      theme: theme.key,
      short,
      summary: summary || "Yahoo no ofrece un resumen de negocio suficientemente claro para esta empresa.",
      investorAngle,
      stage,
      relativeStrength,
      links,
      tradingViewSymbol,
      chartEmbed,
      chartBars: compactChartBars(chart.bars || []),
      chartProvider: chart.meta?.dataProvider || "Yahoo Finance",
      visual,
      valuationMetrics: profile.valuationMetrics || {},
      quoteSnapshot: profile.quoteSnapshot || {},
      growthMetrics: profile.growthMetrics,
      earningsCalendar: extrasResult.earningsCalendar || null,
      financialResults,
      news: extrasResult.news || [],
      dataQuality: {
        profileProviderError: profile.profileProviderError || null,
        extrasProviderError: extrasResult.extrasProviderError || null,
        secProviderError: secResult.error || null,
        fmpProviderError: fmpResult.fmpProviderError || null,
        coverage,
        providers: {
          profile: "Yahoo Finance",
          chart: chart.meta?.fallbackReason ? `${chart.meta?.dataProvider || "Yahoo Finance"} · fallback: ${chart.meta.fallbackReason}` : chart.meta?.dataProvider || "Yahoo Finance",
          news: "Yahoo Finance search/news + Google News RSS fallback",
          statements: fmpResult.financialResults ? "Yahoo quoteSummary statements + FMP fallback" : "Yahoo quoteSummary statements",
          fundamentalsFallback: secResult.error ? "SEC EDGAR no aplicado" : "SEC EDGAR companyfacts",
          fundamentalsApi: fmpResult.configured === false ? "FMP no configurado" : (fmpResult.fmpProviderError ? "FMP no disponible" : "FMP opcional"),
        },
      },
      updatedAt: new Date().toISOString(),
    };
  } catch (e) {
    throw e;
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "Falta symbol" }, { status: 400 });
  try {
    return Response.json(await getCompanyBrief(symbol));
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
