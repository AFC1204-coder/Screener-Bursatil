import { fetchXMarketPosts, summarizeSocialSentiment } from "@/lib/socialSentiment";

export const dynamic = "force-dynamic";

function emptySocial(payload = {}) {
  return {
    provider: "X API v2 recent search",
    configured: false,
    updatedAt: new Date().toISOString(),
    total: 0,
    bullish: 0,
    bearish: 0,
    neutral: 0,
    bullishPct: 0,
    bearishPct: 0,
    neutralPct: 0,
    sentimentSpread: 0,
    dominantSentiment: "neutral",
    avgScore: 0,
    weightedAvgScore: 0,
    totalEngagement: 0,
    avgEngagement: 0,
    pessimismIndex: 50,
    optimismIndex: 50,
    regime: "Sin X configurado",
    contrarianRead: "Configura la API oficial de X para leer posts recientes y calcular el pulso social.",
    note: "La app no hace scraping de X; usa la API oficial cuando hay token disponible.",
    rows: [],
    ...payload,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "";
  const name = searchParams.get("name") || "";
  try {
    const result = await fetchXMarketPosts({ symbol, name });
    if (!result.configured) {
      return Response.json(emptySocial({
        error: result.error,
        query: result.query,
        symbol: symbol || null,
      }));
    }
    const sentiment = summarizeSocialSentiment(result.rows);
    return Response.json({
      provider: "X API v2 recent search",
      configured: true,
      symbol: symbol || null,
      query: result.query,
      meta: result.meta,
      updatedAt: new Date().toISOString(),
      ...sentiment,
    });
  } catch (error) {
    return Response.json(emptySocial({
      configured: true,
      error: error.message || "X no disponible",
      regime: "X no disponible",
      contrarianRead: "No se pudo leer X en esta pasada. Revisa token, credito de API, permisos y query.",
    }), { status: 200 });
  }
}
