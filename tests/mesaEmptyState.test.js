import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildMesaEmptyCopy,
  resolveMesaEmptyKind,
  shouldFoldSnapshotNoticeIntoMesaEmpty,
  shouldShowMesaEmptyCard,
} from "@/lib/mesaEmptyState";
import MesaEmptyCard from "@/app/components/screener/MesaEmptyCard";
import { nightlyAbsenceNotice } from "@/lib/nightlyAbsence";

describe("mesaEmptyState · gates", () => {
  it("no muestra tarjeta en cold restore ni con filas cargadas", () => {
    expect(shouldShowMesaEmptyCard({ analyzedCount: 0, restoringScan: true })).toBe(false);
    expect(shouldShowMesaEmptyCard({ analyzedCount: 12, restoringScan: false })).toBe(false);
    expect(shouldShowMesaEmptyCard({ analyzedCount: 0, resultsBlocked: true })).toBe(false);
  });

  it("muestra tarjeta solo con 0 analizadas post-cold", () => {
    expect(shouldShowMesaEmptyCard({ analyzedCount: 0, restoringScan: false })).toBe(true);
  });

  it("pliega el banner de nocturno/red, no reauth", () => {
    expect(shouldFoldSnapshotNoticeIntoMesaEmpty(nightlyAbsenceNotice({ reason: "no-nightly-scan" }))).toBe(true);
    expect(shouldFoldSnapshotNoticeIntoMesaEmpty({
      tone: "warn",
      label: "Sesión",
      detail: "Vuelve a entrar",
      requiresReauth: true,
    })).toBe(false);
  });
});

describe("mesaEmptyState · copy humano", () => {
  it("nocturno ausente → título de anoche EE. UU.", () => {
    const copy = buildMesaEmptyCopy({
      markets: ["US"],
      snapshotNotice: nightlyAbsenceNotice({ reason: "no-nightly-scan" }),
    });
    expect(copy.kind).toBe("nightly");
    expect(copy.title).toBe("Sin escaneo de anoche para EE. UU.");
    expect(copy.cause).toMatch(/escaneo publicable|ticker/i);
    expect(copy.technicalDetail).toContain("Todavía no hay ningún escaneo nocturno");
  });

  it("error de red ≠ ausencia de nocturno", () => {
    expect(resolveMesaEmptyKind({
      snapshotNotice: nightlyAbsenceNotice({ reason: "cloud-unavailable" }),
    })).toBe("network");
    const copy = buildMesaEmptyCopy({
      markets: ["US"],
      snapshotNotice: nightlyAbsenceNotice({ reason: "cloud-unavailable" }),
    });
    expect(copy.title).toMatch(/No se pudo cargar/);
    expect(copy.kind).toBe("network");
  });

  it("err de chrome también clasifica como network", () => {
    expect(resolveMesaEmptyKind({ err: "fetch failed" })).toBe("network");
  });

  it("acepta markets como pares [code, label] del chrome de tests", () => {
    const copy = buildMesaEmptyCopy({
      markets: [["US", "EE. UU."]],
      snapshotNotice: nightlyAbsenceNotice({ reason: "no-nightly-scan" }),
    });
    expect(copy.title).toBe("Sin escaneo de anoche para EE. UU.");
  });
});

describe("MesaEmptyCard", () => {
  it("pinta CTAs y detalle técnico colapsado", () => {
    const html = renderToStaticMarkup(React.createElement(MesaEmptyCard, {
      markets: ["US"],
      snapshotNotice: nightlyAbsenceNotice({ reason: "no-nightly-scan" }),
      onRetry: () => {},
      onFocusSearch: () => {},
    }));
    expect(html).toContain("mesaEmptyCard");
    expect(html).toContain("Sin escaneo de anoche para EE. UU.");
    expect(html).toContain("Reintentar");
    expect(html).toContain("Buscar ticker");
    expect(html).toContain("Detalle técnico");
    expect(html).toContain("<details");
  });
});
