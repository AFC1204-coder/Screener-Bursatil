import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  appAccessToken,
  authOpenForLocalDev,
  createStatsEdgeSession,
  isStatsEdgeSessionValid,
  matchesStatsEdgeAccessToken,
} from "@/lib/authSession";

function sessionStatus(request) {
  const configured = Boolean(appAccessToken());
  const authenticated = isStatsEdgeSessionValid(request.cookies.get(SESSION_COOKIE)?.value) || authOpenForLocalDev();
  return {
    ok: true,
    configured,
    authenticated,
    requiresToken: configured && !authenticated,
    productionLocked: !configured && process.env.NODE_ENV === "production",
  };
}

function setSessionCookie(response) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createStatsEdgeSession(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export async function GET(request) {
  return NextResponse.json(sessionStatus(request));
}

export async function POST(request) {
  if (!appAccessToken()) {
    return NextResponse.json(
      { ok: false, error: "STATSEDGE_ACCESS_TOKEN no configurado" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  if (!matchesStatsEdgeAccessToken(body.token)) {
    return NextResponse.json({ ok: false, error: "Token no autorizado" }, { status: 401 });
  }

  try {
    return setSessionCookie(NextResponse.json({ ok: true, authenticated: true }));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || "Configuración de sesión ausente" }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true, authenticated: false });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
