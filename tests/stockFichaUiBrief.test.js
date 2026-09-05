import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import StockClient from "@/app/stock/[symbol]/StockClient";
import StockAddToListButton from "@/app/stock/[symbol]/StockAddToListButton";
import StockSymbolSearch from "@/app/stock/[symbol]/StockSymbolSearch";
import {
  addSymbolToUserList,
  favoriteRowFromStockBrief,
  readUserListMembership,
  USER_LIST_TARGETS,
} from "@/lib/stockListActions";
import { readFavorites, writeFavorites } from "@/lib/localState";

function installFakeStorage() {
  const store = new Map();
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
}

beforeEach(() => {
  installFakeStorage();
  writeFavorites([]);
});

afterEach(() => {
  delete globalThis.localStorage;
  if (globalThis.window === globalThis) delete globalThis.window;
});

const baseData = {
  symbol: "SOPH",
  name: "Sophia Genetics SA",
  sector: "Health Care",
  industry: "Diagnostics",
  country: "CH",
  marketCap: 689_000_000,
  currency: "USD",
  chartBars: [{ date: "2026-09-04", close: 8.09, high: 8.5, low: 7.9, volume: 1000 }],
  quoteSnapshot: { price: 8.09, dayChangePct: -8.6 },
  stage: { label: "Etapa 2", weekly: { state: "stage2", confirmation: "confirmed" } },
  relativeStrength: { rating: 96, benchmarkSymbol: "SPY" },
  dataQuality: { freshness: { priceDate: "2026-09-04" }, coverage: { label: "Completa" } },
  visual: { initials: "SO" },
};

describe("stock ficha UI brief", () => {
  it("renderiza clasificación compacta, + lista y buscador sobre el gráfico", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "SOPH",
      initialData: baseData,
    }));
    expect(html).toContain("stockClassificationBar");
    expect(html).toContain("stockDecisionActionMenu");
    expect(html).toContain("Tu clasificación");
    expect(html).toContain("+ lista");
    expect(html).toContain("stockChartSearch");
    expect(html).toContain("Buscar ticker o nombre");
    expect(html).not.toContain("stockDecisionResolveRail");
  });

  it("StockSymbolSearch expone formulario de salto rápido", () => {
    const html = renderToStaticMarkup(React.createElement(StockSymbolSearch, { currentSymbol: "SOPH" }));
    expect(html).toContain("stockChartSearchForm");
    expect(html).toContain('placeholder="Buscar ticker o nombre…"');
  });

  it("StockAddToListButton muestra trigger + lista", () => {
    const html = renderToStaticMarkup(React.createElement(StockAddToListButton, {
      symbol: "SOPH",
      data: baseData,
    }));
    expect(html).toContain("+ lista");
    expect(html).toContain("stockAddToListTrigger");
  });
});

describe("stockListActions", () => {
  it("solo expone favoritos como lista de usuario", () => {
    expect(USER_LIST_TARGETS.map((item) => item.key)).toEqual(["favorites"]);
  });

  it("construye fila mínima desde el brief de la ficha", () => {
    const row = favoriteRowFromStockBrief("SOPH", baseData);
    expect(row.symbol).toBe("SOPH");
    expect(row.companyName).toBe("Sophia Genetics SA");
    expect(row.rsGlobalPct).toBe(96);
  });

  it("añade a favoritos y detecta membresía", () => {
    const result = addSymbolToUserList("favorites", "SOPH", baseData, { source: "stock", skipCloudSync: true });
    expect(result.ok).toBe(true);
    expect(result.already).toBe(false);
    expect(readFavorites().some((item) => item.symbol === "SOPH")).toBe(true);
    expect(readUserListMembership("SOPH").favorites).toBe(true);
  });

  it("no duplica favoritos existentes", () => {
    addSymbolToUserList("favorites", "SOPH", baseData, { skipCloudSync: true });
    const again = addSymbolToUserList("favorites", "SOPH", baseData, { skipCloudSync: true });
    expect(again.already).toBe(true);
    expect(readFavorites().filter((item) => item.symbol === "SOPH")).toHaveLength(1);
  });
});
