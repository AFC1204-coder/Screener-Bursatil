import { checkSupabaseSchema } from "@/lib/supabaseDiagnostics";

export async function GET() {
  try {
    return Response.json(await checkSupabaseSchema());
  } catch (error) {
    return Response.json({
      configured: true,
      ok: false,
      message: error.message || "Supabase no disponible",
      details: error.details || null,
    }, { status: 500 });
  }
}
