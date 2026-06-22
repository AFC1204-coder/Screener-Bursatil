import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInternalRequest, requireInternalAuth } from "@/lib/internalAuth";

const TOKEN_ENV_KEYS = [
  "STATSEDGE_ACCESS_TOKEN",
  "STATSEDGE_API_TOKEN",
  "STATSEDGE_ADMIN_TOKEN",
  "CRON_SECRET",
  "NODE_ENV",
];

let previousEnv = {};

function request(headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    headers: {
      get(key) {
        return normalized[String(key).toLowerCase()] || "";
      },
    },
  };
}

describe("internal auth", () => {
  beforeEach(() => {
    previousEnv = Object.fromEntries(TOKEN_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of TOKEN_ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    for (const key of TOKEN_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  it("accepts app and persistence tokens through shared headers", () => {
    process.env.STATSEDGE_ACCESS_TOKEN = "app-token";
    expect(isInternalRequest(request({ "x-statsedge-token": "app-token" }))).toBe(true);

    process.env.STATSEDGE_ACCESS_TOKEN = "";
    process.env.STATSEDGE_API_TOKEN = "api-token";
    expect(isInternalRequest(request({ authorization: "Bearer api-token" }))).toBe(true);
  });

  it("does not fail open when only CRON_SECRET is configured and the cron token is wrong", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(isInternalRequest(request({ authorization: "Bearer wrong" }), { allowCron: true })).toBe(false);
    expect(requireInternalAuth(request({ authorization: "Bearer wrong" }), { allowCron: true })?.status).toBe(401);
  });

  it("does not fail open on cron-capable routes when an app token is configured", () => {
    process.env.STATSEDGE_ACCESS_TOKEN = "app-token";

    expect(isInternalRequest(request(), { allowCron: true })).toBe(false);
    expect(requireInternalAuth(request(), { allowCron: true })?.status).toBe(401);
  });

  it("keeps local cron-capable routes open only when no tokens are configured", () => {
    expect(isInternalRequest(request(), { allowCron: true })).toBe(true);
    expect(requireInternalAuth(request(), { allowCron: true })).toBeNull();
  });

  it("fails closed in production when no tokens are configured", () => {
    process.env.NODE_ENV = "production";

    expect(isInternalRequest(request())).toBe(false);
    expect(isInternalRequest(request(), { allowCron: true })).toBe(false);
    expect(requireInternalAuth(request())?.status).toBe(401);
  });

  it("does not let CRON_SECRET open non-cron persistence routes", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(isInternalRequest(request({ authorization: "Bearer cron-secret" }))).toBe(false);
    expect(requireInternalAuth(request({ authorization: "Bearer cron-secret" }))?.status).toBe(401);
  });
});
