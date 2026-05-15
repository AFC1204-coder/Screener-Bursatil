import { summarizeNewsSentiment } from "@/lib/newsSentiment";
import { fetchYahooMarketNews } from "@/lib/yahoo";

export async function GET() {
  try {
    const rows = await fetchYahooMarketNews();
    const sentiment = summarizeNewsSentiment(rows);
    return Response.json({
      provider: "Yahoo Finance News + Google News RSS",
      updatedAt: new Date().toISOString(),
      ...sentiment,
    });
  } catch (error) {
    return Response.json({
      error: error.message || "Proveedor de noticias no disponible",
      provider: "Yahoo Finance News + Google News RSS",
      updatedAt: new Date().toISOString(),
      total: 0,
      rows: [],
    }, { status: 500 });
  }
}
