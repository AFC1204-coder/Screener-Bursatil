import { beforeEach, describe, expect, it } from "vitest";
import {
  _forTest,
  getProviderRuntimeStatus,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/providerRuntimeStatus";

const { normalizeCount, resetProviderRuntime } = _forTest;

describe("providerRuntimeStatus count normalization", () => {
  beforeEach(() => {
    resetProviderRuntime();
  });

  describe("normalizeCount", () => {
    it("devuelve null para null y undefined", () => {
      expect(normalizeCount(null)).toBeNull();
      expect(normalizeCount(undefined)).toBeNull();
    });

    it("conserva 0 real", () => {
      expect(normalizeCount(0)).toBe(0);
    });

    it("acepta enteros positivos finitos", () => {
      expect(normalizeCount(42)).toBe(42);
    });

    it("devuelve null para valores no numéricos", () => {
      expect(normalizeCount("n/a")).toBeNull();
      expect(normalizeCount(Number.NaN)).toBeNull();
    });
  });

  describe("recordProviderSuccess", () => {
    it("count omitido → null (no 0)", () => {
      const status = recordProviderSuccess("US");
      expect(status?.count).toBeNull();
      expect(getProviderRuntimeStatus("US")?.count).toBeNull();
    });

    it("count null explícito → null", () => {
      const status = recordProviderSuccess("US", { count: null });
      expect(status?.count).toBeNull();
    });

    it("count 0 real → 0", () => {
      const status = recordProviderSuccess("US", { count: 0 });
      expect(status?.count).toBe(0);
      expect(getProviderRuntimeStatus("US")?.count).toBe(0);
    });

    it("count positivo se conserva", () => {
      const status = recordProviderSuccess("HK", { count: 128 });
      expect(status?.count).toBe(128);
    });
  });

  describe("recordProviderFailure", () => {
    it("count omitido → null (no 0)", () => {
      const status = recordProviderFailure("US", "provider unavailable");
      expect(status?.count).toBeNull();
      expect(getProviderRuntimeStatus("US")?.count).toBeNull();
    });

    it("count null explícito → null", () => {
      const status = recordProviderFailure("US", "provider unavailable", { count: null });
      expect(status?.count).toBeNull();
    });

    it("count 0 real → 0", () => {
      const status = recordProviderFailure("US", "partial rows", { count: 0 });
      expect(status?.count).toBe(0);
    });
  });
});
