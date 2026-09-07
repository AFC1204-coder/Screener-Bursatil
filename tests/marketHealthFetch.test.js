// tests/marketHealthFetch.test.js — contrato soft-fail de timeouts en salud de
// mercado (MH-SOFT-1): un AbortError no debe duplicar console.error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FETCH_TIMEOUT_CODE,
  fetchJsonWithTimeout,
  isTimeoutFetchError,
  logMarketHealthFetchFailure,
  timeoutFetchError,
} from "@/lib/marketHealthFetch";

vi.mock("@/lib/clientApi", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "@/lib/clientApi";

describe("marketHealthFetch — timeout soft-fail", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("timeoutFetchError expone mensaje presentable y código FETCH_TIMEOUT", () => {
    const error = timeoutFetchError(8000);
    expect(error.message).toMatch(/más de 8 s/);
    expect(error.code).toBe(FETCH_TIMEOUT_CODE);
    expect(isTimeoutFetchError(error)).toBe(true);
  });

  it("isTimeoutFetchError reconoce AbortError y mensaje de timeout legado", () => {
    expect(isTimeoutFetchError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isTimeoutFetchError(new Error("El servidor de datos tardó demasiado en responder (más de 8 s)."))).toBe(true);
    expect(isTimeoutFetchError(new Error("HTTP 503"))).toBe(false);
  });

  it("fetchJsonWithTimeout traduce AbortError sin console.error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getJson).mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));

    await expect(fetchJsonWithTimeout("/api/market-news", 8000)).rejects.toMatchObject({
      code: FETCH_TIMEOUT_CODE,
      message: expect.stringMatching(/más de 8 s/),
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fetchJsonWithTimeout deja pasar otros errores sin tocarlos", async () => {
    const serverError = new Error("HTTP 503");
    vi.mocked(getJson).mockRejectedValue(serverError);

    await expect(fetchJsonWithTimeout("/api/market-health", 25000)).rejects.toBe(serverError);
  });

  it("logMarketHealthFetchFailure no registra timeouts (evita spam del overlay)", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    logMarketHealthFetchFailure("titulares no disponibles", timeoutFetchError(8000));
    expect(consoleError).not.toHaveBeenCalled();

    const other = new Error("HTTP 503");
    logMarketHealthFetchFailure("titulares no disponibles", other);
    expect(consoleError).toHaveBeenCalledWith("[salud de mercado] titulares no disponibles:", other);

    consoleError.mockRestore();
  });
});
