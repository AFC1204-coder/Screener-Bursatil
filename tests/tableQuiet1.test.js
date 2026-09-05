// tests/tableQuiet1.test.js — TABLE-QUIET-1: ausencias esperadas VCP / RS tema sin InfoHint.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MissingValue, RS_THEME_COLUMN, SCREENER_COLUMNS } from "@/lib/screenerColumns";
import { THEME_RS_NOT_HYDRATED_REASON } from "@/lib/themeRs";
import { vcpMinerviniLabel } from "@/lib/vcpMinerviniLabel";

const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

function columnCell(key) {
  if (key === "rsTheme") return RS_THEME_COLUMN.cell;
  const column = SCREENER_COLUMNS.find((entry) => entry.key === key);
  if (!column) throw new Error(`column not found: ${key}`);
  return column.cell;
}

describe("TABLE-QUIET-1: MissingValue quiet", () => {
  it("quiet pinta guion y srOnly sin InfoHint, con title nativo", () => {
    const html = render(MissingValue, {
      quiet: true,
      reason: "Sin compresión VCP operable (menos de 2 contracciones medidas).",
    });

    expect(html).toContain("–");
    expect(html).toContain("Sin dato");
    expect(html).not.toContain("infoHint");
    expect(html).toContain('title="Sin compresión VCP operable (menos de 2 contracciones medidas)."');
  });
});

describe("TABLE-QUIET-1: columna VCP", () => {
  const renderVcp = (row) => renderToStaticMarkup(columnCell("vcp")(row));

  it("sin label VCP usa quiet missing sin InfoHint", () => {
    const row = { symbol: "NOVCP", contractionCount: 1 };
    const html = renderVcp(row);

    expect(vcpMinerviniLabel(row).label).toBe("");
    expect(html).toContain("cellMissing");
    expect(html).not.toContain("infoHint");
    expect(html).toContain("menos de 2 contracciones");
  });

  it("con label VCP pinta la etiqueta Minervini", () => {
    const row = { symbol: "VCP1", contractionCount: 3, vcpCandidate: true, distanceToPivotPct: 4.2 };
    const html = renderVcp(row);

    expect(vcpMinerviniLabel(row).label).toContain("3C");
    expect(html).toContain("vcpTag");
    expect(html).not.toContain("cellMissing");
  });
});

describe("TABLE-QUIET-1: columna RS tema", () => {
  const renderRsTheme = (row) => renderToStaticMarkup(columnCell("rsTheme")(row));

  it("ausencia esperada (no hidratado) sin InfoHint", () => {
    const row = {
      symbol: "NOTE",
      theme: "Semis / fotonica",
      sector: "Technology",
      industry: "Semiconductors",
    };
    const html = renderRsTheme(row);

    expect(html).toContain("cellMissing");
    expect(html).not.toContain("infoHint");
    expect(html).toContain(`title="${THEME_RS_NOT_HYDRATED_REASON}"`);
  });

  it("valor disponible pinta el percentil", () => {
    const row = {
      symbol: "THEME",
      theme: "Semis / fotonica",
      weeklyThemeRsAvailable: true,
      weeklyThemeRsRating: 72,
    };
    const html = renderRsTheme(row);

    expect(html).toContain(">72</b>");
    expect(html).not.toContain("cellMissing");
  });

  it("dato no fiable conserva InfoHint", () => {
    const row = {
      symbol: "BAD",
      theme: "Semis / fotonica",
      weeklyThemeRsAvailable: true,
      weeklyThemeRsRating: 55,
      metricAuditFlags: { weeklyThemeRsRating: "mismatch" },
    };
    const html = renderRsTheme(row);

    expect(html).toContain("cellMissing");
    expect(html).toContain("infoHint");
    expect(html).toContain("no coincide con el recalculado");
  });
});
