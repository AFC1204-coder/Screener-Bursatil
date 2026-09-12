// MH-PERF-2: N0/N1 no esperan a news/social; el sentimiento declara espera local.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SentimentRow } from "@/app/market-health/page";

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app/market-health/page.jsx"),
  "utf8",
);

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) throw new Error(`No se encontró function ${name}`);
  let index = source.indexOf("(", start);
  let parenDepth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) break;
    }
  }
  const brace = source.indexOf("{", index);
  let depth = 0;
  for (index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`function ${name} sin cierre`);
}

describe("Market Health — barrier N0/N1 vs sentimiento N2", () => {
  it("load() espera solo market-health, breadth y leadership", () => {
    const load = extractFunction(pageSource, "load");
    expect(load).toContain("marketHealthApiPath({ refresh })");
    expect(load).toContain("/api/market-breadth");
    expect(load).toContain("/api/market-leadership");
    expect(load).not.toContain("/api/market-news");
    expect(load).not.toContain("/api/social-sentiment");
    expect(load).not.toContain("setNews(");
    expect(load).not.toContain("setSocial(");
  });

  it("news y social cargan en funciones propias y Actualizar las dispara", () => {
    expect(extractFunction(pageSource, "loadNews")).toContain("/api/market-news");
    expect(extractFunction(pageSource, "loadSocial")).toContain("/api/social-sentiment");
    const refresh = extractFunction(pageSource, "refreshAll");
    expect(refresh).toContain("load({ refresh: true })");
    expect(refresh).toContain("loadNews()");
    expect(refresh).toContain("loadSocial()");
  });
});

describe("SentimentRow — estado local de carga y error", () => {
  it("en carga no finge una pasada vacía", () => {
    const html = renderToStaticMarkup(React.createElement(SentimentRow, {
      title: "Titulares",
      sampleLabel: "titulares",
      loading: true,
    }));
    expect(html).toContain("Cargando titulares");
    expect(html).toContain('data-loading="true"');
    expect(html).not.toContain("Sin muestra de titulares");
  });

  it("un error de feed se declara en la fila, no como muestra", () => {
    const html = renderToStaticMarkup(React.createElement(SentimentRow, {
      title: "Titulares",
      sampleLabel: "titulares",
      loading: false,
      data: { error: "Los titulares de mercado no están disponibles ahora mismo.", rows: [] },
    }));
    expect(html).toContain("Sin muestra de titulares en esta pasada.");
    expect(html).not.toContain("Cargando titulares");
  });

  it("con muestra pintada conserva los valores al refrescar", () => {
    const html = renderToStaticMarkup(React.createElement(SentimentRow, {
      title: "Titulares",
      sampleLabel: "titulares",
      loading: true,
      data: {
        total: 4,
        pessimismIndex: 61,
        bearishPct: 40,
        neutralPct: 30,
        bullishPct: 30,
        dominantSentiment: "bajista",
        regime: "contrarian",
      },
    }));
    expect(html).toContain("actualizando");
    expect(html).toContain("61");
    expect(html).toContain("bajista");
    expect(html).not.toContain("Cargando titulares");
  });
});
