// POST /api/scan — lanza un escaneo en servidor por eslabones encadenados: crea la
// fila en `scans` con settings.scanSymbols (lista completa) y settings.progress
// { status: "running", cursor: 0, chunkSize }, y ejecuta el primer eslabón en
// after(). Cada eslabón procesa ≤ chunkSize símbolos (300 por defecto) y se
// re-encadena vía POST /api/scan/continue; ver lib/serverScanRunner.js.
// GET /api/scan?id=&offset= — estado + resultados incrementales; el cliente es
// agnóstico a cuántos eslabones hubo.
import { after } from "next/server";
import { clearScansApiCache } from "@/lib/scansApiCache";
import { isPublicScanStatus } from "@/lib/scanStatus";
import { clampChunkSize, normalizeSymbols, runScanChunk } from "@/lib/serverScanRunner";
import { disabledPayload, requirePersistenceAuth, supabaseConfig, supabaseRequest, textOrNull } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const INLINE_SCAN_SYMBOL_LIMIT = 20;

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
  const symbols = normalizeSymbols(body.symbols);
  if (!symbols.length) return Response.json({ ok: false, error: "symbols requerido (array no vacío)" }, { status: 400 });
  const settings = body.settings && typeof body.settings === "object" ? body.settings : {};
  const chunkSize = clampChunkSize(body.chunkSize);
  try {
    const [saved] = await supabaseRequest("scans", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        owner_id: config.ownerId,
        local_id: `server-scan-${crypto.randomUUID()}`,
        name: textOrNull(body.name) || `Scan servidor ${new Date().toISOString()}`,
        preset: textOrNull(body.preset),
        settings: {
          ...settings,
          rowsAreFilteredSnapshot: false,
          scanSymbols: symbols,
          progress: {
            status: "running",
            cursor: 0,
            chunkSize,
            link: 0,
            completed: 0,
            total: symbols.length,
            saved: 0,
            currentSymbol: "",
            errors: [],
            startedAt: new Date().toISOString(),
          },
        },
        market_regime: "server-scan",
        row_count: 0,
      }],
    });
    if (!saved?.id) throw new Error("No se pudo crear la fila del scan");
    clearScansApiCache();
    const baseUrl = new URL(req.url).origin;
    const runFirstChunk = () => runScanChunk({ scanId: saved.id, ownerId: config.ownerId, baseUrl });
    if (symbols.length <= INLINE_SCAN_SYMBOL_LIMIT) {
      await runFirstChunk();
    } else {
      after(runFirstChunk);
    }
    return Response.json({ ok: true, configured: true, scanId: saved.id, localId: saved.local_id, total: symbols.length, chunkSize }, { status: 202 });
  } catch (error) {
    return Response.json({ ok: false, configured: true, error: error.message }, { status: 500 });
  }
}

export async function GET(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload(), { status: 503 });
  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") || "").trim();
  if (!id) return Response.json({ ok: false, error: "id requerido" }, { status: 400 });
  const offset = Math.max(0, Number(searchParams.get("offset") || 0) || 0);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 200), 1), 500);
  const includeRows = searchParams.get("includeRows") !== "0";
  try {
    const [scan] = await supabaseRequest("scans", {
      query: `id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(config.ownerId)}&select=id,local_id,name,preset,settings,row_count,created_at,updated_at&limit=1`,
    });
    if (!scan) return Response.json({ ok: false, error: "Scan no encontrado" }, { status: 404 });
    const progress = scan.settings?.progress || { status: "unknown" };
    let rows = [];
    let nextOffset = offset;
    if (includeRows) {
      const results = await supabaseRequest("scan_results", {
        query: `scan_id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(config.ownerId)}&rank_index=gt.${offset}&select=rank_index,raw&order=rank_index.asc&limit=${limit}`,
      });
      rows = results.map((item) => item.raw).filter(Boolean);
      nextOffset = results.length ? results.at(-1).rank_index : offset;
    }
    return Response.json({
      ok: true,
      configured: true,
      scan: {
        id: scan.id,
        localId: scan.local_id,
        name: scan.name,
        preset: scan.preset,
        rowCount: Number(scan.row_count || 0),
        createdAt: scan.created_at,
        updatedAt: scan.updated_at,
      },
      status: progress.status || "running",
      degraded: progress.status === "partial",
      publishable: isPublicScanStatus(progress.status),
      progress,
      rows,
      nextOffset,
    });
  } catch (error) {
    return Response.json({ ok: false, configured: true, error: error.message }, { status: 500 });
  }
}
