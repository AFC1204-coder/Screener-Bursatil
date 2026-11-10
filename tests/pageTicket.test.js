// Paso 9 del rediseño 2026-11: ticket compartido de las vistas hermanas.
// Fija el contrato del componente (un único h1, chip, verdad corta, acciones)
// y que el CSS solo USA los tokens del screener, sin redefinirlos.
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageTicket } from "@/app/components/PageTicket";

const CSS = readFileSync(new URL("../styles/page-ticket.css", import.meta.url), "utf8");
const PAGES = [
  "app/lists/page.jsx",
  "app/research-desk/page.jsx",
  "app/review/page.jsx",
  "app/sectors/page.jsx",
  "app/market-health/page.jsx",
  "app/ipo-radar/page.jsx",
  "app/stock/[symbol]/StockClient.jsx",
];

function render(props) {
  return renderToStaticMarkup(React.createElement(PageTicket, props));
}

describe("PageTicket", () => {
  it("pinta título, chip con dato secundario, verdad corta y acciones", () => {
    const html = render({
      title: "Listas",
      chip: "Global",
      chipMeta: "1/27",
      truth: "55 acciones únicas",
      truthTitle: "nota larga",
      children: React.createElement("a", { className: "btn btnPrimary", href: "/review" }, "Revisar"),
    });
    expect(html).toContain('<h1 class="pageTicketTitle">Listas</h1>');
    expect(html).toContain('class="pageTicketChip"');
    expect(html).toContain("<em>1/27</em>");
    expect(html).toContain('class="pageTicketTruth" role="status" title="nota larga"');
    expect(html).toContain('class="pageTicketActions"');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("sin verdad deja un espaciador (las acciones siguen a la derecha) y sin acciones no pinta contenedor", () => {
    const html = render({ title: "Mercado" });
    expect(html).toContain("pageTicketSpacer");
    expect(html).not.toContain("pageTicketActions");
    expect(html).not.toContain("pageTicketChip");
  });

  it("badge sustituye al chip y lead va antes del título", () => {
    const html = render({
      title: "AAPL",
      lead: React.createElement("span", { className: "logo" }),
      badge: React.createElement("span", { className: "stage" }, "Etapa 2"),
      chip: "no debe salir",
    });
    expect(html.indexOf('class="logo"')).toBeLessThan(html.indexOf("pageTicketTitle"));
    expect(html).toContain("Etapa 2");
    expect(html).not.toContain("no debe salir");
  });
});

describe("page-ticket.css", () => {
  it("usa los tokens del ticket y la fila del screener", () => {
    expect(CSS).toMatch(/\.pageTicket \{[^}]*min-height:var\(--ticket-h\)/);
    expect(CSS).toMatch(/\.pageTicketTitle[\s\S]*?font-size:var\(--display-m\)/);
    expect(CSS).toMatch(/\.table td \{[^}]*height:var\(--row-h\)/);
    expect(CSS).toContain("var(--surface-raised)");
  });

  it("no redefine tokens (solo los usa)", () => {
    expect(CSS).not.toMatch(/^\s*--[a-z0-9-]+\s*:/m);
  });
});

describe("vistas hermanas", () => {
  it.each(PAGES)("%s monta el ticket compartido y no la cabecera heroica", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("PageTicket");
    expect(source).not.toMatch(/className="card hero/);
    expect(source).not.toContain('className="mobileActions"');
  });
});
