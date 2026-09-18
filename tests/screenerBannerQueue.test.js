// tests/screenerBannerQueue.test.js — cola de prioridad P2 (≤1 hard + ≤1 soft).

import { describe, expect, it } from "vitest";
import {
  BANNER_PRIORITY,
  buildScreenerBannerCandidates,
  classifyBannerSeverity,
  isBannerSlotVisible,
  selectBannerSlots,
} from "@/lib/screenerBannerQueue";

describe("classifyBannerSeverity", () => {
  it("marca err / auth / markets-error como hard", () => {
    expect(classifyBannerSeverity({ id: "err" })).toBe("hard");
    expect(classifyBannerSeverity({ id: "auth-reauth" })).toBe("hard");
    expect(classifyBannerSeverity({ id: "markets-error", tone: "error" })).toBe("hard");
  });

  it("marca info / loading como soft", () => {
    expect(classifyBannerSeverity({ id: "snapshot-info", tone: "info" })).toBe("soft");
    expect(classifyBannerSeverity({ id: "markets-loading", tone: "loading" })).toBe("soft");
    expect(classifyBannerSeverity({ id: "scan-status", tone: "info" })).toBe("soft");
  });

  it("respeta severity explícita", () => {
    expect(classifyBannerSeverity({ id: "lideres-intl", severity: "soft", tone: "warn" })).toBe("soft");
  });
});

describe("selectBannerSlots", () => {
  it("deja como máximo 1 hard + 1 soft y manda el resto a overflow", () => {
    const slots = selectBannerSlots([
      { id: "snapshot-warn", severity: "hard", priority: BANNER_PRIORITY["snapshot-warn"] },
      { id: "markets-misalignment", severity: "hard", priority: BANNER_PRIORITY["markets-misalignment"] },
      { id: "scan-stale-coverage", severity: "hard", priority: BANNER_PRIORITY["scan-stale-coverage"] },
      { id: "snapshot-info", severity: "soft", priority: BANNER_PRIORITY["snapshot-info"] },
      { id: "scan-status", severity: "soft", priority: BANNER_PRIORITY["scan-status"] },
      { id: "lideres-intl", severity: "soft", priority: BANNER_PRIORITY["lideres-intl"] },
    ]);

    expect(slots.hard?.id).toBe("markets-misalignment");
    expect(slots.soft?.id).toBe("lideres-intl");
    expect(slots.overflow.map((item) => item.id)).toEqual([
      "scan-stale-coverage",
      "snapshot-warn",
      "snapshot-info",
      "scan-status",
    ]);
    expect(slots.visibleIds.has("markets-misalignment")).toBe(true);
    expect(slots.visibleIds.has("lideres-intl")).toBe(true);
    expect(slots.visibleIds.has("snapshot-warn")).toBe(false);
    expect(isBannerSlotVisible(slots.visibleIds, "scan-status")).toBe(false);
  });

  it("auth-reauth gana a snapshot-warn y markets-loading queda como soft", () => {
    const slots = selectBannerSlots([
      { id: "auth-reauth", severity: "hard", priority: BANNER_PRIORITY["auth-reauth"] },
      { id: "snapshot-warn", severity: "hard", priority: BANNER_PRIORITY["snapshot-warn"] },
      { id: "markets-loading", severity: "soft", priority: BANNER_PRIORITY["markets-loading"] },
    ]);
    expect(slots.hard?.id).toBe("auth-reauth");
    expect(slots.soft?.id).toBe("markets-loading");
    expect(slots.overflow.map((item) => item.id)).toEqual(["snapshot-warn"]);
  });

  it("markets-loading gana a snapshot-info como soft protagonista", () => {
    const slots = selectBannerSlots([
      { id: "markets-loading", severity: "soft", priority: BANNER_PRIORITY["markets-loading"] },
      { id: "snapshot-info", severity: "soft", priority: BANNER_PRIORITY["snapshot-info"] },
      { id: "scan-status", severity: "soft", priority: BANNER_PRIORITY["scan-status"] },
    ]);
    expect(slots.soft?.id).toBe("markets-loading");
    expect(slots.overflow.map((item) => item.id)).toEqual(["snapshot-info", "scan-status"]);
  });

  it("con un solo soft no inventa hard", () => {
    const slots = selectBannerSlots([
      { id: "snapshot-info", severity: "soft", priority: 50 },
    ]);
    expect(slots.hard).toBeNull();
    expect(slots.soft?.id).toBe("snapshot-info");
    expect(slots.overflow).toEqual([]);
  });

  it("ignora candidatos sin id", () => {
    const slots = selectBannerSlots([null, {}, { id: "scan-status", severity: "soft" }]);
    expect(slots.soft?.id).toBe("scan-status");
    expect(slots.hard).toBeNull();
  });
});

describe("buildScreenerBannerCandidates", () => {
  it("no duplica cobertura stale cuando hay marketsMisalignment", () => {
    const candidates = buildScreenerBannerCandidates({
      marketsMisalignment: { tone: "warn", label: "Mercados", detail: "desalineado" },
      scanStale: true,
    });
    expect(candidates.map((c) => c.id)).toEqual(["markets-misalignment"]);
  });

  it("clasifica nocturno warn como snapshot-warn y fusión info como snapshot-info", () => {
    const warn = buildScreenerBannerCandidates({
      showSnapshotNotice: true,
      snapshotNotice: { tone: "warn", label: "Escaneo nocturno", detail: "sin dato", source: "nightly-us" },
    });
    expect(warn[0].id).toBe("snapshot-warn");
    expect(warn[0].severity).toBe("hard");

    const info = buildScreenerBannerCandidates({
      showSnapshotNotice: true,
      snapshotNotice: { tone: "info", label: "Fusión", detail: "mezcla", source: "merged-materialized" },
    });
    expect(info[0].id).toBe("snapshot-info");
    expect(info[0].severity).toBe("soft");
  });

  it("markets loading es soft; markets error es hard", () => {
    const loading = buildScreenerBannerCandidates({
      marketsMisalignment: { tone: "loading", label: "Actualizando mesa", detail: "…" },
    });
    expect(loading[0].id).toBe("markets-loading");
    expect(loading[0].severity).toBe("soft");

    const failed = buildScreenerBannerCandidates({
      marketsMisalignment: { tone: "error", label: "Mercados", detail: "falló" },
    });
    expect(failed[0].id).toBe("markets-error");
    expect(failed[0].severity).toBe("hard");
  });

  it("apila err + misalignment + status + lideres y la cola deja 1+1", () => {
    const candidates = buildScreenerBannerCandidates({
      err: "fallo de red",
      showSnapshotNotice: true,
      snapshotNotice: { tone: "info", label: "Copia local", detail: "local", source: "local" },
      scanStatusVisible: true,
      marketsMisalignment: { tone: "warn", label: "Mercados", detail: "≠", ctaLabel: "Cargar" },
      lideresIntlGuardrail: { label: "Líderes intl", detail: "lote US" },
    });
    const slots = selectBannerSlots(candidates);
    expect(slots.hard?.id).toBe("err");
    expect(slots.soft?.id).toBe("lideres-intl");
    expect(slots.overflow.length).toBeGreaterThanOrEqual(2);
    expect(slots.overflowIds.has("markets-misalignment")).toBe(true);
    // Con err no se registra scan-status duplicado
    expect(candidates.some((c) => c.id === "scan-status")).toBe(false);
  });
});

describe("selectBannerSlots · cobertura Global no se pierde", () => {
  it("demota avisos secundarios pero deja cobertura stale en overflow legible", () => {
    const candidates = buildScreenerBannerCandidates({
      showSnapshotNotice: true,
      snapshotNotice: { tone: "warn", label: "Sin actualizar hoy", detail: "stale", stale: true, source: "supabase" },
      scanStale: true,
      scanStatusVisible: true,
    });
    const slots = selectBannerSlots(candidates);
    expect(slots.hard?.id).toBe("scan-stale-coverage");
    expect(slots.soft?.id).toBe("scan-status");
    expect(slots.overflow.map((item) => item.id)).toContain("snapshot-warn");
    expect(slots.overflow.find((item) => item.id === "snapshot-warn")?.detail).toMatch(/stale|Sin actualizar|sincronización/i);
  });
});
