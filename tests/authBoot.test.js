import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_HINT_KEY,
  clearAuthSessionHint,
  hasPlausibleAuthSession,
  initialAuthGateStatus,
  isAuthGateOpen,
  normalizeAuthSessionStatus,
  persistAuthSessionHint,
  shouldRenderAuthChildren,
} from "@/lib/authBoot";
import { STORAGE_KEYS } from "@/lib/localState";

function installFakeStorage() {
  const store = new Map();
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
}

describe("authBoot", () => {
  beforeEach(() => {
    installFakeStorage();
    localStorage.clear();
  });

  afterEach(() => {
    delete globalThis.localStorage;
    if (globalThis.window === globalThis) delete globalThis.window;
  });

  it("normalizes session status from the API contract", () => {
    expect(normalizeAuthSessionStatus({
      authenticated: true,
      requiresToken: false,
      productionLocked: false,
    })).toEqual({
      loading: false,
      verifying: false,
      authenticated: true,
      requiresToken: false,
      productionLocked: false,
    });
  });

  it("opens the gate for local dev without token", () => {
    expect(isAuthGateOpen({
      authenticated: false,
      requiresToken: false,
      productionLocked: false,
    })).toBe(true);
  });

  it("detects a plausible session from the persisted hint", () => {
    persistAuthSessionHint();
    expect(hasPlausibleAuthSession()).toBe(true);
    clearAuthSessionHint();
    expect(hasPlausibleAuthSession()).toBe(false);
  });

  it("detects a plausible session from local screener data", () => {
    localStorage.setItem(STORAGE_KEYS.screenerSession, JSON.stringify({ version: 1 }));
    expect(hasPlausibleAuthSession()).toBe(true);
  });

  it("boots optimistically when a plausible session exists", () => {
    persistAuthSessionHint();
    expect(initialAuthGateStatus()).toMatchObject({
      loading: true,
      verifying: true,
      authenticated: true,
    });
  });

  it("renders children while revalidating a plausible session", () => {
    const status = {
      loading: true,
      verifying: true,
      authenticated: true,
      requiresToken: false,
      productionLocked: false,
    };
    expect(shouldRenderAuthChildren(status, true)).toBe(true);
  });

  it("blocks children for first-time visitors until auth resolves", () => {
    const status = {
      loading: true,
      verifying: true,
      authenticated: false,
      requiresToken: false,
      productionLocked: false,
    };
    expect(shouldRenderAuthChildren(status, false)).toBe(false);
  });

  it("blocks children when the server requires a token again", () => {
    const status = normalizeAuthSessionStatus({
      authenticated: false,
      requiresToken: true,
      productionLocked: false,
    });
    expect(shouldRenderAuthChildren(status, true)).toBe(false);
  });

  it("returns false for plausible session checks on the server", () => {
    const windowRef = globalThis.window;
    vi.stubGlobal("window", undefined);
    expect(hasPlausibleAuthSession()).toBe(false);
    vi.stubGlobal("window", windowRef);
  });

  it("persists and clears the auth hint key", () => {
    persistAuthSessionHint();
    expect(localStorage.getItem(AUTH_SESSION_HINT_KEY)).toBe("1");
    clearAuthSessionHint();
    expect(localStorage.getItem(AUTH_SESSION_HINT_KEY)).toBeNull();
  });
});
