import { disabledPayload, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export async function GET() {
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  try {
    await supabaseRequest("scans", { query: "select=id&limit=1" });
    return Response.json({
      configured: true,
      ok: true,
      ownerId: config.ownerId,
      message: "Supabase conectado.",
    });
  } catch (error) {
    return Response.json({
      configured: true,
      ok: false,
      ownerId: config.ownerId,
      message: error.message || "Supabase no disponible",
      details: error.details || null,
    }, { status: 500 });
  }
}
