import { fetchXMarketPosts, summarizeSocialSentiment } from "@/lib/socialSentiment";

export const dynamic = "force-dynamic";

// Sin muestra no hay distribución, ni índice de pesimismo, ni sentimiento
// dominante: todo eso va a null, no a 0/50/"neutral". Un 50 aquí llegaba a la
// pantalla como una lectura de sentimiento que nadie había medido
// (docs/principios-producto.md, principio 3).
function emptySocial(payload = {}) {
  return {
    provider: "X API v2 recent search",
    configured: false,
    updatedAt: new Date().toISOString(),
    total: 0,
    bullish: null,
    bearish: null,
    neutral: null,
    bullishPct: null,
    bearishPct: null,
    neutralPct: null,
    sentimentSpread: null,
    dominantSentiment: null,
    avgScore: null,
    weightedAvgScore: null,
    totalEngagement: null,
    avgEngagement: null,
    pessimismIndex: null,
    optimismIndex: null,
    regime: null,
    contrarianRead: "",
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
      // SIN campo `error`: lib/clientApi.js convierte cualquier `error` del
      // cuerpo en una excepción, aunque el HTTP sea 200. Por eso el aviso de
      // integración no configurada llegaba al cliente como un fallo y se
      // pintaba en la ficha y en salud de mercado —con el nombre de la
      // variable de entorno dentro— en vez de activar la rama que oculta la
      // sección. Que la integración no esté activada no es un error: es que
      // esta parte del producto no existe en este despliegue.
      return Response.json(emptySocial({
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
    // El detalle del proveedor (código HTTP, texto de la API de X) se queda en
    // el log del servidor; hacia fuera va una frase de producto.
    console.error("[social] no se pudo leer X:", error);
    return Response.json(emptySocial({
      configured: true,
      error: "No se ha podido leer el pulso social en esta pasada.",
    }), { status: 200 });
  }
}
