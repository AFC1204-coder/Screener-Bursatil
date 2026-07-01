// lib/internalAuth.js — autenticación interna unificada para rutas /api.
// Único punto de verdad para los tres tokens de la app:
//
//   1. Token de app (perímetro, proxy.js): STATSEDGE_ACCESS_TOKEN
//      → header x-statsedge-token (o Authorization Bearer).
//   2. Token de persistencia (legacy): STATSEDGE_API_TOKEN / STATSEDGE_ADMIN_TOKEN
//      → header x-statsedge-token o Authorization Bearer.
//   3. Secreto de cron (solo rutas con allowCron): CRON_SECRET
//      → Authorization Bearer (formato de Vercel Cron) o x-cron-secret.
//
// Política:
//   - Sin NINGÚN token configurado → abierto solo fuera de producción.
//   - Rutas cron/jobs en desarrollo sin NINGÚN token configurado -> abiertas.
//   - En producción, ausencia de token => cerrado.
//   - Una cookie de sesión de navegador válida autoriza rutas normales, pero
//     NUNCA las cron/jobs (allowCron): estas solo aceptan token de app/API o
//     CRON_SECRET.
// Respuesta 401 uniforme en toda la superficie interna.
import { envValue } from "@/lib/env";
import { SESSION_COOKIE, isStatsEdgeSessionValid } from "@/lib/authSession";

function timingSafeEqual(a = "", b = "") {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearerOf(request) {
  const match = String(request?.headers?.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function isInternalRequest(request, { allowCron = false, allowSession = !allowCron } = {}) {
  const headerToken = request?.headers?.get("x-statsedge-token") || "";
  const bearer = bearerOf(request);
  const appToken = envValue("STATSEDGE_ACCESS_TOKEN");
  const cronSecret = envValue("CRON_SECRET");
  if (appToken && (timingSafeEqual(headerToken, appToken) || timingSafeEqual(bearer, appToken))) return true;
  const apiToken = envValue("STATSEDGE_API_TOKEN") || envValue("STATSEDGE_ADMIN_TOKEN");
  if (apiToken && (timingSafeEqual(headerToken, apiToken) || timingSafeEqual(bearer, apiToken))) return true;
  if (allowCron) {
    if (cronSecret && (timingSafeEqual(bearer, cronSecret) || timingSafeEqual(request?.headers?.get("x-cron-secret") || "", cronSecret))) return true;
    if (!cronSecret && !appToken && !apiToken && process.env.NODE_ENV !== "production") return true;
  }
  // Sesión HttpOnly firmada (perímetro por cookie). La route reutiliza la misma
  // validación que proxy.js para que una petición del navegador autenticado no
  // necesite además un token de app en el header.
  // IMPORTANTE: una cookie de navegador nunca autoriza rutas cron/jobs (allowCron).
  // Esas rutas solo aceptan token de app/API o CRON_SECRET.
  if (allowSession) {
    const sessionCookie = request?.cookies?.get?.(SESSION_COOKIE)?.value || "";
    if (sessionCookie && isStatsEdgeSessionValid(sessionCookie)) return true;
  }
  // Nada configurado: modo abierto solo para desarrollo local sin .env.
  return !appToken && !apiToken && !cronSecret && process.env.NODE_ENV !== "production";
}

// null si la petición está autorizada; Response 401 uniforme si no.
export function requireInternalAuth(request, options = {}) {
  if (isInternalRequest(request, options)) return null;
  return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
}

// Headers para fetches internos servidor→servidor (p. ej. la cadena de /api/scan/continue):
// usa el token de app si existe (lo exige proxy.js) y cae al de persistencia.
export function internalFetchHeaders(extra = {}) {
  const token = envValue("STATSEDGE_ACCESS_TOKEN") || envValue("STATSEDGE_API_TOKEN") || envValue("STATSEDGE_ADMIN_TOKEN");
  return {
    "Content-Type": "application/json",
    ...(token ? { "x-statsedge-token": token } : {}),
    ...extra,
  };
}
