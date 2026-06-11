// POST /api/scan/continue — ejecuta el siguiente eslabón de un scan encadenado.
// Dos vías de entrada:
//  1) Cadena normal: el eslabón anterior pasa { scanId, linkToken } y el token debe
//     coincidir con settings.progress.nextLinkToken (uso único, CAS al reclamar).
//  2) Retoma de eslabón muerto: sin token válido, solo si el scan sigue "running"
//     y su updated_at (heartbeat, se refresca cada ~1.5s) tiene más de 10 minutos.
// Responde 202 y procesa el chunk en after(), así el fetch interno del eslabón
// anterior retorna enseguida y las lambdas no encadenan sus tiempos de vida.
import { after } from "next/server";
import { isTerminalScanStatus } from "@/lib/scanStatus";
import { DEAD_LINK_MS, runScanChunk } from "@/lib/serverScanRunner";
import { disabledPayload, requirePersistenceAuth, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const linkToken = String(body.linkToken || "").trim();
  try {
    const [scan] = await supabaseRequest("scans", {
      query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(config.ownerId)}&select=id,settings,row_count,updated_at&limit=1`,
    });
    if (!scan) return Response.json({ ok: false, error: "Scan no encontrado" }, { status: 404 });
    const settings = scan.settings || {};
    const progress = settings.progress || {};
    if (isTerminalScanStatus(progress.status)) {
      return Response.json({ ok: false, error: `El scan ya terminó (${progress.status})`, status: progress.status }, { status: 409 });
    }
    const heartbeatAgeMs = Date.now() - Date.parse(scan.updated_at || 0);
    const isChain = Boolean(linkToken && progress.nextLinkToken && linkToken === progress.nextLinkToken);
    const isDeadLinkRetake = !isChain && (!Number.isFinite(heartbeatAgeMs) || heartbeatAgeMs > DEAD_LINK_MS);
    if (!isChain && !isDeadLinkRetake) {
      return Response.json({
        ok: false,
        error: "Eslabón activo: heartbeat reciente y sin linkToken válido",
        heartbeatAgeMs: Math.round(heartbeatAgeMs),
      }, { status: 409 });
    }
    // Reclamar el eslabón. En la cadena normal el CAS sobre nextLinkToken garantiza
    // un único consumidor del token; en la retoma el riesgo de carrera es mínimo
    // (heartbeat muerto hace >10 min).
    const claimQuery = isChain
      ? `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(config.ownerId)}&settings->progress->>nextLinkToken=eq.${encodeURIComponent(linkToken)}`
      : `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(config.ownerId)}`;
    const claimed = await supabaseRequest("scans", {
      method: "PATCH",
      query: claimQuery,
      prefer: "return=representation",
      body: {
        settings: {
          ...settings,
          progress: { ...progress, nextLinkToken: null, linkClaimedAt: new Date().toISOString() },
        },
        updated_at: new Date().toISOString(),
      },
    });
    if (!Array.isArray(claimed) || !claimed.length) {
      return Response.json({ ok: false, error: "Otro eslabón reclamó este scan" }, { status: 409 });
    }
    const baseUrl = new URL(req.url).origin;
    after(() => runScanChunk({ scanId, ownerId: config.ownerId, baseUrl }));
    return Response.json({
      ok: true,
      scanId,
      cursor: Number(progress.cursor || 0),
      total: Number(progress.total || 0),
      resumedDeadLink: isDeadLinkRetake,
    }, { status: 202 });
  } catch (error) {
    return Response.json({ ok: false, configured: true, error: error.message }, { status: 500 });
  }
}
