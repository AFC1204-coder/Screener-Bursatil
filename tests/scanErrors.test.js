// Tests de lib/scanErrors.js — clasificación tipada de errores para el scan runner.
// Contrato introducido tras el audit 2026-07-10 §"Terminal done can mean zero
// successful scan rows". El runner clasifica errores por clase (retryable|terminal|unknown)
// para alimentar el ratio de completitud (lib/scanStatus.js#computeTerminalCompleteness).
import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/scanErrors";

function e(message, status) {
  if (status === undefined) {
    return Object.assign(new Error(message), {});
  }
  const err = new Error(message);
  err.status = status;
  return err;
}

describe("classifyProviderError", () => {
  describe("errores retryable (transitorios)", () => {
    it("HTTP 408/425/429/500/502/503/504 sobre message regex", () => {
      expect(classifyProviderError(e("Yahoo chart HTTP 408")).kind).toBe("retryable");
      expect(classifyProviderError(e("Yahoo chart HTTP 425")).kind).toBe("retryable");
      expect(classifyProviderError(e("Yahoo chart HTTP 429")).kind).toBe("retryable");
      expect(classifyProviderError(e("Yahoo chart HTTP 500")).kind).toBe("retryable");
      expect(classifyProviderError(e("Yahoo chart HTTP 502")).kind).toBe("retryable");
      expect(classifyProviderError(e("Yahoo chart HTTP 503")).kind).toBe("retryable");
      expect(classifyProviderError(e("Yahoo chart HTTP 504")).kind).toBe("retryable");
    });

    it("Cloudflare 521/522/523/524 son retryable", () => {
      expect(classifyProviderError(e("Yahoo chart HTTP 521")).kind).toBe("retryable");
      expect(classifyProviderError(e("Yahoo chart HTTP 524")).kind).toBe("retryable");
    });

    it("timeouts explícitos en message son retryable", () => {
      expect(classifyProviderError(e("Yahoo fetch timed out")).kind).toBe("retryable");
      expect(classifyProviderError(e("ETIMEDOUT upstream")).kind).toBe("retryable");
      expect(classifyProviderError(e("ECONNRESET peer closed")).kind).toBe("retryable");
      expect(classifyProviderError(e("fetch failed connecting to api")).kind).toBe("retryable");
      expect(classifyProviderError(e("getaddrinfo EAI_AGAIN")).kind).toBe("retryable");
    });

    it(".status numérico en el error (Supabase path) marca retryable", () => {
      expect(classifyProviderError(e("svc timeout", 500)).kind).toBe("retryable");
      expect(classifyProviderError(e("rate limit", 429)).kind).toBe("retryable");
    });
  });

  describe("errores terminal (permanentes — reintentar no ayuda)", () => {
    it("HTTP 400/401/403/404/410 son terminal", () => {
      expect(classifyProviderError(e("Yahoo chart HTTP 400")).kind).toBe("terminal");
      expect(classifyProviderError(e("Yahoo chart HTTP 401")).kind).toBe("terminal");
      expect(classifyProviderError(e("Yahoo chart HTTP 403")).kind).toBe("terminal");
      expect(classifyProviderError(e("Yahoo chart HTTP 404")).kind).toBe("terminal");
      expect(classifyProviderError(e("Yahoo chart HTTP 410")).kind).toBe("terminal");
    });

    it("respuestas sin datos válidas son terminal", () => {
      expect(classifyProviderError(e("Sin resultado Yahoo")).kind).toBe("terminal");
      expect(classifyProviderError(e("Yahoo profile sin resultado")).kind).toBe("terminal");
      expect(classifyProviderError(e("Stooq sin historico")).kind).toBe("terminal");
      expect(classifyProviderError(e("Symbol not found")).kind).toBe("terminal");
    });

    it("errores de parseo (JSON/SyntaxError) son terminal", () => {
      expect(classifyProviderError(e("JSON.parse failed at offset 42")).kind).toBe("terminal");
      expect(classifyProviderError(e("SyntaxError: unexpected token")).kind).toBe("terminal");
    });

    it(".status numérico 401/403/404 son terminal", () => {
      expect(classifyProviderError(e("auth", 401)).kind).toBe("terminal");
      expect(classifyProviderError(e("forbidden", 403)).kind).toBe("terminal");
      expect(classifyProviderError(e("missing", 404)).kind).toBe("terminal");
    });
  });

  describe("errores unknown / fallback conservador", () => {
    it("sin message y sin status → unknown", () => {
      expect(classifyProviderError({}).kind).toBe("unknown");
      expect(classifyProviderError(null).kind).toBe("unknown");
      expect(classifyProviderError(undefined).kind).toBe("unknown");
    });

    it("message no clasificable → unknown (contado como terminal en ratio)", () => {
      const out = classifyProviderError(e("Algo completamente inesperado pasó"));
      expect(out.kind).toBe("unknown");
      // Conservador: el runner lo sumará al ratio como fila fallida.
      expect(out.reason.length).toBeGreaterThan(0);
    });
  });

  describe("shape del retorno", () => {
    it("devuelve { kind, status, reason }", () => {
      const result = classifyProviderError(e("Yahoo chart HTTP 404"));
      expect(result).toEqual(expect.objectContaining({
        kind: "terminal",
        status: 404,
        reason: expect.any(String),
      }));
    });

    it("reason se trunca a 240 chars como máximo", () => {
      const longMessage = `Largo: ${"x".repeat(500)}`;
      const result = classifyProviderError(e(longMessage));
      expect(result.reason.length).toBeLessThanOrEqual(241);
    });

    it("status: null cuando no se puede inferir", () => {
      const result = classifyProviderError(e("Sin código"));
      expect(result.status).toBeNull();
    });

    it("message vacío produce reason por defecto no-vacío", () => {
      const result = classifyProviderError(e(""));
      expect(result.reason).toBe("Proveedor no disponible");
    });
  });
});
