// lib/nightlyUsScan.js — quién es "el escaneo nocturno estadounidense", en un
// solo sitio y para todas las superficies del servidor.
//
// Por qué existe: pedir "el escaneo más reciente" NO devuelve el nocturno
// estadounidense. El cron de mercados europeos corre a las 22-23h, después del
// nocturno de las 03:57, así que a partir de esa hora el último escaneo de la
// base es otro mercado y otro tamaño. Medido en producción el 16 de agosto de
// 2026:
//
//   materialized:IT-ES:2026-08-16   1 fila      23:00
//   materialized:JP:2026-08-16      24 filas    22:42
//   materialized:US:2026-08-16      3313 filas  03:57
//
// La pantalla principal arrancaba con la primera de esas tres: UNA acción
// italiana en lugar del universo estadounidense. Lo mismo le pasaba a la
// amplitud del universo (lib/marketBreadth.js), que filtraba por preset
// —"materialized-cache", que escriben TODOS los crones— y no por mercado.
//
// El lanzamiento es solo Estados Unidos, así que la fuente es UN escaneo
// concreto: el último nocturno, identificado por el prefijo de local_id que
// escribe scripts/scan-universe.mjs (lib/scanLocalId.js).
//
// Las corridas de PRUEBA quedan fuera por construcción: llevan el prefijo
// "test:" delante, así que no casan con este `like`. Antes sí podían, y el 14
// de agosto de 2026 una corrida --limit=300 se convirtió en la fuente de las
// Listas.
//
// CAVEAT heredado, no resuelto aquí: app/api/jobs/scan-refresh/route.js llama a
// la misma runMaterializedScan y, si alguien lo invoca a mano con ?markets=US,
// produciría un local_id con este mismo prefijo. scripts/scan-universe.mjs ya
// lo documenta en su cabecera y decide no resolverlo con una segunda señal; se
// mantiene ese criterio.
import { disabledPayload, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";
import { nightlyUsLocalIdPattern } from "@/lib/scanLocalId";

export const DEFAULT_NIGHTLY_READ_TIMEOUT_MS = 12000;

// Las columnas mínimas para decidir si el nocturno publica. Quien necesite la
// fila entera (app/api/scans/route.js la convierte en snapshot) pasa las suyas.
export const NIGHTLY_SCAN_COLUMNS = "id,local_id,created_at,settings";

// Mismo contrato terminal que la RPC leaderboard_publishable_rows: un escaneo
// que no terminó en un estado publicable no publica nada.
export const PUBLISHABLE_PARENT_STATUS = ["complete", "partial", "done"];

export function scanProgressStatus(scan = {}) {
  return String(scan?.settings?.progress?.status || "").trim();
}

function statusOf(scan = {}) {
  return scanProgressStatus(scan);
}

/**
 * El último escaneo nocturno estadounidense publicable, o la ausencia con su
 * motivo. Nunca devuelve "el siguiente que valga": si el nocturno de esta noche
 * falló, lo honesto es decirlo, no servir el de anteayer —ni el de otro
 * mercado— como si fuera el de hoy.
 */
export async function readNightlyUsScan({ timeoutMs = DEFAULT_NIGHTLY_READ_TIMEOUT_MS, columns = NIGHTLY_SCAN_COLUMNS } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, ...disabledPayload(), scan: null, row: null, reason: "supabase-disabled" };
  const scans = await supabaseRequest("scans", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `local_id=like.${encodeURIComponent(nightlyUsLocalIdPattern())}`,
      // Un escaneo borrado (tombstone de research-desk) no puede seguir siendo
      // la fuente de ninguna pantalla.
      "deleted_at=is.null",
      `select=${columns}`,
      "order=created_at.desc",
      "limit=1",
    ].join("&"),
    timeoutMs,
  });
  const row = Array.isArray(scans) ? scans[0] : null;
  if (!row) return { configured: true, scan: null, row: null, reason: "no-nightly-scan" };
  const status = statusOf(row);
  if (!PUBLISHABLE_PARENT_STATUS.includes(status)) {
    return {
      configured: true,
      scan: null,
      row: null,
      reason: "nightly-not-publishable",
      rejectedScan: { id: row.id, localId: row.local_id, createdAt: row.created_at, status },
    };
  }
  return {
    configured: true,
    scan: { id: row.id, localId: row.local_id, createdAt: row.created_at, status },
    row,
  };
}
