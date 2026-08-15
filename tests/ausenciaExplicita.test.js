// tests/ausenciaExplicita.test.js — un dato ausente se muestra como ausente.
//
// docs/principios-producto.md, principio 3: "Un dato ausente se muestra como
// ausente, no como cero ni como valor por defecto". El commit 1bf8e40 cerró
// esto en el CÁLCULO (scanPercentileFinalization dejó de sustituir métricas
// ausentes por 0/40/45); estos tests lo fijan en la PRESENTACIÓN.
//
// La otra mitad del contrato importa igual: un cero REAL —un valor que de
// verdad rindió 0,0%, un recuento que de verdad es 0— tiene que seguir
// mostrándose como 0. El corte siempre lo hace Number.isFinite sobre el valor,
// nunca la falsedad del cero en JavaScript.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountValue } from "@/app/components/ui/CountValue";
import { PerformanceStrip } from "@/app/components/screener/PerformanceStrip";
import { MissingValue } from "@/lib/screenerColumns";
import { PERFORMANCE_PERIODS } from "@/lib/screenerPeriods";

// Los tests del repo van en .js sin transformador de JSX (vitest.config.mjs),
// así que los componentes se instancian con React.createElement, igual que
// tests/screenerSevenColumns.test.js.
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

describe("tira de rendimiento de la vista rápida", () => {
  // El caso reportado: "1S +0.0%, 1M +0.0%, YTD +0.0%" junto a "3M +5.2%" y
  // "1A +38.0%". perf1w, perf1m y perfYtd no los calcula NADIE en el
  // pipeline — no eran rendimientos nulos, eran cajas sin dato detrás.
  it("solo muestra los periodos que la fila calcula de verdad", () => {
    const html = render(PerformanceStrip, { row: { perf3m: 5.2, perf6m: 12, perf12m: 38 } });

    expect(PERFORMANCE_PERIODS.map((period) => period.key)).toEqual(["perf3m", "perf6m", "perf12m"]);
    for (const period of PERFORMANCE_PERIODS) {
      expect(html).toContain(`<span>${period.label}</span>`);
    }
    expect(html).not.toContain(">1S<");
    expect(html).not.toContain(">YTD<");
  });

  it("un periodo sin dato sale como ausencia con motivo, no como 0,0%", () => {
    const html = render(PerformanceStrip, { row: { perf3m: 5.2, perf6m: null, perf12m: undefined } });

    // Formato es-ES de la capa única (lib/formatters.js): coma decimal.
    expect(html).toContain("+5,2%");
    expect(html).not.toContain("0,0%");
    expect(html).toContain("cellMissing");
    expect(html).toContain("Sin dato");
    expect(html).toContain("rendimiento a 6 meses");
    expect(html).toContain("rendimiento a 12 meses");
  });

  it("un rendimiento que de verdad fue 0,0% se sigue mostrando como 0,0%", () => {
    const html = render(PerformanceStrip, { row: { perf3m: 0, perf6m: -0.04, perf12m: 0 } });

    // El cero (y el -0,04 que redondea a cero) sale SIN signo: "-0.0%" era un
    // signo sin significado y "+0,0%" afirmaba una subida que no existe.
    expect(html.match(/(?<![+\-\d])0,0%/g) || []).toHaveLength(3);
    expect(html).not.toContain("+0,0%");
    expect(html).not.toContain("-0,0%");
    expect(html).not.toContain("cellMissing");
  });
});

describe("recuentos de los paneles de fiabilidad", () => {
  it("un recuento que no ha llegado se muestra ausente, no como cero", () => {
    const html = render(CountValue, { value: undefined, reason: "No ha llegado el recuento." });

    expect(html).toContain("cellMissing");
    expect(html).toContain("No ha llegado el recuento.");
    expect(html).not.toContain(">0<");
  });

  it("un recuento que de verdad es cero se muestra como cero", () => {
    expect(render(CountValue, { value: 0, reason: "No ha llegado." })).not.toContain("cellMissing");
    expect(render(CountValue, { value: 0, reason: "No ha llegado." })).toContain("0");
  });

  it("null y cadena vacía cuentan como ausencia", () => {
    expect(render(CountValue, { value: null, reason: "x" })).toContain("cellMissing");
    expect(render(CountValue, { value: "", reason: "x" })).toContain("cellMissing");
  });
});

describe("MissingValue: el patrón de ausencia es uno solo", () => {
  it("pinta guion, texto para lector de pantalla e icono con el motivo", () => {
    const html = render(MissingValue, { reason: "Sin RS: el valor no está en el ranking semanal." });

    expect(html).toContain("–");
    expect(html).toContain("Sin dato");
    expect(html).toContain("infoHint");
    expect(html).toContain("Sin RS: el valor no está en el ranking semanal.");
  });
});
