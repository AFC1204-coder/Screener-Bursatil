import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOBILE_MORE_ITEMS, MOBILE_TAB_ITEMS, NAV_ITEMS, activeForPath, moreIsActive } from "@/app/BottomNav";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("BottomNav NAV_ITEMS", () => {
  it("no incluye enlace IPO en header/bottom nav (/ipo-radar sigue existiendo fuera del nav)", () => {
    expect(NAV_ITEMS.some((item) => item.href === "/ipo-radar")).toBe(false);
    expect(NAV_ITEMS.some((item) => /IPO/i.test(item.label))).toBe(false);
  });

  it("escritorio (AppHeaderNav) conserva sus cinco destinos", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual(["/", "/lists", "/sectors", "/research-desk", "/market-health"]);
  });
});

describe("Barra inferior móvil (estudio móvil 2026-11 §2.8)", () => {
  it("cuatro destinos con etiqueta + «Más» = cinco columnas", () => {
    expect(MOBILE_TAB_ITEMS.map((item) => item.label)).toEqual(["Screener", "Listas", "Sectores", "Mercado"]);
    const source = readFileSync(resolve(ROOT, "app/BottomNav.jsx"), "utf8");
    expect(source).toMatch(/className="navLabel">Más</);
  });

  it("«Más» agrupa Research, Review e IPO radar", () => {
    expect(MOBILE_MORE_ITEMS.map((item) => item.href)).toEqual(["/research-desk", "/review", "/ipo-radar"]);
  });

  it("todo destino de escritorio sigue alcanzable en móvil (barra o «Más»)", () => {
    const mobile = new Set([...MOBILE_TAB_ITEMS, ...MOBILE_MORE_ITEMS].map((item) => item.href));
    for (const item of NAV_ITEMS) expect(mobile.has(item.href)).toBe(true);
  });

  it("«Más» se marca activo en sus rutas y no en las de la barra", () => {
    expect(moreIsActive("/review")).toBe(true);
    expect(moreIsActive("/research-desk")).toBe(true);
    expect(moreIsActive("/ipo-radar")).toBe(true);
    expect(moreIsActive("/")).toBe(false);
    expect(moreIsActive("/stock/AAPL")).toBe(false);
    expect(activeForPath("/stock/AAPL", "/")).toBe(true);
  });

  it("CSS: rejilla de 5, 56 px + zona segura, etiqueta 12 px visible; IPO radar ya no oculta la barra", () => {
    const css = readFileSync(resolve(ROOT, "styles/bottom-nav.css"), "utf8");
    expect(css).toMatch(/grid-template-columns:\s*repeat\(5/);
    expect(css).toMatch(/height:\s*calc\(56px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.navLabel\s*\{[^}]*display:\s*block !important[^}]*font-size:\s*12px/);
    const layout = readFileSync(resolve(ROOT, "app/layout.jsx"), "utf8");
    expect(layout.indexOf("bottom-nav.css")).toBeGreaterThan(layout.indexOf("components.css"));
    const ipo = readFileSync(resolve(ROOT, "styles/ipo-radar.css"), "utf8");
    expect(ipo).not.toMatch(/\.ipoRadarPage\)\s*\.bottomNav\s*\{\s*display:\s*none/);
  });
});
