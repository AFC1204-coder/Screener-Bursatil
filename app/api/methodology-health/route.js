import { readMethodologyHealth } from "@/lib/methodologyHealth";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await readMethodologyHealth());
  } catch (error) {
    return Response.json({
      ok: false,
      configured: false,
      status: "error",
      label: "Error metodologico",
      detail: error.message || "No se pudo leer la matriz metodologica.",
      error: error.message || "methodology health unavailable",
    }, { status: 500 });
  }
}
