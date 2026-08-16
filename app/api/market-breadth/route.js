import { readMarketBreadth } from "@/lib/marketBreadth";

// GET /api/market-breadth — amplitud del universo del escaneo nocturno.
//
// A diferencia de /api/market-health, aquí no hay caché de 4 horas en
// app_settings ni dependencia de proveedores externos: cada respuesta se lee
// de la base (con un memo en memoria que caduca solo cuando entra un escaneo
// o un snapshot RS nuevo). `?refresh=1` salta el memo. Solo lectura: esta
// ruta no escribe nada en Supabase.
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get("refresh") === "1";
  try {
    return Response.json(await readMarketBreadth({ refresh }));
  } catch (error) {
    console.error("[market-breadth] no se pudo calcular:", error);
    return Response.json({
      configured: true,
      error: "La amplitud del universo no está disponible ahora mismo.",
    }, { status: 500 });
  }
}
