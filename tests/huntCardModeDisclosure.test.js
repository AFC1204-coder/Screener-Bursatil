import { describe, expect, it } from "vitest";
import { huntCardModeDisclosure, huntCardSheetFamilyKeys } from "@/lib/huntCardModeDisclosure";

describe("huntCardModeDisclosure", () => {
  it("Radar IPO → discovery con puerta IPO ≤72m", () => {
    const disclosure = huntCardModeDisclosure({ cardId: "radar-ipo" });
    expect(disclosure).toMatchObject({
      cardId: "radar-ipo",
      cardLabel: "Radar IPO",
      presetKey: "ipoDiscovery",
      mode: "discovery",
      modeBadgeLabel: "Discovery",
    });
    expect(disclosure.doors.some((door) => door.familyKey === "ipo")).toBe(true);
    expect(disclosure.doors.some((door) => /72m/.test(door.label))).toBe(true);
  });

  it("Deterioro → strict con puerta de deterioro", () => {
    const disclosure = huntCardModeDisclosure({ cardId: "deterioro" });
    expect(disclosure).toMatchObject({
      cardId: "deterioro",
      presetKey: "weakness",
      mode: "strict",
      modeBadgeLabel: "Strict",
    });
    expect(disclosure.doors.some((door) => /Deterioro ≥/.test(door.label))).toBe(true);
  });

  it("Líderes Etapa 2 → balanced con etapa 2 y familias clave", () => {
    const disclosure = huntCardModeDisclosure({ cardId: "lideres-etapa-2" });
    expect(disclosure).toMatchObject({
      cardId: "lideres-etapa-2",
      presetKey: "balanced",
      mode: "balanced",
      modeBadgeLabel: "Balanceado",
    });
    expect(disclosure.doors.some((door) => door.label === "Etapa 2 mínima")).toBe(true);
    expect(disclosure.doors.some((door) => door.familyKey === "relativeStrength")).toBe(true);
  });

  it("Líderes intl → discovery con liquidez y cobertura", () => {
    const disclosure = huntCardModeDisclosure({ cardId: "lideres-intl" });
    expect(disclosure).toMatchObject({
      cardId: "lideres-intl",
      presetKey: "intl",
      mode: "discovery",
    });
    expect(disclosure.doors.some((door) => door.familyKey === "liquidity")).toBe(true);
  });

  it("Cerca de pivot → balanced con cercanía y tendencia", () => {
    const disclosure = huntCardModeDisclosure({ cardId: "cerca-pivot" });
    expect(disclosure?.mode).toBe("balanced");
    expect(disclosure?.doors.some((door) => door.familyKey === "proximity")).toBe(true);
    expect(disclosure?.doors.some((door) => door.label === "Etapa 2 mínima")).toBe(true);
  });

  it("resuelve desde presetKey + markets (auto-switch intl)", () => {
    expect(huntCardModeDisclosure({ presetKey: "balanced", markets: ["US"] })?.cardId).toBe("lideres-etapa-2");
    expect(huntCardModeDisclosure({ presetKey: "balanced", markets: ["CA"] })?.cardId).toBe("lideres-intl");
    expect(huntCardModeDisclosure({ presetKey: "strict", markets: ["US"] })).toBeNull();
  });

  it("expone familyKey para abrir FilterFamilyModal", () => {
    const disclosure = huntCardModeDisclosure({ cardId: "radar-ipo" });
    for (const door of disclosure.doors) {
      expect(door.familyKey).toBeTruthy();
      expect(door.familyLabel).toBeTruthy();
    }
  });
});

describe("huntCardSheetFamilyKeys", () => {
  it("devuelve familias de la ficha activa por preset", () => {
    expect(huntCardSheetFamilyKeys({ cardId: "lideres-etapa-2" })).toEqual([
      "trend", "liquidity", "momentum", "relativeStrength", "score", "proximity",
    ]);
    expect(huntCardSheetFamilyKeys({ cardId: "radar-ipo" })).toEqual(["ipo", "liquidity"]);
    expect(huntCardSheetFamilyKeys({ cardId: "lideres-intl" })).toEqual(["liquidity", "coverage"]);
  });
});
