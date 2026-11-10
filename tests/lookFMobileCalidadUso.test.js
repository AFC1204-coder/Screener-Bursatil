import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LAYOUT = readFileSync(new URL("../app/layout.jsx", import.meta.url), "utf8");
const BASE_CSS = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");
const SCREENER_CSS = readFileSync(new URL("../styles/screener.css", import.meta.url), "utf8");
const SCREENER_SHELL = readFileSync(
  new URL("../app/components/screener/ScreenerShell.jsx", import.meta.url),
  "utf8",
);
const FILTERS_VIEW = readFileSync(new URL("../lib/screenerFiltersView.jsx", import.meta.url), "utf8");

describe("LOOK-F · móvil calidad de uso", () => {
  it("viewport sin maximumScale:1", () => {
    expect(LAYOUT).not.toMatch(/maximumScale:\s*1/);
  });

  it("padding-bottom móvil coherente con nav (~64px), no 116px", () => {
    expect(BASE_CSS).not.toMatch(/padding-bottom:\s*calc\(116px/);
    expect(BASE_CSS).toMatch(/@media \(max-width: 760px\)[\s\S]*body \{ padding-bottom: calc\(64px \+ env\(safe-area-inset-bottom\)\)/s);
    expect(COMPONENTS_CSS).not.toMatch(/padding-bottom:calc\(118px \+ env\(safe-area-inset-bottom\)\)/);
    expect(COMPONENTS_CSS).toMatch(/@media\(max-width:760px\)[\s\S]*\.page \{[\s\S]*calc\(64px \+ env\(safe-area-inset-bottom\)\)/s);
  });

  // Estudio móvil 2026-11 (pasos 7-8): la sub-barra flotante se sustituye por
  // una cabecera pegada (vista + verdad corta), pestañas de vistas y la barra
  // del filtro vivo con «Filtros ③», todo con objetivos de 44 px.
  it("cabecera móvil pegada: vista, pestañas y filtro vivo en ScreenerShell", () => {
    expect(SCREENER_SHELL).toContain("mobileStickyHead");
    expect(SCREENER_SHELL).toContain('layout="tabs"');
    expect(SCREENER_SHELL).toContain("mobileFilterBtn");
    expect(SCREENER_SHELL).not.toContain("screenerMobileSubBar");
    expect(SCREENER_CSS).toMatch(/\.mobileStickyHead\s*\{[^}]*position:sticky/s);
    expect(SCREENER_CSS).toMatch(/\.mobileFilterBtn\s*\{[^}]*height:44px/s);
    expect(SCREENER_CSS).toMatch(/\.mobileIconBtn\s*\{[^}]*width:44px[^}]*height:44px/s);
  });

  it("CTA Listo del drawer móvil ≥44px", () => {
    expect(COMPONENTS_CSS).toMatch(
      /\.sidebar\.mobileOpen \.mobileSidebarHeader \.btnPrimary\s*\{[^}]*min-height:\s*44px/s,
    );
  });

  it("estado/fusión móvil en una línea con disclosure", () => {
    expect(SCREENER_SHELL).toContain("screenerMobileStatusFold");
    expect(SCREENER_SHELL).toContain("screenerMobileStatusFoldPeek");
    expect(SCREENER_CSS).toMatch(/\.screenerMobileStatusFoldPeek\s*\{[^}]*-webkit-line-clamp:1/s);
  });

  // Paso 6 (rediseño 2026-11): el raíl de vistas es vertical en escritorio.
  // Estudio móvil 2026-11 (paso 8): en móvil, las mismas vistas como pestañas
  // deslizables de 32 px con área táctil ampliada a 44 px.
  it("vistas en móvil: pestañas deslizables con objetivo táctil de 44 px", () => {
    expect(SCREENER_CSS).toMatch(/\.mobileViewTabs\s*\{[^}]*overflow-x:auto/s);
    expect(SCREENER_CSS).toMatch(/\.mobileViewTab::after\s*\{[^}]*inset:-6px 0/s);
    expect(SCREENER_CSS).not.toMatch(/\.huntCardRailScroll/);
  });

  it("inputs clave a 16px e inputMode numérico en modal familia", () => {
    expect(SCREENER_CSS).toMatch(/@media \(max-width:760px\)[\s\S]*\.filterFamilyModal \.input\s*\{[^}]*font-size:var\(--text-l\)/s);
    expect(FILTERS_VIEW).toMatch(/inputMode=\{(Number\.isInteger\(step\) \? "numeric" : "decimal")\}/);
    expect(FILTERS_VIEW).toMatch(/inputMode="numeric"/);
    expect(FILTERS_VIEW).toMatch(/inputMode="decimal"/);
  });

  it("preview flotante intacto (no empuja fold)", () => {
    expect(SCREENER_SHELL).toContain("searchPopoverHost");
    expect(COMPONENTS_CSS).toMatch(/\.searchResult\.searchResultPrimary\s*\{[^}]*position:absolute/s);
  });
});
