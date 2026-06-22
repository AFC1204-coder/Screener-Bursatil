// proxy.js — colocar en la RAÍZ del repo (junto a package.json).
// Cierra el perímetro de /api/* con token servidor-servidor o sesión HttpOnly.
//
// Env requerida (Vercel + .env.local):
//   STATSEDGE_ACCESS_TOKEN=<cadena larga aleatoria, ej: openssl rand -hex 32>
//   STATSEDGE_SESSION_SECRET=<cadena larga aleatoria independiente en producción>

import { NextResponse } from "next/server";
import { SESSION_COOKIE, isStatsEdgeSessionValid } from "./lib/authSession";

// Endpoints de estado inofensivos que pueden quedar abiertos.
const PUBLIC_API_PATHS = new Set(["/api/auth/session", "/api/supabase/status", "/api/data-providers"]);

function timingSafeEqual(a = "", b = "") {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_API_PATHS.has(pathname)) return NextResponse.next();
  // Los crons de Vercel llegan con "authorization: Bearer CRON_SECRET", sin el token
  // de app: cada route bajo /api/cron valida su propio secreto (CRON_SECRET).
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  const expected = process.env.STATSEDGE_ACCESS_TOKEN || "";
  if (!expected) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return NextResponse.json({ error: "Configuración de auth ausente" }, { status: 401 });
  }

  const provided = request.headers.get("x-statsedge-token") || "";
  const session = request.cookies.get(SESSION_COOKIE)?.value || "";

  if (timingSafeEqual(provided, expected)) return NextResponse.next();
  if (isStatsEdgeSessionValid(session)) return NextResponse.next();

  return NextResponse.json(
    { error: "No autorizado", hint: "Falta una sesión válida de StatsEdge" },
    { status: 401 }
  );
}

export const config = {
  matcher: "/api/:path*",
};
