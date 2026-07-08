// Test que verifica el layout con datos REALISTAS (lo que el navegador
// mostraba antes de la degradación del API). Datos tomados de la captura
// real con Playwright del navegador autenticado.

import { describe, expect, it } from "vitest";
import { layoutConstellationPoints } from "@/app/market-health/RegimeConstellation";

// Datos REALES del navegador autenticado (captura anterior):
//   GSPC dot(49.35, 30.98) — Etapa 2, distanceSma30w 4.2
//   IXIC dot(52.97, 29.50) — Etapa 2, distanceSma30w 6.1
//   RUT  dot(53.45, 30.69) — Etapa 2, distanceSma30w -2.5
//   DJI  dot(48.43, 29.40) — Etapa 2, distanceSma30w 3.8
//   ACWI dot(50.39, 27.70) — Etapa 2, distanceSma30w 2.9
const REAL = [
  { symbol: "^GSPC", stage30w: "Etapa 2 probable", distanceSma30w: 4.2 },
  { symbol: "^IXIC", stage30w: "Etapa 2 probable", distanceSma30w: 6.1 },
  { symbol: "^RUT",  stage30w: "Etapa 2 probable", distanceSma30w: -2.5 },
  { symbol: "^DJI",  stage30w: "Etapa 2 probable", distanceSma30w: 3.8 },
  { symbol: "ACWI",  stage30w: "Etapa 2 probable", distanceSma30w: 2.9 },
];

describe("RegimeConstellation — datos REALISTAS del navegador", () => {
  it("con 5 índices clusterizados en E2, el layout stagger los separa verticalmente", () => {
    const points = layoutConstellationPoints(REAL);
    console.log("\n=== LAYOUT con datos reales ===");
    points.forEach((p) => {
      const lbl = p.row.symbol.replace("^", "").padEnd(5);
      console.log(`  ${lbl} dot(${p.x.toFixed(1)},${p.y.toFixed(1)}) → label(${p.labelX.toFixed(1)},${p.labelY.toFixed(1)})${p.leaderLine ? " ← leader" : ""}`);
    });

    // Todos los labels dentro de viewBox 0..120 × 0..56
    points.forEach((p) => {
      expect(p.labelX).toBeGreaterThanOrEqual(0);
      expect(p.labelX).toBeLessThanOrEqual(120);
      expect(p.labelY).toBeGreaterThanOrEqual(0);
      expect(p.labelY).toBeLessThanOrEqual(56);
    });

    // 5 labels distintos
    expect(points.length).toBe(5);

    // 0 solapes (threshold 4 en y, 10 en x)
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        if (Math.abs(a.labelX - b.labelX) < 10) {
          expect(Math.abs(a.labelY - b.labelY)).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });
});