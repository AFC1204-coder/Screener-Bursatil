// middleware.js — colocar en la RAÍZ del repo (junto a package.json).
// Cierra el perímetro de /api/* con un token de aplicación.
//
// Env requerida (Vercel + .env.local):
//   STATSEDGE_ACCESS_TOKEN=<cadena larga aleatoria, ej: openssl rand -hex 32>
//   NEXT_PUBLIC_STATSEDGE_ACCESS_TOKEN=<el mismo valor>  (lo usa el cliente, ver lib/clientApi.js)
//
// Nota: NEXT_PUBLIC_ expone el token en el bundle del navegador. Es un cierre de
// perímetro para app personal (evita que terceros usen tu API/proxy Yahoo y tus datos),
// NO un sistema de auth multiusuario. Nunca apliques este patrón a claves de Supabase.

import { NextResponse } from "next/server";

// Endpoints de estado inofensivos que pueden quedar abiertos.
const PUBLIC_API_PATHS = new Set(["/api/supabase/status", "/api/data-providers"]);

function timingSafeEqual(a = "", b = "") {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_API_PATHS.has(pathname)) return NextResponse.next();
  // Los crons de Vercel llegan con "authorization: Bearer CRON_SECRET", sin el token
  // de app: cada route bajo /api/cron valida su propio secreto (CRON_SECRET).
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  const expected = process.env.STATSEDGE_ACCESS_TOKEN || "";
  if (!expected) {
    // Sin token configurado: modo abierto (desarrollo local sin .env).
    // Si prefieres fail-closed, sustituye por el return 401 de abajo.
    return NextResponse.next();
  }

  const provided =
    request.headers.get("x-statsedge-token") ||
    request.cookies.get("statsedge_token")?.value ||
    "";

  if (timingSafeEqual(provided, expected)) return NextResponse.next();

  return NextResponse.json(
    { error: "No autorizado", hint: "Falta o no coincide x-statsedge-token" },
    { status: 401 }
  );
}

export const config = {
  matcher: "/api/:path*",
};
