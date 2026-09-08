import { readMarketLeadership } from "@/lib/marketLeadership";

// GET /api/market-leadership — leadership pulse y filas regionales del
// escaneo nocturno publicable. Solo lectura; memo en memoria como
// /api/market-breadth. `?refresh=1` salta el memo.
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get("refresh") === "1";
  try {
    return Response.json(await readMarketLeadership({ refresh }));
  } catch (error) {
    console.error("[market-leadership] no se pudo calcular:", error);
    return Response.json({
      configured: true,
      error: "El liderazgo de mercado no está disponible ahora mismo.",
      pulse: null,
    }, { status: 500 });
  }
}
