// lib/marketHealthFetch.js — fetch con timeout para /market-health sin spam al
// overlay de Next (MH-SOFT-1).
//
// AbortError esperado → error presentable, sin console.error aquí ni en el
// caller. La UI ya degrada con userFacingServiceError; duplicar console.error
// en helper + caller contaba N Issues en el Dev Overlay.

import { getJson } from "@/lib/clientApi";

export const FETCH_TIMEOUT_CODE = "FETCH_TIMEOUT";

export function isTimeoutFetchError(error) {
  if (!error) return false;
  if (error.code === FETCH_TIMEOUT_CODE) return true;
  if (error.name === "AbortError") return true;
  return /\btardó demasiado en responder\b/i.test(String(error.message || ""));
}

export function timeoutFetchError(timeoutMs) {
  const seconds = Math.round(timeoutMs / 1000);
  const error = new Error(`El servidor de datos tardó demasiado en responder (más de ${seconds} s).`);
  error.code = FETCH_TIMEOUT_CODE;
  return error;
}

/** Contrato del API: Actualizar debe pedir refresh explícito. */
export function marketHealthApiPath({ refresh = false } = {}) {
  return refresh ? "/api/market-health?refresh=1" : "/api/market-health";
}

export async function fetchJsonWithTimeout(path, timeoutMs = 12000) {
  try {
    return await getJson(path, { timeoutMs, cache: "no-store" });
  } catch (error) {
    if (error?.name === "AbortError") throw timeoutFetchError(timeoutMs);
    throw error;
  }
}

/** Un solo registro para fallos inesperados; los timeouts son soft-fail silenciosos. */
export function logMarketHealthFetchFailure(scope, error) {
  if (isTimeoutFetchError(error)) return;
  console.error(`[salud de mercado] ${scope}:`, error);
}
