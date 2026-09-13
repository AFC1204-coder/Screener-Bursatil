import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, isStatsEdgeSessionValid } from "@/lib/authSession";
import { GET, POST } from "@/app/api/auth/session/route";

const ENV_KEYS = ["STATSEDGE_ACCESS_TOKEN", "STATSEDGE_SESSION_SECRET", "NODE_ENV"];

let previousEnv = {};

function sessionRequest(method, body, host = "localhost:3000") {
  return new NextRequest("http://localhost:3000/api/auth/session", {
    method,
    headers: {
      "Content-Type": "application/json",
      host,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/auth/session", () => {
  beforeEach(() => {
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = "test";
    process.env.STATSEDGE_ACCESS_TOKEN = "app-token";
    process.env.STATSEDGE_SESSION_SECRET = "session-secret";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  it("GET reports localUnlockAvailable when unauthenticated in non-production", async () => {
    const response = await GET(sessionRequest("GET"));
    const data = await response.json();

    expect(data).toMatchObject({
      ok: true,
      configured: true,
      authenticated: false,
      requiresToken: true,
      localUnlockAvailable: true,
    });
  });

  it("POST localUnlock emits a valid session cookie in non-production", async () => {
    const response = await POST(sessionRequest("POST", { localUnlock: true }));
    const data = await response.json();
    const cookie = response.cookies.get(SESSION_COOKIE)?.value;

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ ok: true, authenticated: true });
    expect(isStatsEdgeSessionValid(cookie, Date.now() + 1000)).toBe(true);
  });

  it("POST localUnlock rejects production", async () => {
    process.env.NODE_ENV = "production";

    const response = await POST(sessionRequest("POST", { localUnlock: true }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toMatch(/no disponible/i);
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
  });

  it("POST localUnlock rejects non-local hosts", async () => {
    const response = await POST(sessionRequest("POST", { localUnlock: true }, "statsedge.vercel.app"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toMatch(/no disponible/i);
  });

  it("POST token login still works alongside localUnlock", async () => {
    const response = await POST(sessionRequest("POST", { token: "app-token" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ ok: true, authenticated: true });
    expect(isStatsEdgeSessionValid(response.cookies.get(SESSION_COOKIE)?.value, Date.now() + 1000)).toBe(true);
  });
});
