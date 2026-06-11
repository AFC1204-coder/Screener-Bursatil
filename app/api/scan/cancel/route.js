// POST /api/scan/cancel — solicita la cancelación de un scan en servidor.
// Valida que el scan existe y sigue en curso, y escribe
// settings.progress.cancelRequested = true; el runner de /api/scan relee ese flag
// al inicio de cada lote de persistencia y termina limpio marcando "cancelled".
import { isTerminalScanStatus } from "@/lib/scanStatus";
import { disabledPayload, requirePersistenceAuth, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload(), { status: 503 });
  let body = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body JSON inválido" }, { status: 400 });
  }
  const scanId = String(body.scanId || "").trim();
  if (!scanId) return Response.json({ ok: false, error: "scanId requerido" }, { status: 400 });
  try {
    const [scan] = await supabaseRequest("scans", {
      query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(config.ownerId)}&select=id,settings&limit=1`,
    });
    if (!scan) return Response.json({ ok: false, error: "Scan no encontrado" }, { status: 404 });
    const settings = scan.settings || {};
    const progress = settings.progress || {};
    if (isTerminalScanStatus(progress.status)) {
      return Response.json({ ok: false, error: `El scan ya terminó (${progress.status})`, status: progress.status }, { status: 409 });
    }
    await supabaseRequest("scans", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      prefer: "return=minimal",
      body: {
        settings: {
          ...settings,
          progress: { ...progress, cancelRequested: true, cancelRequestedAt: new Date().toISOString() },
        },
        updated_at: new Date().toISOString(),
      },
    });
    return Response.json({ ok: true, scanId, status: progress.status || "running", cancelRequested: true });
  } catch (error) {
    return Response.json({ ok: false, configured: true, error: error.message }, { status: 500 });
  }
}
