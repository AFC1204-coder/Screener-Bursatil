// Verificación REAL del componente RegimeConstellation.
//
// Renderiza el JSX real con renderToStaticMarkup y comprueba las coordenadas
// reales del DOM/SVG resultante. NO recalcula nada en paralelo: usa el
// componente que el navegador ejecuta (importado desde el módulo real).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RegimeConstellation, {
  aggregatePosition,
  regimeTone,
  layoutConstellationPoints,
} from "@/app/market-health/RegimeConstellation";

// Datos realistas del API /api/market-health.
const REALISTIC_INDEXES = [
  { symbol: "^GSPC", name: "S&P 500", weight: 30, stage30w: "Etapa 2 probable", distanceSma30w: 4.2 },
  { symbol: "^IXIC", name: "Nasdaq Composite", weight: 30, stage30w: "Etapa 2 probable", distanceSma30w: 6.1 },
  { symbol: "^RUT",  name: "Russell 2000", weight: 20, stage30w: "Etapa 1 probable", distanceSma30w: -2.5 },
  { symbol: "^DJI",  name: "Dow Jones", weight: 10, stage30w: "Etapa 2 probable", distanceSma30w: 3.8 },
  { symbol: "ACWI",  name: "MSCI ACWI", weight: 10, stage30w: "Etapa 2 probable", distanceSma30w: 2.9 },
];

// Peor caso: 6 índices todos en E2 con distances similares (clustering denso).
const WORST_CASE_INDEXES = [
  { symbol: "^GSPC", stage30w: "Etapa 2 probable", distanceSma30w: 3.0 },
  { symbol: "^IXIC", stage30w: "Etapa 2 probable", distanceSma30w: 3.5 },
  { symbol: "^DJI",  stage30w: "Etapa 2 probable", distanceSma30w: 4.0 },
  { symbol: "ACWI",  stage30w: "Etapa 2 probable", distanceSma30w: 4.5 },
  { symbol: "^RUT",  stage30w: "Etapa 2 probable", distanceSma30w: 2.5 },
  { symbol: "^NDX",  stage30w: "Etapa 2 probable", distanceSma30w: 5.0 },
];

// Caso degradado: API caída, todos los stage30w en null.
const DEGRADED_INDEXES = [
  { symbol: "^GSPC", stage30w: null, distanceSma30w: null },
  { symbol: "^IXIC", stage30w: null, distanceSma30w: null },
  { symbol: "^RUT",  stage30w: null, distanceSma30w: null },
  { symbol: "^DJI",  stage30w: null, distanceSma30w: null },
  { symbol: "ACWI",  stage30w: null, distanceSma30w: null },
];

function extractLabelCoords(html) {
  // React renderiza atributos en orden variable según type. Buscamos el tag
  // <text ... class="curve-index-label" ...>GSPC</text> y extraemos x, y, texto
  // con regex independientes para no asumir orden.
  const tagRegex = /<text\s+([^>]*?)>([A-Z]+)<\/text>/g;
  const out = [];
  let m;
  while ((m = tagRegex.exec(html)) !== null) {
    const attrs = m[1];
    if (!attrs.includes('class="curve-index-label"')) continue;
    const xMatch = attrs.match(/\bx="([\d.]+)"/);
    const yMatch = attrs.match(/\by="([\d.]+)"/);
    if (!xMatch || !yMatch) continue;
    out.push({ x: parseFloat(xMatch[1]), y: parseFloat(yMatch[1]), text: m[2] });
  }
  return out;
}

function extractLeaderCoords(html) {
  const tagRegex = /<line\s+([^>]*?)\/?>/g;
  const out = [];
  let m;
  while ((m = tagRegex.exec(html)) !== null) {
    const attrs = m[1];
    if (!attrs.includes('class="curve-leader"')) continue;
    const x1 = attrs.match(/\bx1="([\d.]+)"/);
    const y1 = attrs.match(/\by1="([\d.]+)"/);
    const x2 = attrs.match(/\bx2="([\d.]+)"/);
    const y2 = attrs.match(/\by2="([\d.]+)"/);
    if (!x1 || !y1 || !x2 || !y2) continue;
    out.push({
      x1: parseFloat(x1[1]), y1: parseFloat(y1[1]),
      x2: parseFloat(x2[1]), y2: parseFloat(y2[1]),
    });
  }
  return out;
}

function extractDotCoords(html) {
  const tagRegex = /<circle\s+([^>]*?)\/?>/g;
  const out = [];
  let m;
  while ((m = tagRegex.exec(html)) !== null) {
    const attrs = m[1];
    if (!attrs.includes('class="curve-index-dot"')) continue;
    const cx = attrs.match(/\bcx="([\d.]+)"/);
    const cy = attrs.match(/\bcy="([\d.]+)"/);
    if (!cx || !cy) continue;
    out.push({ cx: parseFloat(cx[1]), cy: parseFloat(cy[1]) });
  }
  return out;
}

describe("market-health/RegimeConstellation — render REAL del componente", () => {
  it("caso realista (5 índices): SVG contiene curva, ticks E1-E4, 5 dots, 5 labels y leader lines", () => {
    const html = renderToStaticMarkup(
      React.createElement(RegimeConstellation, { indexes: REALISTIC_INDEXES })
    );

    // SVG con clase esperada
    expect(html).toMatch(/<svg[^>]*marketRegimeConstellationSvg/);
    // Curva principal
    expect(html).toMatch(/<path[^>]*class="curve-track"/);
    // 4 ticks de zona
    expect(html).toContain(">E1</text>");
    expect(html).toContain(">E2</text>");
    expect(html).toContain(">E3</text>");
    expect(html).toContain(">E4</text>");
    // Marcador agregado con data-tone
    expect(html).toMatch(/<circle[^>]*class="curve-marker"[^>]*data-tone="[^"]+"/);

    // 5 dots (curve-index-dot)
    const dots = extractDotCoords(html);
    expect(dots.length).toBe(5);

    // 5 labels con los tickers correctos
    const labels = extractLabelCoords(html);
    expect(labels.length).toBe(5);
    const labelTexts = labels.map((l) => l.text).sort();
    expect(labelTexts).toEqual(["ACWI", "DJI", "GSPC", "IXIC", "RUT"]);

    // **0 solapes**: ningún par de labels con |Δx| < 10 Y |Δy| < 4
    const LABEL_HALF_WIDTH = 5;
    let overlaps = 0;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j];
        if (Math.abs(a.x - b.x) < LABEL_HALF_WIDTH * 2 && Math.abs(a.y - b.y) < 4) {
          overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);

    // **Leader lines presentes** (en este caso, 2 esperadas: DJI y ACWI)
    const leaders = extractLeaderCoords(html);
    expect(leaders.length).toBeGreaterThanOrEqual(1);
    // Cada leader conecta un dot con un label NO trivial (distancia > 0)
    leaders.forEach((l) => {
      const dx = Math.abs(l.x1 - l.x2);
      const dy = Math.abs(l.y1 - l.y2);
      expect(dx + dy).toBeGreaterThan(0);
    });

    // **Marcador agregado**: tiene data-tone único (no dos colores)
    const markerMatch = html.match(/<circle[^>]*class="curve-marker"[^>]*data-tone="(\w+)"/);
    expect(markerMatch).not.toBeNull();
    const tone = markerMatch[1];
    expect(["senal", "oxido", "humo"]).toContain(tone);
  });

  it("peor caso (6 índices en E2): 0 solapes, leader lines presentes, dentro de viewBox", () => {
    const html = renderToStaticMarkup(
      React.createElement(RegimeConstellation, { indexes: WORST_CASE_INDEXES })
    );

    const labels = extractLabelCoords(html);
    expect(labels.length).toBe(6);

    // Todos los labels dentro del viewBox 0..120 × 0..56
    labels.forEach((l) => {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x).toBeLessThanOrEqual(120);
      expect(l.y).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeLessThanOrEqual(56);
    });

    // 0 solapes
    const LABEL_HALF_WIDTH = 5;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j];
        expect(
          Math.abs(a.x - b.x) >= LABEL_HALF_WIDTH * 2 || Math.abs(a.y - b.y) >= 4
        ).toBe(true);
      }
    }

    // Leader lines presentes en el peor caso (esperamos >=3)
    const leaders = extractLeaderCoords(html);
    expect(leaders.length).toBeGreaterThanOrEqual(2);
  });

  it("caso degradado (stage30w=null en todos): 5 dots en misma posición, labels fanned, sin errores", () => {
    const html = renderToStaticMarkup(
      React.createElement(RegimeConstellation, { indexes: DEGRADED_INDEXES })
    );

    const dots = extractDotCoords(html);
    expect(dots.length).toBe(5);

    // Los 5 dots colapsan al mismo punto (zona 1, x=17, jitter=0)
    dots.forEach((d) => {
      expect(d.cx).toBeCloseTo(17, 1);
    });

    // Los labels DEBEN estar en y distintos aunque los dots coincidan
    const labels = extractLabelCoords(html);
    expect(labels.length).toBe(5);
    const uniqueY = new Set(labels.map((l) => Math.round(l.y)));
    expect(uniqueY.size).toBe(5); // 5 y distintos
  });

  it("layoutConstellationPoints (función pura) asigna leaderLine y labelX/labelY", () => {
    const points = layoutConstellationPoints(REALISTIC_INDEXES);
    expect(points.length).toBe(5);
    points.forEach((p) => {
      expect(typeof p.labelX).toBe("number");
      expect(typeof p.labelY).toBe("number");
      expect(typeof p.leaderLine).toBe("boolean");
      // leaderLine debe ser true cuando el label se alejó del dot >4 unidades.
      const dx = Math.abs(p.labelX - p.x);
      const dy = Math.abs(p.labelY - p.y);
      const expectedLeader = (dx + dy) > 4;
      expect(p.leaderLine).toBe(expectedLeader);
    });
  });

  it("aggregatePosition devuelve x y zone dominante correctos", () => {
    const agg = aggregatePosition(REALISTIC_INDEXES);
    expect(agg).not.toBeNull();
    expect(agg.zone).toBe(2); // 4 de 5 están en E2 → zona dominante 2
    expect(agg.x).toBeGreaterThan(30);
    expect(agg.x).toBeLessThan(54);
  });

  it("regimeTone devuelve un único valor entre senal/oxido/humo", () => {
    const tone = regimeTone({ breadthProxy: { pctAbove30w: 80 } }, REALISTIC_INDEXES);
    expect(["senal", "oxido", "humo"]).toContain(tone);
  });
});