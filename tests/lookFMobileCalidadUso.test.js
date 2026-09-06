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

  it("sub-barra sticky Filtros · ficha · Revisar en ScreenerShell", () => {
    expect(SCREENER_SHELL).toContain("screenerMobileSubBar");
    expect(SCREENER_SHELL).toContain("Filtros ({filterActiveCount})");
    expect(SCREENER_SHELL).toContain("screenerMobileSubBarFicha");
    expect(SCREENER_SHELL).toMatch(/Revisar[\s\S]*openPrimaryReview/s);
    expect(SCREENER_CSS).toMatch(/\.screenerMobileSubBar\s*\{[^}]*position:\s*fixed/s);
    expect(SCREENER_CSS).toMatch(/\.screenerMobileSubBarBtn\s*\{[^}]*min-height:\s*44px/s);
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

  it("hunt rail ≥40px con máscara de degradado en scroll horizontal", () => {
    expect(SCREENER_CSS).toMatch(/@media\(max-width:760px\)[\s\S]*\.huntCardRailScroll\s*\{[^}]*mask-image:linear-gradient/s);
    expect(SCREENER_CSS).toMatch(/@media\(max-width:760px\)[\s\S]*\.huntCardRail button\s*\{[^}]*min-height:var\(--control-l\)/s);
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
