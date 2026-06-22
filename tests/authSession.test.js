import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authOpenForLocalDev,
  createStatsEdgeSession,
  isStatsEdgeSessionValid,
  matchesStatsEdgeAccessToken,
} from "@/lib/authSession";

const ENV_KEYS = ["STATSEDGE_ACCESS_TOKEN", "STATSEDGE_SESSION_SECRET", "NODE_ENV"];

let previousEnv = {};

describe("auth session", () => {
  beforeEach(() => {
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  it("creates and validates a signed session without exposing the app token", () => {
    process.env.STATSEDGE_ACCESS_TOKEN = "app-token";
    process.env.STATSEDGE_SESSION_SECRET = "session-secret";

    const session = createStatsEdgeSession(1_000);

    expect(session).not.toContain("app-token");
    expect(isStatsEdgeSessionValid(session, 2_000)).toBe(true);
    expect(isStatsEdgeSessionValid(`${session}x`, 2_000)).toBe(false);
  });

  it("requires an independent session secret in production", () => {
    process.env.NODE_ENV = "production";
    process.env.STATSEDGE_ACCESS_TOKEN = "app-token";

    expect(() => createStatsEdgeSession(1_000)).toThrow(/STATSEDGE_SESSION_SECRET/);
    process.env.STATSEDGE_SESSION_SECRET = "session-secret";
    expect(isStatsEdgeSessionValid(createStatsEdgeSession(1_000), 2_000)).toBe(true);
  });

  it("matches the server app token and keeps local dev open only outside production", () => {
    process.env.STATSEDGE_ACCESS_TOKEN = "app-token";
    expect(matchesStatsEdgeAccessToken("app-token")).toBe(true);
    expect(matchesStatsEdgeAccessToken("wrong")).toBe(false);

    delete process.env.STATSEDGE_ACCESS_TOKEN;
    expect(authOpenForLocalDev()).toBe(true);

    process.env.NODE_ENV = "production";
    expect(authOpenForLocalDev()).toBe(false);
  });
});
