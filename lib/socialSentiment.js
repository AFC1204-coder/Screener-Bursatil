import { analyzeNewsItem } from "@/lib/newsSentiment";

const DEFAULT_X_QUERY = '("$SPY" OR "$QQQ" OR "stock market" OR "S&P 500" OR Nasdaq OR "market crash" OR "bull market" OR "bear market" OR inflation OR "rate cuts") lang:en -is:retweet';

const SOCIAL_BULLISH_RULES = [
  [/\b(long|buying|bought|accumulat(e|ing)|calls?|call spread|risk on|squeeze|breakout|new highs?)\b/i, 10, "flujo alcista"],
  [/\b(leadership|relative strength|rs leader|constructive|base breakout|higher highs?)\b/i, 9, "liderazgo social"],
  [/\$?(spy|qqq|iwm|nasdaq|spx).{0,32}\b(rip|green|bounce|rally|higher|breakout)\b/i, 8, "indices fuertes"],
];

const SOCIAL_BEARISH_RULES = [
  [/\b(short|shorting|puts?|put spread|risk off|dump|rug|bearish|overbought|distribution)\b/i, -10, "flujo bajista"],
  [/\b(crash|capitulation|liquidation|panic|bloodbath|recession|hard landing)\b/i, -13, "miedo social"],
  [/\$?(spy|qqq|iwm|nasdaq|spx).{0,32}\b(red|dump|selloff|breakdown|lower|crash)\b/i, -9, "indices débiles"],
];

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function signedLabel(score) {
  if (score >= 12) return "alcista";
  if (score <= -12) return "bajista";
  return "neutral";
}

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function cleanQueryTerm(value = "") {
  return cleanText(value).replace(/"/g, "").slice(0, 80);
}

function baseTicker(symbol = "") {
  return String(symbol || "").toUpperCase().split(".")[0].replace(/[^A-Z0-9.-]/g, "");
}

function companySearchName(name = "") {
  const cleaned = cleanQueryTerm(name)
    .replace(/\b(inc|incorporated|corp|corporation|company|co|plc|sa|ag|nv|se|ltd|limited|holdings?|group)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 4 || cleaned.length > 42) return "";
  return cleaned;
}

function xQueryForSymbol({ symbol = "", name = "" } = {}) {
  const ticker = baseTicker(symbol);
  if (!ticker) return process.env.SOCIAL_SENTIMENT_QUERY || DEFAULT_X_QUERY;
  const fullSymbol = cleanQueryTerm(symbol.toUpperCase());
  const cashtag = `$${ticker}`;
  const company = companySearchName(name);
  const terms = [`"${cashtag}"`];
  if (fullSymbol && fullSymbol !== ticker) terms.push(`"${fullSymbol}"`);
  if (company) terms.push(`("${company}" stock)`);
  return `(${terms.join(" OR ")}) lang:en -is:retweet`;
}

function socialEngagement(metrics = {}) {
  return (metrics.like_count || 0)
    + (metrics.reply_count || 0)
    + (metrics.repost_count || 0) * 2
    + (metrics.quote_count || 0) * 2;
}

export function analyzeSocialItem(item = {}) {
  const base = analyzeNewsItem(item);
  const text = `${item.title || ""} ${item.publisher || ""}`.toLowerCase();
  let score = base.sentimentScore || 0;
  const hits = [...(base.sentimentReasons || [])];
  for (const [rule, weight, label] of [...SOCIAL_BULLISH_RULES, ...SOCIAL_BEARISH_RULES]) {
    if (rule.test(text)) {
      score += weight;
      hits.push(label);
    }
  }
  score = clamp(score, -100, 100);
  return {
    ...base,
    sentimentScore: score,
    sentimentLabel: signedLabel(score),
    sentimentConfidence: clamp(Math.abs(score) * 3 + hits.length * 8, 0, 100),
    sentimentReasons: [...new Set(hits)].slice(0, 5),
  };
}

export function summarizeSocialSentiment(rows = []) {
  const analyzed = rows.map(analyzeSocialItem);
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
  const totalEngagement = analyzed.reduce((sum, item) => sum + (item.engagement || 0), 0);
  const avgScore = analyzed.length ? analyzed.reduce((sum, item) => sum + item.sentimentScore, 0) / analyzed.length : 0;
  const weightedAvgScore = analyzed.length
    ? analyzed.reduce((sum, item) => sum + item.sentimentScore * ((item.engagement || 0) + 1), 0)
      / analyzed.reduce((sum, item) => sum + ((item.engagement || 0) + 1), 0)
    : 0;
  const fearTilt = ((bearish - bullish) / total) * 24;
  const pessimismIndex = Math.round(clamp(50 - weightedAvgScore * 1.08 + fearTilt, 0, 100));
  const optimismIndex = Math.round(clamp(50 + weightedAvgScore * 1.08 - fearTilt, 0, 100));
  let regime = "Neutral";
  let contrarianRead = "Ruido social equilibrado: conviene dar más peso a precio, volumen y amplitud.";
  if (pessimismIndex >= 78) {
    regime = "Miedo social extremo";
    contrarianRead = "Lectura contraria potencial: si el mercado deja de caer y aparecen líderes, el pesimismo social puede señalar agotamiento vendedor.";
  } else if (pessimismIndex >= 63) {
    regime = "Negatividad social dominante";
    contrarianRead = "La conversacion esta defensiva. En analisis técnico por etapas, mejor exigir confirmación de medias y amplitud antes de aumentar riesgo.";
  } else if (pessimismIndex <= 24) {
    regime = "Euforia social";
    contrarianRead = "Complacencia elevada. Puede convivir con etapa 2, pero aumenta el riesgo de extension y falsas rupturas.";
  } else if (pessimismIndex <= 38) {
    regime = "Optimismo social dominante";
    contrarianRead = "Tono social constructivo. Es útil si acompaña a liderazgo real, no si solo hay entusiasmo sin precio.";
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
    weightedAvgScore,
    totalEngagement,
    avgEngagement: analyzed.length ? totalEngagement / analyzed.length : 0,
    pessimismIndex,
    optimismIndex,
    regime,
    contrarianRead,
    note: "Indice heurístico basado en posts publicos recientes; no es analisis semantico propietario ni recomendacion.",
    rows: analyzed,
  };
}

export async function fetchXMarketPosts(options = {}) {
  const token = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
  const query = options.query || (options.symbol ? xQueryForSymbol(options) : process.env.SOCIAL_SENTIMENT_QUERY || DEFAULT_X_QUERY);
  if (!token) {
    // El nombre de la variable de entorno se queda en el servidor: es
    // instrucción de despliegue, no información para quien usa el producto.
    // Las superficies que consumen esto (ficha del valor y salud de mercado)
    // ocultan la sección cuando `configured` es false, así que este texto no
    // se pinta — existe para el log y para quien depure la respuesta.
    console.warn("[social] X sin token: define X_BEARER_TOKEN o TWITTER_BEARER_TOKEN en el entorno.");
    return {
      configured: false,
      query,
      rows: [],
      error: "La integración con X no está activada.",
    };
  }

  const requested = Number(process.env.SOCIAL_SENTIMENT_MAX_RESULTS) || 25;
  const maxResults = String(Math.max(10, Math.min(100, requested)));
  const params = new URLSearchParams({
    query,
    max_results: maxResults,
    "tweet.fields": "created_at,lang,public_metrics,possibly_sensitive",
    expansions: "author_id",
    "user.fields": "name,username,verified,verified_type,public_metrics",
  });
  const res = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = payload?.detail || payload?.title || payload?.errors?.[0]?.detail || payload?.errors?.[0]?.title || "Proveedor no disponible";
    throw new Error(`X API HTTP ${res.status}: ${detail}`);
  }
  const users = new Map((payload.includes?.users || []).map((user) => [user.id, user]));
  const rows = (payload.data || []).map((tweet) => {
    const user = users.get(tweet.author_id) || {};
    const username = user.username || "";
    const metrics = tweet.public_metrics || {};
    return {
      id: tweet.id,
      title: cleanText(tweet.text),
      publisher: username ? `@${username}` : "X",
      authorName: user.name || username || "X",
      link: username ? `https://x.com/${username}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
      publishedAt: tweet.created_at,
      type: "POST",
      source: "X API v2 recent search",
      relatedTickers: [],
      engagement: socialEngagement(metrics),
      publicMetrics: metrics,
      verified: Boolean(user.verified),
      verifiedType: user.verified_type || "",
    };
  });
  return { configured: true, query, rows, meta: payload.meta || {} };
}
