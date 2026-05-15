const BULLISH_RULES = [
  [/rall(y|ies|ied)|surge|jump|soar|gain|advance|rebound|breakout|record high|all-time high/i, 14, "precio fuerte"],
  [/bullish|bull market|risk-on|optimis|confidence|soft landing|resilien/i, 13, "optimismo"],
  [/beat|beats|upgrade|raised guidance|strong earnings|profit rises|sales rise|growth accelerat/i, 12, "fundamentales positivos"],
  [/rate cut|cuts rates|dovish|easing|stimulus|liquidity|cooling inflation/i, 10, "condiciones favorables"],
  [/buy zone|accumulation|leadership|outperform|momentum|new leader/i, 10, "liderazgo"],
];

const BEARISH_RULES = [
  [/sell-?off|plunge|crash|slump|rout|tumble|drop|losses|slides|falls|down sharply/i, -15, "venta/debilidad"],
  [/bearish|bear market|risk-off|fear|panic|stress|volatility spike|capitulation/i, -14, "miedo"],
  [/recession|slowdown|stagflation|hard landing|default|credit crunch|bank crisis/i, -13, "macro negativo"],
  [/inflation|hot producer|hot cpi|hawkish|rate hike|higher yields|tariff|trade war/i, -10, "presion macro"],
  [/warning|warns|miss|misses|downgrade|cuts guidance|margin pressure|profit falls/i, -11, "deterioro fundamental"],
  [/bubble|overvalued|valuation risk|concentration risk|correction|pullback/i, -8, "riesgo/valoracion"],
];

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function signedLabel(score) {
  if (score >= 12) return "alcista";
  if (score <= -12) return "bajista";
  return "neutral";
}

export function analyzeNewsItem(item = {}) {
  const text = `${item.title || ""} ${item.publisher || ""}`.toLowerCase();
  let score = 0;
  const hits = [];
  for (const [rule, weight, label] of [...BULLISH_RULES, ...BEARISH_RULES]) {
    if (rule.test(text)) {
      score += weight;
      hits.push(label);
    }
  }
  score = clamp(score, -100, 100);
  return {
    ...item,
    sentimentScore: score,
    sentimentLabel: signedLabel(score),
    sentimentConfidence: clamp(Math.abs(score) * 3 + hits.length * 8, 0, 100),
    sentimentReasons: [...new Set(hits)].slice(0, 4),
  };
}

export function summarizeNewsSentiment(rows = []) {
  const analyzed = rows.map(analyzeNewsItem);
  const total = analyzed.length || 1;
  const bullish = analyzed.filter((item) => item.sentimentLabel === "alcista").length;
  const bearish = analyzed.filter((item) => item.sentimentLabel === "bajista").length;
  const neutral = analyzed.filter((item) => item.sentimentLabel === "neutral").length;
  const bullishPct = analyzed.length ? (bullish / analyzed.length) * 100 : 0;
  const bearishPct = analyzed.length ? (bearish / analyzed.length) * 100 : 0;
  const neutralPct = analyzed.length ? (neutral / analyzed.length) * 100 : 0;
  const sentimentSpread = bullishPct - bearishPct;
  const dominantSentiment = bullishPct >= bearishPct && bullishPct >= neutralPct
    ? "alcista"
    : bearishPct >= bullishPct && bearishPct >= neutralPct
      ? "bajista"
      : "neutral";
  const avgScore = analyzed.length ? analyzed.reduce((sum, item) => sum + item.sentimentScore, 0) / analyzed.length : 0;
  const fearTilt = ((bearish - bullish) / total) * 22;
  const pessimismIndex = Math.round(clamp(50 - avgScore * 1.15 + fearTilt, 0, 100));
  const optimismIndex = Math.round(clamp(50 + avgScore * 1.15 - fearTilt, 0, 100));
  let regime = "Neutral";
  let contrarianRead = "Ruido equilibrado: el precio y la amplitud mandan mas que los titulares.";
  if (pessimismIndex >= 75) {
    regime = "Pesimismo extremo";
    contrarianRead = "Lectura contraria potencial: si los indices recuperan medias y aparecen lideres, el miedo puede estar cerca de agotarse.";
  } else if (pessimismIndex >= 62) {
    regime = "Negatividad dominante";
    contrarianRead = "Entorno emocional defensivo. En Weinstein conviene esperar confirmacion tecnica antes de aumentar riesgo.";
  } else if (pessimismIndex <= 25) {
    regime = "Optimismo/euforia";
    contrarianRead = "Optimismo elevado. Puede acompañar una etapa 2, pero tambien aumenta riesgo de complacencia si el precio se extiende.";
  } else if (pessimismIndex <= 38) {
    regime = "Optimismo dominante";
    contrarianRead = "Titulares constructivos. Es favorable si coincide con medias ascendentes y liderazgo amplio.";
  }
  return {
    total: analyzed.length,
    bullish,
    bearish,
    neutral,
    bullishPct,
    bearishPct,
    neutralPct,
    sentimentSpread,
    dominantSentiment,
    avgScore,
    pessimismIndex,
    optimismIndex,
    regime,
    contrarianRead,
    note: "Indice heuristico basado en titulares recientes; no es analisis semantico propietario ni recomendacion.",
    rows: analyzed,
  };
}
