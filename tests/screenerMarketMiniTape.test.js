// tests/screenerMarketMiniTape.test.js — CLEAN-3: gate de fetch alineado a 760px canónico.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCREENER_MOBILE_MAX_PX,
  SCREENER_MOBILE_MEDIA_QUERY,
} from "@/lib/useScreenerMobileViewport";

const SOURCE = readFileSync(
  resolve(import.meta.dirname, "../lib/screenerMarket.jsx"),
  "utf8",
);

function extractMarketMiniTapeSource(source) {
  const start = source.indexOf("export function MarketMiniTape");
  expect(start).toBeGreaterThan(-1);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

describe("CLEAN-3 · MarketMiniTape mobile fetch gate", () => {
  const tapeSource = extractMarketMiniTapeSource(SOURCE);

  it("breakpoint canónico sigue en 760px", () => {
    expect(SCREENER_MOBILE_MAX_PX).toBe(760);
    expect(SCREENER_MOBILE_MEDIA_QUERY).toBe("(max-width: 760px)");
  });

  it("MarketMiniTape usa SCREENER_MOBILE_MEDIA_QUERY (no 900px legado)", () => {
    expect(SOURCE).toMatch(
      /import\s*\{[^}]*SCREENER_MOBILE_MEDIA_QUERY[^}]*\}\s*from\s*["']@\/lib\/useScreenerMobileViewport["']/,
    );
    expect(tapeSource).toContain("SCREENER_MOBILE_MEDIA_QUERY");
    expect(tapeSource).toMatch(/matchMedia\s*\(\s*SCREENER_MOBILE_MEDIA_QUERY\s*\)/);
    expect(tapeSource).not.toMatch(/900\s*px/);
    expect(tapeSource).not.toMatch(/max-width:\s*900/);
  });
});
